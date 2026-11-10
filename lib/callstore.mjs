// Qo'ng'iroq tahlili uchun saqlash qatlami (sqlite).
// TZ §10: bir xil call ID ikki marta qayta ishlanmasin — transkript hash'i bo'yicha idempotency.
// TZ §9: har bir ko'rish/tinglash/eksport/tahrir auditga yozilsin.

import { createHash } from "node:crypto";
import { DEFAULT_DICT } from "./calldict.mjs";

export const sha = (s) => createHash("sha256").update(String(s || "")).digest("hex").slice(0, 32);

export function initCallSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS call_transcripts (
      call_id   TEXT PRIMARY KEY,
      source    TEXT NOT NULL DEFAULT 'manual',   -- manual | stt | import
      text      TEXT NOT NULL,
      original  TEXT,                             -- birinchi kiritilgan nusxa (§4.I audit)
      lang      TEXT,
      added_by  INTEGER, added_at  TEXT NOT NULL DEFAULT (datetime('now')),
      edited_by INTEGER, edited_at TEXT
    );
    CREATE TABLE IF NOT EXISTS call_analyses (
      call_id        TEXT PRIMARY KEY,
      status         TEXT NOT NULL DEFAULT 'queued',  -- queued | running | ready | error
      engine         TEXT,                            -- rules | ai+rules
      json           TEXT,
      score          INTEGER, risk TEXT, sentiment TEXT, topic TEXT, urgency TEXT,
      confidence     REAL,
      model_version  TEXT, prompt_version TEXT,
      attempts       INTEGER NOT NULL DEFAULT 0,
      error          TEXT,
      hash           TEXT,
      ms             INTEGER,
      analyzed_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ca_status ON call_analyses(status);
    CREATE INDEX IF NOT EXISTS idx_ca_risk   ON call_analyses(risk);
    CREATE TABLE IF NOT EXISTS call_reviews (
      call_id TEXT PRIMARY KEY, actor TEXT NOT NULL, note TEXT,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS call_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT NOT NULL, field TEXT NOT NULL,
      before TEXT, after TEXT, actor TEXT NOT NULL,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ce_call ON call_edits(call_id, id);
    CREATE TABLE IF NOT EXISTS call_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
      due TEXT, owner TEXT, by_ai INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'draft',        -- draft | confirmed | pushed | failed
      bitrix_id TEXT, detail TEXT,
      actor TEXT, at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ct_call ON call_tasks(call_id);
    -- TZ §2.8, §7: kritik holatda rahbar ogohlantiriladi.
    -- Xabar tarkibi tahlil vaqtida saqlanadi — yuboruvchi skript Bitrix'ga qaytib
    -- murojaat qilmasin va sekinlashmasin. Yuborilgani sent_at bilan belgilanadi,
    -- shuning uchun bir qo'ng'iroq ikki marta xabar bermaydi.
    CREATE TABLE IF NOT EXISTS call_alerts (
      call_id    TEXT PRIMARY KEY,
      risk       TEXT NOT NULL,
      score      INTEGER,
      payload    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at    TEXT,
      error      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ca_pending ON call_alerts(sent_at, created_at);
    CREATE TABLE IF NOT EXISTS call_dict (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      color TEXT NOT NULL, kind TEXT NOT NULL, term TEXT NOT NULL UNIQUE,
      reason TEXT, tip TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Lug'at bo'sh bo'lsa — zavod sozlamasidan to'ldiriladi
  if (!db.prepare("SELECT COUNT(*) c FROM call_dict").get().c) {
    const ins = db.prepare("INSERT OR IGNORE INTO call_dict (color,kind,term,reason,tip) VALUES (?,?,?,?,?)");
    for (const d of DEFAULT_DICT) ins.run(d.color, d.kind, d.term, d.reason, d.tip);
  }
}

// ---------------------------------------------------------------- lug'at
export function getDict(db) {
  return db.prepare("SELECT id,color,kind,term,reason,tip,enabled FROM call_dict ORDER BY color, term").all();
}
export const activeDict = (db) => getDict(db).filter((d) => d.enabled);

export function addTerm(db, { color, kind, term, reason, tip }, userId) {
  const colors = ["red", "yellow", "green", "blue"], kinds = ["pain", "objection", "risk", "buy"];
  const t = String(term || "").trim().toLowerCase();
  if (t.length < 2 || t.length > 60) throw Object.assign(new Error("Ibora 2–60 belgi bo'lsin"), { status: 400 });
  if (!colors.includes(color)) throw Object.assign(new Error("Rang: red | yellow | green | blue"), { status: 400 });
  if (!kinds.includes(kind)) throw Object.assign(new Error("Turi: pain | objection | risk | buy"), { status: 400 });
  db.prepare(`INSERT INTO call_dict (color,kind,term,reason,tip,updated_by) VALUES (?,?,?,?,?,?)
              ON CONFLICT(term) DO UPDATE SET color=excluded.color, kind=excluded.kind,
                reason=excluded.reason, tip=excluded.tip, enabled=1,
                updated_by=excluded.updated_by, updated_at=datetime('now')`)
    .run(color, kind, t, String(reason || "").slice(0, 300), String(tip || "").slice(0, 300), userId);
  return t;
}
export function toggleTerm(db, id, enabled, userId) {
  const r = db.prepare("UPDATE call_dict SET enabled=?, updated_by=?, updated_at=datetime('now') WHERE id=?")
    .run(enabled ? 1 : 0, userId, id);
  if (!r.changes) throw Object.assign(new Error("Ibora topilmadi"), { status: 404 });
}

// ---------------------------------------------------------------- transkript
export function getTranscript(db, callId) {
  return db.prepare("SELECT * FROM call_transcripts WHERE call_id=?").get(String(callId)) || null;
}
export function putTranscript(db, callId, text, { source = "manual", lang = null, userId = null, actor = "?" }) {
  const id = String(callId);
  const t = String(text || "").trim();
  if (t.length < 20) throw Object.assign(new Error("Transkript juda qisqa (kamida 20 belgi)"), { status: 400 });
  if (t.length > 400000) throw Object.assign(new Error("Transkript juda katta"), { status: 413 });
  const prev = getTranscript(db, id);
  if (prev) {
    // TZ §4.I: original va tahrirlangan versiya auditda saqlanadi
    // Qayta nutqdan matnga (masalan Groq → Gemini) — manba ham yangilanadi. Ilgari yangilanmasdi va «sifatni
    // yangilash» bir xil qo'ng'iroqlarni har siklda qayta o'girardi (2026-09-25: bitta qo'ng'iroq 70 martagacha).
    // Xodim tahriri (source=manual) — asl manba saqlanadi, edited_by belgilanadi.
    const stt = /^stt:/.test(String(source || ""));
    db.prepare(`UPDATE call_transcripts SET text=?, lang=COALESCE(?,lang), edited_by=?, edited_at=datetime('now')${stt ? ", source=?" : ""} WHERE call_id=?`)
      .run(...(stt ? [t, lang, userId, source, id] : [t, lang, userId, id]));
    db.prepare("INSERT INTO call_edits (call_id,field,before,after,actor) VALUES (?,?,?,?,?)")
      .run(id, "transcript", prev.text.slice(0, 20000), t.slice(0, 20000), actor);
  } else {
    db.prepare("INSERT INTO call_transcripts (call_id,source,text,original,lang,added_by) VALUES (?,?,?,?,?,?)")
      .run(id, source, t, t, lang, userId);
  }
  return { changed: !!prev, hash: sha(t) };
}

// ---------------------------------------------------------------- tahlil
export const getAnalysis = (db, callId) =>
  db.prepare("SELECT * FROM call_analyses WHERE call_id=?").get(String(callId)) || null;

export function analysesFor(db, ids) {
  if (!ids.length) return new Map();
  const q = ids.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT call_id,status,engine,score,risk,sentiment,topic,urgency,confidence,error,analyzed_at
     FROM call_analyses WHERE call_id IN (${q})`).all(...ids.map(String));
  return new Map(rows.map((r) => [r.call_id, r]));
}

export function markRunning(db, callId, hash) {
  db.prepare(`INSERT INTO call_analyses (call_id,status,hash,attempts) VALUES (?,'running',?,1)
              ON CONFLICT(call_id) DO UPDATE SET status='running', hash=excluded.hash,
              attempts=call_analyses.attempts+1, error=NULL`).run(String(callId), hash);
}
export function saveAnalysis(db, callId, result, { engine, ms, hash }) {
  const s = result.summaryRow || {};
  db.prepare(`INSERT INTO call_analyses
      (call_id,status,engine,json,score,risk,sentiment,topic,urgency,confidence,model_version,prompt_version,hash,ms,analyzed_at,error)
      VALUES (?,'ready',?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),NULL)
      ON CONFLICT(call_id) DO UPDATE SET status='ready', engine=excluded.engine, json=excluded.json,
        score=excluded.score, risk=excluded.risk, sentiment=excluded.sentiment, topic=excluded.topic,
        urgency=excluded.urgency, confidence=excluded.confidence, model_version=excluded.model_version,
        prompt_version=excluded.prompt_version, hash=excluded.hash, ms=excluded.ms,
        analyzed_at=datetime('now'), error=NULL`)
    .run(String(callId), engine, JSON.stringify(result), s.score ?? null, s.risk ?? null,
         s.sentiment ?? null, s.topic ?? null, s.urgency ?? null, s.confidence ?? null,
         result.model_version, result.prompt_version, hash, ms);
}
export function failAnalysis(db, callId, message, hash) {
  // attempts oshadi — konveyer 3 martadan keyin bu qo'ng'iroqni tark etadi (TZ §6.7).
  // Ilgari oshmasdi va cheksiz qayta urinish xavfi bor edi.
  db.prepare(`INSERT INTO call_analyses (call_id,status,error,hash,attempts) VALUES (?,'error',?,?,1)
              ON CONFLICT(call_id) DO UPDATE SET status='error', error=excluded.error,
                hash=COALESCE(excluded.hash, call_analyses.hash),
                attempts=call_analyses.attempts+1`)
    .run(String(callId), String(message).slice(0, 500), hash);
}

// ---------------------------------------------------------------- ko'rib chiqish / tahrir / vazifa
export function review(db, callId, actor, note) {
  db.prepare(`INSERT INTO call_reviews (call_id,actor,note) VALUES (?,?,?)
              ON CONFLICT(call_id) DO UPDATE SET actor=excluded.actor, note=excluded.note, at=datetime('now')`)
    .run(String(callId), actor, String(note || "").slice(0, 500));
}
export const getReview = (db, callId) =>
  db.prepare("SELECT actor,note,at FROM call_reviews WHERE call_id=?").get(String(callId)) || null;

export function editField(db, callId, field, before, after, actor) {
  db.prepare("INSERT INTO call_edits (call_id,field,before,after,actor) VALUES (?,?,?,?,?)")
    .run(String(callId), String(field).slice(0, 60), JSON.stringify(before ?? null).slice(0, 8000),
         JSON.stringify(after ?? null).slice(0, 8000), actor);
}
export const editsFor = (db, callId) =>
  db.prepare("SELECT id,field,actor,at FROM call_edits WHERE call_id=? ORDER BY id DESC LIMIT 50").all(String(callId));

export function addTask(db, callId, t, actor) {
  const r = db.prepare(`INSERT INTO call_tasks (call_id,kind,title,due,owner,by_ai,state,detail,actor)
                        VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(String(callId), t.kind || "callback", String(t.title || "").slice(0, 300),
         t.due || null, t.owner || null, t.byAi ? 1 : 0, t.state || "draft",
         String(t.detail || "").slice(0, 1000), actor);
  return Number(r.lastInsertRowid);
}
export const tasksFor = (db, callId) =>
  db.prepare("SELECT * FROM call_tasks WHERE call_id=? ORDER BY id DESC").all(String(callId));
export function setTaskState(db, id, state, extra = {}) {
  db.prepare("UPDATE call_tasks SET state=?, bitrix_id=COALESCE(?,bitrix_id), detail=COALESCE(?,detail) WHERE id=?")
    .run(state, extra.bitrixId || null, extra.detail || null, id);
}

// ---------------------------------------------------------------- statistika (§7 rahbar paneli)
export function qualityStats(db, callIds) {
  if (!callIds.length) return { n: 0 };
  const q = callIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT call_id,score,risk,sentiment,json,analyzed_at FROM call_analyses
     WHERE status='ready' AND call_id IN (${q})`).all(...callIds.map(String));
  return { rows };
}

// ---------------------------------------------------------------- ogohlantirish navbati
const ALERT_RISKS = ["critical", "high"];
export function queueAlert(db, callId, analysis, call) {
  const risk = analysis?.deal_risk?.level;
  if (!ALERT_RISKS.includes(risk)) return false;
  // Eng kuchli dalil — mijoz aytgan tahdid/e'tiroz, vaqt kodi bilan
  const m = (analysis.critical_moments || [])
    .filter((x) => x.speaker === "customer" && (x.kind === "risk" || x.kind === "objection"))
    .sort((a, b) => (a.kind === "risk" ? -1 : 1) - (b.kind === "risk" ? -1 : 1))[0] || null;
  const payload = {
    client: call?.entity?.title || null,
    entity: call?.entity ? { kind: call.entity.kind, id: call.entity.id, label: call.entity.label } : null,
    owner: call?.ownerName || (call?.owner ? `#${call.owner}` : null),
    at: call?.at || null, durSec: call?.dur ?? null,
    deal: call?.deal ? { id: call.deal.id, title: call.deal.title, stage: call.deal.stageName,
                         amount: call.deal.amount, currency: call.deal.currency } : null,
    topic: analysis.topic || null,
    sentiment: analysis.sentiment?.overall || null,
    urgency: analysis.urgency?.level || null,
    reasons: (analysis.deal_risk?.reasons || []).slice(0, 3),
    quote: m ? { text: m.quote, ts: m.ts, term: m.term, reason: m.reason, tip: m.tip } : null,
    next: analysis.next_action ? { text: analysis.next_action.text, due: analysis.next_action.due } : null,
    engine: analysis.engine,
  };
  db.prepare(`INSERT INTO call_alerts (call_id,risk,score,payload) VALUES (?,?,?,?)
              ON CONFLICT(call_id) DO UPDATE SET risk=excluded.risk, score=excluded.score,
                payload=excluded.payload,
                -- xavf darajasi oshsa qayta yuboriladi, aks holda yo'q
                sent_at=CASE WHEN call_alerts.risk='high' AND excluded.risk='critical' THEN NULL ELSE call_alerts.sent_at END`)
    .run(String(callId), risk, analysis.operator_score?.total ?? null, JSON.stringify(payload));
  return true;
}
export const pendingAlerts = (db, limit = 20) =>
  db.prepare("SELECT call_id,risk,score,payload,created_at FROM call_alerts WHERE sent_at IS NULL ORDER BY created_at LIMIT ?")
    .all(limit).map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
export const markAlertSent = (db, callId, error = null) =>
  db.prepare("UPDATE call_alerts SET sent_at=datetime('now'), error=? WHERE call_id=?").run(error, String(callId));
