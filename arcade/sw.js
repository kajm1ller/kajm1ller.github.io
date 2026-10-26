// Kaj Arcade service worker: files are cached as they load, so the games work offline after the first visit.
// Bump VERSION when files change so installed copies drop the old ones.
const VERSION = 'kaj-arcade-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './wallet.js', './index.js', './arcadeUI.js', './cards.js', './sfx.js'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});

// Same-origin GETs: answer from the cache and refresh it in the background (network if not cached yet)
self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
    e.respondWith(caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req, { ignoreSearch: true });
        const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
        if (hit) { net.catch(() => {}); return hit; }
        return net.catch(() => cache.match('./index.html'));
    }));
});
