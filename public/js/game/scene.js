import * as THREE from '../../vendor/three.module.js';

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.scene = null;
    this.camera = null;

    this.mapGroup = null;
    this.playerMeshes = new Map(); // slot -> { group, bodyMesh, gunMesh, targetPos, targetRot, currentPos, currentRot }
    this.effectsGroup = null;

    this.mySlot = null;
    this.lastStateTime = Date.now();

    this.initRenderer();
    this.animate();
  }

  async init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf1f5f9);

    // Tilted top-down camera perspective (~55 degrees)
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 32, 22);
    this.camera.lookAt(0, 0, 0);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 40, 20);
    this.scene.add(dirLight);

    this.mapGroup = new THREE.Group();
    this.scene.add(this.mapGroup);

    this.effectsGroup = new THREE.Group();
    this.scene.add(this.effectsGroup);

    window.addEventListener('resize', () => this.onResize());
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  onResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  loadMap(mapData) {
    // Clear previous map
    while (this.mapGroup.children.length > 0) {
      const obj = this.mapGroup.children[0];
      this.mapGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }

    const halfW = mapData.width / 2;
    const halfD = mapData.depth / 2;

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(mapData.width, mapData.depth);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0xe2e8f0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.mapGroup.add(ground);

    // Grid Floor Overlay
    const grid = new THREE.GridHelper(Math.max(mapData.width, mapData.depth), 20, 0xcbd5e1, 0xcbd5e1);
    grid.position.y = 0.01;
    this.mapGroup.add(grid);

    // Obstacles
    const obsMat = new THREE.MeshLambertMaterial({ color: 0x64748b });
    for (const obs of mapData.obstacles) {
      const geo = new THREE.BoxGeometry(obs.w, obs.h, obs.d);
      const mesh = new THREE.Mesh(geo, obsMat);
      mesh.position.set(obs.x, obs.h / 2, obs.z);
      this.mapGroup.add(mesh);
    }
  }

  createPlayerMesh(slot, isLocal) {
    const group = new THREE.Group();

    // Body Capsule/Cylinder
    const bodyGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.6, 12);
    const bodyMat = new THREE.MeshLambertMaterial({
      color: isLocal ? 0x2563eb : 0xdc2626
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.8;
    group.add(bodyMesh);

    // Head / Eye indicator direction
    const headGeo = new THREE.BoxGeometry(0.4, 0.2, 0.4);
    const headMat = new THREE.MeshLambertMaterial({ color: 0x0f172a });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.position.set(0, 1.4, 0.2);
    group.add(headMesh);

    // Gun
    const gunGeo = new THREE.BoxGeometry(0.15, 0.15, 0.8);
    const gunMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
    const gunMesh = new THREE.Mesh(gunGeo, gunMat);
    gunMesh.position.set(0.35, 0.9, 0.4);
    group.add(gunMesh);

    this.scene.add(group);

    return {
      group,
      targetPos: new THREE.Vector3(),
      targetRot: 0,
      currentPos: new THREE.Vector3(),
      currentRot: 0
    };
  }

  updateState(buffer, myUserId) {
    if (!buffer || buffer.byteLength < 8) return null;
    const view = new DataView(buffer);

    const type = view.getUint8(0);
    if (type !== 0x01) return null; // State packet

    const tick = view.getUint16(1, true);
    const timeRemaining = view.getUint16(3, true);
    const redScore = view.getUint8(5);
    const blueScore = view.getUint8(6);
    const playerCount = view.getUint8(7);

    const players = [];
    let offset = 8;
    const activeSlots = new Set();

    for (let i = 0; i < playerCount; i++) {
      const slot = view.getUint8(offset);
      const x = view.getInt16(offset + 1, true) / 100.0;
      const z = view.getInt16(offset + 3, true) / 100.0;
      const aimAngle = view.getUint16(offset + 5, true) / 100.0;
      const hp = view.getUint8(offset + 7);
      const ammo = view.getUint8(offset + 8);
      const flags = view.getUint8(offset + 9);
      const kills = view.getUint16(offset + 10, true);
      const deaths = view.getUint16(offset + 12, true);

      const alive = (flags & 1) !== 0;
      const reloading = (flags & 2) !== 0;
      const firing = (flags & 4) !== 0;

      activeSlots.add(slot);

      players.push({ slot, x, z, aimAngle, hp, ammo, alive, reloading, firing, kills, deaths });

      // Update Mesh
      let pMesh = this.playerMeshes.get(slot);
      if (!pMesh) {
        const isLocal = (this.mySlot !== null && slot === this.mySlot);
        pMesh = this.createPlayerMesh(slot, isLocal);
        this.playerMeshes.set(slot, pMesh);
      }

      pMesh.targetPos.set(x, 0, z);
      pMesh.targetRot = (aimAngle * Math.PI) / 180.0;
      pMesh.group.visible = alive;

      offset += 16;
    }

    // Clean up disconnected players
    for (const [s, pMesh] of this.playerMeshes.entries()) {
      if (!activeSlots.has(s)) {
        this.scene.remove(pMesh.group);
        this.playerMeshes.delete(s);
      }
    }

    this.lastStateTime = Date.now();

    return {
      tick,
      timeRemaining,
      redScore,
      blueScore,
      players,
      mySlot: this.mySlot
    };
  }

  drawTracer(event) {
    const points = [
      new THREE.Vector3(event.startX, 0.9, event.startZ),
      new THREE.Vector3(event.endX, 0.9, event.endZ)
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    this.effectsGroup.add(line);

    setTimeout(() => {
      this.effectsGroup.remove(line);
      geo.dispose();
      mat.dispose();
    }, 80);
  }

  spawnGrenade(event) {
    const geo = new THREE.SphereGeometry(0.2, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.set(event.startX, 0.5, event.startZ);
    this.effectsGroup.add(sphere);

    let vx = event.vx;
    let vz = event.vz;
    let lastTime = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000.0;
      lastTime = now;

      sphere.position.x += vx * dt;
      sphere.position.z += vz * dt;
      vx *= 0.92;
      vz *= 0.92;
    }, 30);

    setTimeout(() => {
      clearInterval(interval);
      this.effectsGroup.remove(sphere);
      geo.dispose();
      mat.dispose();
    }, 1500);
  }

  explodeGrenade(event) {
    const geo = new THREE.RingGeometry(0.1, event.radius, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf97316, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(event.x, 0.05, event.z);
    this.effectsGroup.add(ring);

    let opacity = 0.8;
    const interval = setInterval(() => {
      opacity -= 0.08;
      mat.opacity = opacity;
      if (opacity <= 0) {
        clearInterval(interval);
        this.effectsGroup.remove(ring);
        geo.dispose();
        mat.dispose();
      }
    }, 30);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // 100ms Interpolation for player positions
    for (const [slot, pMesh] of this.playerMeshes.entries()) {
      pMesh.currentPos.lerp(pMesh.targetPos, 0.25);
      pMesh.group.position.copy(pMesh.currentPos);

      // Lerp angle
      pMesh.group.rotation.y = pMesh.targetRot;

      // Camera follow local player
      if (slot === this.mySlot) {
        this.camera.position.x = pMesh.currentPos.x;
        this.camera.position.z = pMesh.currentPos.z + 22;
        this.camera.lookAt(pMesh.currentPos.x, 0, pMesh.currentPos.z);
      }
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
