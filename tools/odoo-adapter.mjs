#!/usr/bin/env node
// =============================================================================
// odoo-adapter.mjs — Odoo (MCP) → Bitrix24-dialekt REST adapteri (MD §10.2).
//
// Panel va agent skriptlari Bitrix24 REST tilida gapiradi (crm.lead.list, crm.deal.list,
// crm.status.list, user.get …). Bu xizmat o'sha tilni qabul qilib, ma'lumotni Odoo'dan
// oladi. Ishlash tartibi: har REFRESH soniyada Odoo'dan snapshot (xotirada), so'rovlar
// snapshot ustida bajariladi (mock-bitrix.mjs bilan bir xil filtr/sahifalash qatlami).
//
//   node tools/odoo-adapter.mjs [--port 8098] [--host 127.0.0.1] [--refresh 300] [--readonly]
//   BITRIX_WEBHOOK_URL=http://127.0.0.1:8098/rest/1/odoo/
//
// Xarita (Odoo → Bitrix):
//   crm.lead «Tushgan Lead»   → LEAD   (Odoo dashboard formulasi; STATUS_ID = dashboard holati, CONVERTED/JUNK)
//   crm.lead type=opportunity → DEAL   (CATEGORY_ID: jamoa/Сотув тури; STAGE_ID = bosqich; WON = is_won)
//   sale.order state=sale (CRM'ga bog'lanmagan) → DEAL WON (ID = 1000000 + so.id) — sotuv haqiqati
//   res.users (ichki)         → user.get
//   crm.stage                 → crm.status.list (STATUS + DEAL_STAGE[_n])
//   crm.team                  → crm.dealcategory.list
//   res.partner               → crm.contact / crm.company
//   crm.lead.activity_*       → crm.activity.list (TYPE_ID=3, bajarilmagan)
//   telefoniya: scope'da yo'q → 'telephony' scope qaytarilmaydi (panel o'zi o'chiradi)
// Yozuvlar (crm.deal.update, crm.lead.update, crm.activity.add) → Odoo write/activity_schedule;
// --readonly yoki BITRIX_WRITES_LOCKED=1 bo'lsa rad etiladi (staging).
// =============================================================================
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Odoo } from "./odoo-avtomat/mcp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : d; };
const CFG = {
  host: String(opt("host", process.env.ADAPTER_HOST || "127.0.0.1")),
  port: Number(opt("port", process.env.ADAPTER_PORT || 8098)),
  refresh: Number(opt("refresh", process.env.ADAPTER_REFRESH || 600)),
  pace: Number(process.env.ADAPTER_PACE_MS || 1200),
  readonly: opt("readonly", false) === true || process.env.BITRIX_WRITES_LOCKED === "1" || process.env.ADAPTER_READONLY === "1",
  // Qulf ichida ham ruxsat etilgan yozuv turlari (2026-09-24, egasi: «uchrashuv belgilash uchun yoq»):
  //   activity — crm.activity.add (Odoo'da lid/bitimga faoliyat: uchrashuv, qo'ng'iroq, vazifa)
  // Bosqich, summa va boshqa maydonlarni o'zgartirish (crm.lead/deal.update) qulfligicha qoladi.
  writes: new Set(String(process.env.ADAPTER_WRITES || "").split(",").map((x) => x.trim()).filter(Boolean)),
  pageSize: 50,
  tzMin: 300,
  daysBack: Number(process.env.ADAPTER_DAYS_BACK || 400),
  portal: process.env.ODOO_PORTAL || "https://getgreen.biznesim.uz",
  teams: String(process.env.ADAPTER_TEAMS || "12,41,42,44").split(",").map((x) => Number(x.trim())).filter(Boolean), // SUN-HIGHTECH jamoalari
  company: Number(process.env.ADAPTER_COMPANY || 2), // SUN-HIGHTECH
  hrTeams: String(process.env.ADAPTER_HR_TEAMS || "41,42").split(",").map((x) => Number(x.trim())).filter(Boolean), // Ish Montajnik / Ish Savdo — xodim yollash voronkalari, sotuv EMAS
};

// ---------------------------------------------------------------------------
// LID TA'RIFI = Odoo dashboard (2026-09-23, sotuv rahbari ko'rsatgan manba)
// My Dashboard → «SUN-HTC Call Operators» plitkalari. Formulalar qo'lda qayta yozilmaydi:
// tools/sun-dashboard.json ga Odoo'ning o'zidan (ks_dashboard_ninja.item) aynan ko'chirilgan.
// Dashboard o'zgarsa — faqat shu faylni yangilash kifoya.
// ---------------------------------------------------------------------------
const DASH = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "sun-dashboard.json"), "utf8"));
const OP_FIELD = "x_studio_hech_kim_tegmasin_";             // «Оператор (Авто танланади)» → res.users
const PIPE_FIELD = "x_studio_selection_field_2nm_1jlotirc1";  // lid holati — dashboard ustunlari shu maydonga qaraydi
const KV_FIELD = "x_studio_estimation";                      // «Керакли қувват», kVt
const CLIENT_TYPE = { B2B: "B2B", B2C: "B2C", B2G: "B2G", Gigawatt: "Zaryatniy stansiya", GetGreen: "GetGreen" };
// Holat qiymati → [panel kodi, nomi]. Nomlar Odoo tanlovidagi bilan bir xil.
const PIPE = { status1: ["NEW", "Янги лид"], status3: ["IN_PROCESS", "Жараёнда"], status4: ["UC_1_6", "1-6 ой"], "Кп": ["UC_KP", "Кп"],
  status5: ["UC_SHARTNOMA", "Шартнома"], status6: ["UC_SERVIS", "Сервис"], "Перезвон": ["UC_PEREZVON", "Перезвон"] };

// Skoring (TZ 3-modul) uchun lid belgilari — Odoo Studio maydonlari (90 kunda ~40% to'ldirilgan)
const SKOR_F = ["x_studio_maqsad_2", "x_studio_probability_new", "x_studio_stansiya_kwt", "x_studio_selection_field_3cu_1jloqho34",
  "x_studio_tolov_usuli", "x_rejalashtirilgan_ornatish_muddati", "x_studio_when", "x_studio_where"];
const tozaTanlov = (v) => String(v || "").replace(/^\s*\d+\.\s*/, "").replace(/[?？]\s*$/, "").trim();

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
// Odoo sanasi doim UTC va zona belgisisiz keladi. MCP create_date/write_date ni MIKROSEKUND bilan
// beradi ("2026-09-16 19:02:17.047063"). Ilgari "Z" faqat 19 belgili qatorga qo'shilardi —
// mikrosekundli sana server (Toshkent) vaqti deb o'qilib, 5 soat ERTA chiqardi: kun chegarasidagi
// lidlar boshqa kunga tushardi (17–23 sentabr: Odoo 330, panel 324) va SLA 5 soatga siljirdi.
const ODOO_UTC = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
function iso(d) { // Date/"YYYY-MM-DD HH:MM:SS[.ffffff]"(UTC, Odoo) → "YYYY-MM-DDTHH:MM:SS+05:00"
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(String(d).replace(" ", "T") + (ODOO_UTC.test(String(d)) ? "Z" : ""));
  if (Number.isNaN(dt.getTime())) return "";
  const t = new Date(dt.getTime() + CFG.tzMin * 60000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}+05:00`;
}
const nowIso = () => iso(new Date());
const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const m2o = (v) => (Array.isArray(v) ? { id: v[0], name: v[1] } : v && typeof v === "object" && "id" in v ? v : null);
const idOf = (v) => { const o = m2o(v); return o ? String(o.id) : null; };
const nameOf = (v) => { const o = m2o(v); return o ? String(o.name || "") : ""; };
const multi = (type, value, id) => (value ? [{ ID: String(id), VALUE_TYPE: "WORK", VALUE: String(value), TYPE_ID: type }] : []);
const splitName = (s) => { const p = String(s || "").trim().split(/\s+/); return { NAME: p[0] || "", LAST_NAME: p.slice(1).join(" ") }; };
function log(...a) { console.log(new Date().toISOString(), ...a); }

// ---------------------------------------------------------------------------
// Odoo snapshot
// ---------------------------------------------------------------------------
const odoo = new Odoo();
const R = (r) => (r && r.records ? r.records : Array.isArray(r) ? r : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
// Barcha MCP so'rovlari BITTA navbatda: snapshot va dashboard hisobi bir vaqtda ishlasa ham
// so'rovlar orasidagi pauza saqlanadi (ikkalasi parallel yursa MCP tezlik chegarasiga tegardi).
let navbat = Promise.resolve();
function call(tool, args, opt) {
  const p = navbat.then(() => callBir(tool, args, opt));
  navbat = p.catch(() => {});
  return p;
}
async function callBir(tool, args, opt) { // MCP tezlik chegarasi: soʻrovlar orasida pauza, limitga tegsa kutib qayta urinish
  for (let n = 0; ; n++) {
    const wait = CFG.pace - (Date.now() - lastCall); if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try { return await odoo.ch(tool, args, opt); }
    catch (e) {
      const msg = String(e && e.message || e);
      if (/rate limit/i.test(msg) && n < 3) { log("rate limit — 65s kutish"); await sleep(65000); continue; }
      // Tarmoq uzilishi (2026-09-24 21:30: «fetch failed» butun snapshotni to'xtatdi, panel 10 daqiqa bo'sh qoldi)
      if (/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|UND_ERR/i.test(msg + " " + String(e?.cause?.code || "")) && n < 3) {
        log(`tarmoq xatosi (${msg.slice(0, 60)}) — ${5 * (n + 1)}s dan keyin qayta`); await sleep(5000 * (n + 1)); continue;
      }
      throw e;
    }
  }
}
async function all(model, domain, fields, { order, max = 20000 } = {}) { // odoo_search_read'da offset yoʻq → id-kursor
  const out = []; let last = 0;
  const flds = fields.includes("id") ? fields : ["id", ...fields];
  while (out.length < max) {
    const r = R(await call("odoo_search_read", { model, domain: [...domain, ["id", ">", last]], fields: flds, limit: 100, order: "id asc" }));
    out.push(...r);
    if (r.length < 100) break;
    last = Math.max(...r.map((x) => Number(x.id)));
  }
  if (order && /desc/i.test(order)) out.reverse();
  return out;
}

// Bosqich semantikasi: nomdan (Odoo is_won → S)
const isLost = (name) => /отказ|rad|lost|yo'q|yoq|junk/i.test(name || "");
const leadConverted = (name) => /шартнома|shartnoma|contract/i.test(name || "");
const LEAD_CODES = { "Янги лид": "NEW", "Жараёнда": "IN_PROCESS", "1-6 ой": "UC_1_6", "Кп": "UC_KP", "Шартнома": "CONVERTED", "Сервис": "UC_SERVIS", "Перезвон": "UC_PEREZVON", "Отказ": "JUNK" };
const DEAL_CODES = { "Сотув бўлими янги лид": "NEW", "Жавоб бермади": "PREPARATION", "Тижорат таклиф тайёрлаш": "PROPOSAL", "Ўчрашув": "MEETING", "Дожим": "DOJIM", "Шартнома берилди": "PREPAYMENT_INVOICE", "Аванс тушди": "WON", "Отказ": "LOSE" };
const CATS = [{ ID: "0", NAME: "Savdo Sun High Tech" }, { ID: "1", NAME: "Kuzatuv va servis" }, { ID: "2", NAME: "Loyiha ijrosi" }, { ID: "3", NAME: "Tender" }];
function catOf(rec) { // jamoa / Сотув тури → voronka
  const team = idOf(rec.team_id);
  const st = String(rec.x_studio_selection_field_4tk_1jmdflv45 || "").toLowerCase();
  if (/тендер|tender/.test(st)) return "3";
  if (/сервис|servis/.test(st)) return "1";
  return "0";
}
const stageCode = (id, name, isLead) => { if (!id) return "NEW"; const t = (isLead ? LEAD_CODES : DEAL_CODES)[String(name || "").trim()]; return t || `S${id}`; };

const DB = { users: [], statuses: [], leads: [], deals: [], contacts: [], companies: [], activities: [], calls: 0, callRows: [], invoices: [], stageById: new Map(), at: null, ms: 0, err: null, counts: {} };

// ---------------------------------------------------------------------------
// VoIP qo'ng'iroqlari (Odoo voip.call, 2026-09-24) — bosqichma-bosqich yuklanadi
// ---------------------------------------------------------------------------
// 31-iyuldan keyin SUN qo'ng'iroqlari call.record.api ga emas, Odoo'ning o'z VoIP moduliga
// tushadi: voip.call (operator = user_id, yo'nalish, holat, lid = x_studio_lead) va yozuv —
// ir.attachment (res_model = voip.call, «recording.webm»). Birinchi marta ADAPTER_VOIP_DAYS
// (120) kunlik to'liq yuklanadi, keyin har snapshotda faqat o'zgarganlari (write_date).
// MCP kalitiga bu modellar ochilmagan bo'lsa — jim o'tadi, sababi /healthz da ko'rinadi.
// «duration» Odoo'da SOATDA (681 s = 0.189) — soniya start/end dan hisoblanadi.
const VOIP = { rows: new Map(), rec: new Map(), since: null, recSince: null, ok: null, err: null, recErr: null };
const utcStr = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const scopeXato = (e, model) => (/scope/i.test(String(e && e.message || e)) ? `MCP kalitida ${model} ruxsati yo'q` : String(e && e.message || e).slice(0, 160));
async function voipYangila() {
  const bosh = utcStr(Date.now() - Number(process.env.ADAPTER_VOIP_DAYS || 120) * 864e5);
  const endi = Date.now();
  try {
    const rows = await all("voip.call", VOIP.since ? [["write_date", ">=", VOIP.since]] : [["create_date", ">=", bosh]],
      ["id", "create_date", "write_date", "start_date", "end_date", "duration", "direction", "state", "phone_number",
       "user_id", "x_studio_lead", "x_studio_gaplashildi", "summary"], { max: 100000 });
    for (const v of rows) VOIP.rows.set(Number(v.id), v);
    for (const [id, v] of VOIP.rows) if (String(v.create_date || "") < bosh) VOIP.rows.delete(id);   // oynadan chiqqan
    VOIP.ok = true; VOIP.err = null; VOIP.since = utcStr(endi - 10 * 60e3);   // 10 daqiqa ustma-ust
  } catch (e) { VOIP.ok = false; VOIP.err = scopeXato(e, "voip.call"); return; }
  try {
    const att = await all("ir.attachment", [["res_model", "=", "voip.call"], ["create_date", ">=", VOIP.recSince || bosh]],
      ["id", "res_id", "mimetype", "file_size"], { max: 100000 });
    for (const a of att) { const k = Number(a.res_id), b = VOIP.rec.get(k); if (!b || Number(a.id) > b.id) VOIP.rec.set(k, { id: Number(a.id), mime: a.mimetype || "audio/webm", size: Number(a.file_size || 0) }); }
    VOIP.recErr = null;
    // To'liq yuklash bo'sh chiqsa (Odoo kirish qoidasi hali ochilmagan bo'lishi mumkin — 2026-09-24 da
    // aynan shunday bo'ldi) — keyingi snapshotda yana TO'LIQ so'raladi; aks holda eski yozuvlar
    // hech qachon yuklanmasdi (faqat oxirgi 10 daqiqaniki so'ralardi).
    VOIP.recSince = VOIP.rec.size ? utcStr(endi - 10 * 60e3) : null;
  } catch (e) { VOIP.recErr = scopeXato(e, "ir.attachment"); }
}

async function snapshot() {
  const t0 = Date.now();
  const since = new Date(Date.now() - CFG.daysBack * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const SCOPE = CFG.teams.length ? ["|", ["team_id", "in", CFG.teams], ["company_id", "=", CFG.company]] : []; // panel qamrovi: SUN jamoalari yoki SUN kompaniyasi
  const SALES_TEAMS = CFG.teams.filter((t) => !CFG.hrTeams.includes(t));
  const LEAD_SCOPE = ["&", "|", ["team_id", "in", SALES_TEAMS], ["company_id", "=", CFG.company], ["team_id", "not in", CFG.hrTeams]]; // lid/bitim: HR voronkalarisiz

  // 1) Foydalanuvchilar
  const users = await all("res.users", [["share", "=", false], ["active", "in", [true, false]]], ["id", "name", "login", "active", "email"], { order: "id" }); // arxivlangan xodimlar ham — eski bitimlarda ism chiqsin
  const U = users.map((u) => ({ ID: String(u.id), ...splitName(u.name), SECOND_NAME: "", EMAIL: u.email || u.login || "", ACTIVE: !!u.active, WORK_POSITION: "", IS_ONLINE: "N", TIME_ZONE: "Asia/Tashkent" }));

  // 2) Bosqichlar → STATUS (lid) va DEAL_STAGE[_n] (imkoniyat)
  const stages = (await all("crm.stage", [], ["id", "name", "sequence", "is_won", "fold"])).sort((a, b) => (a.sequence - b.sequence) || (a.id - b.id));
  const stageById = new Map();
  for (const s of stages) stageById.set(String(s.id), s);

  // 3) Bitimlar va lidlar
  const F = ["id", "name", "type", "active", "contact_name", "partner_name", "partner_id", "phone", "email_from", "stage_id", "team_id", "user_id", "source_id", "expected_revenue", "probability", "date_closed", "date_deadline", "create_date", "write_date", "won_status", "lost_reason_id", "sale_amount_total", "order_ids", "description", "city", "date_last_stage_update", "x_studio_manba", "x_studio_tip", "x_studio_type_1", "x_studio_tarif", "x_studio_xudud", "x_studio_selection_field_4tk_1jmdflv45", "activity_date_deadline", "activity_summary", "activity_user_id", "activity_type_id", "x_x_studio_lead_voip_call_count", "date_conversion",
    "x_studio_company_type"];   // «Клиент тури»: B2B / B2C / B2G / Gigawatt (Zaryatniy stansiya) / GetGreen
  const partnerIds = new Set();
  const L = [], D = [], A = []; let mf = 1, aid = 1;
  const usedDeal = new Map(); // odoo stage id → soni
  // Lid va bitim uchun umumiy maydonlar
  const asosiy = (r) => {
    const pid = idOf(r.partner_id); if (pid) partnerIds.add(pid);
    const nm = splitName(r.contact_name || r.partner_name || nameOf(r.partner_id));
    const src = r.x_studio_manba || nameOf(r.source_id) || "";
    return {
      ID: String(r.id), TITLE: r.name || "", ...nm, SECOND_NAME: "", COMPANY_TITLE: r.partner_name || "",
      SOURCE_ID: src ? String(src).toUpperCase().replace(/\s+/g, "_") : "", SOURCE_DESCRIPTION: src,
      DATE_CREATE: iso(r.create_date), DATE_MODIFY: iso(r.write_date),
      ASSIGNED_BY_ID: idOf(r.user_id) || "0", CREATED_BY_ID: idOf(r.user_id) || "0", MODIFY_BY_ID: idOf(r.user_id) || "0",
      OPPORTUNITY: money(r.expected_revenue), CURRENCY_ID: "UZS", IS_MANUAL_OPPORTUNITY: "Y",
      COMMENTS: String(r.description || "").replace(/<[^>]+>/g, " ").trim().slice(0, 2000),
      PHONE: multi("PHONE", r.phone, mf++), EMAIL: multi("EMAIL", r.email_from, mf++), ADDRESS_CITY: r.city || nameOf(r.x_studio_xudud) || "",
      UF_CRM_SELECTBOX: r.x_studio_type_1 || "", UF_CRM_SELECTBOX2: r.x_studio_tip || "", UF_CRM_TARIF: r.x_studio_tarif || "",
      UF_CRM_ODOO_URL: `${CFG.portal}/odoo/crm/${r.id}`, UF_CRM_CALLS: String(r.x_x_studio_lead_voip_call_count || 0),
      // Rasmiy yo'qotish sababi (yo'qotish oynasida tanlanadi). Panel ilgari faqat izohni tekshirardi.
      UF_CRM_LOST_REASON: nameOf(r.lost_reason_id),
      UF_CRM_CLIENT_TYPE: CLIENT_TYPE[r.x_studio_company_type] || r.x_studio_company_type || "",
      UF_CRM_TEAM: nameOf(r.team_id),
      CONTACT_ID: pid && !r.partner_name ? pid : null, COMPANY_ID: pid && r.partner_name ? pid : null,
    };
  };
  // Rejalashtirilgan faoliyat (Odoo activity) → crm.activity TYPE_ID=3
  const faoliyat = (r, isLead) => {
    if (!(r.activity_date_deadline && r.active)) return;
    const dl = iso(r.activity_date_deadline + " 09:00:00");
    A.push({ ID: String(aid++), OWNER_ID: String(r.id), OWNER_TYPE_ID: isLead ? "1" : "2", TYPE_ID: "3", PROVIDER_ID: "CRM_TODO", PROVIDER_TYPE_ID: "TODO", PROVIDER_GROUP_ID: null, DIRECTION: "0",
      SUBJECT: r.activity_summary || nameOf(r.activity_type_id) || "Vazifa", START_TIME: dl, END_TIME: dl, DEADLINE: dl, COMPLETED: "N", STATUS: "1",
      RESPONSIBLE_ID: idOf(r.activity_user_id) || idOf(r.user_id) || "0", PRIORITY: "2", NOTIFY_TYPE: "0", NOTIFY_VALUE: "0", DESCRIPTION: "", DESCRIPTION_TYPE: "1", LOCATION: "",
      CREATED: iso(r.write_date), LAST_UPDATED: iso(r.write_date), AUTHOR_ID: idOf(r.user_id) || "0", EDITOR_ID: idOf(r.user_id) || "0", SETTINGS: [], ORIGIN_ID: "", ORIGINATOR_ID: "ODOO", RESULT_STATUS: "0", RESULT_STREAM: "0", FILES: [], COMMUNICATIONS: [] });
  };

  // 3a) BITIMLAR = imkoniyatlar (type=opportunity): SUN jamoalari/kompaniyasi, HR voronkalarisiz;
  //     faol + oxirgi N kunda o'zgargan arxiv.
  const recs = await all("crm.lead", [...LEAD_SCOPE, ["type", "=", "opportunity"], "|", ["active", "=", true], ["write_date", ">=", since]], F, { order: "id" });
  for (const r of recs) {
    const st = m2o(r.stage_id); const stName = st ? st.name : "";
    const code = stageCode(st ? st.id : 0, stName, false);
    usedDeal.set(st ? String(st.id) : "0", (usedDeal.get(st ? String(st.id) : "0") || 0) + 1);
    const lost = !r.active || (r.probability === 0 && !!idOf(r.lost_reason_id)) || isLost(stName);
    const won = !lost && (r.won_status === "won" || (st && stageById.get(String(st.id))?.is_won) || code === "WON");
    const sem = won ? "S" : lost ? "F" : "P";
    const base = asosiy(r);
    const cat = catOf(r);
    const stageId = cat === "0" ? code : `C${cat}:${code}`;
    const amt = Number(r.sale_amount_total) > 0 ? r.sale_amount_total : r.expected_revenue;
    D.push({ ...base, TYPE_ID: "SALE", CATEGORY_ID: cat, STAGE_ID: stageId, STAGE_SEMANTIC_ID: sem, STAGE_DESCRIPTION: stName,
      IS_NEW: "N", IS_RECURRING: "N", IS_RETURN_CUSTOMER: "N", IS_REPEATED_APPROACH: "N", PROBABILITY: r.probability != null ? String(Math.round(r.probability)) : null,
      OPPORTUNITY: money(amt), TAX_VALUE: "0.00", CLOSED: sem === "P" ? "N" : "Y", OPENED: "Y",
      CLOSEDATE: iso(r.date_closed || (sem !== "P" ? (r.date_last_stage_update || r.write_date) : r.date_deadline)), BEGINDATE: iso(r.create_date),
      MOVED_TIME: iso(r.date_last_stage_update || r.write_date), MOVED_BY_ID: idOf(r.user_id) || "0", LAST_ACTIVITY_TIME: iso(r.write_date), LAST_ACTIVITY_BY: idOf(r.user_id) || "0",
      LEAD_ID: null, UF_CRM_SALE_TOTAL: money(r.sale_amount_total), UF_CRM_ORDERS: (r.order_ids || []).length });
    faoliyat(r, false);
  }

  // 3b) LIDLAR = «Tushgan Lead» (dashboard plitkasi #1006, AYNAN o'sha domen): SUN kompaniyasi,
  //     «Оператор (Авто танланади)» to'ldirilgan, yaratgan — call-markaz guruhi a'zosi yoki
  //     OdooBot; arxivlanganlar ham. Imkoniyatga aylangani ham lid bo'lib qoladi («Managerga
  //     o'tgan», S) — dashboard ham shunday sanaydi. Ilgari panel lidi = «type=lead, jamoa
  //     qamrovida» edi va dashboard bilan mos kelmasdi (sotuv rahbari 2026-09-23 da ko'rsatdi).
  //     Holat: stage_id EMAS, dashboard ustunlari maydoni (PIPE_FIELD).
  const T1006 = DASH.tiles["1006"];
  const recsT = await all("crm.lead", [...T1006.d, ["create_date", ">=", since]], [...F, OP_FIELD, PIPE_FIELD, KV_FIELD, "create_uid", "x_studio_stage_changed_at", "x_studio_kp_yuklandi", ...SKOR_F], { order: "id", max: 40000 });
  const pipeYangi = new Map();          // PIPE ro'yxatida yo'q qiymat chiqsa — o'z kodi bilan
  const pipeOf = (v) => {
    if (!v) return ["UC_BOSH", "Holatsiz", ""];
    if (PIPE[v]) return [...PIPE[v], v];
    if (!pipeYangi.has(v)) pipeYangi.set(v, `UC_P${pipeYangi.size + 1}`);
    return [pipeYangi.get(v), String(v), v];
  };
  for (const r of recsT) {
    const opp = r.type === "opportunity";
    const otkaz = !opp && !r.active && r.won_status === "lost";      // dashboard «Otkaz Leadlar» (#791) sharti
    const arxiv = !opp && !r.active && !otkaz;                        // arxivlangan, lekin «yo'qotilgan» deb belgilanmagan
    const [pcode, pname, pv] = pipeOf(r[PIPE_FIELD]);
    const [code, sem, desc] = opp ? ["CONVERTED", "S", "Managerga o'tgan"] : otkaz ? ["JUNK", "F", "Otkaz"] : arxiv ? ["UC_ARXIV", "F", "Arxivlangan"] : [pcode, "P", pname];
    // Lid taqdiri (opportunity bo'lsa): qaysi bosqichda, kimda, yutildi/yo'qotildi — bitim bilan AYNI qoida
    let taqdir = {};
    if (opp) {
      const st = m2o(r.stage_id); const stName = st ? st.name : "";
      const dLost = !r.active || (r.probability === 0 && !!idOf(r.lost_reason_id)) || isLost(stName);
      const dWon = !dLost && (r.won_status === "won" || (st && stageById.get(String(st.id))?.is_won) || stageCode(st ? st.id : 0, stName, false) === "WON");
      taqdir = { UF_CRM_DEAL_STAGE: stName, UF_CRM_DEAL_STATE: dWon ? "won" : dLost ? "lost" : "open",
        UF_CRM_MANAGER: nameOf(r.user_id), UF_CRM_DEAL_MOVED: iso(r.date_last_stage_update || r.write_date),
        UF_CRM_DEAL_CLOSED: dWon || dLost ? iso(r.date_closed || r.write_date) : "", UF_CRM_SALE_TOTAL: money(r.sale_amount_total) };
    }
    L.push({ ...asosiy(r), ...taqdir, STATUS_ID: code, STATUS_SEMANTIC_ID: sem, STATUS_DESCRIPTION: desc,
      ARXIV: sem === "F" && !r.active ? "Y" : "N",
      DATE_CLOSED: opp ? iso(r.date_conversion || r.write_date) : sem === "F" ? iso(r.date_closed || r.write_date) : "",
      IS_RETURN_CUSTOMER: "N",
      UF_CRM_OPERATOR: idOf(r[OP_FIELD]) || "", UF_CRM_OPERATOR_NAME: nameOf(r[OP_FIELD]),
      UF_CRM_PIPE: pv, UF_CRM_PIPE_NAME: pname, UF_CRM_KV: Number(r[KV_FIELD] || 0),
      UF_CRM_TYPE: r.type || "", UF_CRM_DEAL_ID: opp ? String(r.id) : "", UF_CRM_CONVERTED_AT: iso(r.date_conversion),
      UF_CRM_CREATED_BY: idOf(r.create_uid) || "", UF_CRM_TUSHGAN: "Y",
      // Voronka (TZ 2-modul): holat oxirgi o'zgargan vaqt (bosqich tarixi MCP'da yo'q) va «KP yuklandi»
      UF_CRM_STAGE_AT: iso(r.x_studio_stage_changed_at), UF_CRM_KP: r.x_studio_kp_yuklandi ? "Y" : "",
      // Skoring belgilari: o'rnatish maqsadi, oylik elektr to'lovi (so'm), tavsiya quvvati, uchrashuv joyi,
      // to'lov qobiliyati, o'rnatish muddati, o'rnatiladigan joy (tom/yer)
      UF_CRM_MAQSAD: tozaTanlov(r.x_studio_maqsad_2), UF_CRM_BILL: Number(r.x_studio_probability_new || 0), UF_CRM_KWT: Number(r.x_studio_stansiya_kwt || 0),
      UF_CRM_UCHR_JOY: r.x_studio_selection_field_3cu_1jloqho34 || "", UF_CRM_TOLOV: r.x_studio_tolov_usuli || "",
      UF_CRM_MUDDAT: r.x_rejalashtirilgan_ornatish_muddati || r.x_studio_when || "", UF_CRM_JOY: tozaTanlov(r.x_studio_where) });
    if (!opp) faoliyat(r, true);
  }
  log(`lidlar («Tushgan Lead»): ${L.length} ta · managerga o'tgan ${L.filter((x) => x.STATUS_SEMANTIC_ID === "S").length} · otkaz/arxiv ${L.filter((x) => x.STATUS_SEMANTIC_ID === "F").length} · operatorlar ${new Set(L.map((x) => x.UF_CRM_OPERATOR)).size}${pipeYangi.size ? ` · yangi holat qiymatlari: ${[...pipeYangi.keys()].join(", ")}` : ""}`);

  // ---------- HISOB-FAKTURALAR (2026-09-23) ----------
  // account.move — MCP kalitiga ochiq. «Haqiqiy tushum» uchun asos: hisob-faktura summasi
  // va to'lov holati (payment_state). DIQQAT: SUN-HIGHTECH to'lovlarni hisob-fakturaga
  // bog'lamaydi (2026-09-23: 43 tadan 43 tasi not_paid; Get-Green'da esa 95 paid, 14 partial).
  // Shuning uchun panel «tushgan pul» ni o'lchay olmasligini aytadi, soxta 0 ko'rsatmaydi.
  const INV = [];
  try {
    const ir = await all("account.move",
      [["company_id", "=", CFG.company], ["state", "=", "posted"], ["move_type", "in", ["out_invoice", "out_refund"]]],
      ["id", "name", "invoice_date", "invoice_date_due", "amount_total", "amount_residual",
       "payment_state", "move_type", "partner_id", "invoice_origin", "currency_id"], { max: 5000 });
    for (const x of ir) {
      const qaytarish = x.move_type === "out_refund";
      const jami = Number(x.amount_total || 0), qoldiq = Number(x.amount_residual || 0);
      INV.push({ ID: String(x.id), NAME: x.name || "", DATE: x.invoice_date || "", DUE: x.invoice_date_due || "",
        TOTAL: qaytarish ? -jami : jami, RESIDUAL: qaytarish ? -qoldiq : qoldiq,
        PAID: qaytarish ? -(jami - qoldiq) : (jami - qoldiq),
        STATE: x.payment_state || "", REFUND: qaytarish ? "Y" : "N",
        PARTNER: nameOf(x.partner_id) || "", ORIGIN: x.invoice_origin || "",
        CURRENCY: (Array.isArray(x.currency_id) ? x.currency_id[1] : "") || "UZS" });
    }
    log(`hisob-faktura: ${INV.length} ta (to'langan ${INV.filter((i) => i.STATE === "paid").length}, qisman ${INV.filter((i) => i.STATE === "partial").length})`);
  } catch (e) { log("hisob-faktura XATO:", String(e && e.message || e).slice(0, 120)); }

  // ---------- TELEFONIYA (2026-09-23) ----------
  // Odoo'da `call.record.api` modeli bor: operator, mijoz raqami, yo'nalish, holat,
  // davomiylik va audio yozuv. Panel qo'ng'iroqni Bitrix shaklida — crm.activity
  // TYPE_ID=2 sifatida o'qiydi, shuning uchun shu yerda o'sha shaklga o'giramiz.
  //   DIRECTION: "2" = chiquvchi, "1" = kiruvchi (panel shu qiymatni kutadi)
  //   SETTINGS.MISSED_CALL: javobsiz/band/xato holatlari
  // Lidga bog'lash telefon raqami bo'yicha: SLA (birinchi javob vaqti) shunga tayanadi.
  const raqam = (v) => String(v || "").replace(/\D/g, "").slice(-9);
  // Raqam indeksi: LID + BITIM + KONTAKT. Ilgari faqat lidlar olinardi va
  // qo'ng'iroqlarning atigi ~26% i bog'lanardi (82% ida raqam bor edi).
  // Ustuvorlik: lid > bitim > kontakt (SLA lidning birinchi javobini o'lchaydi).
  const raqamIndeks = new Map();              // 9 xonali raqam → { id, tur }
  const raqamQosh = (manba, id, tur) => {
    for (const p of [manba.PHONE, manba.UF_CRM_TELEFON]) {
      const arr = Array.isArray(p) ? p : p ? [p] : [];
      for (const x of arr) {
        const k = raqam(x && x.VALUE ? x.VALUE : x);
        if (k.length !== 9) continue;
        const bor = raqamIndeks.get(k);
        // lid (1) eng ustun, keyin bitim (2), keyin kontakt (3)
        if (!bor || tur < bor.tur) raqamIndeks.set(k, { id, tur });
      }
    }
  };
  for (const l of L) raqamQosh(l, l.ID, 1);
  for (const d of D) raqamQosh(d, d.ID, 2);
  // Kontaktlar (C) keyinroq quriladi — shu yerda mavjud emas. Lid + bitim yetarli.
  // Operator: hr.employee nomi → res.users ID. Mos kelmasa — nom saqlanadi, ID sintetik.
  const userByName = new Map(U.map((u) => [String(`${u.NAME} ${u.LAST_NAME}`).trim().toLowerCase(), u.ID]));
  const xodimUser = new Map();
  const xodimId = (m2o) => {
    if (!m2o) return "0";
    const [eid, nom] = Array.isArray(m2o) ? m2o : [0, String(m2o)];
    const kalit = String(nom || "").trim().toLowerCase();
    if (userByName.has(kalit)) return userByName.get(kalit);
    if (xodimUser.has(kalit)) return xodimUser.get(kalit);
    const yangi = String(900000 + Number(eid || 0));
    xodimUser.set(kalit, yangi);
    // Panel ismni user.get orqali oladi — sintetik foydalanuvchini ro'yxatga qo'shamiz
    const qism = String(nom || "Operator").trim().split(/\s+/);
    U.push({ ID: yangi, NAME: qism[0] || "Operator", LAST_NAME: qism.slice(1).join(" "), SECOND_NAME: "",
             EMAIL: "", ACTIVE: true, WORK_POSITION: "Telefoniya operatori", IS_ONLINE: "N",
             TIME_ZONE: "Asia/Tashkent", UF_DEPARTMENT: [] });
    return yangi;
  };

  // KOMPANIYA CHEGARASI (2026-09-23): `call.record.api` BUTUN Odoo uchun umumiy —
  // unda Get-Green (kompaniya 1) operatorlarining qo'ng'iroqlari ham bor. Tekshiruv:
  // Ортикова Мохичехра SUN'da 0 ta, Get-Green'da 553 ta lidga mas'ul. Shuning uchun
  // qo'ng'iroq faqat ikki holatda olinadi: (a) operatori SUN lid/bitimiga mas'ul, yoki
  // (b) raqami SUN lid/bitimiga tegishli. Aks holda boshqa kompaniya ma'lumoti SUN
  // paneliga aralashadi.
  // Operator qaysi kompaniyaniki: ikkala kompaniyadagi lid SONINI solishtiramiz
  // (arxivlanganlar bilan). Ko'pchiligi SUN'da bo'lsa — SUN operatori.
  const kompSon = async (komp) => {
    const m = new Map();
    try {
      const g = await call("odoo_read_group", { model: "crm.lead",
        domain: [["company_id", "=", komp], ["user_id", "!=", false]],
        fields: ["id:count"], groupby: ["user_id"], limit: 500, context: { active_test: false } });
      for (const row of (g && g.groups) || []) {
        const u = Array.isArray(row) ? row[0] : null; const n = Array.isArray(row) ? Number(row[1] || 0) : 0;
        if (u && u.id) m.set(String(u.id), n);
      }
    } catch (e) { log("operator kompaniyasi XATO:", String(e && e.message || e).slice(0, 100)); }
    return m;
  };
  // 2026-09-23 15:12 dan Odoo admini MCP foydalanuvchisiga faqat SUN kompaniyasini qoldirdi:
  // res.company'da bitta SUN ko'rinadi va call.record.api ni Odoo O'ZI SUN xodimlari bilan
  // cheklaydi (2 920 ta; Adham, Safarov Oqil SM08, Baxtiyor operator...). Bunda taxminiy
  // «ko'pchilik» qoidasi ZARARLI — lidi kam call-markaz operatorlarining haqiqiy SUN
  // qo'ng'iroqlarini chiqarib yuboradi. Kirish yana kengaysa, qoida o'zi qaytib yoqiladi.
  let faqatSun = false;
  try {
    const kc = await all("res.company", [], ["id"], { max: 20 });
    faqatSun = kc.length === 1 && String(kc[0].id) === String(CFG.company);
  } catch (e) { log("kompaniyalar o'qilmadi:", String(e && e.message || e).slice(0, 100)); }
  const sunSon = await kompSon(CFG.company), boshqaSon = await kompSon(1);
  const sunOperator = new Set();
  for (const [uid, n] of sunSon) if (n > (boshqaSon.get(uid) || 0)) sunOperator.add(uid);
  // read_group ishlamasa — eski qoidaga qaytamiz (panel bo'sh qolmasin)
  if (!sunSon.size) for (const x of [...L, ...D]) { const a = String(x.ASSIGNED_BY_ID || ""); if (a && a !== "0") sunOperator.add(a); }
  let qJami = 0, qBogli = 0, qAniq = 0, qAudio = 0, qMos = 0, qBoshqa = 0, qOxirgi = ""; const Q = [];   // Q — voximplant.statistic.get uchun indeks
  try {
    // Qo'ng'iroqlar ko'p (Odoo'da 29 000+). Panel ko'rinishlari 30-90 kunlik, shuning uchun
    // 400 kun emas, qisqaroq oyna olamiz — surat yig'ish vaqti va MCP limiti tejaladi.
    // Faqat SUN ko'rinsa qo'ng'iroqlar kam (~2 900) — butun tarixni olamiz (fevral–iyul
    // qo'ng'iroqlari ham panelga chiqsin). Hamma kompaniya ko'rinsa — eski 120 kunlik oyna.
    const qKun = Number(process.env.ADAPTER_CALL_DAYS || (faqatSun ? 400 : 120));
    const qFrom = new Date(Date.now() - qKun * 864e5).toISOString().slice(0, 19).replace("T", " ");
    const qRecs = await all("call.record.api", [["start_time", ">=", qFrom]],
      ["id", "name", "call_id", "employee_id", "partner_id", "call_type", "call_status",
       "from_number", "to_number", "duration", "start_time", "end_time", "audio_filename", "notes"],
      { max: 40000 });
    for (const q of qRecs) {
      if (!q.start_time) continue;                       // vaqti yo'q yozuv hisobga kirmaydi
      const boshl = iso(q.start_time);
      const dav = Math.max(0, Number(q.duration || 0));
      const tugash = q.end_time ? iso(q.end_time) : iso(new Date(new Date(iso(q.start_time)).getTime() + dav * 1000));
      // Mijoz raqami: "me" bo'lmagani.
      // MUHIM: Odoo integratsiyasi call_type/call_status/to_number ni ko'pincha bo'sh
      // qoldiradi, lekin AUDIO FAYL NOMIDA bu ma'lumot saqlanib qolgan. Ikki format:
      //   "+998939255076,inbound,1790052700945,answered,.mp3"
      //   "00998502045050(00998502045050)_20260921092052.mp3"
      // Shuning uchun maydon bo'sh bo'lsa nomdan o'qiymiz — bu taxmin emas, o'sha yozuvning
      // o'z ma'lumoti.
      const fnom = String(q.audio_filename || "");
      let nomRaqam = "", nomYonalish = "", nomHolat = "";
      const m1 = fnom.match(/^(\+?\d[\d\s-]{6,}),(inbound|outbound|internal),\d*,([a-z_]+),/i);
      if (m1) { nomRaqam = raqam(m1[1]); nomYonalish = m1[2].toLowerCase(); nomHolat = m1[3].toLowerCase(); }
      else { const m2 = fnom.match(/^0*(\d{9,})\s*\(/); if (m2) nomRaqam = raqam(m2[1]); }

      const mijozRaqam = raqam(String(q.from_number).toLowerCase() === "me" ? q.to_number : q.from_number)
        || nomRaqam;
      const mos = mijozRaqam.length === 9 ? raqamIndeks.get(mijozRaqam) : null;
      const lid = mos ? mos.id : null;
      if (mos && mos.tur === 1) qBogli++;      // SLA faqat LIDga bog'langanidan hisoblanadi
      if (mos) qMos++;
      // ANIQ: Odoo yozuvida yo'nalish va holat HAQIQATAN ko'rsatilganmi.
      // Ko'pchilik yangi yozuvlarda ular bo'sh (integratsiya to'ldirmayapti) —
      // biz taxmin qilamiz, lekin panelga «taxmin» ekanini aytamiz.
      // ANIQ: yo'nalish va holat maydondan yoki fayl nomidan HAQIQATAN olindimi.
      // Ikkalasi ham bo'lmasa — taxmin qilamiz va panelga taxmin ekanini aytamiz.
      const turi = q.call_type || nomYonalish || "";
      const holati = q.call_status || nomHolat || "";
      const aniq = !!turi && !!holati;
      if (aniq) qAniq++;
      const chiquvchi = turi === "outbound"
        || (!turi && String(q.from_number).toLowerCase() === "me");
      const javobsiz = ["no_answer", "busy", "failed", "noanswer", "missed"].includes(holati)
        || (!holati && dav === 0);
      const uid = xodimId(q.employee_id);
      if (!faqatSun && !sunOperator.has(String(uid)) && !mos) { qBoshqa++; continue; }   // boshqa kompaniya
      A.push({ ID: "q" + q.id, OWNER_ID: lid || "0", OWNER_TYPE_ID: mos ? String(mos.tur) : "0",
        TYPE_ID: "2", PROVIDER_ID: "VOXIMPLANT_CALL", PROVIDER_TYPE_ID: "CALL", PROVIDER_GROUP_ID: null,
        DIRECTION: chiquvchi ? "2" : "1",
        SUBJECT: (chiquvchi ? "Chiquvchi" : "Kiruvchi") + " qo'ng'iroq" + (mijozRaqam ? " +998" + mijozRaqam : ""),
        START_TIME: boshl, END_TIME: tugash, DEADLINE: boshl, COMPLETED: "Y", STATUS: "2",
        RESPONSIBLE_ID: uid, PRIORITY: "2", NOTIFY_TYPE: "0", NOTIFY_VALUE: "0",
        DESCRIPTION: String(q.notes || ""), DESCRIPTION_TYPE: "1", LOCATION: "",
        CREATED: boshl, LAST_UPDATED: iso(q.end_time || q.start_time), AUTHOR_ID: uid, EDITOR_ID: uid,
        SETTINGS: { MISSED_CALL: javobsiz, DURATION: dav, ANIQ: aniq, CALL_ID: q.call_id || q.name || String(q.id),
                    PHONE_NUMBER: mijozRaqam ? "+998" + mijozRaqam : "",
                    STATUS_CODE: holati, CALL_TYPE: turi,
                    RECORD: q.audio_filename ? "odoo:call.record.api:" + q.id : "" },
        FILES: q.audio_filename ? [{ id: String(q.id), name: String(q.audio_filename), type: "audio" }] : [],
        ORIGIN_ID: String(q.id), ORIGINATOR_ID: "ODOO_CALL", RESULT_STATUS: javobsiz ? "0" : "1" });
      if (q.audio_filename) qAudio++;
      Q.push({ id: String(q.id), callId: String(q.call_id || q.name || q.id),
        at: boshl, dur: dav, phone: mijozRaqam ? "+998" + mijozRaqam : "",
        out: chiquvchi, failed: javobsiz, audio: !!q.audio_filename });
      qJami++;
      if (boshl > qOxirgi) qOxirgi = boshl;
    }
    log(`telefoniya: ${qJami} qo'ng'iroq · aniq metama'lumot ${qAniq} · audio ${qAudio} · bog'langan ${qMos} (shundan lid ${qBogli}) · boshqa kompaniya (chiqarildi) ${qBoshqa} · SUN operatori ${sunOperator.size} · qamrov: ${faqatSun ? "Odoo faqat SUN'ni beradi, filtr o'chiq" : "taxminiy filtr"} · oxirgi ${qOxirgi || "—"}`);
  } catch (e) {
    log("telefoniya XATO:", e.message.slice(0, 120));
  }

  // ---------- VoIP qo'ng'iroqlari → crm.activity TYPE_ID=2 (call.record.api bilan bir xil shakl) ----------
  await voipYangila();
  let vJami = 0, vLid = 0, vAudio = 0;
  {
    const lidIds = new Set(L.map((x) => x.ID)), bitimIds = new Set(D.map((x) => x.ID)), uIds = new Set(U.map((u) => u.ID));
    for (const v of VOIP.rows.values()) {
      const boshT = v.start_date || v.create_date; if (!boshT) continue;
      const boshl = iso(boshT);
      const sek = v.start_date && v.end_date ? Math.max(0, Math.round((Date.parse(iso(v.end_date)) - Date.parse(boshl)) / 1000))
        : Math.max(0, Math.round(Number(v.duration || 0) * 3600));
      const tugash = v.end_date ? iso(v.end_date) : iso(new Date(Date.parse(boshl) + sek * 1000));
      const chiquvchi = v.direction === "outgoing";
      const javobsiz = ["missed", "rejected", "aborted"].includes(v.state) || (v.state === "terminated" && sek === 0);
      const lidId = idOf(v.x_studio_lead), tel = raqam(v.phone_number);
      // Lid: Odoo'da qo'ng'iroqqa bog'langan lid (x_studio_lead) ustun; bo'lmasa — telefon raqami bo'yicha
      const mos = lidId ? { id: lidId, tur: bitimIds.has(lidId) && !lidIds.has(lidId) ? 2 : 1 } : (tel.length === 9 ? raqamIndeks.get(tel) : null);
      if (mos && mos.tur === 1) vLid++;
      const uid = idOf(v.user_id) || "0";
      if (uid !== "0" && !uIds.has(uid)) {   // masalan «Public user» — ism ro'yxatda bo'lsin
        const q = splitName(nameOf(v.user_id));
        U.push({ ID: uid, NAME: q.NAME || "Foydalanuvchi", LAST_NAME: q.LAST_NAME, SECOND_NAME: "", EMAIL: "", ACTIVE: true, WORK_POSITION: "", IS_ONLINE: "N", TIME_ZONE: "Asia/Tashkent", UF_DEPARTMENT: [] });
        uIds.add(uid);
      }
      const yozuv = VOIP.rec.get(Number(v.id)), id = "v" + v.id;
      A.push({ ID: id, OWNER_ID: mos ? mos.id : "0", OWNER_TYPE_ID: mos ? String(mos.tur) : "0",
        TYPE_ID: "2", PROVIDER_ID: "VOXIMPLANT_CALL", PROVIDER_TYPE_ID: "CALL", PROVIDER_GROUP_ID: null,
        DIRECTION: chiquvchi ? "2" : "1",
        SUBJECT: (chiquvchi ? "Chiquvchi" : "Kiruvchi") + " qo'ng'iroq" + (tel ? " +998" + tel : ""),
        START_TIME: boshl, END_TIME: tugash, DEADLINE: boshl, COMPLETED: ["calling", "ongoing"].includes(v.state) ? "N" : "Y", STATUS: "2",
        RESPONSIBLE_ID: uid, PRIORITY: "2", NOTIFY_TYPE: "0", NOTIFY_VALUE: "0",
        DESCRIPTION: String(v.summary || ""), DESCRIPTION_TYPE: "1", LOCATION: "",
        CREATED: boshl, LAST_UPDATED: iso(v.write_date || boshT), AUTHOR_ID: uid, EDITOR_ID: uid,
        SETTINGS: { MISSED_CALL: javobsiz, DURATION: sek, ANIQ: true, CALL_ID: id,
                    PHONE_NUMBER: tel ? "+998" + tel : String(v.phone_number || ""),
                    STATUS_CODE: v.state || "", CALL_TYPE: v.direction || "", MANBA: "voip", GAPLASHILDI: !!v.x_studio_gaplashildi,
                    RECORD: yozuv ? "odoo:voip.call:" + v.id : "" },
        FILES: yozuv ? [{ id: String(yozuv.id), name: "recording.webm", type: "audio" }] : [],
        ORIGIN_ID: id, ORIGINATOR_ID: "ODOO_VOIP", RESULT_STATUS: javobsiz ? "0" : "1" });   // "v<id>" — yozuv aniq shu qo'ng'iroqdan olinadi
      Q.push({ id, callId: id, at: boshl, dur: sek, phone: tel ? "+998" + tel : "", out: chiquvchi, failed: javobsiz, audio: !!yozuv });
      if (yozuv) vAudio++;
      vJami++; qJami++;
      if (boshl > qOxirgi) qOxirgi = boshl;
    }
  }
  log(`VoIP: ${VOIP.ok === false ? "YO'Q — " + VOIP.err : `${vJami} qo'ng'iroq · lidga bog'langan ${vLid} · yozuv ${vAudio}${VOIP.recErr ? " (yozuvlar: " + VOIP.recErr + ")" : ""}`}`);
  // Lid bo'yicha qo'ng'iroq xulosasi (voronka «Operator bog'landi»: birinchi JAVOB BERILGAN qo'ng'iroq).
  // call.record.api (iyulgacha) va voip.call — ikkalasi ham A da TYPE_ID=2 bo'lib turibdi.
  {
    // Lid yaratilishidan 2 soatdan ko'p OLDINGI qo'ng'iroq sanalmaydi: telefon raqami bo'yicha bog'langan
    // eski murojaat (masalan iyundagi qo'ng'iroq sentabrdagi yangi lidga «birinchi aloqa» bo'lib qolardi).
    // 2 soat zaxira — operator avval qo'ng'iroqni qabul qilib, keyin lidni kiritadi.
    const lq = new Map(), yarat = new Map(L.map((l) => [l.ID, Date.parse(l.DATE_CREATE) || 0]));
    for (const a of A) {
      if (a.TYPE_ID !== "2" || !a.OWNER_ID || a.OWNER_ID === "0" || !a.START_TIME) continue;
      const k = String(a.OWNER_ID), c0 = yarat.get(k);
      if (c0 && Date.parse(a.START_TIME) < c0 - 2 * 3600e3) continue;
      const x = lq.get(k) || { n: 0, first: "", last: "", kir: 0, javob: 0, chiq1: "", chiq1Javob: false };
      const javobsiz = !!(a.SETTINGS && a.SETTINGS.MISSED_CALL);
      x.n++;
      if (!javobsiz) { x.javob++; if (!x.first || a.START_TIME < x.first) x.first = a.START_TIME; }
      if (a.DIRECTION === "1" && !javobsiz) x.kir++;                                   // mijozning o'zi qo'ng'iroq qilgan (javob berilgan)
      if (a.DIRECTION === "2" && (!x.chiq1 || a.START_TIME < x.chiq1)) { x.chiq1 = a.START_TIME; x.chiq1Javob = !javobsiz; }   // birinchi chiquvchi urinish
      if (a.START_TIME > x.last) x.last = a.START_TIME;
      lq.set(k, x);
    }
    for (const l of L) {
      const x = lq.get(l.ID);
      l.UF_CRM_CALLS_N = x ? x.n : 0; l.UF_CRM_FIRST_CONTACT = x ? x.first : ""; l.UF_CRM_LAST_CALL = x ? x.last : "";
      l.UF_CRM_CALLS_IN = x ? x.kir : 0; l.UF_CRM_CALLS_ANS = x ? x.javob : 0; l.UF_CRM_TRY1 = x && x.chiq1 ? (x.chiq1Javob ? "Y" : "N") : "";
    }
  }
  // Kunlik hisobot oynasi (o'zgarganlari) — telefon indeksi VoIP qo'ng'irog'ini lidga bog'lash uchun
  KUN.tel = raqamIndeks;
  await kunYangila();

  // Bosqich roʻyxatlari: yozuvlarda ishlatilgan Odoo bosqichlari (+ nom xaritasidagi maʼlumlar), kod boʻyicha takrorsiz
  const ST = []; let sid = 1;
  const pushSt = (ent, sObj, isLead, cat) => {
    const code = stageCode(sObj.id, sObj.name, isLead);
    const key = ent + "|" + code; if (pushSt.seen.has(key)) return; pushSt.seen.add(key);
    const SEM = isLead ? (leadConverted(sObj.name) ? "S" : isLost(sObj.name) ? "F" : "") : (sObj.is_won || code === "WON" ? "S" : isLost(sObj.name) ? "F" : "");
    ST.push({ ID: String(sid++), ENTITY_ID: ent, STATUS_ID: cat && cat !== "0" ? `C${cat}:${code}` : code, NAME: sObj.name, NAME_INIT: sObj.name, SORT: String((sObj.sequence || 0) * 10 + sid), SYSTEM: /^(NEW|WON|LOSE)$/.test(code) ? "Y" : "N", SEMANTICS: SEM, COLOR: SEM === "S" ? "#7BD500" : SEM === "F" ? "#FF5752" : "#39A8EF", _ODOO_ID: String(sObj.id) });
  };
  pushSt.seen = new Set();
  const NO_STAGE = { id: 0, name: "Bosqichsiz", sequence: 0, is_won: false };
  const pick = (used, names) => stages.filter((x) => used.has(String(x.id)) || names.has(String(x.name).trim())).concat(used.has("0") ? [NO_STAGE] : []).sort((x, y) => (x.sequence - y.sequence) || (x.id - y.id));
  // Lid holatlari = dashboard ustunlari (PIPE_FIELD) + yakuniy holatlar. _PIPE — Odoo'dagi qiymat (yozish uchun).
  const leadSt = (code, name, sem, pv) => ST.push({ ID: String(sid++), ENTITY_ID: "STATUS", STATUS_ID: code, NAME: name, NAME_INIT: name, SORT: String(sid * 10), SYSTEM: /^(NEW|CONVERTED|JUNK)$/.test(code) ? "Y" : "N", SEMANTICS: sem, COLOR: sem === "S" ? "#7BD500" : sem === "F" ? "#FF5752" : "#39A8EF", _ODOO_ID: "", _PIPE: pv });
  for (const [pv, [code, name]] of Object.entries(PIPE)) leadSt(code, name, "", pv);
  for (const [pv, code] of pipeYangi) leadSt(code, String(pv), "", pv);
  leadSt("UC_BOSH", "Holatsiz", "", "");
  leadSt("CONVERTED", "Managerga o'tgan", "S", "");
  leadSt("JUNK", "Otkaz", "F", "");
  leadSt("UC_ARXIV", "Arxivlangan", "F", "");
  const dealSt = pick(usedDeal, new Set(Object.keys(DEAL_CODES)));
  for (const c of CATS) for (const sObj of dealSt) pushSt(c.ID === "0" ? "DEAL_STAGE" : `DEAL_STAGE_${c.ID}`, sObj, false, c.ID);

  // 4) Tasdiqlangan buyurtmalar (CRM'ga bog'lanmagan) → yutilgan bitim (sotuv haqiqati)
    const orders = await all("sale.order", [...SCOPE, ["state", "=", "sale"], ["date_order", ">=", since]], ["id", "name", "partner_id", "amount_total", "currency_id", "date_order", "user_id", "team_id", "opportunity_id", "invoice_status", "create_date", "write_date"], { order: "date_order desc" });
  const oppWithOrder = new Set(recs.filter((r) => (r.order_ids || []).length).map((r) => String(r.id)));
  for (const o of orders) {
    const opp = idOf(o.opportunity_id);
    if (opp && oppWithOrder.has(opp)) continue; // imkoniyat qatorida allaqachon hisobga olingan
    const pid = idOf(o.partner_id); if (pid) partnerIds.add(pid);
    const cat = idOf(o.team_id) === "41" ? "2" : "0";
    D.push({ ID: String(1000000 + o.id), TITLE: `${o.name} — ${nameOf(o.partner_id)}`, NAME: "", LAST_NAME: "", TYPE_ID: "SALE", CATEGORY_ID: cat, STAGE_ID: cat === "0" ? "WON" : `C${cat}:WON`, STAGE_SEMANTIC_ID: "S", STAGE_DESCRIPTION: "Sale order",
      IS_NEW: "N", IS_RECURRING: "N", IS_RETURN_CUSTOMER: "N", IS_REPEATED_APPROACH: "N", PROBABILITY: "100",
      OPPORTUNITY: money(o.amount_total), IS_MANUAL_OPPORTUNITY: "Y", TAX_VALUE: "0.00", CURRENCY_ID: nameOf(o.currency_id) || "UZS",
      CLOSED: "Y", OPENED: "Y", CLOSEDATE: iso(o.date_order), BEGINDATE: iso(o.create_date), DATE_CREATE: iso(o.create_date), DATE_MODIFY: iso(o.write_date), MOVED_TIME: iso(o.date_order), MOVED_BY_ID: idOf(o.user_id) || "0", LAST_ACTIVITY_TIME: iso(o.write_date), LAST_ACTIVITY_BY: idOf(o.user_id) || "0",
      ASSIGNED_BY_ID: idOf(o.user_id) || "0", CREATED_BY_ID: idOf(o.user_id) || "0", MODIFY_BY_ID: idOf(o.user_id) || "0",
      CONTACT_ID: pid, COMPANY_ID: null, LEAD_ID: opp || null, SOURCE_ID: "", SOURCE_DESCRIPTION: "", COMMENTS: `Odoo buyurtma ${o.name}, hisob: ${o.invoice_status || "-"}`,
      PHONE: [], EMAIL: [], UF_CRM_SALE_TOTAL: money(o.amount_total), UF_CRM_ORDERS: 1, UF_CRM_ODOO_URL: `${CFG.portal}/odoo/sales/${o.id}` });
  }

  // 5) Kontakt / kompaniya (faqat havola qilinganlar)
  const ids = [...partnerIds].map(Number).filter(Number.isFinite);
  const C = [], K = [];
  for (let i = 0; i < ids.length; i += 100) {
    const ps = await all("res.partner", [["id", "in", ids.slice(i, i + 100)]], ["id", "name", "is_company", "phone", "email", "city", "create_date", "write_date", "user_id", "company_name"], { max: 100 });
    for (const p of ps) {
      const row = { ID: String(p.id), ASSIGNED_BY_ID: idOf(p.user_id) || "0", DATE_CREATE: iso(p.create_date), DATE_MODIFY: iso(p.write_date), PHONE: multi("PHONE", p.phone, mf++), EMAIL: multi("EMAIL", p.email, mf++), ADDRESS_CITY: p.city || "", COMMENTS: "", UF_CRM_ODOO_URL: `${CFG.portal}/odoo/contacts/${p.id}` };
      if (p.is_company) K.push({ ...row, TITLE: p.name || "", COMPANY_TYPE: "CUSTOMER", INDUSTRY: "OTHER", REVENUE: "0.00", CURRENCY_ID: "UZS" });
      else C.push({ ...row, ...splitName(p.name), SECOND_NAME: "", TYPE_ID: "CLIENT", SOURCE_ID: "", COMPANY_TITLE: p.company_name || "" });
    }
  }

  Object.assign(DB, { users: U, statuses: ST, leads: L, deals: D, contacts: C, companies: K, activities: A, calls: qJami, callRows: Q, invoices: INV, stageById, at: new Date().toISOString(), ms: Date.now() - t0, err: null,
    counts: { users: U.length, stages: stages.length, leads: L.length, lidTarifi: "Tushgan Lead (#1006)", deals: D.length, orders: orders.length, contacts: C.length, companies: K.length, activities: A.length, calls: qJami, callsOxirgi: qOxirgi || null, callsAniq: qAniq, callsAudio: qAudio, callsLid: qBogli, callsBogli: qMos, callsBoshqa: qBoshqa, invoices: INV.length,
      voip: { ok: VOIP.ok, err: VOIP.err, calls: vJami, lid: vLid, audio: vAudio, recErr: VOIP.recErr },
      kunlik: { ok: KUN.ok, yozuv: KUN.recs.size, at: KUN.at, err: KUN.err } } });
  log("snapshot", JSON.stringify(DB.counts), `${DB.ms}ms`);
}
let refreshing = null;
async function refresh() { if (refreshing) return refreshing; refreshing = snapshot().catch((e) => { DB.err = String(e && e.message || e); log("snapshot XATO", DB.err); }).finally(() => { refreshing = null; }); return refreshing; }

// ---------------------------------------------------------------------------
// Filtr / select / order / sahifalash — mock-bitrix.mjs bilan bir xil (§5.1)
// ---------------------------------------------------------------------------
function setPath(obj, key, value) {
  const parts = []; const m = key.match(/^([^\[]+)((?:\[[^\]]*\])*)$/);
  if (!m) { obj[key] = value; return; }
  parts.push(m[1]); for (const seg of m[2].matchAll(/\[([^\]]*)\]/g)) parts.push(seg[1]);
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i], last = i === parts.length - 1;
    if (p === "") { if (last) { cur.push(value); return; } const next = parts[i + 1] === "" ? [] : {}; cur.push(next); cur = next; continue; }
    if (last) { cur[p] = value; return; }
    if (cur[p] === undefined || typeof cur[p] !== "object") cur[p] = parts[i + 1] === "" ? [] : {};
    cur = cur[p];
  }
}
function parseParams(query, body, ctype) {
  const out = {}; const feed = (pairs) => { for (const [k, v] of pairs) setPath(out, k, v); };
  if (query) feed([...new URLSearchParams(query)]);
  if (body && body.length) {
    if (/json/i.test(ctype || "")) { let j = {}; try { j = JSON.parse(body); } catch { } for (const [k, v] of Object.entries(j)) { if (/\[/.test(k)) setPath(out, k, v); else out[k] = v; } }
    else feed([...new URLSearchParams(body)]);
  }
  return out;
}
const DATE_KEYS = /^(DATE_|.*_TIME$|.*DATE$|CREATED$|LAST_UPDATED$|DEADLINE$|BEGINDATE$|CLOSEDATE$|CALL_START_DATE$)/;
function fieldValue(row, key) { const v = row[key]; if (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && "VALUE" in v[0]) return v.map((x) => x.VALUE); return v; }
const normNum = (x) => { if (x === null || x === undefined || x === "") return NaN; const n = Number(x); return Number.isFinite(n) ? n : NaN; };
function cmpScalar(op, a, b, key) {
  if (op === "%") return String(a ?? "").toLowerCase().includes(String(b).toLowerCase());
  const isDate = DATE_KEYS.test(key) || /^\d{4}-\d{2}-\d{2}/.test(String(b));
  let x, y;
  if (isDate) { x = Date.parse(a); y = Date.parse(b); if (Number.isNaN(x) || Number.isNaN(y)) { x = String(a ?? ""); y = String(b); } }
  else { const nx = normNum(a), ny = normNum(b); if (!Number.isNaN(nx) && !Number.isNaN(ny)) { x = nx; y = ny; } else { x = String(a ?? ""); y = String(b); } }
  switch (op) { case ">=": return x >= y; case "<=": return x <= y; case ">": return x > y; case "<": return x < y; case "!": case "!=": return x !== y; default: return x === y; }
}
function matchFilter(row, filter) {
  if (!filter || typeof filter !== "object") return true;
  for (const [rawKey, val] of Object.entries(filter)) {
    const m = rawKey.match(/^(>=|<=|!=|>|<|!|@|%|=)?(.+)$/); const op = m[1] || "=", key = m[2];
    const rv = fieldValue(row, key); const list = Array.isArray(val) ? val : op === "@" ? [val] : null;
    const rvs = Array.isArray(rv) ? rv : [rv];
    if (list) { const ok = rvs.some((x) => list.some((y) => cmpScalar("=", x, y, key))); if (op === "!" ? ok : !ok) return false; continue; }
    if (op === "=" && (val === "Y" || val === "N") && typeof rv === "boolean") { if ((val === "Y") !== rv) return false; continue; }
    if (!rvs.some((x) => cmpScalar(op, x, val, key))) return false;
  }
  return true;
}
function project(row, select) {
  const massiv = (v) => Array.isArray(v) ? v
    : (v && typeof v === "object")
      ? Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k])
      : v ? [v] : null;
  const out = {}; const sel = massiv(select);
  const keys = Object.keys(row).filter((k) => !k.startsWith("_"));
  if (!sel || !sel.length) { for (const k of keys) if (!k.startsWith("UF_") && k !== "PHONE" && k !== "EMAIL") out[k] = row[k]; return out; }
  const wantAll = sel.includes("*"), wantUF = sel.includes("UF_*");
  for (const k of keys) { if (sel.includes(k)) out[k] = row[k]; else if (wantAll && !k.startsWith("UF_") && k !== "PHONE" && k !== "EMAIL") out[k] = row[k]; else if (wantUF && k.startsWith("UF_")) out[k] = row[k]; }
  return out;
}
function sortRows(rows, order) {
  if (!order || typeof order !== "object") order = { ID: "ASC" };
  const keys = Object.entries(order);
  return rows.slice().sort((a, b) => {
    for (const [k, dir] of keys) {
      const s = String(dir).toUpperCase() === "DESC" ? -1 : 1; const av = a[k], bv = b[k]; const na = normNum(av), nb = normNum(bv); let c;
      if (!Number.isNaN(na) && !Number.isNaN(nb)) c = na - nb; else if (DATE_KEYS.test(k)) c = (Date.parse(av) || 0) - (Date.parse(bv) || 0); else c = String(av ?? "").localeCompare(String(bv ?? ""));
      if (c) return c * s;
    }
    return 0;
  });
}
function listOf(rows, p) {
  const filtered = rows.filter((r) => matchFilter(r, p.filter || p.FILTER));
  const sorted = sortRows(filtered, p.order || p.ORDER || p.SORT);
  const start = Math.max(0, parseInt(p.start ?? p.START ?? 0, 10) || 0);
  const page = sorted.slice(start, start + CFG.pageSize).map((r) => project(r, p.select || p.SELECT));
  const res = { result: page, total: filtered.length };
  if (start + CFG.pageSize < filtered.length) res.next = start + CFG.pageSize;
  return res;
}
class BxError extends Error { constructor(status, code, desc) { super(desc); this.status = status; this.code = code; } }
function getOne(rows, p) { const id = String(p.id ?? p.ID ?? ""); const row = rows.find((r) => r.ID === id); if (!row) throw new BxError(400, "", "Not found"); return { result: project(row, ["*", "UF_*", "PHONE", "EMAIL"]) }; }
// Telefoniya `scope`i qo'ng'iroq yozuvlari HAQIQATAN kelgandagina beriladi —
// panel "ruxsat bor" deb yozib, keyin bo'sh jadval ko'rsatmasin.
const scopes = () => (DB.calls > 0 ? ["crm", "user", "telephony"] : ["crm", "user"]);
function scopeCheck(s) { if (!scopes().includes(s)) throw new BxError(403, "insufficient_scope", "The request requires higher privileges than provided by the webhook token"); }

// ---------------------------------------------------------------------------
// Yozuvlar → Odoo
// ---------------------------------------------------------------------------
function guardWrite(tur) { // tur: activity | lead | deal
  if (CFG.readonly && !CFG.writes.has(tur)) throw new BxError(403, "WRITES_LOCKED", `Adapter faqat o'qish rejimida — «${tur}» yozuvi yoqilmagan (ruxsat: ${[...CFG.writes].join(", ") || "yo'q"})`);
}
function odooStageId(stageCodeStr) { // "C2:PROPOSAL" / "S105" / "WON" → Odoo stage id
  const code = String(stageCodeStr).replace(/^C\d+:/, "");
  const st = DB.statuses.find((s) => s.ENTITY_ID.startsWith("DEAL_STAGE") && s.STATUS_ID.replace(/^C\d+:/, "") === code);
  return st ? Number(st._ODOO_ID) : null;
}
async function updateLead(rows, p, isLead) {
  guardWrite(isLead ? "lead" : "deal");
  const id = Number(p.id ?? p.ID); const f = p.fields || p.FIELDS || {};
  const row = rows.find((r) => r.ID === String(id)); if (!row) throw new BxError(400, "", "Not found");
  if (id >= 1000000) throw new BxError(400, "ERROR_ARGUMENT", "Bu qator sale.order — Odoo'da o'zgartiring");
  const vals = {};
  const stage = f.STAGE_ID || f.STATUS_ID;
  if (stage && isLead) {
    // Lid holati — dashboard ustunlari maydoni. «Managerga o'tkazish» va «Otkaz» Odoo'ning o'z tugmalari bilan.
    const st = DB.statuses.find((s) => s.ENTITY_ID === "STATUS" && s.STATUS_ID === String(stage));
    if (!st || !st._PIPE) throw new BxError(400, "ERROR_ARGUMENT", `Bu holatga paneldan o'tkazilmaydi: ${stage} (managerga o'tkazish / otkaz — Odoo'da)`);
    vals[PIPE_FIELD] = st._PIPE;
  } else if (stage) { const sid = odooStageId(stage); if (!sid) throw new BxError(400, "ERROR_ARGUMENT", `Bosqich topilmadi: ${stage}`); vals.stage_id = sid; }
  if (f.OPPORTUNITY !== undefined) vals.expected_revenue = Number(f.OPPORTUNITY) || 0;
  if (f.ASSIGNED_BY_ID !== undefined) vals.user_id = Number(f.ASSIGNED_BY_ID) || false;
  if (f.TITLE) vals.name = String(f.TITLE);
  if (f.CLOSEDATE) vals.date_deadline = String(f.CLOSEDATE).slice(0, 10);
  if (Object.keys(vals).length) await call("odoo_write", { model: "crm.lead", ids: [id], values: vals }, { confirm: true });
  if (f.COMMENTS) await call("odoo_message_post", { model: "crm.lead", id, body: String(f.COMMENTS) }, { confirm: true });
  log("write", isLead ? "lead" : "deal", id, JSON.stringify(vals));
  setTimeout(() => refresh(), 1500);
  return { result: true };
}
async function addActivity(p) {
  guardWrite("activity");
  const f = p.fields || p.FIELDS || {};
  if (!f.OWNER_ID || !f.OWNER_TYPE_ID || !f.TYPE_ID || !f.SUBJECT) throw new BxError(400, "ERROR_ARGUMENT", "Required fields: OWNER_ID, OWNER_TYPE_ID, TYPE_ID, SUBJECT");
  const id = Number(f.OWNER_ID); if (!(String(f.OWNER_TYPE_ID) === "1" || String(f.OWNER_TYPE_ID) === "2") || id >= 1000000) throw new BxError(400, "ERROR_ARGUMENT", "Faqat lid/bitim (crm.lead)");
  const deadline = String(f.DEADLINE || f.END_TIME || nowIso()).slice(0, 10);
  const r = await call("odoo_activity_schedule", { model: "crm.lead", id, summary: String(f.SUBJECT) + (f.DESCRIPTION ? " — " + String(f.DESCRIPTION).slice(0, 200) : ""), date_deadline: deadline, ...(f.RESPONSIBLE_ID ? { user_id: Number(f.RESPONSIBLE_ID) } : {}) }, { confirm: true });
  const newId = Number((r && (r.id || r.activity_id)) || Date.now() % 1e9);
  log("activity", id, f.SUBJECT, "→", newId);
  // Panel darhol ko'rsin: xotiradagi suratga qo'shamiz (keyingi snapshot Odoo'dan aniq holatni oladi)
  const dl = iso(deadline + " 09:00:00");
  DB.activities.push({ ID: "n" + newId, OWNER_ID: String(id), OWNER_TYPE_ID: String(f.OWNER_TYPE_ID), TYPE_ID: String(f.TYPE_ID || "3"), PROVIDER_ID: "CRM_TODO", PROVIDER_TYPE_ID: "TODO", PROVIDER_GROUP_ID: null, DIRECTION: "0",
    SUBJECT: String(f.SUBJECT), START_TIME: dl, END_TIME: dl, DEADLINE: dl, COMPLETED: "N", STATUS: "1", RESPONSIBLE_ID: String(f.RESPONSIBLE_ID || "0"), PRIORITY: "2",
    NOTIFY_TYPE: "0", NOTIFY_VALUE: "0", DESCRIPTION: String(f.DESCRIPTION || ""), DESCRIPTION_TYPE: "1", LOCATION: "", CREATED: nowIso(), LAST_UPDATED: nowIso(),
    AUTHOR_ID: String(f.RESPONSIBLE_ID || "0"), EDITOR_ID: String(f.RESPONSIBLE_ID || "0"), SETTINGS: [], ORIGIN_ID: String(newId), ORIGINATOR_ID: "ODOO", RESULT_STATUS: "0", RESULT_STREAM: "0", FILES: [], COMMUNICATIONS: [] });
  return { result: newId };
}

// ---------------------------------------------------------------------------
// Odoo dashboard «SUN-HTC Call Operators» — plitkalar JONLI, Odoo'ning o'z formulasi bilan
// ---------------------------------------------------------------------------
// Har plitka: sun-dashboard.json dagi domen + plitkaning o'z sana maydoni (create_date,
// date_conversion, date_closed …) bo'yicha oraliq. Operator kesimi — o'sha domen +
// «Оператор (Авто танланади)» bo'yicha guruhlash (sotuv rahbarining usuli: plitkani bosib,
// operator filtrini qo'yish). Snapshot emas — Odoo'dan to'g'ridan-to'g'ri; 5 daqiqa kesh,
// 60 daqiqagacha eski natija darhol qaytadi va fonda yangilanadi.
const DASH_YANGI = 5 * 60e3, DASH_ESKI = 60 * 60e3;
const dashKesh = new Map(), dashJarayon = new Map();
const utcOdoo = (s) => new Date(s).toISOString().slice(0, 19).replace("T", " ");
async function dashHisob(from, to, aniq = null) {
  const t0 = Date.now();
  // aniq — {dan, gacha} (UTC): «oxirgi N kun» Odoo kabi hozirdan N×24 soat orqaga; bo'lmasa to'liq Toshkent kunlari
  const dan = aniq ? aniq.dan : utcOdoo(`${from}T00:00:00+05:00`), gacha = aniq ? aniq.gacha : utcOdoo(`${to}T23:59:59+05:00`);
  const plitkalar = [];
  for (const id of DASH.tartib) {
    const t = DASH.tiles[id]; if (!t) continue;
    const yig = t.hisob === "sum" && t.maydon;
    const g = await call("odoo_read_group", { model: "crm.lead", domain: [...t.d, [t.sana, ">=", dan], [t.sana, "<=", gacha]],
      fields: yig ? ["id:count", `${t.maydon}:sum`] : ["id:count"], groupby: [OP_FIELD], limit: 500 });
    const ops = ((g && g.groups) || []).map((row) => {
      const u = row[0] && typeof row[0] === "object" ? row[0] : null;
      return { id: u ? String(u.id) : "", name: u ? String(u.name || "") : "Operator tanlanmagan",
               count: Number(row[1] || 0), sum: yig ? Math.round(Number(row[2] || 0) * 100) / 100 : null };
    }).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
    const count = ops.reduce((a, x) => a + x.count, 0);
    const sum = yig ? Math.round(ops.reduce((a, x) => a + (x.sum || 0), 0) * 100) / 100 : null;
    plitkalar.push({ id, nom: String(t.nom).replace(/\s+/g, " ").trim(), sana: t.sana, hisob: t.hisob, maydon: t.maydon || null,
                     qiymat: yig ? sum : count, count, ops });
  }
  // Dashboard'ga KIRMAYDIGAN lidlar: SUN kompaniyasi, HR voronkalarisiz, shu davrda yaratilgan,
  // lekin «Tushgan Lead» shartiga tushmagan (operator tanlanmagan yoki call-markaz yaratmagan).
  const A0 = [["company_id", "in", [CFG.company]], ["team_id", "not in", CFG.hrTeams], ["active", "in", [true, false]], ["create_date", ">=", dan], ["create_date", "<=", gacha]];
  const son = async (d) => { const r = await call("odoo_search_count", { model: "crm.lead", domain: d }); return Number(r && typeof r === "object" ? r.count : r) || 0; };
  const jami = await son(A0);
  const tush = await son([...A0, ...DASH.tiles["1006"].d]);
  const opsiz = await son([...A0, [OP_FIELD, "=", false]]);
  const v = { from, to, dan, gacha, tz: "Asia/Tashkent", manba: DASH.manba, plitkalar,
              tashqarida: { jami, tushgan: tush, tashqarida: Math.max(0, jami - tush), operatorsiz: opsiz },
              at: new Date().toISOString(), ms: Date.now() - t0 };
  log(`dashboard ${from}..${to}: ${plitkalar.map((p) => `${p.id}=${p.qiymat}`).join(" ")} · tashqarida ${v.tashqarida.tashqarida} · ${v.ms}ms`);
  return v;
}
function sunDashboard(p) {
  const YMD = /^\d{4}-\d{2}-\d{2}$/, DT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const from = String(p.from || ""), to = String(p.to || "");
  if (!YMD.test(from) || !YMD.test(to) || from > to) throw new BxError(400, "ERROR_ARGUMENT", "from/to: YYYY-MM-DD kerak (from ≤ to)");
  const aniq = DT.test(String(p.dan || "")) && DT.test(String(p.gacha || "")) && String(p.dan) < String(p.gacha) ? { dan: String(p.dan), gacha: String(p.gacha) } : null;
  // «Oxirgi N kun» bitta kalitda turadi (oyna har daqiqa siljiydi): 5 daqiqagacha yangi, keyin fonda yangilanadi
  const kalit = aniq ? `roll_${String(p.kalit || "x").replace(/[^a-z0-9]/gi, "")}` : `${from}_${to}`, h = dashKesh.get(kalit);
  const yangila = () => {
    if (!dashJarayon.has(kalit)) dashJarayon.set(kalit, dashHisob(from, to, aniq).then((v) => {
      dashKesh.set(kalit, { t: Date.now(), v });
      if (dashKesh.size > 60) dashKesh.delete(dashKesh.keys().next().value);
      return v;
    }).finally(() => dashJarayon.delete(kalit)));
    return dashJarayon.get(kalit);
  };
  const yosh = h ? Date.now() - h.t : Infinity;
  if (h && (yosh < DASH_YANGI || (yosh < DASH_ESKI && String(p.fresh || "") !== "1"))) {
    if (yosh >= DASH_YANGI) yangila().catch((e) => log("dashboard XATO:", String(e && e.message || e).slice(0, 120)));
    return Promise.resolve({ result: { ...h.v, kesh: true, eski: yosh >= DASH_YANGI } });
  }
  return yangila().then((v) => ({ result: v }));
}

// ---------------------------------------------------------------------------
// KUNLIK HISOBOT (TZ «Sales OS» 1-bosqich, 2026-09-24): plitkalar KUN × OPERATOR kesimida
// ---------------------------------------------------------------------------
// dashHisob bir davrni read_group bilan hisoblaydi. Kunlik hisobot va 7/30 kunlik grafik uchun
// esa HAR KUN alohida kerak: 30 kun × 9 plitka = 270 so'rov (orasida 1,2 s) — juda sekin.
// Shuning uchun oyna (KUN_DAYS) yozuvlari bir marta olinadi, keyin faqat o'zgarganlari
// (write_date), va plitka domeni (sun-dashboard.json, Odoo'dagi AYNAN formula) shu yozuvlarda
// MAHALLIY baholanadi. «create_uid.group_ids in [252]» sharti uchun guruh a'zolari res.users
// dan o'sha shart bilan olinadi. To'g'riligi dashHisob (Odoo'ning o'z read_group'i) bilan
// solishtiriladi — `sun.daily` ga `tekshir=1` bersangiz ikkala natija yonma-yon qaytadi.
const KUN_DAYS = Number(process.env.ADAPTER_KUN_DAYS || 62);
const KUN = { recs: new Map(), since: null, full: 0, ws: null, guruh: new Map(), faol: new Set(), guruhAt: 0, tel: new Map(), ok: null, err: null, at: null, ms: 0 };
// Plitka domenlaridagi maydonlar (nuqtali create_uid.* dan tashqari) + sana va yig'indi maydonlari
function domMaydonlar(dom, out) { for (const t of dom || []) if (Array.isArray(t) && typeof t[0] === "string" && !t[0].includes(".")) out.add(t[0]); return out; }
const KUN_F = (() => {
  const s = new Set(["id", "name", "type", "active", "won_status", "company_id", "create_uid", "create_date", "write_date", "date_conversion", "date_closed",
    OP_FIELD, PIPE_FIELD, KV_FIELD, "x_studio_stage_changed_at", "x_studio_kval_lid", "x_studio_tolov_usuli", "x_studio_manba", "source_id"]);
  for (const t of Object.values(DASH.tiles)) { domMaydonlar(t.d, s); s.add(t.sana); if (t.maydon) s.add(t.maydon); }
  return [...s];
})();
const KUN_GURUH = (() => {       // domenda uchraydigan «create_uid.group_ids» guruhlari
  const g = new Set();
  for (const t of Object.values(DASH.tiles)) for (const x of t.d || []) if (Array.isArray(x) && x[0] === "create_uid.group_ids") for (const v of [].concat(x[2])) g.add(Number(v));
  return [...g];
})();
async function kunYangila({ toliq = false } = {}) {
  const t0 = Date.now(), ws = utcStr(Date.now() - KUN_DAYS * 864e5);
  // Oyna: shu davrda yaratilgan, managerga o'tgan, yopilgan yoki holati o'zgargan lidlar (arxiv bilan)
  const OYNA = ["|", "|", "|", ["create_date", ">=", ws], ["date_conversion", ">=", ws], ["date_closed", ">=", ws], ["x_studio_stage_changed_at", ">=", ws], ["active", "in", [true, false]]];
  const qayta = toliq || !KUN.since || t0 - KUN.full > 6 * 3600e3;   // 6 soatda bir to'liq (o'chirilganlar tushib qolsin)
  try {
    const rows = await all("crm.lead", qayta ? OYNA : [...OYNA, ["write_date", ">=", KUN.since]], KUN_F, { max: 60000 });
    if (qayta) { KUN.recs = new Map(); KUN.full = t0; }
    for (const r of rows) KUN.recs.set(Number(r.id), r);
    const ichida = (r) => [r.create_date, r.date_conversion, r.date_closed, r.x_studio_stage_changed_at].some((x) => x && String(x) >= ws);
    for (const [id, r] of KUN.recs) if (!ichida(r)) KUN.recs.delete(id);
    if (t0 - KUN.guruhAt > 3600e3 || !KUN.guruh.size) {
      const g = new Map(), faol = new Set();
      for (const gid of KUN_GURUH) {
        const us = await all("res.users", [["group_ids", "in", [gid]], ["active", "in", [true, false]]], ["id", "name", "active"], { max: 2000 });
        g.set(gid, new Set(us.map((u) => Number(u.id))));
        for (const u of us) if (u.active) faol.add(Number(u.id));
      }
      KUN.guruh = g; KUN.faol = faol; KUN.guruhAt = t0;
    }
    KUN.since = utcStr(t0 - 10 * 60e3); KUN.ws = ws; KUN.ok = true; KUN.err = null; KUN.at = new Date().toISOString(); KUN.ms = Date.now() - t0;
    log(`kunlik: ${KUN.recs.size} yozuv (${qayta ? "to'liq" : "+" + rows.length}) · ${KUN.ms}ms`);
  } catch (e) { KUN.ok = false; KUN.err = String(e && e.message || e).slice(0, 160); log("kunlik XATO:", KUN.err); }
}

// Odoo prefiks domeni — plitkalarda uchraydigan shakllar. Odoo qoidasi: `!=` va `not in`
// bo'sh (NULL) qiymatni ham oladi; many2one [id, nom] — id bilan solishtiriladi.
function kunQiymat(r, f) {
  if (f === "create_uid.id") return Number(idOf(r.create_uid) || 0);
  const v = r[f];
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number") return v[0];
  if (v && typeof v === "object" && !Array.isArray(v) && "id" in v) return Number(v.id);
  return v === undefined || v === null ? false : v;
}
function kunBarg(r, t) {
  const [f, op, val] = t;
  if (f === "create_uid.group_ids") {
    const uid = Number(idOf(r.create_uid) || 0);
    const bor = [].concat(val).some((g) => KUN.guruh.get(Number(g))?.has(uid));
    if (op === "in" || op === "=") return bor;
    if (op === "not in" || op === "!=") return !bor;
    throw new Error(`domen: ${f} ${op} qo'llanmaydi`);
  }
  const x = kunQiymat(r, f);
  const teng = (v) => (v === false ? x === false || x === "" : x === v || (typeof x === "number" && x === Number(v)));
  if (op === "=") return teng(val);
  if (op === "!=") return !teng(val);
  if (op === "in") return [].concat(val).some(teng);
  if (op === "not in") return ![].concat(val).some(teng);
  throw new Error(`domen operatori qo'llanmaydi: ${op}`);
}
// Odoo odatiy «active_test»: domenda `active` sharti bo'lmasa arxivlangan yozuv SANALMAYDI
// (masalan «Jarayonda», «1-6 oy», «Servis», «Yangi lead» plitkalari). Shart bo'lsa — o'zi hal qiladi.
const aktivShart = (dom) => (dom || []).some((x) => Array.isArray(x) && x[0] === "active");
function kunDom(dom, r) {
  if (!aktivShart(dom) && r.active === false) return false;
  let i = 0;
  const ex = () => {
    const t = dom[i++];
    if (t === "&") { const a = ex(), b = ex(); return a && b; }
    if (t === "|") { const a = ex(), b = ex(); return a || b; }
    if (t === "!") return !ex();
    return kunBarg(r, t);
  };
  let ok = true;
  while (i < dom.length) ok = ex() && ok;          // yuqori darajadagi shartlar — VA
  return ok;
}

// from..to (Toshkent kunlari) → har kun: plitkalar (operator kesimida) + operator faolligi
function kunHisob(from, to) {
  const kunlar = {};
  const kun = (d) => kunlar[d] || (kunlar[d] = { plit: {}, ops: {}, manba: {}, manbaIds: {} });
  const ismlar = new Map();
  const ism = (v) => { const o = m2o(v); if (o && o.id && o.name) ismlar.set(String(o.id), String(o.name)); };
  const qator = (d, op) => {
    const k = kun(d).ops;
    return k[op] || (k[op] = { yangi: [], ishYangi: [], eski: new Set(), kontakt: new Map(), qLid: new Set(), kp: [], muddatli: [], kval: 0, belgilanmagan: [], faol: [],
      q: { jami: 0, chiq: 0, kir: 0, javobli: 0, javobsiz: 0, kirJavobsiz: 0, sek: 0 } });
  };
  const kunOf = (s) => (s ? iso(s).slice(0, 10) : "");
  const T1006 = DASH.tiles["1006"];
  // 1) Plitkalar — Odoo formulasi, plitkaning o'z sana maydoni bo'yicha
  for (const id of DASH.tartib) {
    const t = DASH.tiles[id]; if (!t) continue;
    const yig = t.hisob === "sum" && t.maydon;
    for (const r of KUN.recs.values()) {
      const d = kunOf(r[t.sana]); if (!d || d < from || d > to) continue;
      if (!kunDom(t.d, r)) continue;
      const op = idOf(r[OP_FIELD]) || ""; ism(r[OP_FIELD]);
      const p = kun(d).plit[id] || (kun(d).plit[id] = { jami: 0, ops: {}, ...(yig ? { sum: 0, opsum: {} } : {}) });
      p.jami++; p.ops[op] = (p.ops[op] || 0) + 1;
      if (yig) { const v = Number(r[t.maydon] || 0); p.sum += v; p.opsum[op] = (p.opsum[op] || 0) + v; }
    }
  }
  // 2) Shu kuni tushgan lidlar («Tushgan Lead» kohortasi): KP, muddatli to'lov, Odoo «Квал лид», belgilanmagan
  const lidSana = new Map();
  for (const r of KUN.recs.values()) {
    lidSana.set(String(r.id), kunOf(r.create_date));
    const d = kunOf(r.create_date); if (!d || d < from || d > to || !kunDom(T1006.d, r)) continue;
    const op = idOf(r[OP_FIELD]) || ""; const o = qator(d, op);
    const mn = r.x_studio_manba || nameOf(r.source_id) || "Manbasiz"; kun(d).manba[mn] = (kun(d).manba[mn] || 0) + 1;
    (kun(d).manbaIds[mn] || (kun(d).manbaIds[mn] = [])).push(String(r.id));   // manba tugmachasi bosilganda — ro'yxat (son bilan aynan bir xil)
    o.yangi.push(r.id);
    if (r[PIPE_FIELD] === "Кп") o.kp.push(r.id);
    if (r.x_studio_tolov_usuli === "Muddatli Tulov") o.muddatli.push(r.id);
    if (r.x_studio_kval_lid) o.kval++;
    if (r.type === "lead" && r.active && r[PIPE_FIELD] === "status1") o.belgilanmagan.push(r.id);   // hali «Янги лид»
  }
  // Operatorlar (call-markaz guruhi) — faollik ular bo'yicha yig'iladi
  const callMarkaz = new Set(); for (const s of KUN.guruh.values()) for (const u of s) callMarkaz.add(String(u));
  const lidEski = new Map((DB.leads || []).map((x) => [x.ID, String(x.DATE_CREATE || "").slice(0, 10)]));
  const sanaOf = (lid) => lidSana.get(String(lid)) ?? lidEski.get(String(lid)) ?? "";
  // 3) Faollik VAQTI (birinchi/oxirgi) — faqat operatorning O'Z harakati: qo'ng'iroq (VoIP user_id) va o'zi
  //    kiritgan lid (create_uid). Holat o'zgarishi va managerga o'tkazish kim tomonidan qilingani noma'lum
  //    (menejer ertalab o'zgartirsa operator «vaqtida boshlagan» bo'lib chiqardi) — ular faqat lidni
  //    «ishlangan» deb belgilaydi (operator — «Оператор (Авто танланади)» maydoni bo'yicha).
  //    «Ishlangan yangi lid» (ishYangi) — shu kuni tushgan va operator HARAKATI bo'lgan lid. Odoo'ning
  //    «Ishlangan Leadlar» (#1007) formulasi emas: u OdooBot yaratgandayoq «Жараёнда» qo'ygan lidni ham
  //    ishlangan deb sanaydi (20-sentabr, yakshanba: qo'ng'iroq 0, lekin #1007 = 61).
  //    Qo'ng'iroq qilingan yangi lidlar panelda qo'shiladi (qongiroqLid).
  for (const r of KUN.recs.values()) {
    const yarat = idOf(r.create_uid);
    const dc = kunOf(r.create_date);
    const op = idOf(r[OP_FIELD]) || "";
    const yangiLid = dc >= from && dc <= to && kunDom(T1006.d, r);
    if (yarat && callMarkaz.has(yarat) && dc >= from && dc <= to) {
      qator(dc, yarat).faol.push(iso(r.create_date));
      if (yangiLid && op) qator(dc, op).ishYangi.push(r.id);       // call-markaz xodimi o'zi kiritgan lid
    }
    if (!op) continue;
    const sc = r.x_studio_stage_changed_at;
    if (sc && sc !== r.create_date && r.type === "lead") {
      const d = kunOf(sc);
      if (d >= from && d <= to) { const o = qator(d, op); if (dc && dc < d) o.eski.add(String(r.id)); else if (dc === d && yangiLid) o.ishYangi.push(r.id); }
    }
    const dv = kunOf(r.date_conversion);
    if (dv && dv >= from && dv <= to) { const o = qator(dv, op); if (dc && dc < dv) o.eski.add(String(r.id)); else if (dc === dv && yangiLid) o.ishYangi.push(r.id); }
  }
  // 4) VoIP qo'ng'iroqlari (Odoo voip.call): operator = user_id
  const raqam = (v) => String(v || "").replace(/\D/g, "").slice(-9);
  for (const v of VOIP.rows.values()) {
    const boshT = v.start_date || v.create_date; if (!boshT) continue;
    const at = iso(boshT), d = at.slice(0, 10); if (d < from || d > to) continue;
    const uid = idOf(v.user_id) || ""; ism(v.user_id);
    const sek = v.start_date && v.end_date ? Math.max(0, Math.round((Date.parse(iso(v.end_date)) - Date.parse(at)) / 1000)) : Math.max(0, Math.round(Number(v.duration || 0) * 3600));
    const javobsiz = ["missed", "rejected", "aborted"].includes(v.state) || (v.state === "terminated" && sek === 0);
    const o = qator(d, uid);
    const chiq = v.direction === "outgoing";
    o.q.jami++; if (chiq) o.q.chiq++; else o.q.kir++;
    if (javobsiz) { o.q.javobsiz++; if (!chiq) o.q.kirJavobsiz++; } else { o.q.javobli++; o.q.sek += sek; }
    if (chiq || !javobsiz) o.faol.push(at);          // javobsiz KIRUVCHI — operator harakati emas (u ko'tarmagan)
    const tel = raqam(v.phone_number), ix = tel.length === 9 ? KUN.tel.get(tel) : null;
    const lid = idOf(v.x_studio_lead) || (ix && ix.tur === 1 ? ix.id : null);
    if (lid) o.qLid.add(String(lid));
    // «Ko'tarmadi» — CHIQUVCHI qo'ng'iroqqa mijoz javob bermagan (kun davomida birorta ham javob bo'lmagan) lid/raqam
    const kalit = lid ? "L" + lid : tel.length === 9 ? "T" + tel : null;
    if (kalit && chiq) { const k = o.kontakt.get(kalit) || { lid, javob: false }; if (!javobsiz) k.javob = true; o.kontakt.set(kalit, k); }
    if (lid) { const cd = sanaOf(lid); if (!cd || cd < d) o.eski.add(String(lid)); }   // sanasi noma'lum = oynadan ham eski
  }
  for (const u of DB.users || []) if (u.ID && !ismlar.has(u.ID)) ismlar.set(u.ID, `${u.NAME || ""} ${u.LAST_NAME || ""}`.trim());
  // 5) Jamlash (Set/Map → son va ro'yxat)
  const hh = (s) => (s ? s.slice(11, 16) : null);
  const out = {};
  for (const [d, k] of Object.entries(kunlar)) {
    const ops = {};
    for (const [op, o] of Object.entries(k.ops)) {
      const f = o.faol.sort();
      const kontakt = [...o.kontakt.values()];
      ops[op] = { yangi: o.yangi.length, yangiIds: o.yangi.map(String), ishYangiIds: [...new Set(o.ishYangi.map(String))], eski: o.eski.size, eskiIds: [...o.eski],
        kotarmadi: kontakt.filter((x) => !x.javob).length, kotarmadiLid: kontakt.filter((x) => !x.javob && x.lid).map((x) => String(x.lid)),
        boglandi: kontakt.filter((x) => x.javob).length,
        qongiroqLid: [...o.qLid],   // shu kuni qo'ng'iroq bo'lgan lidlar (ikki yo'nalish)
        kp: o.kp.length, kpIds: o.kp.map(String), muddatli: o.muddatli.length, muddatliIds: o.muddatli.map(String), kval: o.kval,
        belgilanmagan: o.belgilanmagan.length, belgilanmaganIds: o.belgilanmagan.map(String),
        q: { ...o.q, ortacha: o.q.javobli ? Math.round(o.q.sek / o.q.javobli) : 0 },
        birinchi: hh(f[0]), oxirgi: hh(f[f.length - 1]), callMarkaz: callMarkaz.has(op) };
    }
    out[d] = { plit: k.plit, ops, manba: k.manba, manbaIds: k.manbaIds };
  }
  // Belgilanmagan qoldiq (oyna bo'yicha): hali «Янги лид» turgan «Tushgan Lead»lar, operator kesimida
  const qoldiq = {};
  for (const r of KUN.recs.values()) {
    if (!(r.type === "lead" && r.active && r[PIPE_FIELD] === "status1") || !kunDom(T1006.d, r)) continue;
    const op = idOf(r[OP_FIELD]) || ""; qoldiq[op] = (qoldiq[op] || 0) + 1;
  }
  return { kunlar: out, qoldiq, ismlar: Object.fromEntries(ismlar), callMarkaz: [...callMarkaz], callMarkazFaol: [...KUN.faol].map(String) };
}
// Bitta kunning lidlari (jadvaldan bosilganda ro'yxat): nom, holat, Odoo havolasi
function kunLidlar(k) {
  const ids = new Set();
  for (const o of Object.values(k?.ops || {})) for (const f of ["yangiIds", "eskiIds", "kpIds", "muddatliIds", "belgilanmaganIds", "kotarmadiLid"]) for (const id of o[f] || []) ids.add(String(id));
  for (const arr of Object.values(k?.manbaIds || {})) for (const id of arr) ids.add(String(id));
  const L = new Map((DB.leads || []).map((x) => [x.ID, x])), Dl = new Map((DB.deals || []).map((x) => [x.ID, x]));
  const out = {};
  for (const id of ids) {
    const r = KUN.recs.get(Number(id)), l = L.get(id), dl = !l ? Dl.get(id) : null;   // eski lid bitim ro'yxatida bo'lishi mumkin
    const holat = r ? (r.type === "opportunity" ? "Managerga o'tgan" : !r.active && r.won_status === "lost" ? "Otkaz" : !r.active ? "Arxivlangan" : (PIPE[r[PIPE_FIELD]]?.[1] || String(r[PIPE_FIELD] || "Holatsiz")))
      : l ? l.STATUS_DESCRIPTION || "" : dl ? `Bitim: ${dl.STAGE_DESCRIPTION || ""}` : "";
    // o/oid — lidning operatori («Оператор (Авто танланади)»): manba oynasida taqsimot va operator roli uchun filtr
    out[id] = { n: String(r ? r.name || "" : l ? l.TITLE || "" : dl ? dl.TITLE || "" : "").slice(0, 80), h: holat, url: `${CFG.portal}/odoo/crm/${id}`,
      o: r ? nameOf(r[OP_FIELD]) : "", oid: r ? idOf(r[OP_FIELD]) || "" : "" };
  }
  return out;
}
// Bitta kunning qo'ng'iroqlari operator kesimida — panelda «kun xaritasi» (operator oynasi) uchun.
// Faqat vaqt, yo'nalish, javob va davomiylik: [ "HH:MM", chiquvchi 1/0, javob 1/0, sekund ]. Telefon raqami YO'Q.
// Javob/davomiylik qoidasi kunHisob (4-qadam) bilan bir xil.
function kunQongiroq(d) {
  const out = {};
  for (const v of VOIP.rows.values()) {
    const boshT = v.start_date || v.create_date; if (!boshT) continue;
    const at = iso(boshT); if (at.slice(0, 10) !== d) continue;
    const sek = v.start_date && v.end_date ? Math.max(0, Math.round((Date.parse(iso(v.end_date)) - Date.parse(at)) / 1000)) : Math.max(0, Math.round(Number(v.duration || 0) * 3600));
    const javobsiz = ["missed", "rejected", "aborted"].includes(v.state) || (v.state === "terminated" && sek === 0);
    const uid = idOf(v.user_id) || "";
    (out[uid] || (out[uid] = [])).push([at.slice(11, 16), v.direction === "outgoing" ? 1 : 0, javobsiz ? 0 : 1, javobsiz ? 0 : sek]);
  }
  for (const a of Object.values(out)) a.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return out;
}
async function sunDaily(p) {
  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const from = String(p.from || ""), to = String(p.to || "");
  if (!YMD.test(from) || !YMD.test(to) || from > to) throw new BxError(400, "ERROR_ARGUMENT", "from/to: YYYY-MM-DD kerak (from ≤ to)");
  if (!KUN.at || String(p.fresh || "") === "1") await kunYangila();
  if (!KUN.at) throw new BxError(503, "KUN_NOT_READY", `Kunlik ma'lumot olinmadi: ${KUN.err || "noma'lum"}`);
  const oynaBosh = iso(KUN.ws).slice(0, 10);
  const v = { from, to, tz: "Asia/Tashkent", manba: DASH.manba, tartib: DASH.tartib,
    nomlar: Object.fromEntries(DASH.tartib.map((id) => [id, String(DASH.tiles[id]?.nom || id).replace(/\s+/g, " ").trim()])),
    oyna: { bosh: oynaBosh, yozuv: KUN.recs.size, at: KUN.at, ms: KUN.ms, err: KUN.err, toliq: from > oynaBosh },
    voip: { ok: VOIP.ok, err: VOIP.err, qongiroq: VOIP.rows.size }, ...kunHisob(from, to), at: new Date().toISOString() };
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(p.lid_kun || ""))) { v.lidlar = kunLidlar(v.kunlar[String(p.lid_kun)]); v.qongiroqlar = kunQongiroq(String(p.lid_kun)); }
  // Tekshiruv: shu davr uchun Odoo'ning o'z read_group natijasi (dashHisob) bilan solishtirish
  if (String(p.tekshir || "") === "1") {
    const odoo = await dashHisob(from, to);
    v.tekshiruv = odoo.plitkalar.map((pl) => {
      const bizniki = Object.values(v.kunlar).reduce((a, k) => a + (k.plit[pl.id]?.jami || 0), 0);
      return { id: pl.id, odoo: pl.count, bizniki, mos: pl.count === bizniki,
        ops: pl.ops.filter((o) => (Object.values(v.kunlar).reduce((a, k) => a + (k.plit[pl.id]?.ops[o.id] || 0), 0)) !== o.count).map((o) => o.id) };
    });
  }
  return { result: v };
}

// ---------------------------------------------------------------------------
// YANGI LIDLAR (TZ 3.4, 2026-09-24): «issiq lidga 15 daqiqada qo'ng'iroq qilinmasa — rahbarga xabar».
// Snapshot 10 daqiqada bir yangilanadi — bu tekshiruv uchun kech. Shuning uchun oxirgi `daq` daqiqada
// tushgan lidlar va shu oraliqdagi VoIP qo'ng'iroqlari Odoo'dan TO'G'RIDAN-TO'G'RI olinadi (2–3 so'rov).
// Lid maydonlari snapshotdagi L bilan bir xil nomda — panel bitta skoring funksiyasini ishlatadi.
// ---------------------------------------------------------------------------
async function sunYangi(p) {
  const daq = Math.max(15, Math.min(360, Number(p.daq || 120)));
  const dan = utcStr(Date.now() - daq * 60e3);
  const recs = await all("crm.lead", [...DASH.tiles["1006"].d, ["create_date", ">=", dan]],
    ["id", "name", "type", "active", "won_status", "phone", "city", "source_id", "x_studio_manba", "x_studio_company_type", "partner_name", "contact_name",
     "create_date", "x_studio_type_1", OP_FIELD, PIPE_FIELD, "x_studio_stage_changed_at", ...SKOR_F], { max: 1000 });
  const raqam = (v) => String(v || "").replace(/\D/g, "").slice(-9);
  const calls = recs.length ? await all("voip.call", [["create_date", ">=", dan]], ["id", "x_studio_lead", "direction", "state", "start_date", "end_date", "create_date", "phone_number", "user_id"], { max: 5000 }) : [];
  const byId = new Map(recs.map((r) => [String(r.id), r])), byTel = new Map();
  for (const r of recs) { const t = raqam(r.phone); if (t.length === 9) byTel.set(t, String(r.id)); }
  const q = new Map();
  for (const v of calls) {
    const lid = idOf(v.x_studio_lead) && byId.has(idOf(v.x_studio_lead)) ? idOf(v.x_studio_lead) : byTel.get(raqam(v.phone_number));
    if (!lid) continue;
    const at = iso(v.start_date || v.create_date), sek = v.start_date && v.end_date ? (Date.parse(iso(v.end_date)) - Date.parse(at)) / 1000 : 0;
    const javobsiz = ["missed", "rejected", "aborted"].includes(v.state) || (v.state === "terminated" && sek <= 0);
    const x = q.get(lid) || { chiq: "", n: 0, javob: 0, kir: 0 };
    x.n++; if (!javobsiz) x.javob++;
    if (v.direction === "outgoing" && (!x.chiq || at < x.chiq)) x.chiq = at;
    if (v.direction !== "outgoing" && !javobsiz) x.kir++;
    q.set(lid, x);
  }
  const leads = recs.map((r) => {
    const x = q.get(String(r.id)) || {}, src = r.x_studio_manba || nameOf(r.source_id) || "";
    return { ID: String(r.id), TITLE: r.name || "", COMPANY_TITLE: r.partner_name || "", NAME: r.contact_name || "", DATE_CREATE: iso(r.create_date),
      SOURCE_ID: src ? String(src).toUpperCase().replace(/\s+/g, "_") : "", SOURCE_DESCRIPTION: src, ADDRESS_CITY: r.city || "",
      UF_CRM_CLIENT_TYPE: CLIENT_TYPE[r.x_studio_company_type] || r.x_studio_company_type || "", UF_CRM_SELECTBOX: r.x_studio_type_1 || "",
      UF_CRM_OPERATOR: idOf(r[OP_FIELD]) || "", UF_CRM_OPERATOR_NAME: nameOf(r[OP_FIELD]), UF_CRM_PIPE: r[PIPE_FIELD] || "",
      UF_CRM_TYPE: r.type || "", ACTIVE: r.active ? "Y" : "N", UF_CRM_LOST: r.won_status === "lost" ? "Y" : "",
      UF_CRM_STAGE_AT: iso(r.x_studio_stage_changed_at), UF_CRM_MAQSAD: tozaTanlov(r.x_studio_maqsad_2), UF_CRM_BILL: Number(r.x_studio_probability_new || 0),
      UF_CRM_KWT: Number(r.x_studio_stansiya_kwt || 0), UF_CRM_UCHR_JOY: r.x_studio_selection_field_3cu_1jloqho34 || "", UF_CRM_TOLOV: r.x_studio_tolov_usuli || "",
      UF_CRM_MUDDAT: r.x_rejalashtirilgan_ornatish_muddati || r.x_studio_when || "", UF_CRM_JOY: tozaTanlov(r.x_studio_where),
      UF_CRM_CALLS_N: x.n || 0, UF_CRM_CALLS_ANS: x.javob || 0, UF_CRM_CALLS_IN: x.kir || 0, UF_CRM_FIRST_OUT: x.chiq || "",
      UF_CRM_ODOO_URL: `${CFG.portal}/odoo/crm/${r.id}` };
  });
  return { result: { at: new Date().toISOString(), daq, leads } };
}

// ---------------------------------------------------------------------------
// Metodlar (§5.2)
// ---------------------------------------------------------------------------
const M = {
  // Odoo «SUN-HTC Call Operators» dashboard plitkalari (jonli, Odoo formulasi bilan)
  "sun.dashboard.kpi": (p) => sunDashboard(p),
  // Kunlik hisobot: plitkalar kun × operator kesimida + VoIP faollik (TZ 1-bosqich)
  "sun.daily": (p) => sunDaily(p),
  // Oxirgi N daqiqada tushgan lidlar + qo'ng'iroqlar (issiq lid ogohlantirishi, TZ 3.4)
  "sun.yangi": (p) => sunYangi(p),
  "app.info": () => ({ result: { ID: "1", CODE: "odoo-adapter", VERSION: 1, STATUS: "L", INSTALLED: true, LANGUAGE_ID: "ru", LICENSE: "odoo", SCOPE: scopes() } }),
  "profile": () => ({ result: { ID: "185", ADMIN: false, NAME: "MCP", LAST_NAME: "user", TIME_ZONE: "Asia/Tashkent", TIME_ZONE_OFFSET: CFG.tzMin * 60 } }),
  "scope": () => ({ result: scopes() }),
  "crm.lead.list": (p) => listOf(DB.leads, p),
  "crm.lead.get": (p) => getOne(DB.leads, p),
  "crm.lead.fields": () => ({ result: Object.fromEntries(Object.keys(DB.leads[0] || {}).map((k) => [k, { type: "string" }])) }),
  "crm.lead.update": (p) => updateLead(DB.leads, p, true),
  "crm.deal.list": (p) => listOf(DB.deals, p),
  "crm.deal.get": (p) => getOne(DB.deals, p),
  "crm.deal.fields": () => ({ result: Object.fromEntries(Object.keys(DB.deals[0] || {}).map((k) => [k, { type: "string" }])) }),
  "crm.deal.update": (p) => updateLead(DB.deals, p, false),
  "crm.contact.list": (p) => listOf(DB.contacts, p),
  "crm.contact.get": (p) => getOne(DB.contacts, p),
  "crm.company.list": (p) => listOf(DB.companies, p),
  "crm.company.get": (p) => getOne(DB.companies, p),
  "crm.activity.list": (p) => listOf(DB.activities, p),
  // Hisob-fakturalar (Odoo account.move) — «haqiqiy tushum» bloki uchun
  "crm.invoice.list": (p) => listOf(DB.invoices, p),
  // Telefoniya: panel yozuv (audio) manzilini shu usul orqali so'raydi.
  // Odoo'da audio `call.record.api.audio_file` da — URL adapterning o'ziga qaraydi.
  "voximplant.statistic.get": (p) => {
    scopeCheck("telephony");
    const f = p.FILTER || p.filter || {};
    const raqam = (v) => String(v || "").replace(/\D/g, "").slice(-9);
    let rows = DB.callRows;
    if (f.CALL_ID) {
      const k = String(f.CALL_ID);
      rows = rows.filter((x) => x.callId === k || x.id === k);
    } else {
      const dan = f[">=CALL_START_DATE"], gacha = f["<=CALL_START_DATE"];
      if (dan) rows = rows.filter((x) => x.at >= String(dan).slice(0, 19));
      if (gacha) rows = rows.filter((x) => x.at <= String(gacha).slice(0, 19) + "z");
      if (f.PHONE_NUMBER) { const k = raqam(f.PHONE_NUMBER); rows = rows.filter((x) => raqam(x.phone) === k); }
    }
    const out = rows.slice(0, 50).map((x) => ({
      ID: x.id, CALL_ID: x.callId, CALL_START_DATE: x.at, CALL_DURATION: x.dur,
      PHONE_NUMBER: x.phone, PORTAL_USER_ID: "0",
      CALL_TYPE: x.out ? "1" : "2", CALL_FAILED_CODE: x.failed ? "304" : "200",
      CALL_RECORD_URL: x.audio ? `http://${CFG.host}:${CFG.port}/audio/${x.id}` : "",
    }));
    return { result: out, total: out.length };
  },
  "crm.activity.get": (p) => getOne(DB.activities, p),
  "crm.activity.add": (p) => addActivity(p),
  "crm.duplicate.findbycomm": (p) => {
    const type = String(p.type || p.TYPE || "PHONE").toUpperCase();
    const values = (Array.isArray(p.values) ? p.values : p.values ? [p.values] : p.VALUES || []).map((v) => String(v).replace(/\D/g, ""));
    const et = p.entity_type ? String(p.entity_type).toUpperCase() : null;
    const has = (row) => (row[type] || []).some((m) => values.some((v) => v && String(m.VALUE).replace(/\D/g, "").endsWith(v.slice(-9))));
    const out = {};
    if (!et || et === "CONTACT") { const ids = DB.contacts.filter(has).map((c) => Number(c.ID)); if (ids.length) out.CONTACT = ids; }
    if (!et || et === "COMPANY") { const ids = DB.companies.filter(has).map((c) => Number(c.ID)); if (ids.length) out.COMPANY = ids; }
    if (!et || et === "LEAD") { const ids = DB.leads.filter(has).map((c) => Number(c.ID)); if (ids.length) out.LEAD = ids; }
    return { result: out };
  },
  "crm.dealcategory.list": () => ({ result: CATS.filter((c) => c.ID !== "0").map((c, i) => ({ ID: c.ID, NAME: c.NAME, SORT: String((i + 1) * 100), IS_LOCKED: "N" })) }),
  "crm.dealcategory.default.get": () => ({ result: { ID: 0, NAME: CATS[0].NAME } }),
  "crm.dealcategory.stage.list": (p) => { const id = String(p.id ?? p.ID ?? "0"); return { result: DB.statuses.filter((s) => s.ENTITY_ID === (id === "0" ? "DEAL_STAGE" : `DEAL_STAGE_${id}`)).map((s) => ({ NAME: s.NAME, SORT: s.SORT, STATUS_ID: s.STATUS_ID, SEMANTICS: s.SEMANTICS, COLOR: s.COLOR })) }; },
  "crm.status.list": (p) => listOf(DB.statuses, { ...p, order: p.order || { SORT: "ASC" } }),
  "crm.status.entity.types": () => ({ result: [...new Set(DB.statuses.map((s) => s.ENTITY_ID))].map((id) => ({ ID: id, NAME: id, SEMANTIC_INFO: id.startsWith("DEAL_STAGE") || id === "STATUS" ? { START_FIELD: "NEW", FINAL_SUCCESS_FIELD: id === "STATUS" ? "CONVERTED" : "WON", FINAL_UNSUCCESS_FIELD: id === "STATUS" ? "JUNK" : "LOSE" } : null })) }),
  "user.get": (p) => {
    scopeCheck("user");
    let ids = p.ID ?? p.id ?? (p.filter && p.filter.ID) ?? (p.FILTER && p.FILTER.ID) ?? null; let rows = DB.users;
    if (ids !== null && ids !== undefined) { ids = (Array.isArray(ids) ? ids : [ids]).map(String); rows = rows.filter((u) => ids.includes(u.ID)); }
    if (p.ACTIVE !== undefined || (p.filter && p.filter.ACTIVE !== undefined)) rows = rows.filter((u) => u.ACTIVE);
    return { result: rows.slice(0, 1000), total: rows.length }; // ichki iste'molchilar bitta sahifada hammasini oladi
  },
  "user.current": () => { scopeCheck("user"); return { result: DB.users[0] }; },
};

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function send(res, status, obj) { const body = JSON.stringify(obj); res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "X-Odoo-Adapter": "1" }); res.end(body); }
const timeBlock = (t0) => { const t1 = Date.now(); return { start: t0 / 1000, finish: t1 / 1000, duration: (t1 - t0) / 1000, processing: (t1 - t0) / 1000, date_start: iso(new Date(t0)), date_finish: iso(new Date(t1)) }; };

const server = http.createServer((req, res) => {
  const t0 = Date.now(); const url = new URL(req.url, `http://${req.headers.host || "localhost"}`); const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks).toString("utf8");
    try {
      if (url.pathname === "/healthz") return send(res, 200, { ok: !DB.err && !!DB.at, source: "odoo", at: DB.at, ms: DB.ms, counts: DB.counts, readonly: CFG.readonly, writes: [...CFG.writes], err: DB.err, scope: scopes() });
      if (url.pathname === "/refresh") { await refresh(); return send(res, 200, { ok: !DB.err, at: DB.at, counts: DB.counts, err: DB.err }); }
      // Qo'ng'iroq audiosi: Odoo binary maydonini base64 dan ochib uzatamiz.
      // Panel buni server tomonda yuklab oladi (tashqariga ochilmaydi — 127.0.0.1).
      const am = url.pathname.match(/^\/audio\/(v?)(\d+)$/);
      if (am && am[1] === "v") {   // VoIP yozuvi: ir.attachment (res_model = voip.call)
        try {
          const r = R(await call("odoo_search_read", { model: "ir.attachment",
            domain: [["res_model", "=", "voip.call"], ["res_id", "=", Number(am[2])]], fields: ["id", "datas", "mimetype", "name"], limit: 1, order: "id desc" }));
          const rec = r && r[0];
          if (!rec || !rec.datas) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "yozuv yo'q" })); }
          let b64 = String(rec.datas || "").trim();
          const mrep = b64.match(/^b(['"])([\s\S]*)\1$/); if (mrep) b64 = mrep[2];
          const buf = Buffer.from(b64, "base64");
          const tur = String(rec.mimetype || "audio/webm").split(";")[0] || "audio/webm";
          res.writeHead(200, { "content-type": tur, "content-length": buf.length, "cache-control": "private, max-age=900" });
          log("audio", "v" + am[2], `${(buf.length / 1024).toFixed(0)}KB`);
          return res.end(buf);
        } catch (e) {
          res.writeHead(502, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: String(e && e.message || e).slice(0, 200) }));
        }
      }
      if (am) {
        try {
          const r = R(await call("odoo_search_read", { model: "call.record.api",
            domain: [["id", "=", Number(am[2])]], fields: ["id", "audio_file", "audio_filename"], limit: 1 }));
          const rec = r && r[0];
          if (!rec || !rec.audio_file) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "audio yo'q" })); }
          let b64 = String(rec.audio_file || "").trim();
          const mrep = b64.match(/^b(['"])([\s\S]*)\1$/);   // Python bytes repr: b'...'
          if (mrep) b64 = mrep[2];
          const buf = Buffer.from(b64, "base64");
          const nom = String(rec.audio_filename || "call.mp3");
          const tur = /\.wav$/i.test(nom) ? "audio/wav" : /\.ogg$/i.test(nom) ? "audio/ogg" : "audio/mpeg";
          res.writeHead(200, { "content-type": tur, "content-length": buf.length, "cache-control": "private, max-age=900" });
          log("audio", am[2], `${(buf.length / 1024).toFixed(0)}KB`);
          return res.end(buf);
        } catch (e) {
          res.writeHead(502, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: String(e && e.message || e).slice(0, 200) }));
        }
      }
      const m = url.pathname.match(/^\/rest\/(\d+)\/([A-Za-z0-9_]+)\/([a-z0-9_.]+)(?:\.json)?$/i);
      if (!m) return send(res, 404, { error: "ERROR_METHOD_NOT_FOUND", error_description: "Method not found!" });
      const method = m[3].toLowerCase().replace(/\.json$/, ""); const fn = M[method];
      if (!fn) return send(res, 404, { error: "ERROR_METHOD_NOT_FOUND", error_description: `Method not found: ${method}` });
      if (!DB.at) await refresh();
      const p = parseParams(url.search.slice(1), body, req.headers["content-type"]);
      const out = await fn(p); out.time = timeBlock(t0);
      log(method, `start=${p.start ?? 0}`, `total=${out.total ?? "-"}`, `${Date.now() - t0}ms`);
      return send(res, 200, out);
    } catch (e) {
      if (e instanceof BxError) return send(res, e.status, { error: e.code, error_description: e.message });
      console.error("[odoo-adapter] xato", e);
      return send(res, 500, { error: "INTERNAL_SERVER_ERROR", error_description: String(e && e.message || e) });
    }
  });
});
server.listen(CFG.port, CFG.host, async () => {
  log(`[odoo-adapter] http://${CFG.host}:${CFG.port}/rest/1/odoo/  refresh=${CFG.refresh}s readonly=${CFG.readonly} daysBack=${CFG.daysBack} teams=${CFG.teams.join(",")} hr(chiqarilgan)=${CFG.hrTeams.join(",")} company=${CFG.company}`);
  try { await odoo.boshla(); } catch (e) { log("Odoo ulanish XATO", String(e && e.message || e)); }
  await refresh();
  setInterval(refresh, CFG.refresh * 1000).unref();
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
