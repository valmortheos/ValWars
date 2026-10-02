/**
 * Binary State Serializer & Deserializer
 *
 * Client Input Packet (9 bytes):
 * - Uint8 sequence (1 byte)
 * - Float32 moveAngle (4 bytes) - -1 if no movement
 * - Uint8 moveMagnitude (1 byte) - 0 to 100
 * - Uint8 actions (1 byte) - Bitmask: 1=FIRE, 2=RELOAD, 4=GRENADE
 * - Uint16 aimAngle (2 bytes) - Angle in degrees * 100 (0 to 36000)
 *
 * Server State Packet (Binary ArrayBuffer):
 * - Header (8 bytes):
 *   - Uint8 type (1 byte) = 0x01 (STATE)
 *   - Uint16 tick (2 bytes)
 *   - Uint16 matchTimeRemaining (2 bytes)
 *   - Uint8 redScore (1 byte)
 *   - Uint8 blueScore (1 byte)
 *   - Uint8 playerCount (1 byte)
 *
 * - Per Player (16 bytes each):
 *   - Uint8 slot (1 byte)
 *   - Int16 x (2 bytes) - Position X * 100
 *   - Int16 z (2 bytes) - Position Z * 100
 *   - Uint16 aimAngle (2 bytes) - Angle * 100
 *   - Uint8 hp (1 byte) - 0-100
 *   - Uint8 ammo (1 byte) - 0-30
 *   - Uint8 stateFlags (1 byte) - Bit 0: alive, Bit 1: reloading, Bit 2: firing
 *   - Uint16 kills (2 bytes)
 *   - Uint16 deaths (2 bytes)
 *   - Uint16 reserve (2 bytes)
 */

function parsePlayerInputBuffer(buffer) {
  if (!(buffer instanceof ArrayBuffer) && !Buffer.isBuffer(buffer)) {
    return null;
  }
  if (buffer.byteLength < 9) return null;

  const view = new DataView(buffer.buffer || buffer, buffer.byteOffset || 0, buffer.byteLength);
  const sequence = view.getUint8(0);
  const moveAngle = view.getFloat32(1, true); // Little endian
  const moveMag = view.getUint8(5) / 100.0;
  const actions = view.getUint8(6);
  const aimAngle = view.getUint16(7, true) / 100.0;

  return {
    sequence,
    moveAngle,
    moveMag,
    fire: (actions & 1) !== 0,
    reload: (actions & 2) !== 0,
    grenade: (actions & 4) !== 0,
    aimAngle
  };
}

function serializeGameState(tick, matchTimeRemaining, redScore, blueScore, players) {
  const HEADER_SIZE = 8;
  const PLAYER_SIZE = 16;
  const totalSize = HEADER_SIZE + (players.length * PLAYER_SIZE);

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Header
  view.setUint8(0, 0x01); // State type
  view.setUint16(1, tick % 65536, true);
  view.setUint16(3, Math.max(0, Math.floor(matchTimeRemaining)), true);
  view.setUint8(5, Math.min(255, redScore));
  view.setUint8(6, Math.min(255, blueScore));
  view.setUint8(7, players.length);

  let offset = HEADER_SIZE;
  for (const p of players) {
    view.setUint8(offset, p.slot);
    view.setInt16(offset + 1, Math.round(p.x * 100), true);
    view.setInt16(offset + 3, Math.round(p.z * 100), true);
    view.setUint16(offset + 5, Math.round(p.aimAngle * 100) % 36000, true);
    view.setUint8(offset + 7, Math.max(0, Math.min(100, Math.round(p.hp))));
    view.setUint8(offset + 8, Math.max(0, Math.min(255, p.ammo)));

    let flags = 0;
    if (p.alive) flags |= 1;
    if (p.reloading) flags |= 2;
    if (p.firing) flags |= 4;
    view.setUint8(offset + 9, flags);

    view.setUint16(offset + 10, p.kills, true);
    view.setUint16(offset + 12, p.deaths, true);
    view.setUint16(offset + 14, 0, true); // reserve

    offset += PLAYER_SIZE;
  }

  return buffer;
}

module.exports = {
  parsePlayerInputBuffer,
  serializeGameState
};
