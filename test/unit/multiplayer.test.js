import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { MultiplayerClient, RemotePlayers, resolveServerUrl } from '../../js/game/multiplayer.js';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const { attachMultiplayer, MAX_PLAYERS, cleanName, cleanText } = require('../../multiplayerServer.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
    const server = http.createServer();
    const wss = attachMultiplayer(server);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `ws://127.0.0.1:${server.address().port}`;
    return { server, wss, url, close: () => new Promise((r) => { wss.close(); server.close(r); }) };
}

/** Minimal bot: connects, joins, records every message. */
async function bot(url, name, pose = {}) {
    const ws = new WebSocket(url);
    const inbox = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d)));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify(Object.assign({ type: 'join', name, x: 1, y: 0, z: 2, yaw: 0.5 }, pose)));
    const welcome = await waitFor(inbox, (m) => m.type === 'welcome');
    return { ws, inbox, id: welcome.id, send: (m) => ws.send(JSON.stringify(m)), close: () => ws.close() };
}

async function waitFor(inbox, pred, timeout = 2000) {
    const start = Date.now();
    for (;;) {
        const found = inbox.find(pred);
        if (found) return found;
        if (Date.now() - start > timeout) throw new Error('timed out waiting for message; got ' + JSON.stringify(inbox.slice(-5)));
        await sleep(15);
    }
}

test('server: join -> welcome and a player list that includes everyone', async () => {
    const s = await startServer();
    try {
        const a = await bot(s.url, 'Alice');
        const b = await bot(s.url, 'Bob');
        const list = await waitFor(b.inbox, (m) => m.type === 'players' && m.players.length === 2);
        const names = list.players.map((p) => p.name).sort();
        assert.deepEqual(names, ['Alice', 'Bob']);
        a.close(); b.close();
    } finally { await s.close(); }
});

test('server: batched pose updates carry state, color, pitch and roll', async () => {
    const s = await startServer();
    try {
        const a = await bot(s.url, 'Pilot');
        const b = await bot(s.url, 'Watcher');
        a.send({ type: 'update', x: 100, y: 50, z: -20, yaw: 1.2, pitch: 0.3, roll: -0.4, state: 'plane', color: 0xf5d142 });
        const msg = await waitFor(b.inbox, (m) => m.type === 'players' && m.players.some((p) => p.name === 'Pilot' && p.state === 'plane'));
        const p = msg.players.find((x) => x.name === 'Pilot');
        assert.equal(p.x, 100); assert.equal(p.y, 50); assert.equal(p.z, -20);
        assert.equal(p.yaw, 1.2); assert.equal(p.pitch, 0.3); assert.equal(p.roll, -0.4);
        assert.equal(p.color, 0xf5d142);
        a.close(); b.close();
    } finally { await s.close(); }
});

test('server: many updates do not flood clients (batched, not one broadcast per update)', async () => {
    const s = await startServer();
    try {
        const a = await bot(s.url, 'Spammer');
        const b = await bot(s.url, 'Listener');
        const before = b.inbox.filter((m) => m.type === 'players').length;
        for (let i = 0; i < 200; i++) a.send({ type: 'update', x: i, y: 0, z: 0, yaw: 0, state: 'foot' });
        await sleep(300);
        const received = b.inbox.filter((m) => m.type === 'players').length - before;
        assert.ok(received < 20, `received ${received} list broadcasts for 200 updates`);
        const last = b.inbox.filter((m) => m.type === 'players').pop().players.find((p) => p.name === 'Spammer');
        assert.equal(last.x, 199, 'latest position still arrives');
        a.close(); b.close();
    } finally { await s.close(); }
});

test('server: sanitizes names, rejects junk numbers, requires join before acting', async () => {
    assert.equal(cleanName('<script>alert(1)</script>'), 'scriptalert1scri');
    assert.equal(cleanName('   '), 'Player');
    assert.equal(cleanName('A'.repeat(50)).length, 16);
    assert.equal(cleanText('hi\u0000there\n'), 'hi there');

    const s = await startServer();
    try {
        const ghost = new WebSocket(s.url);
        await new Promise((r) => ghost.on('open', r));
        const got = [];
        ghost.on('message', (d) => got.push(JSON.parse(d)));
        ghost.send(JSON.stringify({ type: 'chat', text: 'not joined' }));
        const a = await bot(s.url, 'Real');
        a.send({ type: 'update', x: 'NaN', y: Infinity, z: 1e99, yaw: 'x', state: 'hacker', color: -5 });
        const msg = await waitFor(a.inbox, (m) => m.type === 'players' && m.players.some((p) => p.id === a.id && p.state === 'foot' && p.z === 20000));
        const me = msg.players.find((p) => p.id === a.id);
        assert.equal(me.z, 20000, 'clamped to world limit');
        assert.equal(me.state, 'foot', 'unknown state falls back to foot');
        assert.ok(Number.isFinite(me.x) && Number.isFinite(me.y));
        assert.equal(got.filter((m) => m.type === 'chat').length, 0, 'unjoined sockets cannot chat');
        ghost.close(); a.close();
    } finally { await s.close(); }
});

test('server: chat is broadcast to everyone (sender included) and rate limited', async () => {
    const s = await startServer();
    try {
        const a = await bot(s.url, 'Talker');
        const b = await bot(s.url, 'Hearer');
        a.send({ type: 'chat', text: 'hello world' });
        const heard = await waitFor(b.inbox, (m) => m.type === 'chat');
        assert.equal(heard.name, 'Talker'); assert.equal(heard.text, 'hello world');
        await waitFor(a.inbox, (m) => m.type === 'chat');
        for (let i = 0; i < 10; i++) a.send({ type: 'chat', text: 'spam ' + i });
        await sleep(200);
        assert.ok(b.inbox.filter((m) => m.type === 'chat').length <= 2, 'rapid chat is dropped');
        a.close(); b.close();
    } finally { await s.close(); }
});

test('server: shots are relayed to others only; PvP hits reach just the target with damage', async () => {
    const s = await startServer();
    try {
        const a = await bot(s.url, 'Shooter');
        const b = await bot(s.url, 'Victim');
        const c = await bot(s.url, 'Bystander');
        a.send({ type: 'fire', weapon: 'Pistol', ox: 0, oy: 1, oz: 0, dx: 0, dy: 0, dz: -1 });
        const shot = await waitFor(b.inbox, (m) => m.type === 'shot');
        assert.equal(shot.id, a.id); assert.equal(shot.weapon, 'Pistol');
        await sleep(100);
        assert.equal(a.inbox.filter((m) => m.type === 'shot').length, 0, 'shooter does not get an echo');

        a.send({ type: 'shoot', targetId: b.id, weapon: 'Pistol', damage: 25 });
        const hit = await waitFor(b.inbox, (m) => m.type === 'hit');
        assert.equal(hit.shooterName, 'Shooter'); assert.equal(hit.damage, 25);
        await sleep(100);
        assert.equal(c.inbox.filter((m) => m.type === 'hit').length, 0);
        a.send({ type: 'shoot', targetId: a.id, weapon: 'Pistol', damage: 25 });
        a.send({ type: 'shoot', targetId: b.id, weapon: 'Pistol', damage: 9999 });
        const big = await waitFor(b.inbox, (m) => m.type === 'hit' && m.damage === 100);
        assert.equal(big.damage, 100, 'damage is clamped');
        assert.equal(a.inbox.filter((m) => m.type === 'hit').length, 0, 'cannot shoot yourself');
        a.close(); b.close(); c.close();
    } finally { await s.close(); }
});

test('server: explosion events and kill announcements', async () => {
    const s = await startServer();
    try {
        const a = await bot(s.url, 'Pilot');
        const b = await bot(s.url, 'Watcher');
        a.send({ type: 'event', kind: 'explosion', x: 5, y: 6, z: 7 });
        const ev = await waitFor(b.inbox, (m) => m.type === 'event');
        assert.deepEqual([ev.x, ev.y, ev.z], [5, 6, 7]);
        a.send({ type: 'event', kind: 'bogus' });
        b.send({ type: 'died', killer: 'Pilot' });
        const kill = await waitFor(a.inbox, (m) => m.type === 'kill');
        assert.equal(kill.victim, 'Watcher'); assert.equal(kill.killer, 'Pilot');
        a.close(); b.close();
    } finally { await s.close(); }
});

test('server: leaving removes the player, and the server caps the player count', async () => {
    const s = await startServer();
    try {
        const a = await bot(s.url, 'Stayer');
        const b = await bot(s.url, 'Leaver');
        await waitFor(a.inbox, (m) => m.type === 'players' && m.players.length === 2);
        b.close();
        await waitFor(a.inbox, (m) => m.type === 'players' && m.players.length === 1);

        const crowd = [];
        for (let i = 0; i < MAX_PLAYERS - 1; i++) crowd.push(await bot(s.url, 'P' + i));
        const extra = new WebSocket(s.url);
        const inbox = [];
        extra.on('message', (d) => inbox.push(JSON.parse(d)));
        await new Promise((r) => extra.on('open', r));
        extra.send(JSON.stringify({ type: 'join', name: 'TooMany' }));
        await waitFor(inbox, (m) => m.type === 'full');
        crowd.forEach((c) => c.close());
        a.close();
    } finally { await s.close(); }
});

test('client: MultiplayerClient joins, reports status, and receives messages', async () => {
    const s = await startServer();
    try {
        const statuses = [];
        const received = [];
        const client = new MultiplayerClient({
            url: s.url,
            getJoinInfo: () => ({ name: 'Browser', x: 3, y: 0, z: 4, yaw: 0 }),
            onMessage: (m) => received.push(m),
            onStatus: (st) => statuses.push(st),
            WebSocketImpl: WebSocket
        });
        client.connect();
        await waitFor(received, (m) => m.type === 'welcome');
        assert.equal(client.status, 'online');
        assert.ok(client.id);
        assert.deepEqual(statuses, ['connecting', 'online']);
        assert.equal(client.send({ type: 'chat', text: 'hi' }), true);
        await waitFor(received, (m) => m.type === 'chat' && m.text === 'hi');
        client.disconnect();
        assert.equal(client.status, 'offline');
        assert.equal(client.send({ type: 'chat', text: 'nope' }), false);
    } finally { await s.close(); }
});

test('client: gives up after repeated failures instead of retrying forever', async () => {
    const statuses = [];
    // A port nothing listens on
    const client = new MultiplayerClient({
        url: 'ws://127.0.0.1:1',
        getJoinInfo: () => ({}),
        onMessage: () => {},
        onStatus: (st) => statuses.push(st),
        WebSocketImpl: WebSocket
    });
    client.failedAttempts = 5; // one more failure reaches the cap without waiting through the backoff delays
    client.connect();
    const start = Date.now();
    while (client.status !== 'offline' && Date.now() - start < 3000) await sleep(20);
    assert.equal(client.status, 'offline');
    assert.equal(client.wantConnection, false);
});

test('client: resolveServerUrl uses the page host, honours ?server=, and skips file://', () => {
    assert.equal(resolveServerUrl({ protocol: 'http:', host: 'localhost:3000', search: '' }), 'ws://localhost:3000');
    assert.equal(resolveServerUrl({ protocol: 'https:', host: 'kaj.services', search: '' }), 'wss://kaj.services');
    assert.equal(resolveServerUrl({ protocol: 'https:', host: 'x', search: '?server=ws://10.0.0.5:3000' }), 'ws://10.0.0.5:3000');
    assert.equal(resolveServerUrl({ protocol: 'file:', host: '', search: '' }), null);
});

test('RemotePlayers: adds, updates (car/plane/foot visuals), interpolates and removes players', () => {
    const scene = new THREE.Scene();
    const rp = new RemotePlayers(scene);
    rp.sync([
        { id: 'me', name: 'Me', x: 0, y: 0, z: 0, yaw: 0, state: 'foot' },
        { id: 'a', name: 'Anna', x: 10, y: 0, z: 10, yaw: 1, state: 'foot', color: 0 },
        { id: 'b', name: 'Ben', x: -5, y: 0, z: 0, yaw: 0, state: 'car', color: 0xcc2222 }
    ], 'me');
    assert.equal(rp.count, 2, 'self is not rendered');
    assert.equal(scene.children.length, 2);
    assert.ok(rp.players.get('a').visual.name.startsWith('remote_avatar'));
    assert.ok(rp.players.get('b').visual.userData.isHondaCivic, 'car players get a Civic');

    // Ben climbs into a plane: the visual is swapped, roll/pitch are applied
    rp.sync([
        { id: 'a', name: 'Anna', x: 10, y: 0, z: 10, yaw: 1, state: 'foot' },
        { id: 'b', name: 'Ben', x: 0, y: 80, z: 0, yaw: 0, pitch: 0.4, roll: 0.5, state: 'plane', color: 0xf5d142 }
    ], 'me');
    const ben = rp.players.get('b');
    assert.ok(ben.visual.userData.isPlane, 'plane players get a plane');
    for (let i = 0; i < 120; i++) rp.update(1 / 60);
    assert.ok(Math.abs(ben.root.position.y - 80) < 0.5, 'interpolated to the new altitude');
    assert.ok(Math.abs(ben.root.rotation.x - 0.4) < 0.02);
    assert.ok(Math.abs(ben.root.rotation.z + 0.5) < 0.02, 'right bank = negative z rotation, like the local plane');

    // Far jump (respawn) snaps instead of sliding across the map
    rp.sync([{ id: 'a', name: 'Anna', x: 500, y: 0, z: 500, yaw: 0, state: 'foot' }], 'me');
    rp.update(1 / 60);
    assert.equal(rp.players.get('a').root.position.x, 500);
    assert.equal(rp.count, 1, 'Ben left');
    assert.equal(scene.children.length, 1);

    const targets = rp.getHitTargets();
    assert.equal(targets.length, 1);
    assert.equal(targets[0].id, 'a');
    rp.dispose();
    assert.equal(scene.children.length, 0);
});
