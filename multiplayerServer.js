/**
 * multiplayerServer.js
 *
 * WebSocket game server for Kaj Simulator multiplayer. Attached to the same HTTP(S) server that
 * serves the site, so the game connects to `ws(s)://<same host>`.
 *
 * Client -> server messages (JSON):
 *   join   { name, x, y, z, yaw }
 *   update { x, y, z, yaw, pitch, roll, state: 'foot'|'car'|'plane', color, model,
 *            region, hp, anim, held, speed, steer, riders: [[seat, seed, style]], lights,
 *            radio (track index, -1 off), radioT (seconds into it) }
 *   chat   { text }
 *   fire   { weapon, ox, oy, oz, dx, dy, dz }        relayed to the other players as 'shot'
 *   shoot  { targetId, weapon, damage }              PvP hit on one player -> 'hit' to the target
 *   event  { kind: 'explosion', x, y, z }            relayed to the other players
 *   died   { killer }                                announced to everyone as 'kill'
 *   ragdoll / vats                                   legacy messages, unchanged
 *
 * Shared world (protocol v2). The map is cut into regions (the player's district, or a 1.5 km
 * square of the outskirts); the first player in a region to have joined owns it: their game
 * simulates the people, cars and parked cars there and everyone else in the region shows replicas
 * of what the owner sends. `riders` in an update lists the NPC passengers as [seat, look seed, style].
 *   world   { region, ... }          owner -> the rest of the region, relayed untouched
 *   need    {}                       a peer wants a full snapshot -> sent to the owner
 *   cmd     { kind, ... }            a peer acts on something the owner simulates -> owner only
 *   rel     { kind, ... }            event for everyone else in the region (deaths, impacts, cash)
 *   cops    { ... }                  a player's police, relayed to players within COPS_RANGE
 *   direct  { to, kind, ... }        one player to another
 *   board   { driverId }             ride along in another player's car -> 'boarded' | 'boardDenied'
 *   unboard {}
 *   drop / take                      cash on the street: the first to take it gets it
 *
 * Server -> client messages:
 *   welcome { id, now }, players { players: [...] } (batched ~15x/s), chat, shot, event, hit, kill,
 *   full, authority { region, owner, you, peers }, clock { now }, boarded / unboarded,
 *   drop / took, plus the relays above
 */

const WebSocket = require('ws');

const MAX_PLAYERS = 16;
const TICK_MS = 66;            // player list broadcast interval
const CHAT_MIN_INTERVAL_MS = 700;
const MAX_CHAT_LENGTH = 120;
const MAX_NAME_LENGTH = 16;
const WORLD_LIMIT = 20000;
const STATES = new Set(['foot', 'car', 'plane']);
const MAX_WORLD_BYTES = 400000;     // one world snapshot
const MAX_REL_BYTES = 20000;
const COPS_RANGE = 450;
const BOARD_RANGE = 10;             // metres between a would-be passenger and the driver's car
const CAR_SEATS = 4;                // driver + 3 passengers
const DROP_LIFETIME_MS = 150000;
const MAX_DROPS = 200;
const TAKE_RANGE = 7;
const CLOCK_INTERVAL_MS = 5000;
const REGION_RE = /^[a-z0-9:,_-]{1,24}$/;

function num(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function cleanName(name) {
  const cleaned = String(name == null ? '' : name).replace(/[^\w .\-]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned || 'Player';
}

function cleanText(text) {
  // eslint-disable-next-line no-control-regex
  return String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
}

function attachMultiplayer(server, options = {}) {
  const wss = new WebSocket.Server({ server });
  const players = new Map();        // id -> player state
  const sockets = new Map();        // id -> ws
  const owners = new Map();         // region -> owner id
  const drops = new Map();          // id -> { x, z, amount, region, at }
  let joinCounter = 0;
  let dirty = false;
  const log = options.log || (() => {});

  function send(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function broadcast(message, exceptId = null) {
    const data = JSON.stringify(message);
    for (const [id, ws] of sockets) {
      if (id !== exceptId && ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  function playerList() {
    return Array.from(players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw,
      pitch: p.pitch,
      roll: p.roll,
      state: p.state,
      color: p.color,
      model: p.model,
      ragdoll: p.ragdoll || false,
      region: p.region,
      hp: p.hp,
      anim: p.anim,
      held: p.held,
      speed: p.speed,
      steer: p.steer,
      riders: p.riders,
      lights: p.lights,
      radio: p.radio,
      radioT: p.radioT,
      ride: p.ride
    }));
  }

  function broadcastPlayerList() {
    dirty = false;
    broadcast({ type: 'players', players: playerList() });
  }

  function sendHitNotification(targetId, shooterName, weapon, damage) {
    send(sockets.get(targetId), { type: 'hit', shooterName, weapon, damage });
  }

  // ---- Regions and who owns them ----
  function peersIn(region) {
    let n = 0;
    for (const p of players.values()) if (p.region === region) n++;
    return n;
  }

  function recomputeOwners() {
    const next = new Map();
    for (const p of players.values()) {
      if (!p.region) continue;
      const cur = next.get(p.region);
      if (!cur || p.order < cur.order) next.set(p.region, p);
    }
    owners.clear();
    for (const [region, p] of next) owners.set(region, p.id);
    // Anyone whose region or its owner changed is told who owns it now
    for (const p of players.values()) {
      if (!p.region) continue;
      const key = p.region + '|' + owners.get(p.region) + '|' + peersIn(p.region);
      if (p.told !== key) {
        p.told = key;
        send(sockets.get(p.id), {
          type: 'authority', region: p.region, owner: owners.get(p.region), you: owners.get(p.region) === p.id,
          peers: peersIn(p.region)
        });
      }
    }
  }

  function toRegion(region, raw, exceptId) {
    for (const p of players.values()) {
      if (p.region === region && p.id !== exceptId) {
        const ws = sockets.get(p.id);
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(raw);
      }
    }
  }

  // ---- Riding along ----
  function releaseRider(p, reason) {
    if (!p.ride) return;
    p.ride = null;
    dirty = true;
    send(sockets.get(p.id), { type: 'unboarded', reason });
  }

  function seatTaken(driver, seat) {
    if (driver.riders && driver.riders.some((r) => r[0] === seat)) return true;
    for (const p of players.values()) if (p.ride && p.ride.of === driver.id && p.ride.seat === seat) return true;
    return false;
  }

  function ejectRidersOf(driver, reason) {
    for (const p of players.values()) if (p.ride && p.ride.of === driver.id) releaseRider(p, reason);
  }

  // Batch position updates instead of re-broadcasting the whole list for every single message
  const ticker = setInterval(() => { if (dirty) broadcastPlayerList(); }, TICK_MS);
  if (typeof ticker.unref === 'function') ticker.unref();
  // The shared clock: every client lines its day / night cycle up with the server's time
  const clockTicker = setInterval(() => {
    broadcast({ type: 'clock', now: Date.now() });
    const cutoff = Date.now() - DROP_LIFETIME_MS;
    for (const [id, d] of drops) if (d.at < cutoff) drops.delete(id);
  }, CLOCK_INTERVAL_MS);
  if (typeof clockTicker.unref === 'function') clockTicker.unref();
  wss.on('close', () => { clearInterval(ticker); clearInterval(clockTicker); });

  wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).slice(2, 11);
    log(`Player connected: ${playerId}`);
    sockets.set(playerId, ws);
    let lastChatAt = 0;

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch (e) {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      try {
        if (msg.type === 'join') {
          if (!players.has(playerId) && players.size >= MAX_PLAYERS) {
            send(ws, { type: 'full' });
            ws.close();
            return;
          }
          players.set(playerId, {
            id: playerId,
            name: cleanName(msg.name),
            x: num(msg.x, -WORLD_LIMIT, WORLD_LIMIT, 0),
            y: num(msg.y, -100, 2000, 0),
            z: num(msg.z, -WORLD_LIMIT, WORLD_LIMIT, 0),
            yaw: num(msg.yaw, -10, 10, 0),
            pitch: 0,
            roll: 0,
            state: 'foot',
            color: 0x888888,
            model: 'civic',
            ragdoll: false,
            order: ++joinCounter,
            region: null, hp: 100, anim: 'idle', held: '', speed: 0, steer: 0, riders: [], lights: 0, radio: -1, radioT: 0,
            ride: null, told: null
          });
          send(ws, { type: 'welcome', id: playerId, now: Date.now() });
          broadcastPlayerList();
          return;
        }

        const player = players.get(playerId);
        if (!player) return; // must join first

        if (msg.type === 'update') {
          player.x = num(msg.x, -WORLD_LIMIT, WORLD_LIMIT, player.x);
          player.y = num(msg.y, -100, 2000, player.y);
          player.z = num(msg.z, -WORLD_LIMIT, WORLD_LIMIT, player.z);
          player.yaw = num(msg.yaw, -10, 10, player.yaw);
          player.pitch = num(msg.pitch, -2, 2, 0);
          player.roll = num(msg.roll, -4, 4, 0);
          player.state = STATES.has(msg.state) ? msg.state : 'foot';
          player.color = Math.floor(num(msg.color, 0, 0xffffff, player.color));
          // Car model id (carModels.js): a short lowercase word, anything else falls back to the Civic
          player.model = (typeof msg.model === 'string' && /^[a-z0-9_]{1,16}$/.test(msg.model)) ? msg.model : 'civic';
          player.hp = Math.round(num(msg.hp, 0, 100, player.hp));
          player.anim = typeof msg.anim === 'string' && /^[a-z]{1,12}$/.test(msg.anim) ? msg.anim : 'idle';
          player.held = typeof msg.held === 'string' ? msg.held.replace(/[^\w .\-]/g, '').slice(0, 24) : '';
          player.speed = num(msg.speed, -200, 200, 0);
          player.steer = num(msg.steer, -1, 1, 0);
          player.lights = Math.floor(num(msg.lights, 0, 15, 0));
          // The song on the car radio (track index, -1 off) and how far in, so passengers hear it too
          player.radio = Math.floor(num(msg.radio, -1, 999, -1));
          player.radioT = Math.round(num(msg.radioT, 0, 36000, 0) * 10) / 10;
          // NPC passengers: [seat, look seed, style] each
          player.riders = Array.isArray(msg.riders)
            ? msg.riders.slice(0, CAR_SEATS - 1).filter(Array.isArray).map((r) => [
              Math.floor(num(r[0], 1, CAR_SEATS - 1, 1)), Math.floor(num(r[1], 0, 1e9, 0)),
              typeof r[2] === 'string' && /^[a-z]{1,12}$/.test(r[2]) ? r[2] : 'adult'
            ]) : [];
          if (typeof msg.region === 'string' && REGION_RE.test(msg.region) && msg.region !== player.region) {
            player.region = msg.region;
            recomputeOwners();
          }
          // Passengers ride along: their pose is the car's, whatever they send
          if (player.ride) {
            const d = players.get(player.ride.of);
            if (!d || d.state !== 'car') {
              releaseRider(player, 'driver left');
            } else {
              player.x = d.x; player.y = d.y; player.z = d.z;
              player.state = 'foot';
              if (d.region && d.region !== player.region) { player.region = d.region; recomputeOwners(); }
            }
          }
          // A driver who gets out (or changes vehicle type) puts their passengers out
          if (player.state !== 'car') ejectRidersOf(player, 'driver left');
          dirty = true;
        } else if (msg.type === 'world') {
          // The region's owner shares what they simulate; everyone else in it gets it as is
          const raw = String(data);
          if (raw.length > MAX_WORLD_BYTES || msg.region !== player.region || owners.get(player.region) !== playerId) return;
          toRegion(player.region, raw, playerId);
        } else if (msg.type === 'need') {
          const owner = owners.get(player.region);
          if (owner && owner !== playerId) send(sockets.get(owner), { type: 'need', from: playerId, region: player.region });
        } else if (msg.type === 'cmd') {
          const owner = owners.get(player.region);
          if (owner && owner !== playerId && String(data).length <= MAX_REL_BYTES) {
            send(sockets.get(owner), Object.assign({}, msg, { type: 'cmd', from: playerId, region: player.region }));
          }
        } else if (msg.type === 'rel') {
          if (String(data).length > MAX_REL_BYTES || !player.region) return;
          toRegion(player.region, JSON.stringify(Object.assign({}, msg, { type: 'rel', from: playerId, region: player.region })), playerId);
        } else if (msg.type === 'cops') {
          if (String(data).length > MAX_WORLD_BYTES / 4) return;
          const out = JSON.stringify(Object.assign({}, msg, { type: 'cops', from: playerId }));
          for (const o of players.values()) {
            if (o.id === playerId || Math.hypot(o.x - player.x, o.z - player.z) > COPS_RANGE) continue;
            const ows = sockets.get(o.id);
            if (ows && ows.readyState === WebSocket.OPEN) ows.send(out);
          }
        } else if (msg.type === 'direct') {
          // One player to another (a cop was hit, an invitation...): a short message of the named kind
          const to = players.get(msg.to);
          if (to && String(data).length <= MAX_REL_BYTES) send(sockets.get(to.id), Object.assign({}, msg, { type: 'direct', from: playerId }));
        } else if (msg.type === 'board') {
          const driver = players.get(msg.driverId);
          if (player.ride) return;
          if (!driver || driver.id === playerId || driver.state !== 'car' || driver.ride) {
            send(ws, { type: 'boardDenied', reason: 'no car' });
          } else if (Math.hypot(driver.x - player.x, driver.z - player.z) > BOARD_RANGE) {
            send(ws, { type: 'boardDenied', reason: 'too far' });
          } else {
            let seat = 0;
            for (let k = 1; k < CAR_SEATS; k++) if (!seatTaken(driver, k)) { seat = k; break; }
            if (!seat) {
              send(ws, { type: 'boardDenied', reason: 'full' });
            } else {
              player.ride = { of: driver.id, seat };
              player.state = 'foot';
              player.x = driver.x; player.y = driver.y; player.z = driver.z;
              dirty = true;
              send(ws, { type: 'boarded', driverId: driver.id, seat });
              if (driver.region && driver.region !== player.region) { player.region = driver.region; recomputeOwners(); }
            }
          }
        } else if (msg.type === 'unboard') {
          releaseRider(player, 'left');
        } else if (msg.type === 'drop') {
          // Cash dropped by the owner of the region (a body on the street)
          if (owners.get(player.region) !== playerId || typeof msg.id !== 'string' || msg.id.length > 24) return;
          if (drops.size >= MAX_DROPS) drops.delete(drops.keys().next().value);
          const d = {
            id: msg.id,
            x: num(msg.x, -WORLD_LIMIT, WORLD_LIMIT, 0),
            z: num(msg.z, -WORLD_LIMIT, WORLD_LIMIT, 0),
            amount: Math.floor(num(msg.amount, 1, 500, 5)),
            region: player.region,
            at: Date.now()
          };
          drops.set(d.id, d);
          toRegion(player.region, JSON.stringify({ type: 'drop', id: d.id, x: d.x, z: d.z, amount: d.amount }), null);
        } else if (msg.type === 'take') {
          const d = drops.get(msg.id);
          if (d && Math.hypot(d.x - player.x, d.z - player.z) <= TAKE_RANGE) {
            drops.delete(d.id);
            toRegion(d.region, JSON.stringify({ type: 'took', id: d.id, by: playerId, amount: d.amount }), null);
          }
        } else if (msg.type === 'chat') {
          const text = cleanText(msg.text);
          const now = Date.now();
          if (text && now - lastChatAt >= CHAT_MIN_INTERVAL_MS) {
            lastChatAt = now;
            broadcast({ type: 'chat', id: playerId, name: player.name, text });
          }
        } else if (msg.type === 'fire') {
          broadcast({
            type: 'shot',
            id: playerId,
            weapon: String(msg.weapon || '').slice(0, 24),
            ox: num(msg.ox, -WORLD_LIMIT, WORLD_LIMIT, player.x),
            oy: num(msg.oy, -100, 2000, player.y),
            oz: num(msg.oz, -WORLD_LIMIT, WORLD_LIMIT, player.z),
            dx: num(msg.dx, -1, 1, 0),
            dy: num(msg.dy, -1, 1, 0),
            dz: num(msg.dz, -1, 1, 0)
          }, playerId);
        } else if (msg.type === 'shoot') {
          if (msg.targetId && msg.targetId !== playerId && players.has(msg.targetId)) {
            sendHitNotification(msg.targetId, player.name, String(msg.weapon || '').slice(0, 24), num(msg.damage, 0, 100, 15));
          }
        } else if (msg.type === 'event') {
          if (msg.kind === 'explosion') {
            broadcast({
              type: 'event',
              kind: 'explosion',
              id: playerId,
              x: num(msg.x, -WORLD_LIMIT, WORLD_LIMIT, 0),
              y: num(msg.y, -100, 2000, 0),
              z: num(msg.z, -WORLD_LIMIT, WORLD_LIMIT, 0)
            }, playerId);
          }
        } else if (msg.type === 'died') {
          broadcast({ type: 'kill', victim: player.name, killer: msg.killer ? cleanName(msg.killer) : null });
        } else if (msg.type === 'ragdoll') {
          player.ragdoll = !!msg.ragdoll;
          dirty = true;
        } else if (msg.type === 'vats') {
          if (msg.targetId && players.has(msg.targetId)) {
            const event = {
              type: 'vats',
              shooterId: playerId,
              shooterName: player.name,
              targetId: msg.targetId,
              part: msg.part,
              shots: msg.shots,
              weapon: msg.weapon,
              success: msg.success
            };
            if (msg.success) sendHitNotification(msg.targetId, player.name, msg.weapon, 15);
            broadcast(event);
          }
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    });

    ws.on('close', () => {
      log(`Player disconnected: ${playerId}`);
      const gone = players.get(playerId);
      if (gone) {
        ejectRidersOf(gone, 'driver left');
      }
      players.delete(playerId);
      sockets.delete(playerId);
      recomputeOwners();
      broadcastPlayerList();
    });
  });

  wss.getPlayers = () => players;
  wss.getOwners = () => owners;
  return wss;
}

module.exports = { attachMultiplayer, MAX_PLAYERS, CAR_SEATS, cleanName, cleanText };
