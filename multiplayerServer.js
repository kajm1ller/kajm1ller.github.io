/**
 * multiplayerServer.js
 *
 * WebSocket game server for Kaj Simulator multiplayer. Attached to the same HTTP(S) server that
 * serves the site, so the game connects to `ws(s)://<same host>`.
 *
 * Client -> server messages (JSON):
 *   join   { name, x, y, z, yaw }
 *   update { x, y, z, yaw, pitch, roll, state: 'foot'|'car'|'plane', color }
 *   chat   { text }
 *   fire   { weapon, ox, oy, oz, dx, dy, dz }        relayed to the other players as 'shot'
 *   shoot  { targetId, weapon, damage }              PvP hit on one player -> 'hit' to the target
 *   event  { kind: 'explosion', x, y, z }            relayed to the other players
 *   died   { killer }                                announced to everyone as 'kill'
 *   ragdoll / vats                                   legacy messages, unchanged
 *
 * Server -> client messages:
 *   welcome { id }, players { players: [...] } (batched ~15x/s), chat, shot, event, hit, kill, full
 */

const WebSocket = require('ws');

const MAX_PLAYERS = 16;
const TICK_MS = 66;            // player list broadcast interval
const CHAT_MIN_INTERVAL_MS = 700;
const MAX_CHAT_LENGTH = 120;
const MAX_NAME_LENGTH = 16;
const WORLD_LIMIT = 20000;
const STATES = new Set(['foot', 'car', 'plane']);

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
      ragdoll: p.ragdoll || false
    }));
  }

  function broadcastPlayerList() {
    dirty = false;
    broadcast({ type: 'players', players: playerList() });
  }

  function sendHitNotification(targetId, shooterName, weapon, damage) {
    send(sockets.get(targetId), { type: 'hit', shooterName, weapon, damage });
  }

  // Batch position updates instead of re-broadcasting the whole list for every single message
  const ticker = setInterval(() => { if (dirty) broadcastPlayerList(); }, TICK_MS);
  if (typeof ticker.unref === 'function') ticker.unref();
  wss.on('close', () => clearInterval(ticker));

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
            ragdoll: false
          });
          send(ws, { type: 'welcome', id: playerId });
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
          dirty = true;
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
      players.delete(playerId);
      sockets.delete(playerId);
      broadcastPlayerList();
    });
  });

  wss.getPlayers = () => players;
  return wss;
}

module.exports = { attachMultiplayer, MAX_PLAYERS, cleanName, cleanText };
