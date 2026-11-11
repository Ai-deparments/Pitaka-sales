#!/usr/bin/env node
// Pitaka Sales — HTTP server. Tashqi paket yo'q, faqat Node stdlib.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

import { Bitrix } from "./lib/bitrix.mjs";
import { dealRoom } from "./lib/dealroom.mjs";
import * as api from "./lib/api.mjs";
import * as hyg from "./lib/hygiene.mjs";
import * as calls from "./lib/calls.mjs";
import * as cstore from "./lib/callstore.mjs";
import * as crun from "./lib/callrun.mjs";
import * as cllm from "./lib/callllm.mjs";
import * as cpipe from "./lib/pipeline.mjs";
import * as tel from "./lib/telephony.mjs";
import * as stt from "./lib/stt.mjs";
import * as rng from "./lib/range.mjs";
import * as dir from "./lib/directory.mjs";
import * as rules from "./lib/rules.mjs";
import * as scoring from "./lib/scoring.mjs";
import * as sla from "./lib/sla.mjs";
import * as bxmod from "./lib/bitrix.mjs";   // AC-41: chaqiruv statistikasi
import * as qoriqchi from "./lib/qoriqchi.mjs";
import * as auth from "./lib/auth.mjs";
import * as totp from "./lib/totp.mjs";
import * as RL from "./lib/roles.mjs";
import * as sifat from "./lib/sifat.mjs";     // AI lid sifati
import * as voronka from "./lib/voronka.mjs"; // sotuv voronkasi (TZ «Sales OS» 2-bosqich)
import * as nazorat from "./lib/nazorat.mjs"; // Pitaka: CRM vs suhbat (KVAL) va menejerlar qoidabuzarliklari
import * as murabbiy from "./lib/murabbiy.mjs"; // Telegram «shaxsiy murabbiy» (2026-09-30)
import * as olchov from "./lib/olchov.mjs";     // v2: yagona ko'rsatkichlar (2026-10-03)
import { cached, stats as cacheStats, invalidate } from "./lib/cache.mjs";
import * as autoagent from "./lib/autoagent.mjs"; // scheduled call-worker: calls are analysed automatically

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || "127.0.0.1";
const DB_PATH = process.env.SOTUV_DB || path.join(HERE, "data", "sotuv.db");
const PUBLIC = path.join(HERE, "public");
// Versiya belgisi: index.html ning mtime + hajmi. Har API javobida `x-build` sarlavhasi
// bilan qaytadi — ochiq tab yangi deploy chiqqanini shu orqali sezib o'zini qayta yuklaydi.
// Ilgari deploydan keyin ochiq tab eski kod bilan ishlayverardi (masalan, mavzu tuzatishi
// ko'rinmasdi). Fayl 15 soniyada bir marta tekshiriladi.
let _build = { at: 0, id: "0" };
function buildId() {
  const now = Date.now();
  if (now - _build.at > 15000) {
    try {
      const st = fs.statSync(path.join(PUBLIC, "index.html"));
      _build = { at: now, id: `${Math.floor(st.mtimeMs)}-${st.size}` };
    } catch { _build = { at: now, id: "0" }; }
  }
  return _build.id;
}

// ---- .env ----
for (const f of [path.join(HERE, ".env"), "/home/claude/secrets/bitrix-sotuv.env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.BITRIX_WEBHOOK_URL) { console.error("XATO: BITRIX_WEBHOOK_URL topilmadi"); process.exit(1); }

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 4000;");
// Bazada sessiya tokenlari va parol xeshlari bor — faqat egasi o'qiy olsin.
for (const f of [DB_PATH, DB_PATH + "-wal", DB_PATH + "-shm"]) {
  try { if (fs.existsSync(f)) fs.chmodSync(f, 0o600); } catch {}
}
try { fs.chmodSync(path.dirname(DB_PATH), 0o700); } catch {}
auth.initSchema(db);
sifat.initSifat(db);   // AI lid sifati (kunlik hisobot «Sifatli / Sifatsiz»)

// AC-34: auditga oldingi/keyingi qiymat, kanal va correlation ID qo'shildi.
// Mavjud bazaga ALTER bilan qo'shiladi; ustun allaqachon bo'lsa xato yutiladi.
for (const c of ["before_val TEXT", "after_val TEXT", "cid TEXT", "channel TEXT"]) {
  try { db.prepare(`ALTER TABLE audit_events ADD COLUMN ${c}`).run(); } catch {}
}
// AC-46: xatolar javobdagi trace_id bilan BIR XIL cid ostida saqlanadi.
db.exec(`
  CREATE TABLE IF NOT EXISTS error_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    cid TEXT, actor TEXT, method TEXT, route TEXT,
    status INTEGER, code TEXT, message TEXT, stack TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_err_at ON error_events(at DESC);
  CREATE INDEX IF NOT EXISTS idx_err_cid ON error_events(cid);
`);

cstore.initCallSchema(db);
murabbiy.init(db);

const bx = new Bitrix(process.env.BITRIX_WEBHOOK_URL);

// ---- yordamchilar ----
// AC-29: har xato {code,message,details,trace_id} ko'rinishida.
// AC-46: har javobda X-Correlation-ID — frontend, backend va bot bitta ID bilan bog'lanadi.
const json = (res, code, body, cid) => {
  const s = JSON.stringify(body);
  const h = {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(s),
    "cache-control": "no-store",
    "x-build": buildId(),
  };
  if (cid) h["x-correlation-id"] = cid;
  res.writeHead(code, h);
  res.end(s);
};
// Sinov nusxasini jonlidan ajratish uchun — brauzerda ogohlantirish chizig'i chiqadi.
const ENVNAME = process.env.SOTUV_ENV || "live";

const ERRCODE = {
  400: "bad_request", 401: "unauthenticated", 403: "forbidden", 404: "not_found",
  405: "method_not_allowed",
  409: "conflict", 413: "payload_too_large", 429: "rate_limited", 500: "internal_error", 502: "upstream_error",
};
const fail = (res, code, message, cid, details) => {
  // AC-46: javobdagi trace_id bilan BIR XIL cid ostida saqlanadi.
  try {
    const rq = res.req || {};
    db.prepare("INSERT INTO error_events (cid,actor,method,route,status,code,message,stack) VALUES (?,?,?,?,?,?,?,?)")
      .run(cid || null, res.__actor || null, rq.method || null,
           String(rq.url || "").split("?")[0].slice(0, 200), code,
           ERRCODE[code] || "error", String(message || "").slice(0, 500),
           res.__stack ? String(res.__stack).slice(0, 2000) : null);
    // Jadval cheksiz o'smasin: internetga ochiq panelda skanerlar ko'p 401 hosil qiladi.
    if (Math.random() < 0.02) {
      db.prepare("DELETE FROM error_events WHERE id <= (SELECT MAX(id) - 5000 FROM error_events)").run();
    }
  } catch {}
  return json(res, code, { code: ERRCODE[code] || "error", message, details: details || null, trace_id: cid }, cid);
};
const AUDIO_CACHE = new Map();   // call id -> {buf,type,at} — qayta tinglashda onlinePBX'ga qayta bormaymiz
const readBody = (req, limit = 64 * 1024) => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on("data", (c) => {
    n += c.length;
    if (n > limit) { const e = new Error("So'rov juda katta"); e.status = 413; req.pause(); reject(e); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
    catch { const e = new Error("So'rov tanasi noto'g'ri JSON"); e.status = 400; reject(e); }
  });
  req.on("error", reject);
});
// nginx X-Real-IP ni $remote_addr dan QAYTA YOZADI — bu qiymatga ishonsa bo'ladi.
// X-Forwarded-For esa mijoz yuborganiga nginx o'zinikini QO'SHADI, ya'ni birinchi
// qiymat soxtalashtiriladi: IP bo'yicha qulf chetlab o'tilar, audit va login-alerts
// aldanardi. Shu sababli faqat X-Real-IP (yoki to'g'ridan-to'g'ri socket) o'qiladi.
const clientIp = (req) => String(req.headers["x-real-ip"] || req.socket.remoteAddress || "?")
  .trim().slice(0, 45);
// Buzuq %-kodlangan cookie (masalan boshqa saytdan qolgan) decodeURIComponent'da
// yiqilib, hatto login sahifasini ham 500 qilardi — endi xom holicha qoladi.
const decCookie = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => {
  const i = c.indexOf("="); return i < 0 ? [c.trim(), ""] : [c.slice(0, i).trim(), decCookie(c.slice(i + 1))];
}).filter(([k]) => k));

// Foydalanuvchi bergan sonni xavfsiz oraliqqa keltiradi (manfiy/NaN/ulkan qiymatlar)
const clampInt = (v, def, min, max) => {
  // Parametr berilmasa (null/undefined/bo'sh satr) — standart qiymat. Number(null) = 0
  // bo'lgani uchun ilgari `def` hech qachon ishlamay, natija `min` ga qisilardi:
  // ?limit yo'q -> 1 ta yozuv (2026-10-27 audit).
  if (v === null || v === undefined || String(v).trim() === "") return def;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif" };

// cid so'rov ichida tug'iladi — uni parametr sifatida olamiz. Aks holda 404/403
// yo'lida ReferenceError tashlanib, oddiy "topilmadi" ichki xatoga aylanadi.
function serveStatic(res, rel, cid) {
  const file = path.join(PUBLIC, rel.replace(/^\/+/, ""));
  if (!file.startsWith(PUBLIC)) return fail(res, 403, "Taqiqlangan", cid);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return fail(res, 404, "Topilmadi", cid);
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] || "application/octet-stream",
    "content-length": body.length,
    "cache-control": rel.endsWith(".html") || rel === "/" ? "no-cache" : "public, max-age=300",
  });
  res.end(body);
}

// ---- router ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  // /api/v1/... va /api/... bir xil ishlaydi — eski mijozlar buzilmaydi
  const rawPath = url.pathname;
  const p = rawPath.startsWith("/api/v1/") ? "/api/" + rawPath.slice(8) : rawPath;
  const q = url.searchParams;
  const cid = String(req.headers["x-correlation-id"] || "").slice(0, 64) || randomBytes(8).toString("hex");
  res.setHeader("x-correlation-id", cid);

  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");
  res.setHeader("x-frame-options", "DENY");
  // HSTS ilovaning o'zidan ham: teskari proksi (Caddy/nginx) almashsa ham sarlavha yo'qolmaydi.
  res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  res.setHeader("permissions-policy", "geolocation=(), microphone=(), camera=(), payment=()");
  res.setHeader("cross-origin-opener-policy", "same-origin");
  res.setHeader("content-security-policy",
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +           // frontend bitta faylda inline
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data:; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");

  try {
    // ---- ochiq endpointlar ----
    // Ichki holat faqat kirgan rahbarга; tashqi so'rovga minimal javob.
    if (p === "/healthz") {
      const u0 = auth.userFromToken(db, cookies(req).sd_session);
      return json(res, 200, u0 && RL.FULL_VIEW.includes(u0.role)
        ? { ok: true, cache: cacheStats(), uptime: Math.round(process.uptime()), agent: autoagent.status() }
        : { ok: true });
    }

    if (p === "/api/login" && req.method === "POST") {
      const { login, password, code } = await readBody(req);
      const key = String(login || "").toLowerCase().slice(0, 64);
      const ipKey = "ip:" + clientIp(req), loginKey = "login:" + key;
      for (const sc of [ipKey, loginKey]) {
        const l = auth.checkLock(db, sc);
        if (l.locked) {
          db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
            .run(key || "?", "login.locked", sc, `${l.left} daqiqa qoldi`);
          return fail(res, 429, `Juda ko'p urinish. ${l.left} daqiqadan keyin qayta urining.`, cid);
        }
      }
      const row = db.prepare("SELECT * FROM users WHERE login = ?").get(key);
      // Login topilmasa ham scrypt ishlaydi (DUMMY_HASH) — javob vaqti bir xil, nom bilib olinmaydi
      const passOk = auth.verifyPassword(String(password || ""), row ? row.pass : auth.DUMMY_HASH);
      if (!row || !passOk) {
        const nIp = auth.noteFail(db, ipKey, 20);      // bir IP dan 20 urinish
        auth.noteFail(db, loginKey, 6);                // bitta login bo'yicha 6 urinish
        db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
          .run(key || "?", "login.fail", clientIp(req), `urinish #${nIp}`);
        return fail(res, 401, "Login yoki parol noto'g'ri", cid);
      }
      // ---- Majburiy 2FA: rahbar roli 2FA'siz kira olmaydi ----
      if (MFA_REQUIRED_ROLES.includes(row.role) && !row.totp_enabled && mfaRequired(db)) {
        db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
          .run(key, "login.mfa_missing", row.role, "2FA yoqilmagan");
        return json(res, 401, { code: "mfa_setup_required",
          message: "Bu rol uchun ikki bosqichli kirish majburiy. Administratordan 2FA yoqishni so'rang.",
          trace_id: cid });
      }
      // ---- ikkinchi bosqich: TOTP ----
      if (row.totp_enabled) {
        const given = String(code || "").trim();
        if (!given) return json(res, 401, { code: "mfa_required", message: "Tasdiqlash kodini kiriting", trace_id: cid });
        let ok = false, note = "";
        const v = totp.verify(row.totp_secret, given, { lastStep: row.totp_last_step || 0 });
        if (v.ok) {
          ok = true; note = "totp";
          db.prepare("UPDATE users SET totp_last_step = ? WHERE id = ?").run(v.step, row.id);
        } else {
          // zaxira kod bo'lishi mumkin — bir marta ishlaydi
          let left = [];
          try { left = JSON.parse(row.totp_backup || "[]"); } catch {}
          const h = totp.hashCode(given);
          if (left.includes(h)) {
            ok = true; note = "backup";
            db.prepare("UPDATE users SET totp_backup = ? WHERE id = ?")
              .run(JSON.stringify(left.filter((x) => x !== h)), row.id);
          }
        }
        if (!ok) {
          auth.noteFail(db, ipKey, 20);
          auth.noteFail(db, loginKey, 6);
          db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
            .run(row.login, "login.mfa_fail", clientIp(req), null);
          return json(res, 401, { code: "mfa_invalid", message: "Tasdiqlash kodi noto'g'ri", trace_id: cid });
        }
        db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
          .run(row.login, "login.mfa_ok", clientIp(req), note);
      }
      auth.clearFails(db, ipKey, loginKey);
      db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
        .run(row.login, "login.ok", clientIp(req), null);
      const { token } = auth.createSession(db, row.id);
      res.setHeader("set-cookie",
        `sd_session=${token}; HttpOnly; Path=/; Max-Age=43200; SameSite=Lax${url.protocol === "https:" || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`);
      // Login javobi /api/me bilan bir xil maydonlarni beradi — boot() shu obyekt bilan ishlaydi,
      // passByAdmin bo'lmasa birinchi kirishda parol eslatmasi chiqmay qolardi.
      return json(res, 200, { user: { name: row.name, role: row.role, login: row.login, mfa: !!row.totp_enabled,
                                      bitrixUserId: row.bitrix_user_id || null, passByAdmin: row.pass_set_by === "admin",
                                      caps: RL.caps(row.role) },
                              env: ENVNAME });
    }

    // ---- sessiya ----
    const token = cookies(req).sd_session;
    const user = auth.userFromToken(db, token);

    if (p === "/api/logout" && req.method === "POST") {
      auth.destroySession(db, token);
      res.setHeader("set-cookie", "sd_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
      return json(res, 200, { ok: true });
    }
    if (p === "/api/me")
      return user ? json(res, 200, { user: { ...user, caps: RL.caps(user.role) }, env: ENVNAME })
                  : json(res, 401, { code: "unauthenticated", message: "Kirilmagan", env: ENVNAME, trace_id: cid }, cid);

    // ---- Parolni o'zgartirish, 1-qadam: login + joriy parol tasdig'i (menyudagi bo'lim).
    // Faqat tasdiqdan keyin yangi parol so'raladi. Urinishlar login bo'yicha sanaladi:
    // 6 xato → 15 daqiqa qulf (kirishdagi bilan bir xil qoida), qulf shu yerda tekshiriladi.
    if (p === "/api/me/passwd/check" && req.method === "POST") {
      if (!user) return fail(res, 401, "Kirilmagan", cid);
      const lk = auth.checkLock(db, "login:" + user.login);
      if (lk.locked) return fail(res, 429, `Juda ko'p urinish. ${lk.left} daqiqadan keyin qayta urining.`, cid);
      const { login, currentPassword } = await readBody(req);
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      if (!row) return fail(res, 404, "Foydalanuvchi topilmadi", cid);
      const givenLogin = String(login || "").trim().toLowerCase();
      if (givenLogin !== row.login) {
        auth.noteFail(db, "login:" + user.login, 6);
        db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
          .run(user.login, "me.passwd.fail", null, "login mos emas");
        return fail(res, 400, "Login sizning hisobingizga mos kelmadi", cid);
      }
      if (!auth.verifyPassword(String(currentPassword || ""), row.pass)) {
        const n = auth.noteFail(db, "login:" + user.login, 6);
        db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
          .run(user.login, "me.passwd.fail", null, `joriy parol noto'g'ri (${n})`);
        // 403, 401 EMAS: klient kirgan holatdagi har 401 ni "sessiya tugadi" deb tushunib,
        // foydalanuvchini kirish oynasiga chiqarib yuborardi.
        return fail(res, 403, "Joriy parol noto'g'ri", cid);
      }
      return json(res, 200, { ok: true, login: row.login }, cid);
    }

    // ---- Foydalanuvchi o'z parolini o'zi o'zgartirishi (rahbar yaratgan login bilan
    // kirgan xodim ichidan o'zi o'zgartira oladi) ----
    if (p === "/api/me/passwd" && req.method === "POST") {
      if (!user) return fail(res, 401, "Kirilmagan", cid);
      const lk = auth.checkLock(db, "login:" + user.login);
      if (lk.locked) return fail(res, 429, `Juda ko'p urinish. ${lk.left} daqiqadan keyin qayta urining.`, cid);
      const { login, currentPassword, newPassword } = await readBody(req);
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      if (!row) return fail(res, 404, "Foydalanuvchi topilmadi", cid);
      // Login berilgan bo'lsa — o'zinikiga mos bo'lishi shart (menyu bo'limi shunday yuboradi)
      if (login !== undefined && String(login || "").trim().toLowerCase() !== row.login)
        return fail(res, 400, "Login sizning hisobingizga mos kelmadi", cid);
      // Joriy parolni tekshirish — shartsiz. Boshqa birov o'zgartirib qo'ya olmasligi uchun.
      if (!auth.verifyPassword(String(currentPassword || ""), row.pass)) {
        auth.noteFail(db, "login:" + user.login, 6);
        db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
          .run(user.login, "me.passwd.fail", null, "joriy parol noto'g'ri");
        // 403, 401 EMAS: klient kirgan holatdagi har 401 ni "sessiya tugadi" deb tushunib,
        // foydalanuvchini kirish oynasiga chiqarib yuborardi.
        return fail(res, 403, "Joriy parol noto'g'ri", cid);
      }
      const np = String(newPassword || "");
      if (np.length < MIN_PASS) {
        db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
          .run(user.login, "me.passwd.fail", null, `juda qisqa (${np.length})`);
        return fail(res, 400, `Yangi parol kamida ${MIN_PASS} belgi bo'lishi kerak`, cid);
      }
      if (np.length > 128) return fail(res, 400, "Parol 128 belgidan oshmasligi kerak", cid);
      // Parol o'zgarmasdan qolsa ham xato qilmaymiz — faqat yangilaymiz.
      db.prepare("UPDATE users SET pass = ?, pass_set_by = 'self' WHERE id = ?").run(auth.hashPassword(np), row.id);
      // Joriy sessiyadan tashqari hammasini bekor qilamiz (xavfsizlik: boshqa qurilmalar chiqadi)
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(user.id, token);
      auth.clearFails(db, "login:" + user.login);
      db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
        .run(user.login, "me.passwd.ok", null, "foydalanuvchi o'zi o'zgartirdi");
      return json(res, 200, { ok: true, revokedOthers: true }, cid);
    }


    if (p === "/api/logout-all" && req.method === "POST") {
      if (!user) return fail(res, 401, "Kirilmagan", cid);
      const n = auth.revokeAll(db, user.id);
      db.prepare("INSERT INTO audit_events (actor,action,entity,detail,cid,channel) VALUES (?,?,?,?,?,?)")
        .run(user.login, "session.revoke_all", null, `${n} ta sessiya`, cid, "web");
      res.setHeader("set-cookie", "sd_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
      return json(res, 200, { revoked: n });
    }

    // statik fayllar login talab qilmaydi (login sahifasi ham shu yerda)
    if (!p.startsWith("/api/")) {
      if (p === "/" || p === "/index.html") return serveStatic(res, "index.html", cid);
      return serveStatic(res, p, cid);
    }

    if (!user) return fail(res, 401, "Kirilmagan", cid);

    // AC-27: Idempotency-Key bo'lsa — bir xil so'rov qayta bajarilmaydi, saqlangan javob qaytadi
    const idemKey = String(req.headers["idempotency-key"] || "").slice(0, 128);
    let idemStore = null;
    if (idemKey && req.method === "POST") {
      db.prepare("DELETE FROM idempotency WHERE created_at < ?").run(Date.now() - 24 * 3600e3);
      const hit = db.prepare("SELECT status, body FROM idempotency WHERE key=? AND route=? AND user_id=?")
        .get(idemKey, p, user.id);
      if (hit) {
        res.setHeader("idempotent-replay", "true");
        return json(res, hit.status, JSON.parse(hit.body), cid);
      }
      idemStore = (status, body) => {
        try { db.prepare("INSERT OR REPLACE INTO idempotency (key,route,user_id,status,body,created_at) VALUES (?,?,?,?,?,?)")
          .run(idemKey, p, user.id, status, JSON.stringify(body), Date.now()); } catch {}
      };
    }
    // Yozuv amallari shu orqali javob qaytaradi — Idempotency-Key bo'lsa saqlanadi
    const okWrite = (status, body) => { idemStore?.(status, body); return json(res, status, body, cid); };
    // Rollar (lib/roles.mjs, 2026-09-23): ceo/direktor/rahbar — to'liq; admin — hammasini ko'radi va
    // to'g'rilaydi; sotuvchi/b2b — o'z lid/bitimlari; operator — o'z lidlari va qo'ng'iroqlari.
    const LEADER = RL.FULL_VIEW;
    const deny = (roles) => {
      if (roles.includes(user.role)) return false;
      fail(res, 403, "Bu bo'lim sizning rolingiz uchun ochiq emas", cid);
      return true;
    };
    const ownerOnly = () => deny(LEADER);
    // TZ §5.2: sotuvchi faqat o'ziga biriktirilgan lead/deal/accountlarni ko'radi.
    // CRM ID bog'lanmagan bo'lsa — hech narsa ko'rmaydi (ochiq qoldirishdan xavfsizroq).
    const SELLER = RL.SELLER;
    // Ma'lumot doirasi: null — hammasi; "<id>" — sotuvchi (mas'ul); "op:<id>" — operator («Оператор» maydoni)
    const mine = RL.scopeOf(user);
    const mineCall = RL.callOwner(mine);   // qo'ng'iroq egasi: operator ham, sotuvchi ham — o'z ID si
    // AC-34: chg = { before, after } — o'zgarishning ikki holati. Parol
    // qiymatlari bu yerga HECH QACHON berilmaydi, faqat fakt yoziladi.
    res.__actor = user.login;   // AC-46: xato jurnalida kim ekani ko'rinsin
    const audit = (action, entity, detail, chg) => {
      const j = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
      try {
        db.prepare("INSERT INTO audit_events (actor,action,entity,detail,before_val,after_val,cid,channel) VALUES (?,?,?,?,?,?,?,?)")
          .run(user.login, action, entity || null, detail || null,
               j(chg && chg.before), j(chg && chg.after), cid, "web");
      } catch {}
    };

    // ---- Xodimlar (faqat rahbarlar) ----
    // CLI'dagi adduser/passwd/role/deluser amallari veb-panelga chiqarildi.
    // Parol faqat YARATILGANDA yoki TIKLANGANDA bir marta qaytariladi —
    // bazada scrypt xesh saqlanadi, qayta ko'rsatib bo'lmaydi.
    if (p === "/api/users" || p.startsWith("/api/users/")) {
      if (!user) return fail(res, 401, "Kirilmagan", cid);
      if (deny(RL.USER_ADMIN)) return;   // rahbarlar + administrator (egasi 2026-09-23: «admin — to'g'rilash uchun»)

      const listUsers = () => db.prepare(
        "SELECT id, login, name, role, bitrix_user_id, totp_enabled, created_at FROM users ORDER BY id"
      ).all().map((r) => ({
        id: r.id, login: r.login, name: r.name, role: r.role,
        bitrixUserId: r.bitrix_user_id, mfa: !!r.totp_enabled, createdAt: r.created_at,
      }));

      const findLogin = (l) => db.prepare("SELECT * FROM users WHERE login = ?")
        .get(String(l || "").toLowerCase().trim());
      const genPass = () => randomBytes(12).toString("base64url");

      if (p === "/api/users" && req.method === "GET") {
        return json(res, 200, { users: listUsers(), roles: ROLES, labels: RL.LABEL }, cid);
      }

      // CRM (Bitrix) foydalanuvchilari — xodimni bog'lash uchun tanlov ro'yxati. Oxirgi 90 kunda
      // «Оператор (Авто танланади)» sifatida lid olganlar alohida belgilanadi (operator roliga shu kerak).
      if (p === "/api/users/crm" && req.method === "GET") {
        const out = await cached("users:crm", 10 * 60e3, async () => {
          const r = await bx.call("user.get", {}).catch(() => ({ result: [] }));
          const opSon = new Map();
          try {
            const R90 = rng.normalize(90);
            const { items } = await bx.listAll("crm.lead.list", { filter: { ">=DATE_CREATE": R90.fromISO },
              select: ["ID", "UF_CRM_OPERATOR"], order: { DATE_CREATE: "DESC" }, maxItems: 6000 });
            for (const l of items) if (l.UF_CRM_OPERATOR) opSon.set(String(l.UF_CRM_OPERATOR), (opSon.get(String(l.UF_CRM_OPERATOR)) || 0) + 1);
          } catch {}
          return (r.result || []).filter((u) => u.ACTIVE !== false && Number(u.ID) < 900000)
            .map((u) => ({ id: String(u.ID), name: `${u.NAME || ""} ${u.LAST_NAME || ""}`.trim() || `#${u.ID}`,
                           operatorLeads: opSon.get(String(u.ID)) || 0 }))
            .sort((a, b) => (b.operatorLeads > 0) - (a.operatorLeads > 0) || a.name.localeCompare(b.name));
        });
        return json(res, 200, { users: out }, cid);
      }

      // Brauzer manzil satridan ochilganda (GET) 405 to'g'ri javob — lekin sababi
      // ko'rinib turishi kerak, aks holda "Method not allowed" nosozlikka o'xshaydi.
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        return fail(res, 405, `Bu endpoint faqat POST qabul qiladi: POST ${p}`, cid,
          { allow: ["POST"], hint: "Xodim qo'shish panel orqali: Xodimlar → Yangi xodim → Qo'shish" });
      }
      const b = await readBody(req);

      if (p === "/api/users/create") {
        const login = String(b.login || "").toLowerCase().trim();
        const name = String(b.name || "").trim();
        const role = String(b.role || "").trim();
        if (!/^[a-z0-9._-]{3,32}$/.test(login))
          return fail(res, 400, "Login 3-32 belgi: kichik harf, raqam, . _ -", cid);
        if (!name) return fail(res, 400, "Ism kerak", cid);
        if (!ROLES.includes(role)) return fail(res, 400, `Rol noto'g'ri. Mumkin: ${ROLES.join(", ")}`, cid);
        // F-04: imtiyoz oshirishning oldini olish — rahbar/admin imtiyozli (leader/admin) hisob yarata olmaydi
        if (!RL.SUPERADMIN.includes(user.role) && RL.PRIVILEGED.includes(role))
          return fail(res, 403, "Bu rolni faqat CEO yoki ega tayinlay oladi", cid);

        // 409 — band login. Kim egallaganini ham aytamiz: quruq "allaqachon bor"
        // xabaridan keyin foydalanuvchi sababni topa olmay tugmani qayta bosaveradi.
        const taken = (row) => fail(res, 409,
          `«${login}» logini band${row?.name ? ` — ${row.name} hisobiga tegishli` : ""}. Boshqa login tanlang.`,
          cid, { reason: "user_exists", login, takenBy: row?.name || null });

        const clash = findLogin(login);
        if (clash) {
          // Parol hech qachon log'ga tushmaydi — faqat login va so'rovchi yoziladi.
          console.warn(`[${new Date().toISOString()}] cid=${cid} user.create rad etildi: «${login}» band (so'rovchi=${user.login})`);
          return taken(clash);
        }

        const pass = genPass();
        try {
          // pass_set_by='admin': xodim kirganda parolni o'zi almashtirishi eslatiladi
          db.prepare("INSERT INTO users (login,name,role,pass,bitrix_user_id,pass_set_by) VALUES (?,?,?,?,?,'admin')")
            .run(login, name, role, auth.hashPassword(pass), b.bitrixUserId ? String(b.bitrixUserId) : null);
        } catch (e) {
          // CLI (alohida jarayon) shu bazaga yozadi — tekshiruvdan keyin login band
          // bo'lib qolishi mumkin. UNIQUE cheklovi ushlab qoldi: bu 500 emas, 409.
          if (/UNIQUE constraint/i.test(e.message || "")) return taken(findLogin(login));
          throw e;
        }
        audit("user.create", login, `rol=${role}`,
          { before: null, after: { login, name, role, bitrixUserId: b.bitrixUserId || null } });
        return okWrite(200, { ok: true, login, password: pass });
      }

      if (p === "/api/users/passwd") {
        const row = findLogin(b.login);
        if (!row) return fail(res, 404, "Foydalanuvchi topilmadi", cid);
        // F-04: imtiyozli hisob parolini tiklash = hisobni egallab olish — faqat CEO/ega
        if (!RL.SUPERADMIN.includes(user.role) && RL.PRIVILEGED.includes(row.role))
          return fail(res, 403, "Bu hisob parolini faqat CEO yoki ega tiklaydi", cid);
        const pass = genPass();
        db.prepare("UPDATE users SET pass = ?, pass_set_by = 'admin' WHERE id = ?").run(auth.hashPassword(pass), row.id);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);   // eski sessiyalar bekor
        audit("user.passwd", row.login, "parol tiklandi");
        return okWrite(200, { ok: true, login: row.login, password: pass });
      }

      if (p === "/api/users/role") {
        const row = findLogin(b.login);
        if (!row) return fail(res, 404, "Foydalanuvchi topilmadi", cid);
        const role = String(b.role || "").trim();
        if (!ROLES.includes(role)) return fail(res, 400, "Rol noto'g'ri", cid);
        if (row.id === user.id) return fail(res, 400, "O'z rolingizni o'zgartira olmaysiz", cid);
        // F-04: rahbar/admin imtiyozli rolni bera olmaydi va imtiyozli hisob rolini o'zgartira olmaydi
        if (!RL.SUPERADMIN.includes(user.role) && (RL.PRIVILEGED.includes(role) || RL.PRIVILEGED.includes(row.role)))
          return fail(res, 403, "Imtiyozli rolni faqat CEO yoki ega o'zgartiradi", cid);
        db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, row.id);
        audit("user.role", row.login, `${row.role} -> ${role}`,
          { before: { role: row.role }, after: { role } });
        return okWrite(200, { ok: true });
      }

      if (p === "/api/users/link") {
        const row = findLogin(b.login);
        if (!row) return fail(res, 404, "Foydalanuvchi topilmadi", cid);
        const bid = b.bitrixUserId ? String(b.bitrixUserId).trim() : null;
        db.prepare("UPDATE users SET bitrix_user_id = ? WHERE id = ?").run(bid, row.id);
        audit("user.link", row.login, `bitrix=${bid || "—"}`,
          { before: { bitrixUserId: row.bitrix_user_id || null }, after: { bitrixUserId: bid } });
        return okWrite(200, { ok: true });
      }

      if (p === "/api/users/mfaoff") {
        const row = findLogin(b.login);
        if (!row) return fail(res, 404, "Foydalanuvchi topilmadi", cid);
        db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup = NULL, totp_last_step = 0 WHERE id = ?")
          .run(row.id);
        audit("user.mfaoff", row.login, "telefon yo'qolgan holat");
        return okWrite(200, { ok: true });
      }

      if (p === "/api/users/delete") {
        const row = findLogin(b.login);
        if (!row) return fail(res, 404, "Foydalanuvchi topilmadi", cid);
        if (row.id === user.id) return fail(res, 400, "O'zingizni o'chira olmaysiz", cid);
        // F-04: imtiyozli hisobni faqat CEO/ega o'chiradi
        if (!RL.SUPERADMIN.includes(user.role) && RL.PRIVILEGED.includes(row.role))
          return fail(res, 403, "Imtiyozli hisobni faqat CEO yoki ega o'chiradi", cid);
        // AC-44: qaytarib bo'lmaydigan amal. Brauzerdagi oyna yetarli emas —
        // to'g'ridan-to'g'ri API chaqiruvi uni chetlab o'tadi. Login nomi qayta yozilsin.
        if (String(b.confirm || "").trim() !== row.login)
          return fail(res, 400, `Tasdiq kerak: "confirm" maydoniga "${row.login}" deb yozing`, cid);
        const leaders = db.prepare(
          "SELECT COUNT(*) c FROM users WHERE role IN ('ega','ceo','rahbar')"
        ).get().c;
        if (["ega", "ceo", "rahbar"].includes(row.role) && leaders <= 1)
          return fail(res, 400, "Oxirgi rahbarni o'chirib bo'lmaydi", cid);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
        db.prepare("DELETE FROM users WHERE id = ?").run(row.id);
        audit("user.delete", row.login, `rol=${row.role}`,
          { before: { login: row.login, name: row.name, role: row.role,
                      bitrixUserId: row.bitrix_user_id || null }, after: null });
        return okWrite(200, { ok: true });
      }

      // AC-44: eksport ham tasdiq va audit talab qiladi. Ma'lumotni tashqariga
      // chiqarish o'chirish bilan bir xil jiddiylikda — kim, qachon, nechta
      // qatorni oldi degan savolga javob qolishi kerak.
      if (p === "/api/export" && req.method === "POST") {
        const what = String(b.what || "").trim();
        if (!["leads", "deals"].includes(what))
          return fail(res, 400, "what: leads yoki deals", cid);
        if (String(b.confirm || "").trim() !== what)
          return fail(res, 400, `Tasdiq kerak: "confirm" maydoniga "${what}" deb yozing`, cid);
        const R = range(30);
        const cols = what === "leads"
          ? ["id", "title", "source", "status", "grade", "score", "ageDays", "ownerName", "phone", "amount", "currency", "createdAt", "url"]
          : ["id", "title", "stage", "amount", "currency", "stageDays", "ownerName", "noClient", "createdAt", "url"];
        let data;
        if (what === "leads") {
          data = (await api.leads(bx, { range: R, limit: 1000, owner: mine })).rows;
        } else {
          const k = await api.kanban(bx, String(b.categoryId || "0"), mine, R);
          data = (k.columns || []).flatMap((c) => c.cards.map((x) => ({ ...x, stage: c.name })));
        }
        // CSV: nuqtali vergul va BOM — Excel o'zbek/kirill matnni to'g'ri ochsin.
        const q = (v) => {
          const t = v === null || v === undefined ? "" : String(v);
          return /[";\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
        };
        const csv = "\uFEFF" + [cols.join(";"), ...data.map((r) => cols.map((c) => q(r[c])).join(";"))].join("\r\n");
        const { fromSql, toSql } = rng.sqlBounds(R);
        audit("export.data", what, `${data.length} qator`,
          { before: null, after: { what, rows: data.length, from: fromSql, to: toSql, columns: cols.length } });
        res.setHeader("content-type", "text/csv; charset=utf-8");
        res.setHeader("content-disposition", `attachment; filename="pitaka-${what}-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.setHeader("x-correlation-id", cid);
        res.end(csv);
        return;
      }

      return fail(res, 404, "Noma'lum amal", cid);
    }

    // ---- MFA (ikki bosqichli kirish) ----
    if (p.startsWith("/api/mfa/")) {
      if (!user) return fail(res, 401, "Kirilmagan", cid);
      const me = () => db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);

      if (p === "/api/mfa/status") {
        const r = me();
        let left = []; try { left = JSON.parse(r.totp_backup || "[]"); } catch {}
        return json(res, 200, { enabled: !!r.totp_enabled, backupLeft: left.length });
      }
      // 1-qadam: sir yaratish (hali yoqilmaydi)
      if (p === "/api/mfa/setup" && req.method === "POST") {
        const r = me();
        if (r.totp_enabled) return fail(res, 409, "MFA allaqachon yoqilgan. Avval o'chiring.", cid);
        const secret = totp.newSecret();
        db.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?").run(secret, user.id);
        audit("mfa.setup", user.login, null);
        return json(res, 200, { secret, pretty: totp.pretty(secret), uri: totp.otpauthUri(secret, user.login) });
      }
      // 2-qadam: kod bilan tasdiqlash → yoqiladi, zaxira kodlar bir marta ko'rsatiladi
      if (p === "/api/mfa/enable" && req.method === "POST") {
        const { code } = await readBody(req);
        const r = me();
        if (!r.totp_secret) return fail(res, 400, "Avval sozlashni boshlang", cid);
        if (r.totp_enabled) return fail(res, 409, "MFA allaqachon yoqilgan", cid);
        const v = totp.verify(r.totp_secret, code, { lastStep: 0 });
        if (!v.ok) return fail(res, 400, "Kod noto'g'ri. Telefon soati to'g'ri ekanini tekshiring.", cid);
        const codes = totp.newBackupCodes(8);
        db.prepare("UPDATE users SET totp_enabled = 1, totp_last_step = ?, totp_backup = ? WHERE id = ?")
          .run(v.step, JSON.stringify(codes.map(totp.hashCode)), user.id);
        audit("mfa.enable", user.login, null);
        return json(res, 200, { ok: true, backupCodes: codes });
      }
      // O'chirish — parol va joriy kod talab qilinadi
      if (p === "/api/mfa/disable" && req.method === "POST") {
        const { password, code } = await readBody(req);
        const r = me();
        if (!r.totp_enabled) return fail(res, 400, "MFA yoqilmagan", cid);
        // 403 (401 emas): 401 klientda "sessiya tugadi" deb qabul qilinadi va oyna yopilib ketardi
        if (!auth.verifyPassword(String(password || ""), r.pass)) return fail(res, 403, "Parol noto'g'ri", cid);
        // lastStep: logindagi kod shu yerda qayta ishlatilmasin (bir kod — bir marta)
        const v = totp.verify(r.totp_secret, code, { lastStep: r.totp_last_step || 0 });
        let okBackup = false;
        if (!v.ok) {
          let left = []; try { left = JSON.parse(r.totp_backup || "[]"); } catch {}
          okBackup = left.includes(totp.hashCode(code));
        }
        if (!v.ok && !okBackup) return fail(res, 400, "Kod noto'g'ri", cid);
        db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup = NULL, totp_last_step = 0 WHERE id = ?").run(user.id);
        audit("mfa.disable", user.login, null);
        return json(res, 200, { ok: true });
      }
      // Zaxira kodlarni yangilash
      if (p === "/api/mfa/backup" && req.method === "POST") {
        const { code } = await readBody(req);
        const r = me();
        if (!r.totp_enabled) return fail(res, 400, "MFA yoqilmagan", cid);
        const v = totp.verify(r.totp_secret, code, { lastStep: r.totp_last_step || 0 });
        if (!v.ok) return fail(res, 400, "Kod noto'g'ri", cid);
        const codes = totp.newBackupCodes(8);
        db.prepare("UPDATE users SET totp_backup = ?, totp_last_step = ? WHERE id = ?")
          .run(JSON.stringify(codes.map(totp.hashCode)), v.step, user.id);
        audit("mfa.backup_new", user.login, null);
        return json(res, 200, { backupCodes: codes });
      }
      return fail(res, 404, "Bunday endpoint yo'q", cid);
    }

    // ---- ma'lumot endpointlari ----
    // Sana oralig'i: ?from=YYYY-MM-DD&to=YYYY-MM-DD. Berilmasa — eski ?days=N xatti-harakati.
    // Har endpoint o'z standart oynasi bilan o'qiydi, shuning uchun alohida chaqiriladi.
    const range = (defDays) => rng.parseRange(q, defDays);

    // CRM'da qaysi ruxsat ochiq — panel buni halol ko'rsatadi.
    if (p === "/api/bitrix/caps") return json(res, 200, await dir.capabilities(bx));
    // Uch qoida nazorati — sotuvchi faqat o'zinikini ko'radi.
    if (p === "/api/rules") return json(res, 200, await rules.check(bx, mine, range(30)));
    // M03 — lid skoringi. Sotuvchi faqat o'z lidlarini ko'radi.
    if (p === "/api/scoring") return json(res, 200, await scoring.leadScores(bx, mine, range(30)));
    // M06 + M18 — javob tezligi SLA va yo'qotish tahlili
    if (p === "/api/sla") return json(res, 200, await sla.slaCheck(bx, mine, range(30)));
    // v2 (2026-10-03): menyu raqamlari — bootda va 5 daqiqada bitta so'rov. Faqat ish talab qiladigan sanoqlar:
    // javobsiz24 — 24 soatdan oshgan, hali javobsiz lidlar (oxirgi 30 kun, o'z doirasi); vazifa — bugungi va muddati
    // o'tgan vazifalarim; missiya — sotuvchining bugungi missiyalari. Natija foydalanuvchi bo'yicha 5 daqiqa keshda.
    // ---- v2 (2026-10-03): yagona ko'rsatkichlar (lib/olchov.mjs). Bloklar alohida — sahifa qismma-qism chiziladi,
    // bitta blok sekin yoki xato bo'lsa qolganlari kutmaydi. Boshqaruv markazi — faqat rahbarlar.
    if (p === "/api/v2/markaz" && req.method === "GET") {
      if (ownerOnly()) return;
      const blok = String(q.get("blok") || "kpi"), R = range(30);
      if (blok === "kpi") return json(res, 200, await olchov.markazKpi(bx, db, R), cid);
      if (blok === "voronka") return json(res, 200, await olchov.voronkaQisqa(bx, db), cid);
      if (blok === "muammo") return json(res, 200, await olchov.markazMuammo(bx, db, R), cid);
      if (blok === "sotuv") return json(res, 200, await olchov.sotuv(bx, db), cid);
      if (blok === "operator") return json(res, 200, await olchov.operatorlarBugun(bx, db), cid);
      return fail(res, 400, "Noma'lum blok", cid);
    }
    // Mening ishim (operator/sotuvchi) — faqat o'z doirasi: lidlar mine bo'yicha, qo'ng'iroqlar mineCall bo'yicha
    if (p === "/api/v2/men" && req.method === "GET") {
      if (!mine || mine === "__none__") return fail(res, 409, "Hisobingiz CRM'ga bog'lanmagan", cid);
      const blok = String(q.get("blok") || "kpi");
      if (blok === "kpi") return json(res, 200, await olchov.menKpi(bx, db, range(1), mine, mineCall), cid);
      if (blok === "navbat") return json(res, 200, await olchov.navbat(bx, db, mine), cid);
      if (blok === "taqdir") return json(res, 200, await olchov.taqdir(bx, db, mine), cid);
      if (blok === "qongiroq") return json(res, 200, await olchov.oxirgiQongiroqlar(bx, db, mineCall), cid);
      if (blok === "mezon") return json(res, 200, await olchov.pastMezonlar(bx, db, mineCall), cid);
      return fail(res, 400, "Noma'lum blok", cid);
    }
    // Lidlar «Umumiy» — hamma rol, o'z doirasida (rahbar — hammasi; operator — «Оператор» bo'yicha; sotuvchi — mas'ul bo'yicha)
    if (p === "/api/v2/lidlar" && req.method === "GET") {
      if (mine === "__none__") return fail(res, 409, "Hisobingiz CRM'ga bog'lanmagan", cid);
      const blok = String(q.get("blok") || "kpi"), R = range(30);
      if (blok === "kpi") return json(res, 200, await olchov.lidlarKpi(bx, R, mine), cid);
      if (blok === "umumiy") return json(res, 200, await olchov.lidlarUmumiy(bx, R, mine), cid);
      if (blok === "muammo") return json(res, 200, await olchov.lidlarMuammo(bx, db, R, mine), cid);
      if (blok === "tasir") return json(res, 200, await olchov.javobTasiri(bx), cid);   // jamoa bo'yicha, shaxsiy ma'lumotsiz
      return fail(res, 400, "Noma'lum blok", cid);
    }
    // Pitaka sotuv qo'ng'irog'i skripti (tools/sotuv-skript.md) — murabbiy ham shu fayldan oladi; bitta manba
    if (p === "/api/v2/skript" && req.method === "GET") {
      try { return json(res, 200, { md: fs.readFileSync(path.join(HERE, "tools", "sotuv-skript.md"), "utf8") }, cid); }
      catch { return fail(res, 404, "Skript fayli topilmadi (tools/sotuv-skript.md)", cid); }
    }
    // Bitimlar «Umumiy» — hozirgi ochiq bitimlar (rahbar — hammasi, sotuvchi — o'ziga biriktirilganlar). Operatorda bitim yo'q.
    if (p === "/api/v2/bitimlar" && req.method === "GET") {
      if (RL.isOp(mine)) return fail(res, 403, "Bitimlar sizning rolingiz uchun ochiq emas", cid);
      if (mine === "__none__") return fail(res, 409, "Hisobingiz CRM'ga bog'lanmagan", cid);
      return json(res, 200, await olchov.bitimlar(bx, mine), cid);
    }
    // Jamoa — xodim kartalari (davr bo'yicha), faqat rahbarlar
    if (p === "/api/v2/jamoa" && req.method === "GET") {
      if (ownerOnly()) return;
      return json(res, 200, await olchov.jamoa(bx, db, range(30)), cid);
    }
    if (p === "/api/menyu" && req.method === "GET") {
      const out = await cached(`menyu:${user.id}:${mine || "all"}`, 5 * 60e3, async () => {
        const R30 = rng.rolling(30);   // «30 kun» tugmasi bilan bir xil oyna
        const r = { javobsiz24: null, vazifa: null, missiya: null };
        await Promise.all([
          sla.slaCheck(bx, mine, R30).then((x) => { r.javobsiz24 = x?.totals?.atRisk ?? null; }).catch(() => {}),
        ]);
        return r;
      });
      return json(res, 200, out, cid);
    }
    if (p === "/api/dicts")     return json(res, 200, await api.dicts(bx));
    if (p === "/api/summary")   return json(res, 200, await api.summary(bx, mine, range(30)));
    if (p === "/api/flow")      return json(res, 200, await api.leadFlow(bx, range(14)));
    if (p === "/api/sources")   return json(res, 200, await api.sources(bx, range(30)));
    if (p === "/api/leads")     return json(res, 200, await api.leads(bx, {
      range: range(1),
      semantic: ["P", "S", "F"].includes(q.get("semantic")) ? q.get("semantic") : null,
      // CRM holati (STATUS_ID) — faqat ruxsat etilgan belgilar, aks holda e'tiborsiz
      status: /^[A-Z0-9_]{1,40}$/.test(q.get("status") || "") ? q.get("status") : null,
      limit: clampInt(q.get("limit"), 60, 1, 500),
      owner: mine,
      operator: /^\d{1,10}$/.test(q.get("operator") || "") ? q.get("operator") : null,
    }));


    // ---- Sotuv voronkasi (TZ «Sales OS» 2-bosqich, 2026-09-24) ----
    // Rahbar — hammasi; operator — o'z lidlari («Оператор»); sotuvchi/menejer — o'ziga biriktirilganlar.
    if (p === "/api/voronka" || p.startsWith("/api/voronka/")) {
      if (p === "/api/voronka" && req.method === "GET") {
        const f = {}; for (const k of ["operator", "menejer", "manba", "segment", "hudud"]) { const v = String(q.get(k) || "").slice(0, 80); if (v) f[k] = v; }
        return json(res, 200, await voronka.voronka(bx, db, { range: range(30), owner: mine, f }), cid);
      }
      if (p === "/api/voronka/qayta" && req.method === "GET") return json(res, 200, await voronka.qayta(bx, db, { owner: mine }), cid);
      if (p === "/api/voronka/lugat" && req.method === "GET") { if (ownerOnly()) return; return json(res, 200, await voronka.lugat(bx), cid); }
      if (p === "/api/voronka/sozlama") {
        if (req.method === "GET") return json(res, 200, voronka.sozlama(db), cid);
        if (req.method === "POST") {
          if (ownerOnly()) return;
          const b = await readBody(req);
          const r = voronka.setSozlama(db, b || {}, user.id);
          audit("voronka.settings", "settings", "bosqichlar/normalar/qayta", { before: r.was, after: r.now });
          invalidate("voronka:");
          return okWrite(200, r.now);
        }
      }
      return fail(res, 404, "Bunday endpoint yo'q", cid);
    }
    // Lid taqdiri: managerga o'tganlar qayerda — B2B/B2C, manager, bosqich, natija (operator — o'ziniki)
    if (p === "/api/leads/journey") return json(res, 200, await api.journey(bx, { range: range(30), owner: mine,
      operator: /^\d{1,10}$/.test(q.get("operator") || "") ? q.get("operator") : null }), cid);
    if (p === "/api/pipelines") return json(res, 200, await api.pipelines(bx, range(30)));
    if (p === "/api/kanban") {
      const cat = String(q.get("category") || "0");
      if (!/^\d{1,4}$/.test(cat)) return fail(res, 400, "Yo'nalish ID raqam bo'lishi kerak", cid);
      return json(res, 200, await api.kanban(bx, cat, mine, range(30)));
    }
    if (p === "/api/stuck")     return json(res, 200, await api.stuck(bx, clampInt(q.get("idle"), 14, 1, 120), mine, range(30)));
    if (p === "/api/clients")   return json(res, 200, await api.clients(bx, mine, range(30)));
    if (p === "/api/finance")   { if (ownerOnly()) return; return json(res, 200, await api.finance(bx, range(30))); }
    // TZI P0-06: hisob-fakturalar va haqiqiy tushum (o'lchab bo'lmasa — sababi bilan)
    if (p === "/api/hisob-faktura") { if (ownerOnly()) return; return json(res, 200, await api.invoices(bx, range(30))); }
    if (p === "/api/team")      { if (ownerOnly()) return; return json(res, 200, await api.team(bx, range(30))); }

    if (p === "/api/refresh" && req.method === "POST") { invalidate(""); audit("refresh"); return json(res, 200, { ok: true }); }


    // Lid oynasi — panel ichida (CRM'ga chiqmasdan). Sotuvchi faqat o'z lidini ko'radi.
    let lm = p.match(/^\/api\/leads\/(\d+)$/);
    if (lm) {
      const room = await api.leadRoom(bx, lm[1], mine, db);
      // AI lid sifati (qo'ng'iroq suhbati bo'yicha) — lid kartasida ham ko'rinsin (TZ 3.4)
      const aq = sifat.ofLeads(db, [lm[1]]).get(String(lm[1]));
      if (aq && room && room.lead) room.lead.aiSifat = aq;
      return json(res, 200, room, cid);
    }
    let dm = p.match(/^\/api\/deals\/(\d+)$/);
    if (dm) {
      const room = await dealRoom(bx, dm[1], mine);
      // Bitimni CRM'da nomi bo'yicha qidirish qiyin — oynada mijoz telefoni,
      // mas'ulning ISMI (CRM ID emas) va CRM havolasi bo'lsin. Telefon — lid oynasidagi qoida bilan bir xil:
      // bitimni ocha olgan kishi ko'radi (sotuvchi — faqat o'ziniki). dealRoom keshidagi obyekt o'zgartirilmaydi.
      const d = { ...room.deal };
      try {
        const raw = (await bx.call("crm.deal.get", { id: dm[1] })).result || {};
        let phones = (raw.PHONE || []).map((x) => x.VALUE).filter(Boolean);
        if (!phones.length && (raw.CONTACT_ID || raw.COMPANY_ID)) {   // bitimda yo'q — mijoz kartasidan
          const c = await bx.call(raw.CONTACT_ID ? "crm.contact.get" : "crm.company.get", { id: raw.CONTACT_ID || raw.COMPANY_ID }).catch(() => ({}));
          phones = ((c.result || {}).PHONE || []).map((x) => x.VALUE).filter(Boolean);
        }
        d.phones = [...new Set(phones)];
        d.client = [raw.NAME, raw.LAST_NAME].filter(Boolean).join(" ") || raw.COMPANY_TITLE || "";
        const portal = String(process.env.BITRIX_PORTAL || "").replace(/\/+$/, "");
        d.crmUrl = portal ? `${portal}/crm/deal/details/${dm[1]}/` : null;
      } catch {}
      // Ism CRM'dagidek: dir.decorate familiyani oldinga qo'yadi —
      // shuning uchun shu oynada user.get dan NAME + LAST_NAME tartibida olinadi.
      try {
        const u = ((await bx.call("user.get", { FILTER: { ID: [String(d.owner)] } })).result || [])[0];
        if (u) d.ownerName = [u.NAME, u.LAST_NAME].filter(Boolean).join(" ").trim();
      } catch {}
      if (!d.ownerName) d.ownerName = (await dir.decorate(bx, [d], "owner", "ownerName")).rows[0].ownerName;
      return json(res, 200, { ...room, deal: d });
    }



    // ---- Qo'ng'iroqlar ----
    if (p === "/api/calls") return json(res, 200, await calls.calls(bx, range(30), mineCall));

    // ---- AI qo'ng'iroq tahlili (Pitaka qo'ng'iroq sifati agenti) ----
    // Telefon raqamini to'liq ko'rish alohida ruxsat (§8); o'z qo'ng'irog'ida operator ko'radi.
    const CAN_PHONE = [...LEADER, "admin", "auditor"].includes(user.role);
    const enumOf = (v, list) => (list.includes(v) ? v : null);

    if (p === "/api/calls/kpi")
      return json(res, 200, await calls.qualityKpi(bx, db, { range: range(30), owner: mineCall }), cid);

    // Operator radari (2026-09-30): 8 mezon — operator va jamoa o'rtachasi, 30 kun. Operator/sotuvchi — faqat o'zi
    // (owner parametri e'tiborsiz), rahbar — istalgan operator. Jamoa o'rtachasi — umumiy son, shaxsiy ma'lumot emas.
    if (p === "/api/calls/radar") {
      const ow = mineCall || String(q.get("owner") || "").replace(/[^\w-]/g, "").slice(0, 20);
      if (!ow) return fail(res, 400, "owner kerak", cid);
      return json(res, 200, await calls.radar(bx, db, { range: 30, owner: ow }), cid);
    }
    // ---- Pitaka nazorati (2026-11-10, lib/nazorat.mjs) ----
    // Sotuvchi/operator — faqat o'zi (mineCall); rahbar — hammasi yoki ?menejer=<Bitrix ID> bo'yicha.
    if (p === "/api/nazorat/kval" || p === "/api/nazorat/menejerlar") {
      if (req.method !== "GET") return fail(res, 405, "Faqat GET", cid);
      const men = mineCall ? null : (String(q.get("menejer") || "").replace(/[^\w-]/g, "").slice(0, 20) || null);
      const ow = mineCall || men;
      return json(res, 200, p === "/api/nazorat/kval"
        ? await nazorat.kvalCheck(bx, db, { range: range(30), owner: ow })
        : await nazorat.violations(bx, db, { range: range(30), owner: ow }), cid);
    }
    // ---- Telegram «shaxsiy murabbiy» (2026-09-30, lib/murabbiy.mjs) ----
    // Holat: har kim o'zinikini; rahbar — jamoa va bot holati. Namuna: operator — faqat o'z kartasi.
    // Ulash/uzish boshqa xodim uchun — faqat rahbar; rejim (har/kun, to'xtatish) — faqat xodimning o'zi.
    if (p === "/api/murabbiy" && req.method === "GET") return json(res, 200, murabbiy.holat(db, user), cid);
    if (p === "/api/murabbiy/namuna" && req.method === "GET") {
      const lead = LEADER.includes(user.role);
      const ow = lead ? (String(q.get("owner") || "").replace(/[^\w-]/g, "").slice(0, 20) || null) : mineCall;
      if (!lead && !ow) return fail(res, 409, "Hisobingiz CRM'ga bog'lanmagan", cid);
      return json(res, 200, murabbiy.namuna(db, ow) || { bosh: true }, cid);
    }
    if (p.startsWith("/api/murabbiy/") && req.method === "POST") {
      const b = await readBody(req);
      const act = p.slice("/api/murabbiy/".length);
      const lead = LEADER.includes(user.role);
      const uid = b.userId != null && lead ? Number(b.userId) : user.id;
      if (!Number.isInteger(uid) || uid <= 0) return fail(res, 400, "userId noto'g'ri", cid);
      if (uid !== user.id && !db.prepare("SELECT 1 FROM users WHERE id=?").get(uid)) return fail(res, 404, "Xodim topilmadi", cid);
      if (act === "ulash") {
        const target = uid === user.id ? user : db.prepare("SELECT id, role FROM users WHERE id=?").get(uid);
        if (!murabbiy.havolaMumkin(user, target)) return fail(res, 403, "Rahbar hisobiga havolani faqat egasining o'zi yoki ega/CEO yaratadi", cid);
        const r = murabbiy.havola(db, uid, user.id);
        audit("murabbiy.havola", `user:${uid}`, uid === user.id ? "o'zi" : "rahbar yaratdi");
        return okWrite(200, r);
      }
      if (act === "uzish") {
        const ok = murabbiy.uzish(db, uid);
        audit("murabbiy.uzish", `user:${uid}`, uid === user.id ? "o'zi" : "rahbar");
        return okWrite(200, { ok });
      }
      if (act === "rejim") {
        if (uid !== user.id) return fail(res, 403, "Rejimni xodimning o'zi tanlaydi", cid);
        const r = murabbiy.rejim(db, uid, { mode: b.mode, paused: b.paused });
        audit("murabbiy.rejim", `user:${uid}`, `${r.mode}${r.paused ? " · to'xtatilgan" : ""}`);
        return okWrite(200, r);
      }
      if (act === "sozlama") {
        if (ownerOnly()) return;
        const s = murabbiy.sozla(db, { faol: b.faol, vaqt: b.vaqt }, user.id);
        audit("murabbiy.sozlama", "murabbiy", `${s.faol ? "yoqilgan" : "o'chirilgan"} · ${s.vaqt}`);
        return okWrite(200, s);
      }
      return fail(res, 404, "Topilmadi", cid);
    }
    if (p === "/api/calls/quality") { if (ownerOnly()) return;
      return json(res, 200, await calls.leaderQuality(bx, db, { range: range(30) }), cid); }

    if (p === "/api/calls/registry") {
      const nb = (k) => (q.get(k) === null ? null : q.get(k) === "1" || q.get(k) === "true");
      const out = await calls.registry(bx, db, {
        range: range(30), owner: mineCall, mineOwner: user.bitrixUserId || null, canSeePhone: CAN_PHONE,
        limit: clampInt(q.get("limit"), 50, 1, 200), offset: clampInt(q.get("offset"), 0, 0, 20000),
        dir: enumOf(q.get("dir"), ["in", "out", "missed"]),
        risk: enumOf(q.get("risk"), ["low", "medium", "high", "critical"]),
        sentiment: enumOf(q.get("sentiment"), ["positive", "neutral", "negative"]),
        status: enumOf(q.get("status"), ["none", "queued", "running", "ready", "error"]),
        minScore: q.get("minScore") === null ? null : clampInt(q.get("minScore"), 0, 0, 100),
        maxScore: q.get("maxScore") === null ? null : clampInt(q.get("maxScore"), 100, 0, 100),
        hasNext: nb("hasNext"), term: (q.get("term") || "").slice(0, 60) || null,
        q: (q.get("q") || "").slice(0, 80) || null, stage: (q.get("stage") || "").slice(0, 60) || null,
        analyzedOnly: q.get("analyzedOnly") === "1",
      });
      audit("call.list", null, `${out.total} qator`);
      return json(res, 200, out, cid);
    }

    // ---- kritik so'zlar lug'ati (§4.D, administrator tahrirlaydi) ----
    if (p === "/api/calls/dict") {
      if (req.method === "GET") return json(res, 200, { rows: cstore.getDict(db) }, cid);
      if (req.method === "POST") {
        if (deny([...LEADER, "admin"])) return;
        const b = await readBody(req);
        const t = cstore.addTerm(db, b, user.id);
        audit("call.dict.add", t, `${b.color}/${b.kind}`);
        return okWrite(200, { ok: true, term: t, rows: cstore.getDict(db) });
      }
    }
    let cdt = p.match(/^\/api\/calls\/dict\/(\d+)\/toggle$/);
    if (cdt && req.method === "POST") {
      if (deny([...LEADER, "admin"])) return;
      const { enabled } = await readBody(req);
      cstore.toggleTerm(db, Number(cdt[1]), !!enabled, user.id);
      audit("call.dict.toggle", cdt[1], enabled ? "yoqildi" : "o'chirildi");
      return okWrite(200, { ok: true, rows: cstore.getDict(db) });
    }

    // ---- bitta qo'ng'iroq: tahlil oynasi ----
    // ID harfli prefiks bilan ham bo'lishi mumkin (masalan «q<id>»)
    // — faqat raqam qabul qilinsa bunday qo'ng'iroqlar 404 berardi.
    let ccm = p.match(/^\/api\/calls\/([a-z]?\d+)$/);
    if (ccm) {
      const id = ccm[1];
      const row = await calls.one(bx, db, id,
        { canSeePhone: CAN_PHONE, mineOwner: user.bitrixUserId || null, owner: mineCall });
      if (!row) return fail(res, 404, "Qo'ng'iroq topilmadi yoki sizga ochiq emas", cid);
      const a = cstore.getAnalysis(db, id);
      const tr = cstore.getTranscript(db, id);
      audit("call.open", `call:${id}`, a ? a.status : "tahlilsiz");   // §9: har ko'rish auditga
      return json(res, 200, {
        call: row,
        analysis: a?.json ? JSON.parse(a.json) : null,
        status: a?.status || "none", error: a?.error || null, attempts: a?.attempts || 0,
        transcript: tr ? { text: tr.text, source: tr.source, addedAt: tr.added_at,
                           editedAt: tr.edited_at, edited: !!tr.edited_at } : null,
        tasks: cstore.tasksFor(db, id), edits: cstore.editsFor(db, id), review: cstore.getReview(db, id),
        ai: { available: cllm.available(), queue: cllm.queueDepth() },
        stt: { available: stt.available(), telephony: !!row.caps?.telephony, recordings: !!row.caps?.recordings },
      }, cid);
    }

    // ---- qo'ng'iroq audiosi: panel ichida tinglash (onlinePBX havolasi serverdan o'tadi,
    //      shunda token brauzerga chiqmaydi va egalik tekshiruvi ishlaydi) ----
    let cau = p.match(/^\/api\/calls\/([a-z]?\d+)\/audio$/);
    if (cau && req.method === "GET") {
      const id = cau[1];
      const row = await calls.one(bx, db, id,
        { canSeePhone: CAN_PHONE, mineOwner: user.bitrixUserId || null, owner: mineCall });
      if (!row) return fail(res, 404, "Qo'ng'iroq topilmadi yoki sizga ochiq emas", cid);
      let hit = AUDIO_CACHE.get(id);
      if (!hit || Date.now() - hit.at > 15 * 60e3) {
        const rec = await tel.record(bx, { originId: row.originId, activityId: id, at: row.at, phone: row.phone });
        if (rec.error) return fail(res, rec.code === "no_scope" ? 409 : 404, rec.error, cid);
        const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 60000);
        let r;
        try { r = await fetch(rec.url, { signal: ac.signal, redirect: "follow" }); } catch (e) {
          clearTimeout(tm); return fail(res, 502, "Audio yuklab olinmadi: " + e.message, cid);
        }
        clearTimeout(tm);
        if (!r.ok) return fail(res, 502, `Audio manbasi ${r.status} qaytardi`, cid);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 100) return fail(res, 404, "Audio fayli bo'sh", cid);
        const ct = (r.headers.get("content-type") || "").split(";")[0] || "audio/mpeg";
        hit = { buf, type: ct.startsWith("audio/") ? ct : "audio/mpeg", at: Date.now() };
        AUDIO_CACHE.set(id, hit);
        if (AUDIO_CACHE.size > 24) AUDIO_CACHE.delete(AUDIO_CACHE.keys().next().value);
        audit("call.listen", `call:${id}`, `${Math.round(buf.length / 1024)} KB`);
      }
      // Range — brauzer pleeri oldinga-orqaga surishi uchun
      const total = hit.buf.length, range = String(req.headers.range || "").match(/bytes=(\d*)-(\d*)/);
      let start = 0, end = total - 1;
      if (range) { if (range[1]) start = Number(range[1]); if (range[2]) end = Number(range[2]); if (!range[1] && range[2]) { start = total - Number(range[2]); end = total - 1; } }
      if (start > end || start >= total) { res.writeHead(416, { "content-range": `bytes */${total}` }); return res.end(); }
      res.writeHead(range ? 206 : 200, {
        "content-type": hit.type, "accept-ranges": "bytes", "content-length": end - start + 1,
        "cache-control": "private, max-age=600", "x-correlation-id": cid,
        ...(range ? { "content-range": `bytes ${start}-${end}/${total}` } : {}),
      });
      return res.end(hit.buf.subarray(start, end + 1));
    }

    // ---- transkript kiritish / tahrirlash (§4.I) ----
    let ctr = p.match(/^\/api\/calls\/([a-z]?\d+)\/transcript$/);
    if (ctr && req.method === "POST") {
      const id = ctr[1];
      // Yozish faqat rahbar va sotuvchiga: ekspert/moliya/admin/auditor umumiy KO'RINISH oladi (TZ §5.2)
      if (deny([...LEADER, ...SELLER])) return;
      // Sotuvchi begona (yoki mavjud bo'lmagan) qo'ng'iroqqa transkript yoza olmasin
      const row = await calls.one(bx, db, id,
        { canSeePhone: CAN_PHONE, mineOwner: user.bitrixUserId || null, owner: mineCall });
      if (!row) return fail(res, 404, "Qo'ng'iroq topilmadi yoki sizga ochiq emas", cid);
      const { text, source, lang } = await readBody(req);
      const r = cstore.putTranscript(db, ctr[1], text, {
        source: ["manual", "stt", "import"].includes(source) ? source : "manual",
        lang: lang || null, userId: user.id, actor: user.login });
      audit(r.changed ? "call.transcript.edit" : "call.transcript.add", `call:${ctr[1]}`,
            `${String(text).length} belgi`);
      return okWrite(200, { ok: true, ...r });
    }

    // ---- audiodan transkript (§6.3–6.4): telefoniya → Groq Whisper ----
    let cts = p.match(/^\/api\/calls\/([a-z]?\d+)\/transcribe$/);
    if (cts && req.method === "POST") {
      const id = cts[1];
      const b = await readBody(req).catch(() => ({}));
      const row = await calls.one(bx, db, id,
        { canSeePhone: CAN_PHONE, mineOwner: user.bitrixUserId || null, owner: mineCall });
      if (!row) return fail(res, 404, "Qo'ng'iroq topilmadi yoki sizga ochiq emas", cid);
      if (row.missed) return fail(res, 409, "Javobsiz qo'ng'iroqda yozuv yo'q", cid);
      if (!stt.available()) return fail(res, 503, "GEMINI_API_KEY sozlanmagan — nutqdan matnga ishlamaydi", cid);
      const act = await bx.call("crm.activity.get", { id }).then((r) => r.result).catch(() => null);
      const rec = await tel.record(bx, { originId: act?.ORIGIN_ID, activityId: id, at: row.at, phone: row.phone });
      if (rec.error) return fail(res, rec.code === "no_scope" ? 503 : 404, rec.error, cid,
        rec.code === "no_scope" ? { fix: "CRM → webhook sozlamalari → «Диск» (yoki «Телефония») katagini belgilang" } : null);
      const t0 = Date.now();
      const out = await stt.transcribe(rec.url, {
        outgoing: row.out, language: b.language || null, aiDiarize: cllm.diarize });
      cstore.putTranscript(db, id, out.text, { source: "stt", lang: out.meta.language, userId: user.id, actor: user.login });
      audit("call.transcribe", `call:${id}`, `${out.meta.method} · ${out.segments.length} gap · ${Date.now() - t0} ms`);
      return okWrite(200, { ok: true, text: out.text, speakersAssumed: out.speakersAssumed,
                            meta: out.meta, record: { durationSec: rec.durationSec, callId: rec.callId } });
    }

    // ---- tahlilni yurgizish / qayta urinish (§6.7) ----
    let can = p.match(/^\/api\/calls\/([a-z]?\d+)\/analyze$/);
    if (can && req.method === "POST") {
      const id = can[1];
      const b = await readBody(req).catch(() => ({}));
      const row = await calls.one(bx, db, id,
        { canSeePhone: CAN_PHONE, mineOwner: user.bitrixUserId || null, owner: mineCall });
      if (!row) return fail(res, 404, "Qo'ng'iroq topilmadi yoki sizga ochiq emas", cid);
      // TZ §14.10: javobsiz qo'ng'iroqda tahlil ishga tushmasin
      if (row.missed) return fail(res, 409, "Javobsiz qo'ng'iroq tahlil qilinmaydi", cid);
      const out = await crun.runAnalysis(db, id, {
        customerId: row.entity?.kind === "contact" ? row.entity.id : null,
        dealId: row.deal?.id || null,
        call: row,                       // ogohlantirish matni uchun (§2.8)
      }, { useAi: b.useAi !== false, force: !!b.force, actor: user.login });
      audit("call.analyze", `call:${id}`, out.skipped ? "o'tkazib yuborildi" : (out.analysis?.engine || "?"));
      return okWrite(200, out);
    }

    // ---- to'liq konveyer: audio → transkript → tahlil (TZ §6) ----
    // /transcribe faqat matnga aylantiradi; bu esa tahlilgacha olib boradi.
    let ctx = p.match(/^\/api\/calls\/([a-z]?\d+)\/pipeline$/);
    if (ctx && req.method === "POST") {
      const id = ctx[1];
      const b = await readBody(req).catch(() => ({}));
      const row = await calls.one(bx, db, id,
        { canSeePhone: CAN_PHONE, mineOwner: user.bitrixUserId || null, owner: mineCall });
      if (!row) return fail(res, 404, "Qo'ng'iroq topilmadi yoki sizga ochiq emas", cid);
      if (row.missed) return fail(res, 409, "Javobsiz qo'ng'iroq tahlil qilinmaydi", cid);
      // Pitaka: yozuv Disk orqali ham olinadi (telephony.record) — `recordings` = telephony || disk
      if (!row.caps?.recordings)
        return fail(res, 409, "Bitrix webhook'da «Телефония» ham, «Диск» ham yo'q — audio olinmaydi", cid);
      const out = await cpipe.processCall(bx, db, row, {
        force: !!b.force, actor: user.login, useAi: b.useAi === undefined ? null : !!b.useAi, noDefer: true });
      audit("call.transcribe", `call:${id}`,
            out.ok ? (out.steps || []).join(" → ") : (out.why || "xato"));
      // Egasi 2026-09-25: faqat Gemini — band/limitda bo'lsa Groq'ga tushmaydi, qo'ng'iroq navbatda kutadi
      if (out.deferred) return fail(res, 409, "Gemini hozir band yoki kunlik limitda — qo'ng'iroq navbatda. Bo'shashi bilan avtomatik tahlil qilinadi (Groq ishlatilmaydi).", cid);
      if (out.failed) return fail(res, 502, out.why || "Audiodan tahlil qilinmadi", cid, { stage: out.stage });
      return okWrite(200, out);
    }

    // ---- AI xulosasini tahrirlash (§9 audit izi) ----
    let ced = p.match(/^\/api\/calls\/([a-z]?\d+)\/edit$/);
    if (ced && req.method === "POST") {
      const id = ced[1];
      // Yozish faqat rahbar va sotuvchiga: ekspert/moliya/admin/auditor umumiy KO'RINISH oladi (TZ §5.2)
      if (deny([...LEADER, ...SELLER])) return;
      const row = await calls.one(bx, db, id,
        { canSeePhone: CAN_PHONE, mineOwner: user.bitrixUserId || null, owner: mineCall });
      if (!row) return fail(res, 404, "Qo'ng'iroq topilmadi yoki sizga ochiq emas", cid);
      const { field, value } = await readBody(req);
      const a = cstore.getAnalysis(db, id);
      if (!a?.json) return fail(res, 409, "Tahlil topilmadi", cid);
      const ALLOWED = ["summary", "topic", "next_action", "deal_risk"];
      if (!ALLOWED.includes(field)) return fail(res, 400, `Tahrirlash mumkin: ${ALLOWED.join(", ")}`, cid);
      const j = JSON.parse(a.json);
      cstore.editField(db, id, field, j[field], value, user.login);
      j[field] = value;
      j.editedBy = user.login; j.editedAt = new Date().toISOString();
      db.prepare("UPDATE call_analyses SET json=?, topic=COALESCE(?,topic), risk=COALESCE(?,risk) WHERE call_id=?")
        .run(JSON.stringify(j), field === "topic" ? String(value).slice(0, 120) : null,
             field === "deal_risk" ? (value?.level || null) : null, id);
      audit("call.edit", `call:${id}`, field);
      return okWrite(200, { ok: true, analysis: j });
    }

    // ---- rahbar ko'rib chiqdi (§7) ----
    let crv = p.match(/^\/api\/calls\/([a-z]?\d+)\/review$/);
    if (crv && req.method === "POST") {
      if (ownerOnly()) return;
      const { note } = await readBody(req);
      cstore.review(db, crv[1], user.login, note);
      audit("call.review", `call:${crv[1]}`, String(note || "").slice(0, 120));
      return okWrite(200, { ok: true, review: cstore.getReview(db, crv[1]) });
    }


    // ---- CRM vazifasi qoralamasi (§4.H) ----
    let ctk = p.match(/^\/api\/calls\/([a-z]?\d+)\/task$/);
    if (ctk && req.method === "POST") {
      const id = ctk[1];
      // Yozish faqat rahbar va sotuvchiga: ekspert/moliya/admin/auditor umumiy KO'RINISH oladi (TZ §5.2)
      if (deny([...LEADER, ...SELLER])) return;
      const row = await calls.one(bx, db, id,
        { canSeePhone: CAN_PHONE, mineOwner: user.bitrixUserId || null, owner: mineCall });
      if (!row) return fail(res, 404, "Qo'ng'iroq topilmadi yoki sizga ochiq emas", cid);
      const b = await readBody(req);
      const caps = await dir.capabilities(bx);
      const taskId = cstore.addTask(db, id, {
        kind: b.kind, title: b.title, due: b.due, owner: b.owner, byAi: b.byAi !== false,
        state: "draft", detail: b.detail }, user.login);
      audit("call.task.draft", `call:${id}`, String(b.title || "").slice(0, 120));
      return okWrite(200, { ok: true, id: taskId, state: "draft", caps,
        note: caps.tasks
          ? "Vazifa qoralama sifatida saqlandi."
          : "Vazifa qoralama sifatida saqlandi. CRM'ga yuborish uchun webhook'da `task` ruxsati kerak — hozir yo'q." });
    }

    // ---- CRM tozalash ----
    if (p === "/api/hygiene/overview") { if (ownerOnly()) return; return json(res, 200, await hyg.overview(bx, range(30))); }
    if (p === "/api/hygiene/worklist") {
      const ck = q.get("check");
      const valid = hyg.CHECKS.some((c) => c.id === ck);
      // sotuvchi faqat o'zinikini; rahbar xohlasa menejer bo'yicha filtrlaydi
      const who = mine || (q.get("owner") && /^\d{1,10}$/.test(q.get("owner")) ? q.get("owner") : null);
      return json(res, 200, await hyg.worklist(bx, who, valid ? ck : null, range(30)));
    }

    // ---- Reja (quota) ----
    if (p === "/api/plan") {
      if (req.method === "GET") {
        if (ownerOnly()) return;
        const v = db.prepare("SELECT value, updated_at FROM settings WHERE key='plan_month'").get();
        return json(res, 200, { plan: Number(v?.value || 0), updatedAt: v?.updated_at || null });
      }
      if (req.method === "POST") {
        if (ownerOnly()) return;
        const { plan } = await readBody(req);
        const n = Number(plan);
        if (!Number.isFinite(n) || n < 0) return fail(res, 400, "Reja musbat son bo'lishi kerak", cid);
        db.prepare(`INSERT INTO settings (key,value,updated_by) VALUES ('plan_month',?,?)
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by,
                    updated_at=datetime('now')`).run(String(n), user.id);
        invalidate("rev:");
        audit("plan.set", "settings", String(n));
        return okWrite(200, { plan: n });
      }
    }

    // ---- TZ §13 Audit log ----
    // ---- Xavfsizlik qo'riqchisi ----
    // Faqat rahbarlar: hisobot ochiq portlarni, tanish tarmoqlarni va qaysi
    // hisobda 2FA yo'qligini ko'rsatadi — bu buzg'unchiga tayyor xarita bo'lardi.
    // 45 soniya keshlanadi: sahifa har ochilganda TLS va HTTP so'rov yubormaslik uchun.
    if (p === "/api/qoriqchi") {
      if (ownerOnly()) return;
      const rep = await cached("qoriqchi:report", 45e3, () => qoriqchi.report(db));
      return json(res, 200, rep, cid);
    }

    // AC-41: integratsiyalar kesimida holat, kechikish va xato soni.
    // Bitrix jonli ping bilan, qolgani o'lchangan ma'lumotdan.
    if (p === "/api/integrations") {
      if (ownerOnly()) return;
      const { fromSql, toSql } = rng.sqlBounds(range(30));
      const S = bxmod.STATS;

      // 1) Bitrix24 — arzon chaqiruv bilan jonli ping
      let ping = null, pingErr = null;
      try { const t0 = Date.now(); await bx.call("crm.dealcategory.list", { start: 0 }); ping = Date.now() - t0; }
      catch (e) { pingErr = String(e.message || e).slice(0, 200); }
      const p50 = bxmod.pct(S.ms, 50), p95 = bxmod.pct(S.ms, 95);
      const errRate = S.calls ? Math.round((S.errors / S.calls) * 1000) / 10 : 0;

      // 2) Baza — haqiqiy yozish aylanishi (qoldiq qoldirmaydi)
      let dbMs = null, dbErr = null;
      try {
        const t0 = Date.now();
        db.exec("CREATE TABLE IF NOT EXISTS __probe_w (k INTEGER PRIMARY KEY, v TEXT)");
        db.prepare("INSERT OR REPLACE INTO __probe_w (k,v) VALUES (1,?)").run(new Date().toISOString());
        db.prepare("DELETE FROM __probe_w").run();
        db.exec("DROP TABLE __probe_w");
        dbMs = Date.now() - t0;
      } catch (e) { dbErr = String(e.message || e).slice(0, 200); }
      let dbSize = null;
      try { dbSize = Math.round(fs.statSync(DB_PATH).size / 1024); } catch {}

      // 3) Veb API xatolari — error_events'dan, oraliq bo'yicha
      const errRows = db.prepare(
        "SELECT status, COUNT(*) c FROM error_events WHERE at >= ? AND at <= ? GROUP BY status ORDER BY c DESC"
      ).all(fromSql, toSql);
      const errTotal = errRows.reduce((a, r) => a + r.c, 0);
      const err5xx = errRows.filter((r) => r.status >= 500).reduce((a, r) => a + r.c, 0);


      const row = (name, ok, degraded, latencyMs, errors, note2) => ({
        name, status: ok ? (degraded ? "degraded" : "ok") : "down",
        latencyMs, errors, note: note2,
      });
      return json(res, 200, {
        range: rng.pub(range(30)),
        rows: [
          row("CRM REST", !pingErr, p95 !== null && p95 > 3000, ping, S.errors,
              pingErr ? `Ping xatosi: ${pingErr}`
                      : `Oyna: ${S.calls} chaqiruv, p50 ${p50 ?? "—"} ms, p95 ${p95 ?? "—"} ms, xato ${errRate}%.`
                        + (S.lastErr ? ` Oxirgi xato: ${S.lastErr}` : " Xato yo'q.")),
          row("Ma'lumotlar bazasi (SQLite)", !dbErr, dbMs !== null && dbMs > 200, dbMs, 0,
              dbErr ? dbErr : `Yozish aylanishi o'lchandi. Hajm: ${dbSize ?? "—"} KB.`),
          row("Veb API", err5xx === 0, errTotal > 0 && err5xx === 0, null, errTotal,
              errTotal
                ? `Oraliqda ${errTotal} xato javob: ` + errRows.map((r) => `${r.status}×${r.c}`).join(", ")
                  + (err5xx ? ` — shundan ${err5xx} tasi server xatosi.` : " — hammasi mijoz xatosi (401/403/404).")
                : "Oraliqda xato javob yo'q."),
        ],
        checkedAt: new Date().toISOString(),
      }, cid);
    }

    // AC-46: markazlashgan xato jurnali. Foydalanuvchi ekranda ko'rgan
    // trace_id ayni shu cid — ?cid=<ID> bilan bitta so'rovning izi topiladi.
    if (p === "/api/errors") {
      if (ownerOnly()) return;
      const { fromSql, toSql } = rng.sqlBounds(range(30));
      const byCid = String(q.get("cid") || "").slice(0, 64);
      const rows = byCid
        ? db.prepare("SELECT at,cid,actor,method,route,status,code,message FROM error_events WHERE cid = ? ORDER BY id DESC LIMIT 200").all(byCid)
        : db.prepare("SELECT at,cid,actor,method,route,status,code,message FROM error_events WHERE at >= ? AND at <= ? ORDER BY id DESC LIMIT 200").all(fromSql, toSql);
      const byRoute = db.prepare("SELECT route, COUNT(*) c FROM error_events WHERE at >= ? AND at <= ? GROUP BY route ORDER BY c DESC LIMIT 8").all(fromSql, toSql);
      const totalAll = db.prepare("SELECT COUNT(*) c FROM error_events").get().c;
      return json(res, 200, { rows, byRoute, totalAll }, cid);
    }

    if (p === "/api/audit") {
      if (ownerOnly()) return;
      // Jurnal UTC'da yoziladi — Toshkent oralig'ini o'sha formatga o'giramiz.
      const { fromSql, toSql } = rng.sqlBounds(range(30));
      const rows = db.prepare(
        "SELECT actor,action,entity,detail,at,before_val,after_val,cid,channel FROM audit_events WHERE at >= ? AND at <= ? ORDER BY id DESC LIMIT 200"
      ).all(fromSql, toSql);
      const totalAll = db.prepare("SELECT COUNT(*) c FROM audit_events").get().c;
      return json(res, 200, { rows, totalAll });
    }

    // TZI P0-05: CRM surati qanchalik yangi. Panel buni yuqorida ko'rsatadi —
    // yangilash xato bo'lsa eski nusxa "jonli" deb ko'rsatilmasin.
    // Pitaka: panel Bitrix'dan to'g'ridan-to'g'ri o'qiydi — oraliq adapter yo'q. Tekshiruv: bitta o'qish so'rovi.
    if (p === "/api/crm-holat") {
      const t0 = Date.now();
      try {
        await bx.call("profile");
        return json(res, 200, { manba: "bitrix", ok: true, at: new Date().toISOString(), yoshDaqiqa: 0,
                                ms: Date.now() - t0, xato: null }, cid);
      } catch (e) {
        return json(res, 200, { manba: "bitrix", ok: false, at: null, yoshDaqiqa: null,
                                xato: "Bitrix javob bermadi: " + String(e.message || e).slice(0, 160) }, cid);
      }
    }

    return fail(res, 404, "Bunday endpoint yo'q", cid);
  } catch (e) {
    const st = Number(e.status) || (/topilmadi|not found/i.test(e.message || "") ? 404
             : /biriktirilmagan|ruxsat/i.test(e.message || "") ? 403 : 500);
    if (st >= 500) console.error(`[${new Date().toISOString()}] cid=${cid} ${req.method} ${p} —`, e.message);
    // Stack'ni fail() ga uzatamiz — yozuv bitta joyda bo'lsin (takrorlanmasin).
    if (st >= 500) res.__stack = e.stack;
    // Ichki tafsilot 5xx'da tashqariga chiqmaydi — faqat trace_id beriladi
    return fail(res, st, st >= 500 ? "Server xatosi" : String(e.message || e).slice(0, 300), cid);
  }
});

// ---- CLI: foydalanuvchilarni boshqarish ----
const ROLES = RL.ROLES;   // lib/roles.mjs — yagona manba
// Parolning minimal uzunligi. Onlayn taxminlash nginx (12/daq) va ilova (6 urinish -> 15 daq blok)
// bilan cheklangani uchun 10 belgi ham amalda yetarli.
const MIN_PASS = Number(process.env.MIN_PASS || 7);

// Rahbar rollari — bularda ikki bosqichli kirishni majburiy qilish mumkin.
// Sozlama bazada (app_settings) saqlanadi, shuning uchun deploy uni nolga qaytarmaydi.
const MFA_REQUIRED_ROLES = RL.MFA_ROLES;
function mfaRequired(db) {
  try {
    db.prepare("CREATE TABLE IF NOT EXISTS app_settings (k TEXT PRIMARY KEY, v TEXT)").run();
    const r = db.prepare("SELECT v FROM app_settings WHERE k = 'mfa_required'").get();
    return r && r.v === "1";
  } catch { return false; }
}
const cliHelp = () => {
  console.log(`Foydalanish:
  node server.mjs users                          — hisoblar ro'yxati
  node server.mjs adduser <login> <ism> <rol> [parol] [bitrix_id]
  node server.mjs link    <login> <bitrix_id>    — CRM mas'ul ID sini bog'lash
  node server.mjs mfaoff  <login>                — telefon yo'qolsa MFA ni o'chirish
  node server.mjs mfareq  on|off|status           — rahbar rollariga 2FA ni majburiy qilish
  node server.mjs passwd  <login> [parol]        — parolni almashtirish
  node server.mjs rename  <eski> <yangi>         — login nomini almashtirish
  node server.mjs role    <login> <rol>          — rolni almashtirish
  node server.mjs deluser <login>                — hisobni o'chirish
Rollar: ${ROLES.join(" | ")}`);
};
const cmd = process.argv[2];
if (cmd === "mfareq") {
  db.prepare("CREATE TABLE IF NOT EXISTS app_settings (k TEXT PRIMARY KEY, v TEXT)").run();
  const LEAD = ["ega", "ceo", "rahbar", "admin"];
  const sub = (process.argv[3] || "status").toLowerCase();
  const on = () => {
    const r = db.prepare("SELECT v FROM app_settings WHERE k = 'mfa_required'").get();
    return r && r.v === "1";
  };
  const leaders = () => db.prepare("SELECT login, role, totp_enabled FROM users").all()
    .filter((r) => LEAD.includes(r.role));

  if (sub === "status") {
    console.log("Rahbar rollari uchun majburiy 2FA: " + (on() ? "YOQILGAN" : "o'chiq"));
    for (const r of leaders()) {
      console.log("  " + r.login + " (" + r.role + ") — 2FA " + (r.totp_enabled ? "bor" : "YO'Q"));
    }
    const risk = leaders().filter((r) => !r.totp_enabled);
    if (risk.length) {
      console.log("");
      console.log(on()
        ? "DIQQAT: " + risk.length + " ta hisob hozir kira olmaydi."
        : "Yoqishdan oldin shu " + risk.length + " ta hisobda 2FA sozlansin.");
    }
    process.exit(0);
  }
  if (sub !== "on" && sub !== "off") {
    console.error("Foydalanish: node server.mjs mfareq on|off|status");
    process.exit(1);
  }
  if (sub === "on") {
    const risk = leaders().filter((r) => !r.totp_enabled);
    if (risk.length && process.argv[4] !== "--force") {
      console.error("XATO: quyidagi hisoblarda 2FA yo'q — yoqilsa ular kira olmaydi:");
      for (const r of risk) console.error("   " + r.login + " (" + r.role + ")");
      console.error("");
      console.error("Avval ularda 2FA sozlang. Bila turib yoqish: mfareq on --force");
      process.exit(1);
    }
  }
  db.prepare("INSERT INTO app_settings (k,v) VALUES ('mfa_required',?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
    .run(sub === "on" ? "1" : "0");
  console.log("Majburiy 2FA: " + (sub === "on" ? "YOQILDI" : "o'chirildi"));
  process.exit(0);
}

if (cmd && ["users", "adduser", "passwd", "rename", "role", "deluser", "link", "mfaoff", "help"].includes(cmd)) {
  const a = process.argv.slice(3);
  const find = (l) => db.prepare("SELECT * FROM users WHERE login = ?").get(String(l || "").toLowerCase());
  // AC-34: CLI ikkinchi kanal. Kanal nomi va o'zgarishning ikki holati yoziladi.
  const log = (action, entity, detail, chg) => {
    const j = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
    db.prepare("INSERT INTO audit_events (actor,action,entity,detail,before_val,after_val,channel) VALUES ('cli',?,?,?,?,?,'cli')")
      .run(action, entity, detail || null, j(chg && chg.before), j(chg && chg.after));
  };
  const genPass = () => randomBytes(12).toString("base64url");

  try {
    if (cmd === "help") { cliHelp(); process.exit(0); }

    if (cmd === "users") {
      const rows = db.prepare("SELECT id,login,name,role,bitrix_user_id,totp_enabled FROM users ORDER BY id").all();
      if (!rows.length) console.log("  (hisob yo'q)");
      for (const u of rows)
        console.log(`  #${u.id}  ${u.login.padEnd(14)} ${u.role.padEnd(9)} ${(u.bitrix_user_id ? "crm#" + u.bitrix_user_id : "—").padEnd(9)} ${(u.totp_enabled ? "MFA" : "—").padEnd(4)} ${u.name}`);
      process.exit(0);
    }

    if (cmd === "adduser") {
      const [login, name, role, pass, bxid] = a;
      if (!login || !name || !role || !ROLES.includes(role)) { cliHelp(); process.exit(1); }
      const plain = pass || genPass();
      if (plain.length < MIN_PASS) { console.error(`XATO: parol kamida ${MIN_PASS} belgi bo'lishi kerak.`); process.exit(1); }
      // Mavjud loginni jimgina ustidan yozish MFA va sessiyalarni yo'qotardi — rad etiladi
      if (find(login)) { console.error(`XATO: '${login}' allaqachon bor. Parol: passwd, rol: role, bog'lash: link.`); process.exit(1); }
      db.prepare(`INSERT OR REPLACE INTO users (id,login,name,role,pass,bitrix_user_id,pass_set_by)
                  VALUES ((SELECT id FROM users WHERE login=?),?,?,?,?,?,'admin')`)
        .run(login.toLowerCase(), login.toLowerCase(), name, role, auth.hashPassword(plain), bxid || null);
      log("user.add", login.toLowerCase(), role + (bxid ? " crm#" + bxid : ""),
          { before: null, after: { login: login.toLowerCase(), name, role, bitrixUserId: bxid || null } });
      console.log(`OK: ${login} (${role}${bxid ? ", crm#" + bxid : ""}) — parol: ${plain}`);
      if (["sotuvchi", "menejer"].includes(role) && !bxid) {
        console.log("    OGOHLANTIRISH: CRM ID bog'lanmagan — bu hisob hech qanday lid/bitim ko'rmaydi.");
        console.log("    Bog'lash: node server.mjs link " + login.toLowerCase() + " <bitrix_id>");
      }
      process.exit(0);
    }

    const target = find(a[0]);
    if (!target) { console.error(`XATO: '${a[0]}' topilmadi. Ro'yxat: node server.mjs users`); process.exit(1); }

    if (cmd === "passwd") {
      const plain = a[1] || genPass();
      if (plain.length < MIN_PASS) { console.error(`XATO: parol kamida ${MIN_PASS} belgi bo'lishi kerak.`); process.exit(1); }
      db.prepare("UPDATE users SET pass=?, pass_set_by='admin' WHERE id=?").run(auth.hashPassword(plain), target.id);
      const n = auth.revokeAll(db, target.id);
      log("user.passwd", target.login, `${n} ta sessiya bekor qilindi`);
      console.log(`OK: ${target.login} — yangi parol: ${plain}`);
      console.log(`    ${n} ta ochiq sessiya bekor qilindi — qayta kirish kerak.`);
      process.exit(0);
    }

    if (cmd === "rename") {
      const nl = String(a[1] || "").toLowerCase();
      if (!/^[a-z0-9_.-]{3,32}$/.test(nl)) { console.error("XATO: yangi login 3-32 belgi, faqat a-z 0-9 _ . -"); process.exit(1); }
      if (find(nl)) { console.error(`XATO: '${nl}' allaqachon band.`); process.exit(1); }
      db.prepare("UPDATE users SET login=? WHERE id=?").run(nl, target.id);
      const n = auth.revokeAll(db, target.id);
      log("user.rename", nl, `${target.login} -> ${nl}`,
        { before: { login: target.login }, after: { login: nl } });
      console.log(`OK: ${target.login} -> ${nl}  (${n} ta sessiya bekor qilindi)`);
      process.exit(0);
    }

    if (cmd === "mfaoff") {
      if (!target.totp_enabled) { console.log(`${target.login}: MFA allaqachon o'chiq.`); process.exit(0); }
      db.prepare("UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_backup=NULL, totp_last_step=0 WHERE id=?").run(target.id);
      auth.revokeAll(db, target.id);
      db.prepare("DELETE FROM login_attempts WHERE scope = ?").run("login:" + target.login);
      log("mfa.reset", target.login, "serverdan");
      console.log(`OK: ${target.login} uchun MFA o'chirildi va barcha seanslar yopildi.`);
      console.log("    Foydalanuvchi endi faqat parol bilan kiradi — qaytadan sozlashi kerak.");
      process.exit(0);
    }

    if (cmd === "link") {
      const bxid = String(a[1] || "").trim();
      if (!/^\d{1,10}$/.test(bxid)) { console.error("XATO: CRM ID faqat raqam bo'lishi kerak."); process.exit(1); }
      db.prepare("UPDATE users SET bitrix_user_id=? WHERE id=?").run(bxid, target.id);
      invalidate("");
      log("user.link", target.login, "crm#" + bxid,
        { before: { bitrixUserId: target.bitrix_user_id || null }, after: { bitrixUserId: bxid } });
      console.log(`OK: ${target.login} -> CRM mas'ul #${bxid}`);
      process.exit(0);
    }

    if (cmd === "role") {
      const r = a[1];
      if (!ROLES.includes(r)) { console.error(`XATO: rol quyidagilardan biri: ${ROLES.join(" | ")}`); process.exit(1); }
      db.prepare("UPDATE users SET role=? WHERE id=?").run(r, target.id);
      auth.revokeAll(db, target.id);
      log("user.role", target.login, r, { before: { role: target.role }, after: { role: r } });
      console.log(`OK: ${target.login} roli endi '${r}' (qayta kirish kerak)`);
      process.exit(0);
    }

    if (cmd === "deluser") {
      const left = db.prepare("SELECT COUNT(*) c FROM users WHERE role IN ('ega','ceo','rahbar') AND id<>?").get(target.id).c;
      if (["ega","ceo","rahbar"].includes(target.role) && left === 0) {
        console.error("XATO: bu oxirgi rahbar hisobi — o'chirilmaydi. Avval boshqasini yarating.");
        process.exit(1);
      }
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
      db.prepare("DELETE FROM users WHERE id=?").run(target.id);
      log("user.delete", target.login, target.role,
      { before: { login: target.login, name: target.name, role: target.role }, after: null });
      console.log(`OK: ${target.login} o'chirildi`);
      process.exit(0);
    }
  } catch (e) { console.error("XATO:", e.message); process.exit(1); }
}

server.listen(PORT, HOST, () => {
  console.log(`[sotuv-web] ${HOST}:${PORT} — DB ${DB_PATH}`);
  // Telegram «shaxsiy murabbiy»: token fayli bo'lmasa jim kutadi — egasi sozlagach o'zi ulanadi (restart shart emas)
  const mbLog = (...a) => console.log(`[murabbiy] ${new Date().toISOString()}`, ...a);
  const mbAudit = (action, entity, detail) => {
    try { db.prepare("INSERT INTO audit_events (actor,action,entity,detail,channel) VALUES (?,?,?,?,?)").run("murabbiy-bot", action, entity || null, detail || null, "telegram"); } catch {}
  };
  murabbiy.ishgaTushir({ db, log: mbLog, audit: mbAudit,
    kunStat: async (sana) => new Map(((await calls.calls(bx, { from: sana, to: sana })).owners || []).map((o) => [String(o.owner), o])),
    // Tezkor raqamlar tugmalari (lib/menyu.mjs, 2026-10-29): agent yo'lidagi tezkor bilan bir xil manbalar;
    // leadsScoped — sotuvchi/operatorning o'z lidlari (scope: roles.scopeOf, leadOwn filtri api.leads ichida)
    tezkorCtx: {
      leads: (R, limit) => api.leads(bx, { range: R, semantic: null, status: null, limit, owner: null, operator: null }),
      leadsScoped: (R, scope) => api.leads(bx, { range: R, semantic: null, status: null, limit: 1, owner: scope, operator: null }),
      overview: () => hyg.overview(bx, rng.normalize(30)),
      javobsiz24: () => sla.slaCheck(bx, null, rng.rolling(30)).then((x) => x?.totals?.atRisk ?? null),
      plan: () => {
        const v = db.prepare("SELECT value, updated_at FROM settings WHERE key='plan_month'").get();
        return { plan: Number(v?.value || 0), updatedAt: v?.updated_at || null };
      },
      calls: (R) => calls.calls(bx, R, null),
      users: () => db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
      dealRows: () => hyg.scan(bx, rng.normalize(30)).then((x) => x.rows),   // ertalabki xabar (MURABBIY_ERTALAB=1)
    } });
  // Oldingi tahlillarning egasi (bir marta) — «o'rtachangiz» va /mezon birinchi kundan to'g'ri chiqsin
  const mbToldir = (n) => murabbiy.toldir(db, () => calls.registry(bx, db, { range: 30, limit: 100000, analyzedOnly: true }), { log: mbLog })
    .catch((e) => { mbLog(`to'ldirish XATO: ${e.message}`); if (n < 5) setTimeout(() => mbToldir(n + 1), 30 * 60e3).unref?.(); });
  setTimeout(() => mbToldir(1), 90e3).unref?.();
  // Fresh analyses must show up on the dashboard right away, so cached views are dropped after a productive cycle
  autoagent.start({ log: console.log, onAnalysed: () => invalidate("") });
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { server.close(() => process.exit(0)); });
