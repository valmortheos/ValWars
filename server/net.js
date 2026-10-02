const { WebSocketServer } = require('ws');
const auth = require('./auth');
const roomManager = require('./room');
const matchManager = require('./match');

function setupWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');

    const session = auth.validateSession(token);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.user = session; // { userId, username }
      ws.isAlive = true;
      ws.currentRoomCode = null;
      wss.emit('connection', ws, request);
    });
  });

  // Heartbeat ping/pong interval 15s
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 15000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (ws) => {
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message, isBinary) => {
      if (isBinary) {
        // Binary message from client (Player Input Packet: 9 bytes)
        if (ws.currentRoomCode) {
          const room = roomManager.getRoom(ws.currentRoomCode);
          if (room && room.match) {
            room.match.handlePlayerInputBuffer(ws.user.userId, message);
          }
        }
        return;
      }

      // JSON Control Message
      try {
        const data = JSON.parse(message.toString());
        handleJsonMessage(ws, data);
      } catch (err) {
        console.error('WS JSON parse error:', err.message);
      }
    });

    ws.on('close', () => {
      handleDisconnect(ws);
    });

    // Send initial rooms list
    sendWsJson(ws, {
      type: 'ROOM_LIST',
      rooms: roomManager.getPublicRoomsList()
    });
  });

  function sendWsJson(ws, obj) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(obj));
    }
  }

  function handleJsonMessage(ws, data) {
    const { type, payload } = data;

    switch (type) {
      case 'GET_ROOMS': {
        sendWsJson(ws, {
          type: 'ROOM_LIST',
          rooms: roomManager.getPublicRoomsList()
        });
        break;
      }

      case 'CREATE_ROOM': {
        if (ws.currentRoomCode) {
          return sendWsJson(ws, { type: 'ERROR', message: 'Anda sudah berada di dalam room.' });
        }
        const { mode, mapId } = payload || {};
        const room = roomManager.createRoom(ws.user, mode, mapId);
        const playerObj = room.addPlayer(ws.user, ws);
        ws.currentRoomCode = room.code;

        sendWsJson(ws, { type: 'ROOM_JOINED', room: room.getLobbyData(), myUserId: ws.user.userId });
        broadcastRoomListToAll();
        break;
      }

      case 'JOIN_ROOM': {
        if (ws.currentRoomCode) {
          return sendWsJson(ws, { type: 'ERROR', message: 'Anda sudah berada di dalam room.' });
        }
        const { code } = payload || {};
        const room = roomManager.getRoom(code);
        if (!room) {
          return sendWsJson(ws, { type: 'ERROR', message: 'Room tidak ditemukan.' });
        }
        try {
          room.addPlayer(ws.user, ws);
          ws.currentRoomCode = room.code;
          sendWsJson(ws, { type: 'ROOM_JOINED', room: room.getLobbyData(), myUserId: ws.user.userId });
          room.broadcast({ type: 'ROOM_UPDATED', room: room.getLobbyData() });
          broadcastRoomListToAll();
        } catch (err) {
          sendWsJson(ws, { type: 'ERROR', message: err.message });
        }
        break;
      }

      case 'LEAVE_ROOM': {
        if (!ws.currentRoomCode) return;
        const room = roomManager.getRoom(ws.currentRoomCode);
        if (room) {
          const remaining = room.removePlayer(ws.user.userId);
          ws.currentRoomCode = null;
          sendWsJson(ws, { type: 'ROOM_LEFT' });

          if (remaining === 0) {
            if (room.match) room.match.stop();
            roomManager.deleteRoom(room.code);
          } else {
            room.broadcast({ type: 'ROOM_UPDATED', room: room.getLobbyData() });
          }
          broadcastRoomListToAll();
        }
        break;
      }

      case 'TOGGLE_READY': {
        if (!ws.currentRoomCode) return;
        const room = roomManager.getRoom(ws.currentRoomCode);
        if (room && room.status === 'lobby') {
          const player = room.players.get(ws.user.userId);
          if (player) {
            room.setReady(ws.user.userId, !player.ready);
            room.broadcast({ type: 'ROOM_UPDATED', room: room.getLobbyData() });
          }
        }
        break;
      }

      case 'UPDATE_ROOM_SETTINGS': {
        if (!ws.currentRoomCode) return;
        const room = roomManager.getRoom(ws.currentRoomCode);
        if (room && room.hostUserId === ws.user.userId && room.status === 'lobby') {
          const { mode, mapId } = payload || {};
          room.setSettings(mode, mapId);
          room.broadcast({ type: 'ROOM_UPDATED', room: room.getLobbyData() });
          broadcastRoomListToAll();
        }
        break;
      }

      case 'START_MATCH': {
        if (!ws.currentRoomCode) return;
        const room = roomManager.getRoom(ws.currentRoomCode);
        if (!room) return;
        if (room.hostUserId !== ws.user.userId) {
          return sendWsJson(ws, { type: 'ERROR', message: 'Hanya host yang dapat memulai pertandingan.' });
        }
        if (room.status !== 'lobby') {
          return sendWsJson(ws, { type: 'ERROR', message: 'Pertandingan sudah berjalan.' });
        }

        // Check if all players are ready
        for (const p of room.players.values()) {
          if (!p.ready) {
            return sendWsJson(ws, { type: 'ERROR', message: 'Semua pemain harus dalam keadaan SIAP.' });
          }
        }

        room.status = 'playing';
        const match = matchManager.createMatch(room, () => {
          // On match end callback
          room.status = 'lobby';
          room.match = null;
          room.broadcast({ type: 'MATCH_ENDED', room: room.getLobbyData() });
          broadcastRoomListToAll();
        });
        room.match = match;
        match.start();

        room.broadcast({
          type: 'MATCH_STARTED',
          map: roomManager.MAPS[room.mapId],
          mode: room.mode,
          players: Array.from(room.players.values()).map(p => ({
            userId: p.userId,
            username: p.username,
            team: p.team,
            slot: p.slot
          }))
        });
        broadcastRoomListToAll();
        break;
      }

      case 'CHAT_MESSAGE': {
        if (!ws.currentRoomCode) return;
        const room = roomManager.getRoom(ws.currentRoomCode);
        if (room && payload && typeof payload.text === 'string') {
          room.broadcast({
            type: 'CHAT_MESSAGE',
            username: ws.user.username,
            text: payload.text.substring(0, 100)
          });
        }
        break;
      }
    }
  }

  function handleDisconnect(ws) {
    if (ws.currentRoomCode) {
      const room = roomManager.getRoom(ws.currentRoomCode);
      if (room) {
        if (room.match) {
          room.match.handlePlayerDisconnect(ws.user.userId);
        }
        const remaining = room.removePlayer(ws.user.userId);
        if (remaining === 0) {
          if (room.match) room.match.stop();
          roomManager.deleteRoom(room.code);
        } else {
          room.broadcast({ type: 'ROOM_UPDATED', room: room.getLobbyData() });
        }
        broadcastRoomListToAll();
      }
    }
  }

  function broadcastRoomListToAll() {
    const list = roomManager.getPublicRoomsList();
    const payload = JSON.stringify({ type: 'ROOM_LIST', rooms: list });
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && !client.currentRoomCode) {
        client.send(payload);
      }
    });
  }
}

module.exports = { setupWebSocket };
