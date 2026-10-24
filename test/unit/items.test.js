import test from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, createItem, getItemDef, findItemDefByName } from '../../js/game/items.js';
import { GUNS, GUN_IDS, allWeaponDefs, buildGunModel } from '../../js/game/guns.js';

test('Guns: 30 distinct guns, each a complete item definition', () => {
    assert.equal(GUN_IDS.length, 30);
    const names = new Set();
    for (const id of GUN_IDS) {
        const g = GUNS[id];
        assert(!names.has(g.name), `unique name ${g.name}`);
        names.add(g.name);
        assert.equal(getItemDef(id), g, `${id} registered as an item`);
        assert.equal(g.kind, 'gun');
        assert.equal(g.type, 'gun');
        for (const k of ['damage', 'fireRate', 'magSize', 'range', 'projectileSpeed', 'recoil']) {
            assert(Number.isFinite(g[k]) && g[k] >= 0, `${id}.${k}`);
        }
        assert(g.reloadTime > 0 || g.reloadOne > 0, `${id} reloads`);
        assert(getItemDef(g.ammoItem), `${id} ammo item ${g.ammoItem}`);
        assert(['semi', 'auto', 'burst', 'pump', 'bolt', 'spin'].includes(g.mode), `${id} mode`);
        assert.equal(g.automatic, g.mode === 'auto' || g.mode === 'spin');
        assert(typeof g.sound === 'string' && g.sound.startsWith('/media/'), `${id} sound`);
    }
    // The original four keep their names (game API, tests, multiplayer messages)
    for (const n of ['Pistol', 'Rifle', 'Shotgun', 'RPG']) assert(findItemDefByName(n), n);
    assert.equal(findItemDefByName('Shotgun').sound, '/media/mp3/shotgun.mp3');
    const held = allWeaponDefs().map((d) => d.name);
    assert(held.includes('Hands') && held.includes('Spray Can'));
    assert.equal(held.length, 32);
});

test('Guns: every model builds with a muzzle in front of the grip', () => {
    for (const id of GUN_IDS) {
        const { group, muzzle, length } = buildGunModel(id);
        assert(group.children.length > 2, `${id} has parts`);
        assert(muzzle.z < -0.1, `${id} muzzle ahead (${muzzle.z.toFixed(2)})`);
        assert(length > 0.15 && length < 1.4, `${id} length ${length.toFixed(2)}`);
        group.traverse((o) => {
            if (!o.isMesh) return;
            for (const v of o.geometry.attributes.position.array) assert(Number.isFinite(v), `${id} finite geometry`);
        });
    }
});

test('Items: a new gun comes with a full magazine', () => {
    const ak = createItem('ak47');
    assert.equal(ak.count, 1);
    assert.equal(ak.data.mag, GUNS.ak47.magSize);
    const half = createItem('ak47', 1, { mag: 10 });
    assert.equal(half.data.mag, 10);
    assert.notEqual(ak.uid, half.uid);
});

test('Inventory: guns fill the hotbar, ammo stacks in the backpack', () => {
    const inv = new Inventory({ hotbarSize: 9, bagSize: 6 });
    assert.equal(inv.add(createItem('hands')), 0);
    assert.equal(inv.add(createItem('pistol')), 0);
    assert.equal(inv.add(createItem('ammo_9mm', 50)), 0);
    assert.equal(inv.add(createItem('ammo_9mm', 40)), 0);
    assert.equal(inv.get(0).id, 'hands');
    assert.equal(inv.get(1).id, 'pistol');
    // Ammo went to the backpack and merged into one stack
    assert.equal(inv.find('ammo_9mm'), 9);
    assert.equal(inv.count('ammo_9mm'), 90);
    assert.equal(inv.slots.filter((s) => s && s.id === 'ammo_9mm').length, 1);
    // Over a full stack spills into another slot
    inv.add(createItem('ammo_9mm', 300));
    assert.equal(inv.count('ammo_9mm'), 390);
    // Consume takes across stacks
    assert.equal(inv.consume('ammo_9mm', 350), 350);
    assert.equal(inv.count('ammo_9mm'), 40);
    assert.equal(inv.consume('ammo_9mm', 100), 40);
    assert.equal(inv.find('ammo_9mm'), -1);
});

test('Inventory: selecting, cycling, moving and taking', () => {
    const inv = new Inventory({ hotbarSize: 4, bagSize: 4 });
    inv.add(createItem('hands'));
    inv.add(createItem('pistol'));
    inv.add(createItem('shotgun'));
    let changes = 0;
    inv.onChange(() => changes++);
    inv.select(1);
    assert.equal(inv.selectedDef().id, 'pistol');
    inv.cycle(1);
    assert.equal(inv.selectedDef().id, 'shotgun');
    inv.cycle(1); // skips the empty slot 3, wraps to the fists
    assert.equal(inv.selectedDef().id, 'hands');
    inv.move(2, 6); // shotgun into the backpack
    assert.equal(inv.get(2), null);
    assert.equal(inv.get(6).id, 'shotgun');
    // Ammo can't go in the hotbar
    inv.add(createItem('ammo_12ga', 10));
    const ammoSlot = inv.find('ammo_12ga');
    inv.move(ammoSlot, 3);
    assert.equal(inv.find('ammo_12ga'), ammoSlot);
    // Fists can't be dropped; guns can
    assert.equal(inv.take(0), null);
    const gun = inv.take(1);
    assert.equal(gun.id, 'pistol');
    assert.equal(inv.get(1), null);
    assert(changes > 0);
    // A full inventory refuses what doesn't fit
    const tiny = new Inventory({ hotbarSize: 1, bagSize: 0 });
    tiny.add(createItem('pistol'));
    assert.equal(tiny.add(createItem('rifle')), 1);
});
