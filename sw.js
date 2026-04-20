const CACHE_NAME = 'opos-v2';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './style.css',
    './db.js',
    './preguntas.js',
    './script.js',
    './admin.js',
    './dexie.js'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(c => c.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Estrategia: network-first con fallback a caché (tu elección previa)
self.addEventListener('fetch', e => {
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});