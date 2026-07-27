/* build: v77 — رفع نمایش موجودیت‌های HTML خام مثل &#33; در متن خبر */
/* ============================================================
   Pulse Iran 24 — Cloudflare Pages Worker
   جایگزین کامل Netlify Functions:
   - /.netlify/functions/news  → خبرها از کانال تلگرام
   - /.netlify/functions/intl  → تیتر رسانه‌های بین‌المللی (RSS)
   - /.netlify/functions/stats → آمار (با KV اختیاری، وگرنه مخفی)
   - POST /                    → فرم تماس (Web3Forms)
   index.html بدون هیچ تغییری کار می‌کند.
   ============================================================ */

/* دامنه‌های پیش‌نمایش تلگرام — اگر اولی در دسترس نبود، بعدی امتحان می‌شود */
const TG_URLS = [
  "https://t.me/s/pulseiran24",
  "https://telegram.me/s/pulseiran24",
  "https://telegram.dog/s/pulseiran24"
];

/* برای فعال کردن فرم تماس: کلید را از web3forms.com بگیرید و
   یا اینجا جایگزین کنید، یا در تنظیمات Cloudflare Pages یک
   Environment variable با نام WEB3FORMS_KEY بسازید. */
const WEB3FORMS_KEY_FALLBACK = "6ffb7d51-99c9-4ddc-ae46-6e7e942c5126";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/worldcup") return handleWorldCup(url, env, ctx);
    if (path.startsWith("/news/")) return handleArticle(url, env, ctx);
    if (path === "/.netlify/functions/news") return handleNews(env, ctx);
    if (path === "/.netlify/functions/live") return handleLive(url);
    if (path === "/tgimg") return handleTgImg(url);
    if (path === "/tgvid") return handleTgVid(url, request);
    if (path === "/.netlify/functions/intl") return handleIntl();
    if (path === "/.netlify/functions/stats") return handleStats(url, env);
    if (path === "/api/podcasts") return handlePodcasts(env, ctx);
    if (path === "/api/rates") return handleRates(env, ctx);
    if (path === "/api/archive") return handleArchive(url, env);
    if (path === "/api/press-covers") return handlePressCovers(env, ctx);
    if (path === "/api/press-news") return handlePressNews();
    if (path === "/admin" || path === "/admin/") return handleAdminPage();
    if (path === "/admin/api") return handleAdminApi(request, env, ctx);
    if (path === "/sitemap.xml") return handleSitemap(url, env);
    if (path === "/news-sitemap.xml") return handleNewsSitemap(env);
    if (path === "/rss.xml" || path === "/feed.xml") return handleRss(url, env);
    if (path === "/robots.txt") return handleRobots(request, env);
    if (request.method === "POST" && path === "/") return handleContact(request, env);
    if (request.method === "GET" && (path === "/" || path === "/index.html")) {
      return handleHome(request, env, ctx, "fa");
    }
    if (request.method === "GET" && (path === "/en" || path === "/en/")) {
      return handleHome(request, env, ctx, "en");
    }
    if (request.method === "GET" && /^\/(en|de)\/news\/\d+$/.test(path)) {
      return handleArticle(url, env, ctx, path.slice(1, 3));
    }
    if (request.method === "GET" && (path === "/de" || path === "/de/")) {
      return handleHome(request, env, ctx, "de");
    }

    return env.ASSETS.fetch(request);
  }
};

/* ---------- جام جهانی ۲۰۲۶: نتایج زنده (ESPN) ----------
   منبع: API عمومی ESPN – رایگان، بدون کلید، به‌روزرسانی لحظه‌ای
   شامل گل‌ها، کارت‌ها و تعویض‌ها.
   کش: ۶۰ ثانیه هنگام بازی زنده، ۱۲۰ ثانیه در بقیه اوقات */

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
/* لیگ‌های پشتیبانی‌شده → کد ESPN */
const ESPN_LEAGUES = {
  wc: "fifa.world",          // جام جهانی
  ucl: "uefa.champions",     // لیگ قهرمانان اروپا
  epl: "eng.1",              // لیگ برتر انگلیس
  bundesliga: "ger.1",       // بوندسلیگا
  laliga: "esp.1",           // لالیگا
  seriea: "ita.1",           // سری آ
  ligue1: "fra.1"            // لوشامپیونه
};

function espnRound(ev) {
  try {
    const n = ev.competitions[0].notes;
    if (n && n.length && n[0].headline) {
      const h = n[0].headline;
      const map = {
        "Semifinals": "Semi-finals", "Semifinal": "Semi-finals",
        "Quarterfinals": "Quarter-finals", "Quarterfinal": "Quarter-finals",
        "Round of 16": "Round of 16", "Round of 32": "Round of 32",
        "Third-place match": "3rd Place Final", "Third Place": "3rd Place Final",
        "Final": "Final"
      };
      for (const k in map) if (h.indexOf(k) !== -1) return map[k];
      return h;
    }
  } catch (e) {}
  return "";
}

function espnClock(status) {
  /* "67'" یا "45'+3'" → دقیقه و وقت اضافه */
  const disp = (status && status.displayClock) || "";
  const m = disp.match(/(\d+)'(?:\s*\+\s*(\d+))?/);
  if (!m) return { elapsed: null, extra: null };
  return { elapsed: parseInt(m[1], 10), extra: m[2] ? parseInt(m[2], 10) : null };
}

function espnStatus(ev) {
  const st = (ev.status && ev.status.type) || {};
  const name = st.name || "";
  const state = st.state || "";
  if (name === "STATUS_HALFTIME") return "HT";
  if (name.indexOf("PEN") !== -1 && state === "in") return "P";
  if (state === "pre") return "NS";
  if (state === "post") {
    if (name === "STATUS_FINAL_PEN" || /pen/i.test(st.shortDetail || "")) return "PEN";
    if (/aet|extra/i.test(st.shortDetail || "") || name === "STATUS_FINAL_AET") return "AET";
    if (name === "STATUS_POSTPONED") return "PST";
    if (name === "STATUS_CANCELED" || name === "STATUS_CANCELLED") return "CANC";
    if (name === "STATUS_SUSPENDED") return "SUSP";
    return "FT";
  }
  /* state === "in" */
  const period = ev.status && ev.status.period;
  if (period === 1) return "1H";
  if (period === 2) return "2H";
  if (period >= 3) return "ET";
  return "LIVE";
}

function espnEventsFromKeyEvents(keyEvents, homeId) {
  const out = [];
  for (const ke of (keyEvents || [])) {
    const t = ((ke.type && ke.type.text) || "").toLowerCase();
    const clock = (ke.clock && ke.clock.displayValue) || "";
    const cm = clock.match(/(\d+)'(?:\s*\+\s*(\d+))?/);
    const elapsed = cm ? parseInt(cm[1], 10) : null;
    const extra = cm && cm[2] ? parseInt(cm[2], 10) : null;
    const teamName = (ke.team && (ke.team.displayName || ke.team.name)) || "";
    const players = ke.athletesInvolved || ke.participants || [];
    const p0 = players[0] && (players[0].displayName || (players[0].athlete && players[0].athlete.displayName)) || "?";
    const p1 = players[1] && (players[1].displayName || (players[1].athlete && players[1].athlete.displayName)) || null;

    if (t.indexOf("goal") !== -1) {
      let detail = "Normal Goal";
      if (t.indexOf("own") !== -1) detail = "Own Goal";
      else if (t.indexOf("penalty") !== -1 && t.indexOf("missed") !== -1) detail = "Missed Penalty";
      else if (t.indexOf("penalty") !== -1) detail = "Penalty";
      out.push({ time: { elapsed, extra }, type: "Goal", detail,
        player: { name: p0 }, assist: { name: p1 }, team: { name: teamName } });
    } else if (t.indexOf("yellow") !== -1 || t.indexOf("red") !== -1) {
      out.push({ time: { elapsed, extra }, type: "Card",
        detail: t.indexOf("red") !== -1 ? "Red Card" : "Yellow Card",
        player: { name: p0 }, assist: { name: null }, team: { name: teamName } });
    } else if (t.indexOf("substitution") !== -1 || t.indexOf("sub") === 0) {
      /* در ESPN بازیکن ورودی اول است */
      out.push({ time: { elapsed, extra }, type: "subst", detail: "Substitution",
        player: { name: p1 || "?" }, assist: { name: p0 }, team: { name: teamName } });
    }
  }
  out.sort((a, b) => (a.time.elapsed || 0) - (b.time.elapsed || 0));
  return out;
}

function espnDetailsEvents(comp) {
  /* پشتیبان: رویدادها از details در scoreboard (گل و کارت) */
  const out = [];
  const teams = {};
  for (const c of (comp.competitors || [])) teams[c.id] = (c.team && c.team.displayName) || "";
  for (const d of (comp.details || [])) {
    const clock = (d.clock && d.clock.displayValue) || "";
    const cm = clock.match(/(\d+)'(?:\s*\+\s*(\d+))?/);
    const elapsed = cm ? parseInt(cm[1], 10) : null;
    const extra = cm && cm[2] ? parseInt(cm[2], 10) : null;
    const teamName = teams[d.team && d.team.id] || "";
    const players = d.athletesInvolved || [];
    const p0 = (players[0] && players[0].displayName) || "?";
    const p1 = (players[1] && players[1].displayName) || null;
    if (d.scoringPlay) {
      let detail = "Normal Goal";
      if (d.ownGoal) detail = "Own Goal";
      else if (d.penaltyKick) detail = "Penalty";
      out.push({ time: { elapsed, extra }, type: "Goal", detail,
        player: { name: p0 }, assist: { name: p1 }, team: { name: teamName } });
    } else if (d.yellowCard || d.redCard) {
      out.push({ time: { elapsed, extra }, type: "Card",
        detail: d.redCard ? "Red Card" : "Yellow Card",
        player: { name: p0 }, assist: { name: null }, team: { name: teamName } });
    }
  }
  out.sort((a, b) => (a.time.elapsed || 0) - (b.time.elapsed || 0));
  return out;
}

function espnToFixture(ev, events) {
  const comp = (ev.competitions && ev.competitions[0]) || {};
  const comps = comp.competitors || [];
  const home = comps.find(c => c.homeAway === "home") || comps[0] || {};
  const away = comps.find(c => c.homeAway === "away") || comps[1] || {};
  const short = espnStatus(ev);
  const clk = espnClock(ev.status);
  const teamInfo = c => ({
    name: (c.team && (c.team.displayName || c.team.name)) || "?",
    logo: (c.team && (c.team.logo || (c.team.logos && c.team.logos[0] && c.team.logos[0].href))) || ""
  });
  const num = v => (v === undefined || v === null || v === "" ? null : parseInt(v, 10));
  const pensH = num(home.shootoutScore), pensA = num(away.shootoutScore);
  return {
    fixture: {
      id: ev.id,
      date: ev.date,
      status: { short, elapsed: clk.elapsed, extra: clk.extra }
    },
    league: { round: espnRound(ev) },
    teams: { home: teamInfo(home), away: teamInfo(away) },
    goals: { home: num(home.score), away: num(away.score) },
    score: { penalty: { home: pensH, away: pensA } },
    events: events || []
  };
}

async function handleWorldCup(url, env, ctx) {
  const lg = url.searchParams.get("league") || "wc";
  const espnLg = ESPN_LEAGUES[lg] || ESPN_LEAGUES.wc;
  const day = url.searchParams.get("day") || "today";
  const off = day === "yesterday" ? -1 : day === "tomorrow" ? 1 : 0;
  const target = new Date(Date.now() + off * 86400000);
  const dateStr = target.toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });

  const cache = caches.default;
  const cacheKey = new Request("https://cache.pulseiran24.internal/worldcup-espn?lg=" + espnLg + "&date=" + dateStr);
  const hit = await cache.match(cacheKey);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set("Access-Control-Allow-Origin", "*");
    return r;
  }

  try {
    /* یک روز قبل و بعد (اختلاف منطقه زمانی آمریکا/اروپا) و فیلتر بر اساس تاریخ برلین */
    const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, "");
    const from = fmt(new Date(target.getTime() - 86400000));
    const to = fmt(new Date(target.getTime() + 86400000));
    const sbRes = await fetch(ESPN_BASE + "/" + espnLg + "/scoreboard?dates=" + from + "-" + to,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; PulseIran24/1.0)" } });
    if (!sbRes.ok) throw new Error("upstream " + sbRes.status);
    const sb = await sbRes.json();
    const all = sb.events || [];

    const sameDay = all.filter(ev => {
      const local = new Date(ev.date).toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
      return local === dateStr;
    });

    const LIVE = ["1H", "2H", "ET", "BT", "P", "HT", "LIVE", "INT"];
    const fixtures = [];
    for (const ev of sameDay) {
      const short = espnStatus(ev);
      let events = [];
      if (LIVE.includes(short) || ["FT", "AET", "PEN"].includes(short)) {
        /* رویدادهای کامل (شامل تعویض‌ها) از summary */
        try {
          const smRes = await fetch(ESPN_BASE + "/" + espnLg + "/summary?event=" + ev.id,
            { headers: { "User-Agent": "Mozilla/5.0 (compatible; PulseIran24/1.0)" } });
          if (smRes.ok) {
            const sm = await smRes.json();
            if (sm.keyEvents && sm.keyEvents.length) events = espnEventsFromKeyEvents(sm.keyEvents);
          }
        } catch (e) {}
        if (!events.length) {
          events = espnDetailsEvents((ev.competitions && ev.competitions[0]) || {});
        }
      }
      fixtures.push(espnToFixture(ev, events));
    }

    const anyLive = fixtures.some(fx => LIVE.includes(fx.fixture.status.short));
    const ttl = anyLive ? 60 : 120;

    const resp = new Response(JSON.stringify({ date: dateStr, response: fixtures }), {
      headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=" + ttl }
    });
    if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    else await cache.put(cacheKey, resp.clone());
    return resp;
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 502, headers: JSON_HEADERS
    });
  }
}

/* ---------- خبرها از تلگرام ---------- */

function cleanText(raw) {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
    /* هر موجودیت عددی HTML دیگر (مثل &#33; برای «!») که تلگرام گاهی به‌جای کاراکتر خام می‌فرستد */
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parsePosts(html) {
  const posts = [];
  const blocks = html.split("tgme_widget_message_wrap").slice(1);
  for (const block of blocks) {
    const linkM = block.match(/class="tgme_widget_message_date"[^>]*href="([^"]+)"/);
    const timeM = block.match(/<time[^>]*datetime="([^"]+)"/);
    const textM = block.match(/js-message_text[^>]*>([\s\S]*?)<\/div>/);
    const photoM = block.match(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/);
    const videoM = block.match(/<video[^>]*src="([^"]+)"/);
    const vthumbM = block.match(/tgme_widget_message_video_thumb[^>]*background-image:url\('([^']+)'\)/);
    if (!textM) continue;
    const text = cleanText(textM[1]);
    if (!text) continue;
    let link = linkM ? linkM[1] : "https://t.me/pulseiran24";
    if (!/^https:\/\/t\.me\//.test(link)) link = "https://t.me/pulseiran24";
    /* دامنه پشتیبان — لینک‌ها حتی هنگام اختلال t.me هم کار کنند */
    link = link.replace("https://t.me/", "https://telegram.me/");
    const photo = photoM && /^https:\/\//.test(photoM[1])
      ? "/tgimg?u=" + encodeURIComponent(photoM[1])
      : null;
    const video = videoM && /^https:\/\//.test(videoM[1])
      ? "/tgvid?u=" + encodeURIComponent(videoM[1])
      : null;
    const vthumb = vthumbM && /^https:\/\//.test(vthumbM[1])
      ? "/tgimg?u=" + encodeURIComponent(vthumbM[1])
      : null;
    posts.push({ text, link, published: timeM ? timeM[1] : null, photo, video, vthumb });
  }
  return posts.slice(-20).reverse();
}

/* ---------- تشخیص پخش زنده یوتیوب ----------
   ch=me   → کانال یوتیوب پالس ایران ۲۴ (لایو اضطراری خودتان)
   ch=intl → ایران اینترنشنال (پلیر رسمی یوتیوب خودشان) */

const LIVE_CHANNELS = {
  me:        "https://www.youtube.com/@pulseiran24/live",
  intl:      "https://www.youtube.com/@IRANINTL/live",
  voa:       "https://www.youtube.com/channel/UCttfDeGMwUxPjnlsKagcwKw/live",
  aljazeera: "https://www.youtube.com/channel/UCNye-wNBqNL5ZzHSJj3l8Bg/live",
  france24:  "https://www.youtube.com/@France24_en/live",
  dw:        "https://www.youtube.com/@dwnews/live",
  ard:       "https://www.youtube.com/@tagesschau/live"
};

async function handleLive(url) {
  const ch = url.searchParams.get("ch") || "me";
  const target = LIVE_CHANNELS[ch];
  if (!target) return new Response(JSON.stringify({ ok: false }), { status: 400, headers: JSON_HEADERS });
  try {
    const r = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "en",
        "Cookie": "CONSENT=YES+cb.20240101-00-p0.en+FX+000; SOCS=CAI"
      },
      cf: { cacheTtl: 60, cacheEverything: true },
      redirect: "follow"
    });
    if (!r.ok) throw new Error("yt " + r.status);
    const html = await r.text();

    /* سه شرط سخت‌گیرانه — همه باید برقرار باشند:
       ۱) صفحه واقعاً متعلق به همین کانال باشد (نه صفحه عمومی یوتیوب)
          — فقط وقتی آدرس شامل @handle است این بررسی انجام می‌شود */
    const handleM = target.match(/@[\w.-]+/);
    if (handleM && !html.toLowerCase().includes(handleM[0].toLowerCase())) throw new Error("wrong page");

    /* ۲) لینک canonical باید به یک صفحه watch اشاره کند (فقط وقتی لایو فعال است) */
    const canonM = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/);

    /* ۳) نشانگر لایو بودن */
    const isLive = html.includes('"isLive":true') || html.includes('"isLiveNow":true');

    const live = !!(canonM && isLive);
    return new Response(JSON.stringify({ ok: true, live, id: live ? canonM[1] : null }), {
      headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=60" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, live: false, error: String(e && e.message || e) }), {
      status: 200, headers: JSON_HEADERS
    });
  }
}

/* پروکسی ویدیوهای تلگرام — با پشتیبانی Range برای پخش روان */
async function handleTgVid(url, request) {
  const u = url.searchParams.get("u") || "";
  let target;
  try { target = new URL(u); } catch (e) { return new Response("bad url", { status: 400 }); }
  const host = target.hostname;
  const allowed = host.endsWith(".telesco.pe") || host === "telesco.pe" ||
                  host.endsWith(".cdn-telegram.org") || host === "cdn-telegram.org";
  if (target.protocol !== "https:" || !allowed) return new Response("forbidden", { status: 403 });
  try {
    const fwd = { "User-Agent": "Mozilla/5.0" };
    const range = request.headers.get("Range");
    if (range) fwd["Range"] = range;
    const r = await fetch(target.toString(), { headers: fwd });
    if (!r.ok && r.status !== 206) return new Response("upstream " + r.status, { status: 502 });
    const headers = {
      "Content-Type": r.headers.get("Content-Type") || "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400"
    };
    const cr = r.headers.get("Content-Range");
    if (cr) headers["Content-Range"] = cr;
    const cl = r.headers.get("Content-Length");
    if (cl) headers["Content-Length"] = cl;
    return new Response(r.body, { status: r.status, headers });
  } catch (e) {
    return new Response("fetch failed", { status: 502 });
  }
}

/* پروکسی امن عکس‌های تلگرام — فقط دامنه‌های CDN تلگرام مجازند */
async function handleTgImg(url) {
  const u = url.searchParams.get("u") || "";
  let target;
  try { target = new URL(u); } catch (e) { return new Response("bad url", { status: 400 }); }
  const host = target.hostname;
  const allowed = host.endsWith(".telesco.pe") || host === "telesco.pe" ||
                  host.endsWith(".cdn-telegram.org") || host === "cdn-telegram.org";
  if (target.protocol !== "https:" || !allowed) return new Response("forbidden", { status: 403 });
  try {
    const r = await fetch(target.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" },
      cf: { cacheTtl: 86400, cacheEverything: true }
    });
    if (!r.ok) return new Response("upstream " + r.status, { status: 502 });
    return new Response(r.body, {
      headers: {
        "Content-Type": r.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400"
      }
    });
  } catch (e) {
    return new Response("fetch failed", { status: 502 });
  }
}

async function fetchLivePosts() {
  const errors = [];
  for (const tgUrl of TG_URLS) {
    try {
      const r = await fetch(tgUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          "Accept-Language": "fa,en;q=0.8"
        },
        cf: { cacheTtl: 120, cacheEverything: true }
      });
      if (!r.ok) throw new Error(new URL(tgUrl).hostname + " " + r.status);
      const posts = parsePosts(await r.text());
      if (!posts.length) throw new Error(new URL(tgUrl).hostname + " no posts");
      return posts;
    } catch (e) {
      errors.push(String(e && e.message || e));
    }
  }
  throw new Error(errors.join(" | ") || "no source available");
}

function extractId(link) {
  const m = String(link || "").match(/\/(\d+)$/);
  return m ? m[1] : null;
}

/* ذخیره‌ی سبک خبرهای جدید در KV تا لینک صفحه‌ی اختصاصی هر خبر
   حتی بعد از خارج شدن از فهرست ۲۰تایی اخیر تلگرام هم کار کند.
   فقط ۳ خبر جدیدتر هر بار بررسی می‌شود تا فشار کمی به KV وارد شود. */
function scheduleArticleCache(env, ctx, posts) {
  if (!env || !env.PULSE_STATS || !ctx || !ctx.waitUntil) return;
  const kv = env.PULSE_STATS;
  const candidates = (posts || []).slice(0, 10);
  ctx.waitUntil((async () => {
    let index = [];
    try { index = JSON.parse(await kv.get("article_index") || "[]"); } catch (e) { index = []; }
    if (!Array.isArray(index)) index = [];
    const seen = new Set(index.map(x => x.id));
    let changed = false;
    for (const p of candidates) {
      const id = extractId(p.link);
      if (!id) continue;
      try {
        const existing = await kv.get("article:" + id);
        if (!existing) await kv.put("article:" + id, JSON.stringify(p));
      } catch (e) {}
      if (!seen.has(id)) {
        seen.add(id);
        index.push({ id: id, text: (p.text || "").slice(0, 220), published: p.published || null, photo: p.photo || null });
        changed = true;
      }
    }
    if (changed) {
      index.sort((a, b) => (parseInt(b.id) || 0) - (parseInt(a.id) || 0));
      if (index.length > 1000) index = index.slice(0, 1000);
      try { await kv.put("article_index", JSON.stringify(index)); } catch (e) {}
    }
  })());
}

/* ---------- آرشیو و جستجو ---------- */
async function handleArchive(url, env) {
  const kv = env && env.PULSE_STATS;
  if (!kv) return new Response(JSON.stringify({ ok: true, items: [], total: 0, page: 1 }), { headers: JSON_HEADERS });
  let index = [];
  try { index = JSON.parse(await kv.get("article_index") || "[]"); } catch (e) { index = []; }
  if (!Array.isArray(index)) index = [];
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = 20;
  let filtered = index;
  if (q) filtered = index.filter(x => (x.text || "").toLowerCase().includes(q));
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  const body = JSON.stringify({ ok: true, items: items, total: total, page: page, pageSize: pageSize });
  return new Response(body, { headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=60" } });
}

/* ---------- صفحه اصلی با اخبار رندرشده در سمت سرور ----------
   گوگل و سایر خزنده‌ها در HTML اولیه خبری نمی‌دیدند (واکشی با جاوااسکریپت).
   اینجا آخرین خبرها را سمت سرور داخل news-grid تزریق می‌کنیم؛
   جاوااسکریپت سمت کاربر بعداً همان بخش را با نسخه‌ی تعاملی جایگزین می‌کند.
   خروجی ۲ دقیقه در کش می‌ماند تا سرعت صفحه حفظ شود. */

/* ---------- ترجمه در سمت سرور با کش دائمی در KV ----------
   هدف: نسخه‌های انگلیسی و آلمانی هم برای گوگل قابل ایندکس شوند.
   هر متن فقط یک بار ترجمه می‌شود و بعد از KV خوانده می‌شود. */

function trHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + "-" + s.length;
}

async function translateOne(text, target, env) {
  const src = String(text || "").trim();
  if (!src) return "";
  const kv = env.PULSE_STATS;
  const key = "tr:" + target + ":" + trHash(src);

  if (kv) {
    try {
      const hit = await kv.get(key);
      if (hit) return hit;
    } catch (e) {}
  }

  let out = "";
  try {
    const r = await fetch(
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=fa&tl=" +
      target + "&dt=t&q=" + encodeURIComponent(src.slice(0, 1800))
    );
    if (r.ok) {
      const d = await r.json();
      if (d && d[0]) out = d[0].map(seg => seg[0]).join("");
    }
  } catch (e) {}

  if (!out) {
    try {
      const r = await fetch(
        "https://api.mymemory.translated.net/get?q=" +
        encodeURIComponent(src.slice(0, 480)) + "&langpair=fa|" + target
      );
      if (r.ok) {
        const d = await r.json();
        out = (d && d.responseData && d.responseData.translatedText) || "";
      }
    } catch (e) {}
  }

  if (!out) return src; /* در بدترین حالت متن فارسی می‌ماند */
  if (kv) {
    try { await kv.put(key, out, { expirationTtl: 60 * 60 * 24 * 90 }); } catch (e) {}
  }
  return out;
}

function serverPostId(p) {
  const m = String((p && p.link) || "").match(/\/(\d+)$/);
  return m ? m[1] : null;
}

const SSR_LABELS = {
  fa: { brand: "پالس ایران ۲۴", more: "ادامه مطلب ←" },
  en: { brand: "Pulse Iran 24", more: "Read more →" },
  de: { brand: "Pulse Iran 24", more: "Weiterlesen →" }
};

function ssrCardsHtml(posts, lang, tr) {
  const L = SSR_LABELS[lang] || SSR_LABELS.fa;
  const cards = [];
  for (const p of posts.slice(0, 12)) {
    const id = serverPostId(p);
    const parts = splitTitleBody(p.text);
    let title = parts.title;
    let summary = parts.paragraphs.join(" ").replace(/\s+/g, " ").trim();
    if (summary.length > 220) summary = summary.slice(0, 217) + "…";
    if (tr) {
      title = tr[title] || title;
      summary = tr[summary] || summary;
    }
    const href = id ? "/news/" + id : (p.link || "#");
    const dateAttr = p.published ? escHtml(p.published) : "";
    let shown = "";
    if (p.published) {
      shown = lang === "fa"
        ? formatFaDate(p.published)
        : new Date(p.published).toISOString().slice(0, 10);
    }
    const img = p.photo
      ? `<img class="news-photo" src="${escHtml(p.photo)}" alt="${escHtml(title)}" loading="lazy">`
      : "";
    cards.push(
      `<article class="news-card"><div class="news-meta"><span class="tag blue">${escHtml(L.brand)}</span>` +
      `<time class="news-time" datetime="${dateAttr}">${escHtml(shown)}</time></div>` +
      img +
      `<h3><a href="${escHtml(href)}" style="color:inherit;text-decoration:none">${escHtml(title)}</a></h3>` +
      (summary ? `<p>${escHtml(summary)}</p>` : "") +
      `<div class="card-actions"><a class="news-readmore" href="${escHtml(href)}">${escHtml(L.more)}</a></div></article>`
    );
  }
  return cards.join("\n");
}

async function handleHome(request, env, ctx, lang) {
  lang = lang || "fa";
  try {
    const cache = caches.default;
    const cacheKey = new Request(new URL("/__home_ssr_" + lang, request.url).toString());
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const rootReq = new Request(new URL("/index.html", request.url).toString(), { method: "GET" });
    const assetResp = await env.ASSETS.fetch(rootReq);
    const ct = assetResp.headers.get("Content-Type") || "";
    if (!assetResp.ok || ct.indexOf("text/html") === -1) return assetResp;
    let html = await assetResp.text();

    let posts = [];
    try {
      const manual = await getManualPosts(env);
      let tg = [];
      try { tg = await fetchLivePosts(); scheduleArticleCache(env, ctx, tg); } catch (e) {}
      posts = mergePosts(manual, tg);
    } catch (e) {}

    /* برای زبان‌های غیرفارسی، تیتر و خلاصه را یک‌بار ترجمه و کش کن */
    let tr = null;
    if (lang !== "fa" && posts.length) {
      const texts = new Set();
      for (const p of posts.slice(0, 12)) {
        const parts = splitTitleBody(p.text);
        if (parts.title) texts.add(parts.title);
        let s = parts.paragraphs.join(" ").replace(/\s+/g, " ").trim();
        if (s.length > 220) s = s.slice(0, 217) + "…";
        if (s) texts.add(s);
      }
      const list = Array.from(texts);
      try {
        const done = await Promise.all(list.map(t => translateOne(t, lang, env)));
        tr = {};
        list.forEach((t, i) => { tr[t] = done[i]; });
      } catch (e) { tr = null; }
    }

    const marker = '<div class="news-grid" id="newsGrid"></div>';
    if (posts.length && html.indexOf(marker) !== -1) {
      html = html.replace(marker, '<div class="news-grid" id="newsGrid">' + ssrCardsHtml(posts, lang, tr) + "</div>");
    }

    if (lang !== "fa") {
      const dir = "ltr";
      html = html.replace('<html lang="fa" dir="rtl">', '<html lang="' + lang + '" dir="' + dir + '">');
      html = html.replace(
        '<link rel="canonical" href="https://pulseiran24.com/">',
        '<link rel="canonical" href="https://pulseiran24.com/' + lang + '">'
      );
      html = html.replace(
        '<meta property="og:locale" content="fa_IR">',
        '<meta property="og:locale" content="' + (lang === "de" ? "de_DE" : "en_US") + '">'
      );
      html = html.replace("</head>", '<script>window.__PI24_LANG="' + lang + '";</script>\n</head>');
    }

    const resp = new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
        "Cache-Control": "public, max-age=120"
      }
    });
    try { ctx.waitUntil(cache.put(cacheKey, resp.clone())); } catch (e) {}
    return resp;
  } catch (e) {
    return env.ASSETS.fetch(request);
  }
}

/* ---------- سایت‌مپ ویژه Google News (فقط خبرهای ۴۸ ساعت اخیر) ---------- */
async function handleNewsSitemap(env) {
  let posts = [];
  try {
    const manual = await getManualPosts(env);
    let tg = [];
    try { tg = await fetchLivePosts(); } catch (e) {}
    posts = mergePosts(manual, tg);
  } catch (e) {}

  const cutoff = Date.now() - 48 * 3600 * 1000;
  const items = [];
  for (const p of posts) {
    const id = serverPostId(p);
    if (!id) continue;
    const t = Date.parse(p.published || "");
    if (isNaN(t) || t < cutoff) continue;
    const { title } = splitTitleBody(p.text);
    items.push(
      `  <url>\n` +
      `    <loc>${SITE_ORIGIN}/news/${id}</loc>\n` +
      `    <news:news>\n` +
      `      <news:publication>\n` +
      `        <news:name>Pulse Iran 24</news:name>\n` +
      `        <news:language>fa</news:language>\n` +
      `      </news:publication>\n` +
      `      <news:publication_date>${new Date(t).toISOString()}</news:publication_date>\n` +
      `      <news:title>${escHtml(title)}</news:title>\n` +
      `    </news:news>\n` +
      `  </url>`
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n` +
    items.join("\n") + `\n</urlset>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=UTF-8", "Cache-Control": "public, max-age=600" }
  });
}

async function handleNews(env, ctx) {
  /* خبرهای دستی (مستقل از تلگرام) همیشه از KV خوانده می‌شوند */
  const manual = await getManualPosts(env);

  /* خبرهای تلگرام — اگر در دسترس نبود، فقط خبرهای دستی نشان داده می‌شوند */
  let tg = [];
  let tgError = null;
  try {
    tg = await fetchLivePosts();
    scheduleArticleCache(env, ctx, tg);
  } catch (e) {
    tgError = String(e && e.message || e);
  }

  const posts = mergePosts(manual, tg);

  if (!posts.length) {
    /* هیچ خبری از هیچ منبعی نبود */
    return new Response(JSON.stringify({ ok: false, error: tgError || "no posts" }), {
      status: 502, headers: JSON_HEADERS
    });
  }

  return new Response(JSON.stringify({ ok: true, posts, telegram: !tgError }), {
    headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=120" }
  });
}

/* ادغام خبر دستی و تلگرام و مرتب‌سازی بر اساس زمان انتشار (جدیدترین اول) */
function mergePosts(manual, tg) {
  const all = [].concat(manual || [], tg || []);
  const key = p => {
    const t = Date.parse(p && p.published);
    if (!isNaN(t)) return t;
    const m = String((p && p.link) || "").match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };
  all.sort((a, b) => key(b) - key(a));
  return all.slice(0, 25);
}

/* ---------- تیتر رسانه‌های بین‌المللی ---------- */

const INTL_FEEDS = [
  { s: "بی‌بی‌سی فارسی",  url: "https://feeds.bbci.co.uk/persian/rss.xml" },
  { s: "دویچه وله فارسی", url: "https://rss.dw.com/rdf/rss-per-all" },
  { s: "BBC",        url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { s: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { s: "DW",         url: "https://rss.dw.com/rdf/rss-en-world" }
];

function decodeEntities(t) {
  return t
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .trim();
}

function parseFeed(xml, source, max) {
  const items = [];
  const re = /<item[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>[\s\S]*?<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < max) {
    const t = decodeEntities(m[1]).replace(/<[^>]+>/g, "").trim();
    const l = m[2].trim();
    if (t && /^https?:\/\//.test(l)) items.push({ s: source, t, l });
  }
  return items;
}

async function handleIntl() {
  const results = await Promise.allSettled(
    INTL_FEEDS.map(async f => {
      const r = await fetch(f.url, {
        headers: { "User-Agent": "Mozilla/5.0 (PulseIran24 NewsBar)" },
        cf: { cacheTtl: 600, cacheEverything: true }
      });
      if (!r.ok) throw new Error(f.s + " " + r.status);
      return parseFeed(await r.text(), f.s, 2);
    })
  );
  const items = [];
  for (const res of results) if (res.status === "fulfilled") items.push(...res.value);
  if (!items.length) {
    return new Response(JSON.stringify({ ok: false }), { status: 502, headers: JSON_HEADERS });
  }
  return new Response(JSON.stringify({ ok: true, items }), {
    headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=600" }
  });
}

/* ---------- صفحه‌ی اختصاصی هر خبر (/news/{id}) ----------
   برای دیده‌شدن در گوگل و پیش‌نمایش زیبا هنگام اشتراک‌گذاری.
   اول از کش KV می‌خواند (اگر موجود بود)، وگرنه از فهرست زنده‌ی
   تلگرام جستجو می‌کند. اگر جایی پیدا نشد، صفحه‌ی «یافت نشد». */

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
const FA_MONTHS = ["ژانویه", "فوریه", "مارس", "آوریل", "مه", "ژوئن", "ژوئیه", "اوت", "سپتامبر", "اکتبر", "نوامبر", "دسامبر"];
function toFaDigits(s) {
  return String(s).replace(/[0-9]/g, d => FA_DIGITS[+d]);
}
function formatFaDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    const day = toFaDigits(d.getUTCDate());
    const month = FA_MONTHS[d.getUTCMonth()] || "";
    const year = toFaDigits(d.getUTCFullYear());
    return `${day} ${month} ${year}`;
  } catch (e) {
    return String(iso || "").slice(0, 10);
  }
}

function textToParagraphs(text) {
  const lines = String(text || "").split("\n").map(l => l.trim());
  const paras = [];
  let buf = [];
  for (const l of lines) {
    if (!l) {
      if (buf.length) { paras.push(buf.join(" ")); buf = []; }
    } else {
      buf.push(l);
    }
  }
  if (buf.length) paras.push(buf.join(" "));
  return paras.filter(p => !/^(#\S+\s*)+$/.test(p));
}

function splitTitleBody(rawText) {
  const text = String(rawText || "");
  const idx = text.indexOf("\n");
  let title, rest;
  if (idx === -1) { title = text.trim(); rest = ""; }
  else { title = text.slice(0, idx).trim(); rest = text.slice(idx + 1); }
  if (!title) title = "خبر پالس ایران ۲۴";
  if (title.length > 140) title = title.slice(0, 140) + "…";
  return { title, paragraphs: textToParagraphs(rest) };
}

async function handleArticle(url, env, ctx, lang) {
  lang = lang || "fa";
  const parts = url.pathname.split("/").filter(Boolean);
  /* مسیر می‌تواند /news/{id} یا /en/news/{id} باشد */
  const id = String(parts[parts.length - 1] || "").replace(/[^0-9]/g, "").slice(0, 20);
  if (!id) return notFoundArticlePage();

  const kv = env && env.PULSE_STATS;
  let post = null;

  if (kv) {
    try {
      const cached = await kv.get("article:" + id);
      if (cached) post = JSON.parse(cached);
    } catch (e) { /* نادیده گرفته می‌شود */ }
  }

  /* توجه: دیگر در همین درخواست به‌صورت زنده از تلگرام نمی‌خوانیم.
     خبرها با هر بازدید از صفحه اصلی (handleNews) به‌طور خودکار در KV
     ذخیره می‌شوند، پس معمولاً در کمتر از یک دقیقه پس از انتشار در KV موجودند. */

  /* اگر در KV نبود (خبر قدیمی یا کش‌نشده)، همان پست را زنده از تلگرام بگیر
     و برای دفعه‌ی بعد در KV ذخیره کن — تا صفحه‌ی خبر همیشه کار کند. */
  if (!post) {
    post = await fetchSingleTelegramPost(id);
    if (post && kv) {
      try { ctx.waitUntil(kv.put("article:" + id, JSON.stringify(post))); } catch (e) {}
    }
  }

  /* متن‌های بلند در فهرست پیش‌نمایش تلگرام کوتاه می‌شوند («…»).
     در آن صورت، نسخه‌ی کامل را از صفحه‌ی تک‌پست تلگرام بگیر و کش را به‌روز کن. */
  if (post && post.source !== "manual" && /(…|\.\.\.)\s*$/.test(String(post.text || "").trim())) {
    const full = await fetchSingleTelegramPost(id);
    if (full && full.text && full.text.length > String(post.text || "").length) {
      post = { ...post, text: full.text, photo: post.photo || full.photo, video: post.video || full.video };
      if (kv) {
        try { ctx.waitUntil(kv.put("article:" + id, JSON.stringify(post))); } catch (e) {}
      }
    }
  }

  if (!post) return notFoundArticlePage();

  /* ترجمه‌ی تیتر و بندهای متن برای نسخه‌های انگلیسی و آلمانی (با کش KV) */
  let tr = null;
  if (lang !== "fa") {
    try {
      const parsed = splitTitleBody(post.text);
      const texts = [];
      if (parsed.title) texts.push(parsed.title);
      for (const p of parsed.paragraphs.slice(0, 25)) if (p && p.trim()) texts.push(p);
      const uniq = Array.from(new Set(texts));
      const done = await Promise.all(uniq.map(t => translateOne(t, lang, env)));
      tr = {};
      uniq.forEach((t, i) => { tr[t] = done[i]; });
    } catch (e) { tr = null; }
  }

  return renderArticlePage(post, id, url, lang, tr);
}

/* دریافت یک پست خاص تلگرام بر اساس شماره‌اش (برای صفحه‌ی خبری که در KV نیست) */
async function fetchSingleTelegramPost(id) {
  const urls = [
    "https://t.me/pulseiran24/" + id + "?embed=1&mode=tme",
    "https://telegram.me/pulseiran24/" + id + "?embed=1&mode=tme"
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          "Accept-Language": "fa,en;q=0.8"
        },
        cf: { cacheTtl: 300, cacheEverything: true },
        redirect: "follow"
      });
      if (!r.ok) continue;
      const posts = parsePosts(await r.text());
      if (posts && posts.length) return posts[0];
    } catch (e) { /* دامنه‌ی بعدی */ }
  }
  return null;
}

const ART_LABELS = {
  fa: { logo: 'پالس <b>ایران ۲۴</b>', brand: "پالس ایران ۲۴", back: "← بازگشت به صفحه اصلی",
        tgview: "مشاهده در تلگرام", wa: "واتساپ", tg: "تلگرام",
        foot: "پالس ایران ۲۴ — نبض خبر ایران و جهان", tgchan: "کانال تلگرام",
        locale: "fa_IR", inLang: "fa-IR", dir: "rtl" },
  en: { logo: 'Pulse <b>Iran 24</b>', brand: "Pulse Iran 24", back: "← Back to homepage",
        tgview: "View on Telegram", wa: "WhatsApp", tg: "Telegram",
        foot: "Pulse Iran 24 — the pulse of news from Iran and the world", tgchan: "Telegram channel",
        locale: "en_US", inLang: "en", dir: "ltr" },
  de: { logo: 'Pulse <b>Iran 24</b>', brand: "Pulse Iran 24", back: "← Zur Startseite",
        tgview: "Auf Telegram ansehen", wa: "WhatsApp", tg: "Telegram",
        foot: "Pulse Iran 24 — der Nachrichtenpuls aus Iran und der Welt", tgchan: "Telegram-Kanal",
        locale: "de_DE", inLang: "de", dir: "ltr" }
};

function renderArticlePage(post, id, url, lang, tr) {
  lang = lang || "fa";
  const L = ART_LABELS[lang] || ART_LABELS.fa;
  const origin = url.origin;
  const canonical = origin + (lang === "fa" ? "" : "/" + lang) + "/news/" + id;
  const parsed = splitTitleBody(post.text);
  let title = parsed.title;
  let paragraphs = parsed.paragraphs;
  if (tr) {
    title = tr[title] || title;
    paragraphs = paragraphs.map(p => tr[p] || p);
  }

  const descSource = paragraphs.length ? paragraphs.join(" ") : title;
  let description = descSource.replace(/\s+/g, " ").trim();
  if (description.length > 160) description = description.slice(0, 157) + "…";

  const imagePath = post.photo || post.vthumb || "/assets/og-image.jpg";
  const absImage = /^https?:\/\//.test(imagePath) ? imagePath : origin + imagePath;

  const published = post.published || new Date().toISOString();
  const dateDisplay = lang === "fa" ? formatFaDate(published) : new Date(published).toISOString().slice(0, 10);

  const isManual = post.source === "manual";
  const telegramLink = post.link || "https://telegram.me/pulseiran24";
  const tgBtn = isManual ? "" :
    `<a class="tgview" href="${escHtml(telegramLink)}" target="_blank" rel="noopener">${escHtml(L.tgview)}</a>`;
  const waShare = "https://wa.me/?text=" + encodeURIComponent(title + "\n" + canonical + "\n\n📡 Pulse Iran 24 | https://pulseiran24.com");
  const tgShare = "https://t.me/share/url?url=" + encodeURIComponent(canonical) + "&text=" + encodeURIComponent(title);
  const xShare  = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(title) + "&url=" + encodeURIComponent(canonical);

  let mediaHtml = "";
  if (post.video) {
    const vsrc = /^https?:\/\//.test(post.video) ? post.video : origin + post.video;
    mediaHtml = `<video class="art-media" controls playsinline preload="metadata" src="${escHtml(vsrc)}"></video>`;
  } else if (post.photo) {
    mediaHtml = `<img class="art-media" src="${escHtml(absImage)}" alt="${escHtml(title)}" loading="eager">`;
  }

  const bodyHtml = paragraphs.map(p => `<p>${escHtml(p)}</p>`).join("\n");

  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": title.length > 110 ? title.slice(0, 107) + "…" : title,
    "description": description,
    "image": [absImage],
    "datePublished": published,
    "dateModified": published,
    "inLanguage": L.inLang,
    "mainEntityOfPage": { "@type": "WebPage", "@id": canonical },
    "author": { "@type": "Organization", "name": "Pulse Iran 24", "url": origin },
    "publisher": {
      "@type": "Organization",
      "name": "Pulse Iran 24",
      "logo": { "@type": "ImageObject", "url": origin + "/assets/icon-512.png" }
    }
  }).replace(/</g, "\\u003c");

  const artAlt = `<link rel="alternate" hreflang="fa" href="${origin}/news/${id}">
<link rel="alternate" hreflang="en" href="${origin}/en/news/${id}">
<link rel="alternate" hreflang="de" href="${origin}/de/news/${id}">
<link rel="alternate" hreflang="x-default" href="${origin}/news/${id}">`;

  const html = `<!DOCTYPE html>
<html lang="${L.inLang}" dir="${L.dir}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)} | Pulse Iran 24</title>
<meta name="description" content="${escHtml(description)}">
<link rel="canonical" href="${escHtml(canonical)}">
${artAlt}
<meta name="theme-color" content="#0D1117">
<link rel="icon" href="/assets/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">

<meta property="og:type" content="article">
<meta property="og:site_name" content="Pulse Iran 24">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:url" content="${escHtml(canonical)}">
<meta property="og:image" content="${escHtml(absImage)}">
<meta property="og:locale" content="${L.locale}">
<meta property="article:published_time" content="${escHtml(published)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(description)}">
<meta name="twitter:image" content="${escHtml(absImage)}">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;900&display=swap" rel="stylesheet">
<script type="application/ld+json">${ld}</script>
<style>
  :root{--bg:#0D1117;--surface:#161C26;--line:#2A3442;--text:#E9EDF2;--dim:#8B96A5;--pulse:#FF2D4A;--tg:#2AABEE}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Vazirmatn',Tahoma,sans-serif;background:var(--bg);color:var(--text);line-height:1.85}
  a{color:inherit}
  .wrap{max-width:760px;margin:0 auto;padding:0 20px}
  header{border-bottom:1px solid var(--line);padding:16px 0;margin-bottom:26px}
  header .wrap{display:flex;align-items:center;gap:10px}
  header a.logo{font-weight:900;font-size:1.2rem;text-decoration:none;display:flex;align-items:center;gap:8px}
  header a.logo img{width:34px;height:34px;border-radius:8px;object-fit:cover;display:block}
  header a.logo b{color:var(--pulse)}
  .art-meta{color:var(--dim);font-size:.88rem;margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .art-meta .badge{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:3px 11px;color:var(--tg);font-weight:700}
  h1{font-size:1.55rem;font-weight:900;line-height:1.5;margin:0 0 14px}
  .art-media{width:100%;border-radius:14px;margin-bottom:20px;display:block;background:var(--surface)}
  .art-body p{margin:0 0 14px;font-size:1.03rem;color:#dbe1e8}
  .actions{display:flex;flex-wrap:wrap;gap:10px;margin:26px 0;padding-top:20px;border-top:1px solid var(--line)}
  .actions a{
    background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:10px;
    padding:9px 16px;font-family:inherit;font-size:.9rem;font-weight:600;text-decoration:none;
  }
  .actions a.tgview{background:var(--tg);border-color:var(--tg);color:#fff}
  .actions a.wa:hover{background:#25D366;border-color:#25D366;color:#fff}
  .actions a.tg:hover{background:var(--tg);border-color:var(--tg);color:#fff}
  .actions a.x:hover{background:#000;border-color:#000;color:#fff}
  footer{border-top:1px solid var(--line);margin-top:40px;padding:22px 0;color:var(--dim);font-size:.85rem;text-align:center}
  footer a{color:var(--tg);text-decoration:none}
  .home-link{display:block;margin:22px 0 40px;color:var(--pulse);font-weight:700;text-decoration:none}
  main.wrap{padding-bottom:10px}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <a class="logo" href="${lang === "fa" ? "/" : "/" + lang}"><img src="/assets/icon-192.png" alt="" onerror="this.style.display='none'">${L.logo}</a>
  </div>
</header>
<main class="wrap">
  <div class="art-meta">
    <span class="badge">${escHtml(L.brand)}</span>
    <span>${escHtml(dateDisplay)}</span>
  </div>
  <h1>${escHtml(title)}</h1>
  ${mediaHtml}
  <div class="art-body">${bodyHtml}</div>
  <div class="actions">
    ${tgBtn}
    <a class="wa" href="${escHtml(waShare)}" target="_blank" rel="noopener">${escHtml(L.wa)}</a>
    <a class="tg" href="${escHtml(tgShare)}" target="_blank" rel="noopener">${escHtml(L.tg)}</a>
    <a class="x" href="${escHtml(xShare)}" target="_blank" rel="noopener">X</a>
  </div>
  <a class="home-link" href="${lang === "fa" ? "/" : "/" + lang}">${escHtml(L.back)}</a>
</main>
<footer>
  ${escHtml(L.foot)} · <a href="https://telegram.me/pulseiran24" target="_blank" rel="noopener">${escHtml(L.tgchan)}</a>
</footer>
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
}

function notFoundArticlePage() {
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>خبر یافت نشد | Pulse Iran 24</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/assets/favicon.ico" sizes="any">
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700;900&display=swap" rel="stylesheet">
<style>
  body{margin:0;font-family:'Vazirmatn',Tahoma,sans-serif;background:#0D1117;color:#E9EDF2;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
  h1{font-size:1.3rem;margin-bottom:10px}
  p{color:#8B96A5;margin-bottom:22px}
  a{color:#FF2D4A;font-weight:700;text-decoration:none}
</style>
</head>
<body>
  <div>
    <h1>این خبر دیگر در دسترس نیست</h1>
    <p>ممکن است حذف شده یا آدرس اشتباه باشد.</p>
    <a href="/">بازگشت به صفحه اصلی پالس ایران ۲۴</a>
  </div>
</body>
</html>`;
  return new Response(html, { status: 404, headers: { "Content-Type": "text/html; charset=UTF-8" } });
}


/* شمارنده بازدید و لایک (اختیاری).
   بدون تنظیمات اضافه: پاسخ خالی → شمارنده در سایت مخفی می‌شود (بدون خطا).
   اختیاری: در تنظیمات Pages یک KV binding با نام PULSE_STATS اضافه کنید
   تا شمارنده بازدید و لایک دوباره فعال شود. */

async function handleStats(url, env) {
  const kv = env.PULSE_STATS;
  const action = url.searchParams.get("action") || "get";
  if (!kv) return new Response("{}", { headers: JSON_HEADERS });

  try {
    if (action === "visit" || action === "get") {
      let visits = parseInt(await kv.get("visits") || "0", 10);
      if (action === "visit") {
        visits += 1;
        await kv.put("visits", String(visits));
      }
      return new Response(JSON.stringify({ visits }), { headers: JSON_HEADERS });
    }
    if (action === "likes") {
      const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 30);
      const likes = {};
      for (const id of ids) likes[id] = parseInt(await kv.get("like:" + id) || "0", 10);
      return new Response(JSON.stringify({ likes }), { headers: JSON_HEADERS });
    }
    if (action === "like") {
      const id = (url.searchParams.get("id") || "").slice(0, 80);
      if (!id) return new Response("{}", { headers: JSON_HEADERS });
      const n = parseInt(await kv.get("like:" + id) || "0", 10) + 1;
      await kv.put("like:" + id, String(n));
      return new Response(JSON.stringify({ likes: n }), { headers: JSON_HEADERS });
    }
  } catch (e) { /* پایین می‌رود */ }
  return new Response("{}", { headers: JSON_HEADERS });
}

/* ---------- فرم تماس (Web3Forms) ---------- */

async function handleContact(request, env) {
  let fields = {};
  try {
    const body = await request.text();
    fields = Object.fromEntries(new URLSearchParams(body));
  } catch (e) {
    return new Response("bad request", { status: 400 });
  }

  /* تله ضد ربات: اگر پر شده بود، وانمود به موفقیت */
  if (fields["bot-field"]) return new Response("ok", { status: 200 });

  const message = (fields.message || "").trim();
  if (!message) return new Response("empty", { status: 400 });

  const key = (env && env.WEB3FORMS_KEY) || WEB3FORMS_KEY_FALLBACK;
  if (!key || key === "YOUR_ACCESS_KEY_HERE") {
    /* کلید هنوز تنظیم نشده → فرم پیام خطا نشان می‌دهد */
    return new Response("contact not configured", { status: 503 });
  }

  try {
    const r = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        access_key: key,
        subject: "پیام جدید از سایت پالس ایران ۲۴",
        from_name: "Pulse Iran 24 Website",
        name: (fields.name || "ناشناس").slice(0, 120),
        message: message.slice(0, 4000)
      })
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d && d.success) return new Response("ok", { status: 200 });
    return new Response("send failed", { status: 502 });
  } catch (e) {
    return new Response("send failed", { status: 502 });
  }
}


/* ---------- پادکست خبرگزاری‌های معتبر ----------
   فهرست فیدهای عمومی RSS. هر فیدی که کار کند نشان داده می‌شود؛
   فیدهای خراب/در دسترس‌نبودن نادیده گرفته می‌شوند (بدون لینک شکسته).
   کش ۳۰ دقیقه‌ای در KV تا فشار کمی به سرورها وارد شود. */
const PODCAST_FEEDS = [
  { name: "رادیو فردا", lang: "fa", url: "https://feeds.soundcloud.com/users/soundcloud:users:8262006/sounds.rss" },
  { name: "Tagesschau in 100 Sekunden", lang: "de", url: "https://www.tagesschau.de/tagesschau_in_100_sekunden/podcast-ts100-audio-100~podcast.xml" },
  { name: "BBC Global News", lang: "en", url: "https://podcasts.files.bbci.co.uk/p02nq0gn.rss" },
  { name: "The Guardian — Today in Focus", lang: "en", url: "https://www.theguardian.com/news/series/todayinfocus/podcast.xml" }
]

function parseLatestEpisode(xml) {
  const itemMatch = xml.match(/<item[\s\S]*?<\/item>/i);
  const block = itemMatch ? itemMatch[0] : "";
  if (!block) return null;
  const enc = block.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i);
  const audio = enc ? enc[1] : "";
  if (!audio) return null;
  let title = "";
  const t = block.match(/<title>([\s\S]*?)<\/title>/i);
  if (t) title = t[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
  let date = "";
  const d = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
  if (d) date = d[1].trim();
  return { audio: audio, title: title, date: date };
}

async function handlePodcasts(env, ctx) {
  const CACHE_KEY = "podcasts:latest:v4";
  const kv = env && env.PULSE_STATS;
  if (kv) {
    try {
      const cached = await kv.get(CACHE_KEY);
      if (cached) {
        return new Response(cached, { headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=900" } });
      }
    } catch (e) {}
  }
  const items = [];
  await Promise.all(PODCAST_FEEDS.map(async (f) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(f.url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; PulseIran24/1.0)" },
        signal: ctrl.signal,
        cf: { cacheTtl: 900, cacheEverything: true }
      });
      clearTimeout(timer);
      if (!r.ok) return;
      const xml = await r.text();
      const ep = parseLatestEpisode(xml);
      if (ep) items.push({ name: f.name, lang: f.lang, title: ep.title, audio: ep.audio, date: ep.date });
    } catch (e) {}
  }));
  const body = JSON.stringify({ ok: true, items: items });
  if (kv && ctx && ctx.waitUntil) {
    try { ctx.waitUntil(kv.put(CACHE_KEY, body, { expirationTtl: 1800 })); } catch (e) {}
  }
  return new Response(body, { headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=900" } });
}


/* ---------- قیمت لحظه‌ای بازار (رمزارز + طلای جهانی) ----------
   منبع: CoinGecko (رایگان، بدون کلید). کش ۳ دقیقه در KV.
   جای نرخ ارز آزاد ایران خالی است تا با کلید ایرانی اضافه شود. */
const RATE_COINS = [
  { cc: "BTC",  name: "بیت‌کوین", sym: "₿" },
  { cc: "ETH",  name: "اتریوم",   sym: "Ξ" },
  { cc: "USDT", name: "تتر",      sym: "₮" },
  { cc: "PAXG", name: "طلا (اونس)", sym: "🥇" }
];

async function handleRates(env, ctx) {
  const CACHE_KEY = "rates:latest:v2";
  const kv = env && env.PULSE_STATS;
  if (kv) {
    try {
      const cached = await kv.get(CACHE_KEY);
      if (cached) return new Response(cached, { headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=180" } });
    } catch (e) {}
  }
  let items = [];

  // منبع اول: CryptoCompare (قیمت + درصد تغییر، بدون کلید)
  try {
    const syms = RATE_COINS.map(c => c.cc).join(",");
    const url = "https://min-api.cryptocompare.com/data/pricemultifull?fsyms=" + syms + "&tsyms=USD";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { headers: { "accept": "application/json", "user-agent": "Mozilla/5.0 (compatible; PulseIran24/1.0)" }, signal: ctrl.signal, cf: { cacheTtl: 180 } });
    clearTimeout(timer);
    if (r.ok) {
      const data = await r.json();
      const raw = data && data.RAW;
      if (raw) {
        for (const c of RATE_COINS) {
          const d = raw[c.cc] && raw[c.cc].USD;
          if (d && typeof d.PRICE === "number") {
            items.push({ name: c.name, sym: c.sym, price: d.PRICE, change: (typeof d.CHANGEPCT24HOUR === "number") ? d.CHANGEPCT24HOUR : null, unit: "USD" });
          }
        }
      }
    }
  } catch (e) {}

  // منبع پشتیبان: Coinbase (فقط قیمت) اگر اولی خالی بود
  if (!items.length) {
    for (const c of RATE_COINS) {
      try {
        const r = await fetch("https://api.coinbase.com/v2/prices/" + c.cc + "-USD/spot", { headers: { "accept": "application/json" }, cf: { cacheTtl: 180 } });
        if (r.ok) {
          const d = await r.json();
          const p = d && d.data && parseFloat(d.data.amount);
          if (p) items.push({ name: c.name, sym: c.sym, price: p, change: null, unit: "USD" });
        }
      } catch (e) {}
    }
  }

  const body = JSON.stringify({ ok: true, items: items });
  if (kv && ctx && ctx.waitUntil && items.length) {
    try { ctx.waitUntil(kv.put(CACHE_KEY, body, { expirationTtl: 300 })); } catch (e) {}
  }
  return new Response(body, { headers: { ...JSON_HEADERS, "Cache-Control": items.length ? "public, max-age=180" : "no-store" } });
}


/* ============================================================
   خبر دستی — مستقل از تلگرام  (build v65)
   ذخیره در KV: PULSE_STATS
     manual_posts        → آرایه‌ی کامل خبرهای دستی (جدیدترین اول)
     article:{id}        → همان خبر برای صفحه‌ی اختصاصی /news/{id}
     article_index       → فهرست کل خبرها (آرشیو + sitemap + rss)
   احراز هویت: Environment variable با نام ADMIN_TOKEN در تنظیمات Pages.
   اگر ADMIN_TOKEN تنظیم نشده باشد، پنل غیرفعال است (۵۰۳).
   ============================================================ */

const SITE_ORIGIN = "https://pulseiran24.com";
const MANUAL_KEY = "manual_posts";
const MANUAL_CAP = 60;

async function getManualPosts(env) {
  const kv = env && env.PULSE_STATS;
  if (!kv) return [];
  try {
    const raw = await kv.get(MANUAL_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

/* مقایسه‌ی زمان‌ثابت برای جلوگیری از timing attack روی رمز */
function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function getAdminToken(request, body) {
  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  if (body && typeof body.token === "string") return body.token.trim();
  return "";
}

function checkAdmin(request, env, body) {
  const secret = env && env.ADMIN_TOKEN;
  if (!secret) return { ok: false, code: 503, msg: "admin_disabled" };
  const token = getAdminToken(request, body);
  if (!token || !timingSafeEqual(token, secret)) return { ok: false, code: 401, msg: "unauthorized" };
  return { ok: true };
}

function adminJson(obj, code) {
  return new Response(JSON.stringify(obj), {
    status: code || 200,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
  });
}

function validHttps(u) {
  return typeof u === "string" && /^https:\/\/\S{3,500}$/.test(u.trim());
}

/* ارسال اعلان وب‌پوش از طریق OneSignal (کلید در secret به نام ONESIGNAL_API_KEY) */
const ONESIGNAL_APP_ID = "50d787e3-6475-43bc-9082-fc3af19da7ee";
async function sendPush(env, title, url, image) {
  const key = env.ONESIGNAL_API_KEY;
  if (!key) return { ok: false, error: "no_api_key" };
  const auth = key.indexOf("os_v2_") === 0 ? "Key " + key : "Basic " + key;
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    included_segments: ["Total Subscriptions"],
    headings: { en: "پالس ایران ۲۴ 🔔" },
    contents: { en: String(title || "").slice(0, 180) },
    url: url,
    chrome_web_icon: "https://pulseiran24.com/logo.png"
  };
  if (image) payload.chrome_web_image = image;
  try {
    let r = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": auth },
      body: JSON.stringify(payload)
    });
    let j = await r.json().catch(() => ({}));
    /* اگر سگمنت پیدا نشد، با نام قدیمی دوباره امتحان کن */
    if (!r.ok && JSON.stringify(j).indexOf("egment") > -1) {
      payload.included_segments = ["Subscribed Users"];
      r = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": auth },
        body: JSON.stringify(payload)
      });
      j = await r.json().catch(() => ({}));
    }
    if (r.ok && (j.id || j.notification_id)) return { ok: true, id: j.id || j.notification_id };
    return { ok: false, error: (j.errors && j.errors[0]) || ("http_" + r.status) };
  } catch (e) {
    return { ok: false, error: "network" };
  }
}

async function handleAdminApi(request, env, ctx) {
  if (request.method !== "POST") return adminJson({ ok: false, error: "method" }, 405);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  const auth = checkAdmin(request, env, body);
  if (!auth.ok) return adminJson({ ok: false, error: auth.msg }, auth.code);

  const action = String(body.action || "");
  const kv = env.PULSE_STATS;
  if (!kv) return adminJson({ ok: false, error: "kv_missing" }, 503);

  if (action === "login") {
    return adminJson({ ok: true });
  }

  if (action === "list") {
    const items = await getManualPosts(env);
    return adminJson({ ok: true, items });
  }

  if (action === "create") {
    const title = String(body.title || "").trim().slice(0, 200);
    if (!title) return adminJson({ ok: false, error: "title_required" }, 400);
    const text = title + (body.body ? "\n\n" + String(body.body).slice(0, 8000).trim() : "");
    const photo = validHttps(body.image) ? body.image.trim() : null;
    const video = validHttps(body.video) ? body.video.trim() : null;

    const id = String(Date.now());
    const published = new Date().toISOString();
    const post = { text, link: "/news/" + id, published, photo, video, vthumb: null, source: "manual" };

    /* ۱) خبر دستی به فهرست manual_posts */
    let manual = await getManualPosts(env);
    manual.unshift(post);
    if (manual.length > MANUAL_CAP) manual = manual.slice(0, MANUAL_CAP);
    await kv.put(MANUAL_KEY, JSON.stringify(manual));

    /* ۲) نسخه‌ی مستقل برای صفحه‌ی /news/{id} */
    await kv.put("article:" + id, JSON.stringify(post));

    /* ۳) افزودن به فهرست کل (آرشیو + sitemap + rss) */
    try {
      let index = JSON.parse(await kv.get("article_index") || "[]");
      if (!Array.isArray(index)) index = [];
      if (!index.some(x => x.id === id)) {
        index.push({ id, text: text.slice(0, 220), published, photo });
        index.sort((a, b) => (parseInt(b.id) || 0) - (parseInt(a.id) || 0));
        if (index.length > 1000) index = index.slice(0, 1000);
        await kv.put("article_index", JSON.stringify(index));
      }
    } catch (e) {}

    /* ۴) اعلان وب‌پوش (اختیاری) */
    let pushed = false, pushError = null;
    if (body.push === true) {
      const pr = await sendPush(env, title, "https://pulseiran24.com/news/" + id, photo);
      pushed = pr.ok;
      if (!pr.ok) pushError = pr.error;
    }

    return adminJson({ ok: true, id, url: "/news/" + id, pushed, pushError });
  }

  if (action === "delete") {
    const id = String(body.id || "").replace(/[^0-9]/g, "").slice(0, 20);
    if (!id) return adminJson({ ok: false, error: "id_required" }, 400);

    let manual = await getManualPosts(env);
    manual = manual.filter(p => String(p.link || "").indexOf("/news/" + id) === -1);
    await kv.put(MANUAL_KEY, JSON.stringify(manual));

    try { await kv.delete("article:" + id); } catch (e) {}
    try {
      let index = JSON.parse(await kv.get("article_index") || "[]");
      if (Array.isArray(index)) {
        const next = index.filter(x => x.id !== id);
        if (next.length !== index.length) await kv.put("article_index", JSON.stringify(next));
      }
    } catch (e) {}

    return adminJson({ ok: true });
  }

  return adminJson({ ok: false, error: "unknown_action" }, 400);
}

function handleAdminPage() {
  return new Response(ADMIN_HTML, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>پنل خبر — پالس ایران ۲۴</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
 :root{--bg:#0D1117;--surface:#161C26;--line:#2A3442;--text:#E9EDF2;--dim:#8B96A5;--pulse:#FF2D4A}
 *{box-sizing:border-box}
 body{margin:0;font-family:'Vazirmatn',Tahoma,sans-serif;background:var(--bg);color:var(--text);line-height:1.7}
 .wrap{max-width:720px;margin:0 auto;padding:22px 16px}
 h1{font-size:1.3rem;font-weight:900} h1 b{color:var(--pulse)}
 .card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:18px}
 label{display:block;font-size:.9rem;color:var(--dim);margin:12px 0 6px}
 input,textarea{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:10px;color:var(--text);font-family:inherit;font-size:1rem;padding:11px 12px}
 textarea{min-height:150px;resize:vertical;line-height:1.9}
 button{background:var(--pulse);color:#fff;border:0;border-radius:10px;font-family:inherit;font-weight:700;font-size:1rem;padding:12px 20px;cursor:pointer;margin-top:14px}
 button.sec{background:var(--surface);border:1px solid var(--line);color:var(--text);padding:7px 14px;font-size:.85rem;margin:0}
 button:disabled{opacity:.5}
 .msg{margin-top:12px;font-size:.9rem;min-height:1.2em}
 .ok{color:#39d98a}.err{color:var(--pulse)}
 .hidden{display:none}
 .item{border-top:1px solid var(--line);padding:12px 0;display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
 .item:first-child{border-top:0;margin-top:10px}
 .item p{margin:0 0 4px;font-size:.92rem}
 .item small{color:var(--dim);font-size:.8rem}
 .hint{color:var(--dim);font-size:.82rem;margin-top:8px}
</style>
</head>
<body>
<div class="wrap">
 <h1>پنل خبر <b>پالس ایران ۲۴</b></h1>

 <div id="login" class="card">
   <label>رمز ورود</label>
   <input id="pw" type="password" autocomplete="current-password" placeholder="ADMIN_TOKEN">
   <button id="loginBtn">ورود</button>
   <div id="loginMsg" class="msg"></div>
 </div>

 <div id="editor" class="card hidden">
   <label>عنوان خبر *</label>
   <input id="title" maxlength="200" placeholder="عنوان خبر...">
   <label>متن خبر</label>
   <textarea id="body" maxlength="8000" placeholder="متن کامل خبر..."></textarea>
   <label>لینک تصویر (اختیاری، https)</label>
   <input id="image" placeholder="https://...">
   <label>لینک ویدیو (اختیاری، https mp4)</label>
   <input id="video" placeholder="https://...">
   <label style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer;font-size:.92rem">
     <input type="checkbox" id="pushChk" checked style="width:auto;margin:0"> 🔔 ارسال اعلان وب‌پوش به مشترک‌ها
   </label>
   <button id="pubBtn">انتشار خبر</button>
   <div id="pubMsg" class="msg"></div>
   <div class="hint">خبر بلافاصله در صفحه‌ی اصلی و در آدرس اختصاصی خودش (برای گوگل) منتشر می‌شود — بدون هیچ وابستگی به تلگرام.</div>
 </div>

 <div id="listCard" class="card hidden">
   <b>خبرهای منتشرشده‌ی دستی</b>
   <div id="list"></div>
 </div>
</div>
<script>
(function(){
  var token = sessionStorage.getItem('pi24_admin') || '';
  function el(id){ return document.getElementById(id); }

  function api(action, extra){
    var payload = Object.assign({action:action}, extra||{});
    return fetch('/admin/api', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify(payload)
    }).then(function(r){ return r.json().then(function(j){ j._status=r.status; return j; }); });
  }

  function showApp(){
    el('login').classList.add('hidden');
    el('editor').classList.remove('hidden');
    el('listCard').classList.remove('hidden');
    loadList();
  }

  function doLogin(){
    token = el('pw').value.trim();
    if(!token){ return; }
    el('loginMsg').textContent = 'در حال بررسی...'; el('loginMsg').className='msg';
    api('login').then(function(j){
      if(j.ok){ sessionStorage.setItem('pi24_admin', token); el('loginMsg').textContent=''; showApp(); }
      else { el('loginMsg').textContent = j._status===503 ? 'ADMIN_TOKEN در تنظیمات Pages ساخته نشده' : 'رمز اشتباه است'; el('loginMsg').className='msg err'; }
    }).catch(function(){ el('loginMsg').textContent='خطای شبکه'; el('loginMsg').className='msg err'; });
  }

  function doPublish(){
    var title = el('title').value.trim();
    if(!title){ el('pubMsg').textContent='عنوان لازم است'; el('pubMsg').className='msg err'; return; }
    el('pubBtn').disabled = true;
    el('pubMsg').textContent='در حال انتشار...'; el('pubMsg').className='msg';
    api('create', { title:title, body: el('body').value, image: el('image').value.trim(), video: el('video').value.trim(), push: el('pushChk').checked }).then(function(j){
      el('pubBtn').disabled = false;
      if(j.ok){
        var pushNote = j.pushed ? ' &nbsp;·&nbsp; اعلان ارسال شد 🔔' : (j.pushError ? ' &nbsp;·&nbsp; اعلان نرفت ('+j.pushError+')' : '');
        el('pubMsg').innerHTML = 'منتشر شد ✓' + pushNote + ' &nbsp; <a style="color:#2AABEE" target="_blank" href="'+j.url+'">مشاهده صفحه خبر</a>';
        el('pubMsg').className='msg ok';
        el('title').value=''; el('body').value=''; el('image').value=''; el('video').value='';
        loadList();
      } else {
        el('pubMsg').textContent = j.error==='unauthorized' ? 'نشست منقضی شد، دوباره وارد شوید' : ('خطا: '+(j.error||'?'));
        el('pubMsg').className='msg err';
      }
    }).catch(function(){ el('pubBtn').disabled=false; el('pubMsg').textContent='خطای شبکه'; el('pubMsg').className='msg err'; });
  }

  function loadList(){
    api('list').then(function(j){
      if(!j.ok){ return; }
      var box = el('list'); box.innerHTML='';
      if(!j.items || !j.items.length){ box.innerHTML='<p class="hint">هنوز خبری منتشر نشده.</p>'; return; }
      j.items.forEach(function(it){
        var idm = String(it.link||'').match(/(\\d+)/); var id = idm ? idm[1] : '';
        var div = document.createElement('div'); div.className='item';
        var left = document.createElement('div');
        var firstLine = (it.text||'').split('\\n')[0].slice(0,90);
        var p = document.createElement('p'); p.textContent = firstLine;
        var s = document.createElement('small'); s.textContent = (it.published||'').slice(0,10) + '  ·  /news/' + id;
        left.appendChild(p); left.appendChild(s);
        var btn = document.createElement('button'); btn.className='sec'; btn.textContent='حذف';
        btn.onclick = function(){
          if(!confirm('این خبر حذف شود؟')){ return; }
          api('delete', {id:id}).then(function(r){ if(r.ok){ loadList(); } });
        };
        div.appendChild(left); div.appendChild(btn);
        box.appendChild(div);
      });
    });
  }

  el('loginBtn').onclick = doLogin;
  el('pw').addEventListener('keydown', function(e){ if(e.key==='Enter'){ doLogin(); } });
  el('pubBtn').onclick = doPublish;
  if(token){ api('login').then(function(j){ if(j.ok){ showApp(); } else { sessionStorage.removeItem('pi24_admin'); } }); }
})();
</script>
</body>
</html>`;


/* ---------- SEO: sitemap.xml پویا ---------- */
function xmlEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function handleSitemap(url, env) {
  const kv = env && env.PULSE_STATS;
  let index = [];
  if (kv) { try { index = JSON.parse(await kv.get("article_index") || "[]"); } catch (e) { index = []; } }
  if (!Array.isArray(index)) index = [];

  const urls = [];
  urls.push(`  <url><loc>${SITE_ORIGIN}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>`);
  /* صفحات ثابت شفافیت و حقوقی */
  urls.push(`  <url><loc>${SITE_ORIGIN}/en</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>`);
  urls.push(`  <url><loc>${SITE_ORIGIN}/de</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>`);
  for (const p of ["darbare.html", "khatte-mashy.html", "tashih.html"]) {
    urls.push(`  <url><loc>${SITE_ORIGIN}/${p}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`);
  }
  for (const it of index.slice(0, 2000)) {
    const id = String(it.id || "").replace(/[^0-9]/g, "");
    if (!id) continue;
    const lm = (it.published && !isNaN(Date.parse(it.published))) ? new Date(it.published).toISOString() : null;
    urls.push(
      `  <url><loc>${SITE_ORIGIN}/news/${id}</loc>` +
      (lm ? `<lastmod>${lm}</lastmod>` : "") +
      `<changefreq>daily</changefreq><priority>0.8</priority></url>`
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=UTF-8", "Cache-Control": "public, max-age=600" }
  });
}


/* ---------- SEO: rss.xml پویا (سیندیکیشن مستقل از تلگرام) ---------- */
async function handleRss(url, env) {
  const kv = env && env.PULSE_STATS;
  let index = [];
  if (kv) { try { index = JSON.parse(await kv.get("article_index") || "[]"); } catch (e) { index = []; } }
  if (!Array.isArray(index)) index = [];

  const items = index.slice(0, 40).map(it => {
    const id = String(it.id || "").replace(/[^0-9]/g, "");
    if (!id) return "";
    const raw = String(it.text || "").trim();
    const nl = raw.indexOf("\n");
    const title = (nl === -1 ? raw : raw.slice(0, nl)).slice(0, 140) || "خبر پالس ایران ۲۴";
    const desc = raw.replace(/\s+/g, " ").slice(0, 300);
    const link = SITE_ORIGIN + "/news/" + id;
    const pub = (it.published && !isNaN(Date.parse(it.published))) ? new Date(it.published).toUTCString() : new Date().toUTCString();
    return `    <item>
      <title>${xmlEsc(title)}</title>
      <link>${xmlEsc(link)}</link>
      <guid isPermaLink="true">${xmlEsc(link)}</guid>
      <pubDate>${pub}</pubDate>
      <description>${xmlEsc(desc)}</description>
    </item>`;
  }).filter(Boolean).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>پالس ایران ۲۴</title>
    <link>${SITE_ORIGIN}/</link>
    <description>نبض خبر ایران و جهان</description>
    <language>fa-IR</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=UTF-8", "Cache-Control": "public, max-age=600" }
  });
}


/* ---------- SEO: robots.txt (با ارجاع به sitemap) ---------- */
function handleRobots(request, env) {
  const body = `User-agent: *
Allow: /
Disallow: /admin

Sitemap: ${SITE_ORIGIN}/sitemap.xml\nSitemap: ${SITE_ORIGIN}/news-sitemap.xml`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=UTF-8", "Cache-Control": "public, max-age=3600" }
  });
}


/* ============================================================
   جراید بین‌المللی  (build v66)
   ۱) صفحه اول روزنامه‌ها: از kiosko.net (اسکرپ سمت سرور + کش KV)
   ۲) تیتر روزنامه‌ها: RSS روزنامه‌های بین‌المللی (parseFeed موجود)
   ============================================================ */

/* --- صفحه اول روزنامه‌ها --- */
const COVER_PAGES = [
  { cc: "us", label: "آمریکا",  url: "https://en.kiosko.net/us/" },
  { cc: "uk", label: "بریتانیا", url: "https://en.kiosko.net/uk/" },
  { cc: "fr", label: "فرانسه",  url: "https://en.kiosko.net/fr/" },
  { cc: "de", label: "آلمان",   url: "https://en.kiosko.net/de/" },
  { cc: "es", label: "اسپانیا", url: "https://en.kiosko.net/es/" },
  { cc: "it", label: "ایتالیا", url: "https://en.kiosko.net/it/" },
  { cc: "il", label: "اسرائیل", url: "https://en.kiosko.net/il/" },
  { cc: "tr", label: "ترکیه",   url: "https://en.kiosko.net/tr/" }
];
const COVERS_PER_COUNTRY = 5;
const COVERS_TTL_MS = 4 * 60 * 60 * 1000; /* ۴ ساعت */

function titleFromSlug(slug) {
  return slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function parseCovers(html, cc, label) {
  const out = [];
  const seen = new Set();
  const re = /img\.kiosko\.net\/(\d{4}\/\d{2}\/\d{2})\/([a-z]{2,4})\/([a-z0-9_\-]+)\.(?:200|300)\.jpg/gi;
  let m;
  while ((m = re.exec(html)) && out.length < COVERS_PER_COUNTRY) {
    const date = m[1], country = m[2].toLowerCase(), slug = m[3].toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      name: titleFromSlug(slug),
      country: label,
      img: "https://img.kiosko.net/" + date + "/" + country + "/" + slug + ".750.jpg",
      link: "https://en.kiosko.net/" + country + "/np/" + slug + ".html"
    });
  }
  return out;
}

async function fetchCovers() {
  const results = await Promise.allSettled(
    COVER_PAGES.map(async p => {
      const r = await fetch(p.url, {
        headers: { "User-Agent": "Mozilla/5.0 (PulseIran24 PressBoard)" },
        cf: { cacheTtl: 3600, cacheEverything: true }
      });
      if (!r.ok) throw new Error(p.cc + " " + r.status);
      return parseCovers(await r.text(), p.cc, p.label);
    })
  );
  const covers = [];
  for (const res of results) if (res.status === "fulfilled") covers.push(...res.value);
  return covers;
}

async function handlePressCovers(env, ctx) {
  const kv = env && env.PULSE_STATS;
  /* کش KV: اگر تازه بود همان را بده */
  if (kv) {
    try {
      const raw = await kv.get("press_covers");
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && (Date.now() - (cached.ts || 0)) < COVERS_TTL_MS && cached.covers && cached.covers.length) {
          return new Response(JSON.stringify({ ok: true, covers: cached.covers }), {
            headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=3600" }
          });
        }
      }
    } catch (e) {}
  }

  let covers = [];
  try { covers = await fetchCovers(); } catch (e) { covers = []; }

  if (!covers.length) {
    /* اگر اسکرپ شکست خورد ولی کش قدیمی داریم، همان را بده */
    if (kv) {
      try {
        const raw = await kv.get("press_covers");
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached && cached.covers && cached.covers.length) {
            return new Response(JSON.stringify({ ok: true, covers: cached.covers, stale: true }), {
              headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=600" }
            });
          }
        }
      } catch (e) {}
    }
    return new Response(JSON.stringify({ ok: false }), { status: 502, headers: JSON_HEADERS });
  }

  if (kv) {
    try { ctx.waitUntil(kv.put("press_covers", JSON.stringify({ ts: Date.now(), covers }))); } catch (e) {}
  }
  return new Response(JSON.stringify({ ok: true, covers }), {
    headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=3600" }
  });
}


/* --- تیتر روزنامه‌های بین‌المللی (RSS) --- */
const PRESS_FEEDS = [
  { s: "The Guardian",   url: "https://www.theguardian.com/world/rss" },
  { s: "New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { s: "Le Monde",       url: "https://www.lemonde.fr/en/rss/une.xml" },
  { s: "France 24",      url: "https://www.france24.com/en/rss" },
  { s: "El País",        url: "https://feeds.elpais.com/mrss-s/pages/ep/site/english.elpais.com/portada" },
  { s: "Deutsche Welle", url: "https://rss.dw.com/rdf/rss-en-world" }
];

async function handlePressNews() {
  const results = await Promise.allSettled(
    PRESS_FEEDS.map(async f => {
      const r = await fetch(f.url, {
        headers: { "User-Agent": "Mozilla/5.0 (PulseIran24 PressBoard)" },
        cf: { cacheTtl: 600, cacheEverything: true }
      });
      if (!r.ok) throw new Error(f.s + " " + r.status);
      return parseFeed(await r.text(), f.s, 3);
    })
  );
  const items = [];
  for (const res of results) if (res.status === "fulfilled") items.push(...res.value);
  if (!items.length) {
    return new Response(JSON.stringify({ ok: false }), { status: 502, headers: JSON_HEADERS });
  }
  return new Response(JSON.stringify({ ok: true, items }), {
    headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=600" }
  });
}
