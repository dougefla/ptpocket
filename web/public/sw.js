/**
 * 极简 service worker：只缓存 app shell，让主屏图标离线也能打开。
 * API 一律走网络 —— 搜索结果和下载状态缓存了只会误导人。
 */
const CACHE = "ptpocket-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // 导航请求：网络优先，断网时回落到缓存的 shell
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/index.html").then((r) => r ?? Response.error())));
    return;
  }

  // 静态资源：缓存优先，后台补齐
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
