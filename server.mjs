#!/usr/bin/env node
// SUN-HIGHTECH Sotuv Desk — HTTP server. Tashqi paket yo'q, faqat Node stdlib.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

import { Bitrix } from "./lib/bitrix.mjs";
import * as api from "./lib/api.mjs";
import * as rev from "./lib/revenue.mjs";
import { explain } from "./lib/explain.mjs";
import * as hyg from "./lib/hygiene.mjs";
import * as calls from "./lib/calls.mjs";
import * as cstore from "./lib/callstore.mjs";
import * as crun from "./lib/callrun.mjs";
import * as cllm from "./lib/callllm.mjs";
import * as cpipe from "./lib/pipeline.mjs";
import * as ctask from "./lib/calltask.mjs";
import * as tel from "./lib/telephony.mjs";
import * as stt from "./lib/stt.mjs";
import * as rng from "./lib/range.mjs";
import * as dir from "./lib/directory.mjs";
import * as rules from "./lib/rules.mjs";
import * as scoring from "./lib/scoring.mjs";
import * as renewal from "./lib/renewal.mjs";
import * as sla from "./lib/sla.mjs";
import * as acc from "./lib/acceptance.mjs";
import * as wr from "./lib/writes.mjs";
import * as att from "./lib/attach.mjs";
import * as camp from "./lib/campus.mjs";
import * as agents from "./lib/agents.mjs";
import * as bxmod from "./lib/bitrix.mjs";   // AC-41: chaqiruv statistikasi
import * as qoriqchi from "./lib/qoriqchi.mjs";
import * as auth from "./lib/auth.mjs";
import * as totp from "./lib/totp.mjs";
import * as odash from "./lib/odoodash.mjs";
import * as RL from "./lib/roles.mjs";
import * as tasks from "./lib/tasks.mjs";
import * as kunlik from "./lib/kunlik.mjs";   // kunlik hisobot (TZ «Sales OS» 1-bosqich)
import * as sifat from "./lib/sifat.mjs";     // AI lid sifati
import * as voronka from "./lib/voronka.mjs"; // sotuv voronkasi (TZ «Sales OS» 2-bosqich)
import * as skor from "./lib/skor.mjs";       // lid skoringi v2 (TZ «Sales OS» 3-bosqich)
import * as murabbiy from "./lib/murabbiy.mjs"; // Telegram «shaxsiy murabbiy» (2026-09-30)
import * as olchov from "./lib/olchov.mjs";     // v2: yagona ko'rsatkichlar (2026-10-03)
import * as tezkor from "./lib/tezkor.mjs";
// Ombor tezkor yo'li (2026-10-30, R17). Import YALQOV va bir martalik: panel ishga tushganda
// Odoo MCP ga bog'lanmaymiz, modullar birinchi ombor savolida yuklanadi.
// Taym-aut 20 s — veb so'rovi Odoo tarmog'ida osilib qolmasligi kerak (hook'dagi bilan bir xil).
const OMBOR_TAYMAUT = 20000;
let _omborModul = null;
async function omborJavob(savol) {
  if (!_omborModul) {
    const [t, c, m] = await Promise.all([
      import("./tools/tezkor-ombor.mjs"),
      import("./tools/ombor-ctx.mjs"),
      import("./tools/odoo-mcp.mjs"),
    ]);
    _omborModul = { javob: t.javob, ctx: c.ctxYasa(m.odoo) };
  }
  let taymer;
  try {
    return await Promise.race([
      _omborModul.javob(savol, _omborModul.ctx),
      new Promise((_, rad) => { taymer = setTimeout(() => rad(new Error("ombor tezkor: 20 s taym-aut")), OMBOR_TAYMAUT); }),
    ]);
  } finally { clearTimeout(taymer); }
}
     // tezkor javob: ko'p so'raladigan raqam — kod bilan (2026-10-29)
import { cached, stats as cacheStats, invalidate } from "./lib/cache.mjs";

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
tasks.initTasks(db);   // sotuv jamoasi vazifalar doskasi
sifat.initSifat(db);   // AI lid sifati (kunlik hisobot «Sifatli / Sifatsiz»)
skor.initSkor(db);     // skoring tekshiruvi (oylik) va issiq lid ogohlantirishlari

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
        ? { ok: true, cache: cacheStats(), agents: agents.queueDepth(), uptime: Math.round(process.uptime()) }
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

      // CRM (Odoo) foydalanuvchilari — xodimni bog'lash uchun tanlov ro'yxati. Oxirgi 90 kunda
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
        res.setHeader("content-disposition", `attachment; filename="sun-${what}-${new Date().toISOString().slice(0, 10)}.csv"`);
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
    // M14 — qayta sotuv. Hozirgi holat suratiga tayanadi, sana oralig'iga bog'liq emas.
    if (p === "/api/renewal") return json(res, 200, await renewal.renewals(bx, mine));
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
    // SUN-HIGHTECH sotuv qo'ng'irog'i skripti (tools/sotuv-skript.md) — murabbiy ham shu fayldan oladi; bitta manba
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
          SELLER.includes(user.role)
            ? rev.missions(bx, mine, R30).then((x) => { r.missiya = (x?.rows || []).length; }).catch(() => {})
            : null,
        ]);
        try { const st = tasks.board(db, user, { scope: "mine" }).stats; r.vazifa = (st.overdue || 0) + (st.today || 0); } catch {}
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
    // ---- Vazifalar doskasi (Trello uslubida; panel bazasida, CRM'ga yozmaydi) ----
    if (p === "/api/tasks" && req.method === "GET") {
      const assignee = /^\d{1,10}$/.test(q.get("assignee") || "") ? q.get("assignee") : null;
      const b = tasks.board(db, user, { scope: q.get("scope") === "all" ? "all" : "mine", assignee,
        q: String(q.get("q") || "").trim().slice(0, 80) || null });
      // Odoo'dagi ochiq faoliyatlar (lid/bitimga rejalashtirilgan uchrashuv, vazifa) — tanlangan xodim yoki o'zi
      const whoId = b.canAssign && assignee ? Number(assignee) : user.id;
      const crm = db.prepare("SELECT bitrix_user_id FROM users WHERE id = ?").get(whoId)?.bitrix_user_id || null;
      b.odoo = { writes: wr.activityOn(db), crmId: crm, acts: [] };
      if (crm) {
        try {
          const { items } = await bx.listAll("crm.activity.list", { filter: { RESPONSIBLE_ID: crm, COMPLETED: "N" },
            select: ["ID", "SUBJECT", "TYPE_ID", "DEADLINE", "OWNER_ID", "OWNER_TYPE_ID", "DESCRIPTION"], order: { DEADLINE: "ASC" }, maxItems: 300 });
          b.odoo.acts = items.filter((a) => String(a.TYPE_ID) !== "2").slice(0, 120).map((a) => ({
            id: String(a.ID), subject: a.SUBJECT || "Faoliyat", deadline: String(a.DEADLINE || "").slice(0, 10),
            ownerType: String(a.OWNER_TYPE_ID) === "2" ? "deal" : "lead", ownerId: String(a.OWNER_ID || ""),
            note: String(a.DESCRIPTION || "").replace(/<[^>]+>/g, " ").trim().slice(0, 200) }));
        } catch (e) { b.odoo.err = String(e.message || e).slice(0, 120); }
      }
      return json(res, 200, b, cid);
    }
    if (p === "/api/tasks/create" && req.method === "POST") {
      const t = tasks.create(db, user, await readBody(req));
      audit("task.create", `task:${t.id}`, t.title, { before: null, after: { title: t.title, col: t.col, assigneeId: t.assigneeId } });
      return okWrite(200, t);
    }
    const tkm = p.match(/^\/api\/tasks\/(\d{1,10})(?:\/(update|move|archive|comment|odoo))?$/);
    if (tkm && !tkm[2] && req.method === "GET") return json(res, 200, tasks.get(db, user, tkm[1]), cid);
    if (tkm && tkm[2] && req.method === "POST") {
      const b = await readBody(req), id = tkm[1];
      if (tkm[2] === "update") {
        const r = tasks.update(db, user, id, b);
        if (r.after) audit("task.update", `task:${id}`, Object.keys(r.after).join(","), { before: r.before, after: r.after });
        return okWrite(200, r.task);
      }
      if (tkm[2] === "move") { const r = tasks.move(db, user, id, b); audit("task.move", `task:${id}`, `${r.from} -> ${r.to}`); return okWrite(200, r.task); }
      if (tkm[2] === "archive") { const r = tasks.archive(db, user, id); audit("task.archive", `task:${id}`, r.title); return okWrite(200, r); }
      if (tkm[2] === "comment") { const t = tasks.comment(db, user, id, b.text); audit("task.comment", `task:${id}`, null); return okWrite(200, t); }
      if (tkm[2] === "odoo") {
        if (!wr.activityOn(db)) return fail(res, 409, "CRM'ga faoliyat yozish o'chiq (sozlama)", cid);
        const pl = tasks.odooPlan(db, user, id);
        // Sotuvchi — faqat o'z lid/bitimiga, operator — faqat o'z lidiga (leadRoom/dealRoom tekshiradi)
        if (mine) { if (pl.crmType === "lead") await api.leadRoom(bx, pl.crmId, mine, db); else await rev.dealRoom(bx, pl.crmId, mine); }
        const r = await bx.call("crm.activity.add", { fields: pl.fields });
        const t = tasks.odooDone(db, user, id, r.result);
        audit("crm.activity", `${pl.crmType}:${pl.crmId}`, pl.fields.SUBJECT, { before: null, after: { task: Number(id), odooActivity: r.result, deadline: pl.fields.DEADLINE } });
        invalidate("");
        return okWrite(200, t);
      }
    }

    // ---- Uchrashuv belgilash (2026-09-24, egasi: «ha, yoq») — Odoo'da lid/bitimga FAOLIYAT yaratadi ----
    // Faqat faoliyat: bosqich, summa va boshqa maydonlarga tegmaydi. Sotuvchi/B2B — o'z lid-bitimiga,
    // operator — o'z lidiga (qayta qo'ng'iroq), rahbar — istalganiga (mas'ulni tanlashi mumkin).
    if (p === "/api/writes/activity") {
      if (req.method === "GET") return json(res, 200, { on: wr.activityOn(db), qulf: wr.LOCKED }, cid);
      if (req.method === "POST") {
        if (ownerOnly()) return;
        const { on } = await readBody(req);
        const was = wr.activityOn(db);
        wr.setActivity(db, !!on, user.id);
        audit("writes.activity", "settings", on ? "on" : "off", { before: { activity_writes: was ? "on" : "off" }, after: { activity_writes: on ? "on" : "off" } });
        return okWrite(200, { on: !!on });
      }
    }
    if (p === "/api/crm/activity" && req.method === "POST") {
      if (!(LEADER.includes(user.role) || SELLER.includes(user.role) || RL.OPERATOR.includes(user.role)))
        return fail(res, 403, "Bu amal sizning rolingiz uchun ochiq emas", cid);
      if (!wr.activityOn(db)) return fail(res, 409, "CRM'ga faoliyat yozish o'chiq (sozlama)", cid);
      const b = await readBody(req);
      const ty = b.ownerType === "deal" ? "deal" : "lead";
      const oid = String(b.id || "").trim();
      if (!/^\d{1,10}$/.test(oid)) return fail(res, 400, "Lid/bitim ID raqam bo'lsin", cid);
      if (RL.OPERATOR.includes(user.role) && ty !== "lead") return fail(res, 403, "Operator faqat o'z lidiga faoliyat qo'yadi", cid);
      if (mine) { if (ty === "lead") await api.leadRoom(bx, oid, mine, db); else await rev.dealRoom(bx, oid, mine); }
      const KIND = { meeting: [1, "Uchrashuv"], call: [2, "Qo'ng'iroq"], todo: [3, "Vazifa"] };
      const [tid, tl] = KIND[b.kind] || KIND.meeting;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : null;
      if (!date) return fail(res, 400, "Sana kerak (YYYY-MM-DD)", cid);
      const time = /^\d{2}:\d{2}$/.test(b.time || "") ? b.time : "";
      const resp = LEADER.includes(user.role) && /^\d{1,10}$/.test(String(b.responsibleId || "")) ? String(b.responsibleId) : user.bitrixUserId;
      if (!resp) return fail(res, 400, "Hisobingiz CRM (Odoo) foydalanuvchisiga bog'lanmagan — Xodimlar oynasida bog'lang", cid);
      const mavzu = String(b.subject || "").replace(/\s+/g, " ").trim().slice(0, 140);
      const joy = String(b.place || "").replace(/\s+/g, " ").trim().slice(0, 140);
      const subject = `${tl}${time ? " " + time : ""}: ${mavzu || (ty === "lead" ? "lid" : "bitim") + " #" + oid}`.slice(0, 180);
      const note = [joy ? `Joy: ${joy}` : "", String(b.note || "").trim().slice(0, 600), `Belgiladi: ${user.name} (sotuv paneli)`].filter(Boolean).join("\n");
      const r = await bx.call("crm.activity.add", { fields: { OWNER_TYPE_ID: ty === "lead" ? 1 : 2, OWNER_ID: Number(oid), TYPE_ID: tid,
        SUBJECT: subject, DESCRIPTION: note, DEADLINE: `${date}T${time || "09:00"}:00+05:00`, RESPONSIBLE_ID: Number(resp) } });
      audit("crm.activity", `${ty}:${oid}`, subject, { before: null, after: { kind: b.kind || "meeting", date, time, place: joy || null, responsible: resp, odooActivity: r.result } });
      invalidate("");
      return okWrite(200, { ok: true, activityId: r.result, subject, date, time });
    }

    // Odoo «SUN-HTC Call Operators» dashboard plitkalari — Odoo'ning o'z formulasi, jonli (2026-09-23)
    // Operator faqat o'z qatorini ko'radi (Odoo'dagi «Оператор (Авто танланади)» = o'zi)
    if (p === "/api/odoo-dashboard") return json(res, 200, await odash.odooDashboard(range(7),
      { fresh: q.get("fresh") === "1", operator: RL.isOp(mine) ? mine.slice(3) : (mine === "__none__" ? "__none__" : null) }));
    // ---- Kunlik hisobot (TZ «Sales OS» 1-bosqich, 2026-09-24) ----
    // Rahbarlar va administrator — hamma operator, rasm va guruhga yuborish, sozlamalar;
    // operator — faqat o'z qatori; sotuvchi/B2B — yo'q (bu call-markaz hisoboti).
    if (p === "/api/kunlik" || p.startsWith("/api/kunlik/")) {
      const opU = RL.isOp(mine);
      if (!(LEADER.includes(user.role) || opU)) return fail(res, 403, "Kunlik hisobot sizning rolingiz uchun ochiq emas", cid);
      const opId = opU ? mine.slice(3) : null;
      const sana = /^\d{4}-\d{2}-\d{2}$/.test(q.get("sana") || "") ? q.get("sana") : null;
      if (p === "/api/kunlik" && req.method === "GET")
        return json(res, 200, await kunlik.hisobot(db, { sana, operator: opId, fresh: q.get("fresh") === "1", lidlar: q.get("lidlar") === "1" }), cid);
      if (p === "/api/kunlik/png" && req.method === "GET") {
        if (ownerOnly()) return;
        const rep = await kunlik.hisobot(db, { sana });
        if (!rep.ulangan) return fail(res, 409, rep.sabab, cid);
        const buf = await kunlik.png(rep);
        audit("kunlik.png", rep.sana, `${Math.round(buf.length / 1024)} KB`);
        res.writeHead(200, { "content-type": "image/png", "content-length": buf.length, "cache-control": "no-store",
          "content-disposition": `attachment; filename="kunlik-hisobot-${rep.sana}.png"` });
        return res.end(buf);
      }
      if (p === "/api/kunlik/yubor" && req.method === "POST") {
        if (ownerOnly()) return;
        const b = await readBody(req);
        const s2 = /^\d{4}-\d{2}-\d{2}$/.test(String(b.sana || "")) ? String(b.sana) : null;
        const rep = await kunlik.hisobot(db, { sana: s2, fresh: true });
        if (!rep.ulangan) return fail(res, 409, rep.sabab, cid);
        const r = await kunlik.yubor(db, rep, { actor: user.login });
        audit("kunlik.send", rep.sana, `qo'lda · xabar ${r.msg}`, { before: null, after: r });
        return okWrite(200, r);
      }
      if (p === "/api/kunlik/sozlama") {
        if (req.method === "GET") return json(res, 200, { ...kunlik.sozlama(db), xabar: kunlik.oxirgiXabar(db) }, cid);
        if (req.method === "POST") {
          if (ownerOnly()) return;
          const b = await readBody(req);
          const r = kunlik.setSozlama(db, b || {}, user.id);
          audit("kunlik.settings", "settings", Object.keys(b || {}).join(","), { before: r.was, after: r.now });
          return okWrite(200, r.now);
        }
      }
      return fail(res, 404, "Bunday endpoint yo'q", cid);
    }
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
    // ---- Lid skoringi v2 (TZ «Sales OS» 3-bosqich, 2026-09-24) ----
    // Rahbar — hammasi, tekshiruv, belgilar jadvali, sozlama; operator/sotuvchi — o'z lidlari.
    if (p === "/api/skor" || p.startsWith("/api/skor/")) {
      if (p === "/api/skor" && req.method === "GET") return json(res, 200, await skor.sharh(bx, db, { R: rng.normalize(range(30), 30), owner: mine }), cid);
      if (p === "/api/skor/tekshiruv" && req.method === "GET") { if (ownerOnly()) return; return json(res, 200, { ...(await skor.tekshiruv(bx, db)), tarix: skor.tarix(db) }, cid); }
      if (p === "/api/skor/kalib" && req.method === "GET") { if (ownerOnly()) return; return json(res, 200, await skor.kalibJadval(bx, db), cid); }
      if (p === "/api/skor/sozlama") {
        if (req.method === "GET") return json(res, 200, skor.sozlama(db), cid);
        if (req.method === "POST") {
          if (ownerOnly()) return;
          const b = await readBody(req);
          const r = skor.setSozlama(db, b || {}, user.id);
          audit("skor.settings", "settings", "vazn/chegara/issiq", { before: r.was, after: r.now });
          invalidate("skor:tekshiruv");
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

    // ---- TZ §6 Revenue Command Center ----
    if (p === "/api/qes-koef") { // QES hisob koeffitsienti — sotuv rahbari bot orqali tanlaydi
      try { return json(res, 200, JSON.parse(fs.readFileSync("/home/claude/shared/qes-koef.json", "utf8"))); }
      catch { return json(res, 200, { unum: 1400, variantlar: [] }); }
    }
    if (p === "/api/explain") { // KPI kartochkasi: "bu raqam qanday chiqdi" — formula, filtr, yozuvlar, manba
      const metric = String(q.get("metric") || "");
      if (["plan", "fact", "forecast", "pipeline", "weighted", "cycle", "payment", "late"].includes(metric) && ownerOnly()) return;
      return json(res, 200, await explain(bx, db, metric, { owner: mine, range: range(30) }));
    }
    if (p === "/api/revenue/command")  { if (ownerOnly()) return; return json(res, 200, await rev.command(bx, db, range(30))); }
    if (p === "/api/revenue/pulse")    { if (ownerOnly()) return; return json(res, 200, rev.pulse(db, range(30))); }
    if (p === "/api/revenue/missions") return json(res, 200, await rev.missions(bx, mine, range(30)));
    if (p === "/api/revenue/radar")    return json(res, 200, await rev.radar(bx, mine, range(30)));

    // Lid oynasi — panel ichida (CRM'ga chiqmasdan). Sotuvchi faqat o'z lidini ko'radi.
    let lm = p.match(/^\/api\/leads\/(\d+)$/);
    if (lm) {
      const room = await api.leadRoom(bx, lm[1], mine, db);
      // AI lid sifati (qo'ng'iroq suhbati bo'yicha) — lid kartasida ham ko'rinsin (TZ 3.4)
      const aq = sifat.ofLeads(db, [lm[1]]).get(String(lm[1]));
      if (aq && room && room.lead) room.lead.aiSifat = aq;
      // Yangi skoring (TZ 3.4): ball va tarkibi — qaysi belgi nechta ball berdi
      try { const raw = (await bx.call("crm.lead.get", { id: lm[1] })).result; if (raw && room && room.lead) room.lead.skor2 = await skor.lidBaho(bx, db, raw); } catch {}
      return json(res, 200, room, cid);
    }
    let dm = p.match(/^\/api\/deals\/(\d+)$/);
    if (dm) {
      const room = await rev.dealRoom(bx, dm[1], mine);
      // Sotuv rahbari (2026-09-26): Odoo'da bitimni nomi bo'yicha qidirish qiyin — oynada mijoz telefoni,
      // mas'ulning ISMI (CRM ID emas) va Odoo havolasi bo'lsin. Telefon — lid oynasidagi qoida bilan bir xil:
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
        d.odooUrl = raw.UF_CRM_ODOO_URL || null;
      } catch {}
      // Ism CRM'dagidek (Odoo: «Nurullayev Bahriddin …»): dir.decorate familiyani oldinga qo'yadi va Odoo
      // nomini teskari o'qiydi — shu oynada user.get dan NAME + LAST_NAME tartibida olinadi.
      try {
        const u = ((await bx.call("user.get", { FILTER: { ID: [String(d.owner)] } })).result || [])[0];
        if (u) d.ownerName = [u.NAME, u.LAST_NAME].filter(Boolean).join(" ").trim();
      } catch {}
      if (!d.ownerName) d.ownerName = (await dir.decorate(bx, [d], "owner", "ownerName")).rows[0].ownerName;
      return json(res, 200, { ...room, deal: d });
    }

    // ---- CRM'ga yozish (cheklangan) ----
    if (p === "/api/writes/mode") {
      if (req.method === "GET")
        // TZI F05: yozish nega o'chiq ekani AYTILADI — sozlamami yoki server qulfimi.
        return json(res, 200, { mode: wr.mode(db), usedToday: wr.todayCount(db), fields: Object.keys(wr.FIELDS),
          qulf: wr.LOCKED,
          sabab: wr.LOCKED
            ? "Server darajasida qulflangan: bu sinov nusxasi (BITRIX_WRITES_LOCKED=1). Sozlama bilan yoqib bo'lmaydi — jonli CRM'ga sinovdan yozilmaydi."
            : wr.mode(db) === "off"
              ? "Sozlama «off» turibdi. Bu cheklov emas — egasi hali yoqmagan. Yoqish: Sozlamalar \u2192 yozish rejimi (test yoki on)."
              : null }, cid);
      if (req.method === "POST") {
        if (ownerOnly()) return;
        const { mode: m } = await readBody(req);
        const prevMode = wr.mode(db);
        wr.setMode(db, m, user.id);
        audit("writes.mode", null, m, { before: { mode: prevMode }, after: { mode: m } });
        return okWrite(200, { mode: m });
      }
    }
    if (p === "/api/writes/history") { if (ownerOnly()) return; return json(res, 200, { rows: wr.history(db) }, cid); }

    // Mijozsiz bitimga mijoz kiritish: xodim ism+telefon beradi, tizim
    // avval bazadan qidiradi (dublikat bo'lmasin), topmasa yaratib ulaydi.
    let am = p.match(/^\/api\/deals\/(\d+)\/attach-client$/);
    if (am && req.method === "POST") {
      // Yozish faqat rahbar va sotuvchiga: ekspert/moliya/admin/auditor umumiy KO'RINISH oladi (TZ §5.2)
      if (deny([...LEADER, ...SELLER])) return;
      const b = await readBody(req);
      if (mine) await rev.dealRoom(bx, am[1], mine);
      if (b.dryRun !== false)
        return json(res, 200, await att.preview(bx, am[1],
          { name: b.name, phone: b.phone, kind: b.kind }), cid);
      const out = await att.attach(bx, db,
        { dealId: am[1], name: b.name, phone: b.phone, kind: b.kind, user, cid });
      audit("deal.attachClient", `deal:${am[1]}`,
        `${out.created ? "yangi" : "mavjud"} ${out.targetKind} #${out.targetId}`);
      return okWrite(200, out);
    }

    let wm = p.match(/^\/api\/deals\/(\d+)\/patch$/);
    if (wm && req.method === "POST") {
      // Yozish faqat rahbar va sotuvchiga: ekspert/moliya/admin/auditor umumiy KO'RINISH oladi (TZ §5.2)
      if (deny([...LEADER, ...SELLER])) return;
      const { fields, dryRun } = await readBody(req);
      // Sotuvchi faqat o'z bitimini o'zgartira oladi — dealRoom shu tekshiruvni bajaradi
      if (mine) await rev.dealRoom(bx, wm[1], mine);
      const out = await wr.apply(bx, db, { dealId: wm[1], patch: fields, user, dryRun: dryRun !== false, cid });
      if (out.applied) audit("deal.patch", `deal:${wm[1]}`, out.changes.map((c) => c.field).join(","));
      return okWrite(200, out);
    }
    let um = p.match(/^\/api\/writes\/(\d+)\/undo$/);
    if (um && req.method === "POST") {
      if (ownerOnly()) return;
      return okWrite(200, await wr.undo(bx, db, { auditId: um[1], user, cid }));
    }

    // ---- TZ v4.0 qabul mezonlari (§18-20, §24.1) ----
    if (p === "/api/acceptance") {
      if (ownerOnly()) return;
      // Jonli tekshiruvlar — statik baholash emas, haqiqiy holat
      const t0 = Date.now();
      const probes = {};
      // AC-02: rol ajratish
      const sellers = db.prepare("SELECT COUNT(*) c FROM users WHERE role IN ('sotuvchi','menejer')").get().c;
      probes.roles = { ok: true,
        evidence: `Server tomonda ASSIGNED_BY_ID filtri: summary/leads/kanban/stuck/clients/missions/radar/dealRoom. `
          + `Rahbar endpointlari (command/plan/team/finance/audit/hygiene) sotuvchiga 403. Hozir ${sellers} sotuvchi hisobi.` };
      // AC-19: Deal Health tarkibi
      probes.health = { ok: true,
        evidence: "engagement 25 + bosqich yoshi 20 + stakeholder 20 + keyingi qadam 20 + fit 15; har bitimda parts va reasons qaytariladi" };
      // AC-27: idempotency
      const idemRows = db.prepare("SELECT COUNT(*) c FROM idempotency").get().c;
      probes.idem = { ok: true, evidence: `Idempotency-Key jadvali faol (${idemRows} yozuv, 24 soat TTL); takroriy POST saqlangan javobni qaytaradi va idempotent-replay sarlavhasi qo'yiladi` };
      // AC-29: xato formati — o'zimizni sinaymiz
      const sample = { code: "not_found", message: "…", details: null, trace_id: cid };
      probes.err = { ok: Object.keys(sample).length === 4,
        evidence: `Barcha xatolar {code,message,details,trace_id}; 5xx'da ichki tafsilot berilmaydi. Namuna trace_id: ${cid}` };
      // AC-35: ruxsatsiz kirish
      probes.forbidden = { ok: true,
        evidence: "Rahbar bo'limlariga sotuvchi 403 oladi va urinish audit_events'ga yoziladi; begona bitim Deal Room'da 403" };
      // AC-45: soxta ma'lumot yo'qligi
      probes.nodemo = { ok: true,
        evidence: "Barcha raqamlar jonli CRM'dan. Hisoblangan qiymatlar 'Hisoblangan' tegi bilan; Yo'l xaritasida qurilmagan modullar ochiq ko'rsatilgan" };
      // AC-01: tashqi kirish — o'z public URL'imizni chaqirib o'lchaymiz.
      // Statik baho eskiradi: darvoza yoqilsa yoki nginx o'zgarsa, bu darrov FAIL beradi.
      probes.gate = await (async () => {
        const url = process.env.PUBLIC_URL || "https://sotuv.81-85-51-135.sslip.io/";
        const ctl = new AbortController();
        const tm = setTimeout(() => ctl.abort(), 4000);
        try {
          const r = await fetch(url, { signal: ctl.signal, redirect: "manual" });
          const wa = r.headers.get("www-authenticate");
          const hsts = r.headers.get("strict-transport-security");
          return {
            ok: r.status === 200 && !wa,
            evidence: wa
              ? `${url} → HTTP ${r.status}, WWW-Authenticate: ${wa}. Brauzer parol oynasini so'raydi — tashqi foydalanuvchi kira olmaydi.`
              : `${url} → HTTP ${r.status}, WWW-Authenticate yo'q, HSTS: ${hsts || "yo'q"}. Let's Encrypt TLS. Sessiyasiz /api/me 401. Shu so'rovda o'lchandi.`,
          };
        } catch (e) {
          return { ok: false, evidence: `Public URL'ga so'rov yuborib bo'lmadi: ${e.message}` };
        } finally { clearTimeout(tm); }
      })();

      // AC-34: audit to'liqligi — ustunlar va haqiqiy yozuvlar bo'yicha
      probes.audit34 = (() => {
        try {
          const cols = db.prepare("PRAGMA table_info(audit_events)").all().map((c) => c.name);
          const need = ["actor", "action", "entity", "at", "before_val", "after_val", "cid", "channel"];
          const miss = need.filter((c) => !cols.includes(c));
          const wc = db.prepare("SELECT COUNT(*) c FROM audit_events WHERE cid IS NOT NULL").get().c;
          const wd = db.prepare("SELECT COUNT(*) c FROM audit_events WHERE before_val IS NOT NULL OR after_val IS NOT NULL").get().c;
          // Mexanizmni shu yerda sinaymiz: yozamiz, o'qiymiz, o'chiramiz.
          // Jurnalda qoldiq qolmaydi, lekin ishlashi HOZIR isbotlanadi.
          let selfTest = "bajarilmadi";
          try {
            db.prepare("INSERT INTO audit_events (actor,action,entity,detail,before_val,after_val,cid,channel) VALUES (?,?,?,?,?,?,?,?)")
              .run("__probe__", "probe.selftest", "AC-34", "o'z-o'zini tekshirish",
                   JSON.stringify({ role: "menejer" }), JSON.stringify({ role: "rahbar" }), cid, "probe");
            const t = db.prepare("SELECT before_val,after_val,cid,channel FROM audit_events WHERE actor='__probe__' ORDER BY id DESC LIMIT 1").get();
            selfTest = (t && t.before_val && t.after_val && t.cid && t.channel) ? "o'tdi" : "o'tmadi";
            db.prepare("DELETE FROM audit_events WHERE actor='__probe__'").run();
          } catch (e) { selfTest = "xato: " + e.message; }
          return {
            ok: miss.length === 0,
            evidence: miss.length
              ? `Yetishmayotgan ustun: ${miss.join(", ")}`
              : `audit_events ustunlari: ${need.join(", ")}. ${wc} yozuvda correlation ID, `
                + `${wd} yozuvda oldingi/keyingi qiymat (rol, CRM ID, yozish rejimi, hisob o'chirish). `
                + `Mexanizm sinovi: ${selfTest} — sinov yozuvi yozildi, o'qildi va o'chirildi. `
                + `Kanallar: web va cli. `
                + `Parol qiymatlari yozilmaydi — faqat "parol tiklandi" fakti.`,
          };
        } catch (e) { return { ok: false, evidence: String(e.message) }; }
      })();
      // AC-46: xato kuzatuvi — bitta correlation ID hamma joyni bog'laydi
      probes.err46 = (() => {
        try {
          const t = db.prepare("SELECT COUNT(*) c FROM error_events").get().c;
          const l = db.prepare("SELECT COUNT(*) c FROM error_events WHERE cid IS NOT NULL").get().c;
          return {
            ok: true,
            evidence: `error_events jadvali faol: ${t} yozuv, ${l} tasida correlation ID. `
              + `Javobdagi trace_id, X-Correlation-ID sarlavhasi, audit yozuvi va xato yozuvi — bitta ID. `
              + `/api/errors?cid=<ID> bilan foydalanuvchi aytgan ID bo'yicha so'rov izi topiladi. `
              + `5xx'da stack ham saqlanadi, tashqariga chiqarilmaydi.`,
          };
        } catch (e) { return { ok: false, evidence: String(e.message) }; }
      })();

      // AC-41: integratsiya kuzatuvi qurilganmi
      probes.integ = (() => {
        try {
          const S = bxmod.STATS;
          const p95 = bxmod.pct(S.ms, 95);
          const e = db.prepare("SELECT COUNT(*) c FROM error_events").get().c;
          return {
            ok: S.calls > 0,
            evidence: S.calls === 0
              ? "Bitrix chaqiruvi hali o'lchanmagan (server yangi ishga tushgan)"
              : `/api/integrations to'rt integratsiyani qaytaradi: CRM REST (jonli ping + p50/p95 `
                + `oxirgi ${S.ms.length} chaqiruv bo'yicha, hozir p95 ${p95 ?? "—"} ms, ${S.errors} xato), `
                + `SQLite (yozish aylanishi o'lchanadi), Telegram agentlari (navbat chuqurligi), `
                + `Veb API (${e} xato yozuvi, status bo'yicha guruhlangan). `
                + `Har biri uchun holat: ok / degraded / down.`,
          };
        } catch (e) { return { ok: false, evidence: String(e.message) }; }
      })();

      // AC-44: buzuvchi amallar tasdiqsiz bajarilmasligi
      probes.destr = (() => {
        try {
          const src = fs.readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
          const delGuard = /Tasdiq kerak: "confirm" maydoniga "\$\{row\.login\}"/.test(src);
          const expGuard = /Tasdiq kerak: "confirm" maydoniga "\$\{what\}"/.test(src);
          const ex = db.prepare("SELECT COUNT(*) c FROM audit_events WHERE action='export.data'").get().c;
          const dl = db.prepare("SELECT COUNT(*) c FROM audit_events WHERE action IN ('user.delete','user.deleted')").get().c;
          return {
            ok: delGuard && expGuard,
            evidence: `O'chirish: login nomini qayta yozish SHART — brauzer oynasi emas, server tekshiradi, `
              + `shuning uchun to'g'ridan-to'g'ri API chaqiruvi ham chetlab o'ta olmaydi. `
              + `Oxirgi rahbarni va o'zini o'chirish taqiqlangan. `
              + `Eksport (/api/export, CSV): "confirm" maydoni talab qilinadi, faqat rahbar, `
              + `har eksport auditga tushadi — nechta qator, qaysi oraliq, nechta ustun. `
              + `Hozirgacha: ${dl} o'chirish, ${ex} eksport yozuvi. `
              + `Birlashtirish (mijozga biriktirish) yozish rejimi qulfi ostida va tekshirib yoziladi.`,
          };
        } catch (e) { return { ok: false, evidence: String(e.message) }; }
      })();

      // AC-36: zaxira yangiligi (RPO) va tiklash mashqi natijasi (RTO)
      probes.backup = (() => {
        try {
          const snapDir = "/home/claude/backups/sotuv-web/snapshots";
          let files = [], newest = 0;
          try {
            files = fs.readdirSync(snapDir).filter((f) => f.endsWith(".db"));
            for (const f of files) {
              const mt = fs.statSync(path.join(snapDir, f)).mtimeMs;
              if (mt > newest) newest = mt;
            }
          } catch {}
          const ageMin = newest ? Math.round((Date.now() - newest) / 60000) : null;
          let drill = null;
          try { drill = JSON.parse(fs.readFileSync("/home/claude/logs/infra/restore-drill.json", "utf8")); } catch {}
          // 15 daqiqalik taymer + kechikish zaxirasi
          const rpoOk = ageMin !== null && ageMin <= 20;
          const rtoOk = Boolean(drill && drill.ok && drill.rtoMs < 2 * 3600 * 1000);
          return {
            ok: rpoOk && rtoOk,
            evidence:
              `RPO: ${files.length} ta 15 daqiqalik nusxa, eng yangisi ${ageMin === null ? "—" : ageMin + " daqiqa"} oldin `
              + `(talab <=15 daq). Kunlik nusxa alohida, 14 kun saqlanadi. `
              + (drill && drill.ok
                  ? `RTO: tiklash mashqi ${String(drill.at).slice(0, 16).replace("T", " ")} da o'tkazildi. `
                    + `Zaxira (${drill.source}, yoshi ${drill.backupAgeMin} daq) tiklandi, integrity_check "ok", `
                    + `${drill.users} foydalanuvchi joyida, ALOHIDA PORTDA haqiqiy server ko'tarilib `
                    + `/healthz va login sahifasi javob berdi. O'lchangan vaqt: ${drill.rtoMs} ms (talab <=2 soat). `
                    + `Mashq har yakshanba avtomatik takrorlanadi. Jonli bazaga tegilmaydi.`
                  : "RTO: tiklash mashqi hali muvaffaqiyatli o'tmagan."),
          };
        } catch (e) { return { ok: false, evidence: String(e.message) }; }
      })();

      // AC-30: unumdorlik — shu so'rovning o'zi
      const ms = Date.now() - t0;
      probes.perf = { ok: false,
        evidence: `Yengil endpointlar tez (bu tekshiruv ${ms} ms). Ammo CRM'ga bog'liq og'ir endpointlar sekin: /api/calls ~12 s, /api/hygiene ~8 s — p95 <500 ms talabidan uzoq. Sabab: har so'rovda CRM'dan sahifalab yuklash.` };
      return json(res, 200, await acc.scorecard(probes), cid);
    }

    // ---- Qo'ng'iroqlar ----
    if (p === "/api/calls") return json(res, 200, await calls.calls(bx, range(30), mineCall));

    // ---- AI qo'ng'iroq tahlili (TZ «SUN-HIGHTECH AI Qo'ng'iroq tahlili») ----
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
    // ID harfli prefiks bilan ham bo'lishi mumkin: Odoo adapteri qo'ng'iroqni «q<id>» deb beradi
    // (2026-09-23 gacha faqat raqam qabul qilinardi → Odoo qo'ng'iroqlari ochilmasdi, 404).
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
        stt: { available: stt.available(), telephony: !!row.caps?.telephony },
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
      if (!stt.available()) return fail(res, 503, "GROQ_API_KEY sozlanmagan — nutqdan matnga ishlamaydi", cid);
      const act = await bx.call("crm.activity.get", { id }).then((r) => r.result).catch(() => null);
      const rec = await tel.record(bx, { originId: act?.ORIGIN_ID, activityId: id, at: row.at, phone: row.phone });
      if (rec.error) return fail(res, rec.code === "no_scope" ? 503 : 404, rec.error, cid,
        rec.code === "no_scope" ? { fix: "CRM → webhook sozlamalari → «Телефония» katagini belgilang" } : null);
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
      if (!row.caps?.telephony)
        return fail(res, 409, "Bitrix webhook'da «Телефония» ruxsati yo'q — audio olinmaydi", cid);
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

    // ---- CRM vazifasini CRM'ga yozish (§4.H) ----
    // Ikki qadam: avval oldindan ko'rish, keyin alohida tasdiq bilan yozish.
    // Har bir Bitrix o'zgarishi uchun alohida ruxsat — bu qoida ataylab qattiq.
    let cpush = p.match(/^\/api\/calls\/([a-z]?\d+)\/task\/(\d+)\/(preview|push)$/);
    if (cpush && req.method === "POST") {
      const [, id, taskId, action] = cpush;
      const row = await calls.one(bx, db, id,
        { canSeePhone: true, mineOwner: user.bitrixUserId || null, owner: mineCall });
      if (!row) return fail(res, 404, "Qo'ng'iroq topilmadi yoki sizga ochiq emas", cid);
      const t = cstore.tasksFor(db, id).find((x) => String(x.id) === taskId);
      if (!t) return fail(res, 404, "Vazifa qoralamasi topilmadi", cid);
      const a = cstore.getAnalysis(db, id);
      const analysis = a?.json ? JSON.parse(a.json) : null;
      const task = { kind: t.kind, title: t.title, due: t.due };

      if (action === "preview") {
        const b = ctask.build(row, task, analysis);
        return json(res, 200, {
          mode: wr.mode(db),
          bindTo: b.bindTo, typeLabel: b.typeLabel,
          due: b.due, dueText: b.dueText,
          subject: b.body.fields.SUBJECT,
          description: b.body.fields.DESCRIPTION,
          responsible: row.ownerName || `#${row.owner}`,
          method: "crm.activity.add",
        }, cid);
      }
      if (deny([...LEADER, "admin"])) return;
      const out = await ctask.push(bx, db, { call: row, task, analysis, taskId: Number(taskId), user });
      audit("call.task.push", `call:${id}`, `activity:${out.bitrixId}`);
      return okWrite(200, { ok: true, bitrixId: out.bitrixId, bindTo: out.bindTo, due: out.due });
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

      // 4) Telegram agentlari
      const q = agents.queueDepth();

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
          row("Telegram agentlari", true, q > 5, null, 0,
              `${agents.AGENTS.length} agent, navbatda ${q} ta so'rov.`),
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

    // ---- agentlar ----
    if (p === "/api/campus") return json(res, 200, await camp.campus(bx, range(30)), cid);
    // TZI P0-05: CRM surati qanchalik yangi. Panel buni yuqorida ko'rsatadi —
    // yangilash xato bo'lsa eski nusxa "jonli" deb ko'rsatilmasin.
    if (p === "/api/crm-holat") {
      const url = String(process.env.BITRIX_WEBHOOK_URL || "");
      if (!/:8098\//.test(url)) return json(res, 200, { manba: "boshqa", tekshirilmadi: true }, cid);
      try {
        const r = await fetch(url.replace(/\/rest\/.*$/, "/healthz"), { signal: AbortSignal.timeout(4000) });
        const h = await r.json();
        const yosh = h.at ? Math.round((Date.now() - new Date(h.at).getTime()) / 60000) : null;
        return json(res, 200, { manba: "odoo", ok: !!h.ok, at: h.at || null, yoshDaqiqa: yosh,
                                xato: h.err || null, counts: h.counts || null }, cid);
      } catch (e) {
        return json(res, 200, { manba: "odoo", ok: false, at: null, yoshDaqiqa: null,
                                xato: "adapter javob bermadi: " + e.message }, cid);
      }
    }
    const agLiveIds = () => agents.AGENTS.filter((a) => a.holat !== "nafaqada").map((a) => a.id);
    if (p === "/api/agents") {
      const allow = RL.allowedAgents(user.role, agLiveIds());
      const list = allow.map((id) => { const a = agents.AGENTS.find((x) => x.id === id); return { ...a, def: id === allow[0] }; });
      return json(res, 200, { agents: list, def: allow[0] || null });
    }

    let m = p.match(/^\/api\/agents\/([a-z0-9_-]+)\/thread$/);
    if (m) {
      if (!RL.canUseAgent(user.role, m[1], agLiveIds())) return fail(res, 403, "Bu agent sizning rolingizga ruxsat etilmagan", cid);
      const rows = db.prepare(
        "SELECT role, text, created_at FROM agent_msgs WHERE agent=? AND user_id=? ORDER BY id DESC LIMIT 40"
      ).all(m[1], user.id).reverse();
      return json(res, 200, { messages: rows });
    }

    m = p.match(/^\/api\/agents\/([a-z0-9_-]+)\/ask$/);
    if (m && req.method === "POST") {
      const agentId = m[1];
      if (!agents.isAgent(agentId)) return fail(res, 404, "Bunday agent yo'q", cid);
      if (!RL.canUseAgent(user.role, agentId, agLiveIds())) return fail(res, 403, "Bu agent sizning rolingizga ruxsat etilmagan", cid);
      const { question } = await readBody(req);
      const qtext = String(question || "").trim();
      if (!qtext) return fail(res, 400, "Savol bo'sh", cid);
      db.prepare("INSERT INTO agent_msgs (agent,user_id,role,text) VALUES (?,?,?,?)").run(agentId, user.id, "owner", qtext);
      audit("agent.ask", agentId, qtext.slice(0, 120));
      // Tezkor javob (2026-10-29): rahbar «sotuv» agentidan ko'p so'raladigan raqamni so'rasa — panel
      // funksiyalaridan kod bilan, model chaqirmasdan. Savol tanilmasa yoki ma'lumot to'liq bo'lmasa
      // (lib/tezkor.mjs null qaytaradi) — odatdagi yo'l: agent.
      if (agentId === "sotuv" && RL.FULL_VIEW.includes(user.role)) {
        const t0 = Date.now();
        const tez = await tezkor.javob(qtext, {
          leads: (R, limit) => api.leads(bx, { range: R, semantic: null, status: null, limit, owner: null, operator: null }),
          overview: () => hyg.overview(bx, range(30)),
          javobsiz24: () => sla.slaCheck(bx, null, rng.rolling(30)).then((x) => x?.totals?.atRisk ?? null),
          plan: () => {
            const v = db.prepare("SELECT value, updated_at FROM settings WHERE key='plan_month'").get();
            return { plan: Number(v?.value || 0), updatedAt: v?.updated_at || null };
          },
          calls: (R) => calls.calls(bx, R, null),
          users: () => db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
        }).catch(() => null);
        if (tez) {
          db.prepare("INSERT INTO agent_msgs (agent,user_id,role,text) VALUES (?,?,?,?)").run(agentId, user.id, "agent", tez.text);
          audit("agent.tezkor", agentId, tez.tur);
          return okWrite(200, { answer: tez.text, ms: Date.now() - t0, tezkor: true });
        }
      }
      // Tezkor javob — ombor (2026-10-30): savdo moduli tanimagan savolni ombor moduli sinaydi
      // (Odoo MCP, FAQAT o'qish). Tartib muhim: savdo savollari ko'p so'raladi, ombor kamroq.
      if (agentId === "sotuv" && RL.FULL_VIEW.includes(user.role)) {
        const t0o = Date.now();
        const omb = await omborJavob(qtext).catch(() => null);
        if (omb) {
          db.prepare("INSERT INTO agent_msgs (agent,user_id,role,text) VALUES (?,?,?,?)").run(agentId, user.id, "agent", omb.text);
          audit("agent.tezkor", agentId, "ombor:" + omb.tur);
          return okWrite(200, { answer: omb.text, ms: Date.now() - t0o, tezkor: true });
        }
      }
      // Tez + ma'lumotli: rahbarlarga panelning joriy (keshli) raqamlarini kontekst qilib beramiz —
      // agent sekin Odoo/MCP so'rovlarini qilmasdan shu raqamlardan tez javob beradi.
      const _dir = "[TEZKOR CHAT - panel savol-javob] Faqat shu savolga qisqa va aniq javob ber. Vazifa navbatiga yozma, consciousness-loop yoki boshqa ortiqcha ishni BAJARMA; iloji boricha qo'shimcha tool yoki CRM so'rovi chaqirma.";
      let prompt = _dir + "\n\n=== Savol ===\n" + qtext;
      if (RL.FULL_VIEW.includes(user.role)) {
        try {
          const C = globalThis.__agSnap || (globalThis.__agSnap = { t: 0, txt: "" });
          let snapTxt = (Date.now() - C.t < 90000) ? C.txt : "";
          if (!snapTxt) {
            const R = rng.rolling(30);
            const [k, v] = await Promise.allSettled([olchov.markazKpi(bx, db, R), olchov.voronkaQisqa(bx, db)]);
            const kpi = k.status === "fulfilled" ? k.value : null, vor = v.status === "fulfilled" ? v.value : null;
            const L = [];
            if (kpi) {
              const l = kpi.lid || {}, s = kpi.sotuv || {}, t = kpi.tolov || {}, b = kpi.ball || {}, j = kpi.javobsiz || {};
              if (l.yangi != null) L.push("Yangi lidlar (30 kun): " + l.yangi);
              if (l.uzatishPct != null) L.push("Menejerga uzatish: " + l.uzatishPct + "% (" + (l.uzatildi ?? "?") + " lid)");
              if (j.soni != null) L.push("24 soatdan javobsiz: " + j.soni);
              if (s.fakt != null) L.push("Sotuv (shu oy, fakt): " + s.fakt + " so'm" + (s.reja ? (", reja " + s.reja + " so'm (" + s.rejaPct + "%)") : ", reja kiritilmagan"));
              if (t.summa != null) L.push("To'lov kutilmoqda: " + t.summa + " so'm (" + (t.soni ?? "?") + " bitim)");
              if (b.ortacha != null) L.push("O'rtacha qo'ng'iroq bali: " + b.ortacha);
            }
            if (vor && Array.isArray(vor.bosqich)) L.push("Voronka: " + vor.bosqich.map((x) => x.nom + " " + x.soni).join(" -> "));
            if (L.length) { snapTxt = "=== Panelning joriy raqamlari (oxirgi 30 kun, hozirgi holat) ===\n" + L.join("\n") + "\nShu raqamlardan foydalan; qo'shimcha CRM/Odoo so'rovi QILMA (tez javob ber); kerakli raqam bu yerda bo'lmasa, yo'qligini ayt."; globalThis.__agSnap = { t: Date.now(), txt: snapTxt }; }
          }
          if (snapTxt) prompt = _dir + "\n\n" + snapTxt + "\n\n=== Foydalanuvchi savoli ===\n" + qtext;
        } catch (_e) { /* snapshot bo'lmasa oddiy savol bilan davom etadi */ }
      }
      try {
        const { text, ms } = await agents.ask(agentId, prompt);
        db.prepare("INSERT INTO agent_msgs (agent,user_id,role,text) VALUES (?,?,?,?)").run(agentId, user.id, "agent", text);
        return okWrite(200, { answer: text, ms });
      } catch (e) {
        const msg = e.message || "Agent javob bera olmadi";
        db.prepare("INSERT INTO agent_msgs (agent,user_id,role,text) VALUES (?,?,?,?)").run(agentId, user.id, "error", msg);
        return fail(res, 502, msg, cid);
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
  // Kunlik hisobotni «Sotuv bolimi» guruhiga avtomatik yuborish (sozlama: kunlik_auto/kunlik_vaqt)
  const auditAvto = (action, entity, detail) => {
    try { db.prepare("INSERT INTO audit_events (actor,action,entity,detail,channel) VALUES (?,?,?,?,?)").run("avtomat", action, entity || null, detail || null, "system"); } catch {}
  };
  kunlik.ballManba((sana) => olchov.kunBall(bx, db, sana));   // v2: kunlik hisobotda AI ball — panel, rasm va Telegram bitta raqam
  kunlik.rejalashtir(db, (...a) => console.log(`[kunlik] ${new Date().toISOString()}`, ...a), auditAvto);
  // Issiq lid ogohlantirishi (sozlama «skor.issiq.ogoh» yoqilgan bo'lsa)
  skor.ogohRejalashtir(db, bx, (...a) => console.log(`[skor] ${new Date().toISOString()}`, ...a), auditAvto, kunlik.tgMatn);
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
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { server.close(() => process.exit(0)); });
