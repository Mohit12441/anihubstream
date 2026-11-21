// @ts-check
/**
 * Cloudflare Pages Function: /api/party/sync
 * Edge fallback synchronization for Watch Party when WebSockets are unavailable.
 * Maintains transient room state and broadcasts events across peers.
 */

// Global in-worker transient room store
const roomStore = new Map();

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // CORS headers
  const headers = {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': '*',
    'cache-control': 'no-store, no-cache, must-revalidate',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (request.method === 'GET') {
    const roomId = url.searchParams.get('room') || 'default';
    const since = parseInt(url.searchParams.get('since') || '0', 10);

    const room = roomStore.get(roomId);
    if (!room) {
      return new Response(JSON.stringify({ events: [], state: null }), { headers });
    }

    // Clean up events older than 60 seconds
    const now = Date.now();
    room.events = room.events.filter((e) => now - e._ts < 60000);

    const newEvents = room.events.filter((e) => e._ts > since);
    return new Response(JSON.stringify({
      events: newEvents.map((e) => e.data),
      state: room.playbackState,
      members: Array.from(room.members.values()),
    }), { headers });
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const roomId = body.roomId || 'default';
      const message = body.message;
      const senderId = body.senderId;

      if (!roomStore.has(roomId)) {
        roomStore.set(roomId, {
          events: [],
          playbackState: null,
          members: new Map(),
        });
      }

      const room = roomStore.get(roomId);
      const now = Date.now();

      if (message) {
        room.events.push({ _ts: now, data: message });
        if (room.events.length > 50) room.events.shift();

        if (message.type === 'PLAYBACK_STATE') {
          room.playbackState = message.payload;
        } else if (message.type === 'JOIN_ROOM' && message.user) {
          room.members.set(message.user.id, message.user);
        } else if (message.type === 'USER_UPDATE' && message.payload?.id) {
          const m = room.members.get(message.payload.id);
          if (m) m.name = message.payload.name;
        }
      }

      return new Response(JSON.stringify({ ok: true }), { headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 400, headers });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
}
