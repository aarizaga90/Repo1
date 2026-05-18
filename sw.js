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
    './icons/icon-180.png',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// Instalar: cachear todos los assets
/*self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(c => c.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});*/

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            // Cada asset falla de forma independiente — uno roto no cancela todo
            await Promise.all(
                ASSETS.map(url =>
                    cache.add(url).catch(err =>
                        console.warn(`SW: sin cachear ${url}`, err)
                    )
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// Activar: eliminar cachés antiguas y tomar control
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch: cache-first con revalidación en segundo plano
self.addEventListener('fetch', e => {
    if (!e.request.url.startsWith(self.location.origin)) return;

    e.respondWith(
        caches.match(e.request).then(cached => {
            const fromNetwork = fetch(e.request).then(response =>
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(e.request, response.clone());
                    return response;
                })
            );

            return cached || fromNetwork.catch(() => caches.match('./index.html'));
        })
    );
});