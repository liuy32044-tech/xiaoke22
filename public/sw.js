// Service Worker v2 — 网络优先，更新即时生效
const CACHE = "xiaoke-v2";
const STATIC = ["/","/index.html","/css/app.css","/js/app.js","/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // 清空所有旧版本缓存
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // ★ 只缓存 GET 请求。POST/PUT/DELETE 等一律放行
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // ★ API 请求一律放行。SSE 流式响应被 SW clone/cache.put 消费会导致浏览器读到空壳
  if (url.pathname.startsWith("/api/")) return;
  // JS/CSS/HTML: 网络优先（确保每次部署立即生效）
  if (url.pathname.match(/\.(js|css|html)$/) || url.pathname === "/") {
    e.respondWith(
      fetch(e.request)
        .then(r => { const clone = r.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); return r; })
        .catch(() => caches.match(e.request))
    );
  } else {
    // 图片/贴纸等静态资源：缓存优先
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(fr => { const clone = fr.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); return fr; })));
  }
});

self.addEventListener("push", (e) => {
  const data = e.data?.json() || { title: "小克想你啦", body: "来看看我吧~" };
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" }));
});
