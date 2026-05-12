const CACHE_NAME = 'opos-v4';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './style.css',
    './db.js',
    './preguntas.js',
    './script.js',
    './admin.js',
    './dexie.js',
    './icons/icon-512.png',
    './icons/icon-192.png',
    './icons/icon-180.png'
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
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    if (!e.request.url.startsWith(self.location.origin)) return;
    e.respondWith(
        caches.match(e.request).then(cachedResponse => {
            const networkFetch = fetch(e.request).then(networkResponse => {
                // Actualizamos la caché en segundo plano
                return caches.open(CACHE_NAME).then(cache => {
                    cache.put(e.request, networkResponse.clone());
                    return networkResponse;
                });
            });
            // Prioriza caché si existe, si no, espera a la red
            return cachedResponse || networkFetch.catch(() => {
                // Fallback: servir la app shell si t.odo falla
                return caches.match('./index.html');
            });
        })
    );
});