/**
 * Touch Controls & Input Packet Encoder
 */
export class TouchControls {
  constructor(joystickZone, joystickThumb, fireBtn, reloadBtn, grenadeBtn, netClient) {
    this.zone = joystickZone;
    this.thumb = joystickThumb;
    this.fireBtn = fireBtn;
    this.reloadBtn = reloadBtn;
    this.grenadeBtn = grenadeBtn;
    this.net = netClient;

    this.seq = 0;
    this.moveAngle = -1;
    this.moveMag = 0;
    this.lastAimAngle = 0;
    this.isFiring = false;
    this.isReloading = false;
    this.isGrenade = false;

    this.touchId = null;
    this.center = { x: 0, y: 0 };
    this.radius = 50;

    this.sendInterval = null;

    this.initEvents();
    this.startSending();
  }

  initEvents() {
    // Joystick Touch
    this.zone.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
    this.zone.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
    this.zone.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
    this.zone.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), { passive: false });

    // Buttons
    const bindBtn = (btn, actionSetter) => {
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        btn.classList.add('active');
        actionSetter(true);
      }, { passive: false });

      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        btn.classList.remove('active');
        actionSetter(false);
      }, { passive: false });
    };

    bindBtn(this.fireBtn, (v) => { this.isFiring = v; });
    bindBtn(this.reloadBtn, (v) => { this.isReloading = v; });
    bindBtn(this.grenadeBtn, (v) => { this.isGrenade = v; });
  }

  handleTouchStart(e) {
    e.preventDefault();
    if (this.touchId !== null) return;
    const touch = e.changedTouches[0];
    this.touchId = touch.identifier;

    const rect = this.zone.getBoundingClientRect();
    this.center = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };

    this.updateJoystick(touch.clientX, touch.clientY);
  }

  handleTouchMove(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.touchId) {
        this.updateJoystick(touch.clientX, touch.clientY);
        break;
      }
    }
  }

  handleTouchEnd(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.touchId) {
        this.touchId = null;
        this.moveAngle = -1;
        this.moveMag = 0;
        this.thumb.style.transform = `translate(-50%, -50%)`;
        break;
      }
    }
  }

  updateJoystick(clientX, clientY) {
    const dx = clientX - this.center.x;
    const dy = clientY - this.center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const clampedDist = Math.min(dist, this.radius);
    const rad = Math.atan2(dx, dy); // 0 = Down, PI/2 = Right, etc.

    // Calculate angle in degrees (0 to 360) where 0 = forward (+Z)
    let deg = (Math.atan2(dx, dy) * 180 / Math.PI);
    if (deg < 0) deg += 360;

    this.moveAngle = deg;
    this.moveMag = clampedDist / this.radius;
    this.lastAimAngle = deg; // Aim follows joystick angle

    const thumbX = Math.sin(rad) * clampedDist;
    const thumbY = Math.cos(rad) * clampedDist;

    this.thumb.style.transform = `translate(calc(-50% + ${thumbX}px), calc(-50% + ${thumbY}px))`;
  }

  startSending() {
    // Send input packet 20 times per second
    this.sendInterval = setInterval(() => {
      this.sendInputPacket();
    }, 50);
  }

  sendInputPacket() {
    // Packet size: 9 bytes
    const buffer = new ArrayBuffer(9);
    const view = new DataView(buffer);

    this.seq = (this.seq + 1) % 256;
    view.setUint8(0, this.seq);

    view.setFloat32(1, this.moveAngle, true); // Little endian
    view.setUint8(5, Math.round(this.moveMag * 100));

    let actions = 0;
    if (this.isFiring) actions |= 1;
    if (this.isReloading) actions |= 2;
    if (this.isGrenade) actions |= 4;
    view.setUint8(6, actions);

    view.setUint16(7, Math.round(this.lastAimAngle * 100) % 36000, true);

    this.net.sendBinary(buffer);

    // Reset single triggers after packet sent
    if (this.isReloading) this.isReloading = false;
    if (this.isGrenade) this.isGrenade = false;
  }

  destroy() {
    if (this.sendInterval) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }
  }
}
