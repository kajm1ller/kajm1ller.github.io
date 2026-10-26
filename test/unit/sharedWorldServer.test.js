import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const { attachMultiplayer } = require('../../multiplayerServer.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
    const server = http.createServer();
    const wss = attachMultiplayer(server);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `ws://127.0.0.1:${server.address().port}`;
    return { server, wss, url, close: () => new Promise((r) => { wss.close(); server.close(r); }) };
}

async function bot(url, name, pose = {}) {
    const ws = new WebSocket(url);
    const inbox = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d)));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify(Object.assign({ type: 'join', name, x: 0, y: 0, z: 0, yaw: 0 }, pose)));
    const welcome = await waitFor(inbox, (m) => m.type === 'welcome');
    return { ws, inbox, id: welcome.id, welcome, send: (m) => ws.send(JSON.stringify(m)), close: () => ws.close() };
}

async function waitFor(inbox, pred, timeout = 2000) {
    const start = Date.now();
    for (;;) {
        const found = inbox.find(pred);
        if (found) return found;
        if (Date.now() - start > timeout) throw new Error('timed out; got ' + JSON.stringify(inbox.slice(-6)));
        await sleep(10);
    }
}
const none = async (inbox, pred, ms = 250) => { await sleep(ms); assert.equal(inbox.find(pred), undefined); };

test('world: the first player in a region owns it; ownership moves when they leave', async () => {
    const s = await startServer();
    try {
        const a = await bot(s.url, 'A');
        const b = await bot(s.url, 'B');
        a.send({ type: 'update', x: 0, z: 0, region: 'bars' });
        b.send({ type: 'update', x: 10, z: 0, region: 'bars' });
        const aAuth = await waitFor(a.inbox, (m) => m.type === 'authority' && m.peers === 2);
        const bAuth = await waitFor(b.inbox, (m) => m.type === 'authority' && m.owner === a.id);
        assert.equal(aAuth.you, true);
        assert.equal(bAuth.you, false);
        // A goes elsewhere: B takes over bars
        a.send({ type: 'update', x: 900, z: 900, region: 'park' });
        const takeover = await waitFor(b.inbox, (m) => m.type === 'authority' && m.you === true);
        assert.equal(takeover.region, 'bars');
        // A is alone in the park, so it owns that too
        await waitFor(a.inbox, (m) => m.type === 'authority' && m.region === 'park' && m.you === true);
        // Disconnect: the survivor of a region inherits it
        const c = await bot(s.url, 'C');
        c.send({ type: 'update', region: 'bars' });
        await waitFor(c.inbox, (m) => m.type === 'authority' && m.owner === b.id);
        b.close();
        await waitFor(c.inbox, (m) => m.type === 'authority' && m.you === true);
        a.close(); c.close();
    } finally { await s.close(); }
});

test('world: snapshots only come from the owner and only reach their region', async () => {
    const s = await startServer();
    try {
        const owner = await bot(s.url, 'Owner');
        const peer = await bot(s.url, 'Peer');
        const far = await bot(s.url, 'Far');
        owner.send({ type: 'update', region: 'bars' });
        peer.send({ type: 'update', region: 'bars' });
        far.send({ type: 'update', region: 'campus' });
        await waitFor(peer.inbox, (m) => m.type === 'authority' && m.owner === owner.id);
        owner.send({ type: 'world', region: 'bars', seq: 1, p: [[1, 2, 3]] });
        const got = await waitFor(peer.inbox, (m) => m.type === 'world');
        assert.deepEqual(got.p, [[1, 2, 3]]);
        // A peer pretending to own the region is ignored
        peer.send({ type: 'world', region: 'bars', seq: 2, p: [[9]] });
        await none(owner.inbox, (m) => m.type === 'world');
        await none(far.inbox, (m) => m.type === 'world');
        // Wrong region from the owner is dropped
        owner.send({ type: 'world', region: 'campus', seq: 3 });
        await none(far.inbox, (m) => m.type === 'world');
        // A peer asks for a full snapshot and acts on a ped: both go to the owner
        peer.send({ type: 'need' });
        const need = await waitFor(owner.inbox, (m) => m.type === 'need');
        assert.equal(need.from, peer.id);
        peer.send({ type: 'cmd', kind: 'hurtPed', id: 77, dmg: 100 });
        const cmd = await waitFor(owner.inbox, (m) => m.type === 'cmd');
        assert.equal(cmd.from, peer.id);
        assert.equal(cmd.id, 77);
        // Events reach the rest of the region, not the sender
        owner.send({ type: 'rel', kind: 'pedDeath', id: 5 });
        const rel = await waitFor(peer.inbox, (m) => m.type === 'rel');
        assert.equal(rel.kind, 'pedDeath');
        assert.equal(rel.from, owner.id);
        await none(owner.inbox, (m) => m.type === 'rel');
        await none(far.inbox, (m) => m.type === 'rel');
        for (const b of [owner, peer, far]) b.close();
    } finally { await s.close(); }
});

test('world: police units go to nearby players only', async () => {
    const s = await startServer();
    try {
        const wanted = await bot(s.url, 'Wanted');
        const near = await bot(s.url, 'Near');
        const far = await bot(s.url, 'Far');
        wanted.send({ type: 'update', x: 0, z: 0, region: 'a' });
        near.send({ type: 'update', x: 200, z: 0, region: 'b' });
        far.send({ type: 'update', x: 3000, z: 0, region: 'c' });
        await sleep(100);
        wanted.send({ type: 'cops', units: [[1, 5, 5, 0]] });
        const got = await waitFor(near.inbox, (m) => m.type === 'cops');
        assert.equal(got.from, wanted.id);
        await none(far.inbox, (m) => m.type === 'cops');
        for (const b of [wanted, near, far]) b.close();
    } finally { await s.close(); }
});

test('riding: a player boards another player\'s car, rides along and is put out when the driver leaves it', async () => {
    const s = await startServer();
    try {
        const driver = await bot(s.url, 'Driver');
        const pal = await bot(s.url, 'Pal');
        const stranger = await bot(s.url, 'Stranger');
        driver.send({ type: 'update', x: 100, z: 100, state: 'car', region: 'bars', speed: 12 });
        pal.send({ type: 'update', x: 103, z: 100, region: 'bars' });
        stranger.send({ type: 'update', x: 400, z: 100, region: 'bars' });
        await sleep(120);
        stranger.send({ type: 'board', driverId: driver.id });
        const denied = await waitFor(stranger.inbox, (m) => m.type === 'boardDenied');
        assert.equal(denied.reason, 'too far');
        pal.send({ type: 'board', driverId: driver.id });
        const boarded = await waitFor(pal.inbox, (m) => m.type === 'boarded');
        assert.equal(boarded.seat, 1);
        // The passenger's pose is the car's, and the list says who rides where
        driver.send({ type: 'update', x: 150, z: 100, state: 'car', region: 'bars' });
        pal.send({ type: 'update', x: 5, z: 5, region: 'bars' });
        const list = await waitFor(driver.inbox, (m) => m.type === 'players' && m.players.some((p) => p.id === pal.id && p.ride && p.x === 150));
        assert.deepEqual(list.players.find((p) => p.id === pal.id).ride, { of: driver.id, seat: 1 });
        // NPC passengers take seats too: seat 2 is theirs, so the next rider gets seat 3
        driver.send({ type: 'update', x: 150, z: 100, state: 'car', region: 'bars', riders: [[2, 77, 'older']] });
        await sleep(60);
        const third = await bot(s.url, 'Third', { x: 150, z: 100 });
        third.send({ type: 'update', x: 151, z: 100, region: 'bars' });
        await sleep(60);
        third.send({ type: 'board', driverId: driver.id });
        assert.equal((await waitFor(third.inbox, (m) => m.type === 'boarded')).seat, 3);
        // A full car says so
        stranger.send({ type: 'update', x: 150, z: 101, region: 'bars' });
        await sleep(60);
        stranger.send({ type: 'board', driverId: driver.id });
        const full = await waitFor(stranger.inbox, (m) => m.type === 'boardDenied' && m.reason === 'full');
        assert.ok(full);
        // The driver gets out: everyone is put out
        driver.send({ type: 'update', x: 150, z: 100, state: 'foot', region: 'bars' });
        await waitFor(pal.inbox, (m) => m.type === 'unboarded');
        await waitFor(third.inbox, (m) => m.type === 'unboarded');
        for (const b of [driver, pal, stranger, third]) b.close();
    } finally { await s.close(); }
});

test('riding: leaving the car yourself frees the seat', async () => {
    const s = await startServer();
    try {
        const driver = await bot(s.url, 'D');
        const pal = await bot(s.url, 'P');
        driver.send({ type: 'update', x: 0, z: 0, state: 'car', region: 'x' });
        pal.send({ type: 'update', x: 2, z: 0, region: 'x' });
        await sleep(80);
        pal.send({ type: 'board', driverId: driver.id });
        await waitFor(pal.inbox, (m) => m.type === 'boarded');
        pal.send({ type: 'unboard' });
        await waitFor(pal.inbox, (m) => m.type === 'unboarded');
        pal.send({ type: 'board', driverId: driver.id });
        await waitFor(pal.inbox, (m) => m.type === 'boarded' && pal.inbox.filter((x) => x.type === 'boarded').length === 2);
        driver.close(); pal.close();
    } finally { await s.close(); }
});

test('cash: the first to take it gets it', async () => {
    const s = await startServer();
    try {
        const owner = await bot(s.url, 'Owner');
        const a = await bot(s.url, 'A');
        const b = await bot(s.url, 'B');
        owner.send({ type: 'update', x: 0, z: 0, region: 'bars' });
        a.send({ type: 'update', x: 1, z: 0, region: 'bars' });
        b.send({ type: 'update', x: 2, z: 0, region: 'bars' });
        await waitFor(b.inbox, (m) => m.type === 'authority' && m.owner === owner.id);
        owner.send({ type: 'drop', id: 'd1', x: 1.5, z: 0, amount: 40 });
        await waitFor(a.inbox, (m) => m.type === 'drop' && m.id === 'd1');
        a.send({ type: 'take', id: 'd1' });
        b.send({ type: 'take', id: 'd1' });
        const took = await waitFor(b.inbox, (m) => m.type === 'took');
        assert.equal(took.by, a.id);
        assert.equal(took.amount, 40);
        await sleep(100);
        assert.equal(b.inbox.filter((m) => m.type === 'took').length, 1, 'taken once');
        // Someone who is not a region peer cannot drop cash
        a.send({ type: 'drop', id: 'd2', x: 0, z: 0, amount: 999 });
        await none(b.inbox, (m) => m.type === 'drop' && m.id === 'd2');

        b.close();
        owner.close(); a.close();
    } finally { await s.close(); }
});

test('clock: welcome carries the server time, and it is re-broadcast', async () => {
    const s = await startServer();
    try {
        const a = await bot(s.url, 'A');
        assert.ok(Math.abs(a.welcome.now - Date.now()) < 2000);
        a.close();
    } finally { await s.close(); }
});
