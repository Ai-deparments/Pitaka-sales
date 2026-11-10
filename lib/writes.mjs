// Bitrix24'ga YOZISH — cheklangan va qaytariladigan.
// Prinsip: kam maydon, oldindan ko'rish, oldin/keyin audit, bir bosishda qaytarish.
// O'chirish (delete) va bosqich sakrashi bu modulda umuman yo'q.
import { invalidate } from "./cache.mjs";
import { today } from "./range.mjs";

// Rejimlar: off — umuman yozmaydi | test — kunlik cheklov bilan | on — cheklovsiz
export const MODES = ["off", "test", "on"];
const TEST_DAILY_LIMIT = 20;

// Ruxsat etilgan maydonlar. Boshqa hech narsa yozilmaydi.
export const FIELDS = {
  amount:    { bx: "OPPORTUNITY", label: "Summa",             kind: "money" },
  closeDate: { bx: "CLOSEDATE",   label: "Yopilish sanasi",   kind: "date"  },
  contactId: { bx: "CONTACT_ID",  label: "Kontakt",           kind: "id"    },
  companyId: { bx: "COMPANY_ID",  label: "Kompaniya",         kind: "id"    },
};

const clean = (v) => (v && String(v) !== "0" ? String(v) : null);

function validate(key, raw) {
  const f = FIELDS[key];
  if (!f) throw Object.assign(new Error(`'${key}' maydoniga yozishga ruxsat yo'q`), { status: 400 });
  if (f.kind === "money") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1e13)
      throw Object.assign(new Error("Summa 0 dan katta, real son bo'lishi kerak"), { status: 400 });
    return String(Math.round(n));
  }
  if (f.kind === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw)))
      throw Object.assign(new Error("Sana YYYY-MM-DD ko'rinishida bo'lsin"), { status: 400 });
    return String(raw);
  }
  const id = String(raw || "").trim();
  if (!/^\d{1,10}$/.test(id))
    throw Object.assign(new Error("ID faqat raqam bo'lishi kerak"), { status: 400 });
  return id;
}

// Sinov muhitida (staging) yozish qattiq qulflanadi: baza alohida bo'lsa ham
// Bitrix bitta va jonli — sozlama orqali ham yoqib bo'lmasin.
export const LOCKED = process.env.BITRIX_WRITES_LOCKED === "1";

// Faoliyat yozish (Odoo'da lid/bitimga uchrashuv, qo'ng'iroq, vazifa) — bitim maydonlari (write_mode)
// dan ALOHIDA kalit. Egasi 2026-09-24: «uchrashuv belgilash uchun Odoo'ga yozishni yoq». Summa, sana,
// bosqich yozuvi bunga kirmaydi. Adapter tomonida ham faqat `activity` ochiq (ADAPTER_WRITES).
export function activityOn(db) {
  if (LOCKED) return false;
  return db.prepare("SELECT value FROM settings WHERE key='activity_writes'").get()?.value === "on";
}
export function setActivity(db, on, userId) {
  if (LOCKED) throw Object.assign(new Error("Bu muhitda CRM'ga yozish qulflangan (sinov nusxasi)"), { status: 403 });
  db.prepare(`INSERT INTO settings (key,value,updated_by) VALUES ('activity_writes',?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by,
              updated_at=datetime('now')`).run(on ? "on" : "off", userId);
  return on;
}

export function mode(db) {
  if (LOCKED) return "off";
  return db.prepare("SELECT value FROM settings WHERE key='write_mode'").get()?.value || "off";
}
export function setMode(db, m, userId) {
  if (LOCKED) throw Object.assign(new Error("Bu muhitda Bitrix'ga yozish qulflangan (sinov nusxasi)"), { status: 403 });
  if (!MODES.includes(m)) throw Object.assign(new Error("Rejim: off | test | on"), { status: 400 });
  db.prepare(`INSERT INTO settings (key,value,updated_by) VALUES ('write_mode',?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by,
              updated_at=datetime('now')`).run(m, userId);
  return m;
}
export function todayCount(db) {
  // "Bugun" — Asia/Tashkent bo'yicha. SQLite'ning date('now') UTC beradi: kunlik
  // cheklov 05:00 da nolga qaytar, 00:00–05:00 dagi yozuvlar kechagi kunga tushardi.
  const fromSql = new Date(`${today()}T00:00:00+05:00`).toISOString().slice(0, 19).replace("T", " ");
  return db.prepare(
    "SELECT COUNT(*) c FROM audit_events WHERE action='bitrix.write' AND at >= ?").get(fromSql).c;
}

// Oldindan ko'rish: nima o'zgaradi. Hech narsa yozilmaydi.
export async function preview(bx, dealId, patch) {
  const r = await bx.call("crm.deal.get", { id: dealId }).catch(() => ({}));
  const d = r.result;
  if (!d) throw Object.assign(new Error("Bitim topilmadi"), { status: 404 });
  const changes = [];
  for (const [k, raw] of Object.entries(patch || {})) {
    const f = FIELDS[k];
    if (!f) throw Object.assign(new Error(`'${k}' maydoniga yozishga ruxsat yo'q`), { status: 400 });
    const next = validate(k, raw);
    const prev = f.kind === "money" ? String(Math.round(Number(d[f.bx] || 0)))
               : f.kind === "date"  ? String(d[f.bx] || "").slice(0, 10)
               : clean(d[f.bx]) || "";
    if (String(prev) === String(next)) continue;   // o'zgarish yo'q — yozmaymiz
    changes.push({ field: k, label: f.label, bx: f.bx, before: prev || null, after: next });
  }
  return { dealId: String(d.ID), title: d.TITLE || `Bitim #${d.ID}`, changes };
}

// Yozish. dryRun bo'lsa faqat preview qaytaradi.
export async function apply(bx, db, { dealId, patch, user, dryRun = true, cid }) {
  const m = mode(db);
  if (m === "off")
    throw Object.assign(new Error("Yozish rejimi o'chiq. Sozlamalarda 'test' yoki 'on' qiling."), { status: 403 });

  const pv = await preview(bx, dealId, patch);
  if (dryRun) return { ...pv, applied: false, mode: m };
  if (!pv.changes.length) return { ...pv, applied: false, mode: m, note: "O'zgarish yo'q" };

  if (m === "test") {
    const used = todayCount(db);
    if (used + pv.changes.length > TEST_DAILY_LIMIT)
      throw Object.assign(new Error(
        `Sinov rejimi: kuniga ${TEST_DAILY_LIMIT} ta yozuv. Bugun ${used} ta ishlatilgan.`), { status: 429 });
  }

  const fields = {};
  for (const c of pv.changes) fields[c.bx] = c.after;
  const res = await bx.call("crm.deal.update", { id: dealId, fields });
  if (res.result !== true)
    throw Object.assign(new Error("Bitrix yozuvni qabul qilmadi"), { status: 502 });

  db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
    .run(user.login, "bitrix.write", `deal:${dealId}`,
      JSON.stringify({ cid, mode: m, changes: pv.changes }));
  invalidate("");
  return { ...pv, applied: true, mode: m, undoable: true };
}

// Qaytarish: audit yozuvidagi 'before' qiymatlarini tiklaydi.
export async function undo(bx, db, { auditId, user, cid }) {
  if (LOCKED) throw Object.assign(new Error("Bu muhitda Bitrix'ga yozish qulflangan (sinov nusxasi)"), { status: 403 });
  const row = db.prepare(
    "SELECT * FROM audit_events WHERE id=? AND action='bitrix.write'").get(auditId);
  if (!row) throw Object.assign(new Error("Bunday yozuv topilmadi"), { status: 404 });
  const { changes } = JSON.parse(row.detail || "{}");
  if (!changes?.length) throw Object.assign(new Error("Qaytariladigan o'zgarish yo'q"), { status: 400 });
  const dealId = String(row.entity || "").replace("deal:", "");

  const fields = {};
  for (const c of changes) fields[c.bx] = c.before ?? "";
  const res = await bx.call("crm.deal.update", { id: dealId, fields });
  if (res.result !== true)
    throw Object.assign(new Error("Bitrix qaytarishni qabul qilmadi"), { status: 502 });

  db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
    .run(user.login, "bitrix.undo", `deal:${dealId}`,
      JSON.stringify({ cid, undoneAudit: auditId, restored: changes }));
  invalidate("");
  return { dealId, restored: changes.length };
}

// Yozuvlar tarixi (qaytarish uchun)
export function history(db, limit = 30) {
  return db.prepare(
    `SELECT id, actor, entity, detail, at FROM audit_events
     WHERE action IN ('bitrix.write','bitrix.undo') ORDER BY id DESC LIMIT ?`).all(limit)
    .map((r) => { let d = {}; try { d = JSON.parse(r.detail || "{}"); } catch {}
      return { id: r.id, actor: r.actor, entity: r.entity, at: r.at,
               changes: d.changes || d.restored || [], undone: !!d.undoneAudit }; });
}
