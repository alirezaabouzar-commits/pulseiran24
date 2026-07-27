/* ============================================================
   Pulse Iran 24 — Service Worker (v2)
   - نصب اپ روی گوشی (PWA)
   - دریافت و نمایش نوتیفیکیشن خبر فوری
   - استراتژی کش جدید: HTML همیشه از شبکه (تازه)، بقیه با
     به‌روزرسانی خودکار در پس‌زمینه — دیگر بعد از دیپلوی محتوای
     قدیمی گیر نمی‌کند.
   ============================================================ */

const CACHE = "pulse-shell-v2";   /* هر بار که خواستی کش کامل پاک شود، این عدد را زیاد کن */

/* فقط فایل‌های واقعاً ثابت را از قبل کش می‌کنیم — HTML را عمداً کش نمی‌کنیم
   تا همیشه نسخه‌ی تازه از شبکه بیاید. */
const SHELL = [
  "/manifest.webmanifest",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/apple-touch-icon.png",
  "/assets/og-image.jpg"
];

/* نصب: کش کردن فایل‌های ثابت (مقاوم به خطا) + فعال‌سازی فوری */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.allSettled(SHELL.map((u) => c.add(u)))
    ).then(() => self.skipWaiting())
  );
});

/* فعال‌سازی: پاک کردن همه‌ی کش‌های قدیمی + گرفتن کنترل فوری */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* اجازه به صفحه برای فعال‌سازی فوری نسخه‌ی جدید */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isHtmlRequest(req, url) {
  if (req.mode === "navigate") return true;               /* صفحه‌ها و iframeها */
  if (url.pathname.endsWith(".html")) return true;        /* rooydad.html و jarayed.html و... */
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  /* APIها و منابع پویا: همیشه مستقیم از شبکه، بدون کش */
  if (
    url.pathname.startsWith("/.netlify/") ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/tgimg" ||
    url.pathname === "/tgvid" ||
    url.pathname === "/news" ||
    url.pathname.startsWith("/news/")
  ) {
    return; /* بگذار مرورگر خودش شبکه را بزند */
  }

  /* منابع غیرهم‌مبدأ (kiosko، تصاویر بیرونی و...): کش نکن */
  if (url.origin !== self.location.origin) return;

  /* HTML: network-first — همیشه تازه، و اگر آفلاین بود از کش/صفحه‌ی اصلی */
  if (isHtmlRequest(req, url)) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() =>
        caches.match(req).then((r) => r || caches.match("/index.html") || caches.match("/"))
      )
    );
    return;
  }

  /* بقیه‌ی فایل‌های ثابت (عکس، css، js، فونت): stale-while-revalidate
     یعنی فوری از کش نشان بده، ولی هم‌زمان نسخه‌ی تازه را از شبکه بگیر و
     برای دفعه‌ی بعد ذخیره کن — پس حداکثر یک بار رفرش، محتوای نو می‌آید. */
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

/* دریافت نوتیفیکیشن خبر فوری */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }

  const title = data.title || "پالس ایران ۲۴";
  const options = {
    body: data.body || "خبر فوری",
    icon: "/assets/icon-192.png",
    badge: "/assets/icon-192.png",
    dir: "rtl",
    lang: "fa-IR",
    tag: data.tag || "breaking",
    data: { url: data.url || "/" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* کلیک روی نوتیفیکیشن: باز کردن سایت */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
