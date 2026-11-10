// Foydalanuvchilar, parollar (scrypt) va sessiyalar. Tashqi paket yo'q.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 soat

export function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

// Mavjud bo'lmagan loginda ham scrypt ishlab, javob vaqtini tenglashtiradi (login bor-yo'qligini
// vaqt orqali bilib olishning oldini oladi). Preimage hech kimga ma'lum emas — verify har doim false.
export const DUMMY_HASH = hashPassword(randomBytes(18).toString("hex"));

export function verifyPassword(plain, stored) {
  try {
    const [alg, saltHex, keyHex] = String(stored).split("$");
    if (alg !== "scrypt") return false;
    const key = Buffer.from(keyHex, "hex");
    const test = scryptSync(plain, Buffer.from(saltHex, "hex"), key.length);
    return timingSafeEqual(key, test);
  } catch { return false; }
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'menejer',   -- ega | menejer
      pass TEXT NOT NULL,
      bitrix_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS agent_msgs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,           -- owner | agent | error
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_msgs ON agent_msgs(agent, user_id, id);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by INTEGER
    );
    CREATE TABLE IF NOT EXISTS forecast_snapshots (
      date TEXT PRIMARY KEY,
      plan REAL NOT NULL DEFAULT 0, fact REAL NOT NULL DEFAULT 0,
      weighted REAL NOT NULL DEFAULT 0, commit_sum REAL NOT NULL DEFAULT 0,
      gap REAL NOT NULL DEFAULT 0, at_risk REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL, action TEXT NOT NULL, entity TEXT,
      detail TEXT, at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_events(at DESC);
    -- AC-27: Idempotency-Key — bir xil so'rov ikki marta bajarilmaydi
    CREATE TABLE IF NOT EXISTS idempotency (
      key TEXT NOT NULL, route TEXT NOT NULL, user_id INTEGER NOT NULL,
      status INTEGER NOT NULL, body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (key, route, user_id)
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      scope TEXT PRIMARY KEY,        -- 'ip:1.2.3.4' yoki 'login:xurshid'
      fails INTEGER NOT NULL DEFAULT 0,
      first_at INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
  `);
  // MFA ustunlari — eski bazaga ham qo'shiladi (SQLite'da ADD COLUMN IF NOT EXISTS yo'q)
  const cols = new Set(db.prepare("PRAGMA table_info(users)").all().map((c) => c.name));
  const add = (name, decl) => { if (!cols.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${decl}`); };
  add("totp_secret",    "TEXT");
  add("totp_enabled",   "INTEGER NOT NULL DEFAULT 0");
  add("totp_last_step", "INTEGER NOT NULL DEFAULT 0");
  add("totp_backup",    "TEXT");           // JSON: ishlatilmagan zaxira kodlar hash'i
  // Parolni kim qo'ygan: 'admin' — rahbar/CLI yaratgan yoki tiklagan, 'self' — xodim o'zi
  // o'zgartirgan. 'admin' bo'lsa panel kirishda "parolni almashtiring" eslatmasini ko'rsatadi.
  add("pass_set_by",    "TEXT");
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString("base64url");
  const exp = Date.now() + SESSION_TTL_MS;
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)").run(token, userId, exp);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  return { token, exp };
}

export function userFromToken(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.login, u.name, u.role, u.bitrix_user_id, u.totp_enabled, u.pass_set_by, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return { id: row.id, login: row.login, name: row.name, role: row.role,
           bitrixUserId: row.bitrix_user_id, mfa: !!row.totp_enabled,
           passByAdmin: row.pass_set_by === "admin" };
}

export function destroySession(db, token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

// Kirish urinishlarini cheklash — bazada, shuning uchun server restarti bilan nolga qaytmaydi.
// Har bir urinish IP va login bo'yicha alohida sanaladi; qaysi biri to'lsa — bloklanadi.
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

export function checkLock(db, scope) {
  const now = Date.now();
  const r = db.prepare("SELECT * FROM login_attempts WHERE scope = ?").get(scope);
  if (!r) return { locked: false, left: 0 };
  if (r.locked_until > now) return { locked: true, left: Math.ceil((r.locked_until - now) / 60000) };
  if (now - r.first_at > WINDOW_MS) {
    db.prepare("DELETE FROM login_attempts WHERE scope = ?").run(scope);
    return { locked: false, left: 0 };
  }
  return { locked: false, left: 0 };
}

export function noteFail(db, scope, max) {
  const now = Date.now();
  const r = db.prepare("SELECT * FROM login_attempts WHERE scope = ?").get(scope);
  if (!r || now - r.first_at > WINDOW_MS) {
    db.prepare(`INSERT INTO login_attempts (scope, fails, first_at, locked_until) VALUES (?,1,?,0)
                ON CONFLICT(scope) DO UPDATE SET fails=1, first_at=excluded.first_at, locked_until=0`)
      .run(scope, now);
    return 1;
  }
  const fails = r.fails + 1;
  const lock = fails >= max ? now + LOCK_MS : 0;
  db.prepare("UPDATE login_attempts SET fails=?, locked_until=? WHERE scope=?").run(fails, lock, scope);
  return fails;
}

export function clearFails(db, ...scopes) {
  for (const s of scopes) db.prepare("DELETE FROM login_attempts WHERE scope = ?").run(s);
}

// Barcha sessiyalarni bekor qilish (parol o'g'irlangan deb shubha qilinsa).
export function revokeAll(db, userId) {
  return db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId).changes;
}

export const fingerprint = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
