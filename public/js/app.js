import { showToast, lockOrientation } from './menu/ui.js';
import { NetClient } from './net.js';
import { GameScene } from './game/scene.js';
import { TouchControls } from './game/controls.js';
import { HUD } from './game/hud.js';
import { sfx } from './game/audio.js';
window.sfx = sfx;

class App {
  constructor() {
    this.token = localStorage.getItem('valwars_token');
    this.user = null;
    this.net = new NetClient();
    this.gameScene = null;
    this.controls = null;
    this.hud = new HUD();

    this.currentRoom = null;
    this.myUserId = null;

    this.initDOM();
    this.initEvents();
    this.checkAuth();
  }

  initDOM() {
    this.authScreen = document.getElementById('auth-screen');
    this.lobbyScreen = document.getElementById('lobby-screen');
    this.roomBrowser = document.getElementById('room-browser');
    this.roomLobby = document.getElementById('room-lobby');
    this.gameContainer = document.getElementById('game-container');
    this.menuContainer = document.getElementById('menu-container');
    this.orientationOverlay = document.getElementById('orientation-overlay');

    // Auth tabs
    this.tabLogin = document.getElementById('tab-login');
    this.tabRegister = document.getElementById('tab-register');
    this.authForm = document.getElementById('auth-form');
    this.authSubmitBtn = document.getElementById('auth-submit-btn');
    this.isRegisterMode = false;

    // Room elements
    this.roomList = document.getElementById('room-list');
    this.joinCodeInput = document.getElementById('join-code-input');
    this.lobbyPlayersList = document.getElementById('lobby-players-list');
    this.hostSettings = document.getElementById('host-settings');
    this.selectMode = document.getElementById('select-mode');
    this.selectMap = document.getElementById('select-map');
    this.startGameBtn = document.getElementById('start-game-btn');
    this.readyToggleBtn = document.getElementById('ready-toggle-btn');
  }

  initEvents() {
    // Prevent context menu
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // Prevent default touch gestures (pinch/double-tap)
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    }, { passive: false });

    // Orientation change check
    window.addEventListener('resize', () => this.checkOrientation());
    window.addEventListener('orientationchange', () => this.checkOrientation());

    // Auth tab toggles
    this.tabLogin.addEventListener('click', () => this.setAuthMode(false));
    this.tabRegister.addEventListener('click', () => this.setAuthMode(true));

    // Auth form submit
    this.authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAuthSubmit();
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());

    // Fullscreen Toggle
    const fsBtn = document.getElementById('fullscreen-btn');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().then(() => {
            lockOrientation('landscape');
          }).catch(err => console.log('Fullscreen error:', err));
        } else {
          document.exitFullscreen().catch(err => console.log('Exit Fullscreen error:', err));
        }
      });
    }

    // Room buttons
    document.getElementById('refresh-rooms-btn').addEventListener('click', () => {
      this.net.sendJson('GET_ROOMS');
    });

    document.getElementById('create-room-btn').addEventListener('click', () => {
      this.net.sendJson('CREATE_ROOM', { mode: '1v1', mapId: 'arena' });
    });

    document.getElementById('join-room-btn').addEventListener('click', () => {
      const code = this.joinCodeInput.value.trim();
      if (code.length === 4) {
        this.net.sendJson('JOIN_ROOM', { code });
      } else {
        showToast('Masukkan 4 digit kode room');
      }
    });

    document.getElementById('leave-room-btn').addEventListener('click', () => {
      this.net.sendJson('LEAVE_ROOM');
    });

    this.readyToggleBtn.addEventListener('click', () => {
      this.net.sendJson('TOGGLE_READY');
    });

    this.startGameBtn.addEventListener('click', () => {
      this.net.sendJson('START_MATCH');
    });

    this.selectMode.addEventListener('change', () => this.sendRoomSettings());
    this.selectMap.addEventListener('change', () => this.sendRoomSettings());

    // Network Event Listeners
    this.net.on('connected', () => {
      showToast('Terhubung ke server');
    });

    this.net.on('disconnected', () => {
      showToast('Koneksi terputus. Mencoba reconnect...');
    });

    this.net.on('ERROR', (msg) => {
      showToast(msg.message || 'Terjadi kesalahan');
    });

    this.net.on('ROOM_LIST', (msg) => {
      this.renderRoomList(msg.rooms);
    });

    this.net.on('ROOM_JOINED', (msg) => {
      this.currentRoom = msg.room;
      this.myUserId = msg.myUserId;
      this.renderLobby();
    });

    this.net.on('ROOM_UPDATED', (msg) => {
      this.currentRoom = msg.room;
      this.renderLobby();
    });

    this.net.on('ROOM_LEFT', () => {
      this.currentRoom = null;
      this.roomLobby.classList.add('hidden');
      this.roomBrowser.classList.remove('hidden');
    });

    this.net.on('MATCH_STARTED', (msg) => {
      this.startMatchView(msg);
    });

    this.net.on('MATCH_ENDED', (msg) => {
      this.endMatchView();
      showToast('Pertandingan telah berakhir');
    });

    this.net.on('EVENT_SHOT', (msg) => {
      if (this.gameScene) this.gameScene.drawTracer(msg);
      sfx.playShoot();
      if (msg.hit) sfx.playDamage();
    });

    this.net.on('EVENT_GRENADE_THROWN', (msg) => {
      if (this.gameScene) this.gameScene.spawnGrenade(msg);
    });

    this.net.on('EVENT_GRENADE_EXPLODE', (msg) => {
      if (this.gameScene) this.gameScene.explodeGrenade(msg);
      sfx.playExplosion();
    });

    this.net.on('EVENT_KILL', (msg) => {
      this.hud.addKillFeed(`${msg.killerName} -> ${msg.victimName}`);
    });
  }

  setAuthMode(isRegister) {
    this.isRegisterMode = isRegister;
    if (isRegister) {
      this.tabRegister.classList.add('active');
      this.tabLogin.classList.remove('active');
      this.authSubmitBtn.innerText = 'Daftar';
    } else {
      this.tabLogin.classList.add('active');
      this.tabRegister.classList.remove('active');
      this.authSubmitBtn.innerText = 'Masuk';
    }
  }

  async checkAuth() {
    if (!this.token) {
      this.showAuthView();
      return;
    }

    try {
      const res = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const data = await res.json();
      if (data.success) {
        this.user = data.user;
        this.showLobbyView();
      } else {
        this.showAuthView();
      }
    } catch (err) {
      this.showAuthView();
    }
  }

  showAuthView() {
    this.authScreen.classList.remove('hidden');
    this.lobbyScreen.classList.add('hidden');
    this.gameContainer.classList.add('hidden');
    lockOrientation('portrait');
  }

  showLobbyView() {
    this.authScreen.classList.add('hidden');
    this.lobbyScreen.classList.remove('hidden');
    document.getElementById('user-name').innerText = this.user.username;
    document.getElementById('user-avatar').innerText = this.user.username[0].toUpperCase();

    lockOrientation('portrait');
    this.net.connect(this.token);
  }

  async handleAuthSubmit() {
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    const endpoint = this.isRegisterMode ? '/api/register' : '/api/login';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success) {
        this.token = data.token;
        this.user = data.user;
        localStorage.setItem('valwars_token', this.token);
        this.showLobbyView();
      } else {
        showToast(data.error || 'Gagal memproses autentikasi');
      }
    } catch (err) {
      showToast('Gagal terhubung ke server');
    }
  }

  async handleLogout() {
    if (this.token) {
      fetch('/api/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` }
      }).catch(() => {});
    }
    this.net.disconnect();
    localStorage.removeItem('valwars_token');
    this.token = null;
    this.user = null;
    this.showAuthView();
  }

  renderRoomList(rooms) {
    if (!rooms || rooms.length === 0) {
      this.roomList.innerHTML = '<div style="text-align: center; color: var(--text-muted); margin-top: 20px;">Belum ada room aktif</div>';
      return;
    }

    this.roomList.innerHTML = rooms.map(r => `
      <div class="room-item">
        <div>
          <div class="room-code">#${r.code}</div>
          <div class="room-meta">Mode: ${r.mode} | Map: ${r.mapId}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 13px; font-weight: 600;">${r.playerCount}/${r.maxPlayers}</span>
          <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="window.app.joinRoom('${r.code}')">Join</button>
        </div>
      </div>
    `).join('');
  }

  joinRoom(code) {
    this.net.sendJson('JOIN_ROOM', { code });
  }

  renderLobby() {
    if (!this.currentRoom) return;

    this.roomBrowser.classList.add('hidden');
    this.roomLobby.classList.remove('hidden');

    document.getElementById('lobby-code-display').innerText = this.currentRoom.code;
    document.getElementById('player-count').innerText = `${this.currentRoom.players.length}/${this.currentRoom.maxPlayers}`;

    const isHost = this.currentRoom.hostUserId === this.myUserId;
    if (isHost) {
      this.hostSettings.classList.remove('hidden');
      this.selectMode.value = this.currentRoom.mode;
      this.selectMap.value = this.currentRoom.mapId;
      this.startGameBtn.classList.remove('hidden');
    } else {
      this.hostSettings.classList.add('hidden');
      this.startGameBtn.classList.add('hidden');
    }

    this.lobbyPlayersList.innerHTML = this.currentRoom.players.map(p => `
      <div class="player-slot">
        <div>
          <span style="font-weight: 600; font-size: 14px;">${p.username} ${p.isHost ? '👑' : ''}</span>
          <span class="player-team-tag team-${p.team}">${p.team}</span>
        </div>
        <span style="font-size: 12px; font-weight: 700; color: ${p.ready ? 'var(--success-color)' : 'var(--text-muted)'}">
          ${p.ready ? 'SIAP' : 'BELUM SIAP'}
        </span>
      </div>
    `).join('');
  }

  sendRoomSettings() {
    this.net.sendJson('UPDATE_ROOM_SETTINGS', {
      mode: this.selectMode.value,
      mapId: this.selectMap.value
    });
  }

  async startMatchView(msg) {
    this.menuContainer.classList.add('hidden');
    this.gameContainer.classList.remove('hidden');

    lockOrientation('landscape');
    this.checkOrientation();

    if (!this.gameScene) {
      this.gameScene = new GameScene(document.getElementById('game-canvas'));
      await this.gameScene.init();
    }

    // Determine local player slot from players list in MATCH_STARTED event
    let localSlot = null;
    if (msg.players && Array.isArray(msg.players)) {
      const me = msg.players.find(p => p.userId === this.myUserId);
      if (me) localSlot = me.slot;
    }

    this.gameScene.setLocalPlayer(localSlot, msg.players);
    this.gameScene.loadMap(msg.map);

    this.controls = new TouchControls(
      document.getElementById('joystick-zone'),
      document.getElementById('joystick-thumb'),
      document.getElementById('btn-fire'),
      document.getElementById('btn-reload'),
      document.getElementById('btn-grenade'),
      this.net
    );

    this.net.setBinaryListener((buffer) => {
      const state = this.gameScene.updateState(buffer, this.myUserId);
      if (state) {
        this.hud.update(state, this.myUserId);
      }
    });
  }

  endMatchView() {
    if (this.controls) {
      this.controls.destroy();
      this.controls = null;
    }
    this.net.setBinaryListener(null);
    this.gameContainer.classList.add('hidden');
    this.menuContainer.classList.remove('hidden');

    lockOrientation('portrait');
    this.checkOrientation();
  }

  checkOrientation() {
    const isLandscape = window.innerWidth > window.innerHeight;
    const isGameActive = !this.gameContainer.classList.contains('hidden');

    if (isGameActive && !isLandscape) {
      this.orientationOverlay.classList.remove('hidden');
    } else {
      this.orientationOverlay.classList.add('hidden');
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
