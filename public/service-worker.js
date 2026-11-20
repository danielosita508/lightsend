const cacheVersion = 'v2.0.0-lightsend-offline';
const cacheTitle = `lightsend-cache-${cacheVersion}`;
const relativePathsToCache = [
    './',
    'index.html',
    'manifest.json',
    'styles/styles-main.css',
    'styles/styles-deferred.css',
    'scripts/browser-tabs-connector.js',
    'scripts/localization.js',
    'scripts/main.js',
    'scripts/network.js',
    'scripts/persistent-storage.js',
    'scripts/ui.js',
    'scripts/ui-main.js',
    'scripts/util.js',
    'scripts/worker/canvas-worker.js',
    'scripts/libs/heic2any.min.js',
    'scripts/libs/no-sleep.min.js',
    'scripts/libs/qr-code.min.js',
    'scripts/libs/zip.min.js',
    'sounds/blop.mp3',
    'sounds/blop.ogg',
    'images/favicon-96x96.png',
    'images/favicon-96x96-notification.png',
    'images/android-chrome-192x192.png',
    'images/android-chrome-192x192-maskable.png',
    'images/android-chrome-512x512.png',
    'images/android-chrome-512x512-maskable.png',
    'images/apple-touch-icon.png',
    'fonts/OpenSans/static/OpenSans-Medium.ttf',
    'lang/ar.json',
    'lang/be.json',
    'lang/bg.json',
    'lang/ca.json',
    'lang/cs.json',
    'lang/da.json',
    'lang/de.json',
    'lang/en.json',
    'lang/es.json',
    'lang/et.json',
    'lang/eu.json',
    'lang/fa.json',
    'lang/fr.json',
    'lang/he.json',
    'lang/hu.json',
    'lang/id.json',
    'lang/it.json',
    'lang/ja.json',
    'lang/kn.json',
    'lang/ko.json',
    'lang/nb.json',
    'lang/nl.json',
    'lang/nn.json',
    'lang/pl.json',
    'lang/pt-BR.json',
    'lang/ro.json',
    'lang/ru.json',
    'lang/sk.json',
    'lang/ta.json',
    'lang/tr.json',
    'lang/uk.json',
    'lang/zh-CN.json',
    'lang/zh-HK.json',
    'lang/zh-TW.json'
];
const relativePathsNotToCache = [
    'config',
    'rtc-config'
];

self.addEventListener('install', function(event) {
    console.log("Pre-caching LightSend app shell for sw:", cacheVersion);
    event.waitUntil(
        caches.open(cacheTitle)
            .then(async function(cache) {
                await Promise.all(
                    relativePathsToCache.map(async path => {
                        try {
                            await cache.add(path);
                        } catch (err) {
                            console.warn("Could not precache file:", path, err);
                        }
                    })
                );
                console.log('App shell cached successfully for sw:', cacheVersion);
                return self.skipWaiting();
            })
    );
});

const rootUrl = location.href.substring(0, location.href.length - "service-worker.js".length);
const rootUrlLength = rootUrl.length;

const doNotCacheRequest = request => {
    const url = new URL(request.url);
    if (url.protocol === 'ws:' || url.protocol === 'wss:') return true;
    if (url.pathname.includes('/server') || url.pathname.includes('/rtc-config') || url.pathname.includes('/config')) return true;
    if (request.method !== 'GET') return true;
    const requestRelativePath = request.url.substring(rootUrlLength);
    return relativePathsNotToCache.indexOf(requestRelativePath) !== -1;
};

// General fetch strategy:
// 1. Navigation requests: Network-first with instant fallback to cached index.html when offline
// 2. Static assets: Cache-first strategy, falling back to network and caching
// 3. WebRTC / WebSocket / API endpoints: Never cached
self.addEventListener('fetch', function(event) {
    const swOrigin = new URL(self.location.href).origin;
    const requestOrigin = new URL(event.request.url).origin;

    // Do not intercept cross-origin requests (e.g. fonts.googleapis.com)
    if (swOrigin !== requestOrigin) {
        event.respondWith(fetch(event.request).catch(() => new Response('', { status: 408, statusText: 'Offline' })));
        return;
    }

    // Web Share Target POST request
    if (event.request.method === "POST") {
        event.respondWith((async () => {
            const share_url = await evaluateRequestData(event.request);
            return Response.redirect(encodeURI(share_url), 302);
        })());
        return;
    }

    // Do not cache WebSocket or API calls
    if (doNotCacheRequest(event.request)) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Navigation requests (HTML document loads)
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response && response.status === 200 && !response.redirected) {
                        const responseToCache = response.clone();
                        caches.open(cacheTitle).then(cache => cache.put(event.request, responseToCache));
                    }
                    return response;
                })
                .catch(async () => {
                    console.log("LightSend offline: serving cached index.html for navigation");
                    const cachedNav = await caches.match(event.request);
                    if (cachedNav) return cachedNav;
                    const cachedIndex = await caches.match('index.html');
                    if (cachedIndex) return cachedIndex;
                    return await caches.match('./');
                })
        );
        return;
    }

    // Cache-first strategy for static assets
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).then(networkResponse => {
                if (networkResponse && networkResponse.status === 200 && !networkResponse.redirected) {
                    const responseToCache = networkResponse.clone();
                    caches.open(cacheTitle).then(cache => cache.put(event.request, responseToCache));
                }
                return networkResponse;
            });
        }).catch(async error => {
            console.warn("Could not retrieve static asset:", event.request.url, error);
            if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
                const cachedIndex = await caches.match('index.html');
                if (cachedIndex) return cachedIndex;
            }
            return new Response('Offline resource unavailable', { status: 503, statusText: 'Offline' });
        })
    );
});

// Activation: delete older version caches
self.addEventListener('activate', evt => {
    console.log("Activate sw:", cacheVersion);
    evt.waitUntil(clients.claim());
    return evt.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== cacheTitle) {
                        console.log("Delete older cache:", cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

const evaluateRequestData = function (request) {
    return new Promise(async (resolve) => {
        const formData = await request.formData();
        const title = formData.get("title");
        const text = formData.get("text");
        const url = formData.get("url");
        const files = formData.getAll("allfiles");

        const pairDropUrl = request.url;

        if (files && files.length > 0) {
            let fileObjects = [];
            for (let i = 0; i < files.length; i++) {
                fileObjects.push({
                    name: files[i].name,
                    buffer: await files[i].arrayBuffer()
                });
            }

            const DBOpenRequest = indexedDB.open('pairdrop_store');
            DBOpenRequest.onsuccess = e => {
                const db = e.target.result;
                for (let i = 0; i < fileObjects.length; i++) {
                    const transaction = db.transaction('share_target_files', 'readwrite');
                    const objectStore = transaction.objectStore('share_target_files');

                    const objectStoreRequest = objectStore.add(fileObjects[i]);
                    objectStoreRequest.onsuccess = _ => {
                        if (i === fileObjects.length - 1) resolve(pairDropUrl + '?share_target=files');
                    }
                }
            }
            DBOpenRequest.onerror = _ => {
                resolve(pairDropUrl);
            }
        }
        else {
            let urlArgument = '?share_target=text';

            if (title) urlArgument += `&title=${title}`;
            if (text) urlArgument += `&text=${text}`;
            if (url) urlArgument += `&url=${url}`;

            resolve(pairDropUrl + urlArgument);
        }
    });
};
