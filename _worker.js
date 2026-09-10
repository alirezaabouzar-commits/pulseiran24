/* build: v99 — اتاق خبر هوشمند: بازنویسی فارسی خبر رسانه‌های مجاز با Gemini (پنل /ai-newsroom) | v97 — فرم تماس: تلگرام + Resend به‌جای Web3Forms | v96 — هدرهای امنیتی سراسری + سخت‌سازی پروکسی تلگرام | v95 — فرم نظر موقتاً غیرفعال (تا انتشار Impressum/Datenschutz) | v94 — /api/worldcup: گل به خودی به تیم درست، نوار بالای کارت هیچ‌وقت خالی نمی‌ماند */
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

/* v97: Web3Forms حذف شد. API آن انتظار فراخوانی از سمت مرورگر را دارد؛
   فراخوانی از ورکر (سمت سرور) نیاز به پلن پولی و ثبت IP ثابت دارد و
   ورکر کلادفلر IP ثابت ندارد — یعنی آن مسیر هیچ‌وقت کار نمی‌کرد.
   جایگزین: دو کانال موازی، تلگرام و Resend. تنظیم در
   Cloudflare Pages → Settings → Variables and Secrets:
     TELEGRAM_BOT_TOKEN   توکن ربات از @BotFather
     TELEGRAM_CHAT_ID     شناسه گفت‌وگو
     RESEND_API_KEY       کلید API از resend.com
     CONTACT_TO           آدرس ایمیل مقصد
     CONTACT_FROM         اختیاری، پیش‌فرض kontakt@pulseiran24.com
   هر کانالی که تنظیم نشده باشد بی‌صدا رد می‌شود. */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*"
};

/* ============================================================
   v82 — ابزارهای صرفه‌جویی در KV
   سقف پلن رایگان: ۱۰۰۰ عملیات put در روز (خواندن ۱۰۰٬۰۰۰ است و مشکلی ندارد).
   راهکار: هرچه کش موقتی است به Cache API لبه‌ی کلادفلر منتقل می‌شود
   (رایگان و بدون سقف) و KV فقط برای داده‌های ماندگار می‌ماند.
   ============================================================ */

async function edgeGet(key) {
  try {
    const r = await caches.default.match(new Request("https://pi24.cache/" + key));
    if (r) return await r.text();
  } catch (e) {}
  return null;
}

async function edgePut(key, body, ttl, ctx) {
  try {
    const req = new Request("https://pi24.cache/" + key);
    const resp = new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=" + (ttl || 300)
      }
    });
    if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(req, resp));
    else await caches.default.put(req, resp);
  } catch (e) {}
}

/* ============================================================
   v83 — فیلتر پست‌های بی‌محتوا
   پست‌هایی که فقط یک کلمه یا چند ایموجی‌اند (مثل «نتانیاهو» یا «ترامپ:»)
   از آرشیو، sitemap و rss کنار گذاشته می‌شوند؛ گوگل آن‌ها را
   «محتوای کم‌ارزش» می‌شمارد. صفحه‌ی /news/{id} همچنان کار می‌کند،
   فقط در فهرست‌ها نمایش داده نمی‌شود.
   برای سخت‌گیرتر یا آزادتر شدن، فقط همین عدد را تغییر بده.
   ============================================================ */
const MIN_POST_CHARS = 20;

/* طول متن واقعی، بدون لینک، ایموجی، نشانه‌گذاری و فاصله */
function meaningfulLength(text) {
  let s = String(text || "");
  s = s.replace(/https?:\/\/\S+/g, " ");                 /* لینک‌ها */
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, ""); /* نویسه‌های نامرئی */
  s = s.replace(/[\u2190-\u2BFF\uFE0F]/g, " ");           /* فلش و نمادها */
  try { s = s.replace(/[\u{1F000}-\u{1FAFF}]/gu, " "); } catch (e) {} /* ایموجی */
  s = s.replace(/[\s.,،؛:!?؟«»"'()\[\]{}\-–—_*#@|/\\]+/g, ""); /* نشانه‌گذاری */
  return s.length;
}

function isThinPost(text) {
  return meaningfulLength(text) < MIN_POST_CHARS;
}

/* v86: تشخیص «تیزر» بر اساس لینک تنها کافی نیست.
   از مردادماه ۱۴۰۵ لینک صفحه‌ی خبر ته همه‌ی پست‌های کانال گذاشته می‌شود،
   بنابراین v85 (که هر پستِ دارای pulseiran24.com/news/ را حذف می‌کرد)
   عملاً تمام خبرها را حذف می‌کرد و سایت خالی می‌ماند.
   حالا پست فقط وقتی تیزر حساب می‌شود که علاوه بر لینک،
   متن واقعی‌اش هم کوتاه باشد — یعنی چیزی جز خودِ لینک ندارد.
   meaningfulLength لینک‌ها را حذف می‌کند، پس این عدد فقط متن واقعی است. */
const SELF_PROMO_MAX_CHARS = 60;

function isSelfPromoPost(text) {
  const s = String(text || "");
  if (!/pulseiran24\.com\/news\//i.test(s)) return false;
  return meaningfulLength(s) < SELF_PROMO_MAX_CHARS;
}

/* نوشتن کم‌تکرار در KV: حداکثر یک‌بار در هر بازه (ثانیه) در هر isolate */
const KV_LAST_WRITE = new Map();
function kvThrottleOk(key, seconds) {
  const now = Date.now();
  const last = KV_LAST_WRITE.get(key) || 0;
  if (now - last < (seconds || 3600) * 1000) return false;
  KV_LAST_WRITE.set(key, now);
  return true;
}

/* شمارنده‌ی بازدید به‌صورت دسته‌ای نوشته می‌شود، نه در هر بازدید */
let VISIT_PENDING = 0;
const VISIT_FLUSH_AT = 25;

/* ── v96: لایه‌ی هدرهای امنیتی ──────────────────────────────────────────────
   هر پاسخی که از ورکر بیرون می‌رود از این تابع رد می‌شود.
   عمداً محافظه‌کارانه است: CSP فقط چهار دستوری را می‌گذارد که هیچ اسکریپت،
   استایل یا تصویر موجودی را نمی‌شکند، ولی جلوی iframe شدن سایت در دامنه‌ی
   دیگر (clickjacking)، تزریق <base>، پلاگین‌ها و ارسال فرم به مقصد بیرونی
   را می‌گیرد.
   Referrer-Policy عمداً no-referrer است: وقتی خواننده‌ای از داخل ایران روی
   لینک یک منبع خارجی کلیک می‌کند، آدرس این سایت نباید در لاگ مقصد بنشیند. */
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Content-Security-Policy": "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
};

function withSecurityHeaders(res) {
  /* پاسخ‌های بدون بدنه (204/304) و ارتقای وب‌سوکت را دست نمی‌زنیم */
  if (!res || res.status === 101 || res.status === 204 || res.status === 304) return res;
  try {
    const out = new Response(res.body, res);
    for (const k in SECURITY_HEADERS) {
      if (!out.headers.has(k)) out.headers.set(k, SECURITY_HEADERS[k]);
    }
    return out;
  } catch (e) {
    /* اگر به هر دلیلی نشد، پاسخ اصلی برمی‌گردد — سایت نباید به خاطر هدر بشکند */
    return res;
  }
}

export default {
  async fetch(request, env, ctx) {
    let res;
    try {
      res = await route(request, env, ctx);
    } catch (e) {
      res = new Response("error", { status: 500 });
    }
    return withSecurityHeaders(res);
  }
};

async function route(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/worldcup") return handleWorldCup(url, env, ctx);

    /* v91: /news و /news/ (و نسخه‌های /en و /de) شناسه ندارند، پس مقاله‌ای هم ندارند.
       پیش از این handleArticle آن‌ها را می‌گرفت و صفحه‌ی «این خبر در دسترس نیست»
       نشان می‌داد — که برای لینک‌های ناقص در تلگرام یا شبکه‌های اجتماعی بد است.
       حالا به صفحه‌ی اصلیِ همان زبان هدایت می‌شوند. باید پیش از خط /news/ بیاید. */
    {
      const noIdNews = path.match(/^\/(?:(en|de)\/)?news\/?$/);
      if (noIdNews) {
        const dest = noIdNews[1] ? url.origin + "/" + noIdNews[1] : url.origin + "/";
        return Response.redirect(dest, 302);
      }
    }

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

   
    if (path === "/tahlil" || path === "/tahlil/") return handleTahlilListI18n(url, env, "fa");
    if (path === "/tahlil.xml") return handleTahlilFeed(env);
    if (path === "/tahlil-admin" || path === "/tahlil-admin/") return handleTahlilAdminPage();
    if (path === "/tahlil-admin/api") return handleTahlilAdminApi(request, env);
    if (/^\/(en|de)\/tahlil\/?$/.test(path)) return handleTahlilListI18n(url, env, path.slice(1, 3));
    if (/^\/(en|de)\/tahlil\/[A-Za-z0-9_-]{1,60}\/?$/.test(path)) return handleTahlilPageI18n(url, env, path.split("/")[3], path.slice(1, 3));
    if (/^\/tahlil\/[A-Za-z0-9_-]{1,60}\/?$/.test(path)) return handleTahlilPageI18n(url, env, path.split("/")[2], "fa");

    if (path === "/api/tahlil-comment") return handleTahlilCommentPost(request, env);
    if (path === "/tahlil-comments-admin" || path === "/tahlil-comments-admin/") return handleTahlilCommentsAdminPage();
    if (path === "/tahlil-comments-admin/api") return handleTahlilCommentsAdminApi(request, env);

    /* v99 — اتاق خبر هوشمند (پشت ADMIN_TOKEN) */
    if (path === "/ai-newsroom" || path === "/ai-newsroom/") return aiPanelPage();
    if (path === "/api/ai/feeds")  return aiHandleFeeds(request, env);
    if (path === "/api/ai/models") return aiHandleModels(request, env);
    if (path === "/api/ai/probe")  return aiHandleProbe(request, env);
    if (path === "/api/ai/draft")  return aiHandleDraft(request, env);

    return env.ASSETS.fetch(request);
}

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
  const map = {
    "Semifinals": "Semi-finals", "Semifinal": "Semi-finals",
    "Quarterfinals": "Quarter-finals", "Quarterfinal": "Quarter-finals",
    "Round of 16": "Round of 16", "Round of 32": "Round of 32",
    "Third-place match": "3rd Place Final", "Third Place": "3rd Place Final",
    "Final": "Final"
  };
  const comp = (ev.competitions && ev.competitions[0]) || {};
  /* ۱) عنوان مرحله (فقط جام‌ها این را دارند) */
  try {
    const n = comp.notes;
    if (n && n.length && n[0].headline) {
      const h = n[0].headline;
      for (const k in map) if (h.indexOf(k) !== -1) return map[k];
      return h;
    }
  } catch (e) {}
  /* v94: ۲) altGameNote — مثل «FIFA World Cup, Group A» */
  if (comp.altGameNote) {
    for (const k in map) if (comp.altGameNote.indexOf(k) !== -1) return map[k];
    return comp.altGameNote;
  }
  /* v94: ۳) نام ورزشگاه — برای لیگ‌ها که هیچ‌کدام از بالا را ندارند،
     تا نوار بالای کارت بازی خالی نماند. */
  if (comp.venue && comp.venue.fullName) return comp.venue.fullName;
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

/* v94: در گل به خودی، ESPN تیمِ سودبرنده را ثبت می‌کند نه تیم بازیکن.
   نتیجه: «گل به خودی! لیندلوف — برایتون» که برای یک سایت خبری غلط است.
   اگر تیمِ خودِ بازیکن در داده باشد از آن استفاده می‌کنیم، وگرنه تیم مقابل. */
function ownGoalTeamName(playerTeamId, creditedId, teams) {
  if (playerTeamId && teams[playerTeamId]) return teams[playerTeamId];
  for (const id in teams) if (id !== String(creditedId)) return teams[id];
  return teams[creditedId] || "";
}

function espnEventsFromKeyEvents(keyEvents, teams) {
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
      let gTeam = teamName;
      if (detail === "Own Goal" && teams) {
        const pt = players[0] && (players[0].team && players[0].team.id ||
                   (players[0].athlete && players[0].athlete.team && players[0].athlete.team.id));
        gTeam = ownGoalTeamName(pt, (ke.team && ke.team.id), teams) || teamName;
      }
      out.push({ time: { elapsed, extra }, type: "Goal", detail,
        player: { name: p0 }, assist: { name: p1 }, team: { name: gTeam } });
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
      let gTeam = teamName;
      if (d.ownGoal) {
        const pt = players[0] && players[0].team && players[0].team.id;
        gTeam = ownGoalTeamName(pt, (d.team && d.team.id), teams) || teamName;
      }
      out.push({ time: { elapsed, extra }, type: "Goal", detail,
        player: { name: p0 }, assist: { name: p1 }, team: { name: gTeam } });
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

/* v93: اسپی‌ان درخواست‌های بدون هدرِ مرورگری را با 403 رد می‌کند.
   هدرهای زیر همان چیزی است که یک مرورگر واقعی می‌فرستد. */
const ESPN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.espn.com/soccer/scoreboard",
  "Origin": "https://www.espn.com"
};

/* v93: سه مسیر مختلف اسپی‌ان. اگر اولی 403 داد، بعدی امتحان می‌شود.
   شکل خروجی دومی مثل اولی است؛ سومی رویدادها را زیر content.sbData می‌گذارد. */
const ESPN_SCOREBOARDS = [
  (lg, d) => ESPN_BASE + "/" + lg + "/scoreboard?limit=60&dates=" + d,
  (lg, d) => "https://site.web.api.espn.com/apis/site/v2/sports/soccer/" + lg +
             "/scoreboard?region=us&lang=en&contentorigin=espn&limit=60&dates=" + d,
  (lg, d) => "https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league=" + lg + "&dates=" + d
];

function espnEventsOf(json) {
  if (json && json.events) return json.events;
  if (json && json.content && json.content.sbData && json.content.sbData.events) {
    return json.content.sbData.events;
  }
  return [];
}

async function espnGet(target, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms || 6000);
  try {
    return await fetch(target, {
      signal: ctl.signal,
      headers: ESPN_HEADERS,
      cf: { cacheTtl: 60, cacheEverything: true }
    });
  } finally { clearTimeout(timer); }
}

async function handleWorldCup(url, env, ctx) {
  const lg = url.searchParams.get("league") || "wc";
  const espnLg = ESPN_LEAGUES[lg] || ESPN_LEAGUES.epl;
  const day = url.searchParams.get("day") || "today";
  const off = day === "yesterday" ? -1 : day === "tomorrow" ? 1 : 0;
  const target = new Date(Date.now() + off * 86400000);
  const dateStr = target.toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
  const compact = dateStr.replace(/-/g, "");

  const cache = caches.default;
  const cacheKey = new Request("https://cache.pulseiran24.internal/worldcup-espn?lg=" + espnLg + "&date=" + dateStr);

  /* v92: cache.match بیرون از try بود. اگر خطا می‌داد، ورکر بدون هیچ پاسخی
     می‌مرد و کلادفلر صفحه‌ی «Bad gateway» خودش را نشان می‌داد. */
  try {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const r = new Response(hit.body, hit);
      r.headers.set("Access-Control-Allow-Origin", "*");
      return r;
    }
  } catch (e) {}

  /* v92: پاسخ خطا با کد 200 برمی‌گردد، نه 502.
     کلادفلر کدهای 502 و 504 را با صفحه‌ی خطای خودش جایگزین می‌کند و
     متن خطای واقعی هرگز به مرورگر نمی‌رسد. حالا پیام داخل همان JSON است. */
  const fail = (msg) => new Response(
    JSON.stringify({ date: dateStr, response: [], error: String(msg) }),
    { status: 200, headers: { ...JSON_HEADERS, "Cache-Control": "no-store" } }
  );

  try {
    /* v92: قبلاً یک بازه‌ی سه‌روزه گرفته می‌شد و برای هر بازی یک درخواست
       summary جداگانه هم می‌رفت. JSON اسکوربورد اسپی‌ان برای سه روز حدود یک
       مگابایت است و در پلن رایگان (۱۰ms CPU) صرفِ پارس‌کردنش ورکر را می‌کشد.
       حالا: یک روز، سقف ۶۰ نتیجه، و حداکثر دو summary فقط برای بازی‌های زنده. */
    let all = null;
    const tried = [];
    for (let i = 0; i < ESPN_SCOREBOARDS.length; i++) {
      let res;
      try {
        res = await espnGet(ESPN_SCOREBOARDS[i](espnLg, compact), 6000);
      } catch (e) {
        tried.push("#" + (i + 1) + " " + ((e && e.message) || "fetch failed"));
        continue;
      }
      if (!res.ok) { tried.push("#" + (i + 1) + " http " + res.status); continue; }
      try {
        all = espnEventsOf(await res.json());
      } catch (e) {
        tried.push("#" + (i + 1) + " bad json");
        continue;
      }
      break;
    }
    if (all === null) return fail("upstream refused — " + tried.join(" | "));

    const LIVE = ["1H", "2H", "ET", "BT", "P", "HT", "LIVE", "INT"];

    /* فیلتر بر اساس تاریخ برلین (اسپی‌ان تاریخ را به وقت آمریکا می‌دهد) */
    const sameDay = [];
    for (const ev of all) {
      const local = new Date(ev.date).toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
      if (local === dateStr) sameDay.push(ev);
    }

    let summaryBudget = 2;
    const fixtures = [];
    for (const ev of sameDay) {
      const short = espnStatus(ev);
      const comp = (ev.competitions && ev.competitions[0]) || {};
      /* گل و کارت از خودِ اسکوربورد می‌آید و هزینه‌ی اضافه ندارد */
      let events = espnDetailsEvents(comp);
      /* تعویض‌ها فقط در summary هستند — گران است، پس فقط برای بازی زنده */
      if (LIVE.includes(short) && summaryBudget > 0) {
        summaryBudget--;
        try {
          const smRes = await espnGet(
            ESPN_BASE + "/" + espnLg + "/summary?event=" + ev.id, 4000);
          if (smRes && smRes.ok) {
            const sm = await smRes.json();
            if (sm.keyEvents && sm.keyEvents.length) {
              const tmap = {};
              for (const c of (comp.competitors || [])) {
                tmap[c.id] = (c.team && c.team.displayName) || "";
              }
              const full = espnEventsFromKeyEvents(sm.keyEvents, tmap);
              if (full.length) events = full;
            }
          }
        } catch (e) {}
      }
      fixtures.push(espnToFixture(ev, events));
    }

    const anyLive = fixtures.some(fx => LIVE.includes(fx.fixture.status.short));
    const ttl = anyLive ? 60 : 300;

    const resp = new Response(JSON.stringify({ date: dateStr, response: fixtures }), {
      headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=" + ttl }
    });
    try {
      if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      else await cache.put(cacheKey, resp.clone());
    } catch (e) {}
    return resp;
  } catch (e) {
    return fail((e && e.message) || e);
  }
}

/* ---------- خبرها از تلگرام ---------- */

/* v89: موجودیت‌های HTML نام‌دار که تلگرام و فیدها می‌فرستند.
   قبلاً فقط موجودیت‌های عددی (&#33;) و چند مورد پایه رمزگشایی می‌شد،
   بنابراین &rlm; خام روی سایت چاپ می‌شد. &zwnj; (نیم‌فاصله) از آن هم
   مهم‌تر است، چون اگر رمزگشایی نشود متن فارسی به‌هم می‌ریزد. */
const NAMED_ENTITIES = {
  rlm: "\u200F", lrm: "\u200E", zwnj: "\u200C", zwj: "\u200D",
  shy: "\u00AD", thinsp: "\u2009", ensp: "\u2002", emsp: "\u2003",
  hellip: "…", mdash: "—", ndash: "–", minus: "−",
  laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  bull: "•", middot: "·", deg: "°", times: "×", divide: "÷",
  euro: "€", pound: "£", yen: "¥", copy: "©", reg: "®", trade: "™",
  hearts: "♥", star: "★", check: "✓", dagger: "†", permil: "‰"
};

function decodeNamed(s) {
  return String(s).replace(/&([a-zA-Z]+);/g, (m, name) => {
    const key = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : m;
  });
}

/* v89: لینکِ خودِ سایت و امضای کانال از متن خبر برداشته می‌شود.
   روی سایت این لینک به خودِ همان صفحه اشاره می‌کند و دکمه‌ی
   «ادامه مطلب» همان کار را انجام می‌دهد، پس فقط نویز است و
   چون طولانی است از کادر کارت هم بیرون می‌زند.
   توجه: این تابع باید بعد از isSelfPromoPost اجرا شود، وگرنه
   فیلتر تیزر دیگر لینکی برای تشخیص پیدا نمی‌کند. */
function stripSelfSignature(text) {
  let s = String(text || "");
  s = s.replace(/(?:https?:\/\/)?(?:www\.)?pulseiran24\.com\/news\/\d+/gi, "");
  s = s.replace(/^[ \t]*#pulseiran24[ \t]*$/gim, "");
  s = s.replace(/^[ \t]*@pulseiran24[ \t]*(?:\|[ \t]*(?:https?:\/\/)?(?:www\.)?pulseiran24\.com[ \t]*)?$/gim, "");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function cleanText(raw) {
  return decodeNamed(raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
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
    /* v86: فیلتر تیزر از اینجا برداشته شد و به fetchLivePosts منتقل شد.
       دلیل: اگر فیلتر همه‌ی پست‌ها را حذف کند، parsePosts آرایه‌ی خالی
       برمی‌گرداند و fetchLivePosts آن را «تلگرام در دسترس نیست» می‌فهمد
       و به دامنه‌ی بعدی می‌رود. نتیجه‌اش خاموشی کل بخش خبر بود. */
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
    if (!r.ok && r.status !== 206) return new Response("upstream " + r.status, { status: 400 });
    /* v96: مثل tgimg — فقط انواع ویدئو مجازند */
    const vct = String(r.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    const safeVct = /^video\/(mp4|webm|ogg|quicktime)$/.test(vct) ? vct : "video/mp4";
    const headers = {
      "Content-Type": safeVct,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
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
    if (!r.ok) return new Response("upstream " + r.status, { status: 400 });
    /* v96: نوع محتوا از upstream عیناً پاس داده می‌شد. اگر روزی به‌جای عکس
       text/html برمی‌گشت، آن HTML روی دامنه‌ی خودِ ما اجرا می‌شد (XSS).
       حالا فقط انواع تصویر مجازند و بقیه به jpeg نگاشت می‌شوند. */
    const ct = String(r.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    const safeCt = /^image\/(jpeg|jpg|png|gif|webp|avif|svg\+xml)$/.test(ct) && ct !== "image/svg+xml"
      ? ct : "image/jpeg";
    return new Response(r.body, {
      headers: {
        "Content-Type": safeCt,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
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
      /* v86: تیزرها اینجا کنار گذاشته می‌شوند، نه داخل parsePosts.
         شبکه‌ی ایمنی: اگر فیلتر همه را حذف کرد، فهرست فیلترنشده
         برگردانده می‌شود. هیچ فیلتری نباید بخش خبر را خاموش کند. */
      const kept = posts.filter(p => !isSelfPromoPost(p.text));
      const out = kept.length ? kept : posts;
      /* v89: بعد از فیلتر، لینک خودارجاع و امضا از متن پاک می‌شود */
      return out.map(p => ({ ...p, text: stripSelfSignature(p.text) }));
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
      if (!seen.has(id) && !isThinPost(p.text)) {
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
  /* v83: پست‌های بی‌محتوا در آرشیو نمایش داده نمی‌شوند */
  index = index.filter(x => x && !isThinPost(x.text) && !isSelfPromoPost(x.text)); /* v85 */
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

/* ترجمه‌ی خام بدون هیچ تماسی با KV */
async function translateRaw(text, target) {
  const src = String(text || "").trim();
  if (!src) return "";
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

  return out || src; /* در بدترین حالت متن فارسی می‌ماند */
}

/* ترجمه‌ی تک‌رشته‌ای با کش KV (یک کلید برای هر رشته) */
async function translateOne(text, target, env) {
  const src = String(text || "").trim();
  if (!src) return "";
  const kv = env && env.PULSE_STATS;
  const key = "tr:" + target + ":" + trHash(src);

  if (kv) {
    try {
      const hit = await kv.get(key);
      if (hit) return hit;
    } catch (e) {}
  }

  const out = await translateRaw(src, target);
  /* اگر ترجمه شکست خورد (خروجی = ورودی) در KV ذخیره نمی‌شود تا put هدر نرود */
  if (kv && out && out !== src) {
    try { await kv.put(key, out, { expirationTtl: 60 * 60 * 24 * 90 }); } catch (e) {}
  }
  return out;
}

/* v82: ترجمه‌ی گروهی — کل بندهای یک صفحه در «یک» کلید KV.
   به‌جای ۲۶ put برای هر مقاله، فقط ۱ put نوشته می‌شود. */
async function translateGroup(texts, target, env, groupKey) {
  const list = Array.from(new Set((texts || []).map(t => String(t || "").trim()).filter(Boolean)));
  if (!list.length) return {};
  const kv = env && env.PULSE_STATS;
  const key = "trg:" + target + ":" + groupKey;

  let map = {};
  if (kv) {
    try {
      const raw = await kv.get(key);
      if (raw) { const j = JSON.parse(raw); if (j && typeof j === "object") map = j; }
    } catch (e) { map = {}; }
  }

  const missing = list.filter(t => !map[t]);
  if (!missing.length) return map;

  let changed = false;
  try {
    const done = await Promise.all(missing.map(t => translateRaw(t, target)));
    missing.forEach((t, i) => {
      const v = done[i];
      if (v && v !== t) { map[t] = v; changed = true; }
      else map[t] = t;
    });
  } catch (e) {}

  if (kv && changed) {
    try { await kv.put(key, JSON.stringify(map), { expirationTtl: 60 * 60 * 24 * 90 }); } catch (e) {}
  }
  return map;
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
    if (isThinPost(p.text)) continue; /* v83 */
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

/* v87: تیتر را از پایان اولین جمله جدا می‌کند.
   قبلاً متن فقط از اولین «خط جدید» به تیتر و بدنه تقسیم می‌شد. اگر پست تلگرام
   یک پاراگراف بلند بود و خط جدید فقط قبل از امضای کانال می‌آمد، کل پاراگراف
   «تیتر» می‌شد، در ۱۴۰ نویسه بریده می‌شد و بدنه فقط امضا را نشان می‌داد. */
function firstSentenceCut(t) {
  for (let i = 30; i < Math.min(t.length, 220); i++) {
    const ch = t.charAt(i);
    if (ch === "." || ch === "؟" || ch === "!" || ch === "؛") return i + 1;
  }
  return -1;
}

function splitTitleBody(rawText) {
  const text = String(rawText || "");
  const idx = text.indexOf("\n");
  let head, rest;
  if (idx === -1) { head = text.trim(); rest = ""; }
  else { head = text.slice(0, idx).trim(); rest = text.slice(idx + 1); }

  let title;
  if (head.length > 140) {
    const cut = firstSentenceCut(head);
    if (cut > 0) {
      title = head.slice(0, cut).trim();
      /* باقی‌مانده‌ی خط اول باید به ابتدای بدنه برود تا چیزی از دست نرود */
      const tail = head.slice(cut).trim();
      if (tail) rest = tail + (rest ? "\n\n" + rest : "");
    } else {
      title = head;
      /* جای مناسبی برای برش نبود: متن کامل خط اول را در بدنه نگه دار */
      rest = head + (rest ? "\n\n" + rest : "");
    }
  } else {
    title = head;
  }

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
      /* v82: یک کلید KV برای کل مقاله به‌جای یک کلید برای هر بند */
      tr = await translateGroup(texts, lang, env, "art" + String(id));
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
      if (posts && posts.length) {
        /* v89: همان پاک‌سازی مسیر اصلی، تا صفحه‌ی /news/{id} هم لینک خودارجاع نداشته باشد */
        const p = posts[0];
        return { ...p, text: stripSelfSignature(p.text) };
      }
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

<link rel="stylesheet" href="/assets/fonts/vazirmatn.css">
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
<link rel="stylesheet" href="/assets/fonts/vazirmatn.css">
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
        /* v82: به‌جای یک put در هر بازدید، هر ۲۵ بازدید یک‌بار نوشته می‌شود.
           عدد نمایش‌داده‌شده همیشه درست است؛ فقط ذخیره‌ی نهایی دسته‌ای است. */
        VISIT_PENDING += 1;
        if (VISIT_PENDING >= VISIT_FLUSH_AT) {
          const add = VISIT_PENDING;
          VISIT_PENDING = 0;
          visits += add;
          try { await kv.put("visits", String(visits)); } catch (e) {}
        } else {
          visits += VISIT_PENDING;
        }
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

  const name  = (fields.name  || "").trim().slice(0, 120) || "ناشناس";
  const email = (fields.email || "").trim().slice(0, 160);
  const text  = message.slice(0, 3000);

  /* پیام‌ها هیچ‌جا ذخیره نمی‌شوند — فقط عبور می‌کنند.
     تا انتشار Datenschutzerklärung این عمدی است. */
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const plain =
    "📩 پیام تازه از فرم تماس\n\n" +
    "نام: " + name + "\n" +
    (email ? "ایمیل: " + email + "\n" : "") +
    "زمان: " + stamp + " UTC\n\n" +
    text;

  const jobs = [];

  /* کانال ۱ — تلگرام */
  const tgToken = env && env.TELEGRAM_BOT_TOKEN;
  const tgChat  = env && env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChat) {
    jobs.push(
      fetch("https://api.telegram.org/bot" + tgToken + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tgChat,
          text: plain.slice(0, 4000),
          disable_web_page_preview: true
        })
      }).then(r => r.ok)
    );
  }

  /* کانال ۲ — Resend */
  const rsKey = env && env.RESEND_API_KEY;
  const rsTo  = env && env.CONTACT_TO;
  if (rsKey && rsTo) {
    const rsFrom = (env && env.CONTACT_FROM) || "Pulse Iran 24 <kontakt@pulseiran24.com>";
    const payload = {
      from: rsFrom,
      to: [rsTo],
      subject: "پیام تازه از سایت پالس ایران ۲۴ — " + name,
      text: plain
    };
    /* اگر فرستنده ایمیل داده بود، پاسخ‌دادن مستقیم ممکن شود */
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) payload.reply_to = email;

    jobs.push(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + rsKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }).then(r => r.ok)
    );
  }

  if (!jobs.length) return new Response("contact not configured", { status: 503 });

  /* هر دو موازی می‌روند. اگر دست‌کم یکی رساند، برای کاربر موفق است. */
  const results = await Promise.allSettled(jobs);
  const delivered = results.some(r => r.status === "fulfilled" && r.value === true);

  return new Response(delivered ? "ok" : "send failed", { status: delivered ? 200 : 502 });
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
  /* v82: اول کش لبه (رایگان)، بعد کش KV — نوشتن در KV حداکثر ساعتی یک‌بار */
  const edge = await edgeGet(CACHE_KEY);
  if (edge) return new Response(edge, { headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=900" } });
  if (kv) {
    try {
      const cached = await kv.get(CACHE_KEY);
      if (cached) {
        await edgePut(CACHE_KEY, cached, 900, ctx);
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
  if (items.length) {
    await edgePut(CACHE_KEY, body, 900, ctx);
    if (kv && ctx && ctx.waitUntil && kvThrottleOk("podcasts", 3600)) {
      try { ctx.waitUntil(kv.put(CACHE_KEY, body, { expirationTtl: 7200 })); } catch (e) {}
    }
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
  /* v82: قیمت‌ها فقط روی لبه کش می‌شوند — هیچ نوشتنی در KV.
     (تا ۲۸۸ put در روز صرفه‌جویی) */
  const edge = await edgeGet(CACHE_KEY);
  if (edge) return new Response(edge, { headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=180" } });
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
  if (items.length) await edgePut(CACHE_KEY, body, 180, ctx);
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
<link rel="stylesheet" href="/assets/fonts/vazirmatn.css">
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
  for (const p of ["darbare.html", "khatte-mashy.html", "tashih.html", "jarayed.html", "rooydad.html", "podcast.html"]) {
    urls.push(`  <url><loc>${SITE_ORIGIN}/${p}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`);
  }
  for (const u of await tahlilSitemapUrlsI18n(env)) urls.push(u);
  for (const it of index.slice(0, 2000)) {
    const id = String(it.id || "").replace(/[^0-9]/g, "");
    if (!id) continue;
    if (isThinPost(it.text)) continue; /* v83 */
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
    if (isThinPost(it.text)) return ""; /* v83 */
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

  if (kv && ctx && ctx.waitUntil && kvThrottleOk("press_covers", 3600)) {
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


/* ============================================================================
   پالس ایران ۲۴ — بخش «تحلیل صوتی»  (v78)
   ----------------------------------------------------------------------------
   این کد برای همان _worker.js فعلی (v77) نوشته شده و از توابع خودِ آن استفاده
   می‌کند (escHtml, xmlEsc, formatFaDate, textToParagraphs, notFoundArticlePage,
   checkAdmin, adminJson, sendPush, SITE_ORIGIN). هیچ متغیر تکراری تعریف نمی‌کند.

   ── گام ۱: کل این فایل را عیناً به انتهای _worker.js اضافه کن (append).

   ── گام ۲: در تابع fetch، درست *بالای* این خط:

        return env.ASSETS.fetch(request);

      این پنج خط را اضافه کن:

        if (path === "/tahlil" || path === "/tahlil/") return handleTahlilList(url, env);
        if (path === "/tahlil.xml") return handleTahlilFeed(env);
        if (path === "/tahlil-admin" || path === "/tahlil-admin/") return handleTahlilAdminPage();
        if (path === "/tahlil-admin/api") return handleTahlilAdminApi(request, env);
        if (/^\/tahlil\/[A-Za-z0-9_-]{1,60}\/?$/.test(path)) return handleTahlilPage(url, env, path.split("/")[2]);

   ── گام ۳ (اختیاری، برای سئو): در تابع handleSitemap، بلافاصله بعد از حلقه‌ی
      darbare/khatte-mashy/tashih این دو خط را بگذار:

        for (const u of await tahlilSitemapUrls(env)) urls.push(u);

   ── گام ۴ (اختیاری): در خط اول _worker.js عدد v77 را به v78 تغییر بده تا
      بدانی کدام نسخه بالاست. فقط همان عدد را عوض کن، به بقیه‌ی خط دست نزن.

   ── استفاده:
      ۱) فایل mp3 را در assets/audio/ داخل ریپو گیت‌هاب بگذار
         (مونو، ۶۴ تا ۹۶ کیلوبیت؛ ۱۰ دقیقه ≈ ۶ مگابایت، سقف Pages ۲۵ مگابایت
          یعنی تا حدود ۴۰ دقیقه صدا هم جا می‌شود).
         مدت را می‌توانی «۶۰۰» یا «10:00» بنویسی — هر دو قبول است.
         برای قطعه‌های بلند: دکمه‌های ۱۵ ثانیه جلو/عقب و «ادامه از …» فعال است
         و متن کامل تا ۶۰ هزار کاراکتر (حدود ۷۰ دقیقه گفتار) پشتیبانی می‌شود.
      ۲) به /tahlil-admin برو، با همان ADMIN_TOKEN وارد شو، عنوان و آدرس فایل و
         متن کامل را بگذار و منتشر کن. اعلان وب‌پوش هم مثل پنل خبر کار می‌کند.
      ۳) فید پادکست روی /tahlil.xml آماده است (برای اسپاتیفای/اپل در آینده).

   ── سه چیز جدا که خودت تعیین می‌کنی:
      • عنوان        → تیتری که بالای صفحه دیده می‌شود
      • شناسه        → آدرس صفحه، مثل /tahlil/1405-05-05
      • نام نمایشی   → نامی که زیر پلیر نشان داده می‌شود و فایل با همان
                       نام دانلود می‌شود (فارسی هم مجاز است). خالی بگذاری،
                       خودش از روی عنوان ساخته می‌شود.
      نام واقعی فایل روی سرور (assets/audio/…) می‌تواند کاملاً متفاوت باشد.

   نکته: برای دیده‌شدن بخش در صفحه‌ی اصلی، یک لینک به /tahlil در منوی
   index.html اضافه کن — این فایل به index.html دست نمی‌زند.
   ============================================================================ */

/* ============================================================
   تحلیل صوتی — build v78
   ------------------------------------------------------------
   مسیرها:
     /tahlil              فهرست تحلیل‌های صوتی
     /tahlil/{id}         صفحه‌ی هر تحلیل (پلیر + متن کامل + AudioObject)
     /tahlil.xml          فید پادکست (برای اسپاتیفای/اپل در آینده)
     /tahlil-admin        پنل انتشار (همان ADMIN_TOKEN فعلی)
   ذخیره در KV (همان PULSE_STATS):
     tahlil:{id}          خود تحلیل
     tahlil_index         فهرست برای صفحه‌ی /tahlil و sitemap
   فایل صوتی: assets/audio/*.mp3 در ریپو گیت‌هاب
   از توابع موجود همین ورکر استفاده می‌کند:
     escHtml, xmlEsc, formatFaDate, textToParagraphs,
     notFoundArticlePage, checkAdmin, adminJson, sendPush,
     JSON_HEADERS, SITE_ORIGIN
   ============================================================ */

const TAHLIL_CAP = 300;

async function getTahlilIndex(env) {
  const kv = env && env.PULSE_STATS;
  if (!kv) return [];
  try {
    const raw = await kv.get("tahlil_index");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

/* مدت را هم به ثانیه («۶۰۰») و هم به شکل «۱۰:۰۰» یا «۱:۰۲:۳۰» می‌پذیرد */
function parseTahlilDuration(v) {
  const raw = String(v == null ? "" : v)
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .trim();
  if (!raw) return 0;
  if (raw.indexOf(":") !== -1) {
    const parts = raw.split(":").map(x => parseInt(x, 10) || 0);
    while (parts.length < 3) parts.unshift(0);
    return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  return Math.max(0, parseInt(raw, 10) || 0);
}

function tahlilIsoDuration(sec) {
  const s = Math.max(0, parseInt(sec, 10) || 0);
  const h = Math.floor(s / 3600);
  return "PT" + (h ? h + "H" : "") + Math.floor((s % 3600) / 60) + "M" + (s % 60) + "S";
}

function tahlilClock(sec) {
  const s = Math.max(0, parseInt(sec, 10) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? (h + ":" + String(m).padStart(2, "0") + ":" + ss) : (m + ":" + ss);
}

/* ---------- استایل مشترک (هماهنگ با صفحه‌ی خبر) ---------- */

const TAHLIL_CSS = `
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
  .art-meta .badge{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:3px 11px;color:var(--pulse);font-weight:700}
  h1{font-size:1.55rem;font-weight:900;line-height:1.5;margin:0 0 14px}
  .lede{color:var(--dim);font-size:1.02rem;margin:0 0 22px}
  /* پلیر: خط ضربان برند به‌جای نوار پیشرفت */
  .player{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 16px 12px;margin-bottom:26px}
  .prow{display:flex;align-items:center;gap:14px}
  .playbtn{flex:0 0 auto;width:52px;height:52px;border-radius:50%;border:0;background:var(--pulse);
    color:#fff;font-size:1.05rem;cursor:pointer;display:grid;place-items:center;transition:transform .15s}
  .playbtn:hover{transform:scale(1.06)}
  .playbtn:focus-visible{outline:3px solid var(--text);outline-offset:3px}
  .track{position:relative;flex:1;height:36px;cursor:pointer}
  .track svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;transform:scaleX(-1)}
  .base{stroke:var(--line);stroke-width:2;fill:none;stroke-linecap:round}
  .prog{stroke:var(--pulse);stroke-width:2.6;fill:none;stroke-linecap:round;
    stroke-dasharray:1000;stroke-dashoffset:1000}
  .tm{font-variant-numeric:tabular-nums;color:var(--dim);font-size:.85rem;flex:0 0 auto;
    min-width:88px;text-align:left;direction:ltr}
  .tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
  .chip{background:transparent;border:1px solid var(--line);color:var(--dim);border-radius:999px;
    padding:5px 13px;font-size:.82rem;cursor:pointer;font-family:inherit}
  .chip[aria-pressed="true"]{background:rgba(255,45,74,.12);color:var(--pulse);border-color:var(--pulse)}
  .fname{color:var(--dim);font-size:.78rem;margin-top:10px;unicode-bidi:plaintext}
  h2{font-size:1.05rem;margin:34px 0 4px;font-weight:800}
  .hint{color:var(--dim);font-size:.82rem;margin:0 0 14px}
  .art-body p{margin:0 0 14px;font-size:1.03rem;color:#dbe1e8}
  .srcs{margin-top:30px;padding:14px 16px;background:var(--surface);border:1px solid var(--line);
    border-radius:12px;color:var(--dim);font-size:.86rem}
  .actions{display:flex;flex-wrap:wrap;gap:10px;margin:26px 0;padding-top:20px;border-top:1px solid var(--line)}
  .actions a{background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:10px;
    padding:9px 16px;font-size:.9rem;font-weight:600;text-decoration:none}
  .actions a.wa:hover{background:#25D366;border-color:#25D366;color:#fff}
  .actions a.tg:hover{background:var(--tg);border-color:var(--tg);color:#fff}
  .actions a.x:hover{background:#000;border-color:#000;color:#fff}
  .tlist{list-style:none;padding:0;margin:22px 0 0}
  .tlist li{border-top:1px solid var(--line)}
  .tlist li:first-child{border-top:0}
  .tlist a{display:flex;justify-content:space-between;gap:16px;padding:16px 2px;text-decoration:none}
  .tlist a:hover strong{color:var(--pulse)}
  .tlist strong{font-weight:600;font-size:1rem}
  .tlist span{color:var(--dim);font-size:.8rem;white-space:nowrap;font-variant-numeric:tabular-nums}
  .empty{color:var(--dim)}
  .home-link{display:block;margin:22px 0 40px;color:var(--pulse);font-weight:700;text-decoration:none}
  footer{border-top:1px solid var(--line);margin-top:40px;padding:22px 0;color:var(--dim);font-size:.85rem;text-align:center}
  footer a{color:var(--tg);text-decoration:none}
  @media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const TAHLIL_HEADER = `<header><div class="wrap">
  <a class="logo" href="/"><img src="/assets/icon-192.png" alt="" onerror="this.style.display='none'">پالس <b>ایران ۲۴</b></a>
</div></header>`;

const TAHLIL_FOOTER = `<footer>پالس ایران ۲۴ — نبض خبر ایران و جهان · <a href="https://telegram.me/pulseiran24" target="_blank" rel="noopener">کانال تلگرام</a></footer>`;

const TAHLIL_FONT = `<link rel="stylesheet" href="/assets/fonts/vazirmatn.css">`;

/* ---------- صفحه‌ی یک تحلیل ---------- */

async function handleTahlilPage(url, env, id) {
  const kv = env && env.PULSE_STATS;
  if (!kv) return notFoundArticlePage();

  let t = null;
  try {
    const raw = await kv.get("tahlil:" + id);
    if (raw) t = JSON.parse(raw);
  } catch (e) {}
  if (!t) return notFoundArticlePage();

  const origin = url.origin;
  const canonical = origin + "/tahlil/" + id;
  const audioAbs = /^https?:\/\//.test(t.audio) ? t.audio : origin + t.audio;
  const cover = t.image || "/assets/og-image.jpg";
  const coverAbs = /^https?:\/\//.test(cover) ? cover : origin + cover;

  let description = String(t.summary || t.title || "").replace(/\s+/g, " ").trim();
  if (description.length > 160) description = description.slice(0, 157) + "…";

  /* نام فایل هنگام دانلود و نمایش زیر پلیر — اگر خالی باشد از عنوان ساخته می‌شود */
  const dlName = (t.filename && t.filename.trim())
    ? t.filename.trim()
    : (String(t.title).replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 80) + ".mp3");

  const paragraphs = textToParagraphs(t.transcript || "");
  const bodyHtml = paragraphs.map(p => "<p>" + escHtml(p) + "</p>").join("\n");

  const waShare = "https://wa.me/?text=" + encodeURIComponent(t.title + "\n" + canonical + "\n\n📡 Pulse Iran 24 | https://pulseiran24.com");
  const tgShare = "https://t.me/share/url?url=" + encodeURIComponent(canonical) + "&text=" + encodeURIComponent(t.title);
  const xShare = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(t.title) + "&url=" + encodeURIComponent(canonical);

  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "AudioObject",
    "name": t.title,
    "description": description,
    "contentUrl": audioAbs,
    "encodingFormat": "audio/mpeg",
    "duration": tahlilIsoDuration(t.duration),
    "uploadDate": t.date,
    "datePublished": t.date,
    "inLanguage": "fa-IR",
    "url": canonical,
    "thumbnailUrl": coverAbs,
    "transcript": t.transcript || undefined,
    "publisher": {
      "@type": "NewsMediaOrganization",
      "name": "Pulse Iran 24",
      "url": SITE_ORIGIN,
      "logo": { "@type": "ImageObject", "url": SITE_ORIGIN + "/assets/icon-512.png" }
    }
  }).replace(/</g, "\\u003c");

  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(t.title)} | تحلیل صوتی پالس ایران ۲۴</title>
<meta name="description" content="${escHtml(description)}">
<link rel="canonical" href="${escHtml(canonical)}">
<meta name="theme-color" content="#0D1117">
<link rel="icon" href="/assets/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Pulse Iran 24">
<meta property="og:title" content="${escHtml(t.title)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:url" content="${escHtml(canonical)}">
<meta property="og:image" content="${escHtml(coverAbs)}">
<meta property="og:audio" content="${escHtml(audioAbs)}">
<meta property="og:locale" content="fa_IR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(t.title)}">
<meta name="twitter:description" content="${escHtml(description)}">
<meta name="twitter:image" content="${escHtml(coverAbs)}">
${TAHLIL_FONT}
<script type="application/ld+json">${ld}</script>
<style>${TAHLIL_CSS}</style>
</head>
<body>
${TAHLIL_HEADER}
<main class="wrap">
  <div class="art-meta">
    <span class="badge">تحلیل صوتی</span>
    <span>${escHtml(formatFaDate(t.date))}</span>
    <span>زمان شنیدن: ${escHtml(tahlilClock(t.duration))}</span>
  </div>
  <h1>${escHtml(t.title)}</h1>
  ${t.summary ? `<p class="lede">${escHtml(t.summary)}</p>` : ""}

  <div class="player">
    <audio id="au" src="${escHtml(t.audio)}" preload="metadata"></audio>
    <div class="prow">
      <button class="playbtn" id="pb" aria-label="پخش">▶</button>
      <div class="track" id="tk" role="slider" tabindex="0" aria-label="جای‌یابی در فایل صوتی"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <svg viewBox="0 0 300 36" preserveAspectRatio="none" aria-hidden="true">
          <path class="base" d="M0 18H112l8-12 11 24 9-12H300"/>
          <path class="prog" id="pg" d="M0 18H112l8-12 11 24 9-12H300"/>
        </svg>
      </div>
      <span class="tm" id="tm">0:00 / ${escHtml(tahlilClock(t.duration))}</span>
    </div>
    <div class="tools">
      <button class="chip" id="rs" style="display:none"></button>
      <button class="chip" id="bk">↺ ۱۵ ثانیه</button>
      <button class="chip" id="fw">۱۵ ثانیه ↻</button>
      <button class="chip" data-rate="1" aria-pressed="true">۱×</button>
      <button class="chip" data-rate="1.25" aria-pressed="false">۱.۲۵×</button>
      <button class="chip" data-rate="1.5" aria-pressed="false">۱.۵×</button>
      <a class="chip" style="text-decoration:none" href="${escHtml(t.audio)}" download="${escHtml(dlName)}">دانلود صوت</a>
    </div>
    <div class="fname">🎧 ${escHtml(dlName)}</div>
  </div>

  ${bodyHtml ? `<h2>متن کامل</h2>
  <p class="hint">همان متنی که در فایل صوتی خوانده شده است.</p>
  <div class="art-body">${bodyHtml}</div>` : ""}

  ${t.sources ? `<div class="srcs"><b>منابع:</b> ${escHtml(t.sources)}</div>` : ""}

  <div class="actions">
    <a class="wa" href="${escHtml(waShare)}" target="_blank" rel="noopener">واتساپ</a>
    <a class="tg" href="${escHtml(tgShare)}" target="_blank" rel="noopener">تلگرام</a>
    <a class="x" href="${escHtml(xShare)}" target="_blank" rel="noopener">X</a>
  </div>
  <a class="home-link" href="/tahlil">← همه‌ی تحلیل‌های صوتی</a>
</main>
${TAHLIL_FOOTER}
<script>
(function(){
  var a=document.getElementById('au'),pb=document.getElementById('pb'),
      pg=document.getElementById('pg'),tm=document.getElementById('tm'),
      tk=document.getElementById('tk'),L=1000,total=${parseInt(t.duration, 10) || 0};
  var ID=${JSON.stringify(String(id))},KEY='pi24_tahlil_'+ID;
  function fmt(s){s=Math.max(0,Math.floor(s||0));
    var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=String(s%60).padStart(2,'0');
    return h?(h+':'+String(m).padStart(2,'0')+':'+ss):(m+':'+ss);}
  function dur(){return (isFinite(a.duration)&&a.duration)||total||0;}
  function draw(){var d=dur(),r=d?a.currentTime/d:0;
    pg.style.strokeDashoffset=String(L-L*r);
    tm.textContent=fmt(a.currentTime)+' / '+fmt(d);
    tk.setAttribute('aria-valuenow',String(Math.round(r*100)));}
  pb.onclick=function(){if(a.paused){a.play();}else{a.pause();}};
  a.onplay=function(){pb.textContent='❚❚';pb.setAttribute('aria-label','توقف');};
  a.onpause=function(){pb.textContent='▶';pb.setAttribute('aria-label','پخش');};
  a.ontimeupdate=draw;a.onloadedmetadata=draw;
  a.onended=function(){a.currentTime=0;};
  tk.onclick=function(e){var b=tk.getBoundingClientRect();
    var r=1-((e.clientX-b.left)/b.width);
    a.currentTime=Math.min(Math.max(r,0),1)*dur();};
  tk.onkeydown=function(e){
    if(e.key==='ArrowLeft'){a.currentTime=a.currentTime+5;e.preventDefault();}
    if(e.key==='ArrowRight'){a.currentTime=a.currentTime-5;e.preventDefault();}
    if(e.key===' '){pb.click();e.preventDefault();}};
  document.getElementById('bk').onclick=function(){a.currentTime=Math.max(0,a.currentTime-15);};
  document.getElementById('fw').onclick=function(){a.currentTime=Math.min(dur(),a.currentTime+15);};
  /* یادآوری جای پخش — برای قطعه‌های بلند */
  function savePos(){try{
    if(a.currentTime>20&&a.currentTime<dur()-20){localStorage.setItem(KEY,String(Math.floor(a.currentTime)));}
    else{localStorage.removeItem(KEY);}
  }catch(e){}}
  setInterval(function(){if(!a.paused){savePos();}},5000);
  a.addEventListener('pause',savePos);
  a.addEventListener('ended',function(){try{localStorage.removeItem(KEY);}catch(e){}});
  var saved=0;try{saved=parseInt(localStorage.getItem(KEY)||'0',10)||0;}catch(e){}
  if(saved>20){
    var rs=document.getElementById('rs');
    rs.textContent='▶ ادامه از '+fmt(saved);
    rs.style.display='';
    rs.onclick=function(){a.currentTime=saved;a.play();rs.style.display='none';};
  }
  var chips=document.querySelectorAll('[data-rate]');
  for(var i=0;i<chips.length;i++){(function(c){
    c.onclick=function(){a.playbackRate=parseFloat(c.getAttribute('data-rate'));
      for(var j=0;j<chips.length;j++){chips[j].setAttribute('aria-pressed',String(chips[j]===c));}};
  })(chips[i]);}
  draw();
})();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=300" }
  });
}

/* ---------- فهرست تحلیل‌ها ---------- */

async function handleTahlilList(url, env) {
  const index = await getTahlilIndex(env);
  const items = index.map(i =>
    `<li><a href="/tahlil/${escHtml(i.id)}"><strong>${escHtml(i.title)}</strong>` +
    `<span>${escHtml(tahlilClock(i.duration))} · ${escHtml(formatFaDate(i.date))}</span></a></li>`
  ).join("\n");

  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>تحلیل صوتی | پالس ایران ۲۴</title>
<meta name="description" content="تحلیل‌های صوتی روزانه پالس ایران ۲۴ بر پایه منابع خبری بین‌المللی — همراه با متن کامل.">
<link rel="canonical" href="${SITE_ORIGIN}/tahlil">
<link rel="alternate" type="application/rss+xml" title="پادکست تحلیل صوتی" href="${SITE_ORIGIN}/tahlil.xml">
<meta name="theme-color" content="#0D1117">
<link rel="icon" href="/assets/favicon.ico" sizes="any">
${TAHLIL_FONT}
<style>${TAHLIL_CSS}</style>
</head>
<body>
${TAHLIL_HEADER}
<main class="wrap">
  <div class="art-meta"><span class="badge">تحلیل صوتی</span></div>
  <h1>شنیدن خبر، پشتِ خبر</h1>
  <p class="lede">تحلیل‌های کوتاه روزانه بر پایه منابع خبری بین‌المللی. هر قطعه متن کامل هم دارد.</p>
  ${items ? `<ul class="tlist">${items}</ul>` : `<p class="empty">اولین تحلیل صوتی به‌زودی منتشر می‌شود.</p>`}
  <a class="home-link" href="/">← بازگشت به صفحه اصلی</a>
</main>
${TAHLIL_FOOTER}
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=180" }
  });
}

/* ---------- فید پادکست /tahlil.xml ---------- */

async function handleTahlilFeed(env) {
  const kv = env && env.PULSE_STATS;
  const index = await getTahlilIndex(env);
  const parts = [];

  for (const i of index.slice(0, 50)) {
    let t = null;
    try {
      const raw = kv ? await kv.get("tahlil:" + i.id) : null;
      if (raw) t = JSON.parse(raw);
    } catch (e) {}
    if (!t) continue;
    const link = SITE_ORIGIN + "/tahlil/" + t.id;
    const audioAbs = /^https?:\/\//.test(t.audio) ? t.audio : SITE_ORIGIN + t.audio;
    const pub = (t.date && !isNaN(Date.parse(t.date))) ? new Date(t.date).toUTCString() : new Date().toUTCString();
    parts.push(`    <item>
      <title>${xmlEsc(t.title)}</title>
      <link>${xmlEsc(link)}</link>
      <guid isPermaLink="true">${xmlEsc(link)}</guid>
      <pubDate>${pub}</pubDate>
      <description>${xmlEsc(t.summary || t.title)}</description>
      <enclosure url="${xmlEsc(audioAbs)}" type="audio/mpeg" length="0"/>
      <itunes:duration>${xmlEsc(tahlilClock(t.duration))}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
    </item>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>تحلیل صوتی پالس ایران ۲۴</title>
    <link>${SITE_ORIGIN}/tahlil</link>
    <description>تحلیل‌های کوتاه روزانه بر پایه منابع خبری بین‌المللی</description>
    <language>fa-IR</language>
    <itunes:author>Pulse Iran 24</itunes:author>
    <itunes:category text="News"/>
    <itunes:image href="${SITE_ORIGIN}/logo.png"/>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${parts.join("\n")}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=UTF-8", "Cache-Control": "public, max-age=600" }
  });
}

/* ---------- ورودی‌های sitemap ---------- */

async function tahlilSitemapUrls(env) {
  const index = await getTahlilIndex(env);
  const out = [`  <url><loc>${SITE_ORIGIN}/tahlil</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`];
  for (const i of index.slice(0, 300)) {
    const lm = (i.date && !isNaN(Date.parse(i.date))) ? new Date(i.date).toISOString() : null;
    out.push(
      `  <url><loc>${SITE_ORIGIN}/tahlil/${i.id}</loc>` +
      (lm ? `<lastmod>${lm}</lastmod>` : "") +
      `<changefreq>monthly</changefreq><priority>0.7</priority></url>`
    );
  }
  return out;
}

/* ---------- API پنل تحلیل صوتی ---------- */

async function handleTahlilAdminApi(request, env) {
  if (request.method !== "POST") return adminJson({ ok: false, error: "method" }, 405);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  const auth = checkAdmin(request, env, body);
  if (!auth.ok) return adminJson({ ok: false, error: auth.msg }, auth.code);

  const kv = env.PULSE_STATS;
  if (!kv) return adminJson({ ok: false, error: "kv_missing" }, 503);

  const action = String(body.action || "");

  if (action === "login") return adminJson({ ok: true });

  if (action === "list") return adminJson({ ok: true, items: await getTahlilIndex(env) });

  if (action === "create") {
    const title = String(body.title || "").trim().slice(0, 200);
    const audio = String(body.audio || "").trim().slice(0, 500);
    if (!title) return adminJson({ ok: false, error: "title_required" }, 400);
    if (!audio) return adminJson({ ok: false, error: "audio_required" }, 400);
    if (!/^(\/|https:\/\/)/.test(audio)) return adminJson({ ok: false, error: "audio_bad_url" }, 400);

    let id = String(body.id || "").trim().replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60);
    if (!id) id = String(Date.now());

    const item = {
      id,
      title,
      summary: String(body.summary || "").trim().slice(0, 400),
      audio,
      transcript: String(body.transcript || "").trim().slice(0, 60000),
      sources: String(body.sources || "").trim().slice(0, 300),
      filename: String(body.filename || "").trim().slice(0, 120),
      image: String(body.image || "").trim().slice(0, 500) || null,
      duration: parseTahlilDuration(body.duration),
      date: new Date().toISOString()
    };

    await kv.put("tahlil:" + id, JSON.stringify(item));

    let index = (await getTahlilIndex(env)).filter(x => x.id !== id);
    index.unshift({ id, title, date: item.date, duration: item.duration });
    if (index.length > TAHLIL_CAP) index = index.slice(0, TAHLIL_CAP);
    await kv.put("tahlil_index", JSON.stringify(index));

    let pushed = false, pushError = null;
    if (body.push === true) {
      const pr = await sendPush(env, "🎧 " + title, SITE_ORIGIN + "/tahlil/" + id, item.image);
      pushed = pr.ok;
      if (!pr.ok) pushError = pr.error;
    }

    return adminJson({ ok: true, id, url: "/tahlil/" + id, pushed, pushError });
  }

  if (action === "delete") {
    const id = String(body.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
    if (!id) return adminJson({ ok: false, error: "id_required" }, 400);
    try { await kv.delete("tahlil:" + id); } catch (e) {}
    const index = (await getTahlilIndex(env)).filter(x => x.id !== id);
    await kv.put("tahlil_index", JSON.stringify(index));
    return adminJson({ ok: true });
  }

  return adminJson({ ok: false, error: "unknown_action" }, 400);
}

function handleTahlilAdminPage() {
  return new Response(TAHLIL_ADMIN_HTML, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}

const TAHLIL_ADMIN_HTML = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>پنل تحلیل صوتی — پالس ایران ۲۴</title>
<link rel="stylesheet" href="/assets/fonts/vazirmatn.css">
<style>
 :root{--bg:#0D1117;--surface:#161C26;--line:#2A3442;--text:#E9EDF2;--dim:#8B96A5;--pulse:#FF2D4A}
 *{box-sizing:border-box}
 body{margin:0;font-family:'Vazirmatn',Tahoma,sans-serif;background:var(--bg);color:var(--text);line-height:1.7}
 .wrap{max-width:720px;margin:0 auto;padding:22px 16px}
 h1{font-size:1.3rem;font-weight:900} h1 b{color:var(--pulse)}
 .card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:18px}
 label{display:block;font-size:.9rem;color:var(--dim);margin:12px 0 6px}
 input,textarea{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:10px;color:var(--text);font-family:inherit;font-size:1rem;padding:11px 12px}
 textarea{min-height:170px;resize:vertical;line-height:1.9}
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
 a.nav{color:#2AABEE;text-decoration:none;font-size:.9rem}
</style>
</head>
<body>
<div class="wrap">
 <h1>تحلیل صوتی <b>پالس ایران ۲۴</b></h1>
 <p><a class="nav" href="/admin">← پنل خبر</a> &nbsp;·&nbsp; <a class="nav" href="/tahlil" target="_blank">صفحه‌ی تحلیل‌ها</a></p>

 <div id="login" class="card">
   <label>رمز ورود</label>
   <input id="pw" type="password" autocomplete="current-password" placeholder="ADMIN_TOKEN">
   <button id="loginBtn">ورود</button>
   <div id="loginMsg" class="msg"></div>
 </div>

 <div id="editor" class="card hidden">
   <label>عنوان *</label>
   <input id="title" maxlength="200" placeholder="وقفه‌ای که هنوز صلح نیست">
   <label>آدرس فایل صوتی * (mp3 در پوشه assets/audio)</label>
   <input id="audio" placeholder="/assets/audio/1405-05-05.mp3">
   <label>مدت — هم ثانیه قبول است هم دقیقه:ثانیه (۶۰۰ یا 10:00)</label>
   <input id="duration" placeholder="10:00">
   <label>خلاصه (یکی دو خط، در گوگل و اشتراک‌گذاری دیده می‌شود)</label>
   <textarea id="summary" style="min-height:80px"></textarea>
   <label>متن کامل (بین پاراگراف‌ها یک خط خالی بگذارید)</label>
   <textarea id="transcript"></textarea>
   <label>منابع</label>
   <input id="sources" placeholder="الجزیره، رویترز، ایران اینترنشنال">
   <label>نام نمایشی فایل صوتی (اختیاری — همین نام در صفحه و هنگام دانلود دیده می‌شود)</label>
   <input id="fname" placeholder="تحلیل ۵ مرداد — وقفه‌ای که هنوز صلح نیست.mp3">
   <label>تصویر کاور (اختیاری)</label>
   <input id="image" placeholder="/logo.png">
   <label>شناسه دلخواه در آدرس (اختیاری)</label>
   <input id="cid" placeholder="1405-05-05">
   <label style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer;font-size:.92rem">
     <input type="checkbox" id="pushChk" checked style="width:auto;margin:0"> 🔔 ارسال اعلان وب‌پوش
   </label>
   <button id="pubBtn">انتشار تحلیل</button>
   <div id="pubMsg" class="msg"></div>
   <div class="hint">فایل mp3 را از قبل در پوشه assets/audio در گیت‌هاب بگذارید تا آدرس بالا کار کند.</div>
 </div>

 <div id="listCard" class="card hidden">
   <b>تحلیل‌های منتشرشده</b>
   <div id="list"></div>
 </div>
</div>
<script>
(function(){
  var token = sessionStorage.getItem('pi24_admin') || '';
  function el(id){ return document.getElementById(id); }

  function api(action, extra){
    var payload = Object.assign({action:action}, extra||{});
    return fetch('/tahlil-admin/api', {
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
      else { el('loginMsg').textContent = j._status===503 ? 'ADMIN_TOKEN تنظیم نشده' : 'رمز اشتباه است'; el('loginMsg').className='msg err'; }
    }).catch(function(){ el('loginMsg').textContent='خطای شبکه'; el('loginMsg').className='msg err'; });
  }

  function doPublish(){
    var title = el('title').value.trim();
    var audio = el('audio').value.trim();
    if(!title || !audio){ el('pubMsg').textContent='عنوان و آدرس فایل صوتی لازم است'; el('pubMsg').className='msg err'; return; }
    el('pubBtn').disabled = true;
    el('pubMsg').textContent='در حال انتشار...'; el('pubMsg').className='msg';
    api('create', {
      title:title, audio:audio,
      duration: el('duration').value.trim(),
      summary: el('summary').value,
      transcript: el('transcript').value,
      sources: el('sources').value.trim(),
      filename: el('fname').value.trim(),
      image: el('image').value.trim(),
      id: el('cid').value.trim(),
      push: el('pushChk').checked
    }).then(function(j){
      el('pubBtn').disabled = false;
      if(j.ok){
        var note = j.pushed ? ' · اعلان ارسال شد 🔔' : (j.pushError ? ' · اعلان نرفت ('+j.pushError+')' : '');
        el('pubMsg').innerHTML = 'منتشر شد ✓' + note + ' &nbsp; <a style="color:#2AABEE" target="_blank" href="'+j.url+'">مشاهده صفحه</a>';
        el('pubMsg').className='msg ok';
        el('title').value=''; el('audio').value=''; el('duration').value='';
        el('summary').value=''; el('transcript').value=''; el('cid').value=''; el('fname').value='';
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
      if(!j.items || !j.items.length){ box.innerHTML='<p class="hint">هنوز تحلیلی منتشر نشده.</p>'; return; }
      j.items.forEach(function(it){
        var div = document.createElement('div'); div.className='item';
        var left = document.createElement('div');
        var p = document.createElement('p'); p.textContent = it.title || '';
        var s = document.createElement('small');
        s.textContent = String(it.date||'').slice(0,10) + '  ·  /tahlil/' + it.id;
        left.appendChild(p); left.appendChild(s);
        var btn = document.createElement('button'); btn.className='sec'; btn.textContent='حذف';
        btn.onclick = function(){
          if(!confirm('این تحلیل حذف شود؟')){ return; }
          api('delete', {id:it.id}).then(function(r){ if(r.ok){ loadList(); } });
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


/* ============================================================================
   پالس ایران ۲۴ — تحلیل صوتی سه‌زبانه  (v79)
   ----------------------------------------------------------------------------
   این فایل به انتهای _worker.js فعلی (v78) اضافه می‌شود — append-only.
   هیچ تابع یا ثابتی را بازتعریف نمی‌کند و از توابع موجود استفاده می‌کند:
     escHtml, formatFaDate, textToParagraphs, translateOne, trHash,
     getTahlilIndex, tahlilClock, tahlilIsoDuration,
     TAHLIL_CSS, TAHLIL_FONT, SITE_ORIGIN

   ── گام ۱: کل این فایل را عیناً به انتهای _worker.js بچسبان.

   ── گام ۲: در تابع fetch، این بلوک فعلی:

        if (path === "/tahlil" || path === "/tahlil/") return handleTahlilList(url, env);
        if (path === "/tahlil.xml") return handleTahlilFeed(env);
        if (path === "/tahlil-admin" || path === "/tahlil-admin/") return handleTahlilAdminPage();
        if (path === "/tahlil-admin/api") return handleTahlilAdminApi(request, env);
        if (/^\/tahlil\/[A-Za-z0-9_-]{1,60}\/?$/.test(path)) return handleTahlilPage(url, env, path.split("/")[2]); return env.ASSETS.fetch(request);

      را با این بلوک جایگزین کن:

        if (path === "/tahlil" || path === "/tahlil/") return handleTahlilListI18n(url, env, "fa");
        if (path === "/tahlil.xml") return handleTahlilFeed(env);
        if (path === "/tahlil-admin" || path === "/tahlil-admin/") return handleTahlilAdminPage();
        if (path === "/tahlil-admin/api") return handleTahlilAdminApi(request, env);
        if (/^\/(en|de)\/tahlil\/?$/.test(path)) return handleTahlilListI18n(url, env, path.slice(1, 3));
        if (/^\/(en|de)\/tahlil\/[A-Za-z0-9_-]{1,60}\/?$/.test(path)) return handleTahlilPageI18n(url, env, path.split("/")[3], path.slice(1, 3));
        if (/^\/tahlil\/[A-Za-z0-9_-]{1,60}\/?$/.test(path)) return handleTahlilPageI18n(url, env, path.split("/")[2], "fa");

        return env.ASSETS.fetch(request);

   ── گام ۳: در تابع handleSitemap این خط:

        for (const u of await tahlilSitemapUrls(env)) urls.push(u);

      را به این تغییر بده:

        for (const u of await tahlilSitemapUrlsI18n(env)) urls.push(u);

   ── گام ۴: در خط اول فایل، v78 را به v79 تغییر بده.

   ── نکته‌ی مهم درباره‌ی برگشت‌پذیری:
      توابع قدیمی handleTahlilPage و handleTahlilList و tahlilSitemapUrls دست‌نخورده
      باقی می‌مانند. اگر چیزی خراب شد، فقط سه خط روتر را به حالت قبل برگردان —
      همه‌چیز مثل v78 کار می‌کند. هیچ داده‌ای در KV تغییر نمی‌کند.

   ── طراحی:
      • صدا فقط فارسی است و ترجمه نمی‌شود (تصمیم آگاهانه: مخاطب صوتی فارسی‌زبان
        است، ارزش نسخه‌های خارجی در خوانده‌شدن و ایندکس‌شدن است).
      • عنوان، خلاصه، متن کامل و منابع با translateOne ترجمه و در KV کش می‌شوند.
      • زیر پلیر یک نوار: «Audio in Persian · Full text in English».
      • زیر متن، سلب مسئولیت ترجمه‌ی ماشینی با لینک به نسخه‌ی فارسی.
      • hreflang کامل fa/en/de/x-default روی هر سه نسخه.
      • فید /tahlil.xml فارسی می‌ماند (فید پادکست باید به زبان خود صوت باشد).
   ============================================================================ */

/* حداکثر طول هر تکه برای ارسال به مترجم (سقف امن سرویس گوگل ۱۸۰۰ است) */
const TAHLIL_TR_MAX = 1500;

/* سقف تعداد تکه‌های ترجمه‌نشده در هر درخواست.
   دلیل: Cloudflare Workers در پلن رایگان حداکثر ۵۰ subrequest دارد.
   تکه‌هایی که در این نوبت جا نشوند، فارسی نمایش داده می‌شوند و در
   بازدید بعدی ترجمه می‌شوند (گرم‌شدن تدریجی کش). بعد از یکی دو بازدید
   همه‌چیز از KV می‌آید و دیگر هیچ ترجمه‌ای انجام نمی‌شود. */
const TAHLIL_TR_BUDGET = 20;
const TAHLIL_TR_BUDGET_LIST = 18;

/* ---------- برچسب‌های سه‌زبانه ---------- */

const TAHLIL_I18N = {
  fa: {
    htmlLang: "fa", dir: "rtl", locale: "fa_IR", rtl: true,
    logo: 'پالس <b>ایران ۲۴</b>',
    home: "/", list: "/tahlil",
    badge: "تحلیل صوتی",
    listH1: "شنیدن خبر، پشتِ خبر",
    listLede: "تحلیل‌های کوتاه روزانه بر پایه منابع خبری بین‌المللی. هر قطعه متن کامل هم دارد.",
    listTitle: "تحلیل صوتی | پالس ایران ۲۴",
    listDesc: "تحلیل‌های صوتی روزانه پالس ایران ۲۴ بر پایه منابع خبری بین‌المللی — همراه با متن کامل.",
    empty: "اولین تحلیل صوتی به‌زودی منتشر می‌شود.",
    backHome: "← بازگشت به صفحه اصلی",
    allTahlil: "← همه‌ی تحلیل‌های صوتی",
    listen: "زمان شنیدن:",
    play: "پخش", pause: "توقف", seek: "جای‌یابی در فایل صوتی",
    back15: "↺ ۱۵ ثانیه", fwd15: "۱۵ ثانیه ↻", resume: "▶ ادامه از ",
    download: "دانلود صوت",
    fullText: "متن کامل",
    fullTextHint: "همان متنی که در فایل صوتی خوانده شده است.",
    sources: "منابع:",
    audioNote: "",
    mtNote: "",
    pageSuffix: " | تحلیل صوتی پالس ایران ۲۴",
    foot: "پالس ایران ۲۴ — نبض خبر ایران و جهان",
    tgchan: "کانال تلگرام",
    notFoundH: "این تحلیل در دسترس نیست",
    notFoundP: "ممکن است حذف شده یا آدرس اشتباه باشد."
  },
  en: {
    htmlLang: "en", dir: "ltr", locale: "en_US", rtl: false,
    logo: 'Pulse <b>Iran 24</b>',
    home: "/en", list: "/en/tahlil",
    badge: "Audio analysis",
    listH1: "The story behind the story",
    listLede: "Short daily analysis based on international news sources. Every episode comes with a full text.",
    listTitle: "Audio analysis | Pulse Iran 24",
    listDesc: "Daily audio analysis from Pulse Iran 24, based on international news sources — with full transcripts.",
    empty: "The first audio analysis will be published soon.",
    backHome: "← Back to homepage",
    allTahlil: "← All audio analysis",
    listen: "Listening time:",
    play: "Play", pause: "Pause", seek: "Seek in audio",
    back15: "↺ 15s", fwd15: "15s ↻", resume: "▶ Resume from ",
    download: "Download audio",
    fullText: "Full text",
    fullTextHint: "The text as it is read in the audio file.",
    sources: "Sources:",
    audioNote: "Audio in Persian · Full text in English",
    mtNote: "Machine translation. The Persian original is the authoritative version:",
    pageSuffix: " | Audio analysis — Pulse Iran 24",
    foot: "Pulse Iran 24 — the pulse of news from Iran and the world",
    tgchan: "Telegram channel",
    notFoundH: "This analysis is not available",
    notFoundP: "It may have been removed, or the address is wrong."
  },
  de: {
    htmlLang: "de", dir: "ltr", locale: "de_DE", rtl: false,
    logo: 'Pulse <b>Iran 24</b>',
    home: "/de", list: "/de/tahlil",
    badge: "Audio-Analyse",
    listH1: "Die Geschichte hinter der Nachricht",
    listLede: "Kurze tägliche Analysen auf Basis internationaler Nachrichtenquellen. Jede Folge hat einen Volltext.",
    listTitle: "Audio-Analyse | Pulse Iran 24",
    listDesc: "Tägliche Audio-Analysen von Pulse Iran 24 auf Basis internationaler Nachrichtenquellen — mit Volltext.",
    empty: "Die erste Audio-Analyse erscheint in Kürze.",
    backHome: "← Zur Startseite",
    allTahlil: "← Alle Audio-Analysen",
    listen: "Hördauer:",
    play: "Abspielen", pause: "Pause", seek: "Im Audio navigieren",
    back15: "↺ 15 Sek.", fwd15: "15 Sek. ↻", resume: "▶ Weiter ab ",
    download: "Audio herunterladen",
    fullText: "Volltext",
    fullTextHint: "Der Text, wie er in der Audiodatei gelesen wird.",
    sources: "Quellen:",
    audioNote: "Audio auf Persisch · Volltext auf Deutsch",
    mtNote: "Maschinelle Übersetzung. Maßgeblich ist die persische Originalfassung:",
    pageSuffix: " | Audio-Analyse — Pulse Iran 24",
    foot: "Pulse Iran 24 — der Nachrichtenpuls aus Iran und der Welt",
    tgchan: "Telegram-Kanal",
    notFoundH: "Diese Analyse ist nicht verfügbar",
    notFoundP: "Sie wurde möglicherweise entfernt, oder die Adresse ist falsch."
  }
};

function tahlilLang(l) {
  return TAHLIL_I18N[l] ? l : "fa";
}

/* ---------- تاریخ به زبان صفحه ---------- */

function tahlilDateLabel(iso, lang) {
  if (lang === "fa") return formatFaDate(iso);
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || "").slice(0, 10);
    return d.toLocaleDateString(lang === "de" ? "de-DE" : "en-GB",
      { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  } catch (e) {
    return String(iso || "").slice(0, 10);
  }
}

/* ---------- تکه‌کردن متن بلند برای مترجم ---------- */

function tahlilChunk(text, max) {
  const t = String(text || "").trim();
  if (!t) return [];
  if (t.length <= max) return [t];

  const out = [];
  let rest = t;
  while (rest.length > max) {
    const win = rest.slice(0, max);
    let cut = -1;
    for (const mark of [". ", "؟ ", "! ", "؛ ", "… ", "، "]) {
      const i = win.lastIndexOf(mark);
      if (i >= 0 && i + mark.length > cut) cut = i + mark.length;
    }
    if (cut < max * 0.4) {
      const sp = win.lastIndexOf(" ");
      cut = sp > max * 0.4 ? sp + 1 : max;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/* ---------- ترجمه با کش KV و سقف مصرف ----------
   ابتدا همه‌ی تکه‌ها از KV خوانده می‌شوند (خواندن KV subrequest حساب نمی‌شود).
   فقط تکه‌هایی که در کش نیستند — و آن هم تا سقف budget — واقعاً ترجمه می‌شوند.
   بقیه فارسی می‌مانند و در بازدید بعدی ترجمه می‌شوند. */

async function tahlilTranslateMany(chunks, lang, env, budget) {
  const kv = env && env.PULSE_STATS;
  const out = chunks.slice();
  if (lang === "fa" || !chunks.length) return { texts: out, pending: 0 };

  let hits = new Array(chunks.length).fill(null);
  if (kv) {
    try {
      hits = await Promise.all(chunks.map(c =>
        c ? kv.get("tr:" + lang + ":" + trHash(String(c).trim())).catch(() => null)
          : Promise.resolve(null)
      ));
    } catch (e) { hits = new Array(chunks.length).fill(null); }
  }

  const misses = [];
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i]) { out[i] = ""; continue; }
    if (hits[i]) out[i] = hits[i];
    else misses.push(i);
  }

  const take = misses.slice(0, Math.max(0, budget));
  if (take.length) {
    try {
      const done = await Promise.all(take.map(i => translateOne(chunks[i], lang, env)));
      take.forEach((i, k) => { out[i] = done[k] || chunks[i]; });
    } catch (e) { /* هرچه ترجمه نشد، فارسی می‌ماند */ }
  }

  return { texts: out, pending: Math.max(0, misses.length - take.length) };
}

/* ---------- قطعات مشترک صفحه ---------- */

function tahlilHeaderHtml(L) {
  return `<header><div class="wrap">
  <a class="logo" href="${L.home}"><img src="/assets/icon-192.png" alt="" onerror="this.style.display='none'">${L.logo}</a>
</div></header>`;
}

function tahlilFooterHtml(L) {
  return `<footer>${escHtml(L.foot)} · <a href="https://telegram.me/pulseiran24" target="_blank" rel="noopener">${escHtml(L.tgchan)}</a></footer>`;
}

/* کلید تعویض زبان — زبان فعلی بدون لینک نمایش داده می‌شود */
function tahlilLangSwitch(lang, suffix) {
  const s = suffix || "";
  const rows = [
    { c: "fa", label: "فارسی", href: "/tahlil" + s },
    { c: "en", label: "English", href: "/en/tahlil" + s },
    { c: "de", label: "Deutsch", href: "/de/tahlil" + s }
  ];
  const inner = rows.map(r => r.c === lang
    ? `<span class="lsw-on">${escHtml(r.label)}</span>`
    : `<a href="${escHtml(r.href)}">${escHtml(r.label)}</a>`
  ).join('<i class="lsw-sep">·</i>');
  return `<div class="lsw" dir="ltr">${inner}</div>`;
}

function tahlilAltLinks(suffix) {
  const s = suffix || "";
  return `<link rel="alternate" hreflang="fa" href="${SITE_ORIGIN}/tahlil${s}">
<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/en/tahlil${s}">
<link rel="alternate" hreflang="de" href="${SITE_ORIGIN}/de/tahlil${s}">
<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}/tahlil${s}">`;
}

/* استایل‌های افزوده — بقیه از TAHLIL_CSS موجود می‌آید */
const TAHLIL_I18N_CSS = `
  .lsw{margin:0 0 18px;font-size:.82rem;color:var(--dim);display:flex;gap:8px;align-items:center}
  .lsw a{color:var(--tg);text-decoration:none}
  .lsw a:hover{text-decoration:underline}
  .lsw-on{color:var(--text);font-weight:700}
  .lsw-sep{font-style:normal;opacity:.4}
  .aunote{margin-top:10px;padding-top:10px;border-top:1px solid var(--line);
    color:var(--dim);font-size:.8rem}
  .mtnote{margin-top:26px;padding:12px 14px;border:1px dashed var(--line);border-radius:10px;
    color:var(--dim);font-size:.82rem;line-height:1.7}
  .mtnote a{color:var(--tg);text-decoration:none}
  .ltr .track svg{transform:none}
  .ltr .tm{text-align:right}
`;

/* ---------- صفحه‌ی یک تحلیل، سه‌زبانه ---------- */

async function handleTahlilPageI18n(url, env, id, lang) {
  lang = tahlilLang(lang);
  const L = TAHLIL_I18N[lang];
  const kv = env && env.PULSE_STATS;
  if (!kv) return tahlilNotFoundPage(lang);

  let t = null;
  try {
    const raw = await kv.get("tahlil:" + id);
    if (raw) t = JSON.parse(raw);
  } catch (e) {}
  if (!t) return tahlilNotFoundPage(lang);

  const origin = url.origin;
  const canonical = origin + (lang === "fa" ? "" : "/" + lang) + "/tahlil/" + id;
  const audioAbs = /^https?:\/\//.test(t.audio) ? t.audio : origin + t.audio;
  const cover = t.image || "/assets/og-image.jpg";
  const coverAbs = /^https?:\/\//.test(cover) ? cover : origin + cover;

  /* ---- ترجمه ---- */
  const rawParas = textToParagraphs(t.transcript || "");
  const flat = [];
  const map = { title: -1, summary: -1, sources: -1, paras: [] };

  map.title = flat.push(String(t.title || "")) - 1;
  if (t.summary) map.summary = flat.push(String(t.summary)) - 1;
  if (t.sources) map.sources = flat.push(String(t.sources)) - 1;
  for (const p of rawParas) {
    const cs = tahlilChunk(p, TAHLIL_TR_MAX);
    const start = flat.length;
    for (const c of cs) flat.push(c);
    map.paras.push([start, flat.length]);
  }

  const tr = await tahlilTranslateMany(flat, lang, env, TAHLIL_TR_BUDGET);
  const title = tr.texts[map.title] || String(t.title || "");
  const summary = map.summary >= 0 ? (tr.texts[map.summary] || "") : "";
  const sources = map.sources >= 0 ? (tr.texts[map.sources] || "") : "";
  const paragraphs = map.paras.map(r => tr.texts.slice(r[0], r[1]).join(" ").trim()).filter(Boolean);

  let description = String(summary || title).replace(/\s+/g, " ").trim();
  if (description.length > 160) description = description.slice(0, 157) + "…";

  const dlName = (t.filename && t.filename.trim())
    ? t.filename.trim()
    : (String(t.title || "").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 80) + ".mp3");

  const bodyHtml = paragraphs.map(p => "<p>" + escHtml(p) + "</p>").join("\n");

  const waShare = "https://wa.me/?text=" + encodeURIComponent(title + "\n" + canonical + "\n\n📡 Pulse Iran 24 | https://pulseiran24.com");
  const tgShare = "https://t.me/share/url?url=" + encodeURIComponent(canonical) + "&text=" + encodeURIComponent(title);
  const xShare = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(title) + "&url=" + encodeURIComponent(canonical);

  /* JSON-LD — زبان صوت همیشه فارسی است. متن کامل فقط در نسخه‌ی فارسی
     به‌عنوان transcript اعلام می‌شود، چون در en/de یک ترجمه است نه رونوشت. */
  const ldObj = {
    "@context": "https://schema.org",
    "@type": "AudioObject",
    "name": title,
    "description": description,
    "contentUrl": audioAbs,
    "encodingFormat": "audio/mpeg",
    "duration": tahlilIsoDuration(t.duration),
    "uploadDate": t.date,
    "datePublished": t.date,
    "inLanguage": "fa-IR",
    "url": canonical,
    "thumbnailUrl": coverAbs,
    "publisher": {
      "@type": "NewsMediaOrganization",
      "name": "Pulse Iran 24",
      "url": SITE_ORIGIN,
      "logo": { "@type": "ImageObject", "url": SITE_ORIGIN + "/assets/icon-512.png" }
    }
  };
  if (lang === "fa" && t.transcript) ldObj.transcript = t.transcript;
  const ld = JSON.stringify(ldObj).replace(/</g, "\\u003c");

  const faUrl = SITE_ORIGIN + "/tahlil/" + id;
  const mtBlock = (lang === "fa" || !L.mtNote) ? "" :
    `<div class="mtnote">${escHtml(L.mtNote)} <a href="${escHtml(faUrl)}" hreflang="fa">${escHtml(faUrl)}</a></div>`;
  const auNote = (lang === "fa" || !L.audioNote) ? "" :
    `<div class="aunote">${escHtml(L.audioNote)}</div>`;

  const html = `<!DOCTYPE html>
<html lang="${L.htmlLang}" dir="${L.dir}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}${escHtml(L.pageSuffix)}</title>
<meta name="description" content="${escHtml(description)}">
<link rel="canonical" href="${escHtml(canonical)}">
${tahlilAltLinks("/" + id)}
<meta name="theme-color" content="#0D1117">
<link rel="icon" href="/assets/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Pulse Iran 24">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:url" content="${escHtml(canonical)}">
<meta property="og:image" content="${escHtml(coverAbs)}">
<meta property="og:audio" content="${escHtml(audioAbs)}">
<meta property="og:locale" content="${L.locale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(description)}">
<meta name="twitter:image" content="${escHtml(coverAbs)}">
${TAHLIL_FONT}
<script type="application/ld+json">${ld}</script>
<style>${TAHLIL_CSS}${TAHLIL_I18N_CSS}</style>
</head>
<body class="${L.rtl ? "rtl" : "ltr"}">
${tahlilHeaderHtml(L)}
<main class="wrap">
  ${tahlilLangSwitch(lang, "/" + id)}
  <div class="art-meta">
    <span class="badge">${escHtml(L.badge)}</span>
    <span>${escHtml(tahlilDateLabel(t.date, lang))}</span>
    <span>${escHtml(L.listen)} ${escHtml(tahlilClock(t.duration))}</span>
  </div>
  <h1>${escHtml(title)}</h1>
  ${summary ? `<p class="lede">${escHtml(summary)}</p>` : ""}

  <div class="player">
    <audio id="au" src="${escHtml(t.audio)}" preload="metadata"></audio>
    <div class="prow">
      <button class="playbtn" id="pb" aria-label="${escHtml(L.play)}">▶</button>
      <div class="track" id="tk" role="slider" tabindex="0" aria-label="${escHtml(L.seek)}"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <svg viewBox="0 0 300 36" preserveAspectRatio="none" aria-hidden="true">
          <path class="base" d="M0 18H112l8-12 11 24 9-12H300"/>
          <path class="prog" id="pg" d="M0 18H112l8-12 11 24 9-12H300"/>
        </svg>
      </div>
      <span class="tm" id="tm">0:00 / ${escHtml(tahlilClock(t.duration))}</span>
    </div>
    <div class="tools">
      <button class="chip" id="rs" style="display:none"></button>
      <button class="chip" id="bk">${escHtml(L.back15)}</button>
      <button class="chip" id="fw">${escHtml(L.fwd15)}</button>
      <button class="chip" data-rate="1" aria-pressed="true">1×</button>
      <button class="chip" data-rate="1.25" aria-pressed="false">1.25×</button>
      <button class="chip" data-rate="1.5" aria-pressed="false">1.5×</button>
      <a class="chip" style="text-decoration:none" href="${escHtml(t.audio)}" download="${escHtml(dlName)}">${escHtml(L.download)}</a>
    </div>
    <div class="fname">🎧 ${escHtml(dlName)}</div>
    ${auNote}
  </div>

  ${bodyHtml ? `<h2>${escHtml(L.fullText)}</h2>
  <p class="hint">${escHtml(L.fullTextHint)}</p>
  <div class="art-body">${bodyHtml}</div>` : ""}

  ${sources ? `<div class="srcs"><b>${escHtml(L.sources)}</b> ${escHtml(sources)}</div>` : ""}
  ${mtBlock}

  <div class="actions">
    <a class="wa" href="${escHtml(waShare)}" target="_blank" rel="noopener">WhatsApp</a>
    <a class="tg" href="${escHtml(tgShare)}" target="_blank" rel="noopener">Telegram</a>
    <a class="x" href="${escHtml(xShare)}" target="_blank" rel="noopener">X</a>
  </div>
  ${await tahlilEngagementHtml(env, id, lang)}
  <a class="home-link" href="${L.list}">${escHtml(L.allTahlil)}</a>
</main>
${tahlilFooterHtml(L)}
<script>
(function(){
  var a=document.getElementById('au'),pb=document.getElementById('pb'),
      pg=document.getElementById('pg'),tm=document.getElementById('tm'),
      tk=document.getElementById('tk'),L=1000,total=${parseInt(t.duration, 10) || 0};
  var RTL=${L.rtl ? "true" : "false"};
  var LB=${JSON.stringify(L.play)},LP=${JSON.stringify(L.pause)},LR=${JSON.stringify(L.resume)};
  var ID=${JSON.stringify(String(id))},KEY='pi24_tahlil_'+ID;
  function fmt(s){s=Math.max(0,Math.floor(s||0));
    var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=String(s%60).padStart(2,'0');
    return h?(h+':'+String(m).padStart(2,'0')+':'+ss):(m+':'+ss);}
  function dur(){return (isFinite(a.duration)&&a.duration)||total||0;}
  function draw(){var d=dur(),r=d?a.currentTime/d:0;
    pg.style.strokeDashoffset=String(L-L*r);
    tm.textContent=fmt(a.currentTime)+' / '+fmt(d);
    tk.setAttribute('aria-valuenow',String(Math.round(r*100)));}
  pb.onclick=function(){if(a.paused){a.play();}else{a.pause();}};
  a.onplay=function(){pb.textContent='❚❚';pb.setAttribute('aria-label',LP);};
  a.onpause=function(){pb.textContent='▶';pb.setAttribute('aria-label',LB);};
  a.ontimeupdate=draw;a.onloadedmetadata=draw;
  a.onended=function(){a.currentTime=0;};
  tk.onclick=function(e){var b=tk.getBoundingClientRect();
    var r=(e.clientX-b.left)/b.width; if(RTL){r=1-r;}
    a.currentTime=Math.min(Math.max(r,0),1)*dur();};
  tk.onkeydown=function(e){
    var back=RTL?'ArrowRight':'ArrowLeft', fwd=RTL?'ArrowLeft':'ArrowRight';
    if(e.key===fwd){a.currentTime=a.currentTime+5;e.preventDefault();}
    if(e.key===back){a.currentTime=Math.max(0,a.currentTime-5);e.preventDefault();}
    if(e.key===' '){pb.click();e.preventDefault();}};
  document.getElementById('bk').onclick=function(){a.currentTime=Math.max(0,a.currentTime-15);};
  document.getElementById('fw').onclick=function(){a.currentTime=Math.min(dur(),a.currentTime+15);};
  function savePos(){try{
    if(a.currentTime>20&&a.currentTime<dur()-20){localStorage.setItem(KEY,String(Math.floor(a.currentTime)));}
    else{localStorage.removeItem(KEY);}
  }catch(e){}}
  setInterval(function(){if(!a.paused){savePos();}},5000);
  a.addEventListener('pause',savePos);
  a.addEventListener('ended',function(){try{localStorage.removeItem(KEY);}catch(e){}});
  var saved=0;try{saved=parseInt(localStorage.getItem(KEY)||'0',10)||0;}catch(e){}
  if(saved>20){
    var rs=document.getElementById('rs');
    rs.textContent=LR+fmt(saved);
    rs.style.display='';
    rs.onclick=function(){a.currentTime=saved;a.play();rs.style.display='none';};
  }
  var chips=document.querySelectorAll('[data-rate]');
  for(var i=0;i<chips.length;i++){(function(c){
    c.onclick=function(){a.playbackRate=parseFloat(c.getAttribute('data-rate'));
      for(var j=0;j<chips.length;j++){chips[j].setAttribute('aria-pressed',String(chips[j]===c));}};
  })(chips[i]);}
  draw();
})();
</script>
</body>
</html>`;

  /* اگر هنوز بخشی ترجمه نشده، کش کوتاه بگذار تا بازدید بعدی کامل شود */
  const maxAge = tr.pending > 0 ? 30 : 300;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=" + maxAge }
  });
}

/* ---------- فهرست تحلیل‌ها، سه‌زبانه ---------- */

async function handleTahlilListI18n(url, env, lang) {
  lang = tahlilLang(lang);
  const L = TAHLIL_I18N[lang];
  const index = await getTahlilIndex(env);

  const rows = index.slice(0, 60);
  let titles = rows.map(i => String(i.title || ""));
  if (lang !== "fa" && titles.length) {
    const tr = await tahlilTranslateMany(titles, lang, env, TAHLIL_TR_BUDGET_LIST);
    titles = tr.texts;
  }

  const items = rows.map((i, k) =>
    `<li><a href="${L.list}/${escHtml(i.id)}"><strong>${escHtml(titles[k] || i.title)}</strong>` +
    `<span>${escHtml(tahlilClock(i.duration))} · ${escHtml(tahlilDateLabel(i.date, lang))}</span></a></li>`
  ).join("\n");

  const canonical = SITE_ORIGIN + L.list;
  const mtBlock = (lang === "fa" || !L.mtNote) ? "" :
    `<div class="mtnote">${escHtml(L.mtNote)} <a href="${SITE_ORIGIN}/tahlil" hreflang="fa">${SITE_ORIGIN}/tahlil</a></div>`;

  const html = `<!DOCTYPE html>
<html lang="${L.htmlLang}" dir="${L.dir}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(L.listTitle)}</title>
<meta name="description" content="${escHtml(L.listDesc)}">
<link rel="canonical" href="${escHtml(canonical)}">
${tahlilAltLinks("")}
<link rel="alternate" type="application/rss+xml" title="Pulse Iran 24 — Audio" href="${SITE_ORIGIN}/tahlil.xml">
<meta name="theme-color" content="#0D1117">
<link rel="icon" href="/assets/favicon.ico" sizes="any">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Pulse Iran 24">
<meta property="og:title" content="${escHtml(L.listTitle)}">
<meta property="og:description" content="${escHtml(L.listDesc)}">
<meta property="og:url" content="${escHtml(canonical)}">
<meta property="og:locale" content="${L.locale}">
${TAHLIL_FONT}
<style>${TAHLIL_CSS}${TAHLIL_I18N_CSS}</style>
</head>
<body class="${L.rtl ? "rtl" : "ltr"}">
${tahlilHeaderHtml(L)}
<main class="wrap">
  ${tahlilLangSwitch(lang, "")}
  <div class="art-meta"><span class="badge">${escHtml(L.badge)}</span></div>
  <h1>${escHtml(L.listH1)}</h1>
  <p class="lede">${escHtml(L.listLede)}</p>
  ${items ? `<ul class="tlist">${items}</ul>` : `<p class="empty">${escHtml(L.empty)}</p>`}
  ${mtBlock}
  <a class="home-link" href="${L.home}">${escHtml(L.backHome)}</a>
</main>
${tahlilFooterHtml(L)}
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=180" }
  });
}

/* ---------- صفحه‌ی «یافت نشد» به زبان صفحه ---------- */

function tahlilNotFoundPage(lang) {
  const L = TAHLIL_I18N[tahlilLang(lang)];
  const html = `<!DOCTYPE html>
<html lang="${L.htmlLang}" dir="${L.dir}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>404 | Pulse Iran 24</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/assets/favicon.ico" sizes="any">
<link rel="stylesheet" href="/assets/fonts/vazirmatn.css">
<style>
  body{margin:0;font-family:'Vazirmatn',Tahoma,sans-serif;background:#0D1117;color:#E9EDF2;
    display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
  h1{font-size:1.3rem;margin-bottom:10px}
  p{color:#8B96A5;margin-bottom:22px}
  a{color:#FF2D4A;font-weight:700;text-decoration:none}
</style>
</head>
<body>
  <div>
    <h1>${escHtml(L.notFoundH)}</h1>
    <p>${escHtml(L.notFoundP)}</p>
    <a href="${L.list}">${escHtml(L.allTahlil)}</a>
  </div>
</body>
</html>`;
  return new Response(html, { status: 404, headers: { "Content-Type": "text/html; charset=UTF-8" } });
}

/* ---------- ورودی‌های sitemap برای هر سه زبان ---------- */

async function tahlilSitemapUrlsI18n(env) {
  const index = await getTahlilIndex(env);
  const out = [];
  for (const p of ["/tahlil", "/en/tahlil", "/de/tahlil"]) {
    out.push(`  <url><loc>${SITE_ORIGIN}${p}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`);
  }
  for (const i of index.slice(0, 300)) {
    const lm = (i.date && !isNaN(Date.parse(i.date))) ? new Date(i.date).toISOString() : null;
    for (const p of ["/tahlil/", "/en/tahlil/", "/de/tahlil/"]) {
      out.push(
        `  <url><loc>${SITE_ORIGIN}${p}${i.id}</loc>` +
        (lm ? `<lastmod>${lm}</lastmod>` : "") +
        `<changefreq>monthly</changefreq><priority>${p === "/tahlil/" ? "0.7" : "0.6"}</priority></url>`
      );
    }
  }
  return out;
}


/* ============================================================================
   پالس ایران ۲۴ — لایک و نظر برای تحلیل صوتی  (v80)
   ----------------------------------------------------------------------------
   پیش‌نیاز: v79 نصب شده باشد.
   این فایل append-only است و هیچ تابع موجودی را بازتعریف نمی‌کند.
   از توابع موجود استفاده می‌کند: escHtml, checkAdmin, adminJson,
   getTahlilIndex, JSON_HEADERS, SITE_ORIGIN

   نصب در چهار گام — شرح کامل در انتهای همین فایل.

   ── طراحی:
      • لایک: از همان سیستم آمار فعلی سایت استفاده می‌کند
        (/.netlify/functions/stats با شناسه t-{id}). هیچ کد سروری جدیدی ندارد.
      • نظر: با تأیید قبل از انتشار. هیچ نظری بدون دیدن تو روی سایت نمی‌رود.
      • IP ذخیره نمی‌شود. فقط یک هش کوتاه‌مدت (۵ دقیقه) برای جلوگیری از اسپم
        نگه داشته می‌شود و خودکار پاک می‌شود — داده شخصی ذخیره‌شده نداریم.
      • نظرهای تأییدشده سمت سرور در صفحه رندر می‌شوند (برای گوگل).
      • پنل مدیریت نظرها جداست: /tahlil-comments-admin
        هم صف تأیید دارد، هم امکان حذف نظرهایی که قبلاً تأیید شده‌اند.

   ── کلیدهای KV (همان PULSE_STATS):
      tcm:{tid}      آرایه‌ی نظرهای یک تحلیل  [{cid,name,text,ts,ok}]
      tcm_queue      صف تأیید (نظرهای در انتظار، از همه‌ی تحلیل‌ها)
      rlc:{hash}     محدودیت نرخ، TTL پنج دقیقه، خودکار پاک می‌شود
      like:t-{tid}   شمارنده‌ی لایک (همان سیستم فعلی سایت)
   ============================================================================ */

const TCM_CAP = 300;          /* حداکثر نظر ذخیره‌شده برای هر تحلیل */
const TCM_QUEUE_CAP = 300;    /* حداکثر طول صف تأیید */
const TCM_TEXT_MAX = 1200;
const TCM_NAME_MAX = 40;
const TCM_RATE_TTL = 300;     /* ثانیه — فاصله‌ی لازم بین دو نظر از یک نفر */

/* ---------- برچسب‌ها ---------- */

const TCM_I18N = {
  fa: {
    heading: "نظرها",
    likeLabel: "پسندیدم",
    liked: "پسندیدید",
    formTitle: "نظر خود را بنویسید",
    name: "نام (اختیاری)",
    namePh: "بی‌نام",
    text: "متن نظر",
    textPh: "نظرتان درباره‌ی این تحلیل...",
    send: "ارسال نظر",
    sending: "در حال ارسال...",
    thanks: "نظر شما ثبت شد و پس از بررسی منتشر می‌شود.",
    errEmpty: "متن نظر را بنویسید.",
    errRate: "کمی صبر کنید و دوباره تلاش کنید.",
    errNet: "خطای شبکه. دوباره تلاش کنید.",
    none: "هنوز نظری منتشر نشده است.",
    anon: "بی‌نام",
    policy: "نظرها پیش از انتشار بررسی می‌شوند. توهین، تهدید و تبلیغ منتشر نمی‌شود."
  },
  en: {
    heading: "Comments",
    likeLabel: "Like",
    liked: "Liked",
    formTitle: "Leave a comment",
    name: "Name (optional)",
    namePh: "Anonymous",
    text: "Your comment",
    textPh: "What did you think of this analysis?",
    send: "Post comment",
    sending: "Sending...",
    thanks: "Your comment was received and will appear after review.",
    errEmpty: "Please write a comment.",
    errRate: "Please wait a moment and try again.",
    errNet: "Network error. Please try again.",
    none: "No comments published yet.",
    anon: "Anonymous",
    policy: "Comments are reviewed before publication. Abuse, threats and advertising are not published."
  },
  de: {
    heading: "Kommentare",
    likeLabel: "Gefällt mir",
    liked: "Gefällt dir",
    formTitle: "Kommentar schreiben",
    name: "Name (optional)",
    namePh: "Anonym",
    text: "Ihr Kommentar",
    textPh: "Was halten Sie von dieser Analyse?",
    send: "Kommentar senden",
    sending: "Wird gesendet...",
    thanks: "Ihr Kommentar ist eingegangen und erscheint nach der Prüfung.",
    errEmpty: "Bitte schreiben Sie einen Kommentar.",
    errRate: "Bitte warten Sie einen Moment und versuchen Sie es erneut.",
    errNet: "Netzwerkfehler. Bitte erneut versuchen.",
    none: "Noch keine Kommentare veröffentlicht.",
    anon: "Anonym",
    policy: "Kommentare werden vor der Veröffentlichung geprüft. Beleidigungen, Drohungen und Werbung werden nicht veröffentlicht."
  }
};

/* ---------- ابزارها ---------- */

function tcmSafeId(v) {
  return String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
}

/* پاک‌سازی متن ورودی: حذف تگ‌ها، کاراکترهای کنترلی و خط‌های خالی اضافه */
function tcmClean(v, max) {
  return String(v == null ? "" : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\r\t]/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/* هش کوتاه برای محدودیت نرخ — IP خام هرگز ذخیره نمی‌شود */
function tcmRateHash(ip, tid) {
  const s = String(ip || "0") + "|" + String(tid || "");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

async function tcmGetComments(env, tid) {
  const kv = env && env.PULSE_STATS;
  if (!kv) return [];
  try {
    const raw = await kv.get("tcm:" + tid);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

async function tcmGetQueue(env) {
  const kv = env && env.PULSE_STATS;
  if (!kv) return [];
  try {
    const raw = await kv.get("tcm_queue");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function tcmDate(ts, lang) {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    if (lang === "fa") return formatFaDate(d.toISOString());
    return d.toLocaleDateString(lang === "de" ? "de-DE" : "en-GB",
      { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  } catch (e) { return ""; }
}

/* ---------- دریافت نظر تازه (عمومی) ---------- */

/* ── v95: کلید قطع/وصل نظرها ──────────────────────────────────────────────
   تا زمانی که Impressum و Datenschutzerklärung روی سایت منتشر نشده‌اند،
   جمع‌آوری داده‌ی کاربر (نام دلخواه + متن نظر) پایه‌ی حقوقی ندارد.
   با false شدن این ثابت: فرم روی صفحه نمایش داده نمی‌شود و اندپوینت هم
   درخواست را رد می‌کند. نظرهای منتشرشده‌ی قبلی سر جایشان می‌مانند.
   بعد از انتشار صفحات حقوقی فقط همین را true کن. */
const TCM_ENABLED = false;

const TCM_CLOSED = {
  fa: "بخش نظرها موقتاً بسته است.",
  en: "Comments are temporarily closed.",
  de: "Die Kommentarfunktion ist vorübergehend geschlossen."
};

async function handleTahlilCommentPost(request, env) {
  if (!TCM_ENABLED) {
    return new Response(JSON.stringify({ ok: false, error: "comments_closed" }), { status: 403, headers: JSON_HEADERS });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method" }), { status: 405, headers: JSON_HEADERS });
  }

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  /* تله‌ی ضد ربات — اگر پر شده بود، وانمود به موفقیت */
  if (body.hp) return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });

  const kv = env && env.PULSE_STATS;
  if (!kv) return new Response(JSON.stringify({ ok: false, error: "kv_missing" }), { status: 503, headers: JSON_HEADERS });

  const tid = tcmSafeId(body.id);
  const text = tcmClean(body.text, TCM_TEXT_MAX);
  const name = tcmClean(body.name, TCM_NAME_MAX);

  if (!tid) return new Response(JSON.stringify({ ok: false, error: "id_required" }), { status: 400, headers: JSON_HEADERS });
  if (text.length < 2) return new Response(JSON.stringify({ ok: false, error: "empty" }), { status: 400, headers: JSON_HEADERS });

  /* تحلیل باید واقعاً وجود داشته باشد */
  try {
    const exists = await kv.get("tahlil:" + tid);
    if (!exists) return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: JSON_HEADERS });
  } catch (e) {}

  /* محدودیت نرخ — کلید خودش بعد از پنج دقیقه پاک می‌شود */
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const rlKey = "rlc:" + tcmRateHash(ip, tid);
  try {
    const busy = await kv.get(rlKey);
    if (busy) return new Response(JSON.stringify({ ok: false, error: "rate" }), { status: 429, headers: JSON_HEADERS });
  } catch (e) {}

  const cid = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const item = { cid, name, text, ts: new Date().toISOString(), ok: false };

  let items = await tcmGetComments(env, tid);
  items.unshift(item);
  if (items.length > TCM_CAP) items = items.slice(0, TCM_CAP);
  await kv.put("tcm:" + tid, JSON.stringify(items));

  let queue = await tcmGetQueue(env);
  queue.unshift({ tid, cid, name, text: text.slice(0, 400), ts: item.ts });
  if (queue.length > TCM_QUEUE_CAP) queue = queue.slice(0, TCM_QUEUE_CAP);
  await kv.put("tcm_queue", JSON.stringify(queue));

  try { await kv.put(rlKey, "1", { expirationTtl: TCM_RATE_TTL }); } catch (e) {}

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store" }
  });
}

/* ---------- بلوک لایک و نظر برای صفحه‌ی تحلیل ---------- */

async function tahlilEngagementHtml(env, id, lang) {
  const l = TCM_I18N[lang] ? lang : "fa";
  const C = TCM_I18N[l];
  const tid = tcmSafeId(id);

  const items = (await tcmGetComments(env, tid)).filter(x => x && x.ok);

  const list = items.length
    ? items.map(c =>
        `<li class="cm">
          <div class="cm-h"><b>${escHtml(c.name || C.anon)}</b><span>${escHtml(tcmDate(c.ts, l))}</span></div>
          <div class="cm-b">${escHtml(c.text).replace(/\n/g, "<br>")}</div>
        </li>`).join("\n")
    : `<li class="cm-none">${escHtml(C.none)}</li>`;

  return `
<style>
  .engage{margin-top:34px;padding-top:22px;border-top:1px solid var(--line)}
  .likebar{display:flex;align-items:center;gap:12px;margin-bottom:26px}
  .likebtn{background:var(--surface);border:1px solid var(--line);color:var(--text);
    border-radius:999px;padding:9px 18px;font-family:inherit;font-size:.92rem;font-weight:600;
    cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:.15s}
  .likebtn:hover{border-color:var(--pulse)}
  .likebtn[data-on="1"]{background:rgba(255,45,74,.12);border-color:var(--pulse);color:var(--pulse)}
  .likebtn .n{font-variant-numeric:tabular-nums;opacity:.85}
  .engage h2{margin:0 0 6px}
  .cmpolicy{color:var(--dim);font-size:.8rem;margin:0 0 18px}
  .cmlist{list-style:none;padding:0;margin:0 0 26px}
  .cm{background:var(--surface);border:1px solid var(--line);border-radius:12px;
    padding:13px 15px;margin-bottom:10px}
  .cm-h{display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-bottom:6px}
  .cm-h b{font-size:.92rem}
  .cm-h span{color:var(--dim);font-size:.76rem;white-space:nowrap}
  .cm-b{font-size:.96rem;color:#dbe1e8;line-height:1.8;word-break:break-word}
  .cm-none{color:var(--dim);font-size:.9rem}
  .cmform label{display:block;font-size:.85rem;color:var(--dim);margin:12px 0 6px}
  .cmform input,.cmform textarea{width:100%;background:var(--bg);border:1px solid var(--line);
    border-radius:10px;color:var(--text);font-family:inherit;font-size:1rem;padding:11px 12px}
  .cmform textarea{min-height:110px;resize:vertical;line-height:1.8}
  .cmform button{background:var(--pulse);color:#fff;border:0;border-radius:10px;font-family:inherit;
    font-weight:700;font-size:.95rem;padding:11px 22px;cursor:pointer;margin-top:14px}
  .cmform button:disabled{opacity:.5}
  .cmmsg{margin-top:10px;font-size:.88rem;min-height:1.2em}
  .cmmsg.ok{color:#39d98a}.cmmsg.err{color:var(--pulse)}
  .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
</style>
<section class="engage">
  <div class="likebar">
    <button class="likebtn" id="lkb" data-on="0" aria-pressed="false">
      <span>♥</span><span>${escHtml(C.likeLabel)}</span><span class="n" id="lkn">—</span>
    </button>
  </div>

  <h2>${escHtml(C.heading)}</h2>
  <p class="cmpolicy">${escHtml(C.policy)}</p>
  <ul class="cmlist">${list}</ul>

  ${TCM_ENABLED ? `<div class="cmform">
    <b>${escHtml(C.formTitle)}</b>
    <label for="cmn">${escHtml(C.name)}</label>
    <input id="cmn" maxlength="40" placeholder="${escHtml(C.namePh)}">
    <label for="cmt">${escHtml(C.text)}</label>
    <textarea id="cmt" maxlength="1200" placeholder="${escHtml(C.textPh)}"></textarea>
    <input class="hp" id="cmhp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button id="cmb">${escHtml(C.send)}</button>
    <div class="cmmsg" id="cmm"></div>
  </div>` : `<p class="cmpolicy">${escHtml(TCM_CLOSED[l] || TCM_CLOSED.fa)}</p>`}
</section>
<script>
(function(){
  var TID=${JSON.stringify(tid)};
  var T=${JSON.stringify({ sending: C.sending, send: C.send, thanks: C.thanks, errEmpty: C.errEmpty, errRate: C.errRate, errNet: C.errNet, liked: C.liked, likeLabel: C.likeLabel })};
  var SID='t-'+TID, LK='pi24_like_'+SID;
  var b=document.getElementById('lkb'), n=document.getElementById('lkn');

  function mark(on){
    b.setAttribute('data-on', on?'1':'0');
    b.setAttribute('aria-pressed', on?'true':'false');
    b.children[1].textContent = on ? T.liked : T.likeLabel;
  }
  var already=false;
  try{ already = localStorage.getItem(LK)==='1'; }catch(e){}
  mark(already);

  fetch('/.netlify/functions/stats?action=likes&ids='+encodeURIComponent(SID))
    .then(function(r){return r.json();})
    .then(function(j){ var v=(j&&j.likes&&j.likes[SID])||0; n.textContent=v; })
    .catch(function(){ n.textContent='0'; });

  b.onclick=function(){
    if(already){ return; }
    already=true; mark(true);
    n.textContent = String((parseInt(n.textContent,10)||0)+1);
    try{ localStorage.setItem(LK,'1'); }catch(e){}
    fetch('/.netlify/functions/stats?action=like&id='+encodeURIComponent(SID))
      .then(function(r){return r.json();})
      .then(function(j){ if(j&&typeof j.likes==='number'){ n.textContent=j.likes; } })
      .catch(function(){});
  };

  var tb=document.getElementById('cmb'), tt=document.getElementById('cmt'),
      tn=document.getElementById('cmn'), th=document.getElementById('cmhp'),
      tm=document.getElementById('cmm');
  if(tb) tb.onclick=function(){
    var txt=(tt.value||'').trim();
    if(txt.length<2){ tm.textContent=T.errEmpty; tm.className='cmmsg err'; return; }
    tb.disabled=true; tm.textContent=T.sending; tm.className='cmmsg';
    fetch('/api/tahlil-comment',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id:TID, name:(tn.value||''), text:txt, hp:(th.value||'') })
    }).then(function(r){ return r.json().then(function(j){ j._s=r.status; return j; }); })
      .then(function(j){
        tb.disabled=false;
        if(j.ok){ tm.textContent=T.thanks; tm.className='cmmsg ok'; tt.value=''; tn.value=''; }
        else if(j._s===429){ tm.textContent=T.errRate; tm.className='cmmsg err'; }
        else { tm.textContent=T.errNet; tm.className='cmmsg err'; }
      })
      .catch(function(){ tb.disabled=false; tm.textContent=T.errNet; tm.className='cmmsg err'; });
  };
})();
</script>`;
}

/* ---------- API پنل مدیریت نظرها ---------- */

async function handleTahlilCommentsAdminApi(request, env) {
  if (request.method !== "POST") return adminJson({ ok: false, error: "method" }, 405);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  const auth = checkAdmin(request, env, body);
  if (!auth.ok) return adminJson({ ok: false, error: auth.msg }, auth.code);

  const kv = env.PULSE_STATS;
  if (!kv) return adminJson({ ok: false, error: "kv_missing" }, 503);

  const action = String(body.action || "");

  if (action === "login") return adminJson({ ok: true });

  /* صف تأیید — نظرهای منتشرنشده از همه‌ی تحلیل‌ها */
  if (action === "queue") {
    return adminJson({ ok: true, items: await tcmGetQueue(env) });
  }

  /* فهرست تحلیل‌ها برای انتخاب */
  if (action === "tahlils") {
    const idx = await getTahlilIndex(env);
    return adminJson({ ok: true, items: idx.map(i => ({ id: i.id, title: i.title })) });
  }

  /* همه‌ی نظرهای یک تحلیل — تأییدشده و در انتظار، برای حذف */
  if (action === "list") {
    const tid = tcmSafeId(body.tid);
    if (!tid) return adminJson({ ok: false, error: "tid_required" }, 400);
    return adminJson({ ok: true, items: await tcmGetComments(env, tid) });
  }

  if (action === "approve" || action === "delete") {
    const tid = tcmSafeId(body.tid);
    const cid = tcmSafeId(body.cid);
    if (!tid || !cid) return adminJson({ ok: false, error: "id_required" }, 400);

    let items = await tcmGetComments(env, tid);
    if (action === "approve") {
      items = items.map(x => (x && x.cid === cid) ? { ...x, ok: true } : x);
    } else {
      items = items.filter(x => !(x && x.cid === cid));
    }
    await kv.put("tcm:" + tid, JSON.stringify(items));

    /* در هر دو حالت از صف تأیید خارج می‌شود */
    const queue = (await tcmGetQueue(env)).filter(q => !(q && q.tid === tid && q.cid === cid));
    await kv.put("tcm_queue", JSON.stringify(queue));

    return adminJson({ ok: true });
  }

  /* برگرداندن یک نظر تأییدشده به حالت پنهان (بدون حذف کامل) */
  if (action === "hide") {
    const tid = tcmSafeId(body.tid);
    const cid = tcmSafeId(body.cid);
    if (!tid || !cid) return adminJson({ ok: false, error: "id_required" }, 400);
    const items = (await tcmGetComments(env, tid)).map(x => (x && x.cid === cid) ? { ...x, ok: false } : x);
    await kv.put("tcm:" + tid, JSON.stringify(items));
    return adminJson({ ok: true });
  }

  return adminJson({ ok: false, error: "unknown_action" }, 400);
}

function handleTahlilCommentsAdminPage() {
  return new Response(TCM_ADMIN_HTML, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}

const TCM_ADMIN_HTML = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>مدیریت نظرها — پالس ایران ۲۴</title>
<link rel="stylesheet" href="/assets/fonts/vazirmatn.css">
<style>
 :root{--bg:#0D1117;--surface:#161C26;--line:#2A3442;--text:#E9EDF2;--dim:#8B96A5;--pulse:#FF2D4A}
 *{box-sizing:border-box}
 body{margin:0;font-family:'Vazirmatn',Tahoma,sans-serif;background:var(--bg);color:var(--text);line-height:1.7}
 .wrap{max-width:780px;margin:0 auto;padding:22px 16px}
 h1{font-size:1.3rem;font-weight:900} h1 b{color:var(--pulse)}
 h3{font-size:1rem;margin:0 0 6px}
 .card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:18px}
 label{display:block;font-size:.9rem;color:var(--dim);margin:12px 0 6px}
 input,select{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:10px;color:var(--text);font-family:inherit;font-size:1rem;padding:11px 12px}
 button{background:var(--pulse);color:#fff;border:0;border-radius:10px;font-family:inherit;font-weight:700;font-size:1rem;padding:12px 20px;cursor:pointer;margin-top:14px}
 button.sec{background:var(--surface);border:1px solid var(--line);color:var(--text);padding:6px 13px;font-size:.82rem;margin:0}
 button.go{background:transparent;border:1px solid #39d98a;color:#39d98a;padding:6px 13px;font-size:.82rem;margin:0}
 button.no{background:transparent;border:1px solid var(--pulse);color:var(--pulse);padding:6px 13px;font-size:.82rem;margin:0}
 .msg{margin-top:12px;font-size:.9rem;min-height:1.2em}
 .ok{color:#39d98a}.err{color:var(--pulse)}
 .hidden{display:none}
 .row{border-top:1px solid var(--line);padding:13px 0}
 .row:first-child{border-top:0}
 .row .top{display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-bottom:5px}
 .row b{font-size:.92rem}
 .row small{color:var(--dim);font-size:.76rem}
 .row p{margin:0 0 8px;font-size:.94rem;color:#dbe1e8;word-break:break-word;white-space:pre-wrap}
 .btns{display:flex;gap:8px;flex-wrap:wrap}
 .hint{color:var(--dim);font-size:.82rem;margin-top:8px}
 .pill{display:inline-block;border-radius:999px;padding:1px 9px;font-size:.72rem;border:1px solid var(--line);color:var(--dim)}
 .pill.on{color:#39d98a;border-color:#39d98a}
 a.nav{color:#2AABEE;text-decoration:none;font-size:.9rem}
</style>
</head>
<body>
<div class="wrap">
 <h1>مدیریت نظرها <b>پالس ایران ۲۴</b></h1>
 <p><a class="nav" href="/tahlil-admin">← پنل تحلیل صوتی</a> &nbsp;·&nbsp; <a class="nav" href="/admin">پنل خبر</a></p>

 <div id="login" class="card">
   <label>رمز ورود</label>
   <input id="pw" type="password" autocomplete="current-password" placeholder="ADMIN_TOKEN">
   <button id="loginBtn">ورود</button>
   <div id="loginMsg" class="msg"></div>
 </div>

 <div id="qcard" class="card hidden">
   <h3>صف تأیید</h3>
   <div class="hint">تا وقتی تأیید نکنی، هیچ‌کدام روی سایت دیده نمی‌شوند.</div>
   <div id="queue"></div>
 </div>

 <div id="mcard" class="card hidden">
   <h3>نظرهای منتشرشده — حذف</h3>
   <div class="hint">برای حذف نظری که قبلاً تأیید شده، تحلیل را انتخاب کن.</div>
   <label>تحلیل</label>
   <select id="tsel"></select>
   <button id="loadBtn">نمایش نظرها</button>
   <div id="mlist"></div>
 </div>
</div>
<script>
(function(){
  var token = sessionStorage.getItem('pi24_admin') || '';
  function el(id){ return document.getElementById(id); }

  function api(action, extra){
    var payload = Object.assign({action:action}, extra||{});
    return fetch('/tahlil-comments-admin/api', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify(payload)
    }).then(function(r){ return r.json().then(function(j){ j._status=r.status; return j; }); });
  }

  function showApp(){
    el('login').classList.add('hidden');
    el('qcard').classList.remove('hidden');
    el('mcard').classList.remove('hidden');
    loadQueue(); loadTahlils();
  }

  function doLogin(){
    token = el('pw').value.trim();
    if(!token){ return; }
    el('loginMsg').textContent='در حال بررسی...'; el('loginMsg').className='msg';
    api('login').then(function(j){
      if(j.ok){ sessionStorage.setItem('pi24_admin', token); el('loginMsg').textContent=''; showApp(); }
      else { el('loginMsg').textContent = j._status===503 ? 'ADMIN_TOKEN تنظیم نشده' : 'رمز اشتباه است'; el('loginMsg').className='msg err'; }
    }).catch(function(){ el('loginMsg').textContent='خطای شبکه'; el('loginMsg').className='msg err'; });
  }

  function rowEl(c, tid, approved){
    var d=document.createElement('div'); d.className='row';
    var top=document.createElement('div'); top.className='top';
    var b=document.createElement('b'); b.textContent=c.name||'بی‌نام';
    var s=document.createElement('small');
    s.textContent=String(c.ts||'').slice(0,10)+'  ·  /tahlil/'+tid;
    top.appendChild(b); top.appendChild(s);
    var p=document.createElement('p'); p.textContent=c.text||'';
    var btns=document.createElement('div'); btns.className='btns';
    if(!approved){
      var okb=document.createElement('button'); okb.className='go'; okb.textContent='تأیید و انتشار';
      okb.onclick=function(){ api('approve',{tid:tid,cid:c.cid}).then(function(r){ if(r.ok){ loadQueue(); } }); };
      btns.appendChild(okb);
    } else {
      var hb=document.createElement('button'); hb.className='sec'; hb.textContent='پنهان کردن';
      hb.onclick=function(){ api('hide',{tid:tid,cid:c.cid}).then(function(r){ if(r.ok){ el('loadBtn').click(); loadQueue(); } }); };
      btns.appendChild(hb);
    }
    var db=document.createElement('button'); db.className='no'; db.textContent='حذف کامل';
    db.onclick=function(){
      if(!confirm('این نظر برای همیشه حذف شود؟')){ return; }
      api('delete',{tid:tid,cid:c.cid}).then(function(r){ if(r.ok){ loadQueue(); if(approved){ el('loadBtn').click(); } }});
    };
    btns.appendChild(db);
    d.appendChild(top); d.appendChild(p); d.appendChild(btns);
    return d;
  }

  function loadQueue(){
    api('queue').then(function(j){
      var box=el('queue'); box.innerHTML='';
      if(!j.ok || !j.items || !j.items.length){ box.innerHTML='<p class="hint">نظر تأییدنشده‌ای وجود ندارد.</p>'; return; }
      j.items.forEach(function(q){ box.appendChild(rowEl(q, q.tid, false)); });
    });
  }

  function loadTahlils(){
    api('tahlils').then(function(j){
      var sel=el('tsel'); sel.innerHTML='';
      if(!j.ok || !j.items){ return; }
      j.items.forEach(function(t){
        var o=document.createElement('option'); o.value=t.id; o.textContent=(t.title||t.id);
        sel.appendChild(o);
      });
    });
  }

  el('loadBtn').onclick=function(){
    var tid=el('tsel').value;
    if(!tid){ return; }
    api('list',{tid:tid}).then(function(j){
      var box=el('mlist'); box.innerHTML='';
      if(!j.ok || !j.items || !j.items.length){ box.innerHTML='<p class="hint">این تحلیل هنوز نظری ندارد.</p>'; return; }
      j.items.forEach(function(c){
        var d=rowEl(c, tid, !!c.ok);
        var pill=document.createElement('span');
        pill.className='pill'+(c.ok?' on':'');
        pill.textContent=c.ok?'منتشرشده':'در انتظار';
        d.querySelector('.top').appendChild(pill);
        box.appendChild(d);
      });
    });
  };

  el('loginBtn').onclick = doLogin;
  el('pw').addEventListener('keydown', function(e){ if(e.key==='Enter'){ doLogin(); } });
  if(token){ api('login').then(function(j){ if(j.ok){ showApp(); } else { sessionStorage.removeItem('pi24_admin'); } }); }
})();
</script>
</body>
</html>`;

/* ============================================================================
   نصب v80 — چهار گام
   ----------------------------------------------------------------------------
   گام ۱ — کل این فایل را به انتهای _worker.js اضافه کن (بعد از بلوک v79).

   گام ۲ — در تابع fetch، این سه خط را درست *بالای* خط
           return env.ASSETS.fetch(request);  اضافه کن:

     if (path === "/api/tahlil-comment") return handleTahlilCommentPost(request, env);
     if (path === "/tahlil-comments-admin" || path === "/tahlil-comments-admin/") return handleTahlilCommentsAdminPage();
     if (path === "/tahlil-comments-admin/api") return handleTahlilCommentsAdminApi(request, env);

   گام ۳ — در تابع handleTahlilPageI18n (داخل بلوک v79)، این خط را پیدا کن:

     <a class="home-link" href="${L.list}">${escHtml(L.allTahlil)}</a>

   و درست *بالایش* این خط را اضافه کن:

     ${await tahlilEngagementHtml(env, id, lang)}

   ⚠️ آن خط دقیقاً یک بار در کل فایل وجود دارد و داخل handleTahlilPageI18n است.
      خط مشابهی در handleTahlilListI18n هست ولی آن href="${L.home}" دارد — به آن دست نزن.

   گام ۴ — در خط اول فایل، v79 را به v80 تغییر بده.

   ----------------------------------------------------------------------------
   تست بعد از استقرار:
     ۱) /tahlil/1405-05-06 را باز کن — پایین صفحه دکمه ♥ و فرم نظر باید باشد
     ۲) یک نظر آزمایشی بفرست — باید پیام «پس از بررسی منتشر می‌شود» بدهد
        و روی صفحه دیده نشود
     ۳) /tahlil-comments-admin را باز کن، وارد شو، نظر را تأیید کن
     ۴) صفحه تحلیل را رفرش کن (تا ۵ دقیقه کش دارد) — نظر باید دیده شود
     ۵) در همان پنل، بخش «نظرهای منتشرشده» → تحلیل را انتخاب کن →
        «حذف کامل» را بزن و مطمئن شو از صفحه پاک می‌شود

   نکته‌ی حقوقی: چون نظر کاربران روی سایت منتشر می‌شود، در
   Datenschutzerklärung یک بند کوتاه لازم است: چه چیزی ذخیره می‌شود
   (نام دلخواه و متن نظر)، چه چیزی ذخیره نمی‌شود (IP و ایمیل)،
   و اینکه نظرها پیش از انتشار بررسی می‌شوند.
   ============================================================================ */

/* ============================================================================
   v99 — اتاق خبر هوشمند  (ماژول مستقل، همه توابع با پیشوند ai)
   پنل: /ai-newsroom   |   نیاز به Secret: GEMINI_API_KEY  (رایگان)
   صفر نوشتن در KV — فیدها در کش لبه، لیست دیده‌شده در localStorage مرورگر
   نام مدل در کد ثابت نیست؛ فهرست زنده از گوگل خوانده و در پنل انتخاب می‌شود
============================================================================ */

/* نام مدل‌های Gemini مدام عوض می‌شود و بعضی aliasها ناپایدارند،
   پس هیچ نامی در کد ثابت نشده — فهرست از خود گوگل خوانده می‌شود
   و در پنل انتخاب می‌کنید. این فقط انتخابِ پیش‌فرض است. */
const AI_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const AI_MODEL_HINT = "flash";    // ردهٔ رایگان گوگل فقط Flash است
const AI_FEED_TTL = 600;          // ثانیه — کش لبه برای فیدها
const AI_PER_FEED = 10;           // حداکثر آیتم از هر فید
const AI_XML_CAP = 60000;         // حداکثر کاراکتر XML که پارس می‌شود
const AI_PAGE_CAP = 100000;       // حداکثر کاراکتر صفحه خبر برای متن کامل
const AI_TEXT_CAP = 6000;         // حداکثر کاراکتر متنی که به مدل می‌رود

const AI_FEEDS = [
  { name: "Guardian",    url: "https://www.theguardian.com/world/iran/rss" },
  { name: "Guardian",    url: "https://www.theguardian.com/world/middleeast/rss" },
  { name: "Al Jazeera",  url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "BBC",         url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml" },
  { name: "DW",          url: "https://rss.dw.com/rdf/rss-en-world" },
  { name: "France 24",   url: "https://www.france24.com/en/middle-east/rss" },
  { name: "Times of Israel", url: "https://www.timesofisrael.com/feed/" }
];

/* ---------------------------------------------------------------- helpers */

function aiCheckAdmin(request, env) {
  const want = env && env.ADMIN_TOKEN;
  if (!want) return false;
  const url = new URL(request.url);
  const got = request.headers.get("x-admin-token") || url.searchParams.get("token") || "";
  return got === want;
}

function aiJson(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function aiDecode(s) {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(parseInt(d, 10)); })
    .replace(/&#[xX]([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function aiStripTags(s) {
  if (!s) return "";
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function aiTag(block, tag) {
  const re = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i");
  const m = block.match(re);
  return m ? aiDecode(m[1]).trim() : "";
}

function aiLink(block) {
  const direct = aiTag(block, "link");
  if (direct && /^https?:/i.test(direct)) return direct;
  const href = block.match(/<link[^>]*href="([^"]+)"/i);
  return href ? aiDecode(href[1]) : "";
}

function aiParseFeed(xml, sourceName) {
  const out = [];
  const body = xml.length > AI_XML_CAP ? xml.slice(0, AI_XML_CAP) : xml;
  const blocks = body.split(/<item[\s>]|<entry[\s>]/i).slice(1);
  for (let i = 0; i < blocks.length && out.length < AI_PER_FEED; i++) {
    const b = blocks[i];
    const title = aiStripTags(aiTag(b, "title"));
    if (!title) continue;
    const link = aiLink(b);
    if (!link) continue;
    let summary = aiStripTags(aiTag(b, "description") || aiTag(b, "summary") || aiTag(b, "content"));
    if (summary.length > 800) summary = summary.slice(0, 800);
    const date = aiTag(b, "pubDate") || aiTag(b, "published") || aiTag(b, "updated") || aiTag(b, "dc:date");
    out.push({ title: title, link: link, summary: summary, date: date, source: sourceName });
  }
  return out;
}

async function aiFetchOne(feed) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, 6000);
    const r = await fetch(feed.url, {
      signal: ctl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept": "application/rss+xml, application/xml, text/xml, */*"
      }
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const xml = await r.text();
    return aiParseFeed(xml, feed.name);
  } catch (e) {
    return [];
  }
}

async function aiFetchFeeds() {
  const cacheKey = new Request("https://pulseiran24.com/__ai-feeds-v1");
  const cache = caches.default;
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return await hit.json();
  } catch (e) { /* کش در دسترس نبود، ادامه */ }

  const settled = await Promise.allSettled(AI_FEEDS.map(aiFetchOne));
  let items = [];
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === "fulfilled") items = items.concat(settled[i].value);
  }

  // حذف تکراری بر اساس لینک
  const seen = {};
  const uniq = [];
  for (let i = 0; i < items.length; i++) {
    const k = items[i].link.split("?")[0];
    if (seen[k]) continue;
    seen[k] = 1;
    uniq.push(items[i]);
  }
  uniq.sort(function (a, b) {
    const ta = Date.parse(a.date || "") || 0;
    const tb = Date.parse(b.date || "") || 0;
    return tb - ta;
  });

  const payload = { ok: true, count: uniq.length, items: uniq };
  try {
    await cache.put(cacheKey, new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=" + AI_FEED_TTL }
    }));
  } catch (e) { /* کش نشد، مهم نیست */ }
  return payload;
}

async function aiFullText(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, 7000);
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml"
      }
    });
    clearTimeout(t);
    if (!r.ok) return "";
    let html = await r.text();
    if (html.length > AI_PAGE_CAP) html = html.slice(0, AI_PAGE_CAP);
    const paras = html.match(/<p[^>]*>[\s\S]{40,}?<\/p>/gi) || [];
    let text = paras.map(aiStripTags).filter(function (p) { return p.length > 40; }).join("\n\n");
    if (!text) text = aiStripTags(html);
    return text.slice(0, AI_TEXT_CAP);
  } catch (e) {
    return "";
  }
}

/* ------------------------------------------------------------ the prompt */

function aiSystemPrompt(format) {
  const base = [
    "تو سردبیر کمکی سایت خبری فارسی‌زبان «پالس ایران ۲۴» هستی.",
    "کار تو ترجمه نیست؛ بازنویسی خبری یک متن خارجی برای خوانندهٔ فارسی‌زبان است.",
    "",
    "خط قرمزهای منابع (غیرقابل مذاکره):",
    "- هرگز به خبرگزاری‌های داخل ایران استناد نکن و نامشان را نیاور (تسنیم، مهر، ایسنا، ایرنا، فارس، تابناک، باشگاه خبرنگاران، صداوسیما).",
    "  اگر متن اصلی از آن‌ها نقل کرده، همان محتوا را به شکل «به گزارش [رسانهٔ بین‌المللی]، مقام‌های ایرانی اعلام کردند...» بنویس یا حذفش کن.",
    "- مجاهدین خلق / شورای ملی مقاومت (MEK/NCRI) اصلاً وارد متن نمی‌شود؛ نه به‌عنوان منبع، نه نقل‌قول، نه اشاره.",
    "",
    "محدودیت فنی پنل انتشار — بسیار مهم:",
    "- بدنه فقط متن ساده است. هیچ HTML و هیچ مارک‌داون (** یا # یا -) ننویس؛ روی سایت به شکل متن خام دیده می‌شود.",
    "- برای تیتربندی داخلی فقط 🔹 و برای فهرست ▪️ . نشانهٔ 📌 فقط برای خط منبع در انتهاست و در تیتربندی داخلی نیاید. هیچ نشانهٔ دیگری (◆ ► ● ★ …) نیاور.",
    "",
    "جملهٔ اول — مهم‌ترین قاعده:",
    "باید یک جملهٔ کامل خبری باشد که می‌گوید چه اتفاقی افتاد و به گفتهٔ چه کسی.",
    "خلاصهٔ کارت صفحهٔ اول از همین جمله برداشته می‌شود، پس نباید توصیفی یا زمینه‌ای باشد.",
    "غلط: «همکاری نظامی و اقتصادی پیونگ‌یانگ با مسکو درآمدهای قابل‌توجهی به همراه داشته است.»",
    "درست: «کره‌شمالی درآمد حاصل از همکاری نظامی با روسیه را صرف توسعه زیرساخت و برنامه‌های تسلیحاتی کرده است؛ این را گزارشی از دویچه‌وله می‌گوید.»",
    "هرگز با تیتر، ایموجی یا جملهٔ زمینه‌ای شروع نکن.",
    "- تیتر زیر ۱۱۰ کاراکتر، بدون علامت تعجب، ترجمهٔ تحت‌اللفظی تیتر اصلی نباشد.",
    "",
    "زبان انتساب:",
    "- دو منبع مستقل: «رخ داد» / «اعلام شد»",
    "- یک منبع: «به گزارش [نام رسانه]...»",
    "- منبع رسمی طرف درگیر: «[نهاد] مدعی شد» — ننویس «تأیید شد»",
    "- شبکه‌های اجتماعی: «ویدئویی منتشر شده که ادعا می‌شود...» — ننویس «ویدئو نشان می‌دهد»",
    "- اگر تأیید مستقلی نیست، همین را صریح بنویس؛ این جمله را حذف نکن.",
    "",
    "لحن و تایپ:",
    "- فارسی روشن و خبری، بدون ادبیات احساسی و بدون صفت ارزشی («رژیم»، «شهید»، «تروریست») مگر داخل نقل‌قول مستقیم با ذکر گوینده.",
    "- ی و ک فارسی (نه ي و ك عربی)، گیومهٔ «» ، ویرگول فارسی ، و علامت سؤال ؟",
    "",
    "اعداد — این قاعده را دقیق رعایت کن، دو حالت دارد:",
    "- عدد در متن عادی: فارسی. مثال: «سه کشور»، «ده‌ها نفر»، «دو هفته پیش».",
    "- آمار، ارقام، درصد، مبلغ، تعداد کشورها و تاریخ میلادی: لاتین.",
    "  درست: «28 هزار تبعه خارجی از 136 کشور»، «7.7 میلیارد دلار»، «26.6 میلیارد دلار»، «سال 2024»، «80 کیلومتر».",
    "  غلط: «۲۸ هزار تبعه خارجی از ۱۳۶ کشور»، «۷.۷ میلیارد دلار»، «سال ۲۰۲۴».",
    "- خط منبع انتها هم تاریخ میلادی است، پس لاتین: «📌 منبع: الجزیره، 10 سپتامبر 2026».",
    "- نیم‌فاصله رعایت شود: می‌شود، نه می شود.",
    "- تاریخ میلادی برای رویداد بین‌المللی. مایل را به کیلومتر تبدیل کن.",
    "- یک تا دو جمله زمینه اضافه کن که خوانندهٔ فارسی‌زبان لازم دارد ولی در متن اصلی نیست.",
    "- انتساب‌های متن اصلی («مقامی که نخواست نامش فاش شود») را حذف نکن.",
    "- متن فارسی معمولاً کوتاه‌تر از اصل است؛ بخش‌های مخصوص مخاطب داخلی آن رسانه را حذف کن.",
    "",
    "در انتهای بدنه، این خط را بیاور:",
    "📌 منبع: [نام رسانه]، [تاریخ میلادی]"
  ];

  if (format === "tahlil") {
    base.push("", "این مورد را به شکل مطلب تحلیلی بلند بنویس: دست‌کم ۴۵۰ کلمه، با زمینه، پیشینه و پیامدها. باز هم فقط متن ساده.");
  } else {
    base.push("", "طول بدنه: ۱۵۰ تا ۳۰۰ کلمه، ۳ تا ۵ پاراگراف.");
  }

  base.push(
    "",
    "اگر خبر با قواعد بالا اصلاً قابل انتشار نیست، به‌جای متن این را برگردان:",
    '{"skip": true, "reason": "دلیل کوتاه"}',
    "",
    "خروجی را فقط و فقط به شکل JSON خام برگردان، بدون ``` و بدون هیچ توضیح اضافه:",
    '{"title": "تیتر فارسی", "body": "متن کامل فارسی با \\n بین پاراگراف‌ها"}'
  );

  return base.join("\n");
}

/* فهرست مدل‌های در دسترسِ همین کلید — تا نام مدل در کد ثابت نباشد */
async function aiListModels(env) {
  if (!env || !env.GEMINI_API_KEY) {
    return { ok: false, error: "GEMINI_API_KEY در تنظیمات Cloudflare ثبت نشده است." };
  }
  try {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, 12000);
    const r = await fetch(AI_GEMINI_BASE + "/models?pageSize=200", {
      signal: ctl.signal,
      headers: { "x-goog-api-key": env.GEMINI_API_KEY }
    });
    clearTimeout(t);
    const data = await r.json();
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : ("خطای " + r.status);
      return { ok: false, error: msg };
    }
    const bad = /embedding|aqa|tts|image|imagen|veo|audio|live|native|learnlm|gemma/i;
    /* مدل‌های بازنشسته هنوز در فهرست گوگل می‌مانند ولی موقع صدا زدن ۴۰۴ می‌دهند.
       نسخه‌های ۱.x و ۲.0 دیگر کار نمی‌کنند، پس از فهرست بیرون می‌مانند. */
    const retired = /^gemini-(1\.|1-|2\.0|2-0)/i;
    const list = [];
    const all = (data && data.models) || [];
    for (let i = 0; i < all.length; i++) {
      const m = all[i];
      const methods = m.supportedGenerationMethods || m.supportedActions || [];
      if (methods.indexOf("generateContent") < 0) continue;
      const id = String(m.name || "").replace(/^models\//, "");
      if (!id || bad.test(id) || retired.test(id)) continue;
      const vm = id.match(/gemini-(\d+)(?:\.(\d+))?/i);
      const ver = vm ? (parseInt(vm[1], 10) * 100 + (vm[2] ? parseInt(vm[2], 10) : 0)) : 0;
      /* رتبه: Flash کامل، بعد Flash-Lite، بعد بقیه.
         Lite سریع‌تر است ولی فارسی‌اش محسوس ضعیف‌تر است. */
      let rank = 2;
      if (/flash/i.test(id)) rank = /lite/i.test(id) ? 1 : 0;
      list.push({ id: id, label: (m.displayName || id) + " — " + id, rank: rank, ver: ver });
    }
    list.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.ver !== b.ver) return b.ver - a.ver;
      return a.id.localeCompare(b.id);
    });
    return { ok: true, models: list };
  } catch (e) {
    return { ok: false, error: "خواندن فهرست مدل‌ها ناموفق بود." };
  }
}

async function aiDraft(env, item, format, model) {
  if (!env || !env.GEMINI_API_KEY) {
    return { ok: false, error: "GEMINI_API_KEY در تنظیمات Cloudflare ثبت نشده است." };
  }
  if (!model) return { ok: false, error: "مدلی انتخاب نشده است." };

  let source = item.summary || "";
  if (item.full) source = item.full;

  const userMsg = [
    "منبع: " + (item.source || "نامشخص"),
    "تاریخ انتشار: " + (item.date || "نامشخص"),
    "تیتر اصلی: " + (item.title || ""),
    "",
    "متن:",
    source
  ].join("\n");

  /* خبر جنگ و اعدام که هیچ — یک خبر عادی دربارهٔ سرشماری آمریکا هم به فیلتر خورد.
     برای متن خبری BLOCK_NONE درست است؛ مسئولیت تحریریه با انسان است، نه با فیلتر گوگل. */
  const safety = [
    "HARM_CATEGORY_HARASSMENT",
    "HARM_CATEGORY_HATE_SPEECH",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    "HARM_CATEGORY_DANGEROUS_CONTENT",
    "HARM_CATEGORY_CIVIC_INTEGRITY"
  ].map(function (c) { return { category: c, threshold: "BLOCK_NONE" }; });

  function aiBody(safetyList) {
    return JSON.stringify({
      systemInstruction: { parts: [{ text: aiSystemPrompt(format) }] },
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      safetySettings: safetyList,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: format === "tahlil" ? 12000 : 7000,
        responseMimeType: "application/json"
      }
    });
  }

  async function aiSend(bodyStr) {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, 55000);
    try {
      const r = await fetch(AI_GEMINI_BASE + "/models/" + encodeURIComponent(model) + ":generateContent", {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: bodyStr
      });
      clearTimeout(t);
      let d = null;
      try { d = await r.json(); } catch (e) { d = null; }
      return { status: r.status, ok: r.ok, data: d };
    } catch (e) {
      clearTimeout(t);
      return { status: 0, ok: false, data: null };
    }
  }

  function aiSleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  try {
    let res = null;
    let body = aiBody(safety);
    /* شلوغی مدل و سقف درخواست در دقیقه هر دو موقتی‌اند — خودمان صبر می‌کنیم
       به‌جای اینکه خطا را جلوی کاربر بگذاریم. سه تلاش، با فاصلهٔ فزاینده. */
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await aiSend(body);
      if (res.ok) break;
      const emsg = (res.data && res.data.error && res.data.error.message) ? String(res.data.error.message) : "";
      /* اگر مدل یکی از دسته‌های ایمنی را نشناسد، بدون آن دسته دوباره می‌فرستیم */
      if (res.status === 400 && /HARM_CATEGORY|safety/i.test(emsg)) {
        body = aiBody(safety.filter(function (s) { return s.category !== "HARM_CATEGORY_CIVIC_INTEGRITY"; }));
        continue;
      }
      const busy = res.status === 429 || res.status === 503 || res.status === 500 || res.status === 0
        || /high demand|overload|unavailable|exhaust/i.test(emsg);
      if (!busy) break;
      if (attempt < 2) await aiSleep(attempt === 0 ? 4000 : 9000);
    }

    const data = res ? res.data : null;
    if (!res || !res.ok) {
      let msg = (data && data.error && data.error.message) ? String(data.error.message).slice(0, 160) : ("خطای " + (res ? res.status : "نامشخص"));
      let busy = false;
      if (res && (res.status === 429 || /exhaust/i.test(msg))) { msg = "سهمیهٔ رایگان این دقیقه پر شد. یک دقیقه صبر کنید، یا از منو مدل دیگری انتخاب کنید."; busy = true; }
      else if (res && (res.status === 503 || res.status === 500 || /high demand|overload|unavailable/i.test(msg))) { msg = "مدل شلوغ است و سه بار تلاش جواب نداد. کمی بعد دوباره بزنید یا مدل دیگری انتخاب کنید."; busy = true; }
      else if (res && res.status === 404) msg = "این مدل برای کلید شما در دسترس نیست. «تست مدل‌ها» را بزنید.";
      else if (res && res.status === 0) { msg = "پاسخی از گوگل نرسید."; busy = true; }
      return { ok: false, error: msg, busy: busy };
    }

    const cand = (data && data.candidates && data.candidates[0]) || null;
    if (!cand) {
      const blocked = data && data.promptFeedback && data.promptFeedback.blockReason;
      return { ok: false, error: blocked ? ("متن ورودی توسط فیلتر گوگل رد شد (" + blocked + ")") : "پاسخی برنگشت." };
    }
    if (cand.finishReason === "SAFETY") {
      return { ok: false, error: "فیلتر ایمنی گوگل این خبر را رد کرد. این خبر را باید دستی بنویسید." };
    }

    let text = "";
    const parts = (cand.content && cand.content.parts) || [];
    for (let i = 0; i < parts.length; i++) {
      /* بخش‌های «فکر کردن» مدل متن نهایی نیستند */
      if (parts[i] && parts[i].thought) continue;
      if (parts[i] && typeof parts[i].text === "string") text += parts[i].text;
    }
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    if (!text) {
      if (cand.finishReason === "MAX_TOKENS") return { ok: false, error: "پاسخ ناتمام ماند (سقف طول). دوباره بزنید." };
      return { ok: false, error: "پاسخ خالی بود." };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const s = text.indexOf("{");
      const p = text.lastIndexOf("}");
      if (s >= 0 && p > s) {
        try { parsed = JSON.parse(text.slice(s, p + 1)); } catch (e2) { parsed = null; }
      }
    }
    if (!parsed) {
      if (cand.finishReason === "MAX_TOKENS") {
        return { ok: false, error: "پاسخ وسط راه قطع شد. دوباره بزنید؛ اگر تکرار شد، تیک «متن کامل خبر» را بردارید.", busy: true };
      }
      return { ok: false, error: "پاسخ مدل قابل خواندن نبود. دوباره بزنید.", busy: true };
    }
    if (parsed.skip) return { ok: true, skip: true, reason: parsed.reason || "قابل انتشار نیست" };
    if (!parsed.title || !parsed.body) return { ok: false, error: "پاسخ مدل ناقص بود." };

    const usage = data.usageMetadata || {};
    return {
      ok: true,
      title: String(parsed.title).trim(),
      body: String(parsed.body).trim(),
      tokens: { in: usage.promptTokenCount || 0, out: usage.candidatesTokenCount || 0 }
    };
  } catch (e) {
    return { ok: false, error: "تماس با API ناموفق بود: " + (e && e.message ? e.message : "نامشخص") };
  }
}

/* --------------------------------------------------------------- routes */

async function aiHandleFeeds(request, env) {
  if (!aiCheckAdmin(request, env)) return aiJson({ ok: false, error: "دسترسی مجاز نیست" }, 401);
  try {
    const data = await aiFetchFeeds();
    return aiJson(data);
  } catch (e) {
    return aiJson({ ok: false, error: "خواندن فیدها ناموفق بود" }, 200);
  }
}

/* فهرست گوگل مدل‌هایی را هم نشان می‌دهد که کلید اجازهٔ صدا زدنشان را ندارد.
   پس به‌جای حدس زدن از روی نام، هر مدل را با یک درخواست یک‌توکنی امتحان می‌کنیم. */
async function aiProbeOne(env, id) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, 15000);
    const r = await fetch(AI_GEMINI_BASE + "/models/" + encodeURIComponent(id) + ":generateContent", {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        generationConfig: { maxOutputTokens: 1 }
      })
    });
    clearTimeout(t);
    if (r.ok) return { id: id, ok: true, note: "سالم" };
    /* ۴۲۹ یعنی مدل هست ولی سهمیهٔ این دقیقه پر است — خرابی نیست */
    if (r.status === 429) return { id: id, ok: true, note: "سالم (سهمیه پر بود)" };
    let msg = "خطای " + r.status;
    try {
      const d = await r.json();
      if (d && d.error && d.error.message) msg = String(d.error.message).slice(0, 120);
    } catch (e) { /* بدنه خوانده نشد */ }
    return { id: id, ok: false, note: msg };
  } catch (e) {
    return { id: id, ok: false, note: "پاسخ نداد" };
  }
}

async function aiHandleProbe(request, env) {
  if (!aiCheckAdmin(request, env)) return aiJson({ ok: false, error: "دسترسی مجاز نیست" }, 401);
  const listed = await aiListModels(env);
  if (!listed.ok) return aiJson(listed);
  /* سقف ۸ تا، هم برای سهمیهٔ رایگان و هم برای محدودیت subrequest ورکر */
  const top = listed.models.slice(0, 8);
  const settled = await Promise.allSettled(top.map(function (m) { return aiProbeOne(env, m.id); }));
  const out = [];
  for (let i = 0; i < settled.length; i++) {
    const res = settled[i].status === "fulfilled"
      ? settled[i].value
      : { id: top[i].id, ok: false, note: "پاسخ نداد" };
    res.label = top[i].label;
    out.push(res);
  }
  return aiJson({ ok: true, results: out });
}

async function aiHandleModels(request, env) {
  if (!aiCheckAdmin(request, env)) return aiJson({ ok: false, error: "دسترسی مجاز نیست" }, 401);
  const res = await aiListModels(env);
  return aiJson(res);
}

async function aiHandleDraft(request, env) {
  if (!aiCheckAdmin(request, env)) return aiJson({ ok: false, error: "دسترسی مجاز نیست" }, 401);
  if (request.method !== "POST") return aiJson({ ok: false, error: "POST لازم است" }, 200);

  let body = null;
  try { body = await request.json(); } catch (e) { return aiJson({ ok: false, error: "ورودی نامعتبر" }, 200); }
  if (!body || !body.title) return aiJson({ ok: false, error: "تیتر خبر ارسال نشده" }, 200);

  const item = {
    title: body.title,
    link: body.link || "",
    summary: body.summary || "",
    date: body.date || "",
    source: body.source || ""
  };

  if (body.useFullText && item.link) {
    const full = await aiFullText(item.link);
    if (full && full.length > (item.summary || "").length) item.full = full;
  }

  const format = body.format === "tahlil" ? "tahlil" : "khabar";

  /* اگر مدل انتخابی شلوغ بود یا سهمیه‌اش پر شد، به‌جای خطا سراغ مدل سالم بعدی می‌رویم.
     ترتیب را پنل می‌فرستد: اول انتخاب کاربر، بعد بقیهٔ مدل‌هایی که در «تست مدل‌ها» سالم بودند. */
  let chain = [];
  if (Array.isArray(body.models)) chain = body.models.filter(function (x) { return typeof x === "string" && x; });
  if (body.model && chain.indexOf(body.model) < 0) chain.unshift(body.model);
  if (!chain.length) return aiJson({ ok: false, error: "مدلی انتخاب نشده است." });
  chain = chain.slice(0, 3);

  let last = null;
  for (let i = 0; i < chain.length; i++) {
    last = await aiDraft(env, item, format, chain[i]);
    if (last.ok) {
      if (i > 0) last.usedModel = chain[i];
      return aiJson(last);
    }
    if (!last.busy) break;
  }
  return aiJson(last);
}

/* ----------------------------------------------------------- the panel */

function aiPanelPage() {
  const html = '<!doctype html><html lang="fa" dir="rtl"><head>'
    + '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow">'
    + '<title>اتاق خبر هوشمند — پالس ایران ۲۴</title>'
    + '<link rel="stylesheet" href="/assets/fonts/vazirmatn.css">'
    + '<style>'
    + ':root{--bg:#0f1115;--card:#171a21;--line:#262b36;--txt:#e8eaed;--dim:#9aa1ad;--red:#e11d2e}'
    + '*{box-sizing:border-box}'
    + 'body{margin:0;background:var(--bg);color:var(--txt);font-family:Vazirmatn,Tahoma,sans-serif;padding:14px;line-height:1.9}'
    + 'h1{font-size:18px;margin:0 0 4px}'
    + '.sub{color:var(--dim);font-size:12px;margin-bottom:14px}'
    + '.bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}'
    + 'input,select,button,textarea{font-family:inherit;font-size:14px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--txt);padding:9px 11px}'
    + 'button{cursor:pointer}'
    + 'button.p{background:var(--red);border-color:var(--red);color:#fff;font-weight:700}'
    + 'button:disabled{opacity:.45;cursor:default}'
    + '.item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px}'
    + '.src{display:inline-block;font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:6px;padding:1px 7px;margin-inline-end:6px}'
    + '.t{font-weight:700;margin:6px 0;font-size:15px}'
    + '.s{color:var(--dim);font-size:13px;margin-bottom:8px}'
    + '.acts{display:flex;gap:7px;flex-wrap:wrap}'
    + '.acts button{font-size:13px;padding:6px 10px}'
    + 'textarea{width:100%;margin-top:8px;min-height:230px;line-height:2.1;resize:vertical}'
    + 'input.tt{width:100%;margin-top:10px;font-weight:700}'
    + '.note{color:var(--dim);font-size:12px;margin-top:6px}'
    + '.err{color:#ff8a8a;font-size:13px;margin-top:6px}'
    + '.ok{color:#6ee7a0}'
    + '</style></head><body>'
    + '<h1>اتاق خبر هوشمند</h1>'
    + '<div class="sub">بازنویسی خبر رسانه‌های مجاز به فارسی، طبق خط‌مشی سایت. خروجی را بررسی و ویرایش کنید، سپس در /admin منتشر کنید.</div>'
    + '<div class="bar">'
    + '<input id="tok" type="password" placeholder="رمز ادمین" style="flex:1;min-width:150px">'
    + '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--dim)">'
    + '<input id="ft" type="checkbox" checked style="width:16px;height:16px;padding:0"> متن کامل خبر</label>'
    + '<select id="fmt"><option value="khabar">خبر عادی</option><option value="tahlil">تحلیل بلند</option></select>'
    + '<select id="mdl" style="min-width:220px;flex:1"><option value="">مدل: پس از ورود</option></select>'
    + '<button class="p" id="load">دریافت خبرها</button>'
    + '<button id="probe">تست مدل‌ها</button>'
    + '</div>'
    + '<div id="msg" class="note"></div>'
    + '<div id="list"></div>'
    + '<script>'
    + 'var TK="";'
    + 'function $(i){return document.getElementById(i)}'
    + 'function seen(){try{return JSON.parse(localStorage.getItem("ai_seen")||"[]")}catch(e){return []}}'
    + 'function mark(l){var s=seen();if(s.indexOf(l)<0){s.push(l);if(s.length>400)s=s.slice(-400);localStorage.setItem("ai_seen",JSON.stringify(s))}}'
    + 'function esc(s){var d=document.createElement("div");d.textContent=s==null?"":s;return d.innerHTML}'
    + 'var ITEMS=[];'
    + 'window.addEventListener("load",function(){var t=localStorage.getItem("ai_tok");if(t){$("tok").value=t}});'
    + '$("load").addEventListener("click",function(){'
    + 'TK=$("tok").value.trim();if(!TK){$("msg").textContent="رمز ادمین را وارد کنید.";return}'
    + 'localStorage.setItem("ai_tok",TK);'
    + '$("msg").textContent="در حال خواندن فیدها...";$("load").disabled=true;'
    + 'loadModels();'
    + 'fetch("/api/ai/feeds",{headers:{"x-admin-token":TK}}).then(function(r){return r.json()}).then(function(d){'
    + '$("load").disabled=false;'
    + 'if(!d.ok){$("msg").textContent=d.error||"خطا";return}'
    + 'var s=seen();ITEMS=d.items.filter(function(x){return s.indexOf(x.link)<0});'
    + '$("msg").textContent=ITEMS.length+" خبر تازه از "+d.count+" مورد دریافت‌شده.";'
    + 'render()}).catch(function(){$("load").disabled=false;$("msg").textContent="اتصال ناموفق بود."})});'
    + '$("probe").addEventListener("click",function(){'
    + 'TK=$("tok").value.trim();if(!TK){$("msg").textContent="رمز ادمین را وارد کنید.";return}'
    + 'localStorage.setItem("ai_tok",TK);'
    + '$("probe").disabled=true;$("msg").textContent="در حال تست مدل‌ها... (تا یک دقیقه)";'
    + 'fetch("/api/ai/probe",{headers:{"x-admin-token":TK}}).then(function(r){return r.json()}).then(function(d){'
    + '$("probe").disabled=false;'
    + 'if(!d.ok){$("msg").textContent=d.error||"خطا";return}'
    + 'var good=[],lines="";'
    + 'for(var i=0;i<d.results.length;i++){var x=d.results[i];'
    + 'lines+=(x.ok?"✅ ":"❌ ")+x.id+" — "+x.note+"\\n";if(x.ok)good.push(x)}'
    + '$("msg").style.whiteSpace="pre-line";$("msg").textContent=lines;'
    + 'if(!good.length){return}'
    + 'var s=$("mdl"),h="";'
    + 'for(var j=0;j<good.length;j++){h+=\'<option value="\'+esc(good[j].id)+\'">\'+esc(good[j].label)+\'</option>\'}'
    + 's.innerHTML=h;localStorage.setItem("ai_model",s.value);'
    + 's.onchange=function(){localStorage.setItem("ai_model",s.value)};'
    + '}).catch(function(){$("probe").disabled=false;$("msg").textContent="اتصال ناموفق بود."})});'
    + 'function allModels(){var s=$("mdl"),o=[];if(s.value)o.push(s.value);'
    + 'for(var i=0;i<s.options.length;i++){var v=s.options[i].value;if(v&&o.indexOf(v)<0)o.push(v)}return o}'
    + 'function loadModels(){'
    + 'fetch("/api/ai/models",{headers:{"x-admin-token":TK}}).then(function(r){return r.json()}).then(function(d){'
    + 'var s=$("mdl");'
    + 'if(!d.ok){s.innerHTML=\'<option value="">\'+esc(d.error)+\'</option>\';return}'
    + 'var saved=localStorage.getItem("ai_model")||"";var h="";'
    + 'for(var i=0;i<d.models.length;i++){var m=d.models[i];'
    + 'h+=\'<option value="\'+esc(m.id)+\'">\'+esc(m.label)+\'</option>\'}'
    + 's.innerHTML=h;'
    + 'if(saved){for(var j=0;j<s.options.length;j++){if(s.options[j].value===saved){s.selectedIndex=j;break}}}'
    + 's.onchange=function(){localStorage.setItem("ai_model",s.value)};'
    + 'if(!saved&&s.value)localStorage.setItem("ai_model",s.value);'
    + '}).catch(function(){})}'
    + 'function render(){'
    + 'var h="";for(var i=0;i<ITEMS.length;i++){var it=ITEMS[i];'
    + 'h+=\'<div class="item" id="it\'+i+\'">\';'
    + 'h+=\'<span class="src">\'+esc(it.source)+\'</span><a href="\'+esc(it.link)+\'" target="_blank" rel="noopener noreferrer" style="color:#7aa7ff;font-size:12px">اصل خبر</a>\';'
    + 'h+=\'<div class="t">\'+esc(it.title)+\'</div>\';'
    + 'h+=\'<div class="s">\'+esc((it.summary||"").slice(0,220))+\'</div>\';'
    + 'h+=\'<div class="acts"><button onclick="draft(\'+i+\')" id="b\'+i+\'">بازنویسی فارسی</button>\';'
    + 'h+=\'<button onclick="hide(\'+i+\')">رد کردن</button></div>\';'
    + 'h+=\'<div id="o\'+i+\'"></div></div>\'}'
    + '$("list").innerHTML=h}'
    + 'function hide(i){mark(ITEMS[i].link);var e=$("it"+i);if(e)e.remove()}'
    + 'function draft(i){'
    + 'if(!$("mdl").value){$("msg").textContent="اول یک مدل انتخاب کنید.";return}'
    + 'if(window.__aiBusy){$("msg").textContent="یک بازنویسی در حال اجراست. سهمیهٔ رایگان اجازهٔ چند درخواست همزمان نمی‌دهد.";return}'
    + 'window.__aiBusy=true;'
    + 'var b=$("b"+i);b.disabled=true;b.textContent="در حال نوشتن...";'
    + 'var it=ITEMS[i];'
    + 'fetch("/api/ai/draft",{method:"POST",headers:{"content-type":"application/json","x-admin-token":TK},'
    + 'body:JSON.stringify({title:it.title,link:it.link,summary:it.summary,date:it.date,source:it.source,'
    + 'useFullText:$("ft").checked,format:$("fmt").value,model:$("mdl").value,models:allModels()})})'
    + '.then(function(r){return r.json()}).then(function(d){'
    + 'window.__aiBusy=false;b.disabled=false;b.textContent="بازنویسی دوباره";'
    + 'var o=$("o"+i);'
    + 'if(!d.ok){o.innerHTML=\'<div class="err">\'+esc(d.error)+\'</div>\';return}'
    + 'if(d.skip){o.innerHTML=\'<div class="err">این خبر منتشر نشود: \'+esc(d.reason)+\'</div>\';return}'
    + 'var html=\'<input class="tt" id="ti\'+i+\'" value="\'+esc(d.title)+\'">\';'
    + 'html+=\'<div class="note">طول تیتر: \'+d.title.length+\' کاراکتر (سقف ۱۱۰)</div>\';'
    + 'html+=\'<textarea id="bo\'+i+\'"></textarea>\';'
    + 'html+=\'<div class="acts" style="margin-top:8px"><button onclick="cp(\\\'ti\'+i+\'\\\',this)">کپی تیتر</button>\';'
    + 'html+=\'<button onclick="cp(\\\'bo\'+i+\'\\\',this)">کپی متن</button>\';'
    + 'html+=\'<button onclick="window.open(\\\'/admin\\\',\\\'_blank\\\')">باز کردن پنل انتشار</button></div>\';'
    + 'html+=\'<div class="note">مصرف: \'+d.tokens.in+\' ورودی / \'+d.tokens.out+\' خروجی\'+(d.usedModel?\' — با مدل جایگزین: \'+esc(d.usedModel):\'\')+\'</div>\';'
    + 'o.innerHTML=html;$("bo"+i).value=d.body;'
    + '}).catch(function(){window.__aiBusy=false;b.disabled=false;b.textContent="بازنویسی فارسی";$("o"+i).innerHTML=\'<div class="err">اتصال ناموفق بود.</div>\'})}'
    + 'function cp(id,btn){var el=$(id);el.select();'
    + 'navigator.clipboard.writeText(el.value).then(function(){btn.textContent="کپی شد";btn.className="ok";'
    + 'setTimeout(function(){btn.textContent=id.indexOf("ti")===0?"کپی تیتر":"کپی متن";btn.className=""},1500)})}'
    + '</script></body></html>';

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow"
    }
  });
}

/* ===================== END AI NEWSROOM MODULE ===================== */
