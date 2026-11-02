// @ts-check
import crypto from 'node:crypto';
import { URL } from 'node:url';

/**
 * @typedef {Object} Member
 * @property {string} id
 * @property {string} name
 * @property {boolean} isHost
 * @property {string} color
 * @property {number} joinedAt
 */

/**
 * In-memory rooms cache
 * Map<string, { members: Map<string, { socket: any, member: Member }>, playbackState: any, messages: any[], createdAt: number }>
 */
const rooms = new Map();

export function getRooms() {
  return rooms;
}

export function getRoom(roomId) {
  return rooms.get(roomId);
}

export function clearRooms() {
  rooms.clear();
}

/**
 * Encodes a text/JSON message into an RFC 6455 unmasked WebSocket frame
 * @param {string|object} data
 * @returns {Buffer}
 */
export function encodeWsFrame(data) {
  const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = len;
  } else if (len <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

/**
 * Encodes a pong frame
 */
function encodePongFrame(payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(2);
  header[0] = 0x8a; // FIN + pong opcode (0xa)
  header[1] = payload.length;
  return Buffer.concat([header, payload]);
}

/**
 * Parses incoming RFC 6455 WebSocket frames from client
 * @param {Buffer} buffer
 * @param {(msg: { opcode: number, text?: string, payload?: Buffer }) => void} onMessage
 * @returns {Buffer} Remaining unconsumed buffer
 */
export function parseWsFrames(buffer, onMessage) {
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const opcode = firstByte & 0x0f;
    const secondByte = buffer[offset + 1];
    const isMasked = (secondByte & 0x80) !== 0;
    let payloadLen = secondByte & 0x7f;
    let headerLen = 2;

    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }

    const maskOffset = offset + headerLen;
    if (isMasked) {
      headerLen += 4;
    }

    if (offset + headerLen + payloadLen > buffer.length) {
      break; // Incomplete frame
    }

    const payload = Buffer.from(buffer.subarray(offset + headerLen, offset + headerLen + payloadLen));
    if (isMasked) {
      const mask = buffer.subarray(maskOffset, maskOffset + 4);
      for (let i = 0; i < payloadLen; i++) {
        payload[i] ^= mask[i % 4];
      }
    }

    offset += headerLen + payloadLen;

    if (opcode === 0x1) {
      try {
        onMessage({ opcode, text: payload.toString('utf8') });
      } catch {}
    } else if (opcode === 0x8) {
      onMessage({ opcode: 0x8 });
    } else if (opcode === 0x9) {
      onMessage({ opcode: 0x9, payload });
    } else if (opcode === 0xa) {
      onMessage({ opcode: 0xa, payload });
    }
  }

  return buffer.subarray(offset);
}

/**
 * Broadcasts a message to all members in a room (optionally excluding one)
 */
export function broadcastToRoom(roomId, message, excludeSocket = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  const frame = encodeWsFrame(message);
  for (const client of room.members.values()) {
    if (client.socket !== excludeSocket && !client.socket.destroyed) {
      try {
        client.socket.write(frame);
      } catch {}
    }
  }
}

/**
 * Attaches the Watch Party WebSocket handler to an existing HTTP server
 */
export function attachPartyRelay(server) {
  server.on('upgrade', (req, socket, head) => {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (reqUrl.pathname !== '/party-ws') {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    // Handshake
    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    // Initial query params
    const roomId = reqUrl.searchParams.get('room') || 'AH-MAIN';
    const userName = reqUrl.searchParams.get('user') || 'Viewer';
    const userId = reqUrl.searchParams.get('uid') || `usr_${Math.random().toString(36).slice(2, 8)}`;
    const isHost = reqUrl.searchParams.get('host') === '1';

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        roomId,
        members: new Map(),
        playbackState: {
          playing: false,
          time: 0,
          rate: 1,
          timestamp: Date.now(),
          senderId: userId,
        },
        messages: [],
        createdAt: Date.now(),
      });
    }

    const room = rooms.get(roomId);
    const member = {
      id: userId,
      name: userName,
      isHost: isHost || room.members.size === 0,
      color: '#38bdf8',
      joinedAt: Date.now(),
    };

    room.members.set(userId, { socket, member });

    // Send initial room snapshot to newly connected user
    socket.write(
      encodeWsFrame({
        type: 'PLAYBACK_STATE',
        payload: room.playbackState,
      })
    );

    // Broadcast updated member list
    const memberList = Array.from(room.members.values()).map((m) => m.member);
    broadcastToRoom(roomId, {
      type: 'MEMBERS_UPDATE',
      payload: memberList,
    });

    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      buffer = parseWsFrames(buffer, (msg) => {
        if (msg.opcode === 0x8) {
          // Close frame
          socket.end(encodeWsFrame({ type: 'BYE' }));
          return;
        }

        if (msg.opcode === 0x9) {
          // Ping -> respond with pong
          socket.write(encodePongFrame(msg.payload));
          return;
        }

        if (msg.opcode === 0x1 && msg.text) {
          try {
            const data = JSON.parse(msg.text);
            handleClientMessage(roomId, userId, socket, data);
          } catch {}
        }
      });
    });

    const cleanup = () => {
      if (rooms.has(roomId)) {
        const r = rooms.get(roomId);
        r.members.delete(userId);
        if (r.members.size === 0) {
          // Retain room for 15 minutes before dropping
          setTimeout(() => {
            if (rooms.has(roomId) && rooms.get(roomId).members.size === 0) {
              rooms.delete(roomId);
            }
          }, 15 * 60 * 1000);
        } else {
          const updated = Array.from(r.members.values()).map((m) => m.member);
          broadcastToRoom(roomId, {
            type: 'MEMBERS_UPDATE',
            payload: updated,
          });
        }
      }
    };

    socket.on('close', cleanup);
    socket.on('end', cleanup);
    socket.on('error', cleanup);
  });
}

function handleClientMessage(roomId, userId, socket, data) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (data.type === 'PLAYBACK_STATE') {
    room.playbackState = data.payload;
    broadcastToRoom(roomId, data, socket);
  } else if (data.type === 'CHAT_MESSAGE') {
    room.messages.push(data.payload);
    if (room.messages.length > 50) room.messages.shift();
    broadcastToRoom(roomId, data);
  } else if (data.type === 'REACTION') {
    broadcastToRoom(roomId, data);
  } else if (data.type === 'JOIN_ROOM') {
    if (data.user) {
      const client = room.members.get(userId);
      if (client) {
        client.member = { ...client.member, ...data.user };
      }
    }
    const memberList = Array.from(room.members.values()).map((m) => m.member);
    broadcastToRoom(roomId, {
      type: 'MEMBERS_UPDATE',
      payload: memberList,
    });
  }
}
