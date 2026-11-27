// Never cache sessions, API responses, mailbox content or authenticated HTML.
const cacheName='sendar-offline-v1';
self.addEventListener('install',event=>event.waitUntil(caches.open(cacheName).then(cache=>cache.add('/sendar/offline/'))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('sendar-offline-')&&k!==cacheName).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method==='GET'&&event.request.mode==='navigate'&&url.origin===self.location.origin&&url.pathname.startsWith('/sendar/'))event.respondWith(fetch(event.request).catch(()=>caches.match('/sendar/offline/')));
});
