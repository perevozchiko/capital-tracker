// Bump CACHE_NAME for every frontend release. API responses are NEVER cached.
const CACHE_NAME='capital-tracker-static-0.1.3-dialogs';
const STATIC=['/','/index.html','/css/app.css','/js/boot.js','/js/app.js','/js/dialogs.js','/js/numbers.js','/js/i18n/en.js','/js/i18n/ru.js','/icons/favicon.svg','/icons/icon-192.png','/icons/icon-512.png','/manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const request=event.request;const u=new URL(request.url);
 if(request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/'))return;
 // Network first prevents a stale UI when the executable changes without a service worker update.
 event.respondWith(fetch(request).catch(async()=>await (await caches.open(CACHE_NAME)).match(request) || Response.error()));
});
