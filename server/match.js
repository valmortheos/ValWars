const { MAPS } = require('./room');
const { parsePlayerInputBuffer, serializeGameState } = require('./state');

const TICK_RATE = 20; // 20 Hz
const TICK_INTERVAL = 1000 / TICK_RATE; // 50 ms
const PLAYER_SPEED = 7.0; // units per second
const PLAYER_RADIUS = 0.6;
const MAX_HP = 100;
const MAX_AMMO = 30;
const DAMAGE_PER_SHOT = 20;
const SHOT_COOLDOWN_MS = 120; // ~8 shots/sec
const RELOAD_TIME_MS = 1800;
const GRENADE_COOLDOWN_MS = 5000;
const GRENADE_EXPLODE_MS = 1500;
const GRENADE_RADIUS = 5.0;
const GRENADE_MAX_DAMAGE = 70;
const RESPAWN_DELAY_MS = 3000;
const MATCH_DURATION_SEC = 180; // 3 minutes
const TARGET_KILLS = 25;

class Match {
  constructor(room, onEndCallback) {
    this.room = room;
    this.mapData = MAPS[room.mapId] || MAPS.arena;
    this.onEndCallback = onEndCallback;

    this.tickCount = 0;
    this.timeRemaining = MATCH_DURATION_SEC;
    this.redScore = 0;
    this.blueScore = 0;
    this.intervalId = null;

    // Players state
    this.playersState = new Map(); // userId -> player object

    // Grenades list
    this.activeGrenades = []; // { id, x, z, vx, vz, timer, ownerId, team }

    this.initPlayers();
  }

  initPlayers() {
    let slotIdx = 0;
    for (const p of this.room.players.values()) {
      const spawnPos = this.getSpawnPosition(p.team, slotIdx);
      this.playersState.set(p.userId, {
        userId: p.userId,
        username: p.username,
        team: p.team,
        slot: slotIdx,
        x: spawnPos.x,
        z: spawnPos.z,
        aimAngle: 0,
        hp: MAX_HP,
        ammo: MAX_AMMO,
        alive: true,
        reloading: false,
        reloadTimer: 0,
        lastShotTime: 0,
        lastGrenadeTime: 0,
        firing: false,
        kills: 0,
        deaths: 0,
        respawnTimer: 0,
        input: {
          moveAngle: -1,
          moveMag: 0,
          fire: false,
          reload: false,
          grenade: false,
          aimAngle: 0
        }
      });
      slotIdx++;
    }
  }

  getSpawnPosition(team, slot) {
    const halfW = (this.mapData.width / 2) - 4;
    const halfD = (this.mapData.depth / 2) - 4;

    if (team === 'red') {
      return { x: -halfW + (slot * 2), z: -halfD + (slot * 2) };
    } else if (team === 'blue') {
      return { x: halfW - (slot * 2), z: halfD - (slot * 2) };
    } else {
      // FFA or random
      const offset = (slot * 5) % halfW;
      return { x: -10 + offset, z: -10 + offset };
    }
  }

  start() {
    this.startTime = Date.now();
    this.lastTickTime = Date.now();

    this.intervalId = setInterval(() => {
      this.update();
    }, TICK_INTERVAL);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  handlePlayerInputBuffer(userId, buffer) {
    const p = this.playersState.get(userId);
    if (!p) return;
    const input = parsePlayerInputBuffer(buffer);
    if (input) {
      // Validate numerical inputs to prevent NaN or infinite values
      if (!Number.isFinite(input.moveAngle) || input.moveAngle < -1 || input.moveAngle > 360) {
        return;
      }
      if (!Number.isFinite(input.moveMag) || input.moveMag < 0 || input.moveMag > 1) {
        return;
      }
      if (!Number.isFinite(input.aimAngle) || input.aimAngle < 0 || input.aimAngle > 360) {
        return;
      }
      p.input = input;
    }
  }

  handlePlayerDisconnect(userId) {
    this.playersState.delete(userId);
  }

  update() {
    const now = Date.now();
    const dt = (now - this.lastTickTime) / 1000.0;
    this.lastTickTime = now;

    this.tickCount++;
    this.timeRemaining -= dt;

    if (this.timeRemaining <= 0) {
      this.endMatch('Time Limit Reached');
      return;
    }

    // Process player updates
    for (const p of this.playersState.values()) {
      if (!p.alive) {
        p.respawnTimer -= dt * 1000;
        if (p.respawnTimer <= 0) {
          this.respawnPlayer(p);
        }
        continue;
      }

      // Handle reload timer
      if (p.reloading) {
        p.reloadTimer -= dt * 1000;
        if (p.reloadTimer <= 0) {
          p.reloading = false;
          p.ammo = MAX_AMMO;
        }
      }

      // Explicit reload trigger
      if (p.input.reload && !p.reloading && p.ammo < MAX_AMMO) {
        p.reloading = true;
        p.reloadTimer = RELOAD_TIME_MS;
      }

      // Update aim angle
      if (typeof p.input.aimAngle === 'number') {
        p.aimAngle = p.input.aimAngle;
      }

      // Movement update
      if (p.input.moveMag > 0.05 && p.input.moveAngle >= 0) {
        const rad = (p.input.moveAngle * Math.PI) / 180.0;
        const speed = PLAYER_SPEED * Math.min(1.0, p.input.moveMag);
        const dx = Math.sin(rad) * speed * dt;
        const dz = Math.cos(rad) * speed * dt;

        this.movePlayerWithCollision(p, dx, dz);
      }

      // Fire weapon (hitscan)
      p.firing = false;
      if (p.input.fire && !p.reloading) {
        if (p.ammo <= 0) {
          // Auto reload when empty
          p.reloading = true;
          p.reloadTimer = RELOAD_TIME_MS;
        } else if (now - p.lastShotTime >= SHOT_COOLDOWN_MS) {
          p.lastShotTime = now;
          p.ammo--;
          p.firing = true;
          this.performHitscanShot(p);
        }
      }

      // Throw Grenade
      if (p.input.grenade && (now - p.lastGrenadeTime >= GRENADE_COOLDOWN_MS)) {
        p.lastGrenadeTime = now;
        this.throwGrenade(p);
      }
    }

    // Process Grenades
    this.updateGrenades(dt);

    // Check Win condition across all modes (Red, Blue, or FFA)
    let maxFfaKills = 0;
    if (this.ffaScores) {
      for (const k of this.ffaScores.values()) {
        if (k > maxFfaKills) maxFfaKills = k;
      }
    }

    if (this.redScore >= TARGET_KILLS || this.blueScore >= TARGET_KILLS || maxFfaKills >= TARGET_KILLS) {
      this.endMatch('Target Kills Reached');
      return;
    }

    // Broadcast snapshot
    this.broadcastSnapshot();
  }

  movePlayerWithCollision(p, dx, dz) {
    let newX = p.x + dx;
    let newZ = p.z + dz;

    const mapW = this.mapData.width / 2;
    const mapD = this.mapData.depth / 2;

    // Check map boundaries
    newX = Math.max(-mapW + PLAYER_RADIUS, Math.min(mapW - PLAYER_RADIUS, newX));
    newZ = Math.max(-mapD + PLAYER_RADIUS, Math.min(mapD - PLAYER_RADIUS, newZ));

    // Check obstacle collisions (AABB vs Circle)
    for (const obs of this.mapData.obstacles) {
      const halfW = obs.w / 2;
      const halfD = obs.d / 2;

      // Closest point on rectangle to player
      const closestX = Math.max(obs.x - halfW, Math.min(obs.x + halfW, newX));
      const closestZ = Math.max(obs.z - halfD, Math.min(obs.z + halfD, newZ));

      const distX = newX - closestX;
      const distZ = newZ - closestZ;
      const distanceSq = (distX * distX) + (distZ * distZ);

      if (distanceSq < PLAYER_RADIUS * PLAYER_RADIUS) {
        const distance = Math.sqrt(distanceSq);
        if (distance > 0.0001) {
          const overlap = PLAYER_RADIUS - distance;
          newX += (distX / distance) * overlap;
          newZ += (distZ / distance) * overlap;
        } else {
          // Push back
          newX = p.x;
          newZ = p.z;
        }
      }
    }

    p.x = newX;
    p.z = newZ;
  }

  performHitscanShot(shooter) {
    const rad = (shooter.aimAngle * Math.PI) / 180.0;
    const dirX = Math.sin(rad);
    const dirZ = Math.cos(rad);

    let closestHitDist = 100.0;
    let hitPlayer = null;

    // Raycast against obstacles first
    for (const obs of this.mapData.obstacles) {
      const dist = rayBoxIntersection(shooter.x, shooter.z, dirX, dirZ, obs);
      if (dist !== null && dist < closestHitDist) {
        closestHitDist = dist;
      }
    }

    // Raycast against enemy players within closest obstacle distance
    for (const target of this.playersState.values()) {
      if (!target.alive || target.userId === shooter.userId) continue;
      if (this.room.mode !== 'FFA' && target.team === shooter.team) continue;

      const dist = rayCircleIntersection(shooter.x, shooter.z, dirX, dirZ, target.x, target.z, PLAYER_RADIUS);
      if (dist !== null && dist < closestHitDist) {
        closestHitDist = dist;
        hitPlayer = target;
      }
    }

    // Broadcast hitscan event for visual tracer on clients
    this.room.broadcast({
      type: 'EVENT_SHOT',
      shooterId: shooter.userId,
      startX: shooter.x,
      startZ: shooter.z,
      endX: shooter.x + dirX * closestHitDist,
      endZ: shooter.z + dirZ * closestHitDist,
      hit: hitPlayer !== null
    });

    if (hitPlayer) {
      this.applyDamage(hitPlayer, DAMAGE_PER_SHOT, shooter);
    }
  }

  throwGrenade(shooter) {
    const rad = (shooter.aimAngle * Math.PI) / 180.0;
    const speed = 12.0;
    const vx = Math.sin(rad) * speed;
    const vz = Math.cos(rad) * speed;

    this.activeGrenades.push({
      id: Math.random().toString(36).substring(2, 9),
      x: shooter.x,
      z: shooter.z,
      vx,
      vz,
      timer: GRENADE_EXPLODE_MS,
      ownerId: shooter.userId,
      team: shooter.team
    });

    this.room.broadcast({
      type: 'EVENT_GRENADE_THROWN',
      ownerId: shooter.userId,
      startX: shooter.x,
      startZ: shooter.z,
      vx,
      vz
    });
  }

  updateGrenades(dt) {
    for (let i = this.activeGrenades.length - 1; i >= 0; i--) {
      const g = this.activeGrenades[i];
      g.x += g.vx * dt;
      g.z += g.vz * dt;
      g.vx *= 0.92; // Friction
      g.vz *= 0.92;
      g.timer -= dt * 1000;

      if (g.timer <= 0) {
        // Explode!
        this.explodeGrenade(g);
        this.activeGrenades.splice(i, 1);
      }
    }
  }

  explodeGrenade(g) {
    this.room.broadcast({
      type: 'EVENT_GRENADE_EXPLODE',
      x: g.x,
      z: g.z,
      radius: GRENADE_RADIUS
    });

    const owner = this.playersState.get(g.ownerId);

    for (const target of this.playersState.values()) {
      if (!target.alive) continue;
      const dx = target.x - g.x;
      const dz = target.z - g.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= GRENADE_RADIUS) {
        const falloff = 1.0 - (dist / GRENADE_RADIUS);
        const damage = Math.round(GRENADE_MAX_DAMAGE * falloff);
        if (damage > 0) {
          this.applyDamage(target, damage, owner);
        }
      }
    }
  }

  applyDamage(target, damage, attacker) {
    if (!target.alive) return;
    target.hp -= damage;

    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.deaths++;
      target.respawnTimer = RESPAWN_DELAY_MS;

      if (attacker && attacker.userId !== target.userId) {
        attacker.kills++;
        if (attacker.team === 'red') this.redScore++;
        else if (attacker.team === 'blue') this.blueScore++;
        else {
          // FFA mode or custom team: increment attacker's kill score
          if (!this.ffaScores) this.ffaScores = new Map();
          const cur = this.ffaScores.get(attacker.userId) || 0;
          this.ffaScores.set(attacker.userId, cur + 1);
        }
      }

      this.room.broadcast({
        type: 'EVENT_KILL',
        killerId: attacker ? attacker.userId : null,
        killerName: attacker ? attacker.username : 'Environment',
        victimId: target.userId,
        victimName: target.username
      });
    }
  }

  respawnPlayer(p) {
    const spawnPos = this.getSpawnPosition(p.team, p.slot);
    p.x = spawnPos.x;
    p.z = spawnPos.z;
    p.hp = MAX_HP;
    p.ammo = MAX_AMMO;
    p.alive = true;
    p.reloading = false;

    this.room.broadcast({
      type: 'EVENT_RESPAWN',
      userId: p.userId,
      x: p.x,
      z: p.z
    });
  }

  broadcastSnapshot() {
    const playersList = Array.from(this.playersState.values());
    const buffer = serializeGameState(
      this.tickCount,
      this.timeRemaining,
      this.redScore,
      this.blueScore,
      playersList
    );

    for (const p of this.room.players.values()) {
      if (p.ws && p.ws.readyState === 1) {
        p.ws.send(buffer);
      }
    }
  }

  endMatch(reason) {
    this.stop();
    if (this.onEndCallback) {
      this.onEndCallback(reason);
    }
  }
}

// Ray-Box collision helper for hitscan
function rayBoxIntersection(rx, rz, dx, dz, box) {
  const minX = box.x - box.w / 2;
  const maxX = box.x + box.w / 2;
  const minZ = box.z - box.d / 2;
  const maxZ = box.z + box.d / 2;

  let tmin = -Infinity;
  let tmax = Infinity;

  if (Math.abs(dx) > 1e-6) {
    let t1 = (minX - rx) / dx;
    let t2 = (maxX - rx) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  } else if (rx < minX || rx > maxX) {
    return null;
  }

  if (Math.abs(dz) > 1e-6) {
    let t1 = (minZ - rz) / dz;
    let t2 = (maxZ - rz) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  } else if (rz < minZ || rz > maxZ) {
    return null;
  }

  if (tmax >= Math.max(0, tmin) && tmin < 100) {
    return tmin > 0 ? tmin : 0;
  }
  return null;
}

// Ray-Circle collision helper for hitscan vs player
function rayCircleIntersection(rx, rz, dx, dz, cx, cz, radius) {
  const fx = rx - cx;
  const fz = rz - cz;

  const a = dx * dx + dz * dz;
  const b = 2 * (fx * dx + fz * dz);
  const c = (fx * fx + fz * fz) - radius * radius;

  let discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  discriminant = Math.sqrt(discriminant);
  const t1 = (-b - discriminant) / (2 * a);
  const t2 = (-b + discriminant) / (2 * a);

  if (t1 >= 0) return t1;
  if (t2 >= 0) return t2;
  return null;
}

function createMatch(room, onEndCallback) {
  return new Match(room, onEndCallback);
}

module.exports = { createMatch };
