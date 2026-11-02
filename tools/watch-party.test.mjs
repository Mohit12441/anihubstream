// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRoomCode,
  normalizeRoomCode,
  calculateDrift,
  shouldSync,
  getMemberColor,
  PARTY_EMOJIS,
} from '../src/lib/watchParty.ts';
import {
  encodeWsFrame,
  parseWsFrames,
  getRooms,
  clearRooms,
} from '../api/party-relay.mjs';

test('Watch Party Room Codes', () => {
  const code = generateRoomCode();
  assert.match(code, /^AH-[2-9A-Z]{4}$/, 'Room code should match format AH-XXXX');

  assert.equal(normalizeRoomCode('ah-8x2q'), 'AH-8X2Q');
  assert.equal(normalizeRoomCode('8x2q'), 'AH-8X2Q');
  assert.equal(normalizeRoomCode('  AH-9K3L  '), 'AH-9K3L');
  assert.equal(normalizeRoomCode(''), '');
});

test('Playback Drift and Sync Compensation', () => {
  const now = 1000000;
  
  // Paused state drift
  const pausedState = {
    playing: false,
    time: 120.0,
    rate: 1,
    timestamp: now - 5000,
    senderId: 'host_1',
  };
  
  // Local is at 120.5 -> 0.5s drift
  assert.equal(calculateDrift(120.5, pausedState, now), 0.5);
  assert.equal(shouldSync(calculateDrift(120.5, pausedState, now)), false);

  // Local is at 122.5 -> 2.5s drift -> should sync
  assert.equal(calculateDrift(122.5, pausedState, now), 2.5);
  assert.equal(shouldSync(calculateDrift(122.5, pausedState, now)), true);

  // Playing state drift
  // Remote was at 50s, 10s elapsed at 1.0x -> expected remote is 60s
  const playingState = {
    playing: true,
    time: 50.0,
    rate: 1.0,
    timestamp: now - 10000, // 10s ago
    senderId: 'host_1',
  };

  const driftPlaying = calculateDrift(60.2, playingState, now);
  assert.ok(Math.abs(driftPlaying - 0.2) < 0.001);
  assert.equal(shouldSync(driftPlaying), false);

  const driftLagging = calculateDrift(57.0, playingState, now);
  assert.ok(Math.abs(driftLagging - (-3.0)) < 0.001);
  assert.equal(shouldSync(driftLagging), true);
});

test('Member Avatar Colors & Emojis', () => {
  const color1 = getMemberColor('user_123');
  const color2 = getMemberColor('user_123');
  assert.equal(color1, color2, 'Color derivation must be deterministic');
  assert.ok(color1.startsWith('#'));

  assert.ok(PARTY_EMOJIS.length >= 6);
  assert.ok(PARTY_EMOJIS.includes('🔥'));
});

test('RFC 6455 Frame Encoding & Decoding', () => {
  const text = JSON.stringify({ type: 'CHAT_MESSAGE', payload: { text: 'Hello Party!' } });
  const frame = encodeWsFrame(text);

  assert.ok(frame.length > text.length);
  assert.equal(frame[0], 0x81); // FIN + text opcode

  // Simulate masked client frame
  const clientPayload = Buffer.from(text);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const maskedPayload = Buffer.alloc(clientPayload.length);
  for (let i = 0; i < clientPayload.length; i++) {
    maskedPayload[i] = clientPayload[i] ^ mask[i % 4];
  }

  const clientHeader = Buffer.alloc(2);
  clientHeader[0] = 0x81;
  clientHeader[1] = 0x80 | clientPayload.length; // MASK = 1

  const fullClientFrame = Buffer.concat([clientHeader, mask, maskedPayload]);

  let receivedMessage = null;
  const remaining = parseWsFrames(fullClientFrame, (msg) => {
    receivedMessage = msg;
  });

  assert.equal(remaining.length, 0);
  assert.ok(receivedMessage);
  assert.equal(receivedMessage.opcode, 1);
  assert.equal(receivedMessage.text, text);
});

test('Party Relay In-Memory Rooms State', () => {
  clearRooms();
  const rooms = getRooms();
  assert.equal(rooms.size, 0);
});
