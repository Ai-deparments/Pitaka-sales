// Murabbiy v2 — qo'ng'iroqdan keyin operatorga BITTA aniq vazifa va uni ma'lumotdan tekshirish (2026-11-01).
//
// Qoidalar: har qo'ng'iroqqa ≤1 vazifa (call_id UNIQUE — qayta tahlilda ikkinchisi chiqmaydi), operatorga kuniga ≤6,
// bitta CRM yozuviga (eid) bir vaqtda 1 ochiq vazifa. Muddat Toshkent 09:00–19:00 ga qisiladi, yakshanba — dushanba 11:00.
// Avto-yopish: faqat callback/meeting/qadam, shu operatorning shu eid ga KEYINGI chiquvchi ≥20 s qo'ng'irog'i.
// Hujjat/KP/to'lov — faqat operator «Bajardim» bosganda. eid yo'q vazifa avto-yopilmaydi.
// Faqat matn va bazaga yozish; tarmoq yo'q (yuborishni murabbiy.mjs qiladi).
import { initTasks } from "./tasks.mjs";
import { parseDue } from "./calltask.mjs";
import { tashkentNow } from "./bitrix.mjs";
import { yashir } from "./ertalab.mjs";

export const MAX_KUN = 6;
export const MIN_QADAM_SEK = 90;
export const MIN_TEKSHIR_SEK = 20;
export const QADAM_SOAT = 2;
export const ISH = [9, 19];

const TZ = 5 * 3600e3, H = 3600e3, KUN = 24 * H;
const OCHIQ = "('ochiq','kechikdi')";
const HUJJAT = new Set(["document", "quote", "payment"]);
const TURLAR = new Set(["callback", "meeting", "document", "quote", "payment"]);
const AVTO = new Set(["callback", "meeting", "qadam"]);

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const bor = (v) => v != null && !/^(null|none|undefined|n\/a|yo.?q|—|-|\s*)$/i.test(String(v).trim());
const kes = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const iso = (ms) => new Date(ms).toISOString();
const tk = (ms) => new Date(ms + TZ);                                  // UTC getter'lar = Toshkent devor soati
const tkKun = (ms) => tk(ms).toISOString().slice(0, 10);
const tkHM = (ms) => tk(ms).toISOString().slice(11, 16);
const kunBosh = (ms) => Date.UTC(tk(ms).getUTCFullYear(), tk(ms).getUTCMonth(), tk(ms).getUTCDate()) - TZ;   // Toshkent 00:00 → ms
const tkVaqt = (ms, soat) => kunBosh(ms) + soat * H;                   // shu Toshkent kunining soat:00 i
const pdbVaqt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

// ---------------------------------------------------------------- sxema
export function init(db) {
  initTasks(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER, user_id INTEGER NOT NULL, owner TEXT NOT NULL,
      call_id TEXT UNIQUE, eid TEXT, kind TEXT, text TEXT NOT NULL, due TEXT,
      created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'ochiq',
      closed_at TEXT, closed_by TEXT, evidence TEXT, reminded_at TEXT, note TEXT, chat_id TEXT,
      notified_at TEXT                     -- avto-yopilgani operatorga xabar qilingan (yoki xabarsiz belgilangan) vaqt
    );
    CREATE INDEX IF NOT EXISTS idx_ct_user ON coach_tasks(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ct_eid ON coach_tasks(eid, state);
  `);
  // 2026-11-01 (fix 1): eski jadvalga notified_at; avval avto-yopilganlar qayta xabar qilinmasin
  const ustun = new Set(db.prepare("PRAGMA table_info(coach_tasks)").all().map((c) => c.name));
  if (!ustun.has("notified_at")) {
    db.exec("ALTER TABLE coach_tasks ADD COLUMN notified_at TEXT");
    db.exec("UPDATE coach_tasks SET notified_at=closed_at WHERE closed_by='tekshiruv'");
  }
}

// ---------------------------------------------------------------- muddat
// Ish vaqtiga qisish: 09:00 gacha → shu kun 11:00; 19:00 dan keyin → ertasi 11:00; yakshanba → dushanba 11:00.
export function ishVaqti(ms) {
  const soat = tk(ms).getUTCHours();
  let r = ms;
  if (soat < ISH[0]) r = tkVaqt(ms, 11);
  else if (soat >= ISH[1]) r = tkVaqt(ms + KUN, 11);
  if (tk(r).getUTCDay() === 0) r = tkVaqt(r + KUN, 11);
  return r;
}

// Ish oynasi (du–sha 09:00–19:00 Toshkent): ichida bo'lsa o'zi, aks holda keyingi ish oynasi boshi (09:00; yakshanba o'tkaziladi)
export function ishBoshi(ms) {
  const soat = tk(ms).getUTCHours();
  let r = ms;
  if (soat < ISH[0]) r = tkVaqt(ms, ISH[0]);
  else if (soat >= ISH[1]) r = tkVaqt(ms + KUN, ISH[0]);
  if (tk(r).getUTCDay() === 0) r = tkVaqt(r + KUN, ISH[0]);
  return r;
}

function standartMuddat(tur, now) {
  if (HUJJAT.has(tur)) return tk(now).getUTCHours() >= 16 ? tkVaqt(now + KUN, 12) : tkVaqt(now, 18);
  return tkVaqt(now + KUN, 12);                                       // callback / meeting / boshqa
}

// ---------------------------------------------------------------- taklif
export function taklif(a, call, now = Date.now()) {
  a = a || {};
  const na = a.next_action && typeof a.next_action === "object" ? a.next_action : null;
  const naMatn = na && bor(na.text) ? String(na.text) : "";
  const naOwner = na && bor(na.owner) ? String(na.owner).toLowerCase() : "";
  const vaqt = (tur, dueText) => {
    const p = bor(dueText) ? parseDue(String(dueText), tashkentNow(new Date(now))) : null;
    const ms = p ? Date.parse(p) : NaN;
    // «bugun» → bugun 10:00 kabi o'tib ketgan/juda yaqin muddat tashlanadi (vazifa tug'ilishi bilan kechikmasin) → standart qoida
    return ishVaqti(Number.isFinite(ms) && ms > now + 30 * 60e3 ? ms : standartMuddat(tur, now));
  };
  const mk = (kind, tur, matn, dueText, label) => ({
    kind, type: tur, text: kes(yashir(matn), 200), due: iso(vaqt(tur, dueText)), label: kes(yashir(label), 60),
  });

  if (naMatn && (naOwner === "operator" || !naOwner)) {
    const t = bor(na.type) ? String(na.type).toLowerCase() : "";
    const tur = TURLAR.has(t) ? t : "boshqa";
    return mk("vada", tur, naMatn, na.due, "Keyingi qadam");
  }
  const vadolar = Array.isArray(a.promises) ? a.promises : [];
  const v = vadolar.find((p) => p && p.by === "operator" && bor(p.text));
  if (v) {
    const tur = TURLAR.has(v.type) ? v.type : "boshqa";
    return mk("vada", tur, String(v.text), v.due, bor(v.typeLabel) ? String(v.typeLabel) : "Va'da");
  }
  if (na) return null;                                                 // keyingi qadam bor (mijoz tomonda) — shovqin yo'q
  if (Number(call?.dur) >= MIN_QADAM_SEK) {
    return { kind: "qadam", type: "qadam", text: "Keyingi qadamni belgilang: mijozga qachon va nima bilan qaytasiz?",
      due: iso(ishVaqti(now + QADAM_SOAT * H)), label: "Keyingi qadam" };
  }
  return null;
}

// ---------------------------------------------------------------- yaratish
const qatorOl = (db, id) => db.prepare("SELECT * FROM coach_tasks WHERE id=?").get(id) || null;

export function yarat(db, { userId, owner, chatId, call, a }, now = Date.now()) {
  if (!call?.call_id) return null;
  if (db.prepare("SELECT 1 FROM coach_tasks WHERE call_id=?").get(String(call.call_id))) return null;
  const eid = call.eid != null && bor(call.eid) ? String(call.eid) : null;
  if (eid && db.prepare(`SELECT 1 FROM coach_tasks WHERE eid=? AND state IN ${OCHIQ}`).get(eid)) return null;
  const bosh = kunBosh(now);
  const n = db.prepare("SELECT COUNT(*) n FROM coach_tasks WHERE user_id=? AND created_at>=? AND created_at<?")
    .get(userId, iso(bosh), iso(bosh + KUN)).n;
  if (n >= MAX_KUN) return null;
  const t = taklif(a, call, now);
  if (!t) return null;

  const nom = kes(yashir(call.title || ""), 80);
  const dueMs = Date.parse(t.due);
  const tur = t.type === "qadam" ? "qadam" : t.type;
  const labels = [t.type === "payment" ? "To‘lov" : t.type === "document" ? "Hujjat" : t.type === "quote" ? "KP" : "Qo‘ng‘iroq"];
  const crmTur = call.kind === "lead" || call.kind === "deal" ? call.kind : null;
  const title = kes(t.text, 120);
  const descr = [t.label ? `${t.label}.` : "", nom ? `Mijoz: ${nom}` : "", "Murabbiy (AI qo'ng'iroq tahlili) tavsiyasi."].filter(Boolean).join("\n");
  try {
    db.exec("BEGIN");
    const p = db.prepare(`INSERT INTO tasks (title, descr, col, due, assignee_id, created_by, labels, crm_type, crm_id, moved_at)
      VALUES (?, ?, 'yangi', ?, ?, NULL, ?, ?, ?, ?)`)
      .run(title, descr, tkKun(dueMs), userId, JSON.stringify(labels), eid && crmTur ? crmTur : null, eid && crmTur ? eid : null, pdbVaqt(now));
    const r = db.prepare(`INSERT INTO coach_tasks (task_id, user_id, owner, call_id, eid, kind, text, due, created_at, state, chat_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ochiq', ?)`)
      .run(Number(p.lastInsertRowid), userId, String(owner), String(call.call_id), eid, tur, t.text, t.due, iso(now), chatId != null ? String(chatId) : null);
    db.exec("COMMIT");
    return qatorOl(db, Number(r.lastInsertRowid));
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    if (/UNIQUE/i.test(String(e.message))) return null;
    throw e;
  }
}

// ---------------------------------------------------------------- yopish
function yop(db, t, kim, now, evidence = null, note = null) {
  db.prepare(`UPDATE coach_tasks SET state='bajarildi', closed_at=?, closed_by=?, evidence=COALESCE(?, evidence), note=COALESCE(?, note) WHERE id=?`)
    .run(iso(now), kim, evidence, note, t.id);
  if (t.task_id) db.prepare("UPDATE tasks SET col='bajarildi', done_at=?, updated_at=?, moved_at=? WHERE id=?")
    .run(pdbVaqt(now), pdbVaqt(now), pdbVaqt(now), t.task_id);
}

// Panel ↔ bot sinxroni: operator Murabbiy kartasini panelda «bajarildi» ustuniga olsa — vazifa bajarilgan (closed_by 'panel');
// arxivlasa yoki o'chirsa — 'bekor' (closed_by 'panel'). Telegram xabari yuborilmaydi (notified_at belgilanadi).
// 'bekor' holati: kunStat/jamoa da «berildi» ga kiradi (yaratilgan), «bajarildi» ga KIRMAYDI, ochiq ham, kechikkan ham emas.
function panelSinxron(db, now) {
  const q = db.prepare(`SELECT c.id, c.task_id, p.col, p.archived, (p.id IS NULL) yoq FROM coach_tasks c LEFT JOIN tasks p ON p.id=c.task_id
    WHERE c.state IN ${OCHIQ} AND c.task_id IS NOT NULL`).all();
  const up = db.prepare("UPDATE coach_tasks SET state=?, closed_at=?, closed_by='panel', notified_at=? WHERE id=?");
  for (const r of q) {
    if (r.yoq || r.archived) up.run("bekor", iso(now), iso(now), r.id);
    else if (r.col === "bajarildi") up.run("bajarildi", iso(now), iso(now), r.id);
  }
}

export function tekshir(db, now = Date.now()) {
  const chiqdi = [];
  panelSinxron(db, now);
  const ochiq = db.prepare(`SELECT * FROM coach_tasks WHERE state IN ${OCHIQ} AND eid IS NOT NULL ORDER BY id`).all();
  for (const t of ochiq) {
    if (!AVTO.has(t.kind)) continue;
    const c = db.prepare(`SELECT call_id, at, dur FROM coach_calls WHERE owner=? AND eid=? AND out=1 AND dur>=? AND at>? AND call_id<>?
      ORDER BY at LIMIT 1`).get(String(t.owner), t.eid, MIN_TEKSHIR_SEK, t.created_at, t.call_id || "");
    if (!c) continue;
    const ev = `qo'ng'iroq ${c.call_id} · ${c.dur} s`;
    yop(db, t, "tekshiruv", now, ev);
    chiqdi.push({ id: t.id, user_id: t.user_id, chat_id: t.chat_id, text: t.text, evidence: ev });
  }
  return chiqdi;
}

// Avto-yopilgan, operatorga hali xabar qilinmaganlar (tarmoq xatosida keyingi tekshiruvda qayta urinish uchun)
export function xabarsizlar(db) {
  return db.prepare("SELECT * FROM coach_tasks WHERE state='bajarildi' AND closed_by='tekshiruv' AND notified_at IS NULL ORDER BY id").all();
}
export function xabarlandi(db, id, now = Date.now()) {
  db.prepare("UPDATE coach_tasks SET notified_at=? WHERE id=? AND notified_at IS NULL").run(iso(now), id);
}

// Operatorga yetib bormagan vazifani butunlay o'chirish (coach_tasks + panel tasks): limit, «berildi» va eid bandligiga kirmaydi
export function bekor(db, id) {
  const t = qatorOl(db, Number(id));
  if (!t) return false;
  try {
    db.exec("BEGIN");
    if (t.task_id) db.prepare("DELETE FROM tasks WHERE id=?").run(t.task_id);
    db.prepare("DELETE FROM coach_tasks WHERE id=?").run(t.id);
    db.exec("COMMIT");
  } catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
  return true;
}

// Qayta ulanganda (boshqa Telegram chat) ochiq/kechikkan vazifalar yangi chatga o'tadi — tugmalar ishlashda davom etadi
export function kochir(db, userId, chatId) {
  return Number(db.prepare(`UPDATE coach_tasks SET chat_id=? WHERE user_id=? AND state IN ${OCHIQ}`).run(String(chatId), userId).changes);
}

// ---------------------------------------------------------------- eslatma
export function eslatmalar(db, now = Date.now()) {
  return db.prepare("SELECT * FROM coach_tasks WHERE state='ochiq' AND reminded_at IS NULL AND due IS NOT NULL AND due<=? ORDER BY due, id").all(iso(now));
}
export function eslatildi(db, id, now = Date.now()) {
  db.prepare("UPDATE coach_tasks SET reminded_at=?, state='kechikdi' WHERE id=? AND state='ochiq'").run(iso(now), id);
}

// ---------------------------------------------------------------- operator amali
export function belgila(db, id, { chatId, amal, note } = {}, now = Date.now()) {
  const t = qatorOl(db, Number(id));
  if (!t || !t.chat_id || String(chatId) !== t.chat_id) return null;
  if (!["ok", "surish", "sabab"].includes(amal)) return null;
  if (t.state !== "ochiq" && t.state !== "kechikdi") return t;       // bajarildi / bekor — yopilgan, o'zgarmaydi
  if (amal === "ok") yop(db, t, "operator", now, null, bor(note) ? kes(note, 500) : null);
  else if (amal === "surish") {
    const yangi = ishVaqti(Math.max(Date.parse(t.due) || now, now) + H);
    db.prepare("UPDATE coach_tasks SET due=?, reminded_at=NULL, state='ochiq' WHERE id=?").run(iso(yangi), t.id);
    if (t.task_id) db.prepare("UPDATE tasks SET due=?, updated_at=? WHERE id=?").run(tkKun(yangi), pdbVaqt(now), t.task_id);
  } else db.prepare("UPDATE coach_tasks SET note=? WHERE id=?").run(kes(note, 500), t.id);
  return qatorOl(db, t.id);
}

export function ochiqlar(db, userId) {
  return db.prepare(`SELECT * FROM coach_tasks WHERE user_id=? AND state IN ${OCHIQ} ORDER BY due, id`).all(userId);
}

// ---------------------------------------------------------------- ko'rinish
// Toshkent «dd.mm HH:MM» (bot ro'yxatlari ham shuni ishlatadi)
export function muddatKunSoat(isoStr) {
  const ms = Date.parse(isoStr || "");
  if (!Number.isFinite(ms)) return "—";
  const s = tk(ms).toISOString();
  return `${s.slice(8, 10)}.${s.slice(5, 7)} ${s.slice(11, 16)}`;
}
export function qator(t) {
  const ms = Date.parse(t.due);
  return `📌 <b>Vazifa #${t.id}:</b> ${esc(t.text)}${Number.isFinite(ms) ? ` · muddat ${muddatKunSoat(t.due)}` : ""}`;
}
export function tugmalar(id) {
  return { inline_keyboard: [
    [{ text: "✅ Bajardim", callback_data: `mv:ok:${id}` }, { text: "⏰ +1 soat", callback_data: `mv:surish:${id}` }],
    [{ text: "💬 Sabab", callback_data: `mv:sabab:${id}` }],
  ] };
}

// sana — Toshkent kuni «YYYY-MM-DD»
export function kunStat(db, userId, sana) {
  const bosh = Date.parse(`${sana}T00:00:00+05:00`), oxir = bosh + KUN;
  const q = (sql, ...p) => db.prepare(sql).get(userId, ...p).n;
  return {
    berildi: q("SELECT COUNT(*) n FROM coach_tasks WHERE user_id=? AND created_at>=? AND created_at<?", iso(bosh), iso(oxir)),
    // berildi bilan BIR XIL aholi: shu kuni yaratilganlardan bajarilganlari ('bekor' bajarilgan emas)
    bajarildi: q("SELECT COUNT(*) n FROM coach_tasks WHERE user_id=? AND state='bajarildi' AND created_at>=? AND created_at<?", iso(bosh), iso(oxir)),
    ochiq: q("SELECT COUNT(*) n FROM coach_tasks WHERE user_id=? AND state='ochiq'"),
    kechikdi: q("SELECT COUNT(*) n FROM coach_tasks WHERE user_id=? AND state='kechikdi'"),
  };
}
