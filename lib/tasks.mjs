// Sotuv jamoasi vazifalari — Trello uslubidagi doska (2026-09-23, egasining talabi).
//
// Nega panel bazasida, Odoo'da emas: Odoo'dagi project.task — o'rnatish loyihalarining 72 qadamli
// shabloni (Координатор, Монтаж гурух, Лойиҳа, Сервис, Бухгалтерия bosqichlari; 51 904 ochiq,
// deyarli hech biri biriktirilmagan). Sotuv jamoasi uchun alohida vazifa ro'yxati Odoo'da yo'q,
// panel CRM'ga yozmaydi (egasi qarori). Shuning uchun doska panelning o'z bazasida; karta lid yoki
// bitimga Odoo ID orqali bog'lanadi (havola), CRM yozuviga tegmaydi.
//
// Ruxsat: rahbarlar (FULL_VIEW) — hamma karta, istalgan xodimga beradi, arxivlaydi.
// Qolganlar — o'ziga biriktirilgan yoki o'zi yaratgan kartalar; yangi kartani faqat o'ziga ochadi.
import { FULL_VIEW } from "./roles.mjs";

export const COLS = [
  { id: "yangi", name: "Yangi" },
  { id: "jarayonda", name: "Jarayonda" },
  { id: "tekshiruv", name: "Tekshiruvda" },
  { id: "bajarildi", name: "Bajarildi" },
];
const COL_IDS = COLS.map((c) => c.id);
export const LABELS = ["Qo‘ng‘iroq", "Uchrashuv", "KP", "Shartnoma", "To‘lov", "Hujjat", "Montaj", "Servis", "Shoshilinch"];

export function initTasks(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      descr TEXT NOT NULL DEFAULT '',
      col TEXT NOT NULL DEFAULT 'yangi',
      pos REAL NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      due TEXT,
      assignee_id INTEGER,
      created_by INTEGER,
      labels TEXT NOT NULL DEFAULT '[]',
      checklist TEXT NOT NULL DEFAULT '[]',
      crm_type TEXT,
      crm_id TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      done_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(archived, col, pos);
    CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_comments ON task_comments(task_id, id);
  `);
  // 2026-09-24: ustundagi yoshi va Odoo bilan bog'lanish (eski bazaga ustun qo'shiladi)
  const bor = new Set(db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name));
  for (const [k, t] of [["moved_at", "TEXT"], ["odoo_activity_id", "TEXT"], ["odoo_pushed_at", "TEXT"]])
    if (!bor.has(k)) db.exec(`ALTER TABLE tasks ADD COLUMN ${k} ${t}`);
}

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const json = (v, d) => { try { const x = JSON.parse(v || ""); return Array.isArray(x) ? x : d; } catch { return d; } };
const isLead = (u) => FULL_VIEW.includes(u.role);
const canSee = (u, t) => isLead(u) || t.assignee_id === u.id || t.created_by === u.id;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function clean(f, u, db, { creating = false } = {}) {
  const out = {};
  if (f.title !== undefined) {
    const t = String(f.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!t) throw bad("Vazifa nomi bo'sh bo'lmasin");
    out.title = t;
  } else if (creating) throw bad("Vazifa nomi kerak");
  if (f.descr !== undefined) out.descr = String(f.descr || "").slice(0, 5000);
  if (f.col !== undefined) { if (!COL_IDS.includes(f.col)) throw bad("Ustun noto'g'ri"); out.col = f.col; }
  if (f.priority !== undefined) out.priority = Math.max(0, Math.min(2, Number(f.priority) || 0));
  if (f.due !== undefined) { const d = String(f.due || ""); if (d && !YMD.test(d)) throw bad("Muddat YYYY-MM-DD bo'lsin"); out.due = d || null; }
  if (f.assigneeId !== undefined) {
    const a = f.assigneeId === null || f.assigneeId === "" ? null : Number(f.assigneeId);
    if (a !== null) {
      if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(a)) throw bad("Xodim topilmadi");
      // Oddiy xodim vazifani faqat o'ziga oladi — boshqaga berish rahbar ishi
      if (!isLead(u) && a !== u.id) throw bad("Vazifani boshqa xodimga faqat rahbar beradi", 403);
    }
    out.assignee_id = a;
  }
  if (f.labels !== undefined) out.labels = JSON.stringify((Array.isArray(f.labels) ? f.labels : []).map(String).filter((x) => LABELS.includes(x)).slice(0, 6));
  if (f.checklist !== undefined) {
    const cl = (Array.isArray(f.checklist) ? f.checklist : []).slice(0, 40)
      .map((x) => ({ t: String(x && x.t || "").trim().slice(0, 200), ok: !!(x && x.ok) })).filter((x) => x.t);
    out.checklist = JSON.stringify(cl);
  }
  if (f.crmType !== undefined || f.crmId !== undefined) {
    const ty = String(f.crmType || ""), id = String(f.crmId || "").trim();
    if (id && !/^\d{1,10}$/.test(id)) throw bad("CRM ID raqam bo'lsin");
    if (id && !["lead", "deal"].includes(ty)) throw bad("CRM turi: lid yoki bitim");
    out.crm_type = id ? ty : null; out.crm_id = id || null;
  }
  return out;
}

function shape(t, names, nComments = 0) {
  const cl = json(t.checklist, []);
  return {
    id: t.id, title: t.title, descr: t.descr, col: t.col, pos: t.pos, priority: t.priority, due: t.due,
    assigneeId: t.assignee_id, assignee: t.assignee_id ? (names.get(t.assignee_id) || `#${t.assignee_id}`) : null,
    createdBy: t.created_by, author: t.created_by ? (names.get(t.created_by) || `#${t.created_by}`) : null,
    labels: json(t.labels, []), checklist: cl, done: cl.filter((x) => x.ok).length,
    crmType: t.crm_type, crmId: t.crm_id, comments: nComments,
    createdAt: t.created_at, updatedAt: t.updated_at, doneAt: t.done_at,
    // Shu ustunda necha kun turibdi (Trello'da yo'q — turib qolgan kartani ko'rsatadi)
    colDays: Math.max(0, Math.floor((Date.now() - Date.parse(String(t.moved_at || t.created_at).replace(" ", "T") + "Z")) / 864e5)),
    odooActivityId: t.odoo_activity_id || null, odooPushedAt: t.odoo_pushed_at || null,
  };
}
const nameMap = (db) => new Map(db.prepare("SELECT id, name FROM users").all().map((r) => [r.id, r.name]));

// Doska: 4 ustun, har birida kartalar (tartib bo'yicha)
export function board(db, u, { scope = "mine", assignee = null, q = null } = {}) {
  let rows = db.prepare("SELECT * FROM tasks WHERE archived = 0 ORDER BY col, pos, id").all();
  rows = rows.filter((t) => canSee(u, t));
  // Rahbar «Menga tegishli» ni tanlasa — faqat o'ziga biriktirilgan/o'zi ochgan (xodim baribir faqat o'zinikini ko'radi)
  if (isLead(u) && scope === "mine") rows = rows.filter((t) => t.assignee_id === u.id || t.created_by === u.id);
  if (assignee) rows = rows.filter((t) => String(t.assignee_id || "") === String(assignee));
  if (q) { const s = String(q).toLowerCase(); rows = rows.filter((t) => (t.title + " " + t.descr).toLowerCase().includes(s) || String(t.crm_id || "") === s); }
  const names = nameMap(db);
  const cnt = new Map(db.prepare("SELECT task_id, COUNT(*) n FROM task_comments GROUP BY task_id").all().map((r) => [r.task_id, r.n]));
  const cards = rows.map((t) => shape(t, names, cnt.get(t.id) || 0));
  const bugun = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  return {
    columns: COLS.map((c) => ({ ...c, cards: cards.filter((x) => x.col === c.id) })),
    labels: LABELS,
    // Kimga berish ro'yxati: rahbarga — hamma xodim, xodimga — faqat o'zi
    users: db.prepare("SELECT id, name, role FROM users ORDER BY name").all()
      .filter((r) => isLead(u) || r.id === u.id).map((r) => ({ id: r.id, name: r.name, role: r.role })),
    canAssign: isLead(u), me: u.id, today: bugun,
    stats: { total: cards.length, overdue: cards.filter((x) => x.due && x.due < bugun && x.col !== "bajarildi").length,
             today: cards.filter((x) => x.due === bugun && x.col !== "bajarildi").length },
  };
}

export function get(db, u, id) {
  const t = db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(id));
  if (!t || !canSee(u, t)) throw bad("Vazifa topilmadi", 404);
  const names = nameMap(db);
  const comments = db.prepare("SELECT id, user_id, text, created_at FROM task_comments WHERE task_id = ? ORDER BY id").all(t.id)
    .map((c) => ({ id: c.id, author: names.get(c.user_id) || `#${c.user_id}`, mine: c.user_id === u.id, text: c.text, at: c.created_at }));
  return { ...shape(t, names, comments.length), comments, canEdit: true, canArchive: isLead(u) || t.created_by === u.id };
}

export function create(db, u, f) {
  const v = clean(f, u, db, { creating: true });
  if (v.assignee_id === undefined) v.assignee_id = u.id;             // standart — o'ziga
  const col = v.col || "yangi";
  const pos = (db.prepare("SELECT MAX(pos) m FROM tasks WHERE col = ? AND archived = 0").get(col).m || 0) + 1;
  const r = db.prepare(`INSERT INTO tasks (title, descr, col, pos, priority, due, assignee_id, created_by, labels, checklist, crm_type, crm_id, done_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.title, v.descr || "", col, pos, v.priority || 0, v.due || null, v.assignee_id,
      u.id, v.labels || "[]", v.checklist || "[]", v.crm_type || null, v.crm_id || null, col === "bajarildi" ? new Date().toISOString() : null);
  return get(db, u, r.lastInsertRowid);
}

export function update(db, u, id, f) {
  const t = db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(id));
  if (!t || !canSee(u, t) || t.archived) throw bad("Vazifa topilmadi", 404);
  const v = clean(f, u, db);
  if (v.col && v.col !== t.col) { v.done_at = v.col === "bajarildi" ? new Date().toISOString() : null; v.moved_at = new Date().toISOString().slice(0, 19).replace("T", " "); }
  const keys = Object.keys(v);
  if (!keys.length) return { task: get(db, u, id), before: null, after: null };
  db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => v[k]), t.id);
  const before = Object.fromEntries(keys.map((k) => [k, t[k]]));
  return { task: get(db, u, id), before, after: v };
}

// Ko'chirish: ustun + joy (oldingi va keyingi karta o'rtasi)
export function move(db, u, id, { col, before = null, after = null } = {}) {
  const t = db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(id));
  if (!t || !canSee(u, t) || t.archived) throw bad("Vazifa topilmadi", 404);
  if (!COL_IDS.includes(col)) throw bad("Ustun noto'g'ri");
  const p = (x) => (x ? db.prepare("SELECT pos FROM tasks WHERE id = ? AND col = ?").get(Number(x), col)?.pos : undefined);
  const a = p(after), b = p(before);   // after — tepadagi karta, before — pastdagi karta
  let pos;
  if (a !== undefined && b !== undefined) pos = (a + b) / 2;
  else if (a !== undefined) pos = a + 1;
  else if (b !== undefined) pos = b - 1;
  else pos = (db.prepare("SELECT MAX(pos) m FROM tasks WHERE col = ? AND archived = 0").get(col).m || 0) + 1;
  const done = col === "bajarildi" ? (t.col === "bajarildi" ? t.done_at : new Date().toISOString()) : null;
  db.prepare(`UPDATE tasks SET col = ?, pos = ?, done_at = ?, updated_at = datetime('now')${col !== t.col ? ", moved_at = datetime('now')" : ""} WHERE id = ?`).run(col, pos, done, t.id);
  return { from: t.col, to: col, task: get(db, u, id) };
}

export function archive(db, u, id) {
  const t = db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(id));
  if (!t || !canSee(u, t) || t.archived) throw bad("Vazifa topilmadi", 404);
  if (!(isLead(u) || t.created_by === u.id)) throw bad("Arxivlashni rahbar yoki vazifani ochgan xodim qiladi", 403);
  db.prepare("UPDATE tasks SET archived = 1, updated_at = datetime('now') WHERE id = ?").run(t.id);
  return { ok: true, title: t.title };
}

export function comment(db, u, id, text) {
  const t = db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(id));
  if (!t || !canSee(u, t)) throw bad("Vazifa topilmadi", 404);
  const s = String(text || "").trim().slice(0, 2000);
  if (!s) throw bad("Izoh bo'sh");
  db.prepare("INSERT INTO task_comments (task_id, user_id, text) VALUES (?,?,?)").run(t.id, u.id, s);
  db.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").run(t.id);
  return get(db, u, id);
}

// ---------------------------------------------------------------------------
// Odoo bilan bog'lanish (2026-09-24): karta lid/bitimga bog'langan bo'lsa — Odoo'da o'sha yozuvga
// FAOLIYAT (uchrashuv / qo'ng'iroq / vazifa) sifatida yuboriladi. Faqat faoliyat: lid bosqichi,
// summa va boshqa maydonlar o'zgarmaydi. Ikki marta yuborilmaydi (odoo_activity_id saqlanadi).
// ---------------------------------------------------------------------------
export function odooPlan(db, u, id) {
  const t = db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(id));
  if (!t || !canSee(u, t) || t.archived) throw bad("Vazifa topilmadi", 404);
  if (!t.crm_id) throw bad("Kartada CRM (lid yoki bitim) ID yo'q — avval bog'lang");
  if (t.odoo_activity_id) throw bad(`Bu karta Odoo'ga yuborilgan (faoliyat #${t.odoo_activity_id})`, 409);
  const who = t.assignee_id || u.id;
  const crm = db.prepare("SELECT bitrix_user_id, name FROM users WHERE id = ?").get(who);
  if (!crm?.bitrix_user_id) throw bad(`${crm?.name || "Xodim"} CRM (Odoo) foydalanuvchisiga bog'lanmagan — Xodimlar oynasida bog'lang`);
  const labels = json(t.labels, []);
  const tur = labels.includes("Uchrashuv") ? 1 : labels.includes("Qo‘ng‘iroq") ? 2 : 3;
  const bugun = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  return {
    task: t, crmType: t.crm_type === "deal" ? "deal" : "lead", crmId: String(t.crm_id),
    fields: {
      OWNER_TYPE_ID: t.crm_type === "deal" ? 2 : 1, OWNER_ID: Number(t.crm_id), TYPE_ID: tur,
      SUBJECT: `${tur === 1 ? "Uchrashuv" : tur === 2 ? "Qo'ng'iroq" : "Vazifa"}: ${t.title}`.slice(0, 180),
      DESCRIPTION: `${String(t.descr || "").slice(0, 400)}${t.descr ? "\n" : ""}Sotuv paneli vazifasi #${t.id}`,
      DEADLINE: `${t.due || bugun}T09:00:00+05:00`, RESPONSIBLE_ID: Number(crm.bitrix_user_id),
    },
  };
}
export function odooDone(db, u, id, activityId) {
  db.prepare("UPDATE tasks SET odoo_activity_id = ?, odoo_pushed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(String(activityId), Number(id));
  return get(db, u, id);
}
