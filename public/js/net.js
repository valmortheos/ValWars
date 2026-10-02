/**
 * Network Manager with Exponential Backoff Auto-Reconnect
 */
export class NetClient {
  constructor() {
    this.ws = null;
    this.token = null;
    this.reconnectAttempt = 0;
    this.maxBackoffMs = 10000;
    this.eventListeners = new Map();
    this.binaryListener = null;
    this.isExplicitDisconnect = false;
  }

  connect(token) {
    this.token = token;
    this.isExplicitDisconnect = false;

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        return;
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}?token=${encodeURIComponent(token)}`;

    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      console.log('WS Connected');
      this.reconnectAttempt = 0;
      this.emit('connected');
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        if (this.binaryListener) {
          this.binaryListener(event.data);
        }
      } else {
        try {
          const msg = JSON.parse(event.data);
          this.emit(msg.type, msg);
        } catch (e) {
          console.error('WS parse error', e);
        }
      }
    };

    this.ws.onerror = (err) => {
      console.error('WS Error:', err);
    };

    this.ws.onclose = () => {
      console.log('WS Closed');
      this.emit('disconnected');
      if (!this.isExplicitDisconnect) {
        this.scheduleReconnect();
      }
    };
  }

  scheduleReconnect() {
    this.reconnectAttempt++;
    // Exponential backoff: 1s, 2s, 4s, 8s, max 10s
    const backoff = Math.min(this.maxBackoffMs, Math.pow(2, this.reconnectAttempt - 1) * 1000);
    console.log(`Reconnecting in ${backoff}ms... (attempt ${this.reconnectAttempt})`);
    setTimeout(() => {
      if (this.token && !this.isExplicitDisconnect) {
        this.connect(this.token);
      }
    }, backoff);
  }

  disconnect() {
    this.isExplicitDisconnect = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendJson(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  sendBinary(arrayBuffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(arrayBuffer);
    }
  }

  on(type, callback) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(callback);
  }

  off(type, callback) {
    if (this.eventListeners.has(type)) {
      const list = this.eventListeners.get(type).filter(cb => cb !== callback);
      this.eventListeners.set(type, list);
    }
  }

  emit(type, data) {
    const list = this.eventListeners.get(type);
    if (list) {
      list.forEach(cb => cb(data));
    }
  }

  setBinaryListener(cb) {
    this.binaryListener = cb;
  }
}
