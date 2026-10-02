const MAPS = {
  arena: {
    id: 'arena',
    name: 'Arena Simple',
    width: 40,
    depth: 40,
    obstacles: [
      // Central cover
      { x: 0, z: 0, w: 6, d: 6, h: 2.5 },
      // Corner blocks
      { x: -10, z: -10, w: 4, d: 8, h: 2 },
      { x: 10, z: 10, w: 4, d: 8, h: 2 },
      { x: -10, z: 10, w: 8, d: 4, h: 2 },
      { x: 10, z: -10, w: 8, d: 4, h: 2 },
      // Flank barriers
      { x: -15, z: 0, w: 3, d: 10, h: 2 },
      { x: 15, z: 0, w: 3, d: 10, h: 2 },
      { x: 0, z: -15, w: 10, d: 3, h: 2 },
      { x: 0, z: 15, w: 10, d: 3, h: 2 }
    ]
  },
  kota: {
    id: 'kota',
    name: 'Kota Perkotaan',
    width: 50,
    depth: 50,
    obstacles: [
      // City buildings (blocks forming streets)
      { x: -12, z: -12, w: 10, d: 10, h: 3 },
      { x: 12, z: -12, w: 10, d: 10, h: 3 },
      { x: -12, z: 12, w: 10, d: 10, h: 3 },
      { x: 12, z: 12, w: 10, d: 10, h: 3 },
      // Street barriers & vehicles
      { x: 0, z: -8, w: 6, d: 3, h: 1.8 },
      { x: 0, z: 8, w: 6, d: 3, h: 1.8 },
      { x: -8, z: 0, w: 3, d: 6, h: 1.8 },
      { x: 8, z: 0, w: 3, d: 6, h: 1.8 },
      // Outer walls
      { x: -20, z: 0, w: 2, d: 16, h: 2.5 },
      { x: 20, z: 0, w: 2, d: 16, h: 2.5 }
    ]
  },
  gurun: {
    id: 'gurun',
    name: 'Gurun Pasir',
    width: 60,
    depth: 60,
    obstacles: [
      // Rock formations and dunes
      { x: 0, z: -12, w: 8, d: 8, h: 2 },
      { x: 0, z: 12, w: 8, d: 8, h: 2 },
      { x: -15, z: -15, w: 12, d: 6, h: 2.5 },
      { x: 15, z: 15, w: 12, d: 6, h: 2.5 },
      { x: -15, z: 15, w: 6, d: 12, h: 2.5 },
      { x: 15, z: -15, w: 6, d: 12, h: 2.5 },
      // Scattered cover rocks
      { x: -5, z: 0, w: 4, d: 4, h: 1.5 },
      { x: 5, z: 0, w: 4, d: 4, h: 1.5 },
      { x: 0, z: -5, w: 4, d: 4, h: 1.5 },
      { x: 0, z: 5, w: 4, d: 4, h: 1.5 }
    ]
  }
};

const MODE_MAX_PLAYERS = {
  '1v1': 2,
  '2v2': 4,
  '3v3': 6,
  '4v4': 8,
  'FFA': 8
};

const rooms = new Map(); // code -> Room object

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));
  return code;
}

class Room {
  constructor(code, hostUserId, hostUsername, mode = '1v1', mapId = 'arena') {
    this.code = code;
    this.hostUserId = hostUserId;
    this.mode = MODE_MAX_PLAYERS[mode] ? mode : '1v1';
    this.mapId = MAPS[mapId] ? mapId : 'arena';
    this.maxPlayers = MODE_MAX_PLAYERS[this.mode];
    this.players = new Map(); // userId -> { userId, username, ws, ready, team, slot }
    this.status = 'lobby'; // 'lobby' | 'playing'
    this.match = null; // Match instance when playing
    this.createdAt = Date.now();
  }

  addPlayer(user, ws) {
    if (this.players.size >= this.maxPlayers) {
      throw new Error('Room sudah penuh.');
    }
    if (this.status === 'playing') {
      throw new Error('Game sedang berlangsung.');
    }

    // Determine team assignment
    let team = 'red';
    if (this.mode === 'FFA') {
      team = `player_${this.players.size + 1}`;
    } else {
      let redCount = 0;
      let blueCount = 0;
      for (const p of this.players.values()) {
        if (p.team === 'red') redCount++;
        if (p.team === 'blue') blueCount++;
      }
      team = redCount <= blueCount ? 'red' : 'blue';
    }

    const playerObj = {
      userId: user.userId,
      username: user.username,
      ws,
      ready: user.userId === this.hostUserId, // Host is auto-ready
      team,
      slot: this.players.size
    };

    this.players.set(user.userId, playerObj);
    return playerObj;
  }

  removePlayer(userId) {
    const p = this.players.get(userId);
    if (p) {
      this.players.delete(userId);
      // Transfer host if host leaves
      if (this.hostUserId === userId && this.players.size > 0) {
        const nextHost = this.players.values().next().value;
        this.hostUserId = nextHost.userId;
        nextHost.ready = true;
      }
    }
    return this.players.size;
  }

  setReady(userId, readyState) {
    const p = this.players.get(userId);
    if (p) {
      p.ready = readyState;
    }
  }

  setSettings(mode, mapId) {
    if (MODE_MAX_PLAYERS[mode]) {
      this.mode = mode;
      this.maxPlayers = MODE_MAX_PLAYERS[mode];
    }
    if (MAPS[mapId]) {
      this.mapId = mapId;
    }
    // Re-assign teams
    let idx = 0;
    for (const p of this.players.values()) {
      if (this.mode === 'FFA') {
        p.team = `player_${idx + 1}`;
      } else {
        p.team = idx % 2 === 0 ? 'red' : 'blue';
      }
      idx++;
    }
  }

  getLobbyData() {
    return {
      code: this.code,
      hostUserId: this.hostUserId,
      mode: this.mode,
      mapId: this.mapId,
      maxPlayers: this.maxPlayers,
      status: this.status,
      players: Array.from(this.players.values()).map(p => ({
        userId: p.userId,
        username: p.username,
        ready: p.ready,
        team: p.team,
        isHost: p.userId === this.hostUserId
      }))
    };
  }

  broadcast(messageObj) {
    const data = JSON.stringify(messageObj);
    for (const p of this.players.values()) {
      if (p.ws && p.ws.readyState === 1) { // WebSocket.OPEN
        p.ws.send(data);
      }
    }
  }
}

function createRoom(hostUser, mode, mapId) {
  const code = generateRoomCode();
  const room = new Room(code, hostUser.userId, hostUser.username, mode, mapId);
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code);
}

function deleteRoom(code) {
  rooms.delete(code);
}

function getPublicRoomsList() {
  const list = [];
  for (const room of rooms.values()) {
    if (room.status === 'lobby') {
      list.push({
        code: room.code,
        mode: room.mode,
        mapId: room.mapId,
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers
      });
    }
  }
  return list;
}

module.exports = {
  MAPS,
  MODE_MAX_PLAYERS,
  createRoom,
  getRoom,
  deleteRoom,
  getPublicRoomsList,
  Room
};
