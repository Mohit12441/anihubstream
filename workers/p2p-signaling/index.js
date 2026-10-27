// @ts-check
/**
 * Cloudflare Worker + Durable Object P2P WebRTC Signaling Server
 * Coordinates real-time swarm discovery and WebRTC offer/answer relays.
 * Uses Durable Object WebSocket Hibernation API for zero idle cost.
 */

export class SwarmDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const peerId = url.searchParams.get('peer') || Math.random().toString(36).slice(2, 10);
    // @ts-ignore
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept via WebSocket Hibernation API
    this.state.acceptWebSocket(server, [peerId]);
    server.serializeAttachment({ peerId });

    // Announce presence to other peers in this swarm
    this.broadcast({ type: 'hello', peerId }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : JSON.parse(new TextDecoder().decode(message));
      // Broadcast signaling payload (offer, answer, ice-candidate, chunk request) to swarm
      this.broadcast(data, ws);
    } catch {}
  }

  webSocketClose(ws, code, reason, wasClean) {
    const attachment = ws.deserializeAttachment();
    if (attachment?.peerId) {
      this.broadcast({ type: 'bye', peerId: attachment.peerId }, ws);
    }
    ws.close(code, reason);
  }

  webSocketError(ws, error) {
    ws.close(1011, 'WebSocket error');
  }

  broadcast(msg, senderWs) {
    const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws !== senderWs) {
        try {
          ws.send(payload);
        } catch {}
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(JSON.stringify({
        ok: true,
        service: 'anihub-p2p-signal',
        runtime: 'Cloudflare Workers + Durable Objects',
        hibernation: true,
      }), {
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
      });
    }

    if (url.pathname === '/p2p-signal' || url.pathname.startsWith('/parties/')) {
      const swarmId = url.searchParams.get('swarm') || 'default-swarm';
      const id = env.SWARM_DO.idFromName(swarmId);
      const stub = env.SWARM_DO.get(id);
      return stub.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
