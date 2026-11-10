// Sotuv voronkasi — TZ «Sun-HighTech Sales OS» 2-modul (2026-09-24).
//
// Liddan to'lovgacha: har bosqichda nechta lid, bosqichlararo konversiya, lid qayerda yo'qolayotgani,
// bosqichda turish vaqti, «qotib qolgan» lidlar, yo'qotish sabablari va 30 kundan keyin qayta ishlash.
//
// KOHORTA: tanlangan davrda TUSHGAN lidlar («Tushgan Lead», #1006) va har biri qaysi bosqichgacha yetgani.
// Bosqichlar ketma-ket: keyingi bosqichga yetgan lid oldingilaridan ham o'tgan hisoblanadi (masalan,
// managerga o'tgan lid «bog'landi» va «sifatli» bosqichlarida ham sanaladi) — shuning uchun konversiya
// hech qachon 100% dan oshmaydi. Imkoniyat (opportunity) qaysi bosqichda yopilgan bo'lsa, shu bosqichgacha
// yetgan deb olinadi.
//
// Bosqich tarixi (mail.tracking.value) MCP kalitida YO'Q — turish vaqti ma'lum sanalardan hisoblanadi:
// yaratilgan, birinchi javob berilgan qo'ng'iroq, managerga o'tgan, oxirgi bosqich o'zgarishi, yopilgan.
import { cached } from "./cache.mjs";
import * as rng from "./range.mjs";
import * as sifat from "./sifat.mjs";
import { leadOwn } from "./roles.mjs";
import * as calls from "./calls.mjs";
import { RUBRIC } from "./callai.mjs";

const TTL = 60e3;
const DAY = 864e5;

// ---- Sozlama (settings.voronka, JSON): bosqich nomlari, Odoo bosqichlariga bog'lanish, normalar ----
// Tartib va birinchi to'rtta bosqich qoidasi o'zgarmaydi; nomlar, Odoo bosqichlari, normalar — sozlanadi.
export const STD = {
  bosqichlar: [
    { key: "tushgan", nom: "Yangi lid", qoida: "«Tushgan Lead» — davrda yaratilgan" },
    { key: "boglandi", nom: "Operator bog'landi", qoida: "javob berilgan qo'ng'iroq bor, holati o'zgargan yoki managerga o'tgan" },
    { key: "sifatli", nom: "Sifatli lid", qoida: "AI bahosi «sifatli» (qo'ng'iroq suhbati bo'yicha) yoki keyingi bosqichga o'tgan" },
    { key: "uzatildi", nom: "Menejerga uzatildi", qoida: "imkoniyatga aylantirilgan (managerga o'tkazilgan)" },
    { key: "kp", nom: "KP yuborildi", odoo: ["Тижорат таклиф тайёрлаш"], qoida: "lid holati «Кп» / «KP yuklandi» yoki imkoniyat bosqichi" },
    { key: "uchrashuv", nom: "Uchrashuv / obyekt ko'rigi", odoo: ["Ўчрашув", "Дожим"], qoida: "imkoniyat bosqichi" },
    { key: "shartnoma", nom: "Shartnoma", odoo: ["Шартнома берилди"], qoida: "imkoniyat bosqichi" },
    { key: "tolov", nom: "To'lov / montaj", odoo: ["Аванс тушди"], qoida: "yutilgan (Odoo «Won») yoki imkoniyat bosqichi" },
  ],
  norma: {},                                                   // key → kun; bo'sh — avtomatik (joriy median × 2, kamida 2 kun)
  qayta: { sabablar: ["Қизиқиш актуал эмас", "нархи тўғри келмади"], kun: 30 },
};
const KEYS = STD.bosqichlar.map((b) => b.key);
export function sozlama(db) {
  let v = null;
  try { v = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='voronka'").get()?.value || "null"); } catch {}
  const b = STD.bosqichlar.map((s) => {
    const o = (v?.bosqichlar || []).find((x) => x.key === s.key) || {};
    return { ...s, nom: String(o.nom || s.nom).slice(0, 40), ...(s.odoo ? { odoo: Array.isArray(o.odoo) ? o.odoo.map(String).slice(0, 20) : s.odoo } : {}) };
  });
  const norma = {}; for (const k of KEYS) { const n = Number(v?.norma?.[k]); if (n > 0 && n <= 365) norma[k] = n; }
  const q = v?.qayta || {};
  return { bosqichlar: b, norma, qayta: { sabablar: Array.isArray(q.sabablar) ? q.sabablar.map(String).slice(0, 30) : STD.qayta.sabablar,
    kun: Number(q.kun) >= 1 && Number(q.kun) <= 365 ? Number(q.kun) : STD.qayta.kun } };
}
export function setSozlama(db, patch, userId) {
  const was = sozlama(db);
  const cur = { bosqichlar: was.bosqichlar.map(({ key, nom, odoo }) => ({ key, nom, ...(odoo ? { odoo } : {}) })), norma: { ...was.norma }, qayta: { ...was.qayta } };
  for (const p of Array.isArray(patch.bosqichlar) ? patch.bosqichlar : []) {
    const b = cur.bosqichlar.find((x) => x.key === p.key); if (!b) continue;
    if (p.nom !== undefined) { const n = String(p.nom).replace(/\s+/g, " ").trim(); if (!n) throw bad("Bosqich nomi bo'sh bo'lmasin"); b.nom = n.slice(0, 40); }
    if (p.odoo !== undefined && b.odoo) b.odoo = [...new Set((Array.isArray(p.odoo) ? p.odoo : []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 20);
  }
  if (patch.norma && typeof patch.norma === "object") for (const k of KEYS) if (k in patch.norma) {
    const n = String(patch.norma[k] ?? "").trim();
    if (!n) delete cur.norma[k]; else if (/^\d{1,3}$/.test(n) && +n > 0) cur.norma[k] = +n; else throw bad("Norma — kun (1–365) yoki bo'sh");
  }
  if (patch.qayta && typeof patch.qayta === "object") {
    if (Array.isArray(patch.qayta.sabablar)) cur.qayta.sabablar = [...new Set(patch.qayta.sabablar.map((x) => String(x).trim()).filter(Boolean))].slice(0, 30);
    if (patch.qayta.kun !== undefined) { const k = Number(patch.qayta.kun); if (!(k >= 1 && k <= 365)) throw bad("Qayta ishlash muddati — 1–365 kun"); cur.qayta.kun = k; }
  }
  db.prepare(`INSERT INTO settings (key,value,updated_by) VALUES ('voronka',?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=datetime('now')`).run(JSON.stringify(cur), userId);
  return { was, now: sozlama(db) };
}
const bad = (m) => Object.assign(new Error(m), { status: 400 });

// ---- Yordamchilar ----
const t = (s) => { const v = s ? Date.parse(s) : NaN; return Number.isFinite(v) ? v : null; };
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const lidNomi = (x) => x.COMPANY_TITLE || [x.NAME, x.LAST_NAME].filter(Boolean).join(" ") || x.TITLE || `Lid #${x.ID}`;
const hudud = (s) => { const v = String(s || "").trim(); if (!v) return "Belgilanmagan"; return v.includes("_") ? v.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : v; };
const SEL = ["ID", "TITLE", "NAME", "LAST_NAME", "COMPANY_TITLE", "DATE_CREATE", "DATE_CLOSED", "STATUS_ID", "STATUS_SEMANTIC_ID", "STATUS_DESCRIPTION",
  "SOURCE_DESCRIPTION", "ADDRESS_CITY", "ASSIGNED_BY_ID", "UF_CRM_OPERATOR", "UF_CRM_OPERATOR_NAME", "UF_CRM_TYPE", "UF_CRM_PIPE", "UF_CRM_KP",
  "UF_CRM_CLIENT_TYPE", "UF_CRM_DEAL_STAGE", "UF_CRM_DEAL_STATE", "UF_CRM_MANAGER", "UF_CRM_DEAL_MOVED", "UF_CRM_DEAL_CLOSED",
  "UF_CRM_CONVERTED_AT", "UF_CRM_STAGE_AT", "UF_CRM_FIRST_CONTACT", "UF_CRM_CALLS_N", "UF_CRM_LOST_REASON", "UF_CRM_ODOO_URL", "OPPORTUNITY", "UF_CRM_SALE_TOTAL"];

// Bitta lid: qaysi bosqichgacha yetgan (indeks), holati, joriy bosqichga kirgan vaqti
function holat(x, cfg, Q) {
  const ix = Object.fromEntries(cfg.bosqichlar.map((b, i) => [b.key, i]));
  const opp = x.UF_CRM_TYPE === "opportunity";
  const stage = String(x.UF_CRM_DEAL_STAGE || "").trim();
  const st = x.UF_CRM_DEAL_STATE || "";
  let max = ix.tushgan;
  const javob = !!x.UF_CRM_FIRST_CONTACT;
  const ozgargan = !!x.UF_CRM_STAGE_AT && x.UF_CRM_STAGE_AT !== x.DATE_CREATE;
  if (javob || ozgargan || opp) max = Math.max(max, ix.boglandi);
  if (Q.get(String(x.ID))?.verdict === "sifatli") max = Math.max(max, ix.sifatli);
  if (opp) max = Math.max(max, ix.uzatildi);
  if (opp && (x.UF_CRM_PIPE === "Кп" || x.UF_CRM_KP === "Y")) max = Math.max(max, ix.kp);   // v2: faqat uzatilgan lid
  if (opp) for (const b of cfg.bosqichlar) if (b.odoo && b.odoo.includes(stage)) max = Math.max(max, ix[b.key]);
  const won = st === "won";
  if (won) max = Math.max(max, ix.tolov);
  const arxiv = x.STATUS_ID === "UC_ARXIV";
  const lost = !won && (st === "lost" || x.STATUS_SEMANTIC_ID === "F");
  // Joriy bosqichga kirgan vaqt (faqat ochiq lidlar uchun kerak)
  const k = cfg.bosqichlar[max].key;
  const kirdi = k === "tushgan" ? t(x.DATE_CREATE)
    : k === "boglandi" || k === "sifatli" ? (t(x.UF_CRM_FIRST_CONTACT) || t(x.UF_CRM_STAGE_AT) || t(x.DATE_CREATE))
    : opp ? Math.max(t(x.UF_CRM_DEAL_MOVED) || 0, t(x.UF_CRM_CONVERTED_AT) || 0) || t(x.DATE_CREATE)
    : (t(x.UF_CRM_STAGE_AT) || t(x.DATE_CREATE));
  const yopildi = lost ? (opp ? t(x.UF_CRM_DEAL_CLOSED) : t(x.DATE_CLOSED)) : won ? t(x.UF_CRM_DEAL_CLOSED) : null;
  return { max, key: k, opp, stage, won, lost, arxiv, ochiq: !won && !lost, kirdi, yopildi };
}

// Filtr qiymatlari (UI tanlovlari uchun) — lid ustidan
const olchov = {
  operator: (x) => x.UF_CRM_OPERATOR_NAME || "Operator tanlanmagan",
  menejer: (x) => (x.UF_CRM_TYPE === "opportunity" ? x.UF_CRM_MANAGER || "Biriktirilmagan" : "—"),
  manba: (x) => x.SOURCE_DESCRIPTION || "Manbasiz",
  segment: (x) => x.UF_CRM_CLIENT_TYPE || "Belgilanmagan",
  hudud: (x) => hudud(x.ADDRESS_CITY),
};

async function kohorta(bx, R, owner) {
  const { items, total } = await bx.listAll("crm.lead.list", {
    filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO, ...leadOwn(owner) },
    select: SEL, order: { DATE_CREATE: "ASC" }, maxItems: 20000,
  });
  return { items, total };
}

// range — rng.normalize natijasi; f — { operator, menejer, manba, segment, hudud } (qiymat = ko'rsatiladigan nom)
export const voronka = (bx, db, { range, owner = null, f = {} } = {}) => {
  const R = rng.normalize(range, 30);
  const fk = Object.keys(olchov).map((k) => `${k}=${f[k] || ""}`).join("&");
  return cached(`voronka:${R.key}:${owner || "all"}:${fk}`, TTL, async () => {
    const cfg = sozlama(db);
    const { items: hamma, total } = await kohorta(bx, R, owner);
    const Q = sifat.ofLeads(db, hamma.map((x) => x.ID));
    // Filtr tanlovlari — filtrsiz kohortadan (tanlov yo'qolib qolmasin)
    const tanlov = {};
    for (const [k, fn] of Object.entries(olchov)) {
      const m = new Map(); for (const x of hamma) { const v = fn(x); m.set(v, (m.get(v) || 0) + 1); }
      tanlov[k] = [...m.entries()].filter(([v]) => v !== "—").sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, n }));
    }
    const items = hamma.filter((x) => Object.entries(olchov).every(([k, fn]) => !f[k] || fn(x) === f[k]));
    const now = Date.now();
    const B = cfg.bosqichlar.map((b) => ({ key: b.key, nom: b.nom, qoida: b.qoida, odoo: b.odoo || null,
      yetdi: 0, hozir: 0, qotgan: 0, yoqotildi: 0, dwell: [], sabab: new Map() }));
    const H = items.map((x) => ({ x, h: holat(x, cfg, Q) }));
    for (const { h } of H) for (let i = 0; i <= h.max; i++) B[i].yetdi++;
    // Joriy bosqich va turish vaqti (ochiq lidlar)
    for (const { h } of H) if (h.ochiq && h.kirdi) B[h.max].dwell.push((now - h.kirdi) / DAY);
    const norma = B.map((b) => cfg.norma[b.key] ? { kun: cfg.norma[b.key], avto: false }
      : { kun: Math.max(2, Math.round((median(b.dwell) || 1) * 2)), avto: true });
    const qotganlar = [];
    for (const { x, h } of H) {
      if (h.ochiq) {
        B[h.max].hozir++;
        const kun = h.kirdi ? (now - h.kirdi) / DAY : null;
        if (kun !== null && kun > norma[h.max].kun) {
          B[h.max].qotgan++;
          qotganlar.push({ id: x.ID, nom: lidNomi(x), bosqich: B[h.max].nom, key: B[h.max].key, kun: r1(kun), norma: norma[h.max].kun,
            masul: h.max >= 3 ? x.UF_CRM_MANAGER || "Biriktirilmagan" : x.UF_CRM_OPERATOR_NAME || "Operator tanlanmagan",
            odooBosqich: h.opp ? h.stage : x.STATUS_DESCRIPTION || "", url: x.UF_CRM_ODOO_URL || null });
        }
      }
      if (h.lost) {
        const sabab = x.UF_CRM_LOST_REASON || (h.arxiv ? "Arxivlangan (sabab yo'q)" : "Sababsiz");
        B[h.max].yoqotildi++; B[h.max].sabab.set(sabab, (B[h.max].sabab.get(sabab) || 0) + 1);
      }
    }
    qotganlar.sort((a, b) => (b.kun / b.norma) - (a.kun / a.norma));
    // O'tish vaqtlari (median): yaratilgan → birinchi javob (soat), birinchi javob → managerga (kun), managerga → to'lov (kun)
    const javobSoat = [], uzatishKun = [], yopishKun = [];
    for (const { x, h } of H) {
      const c = t(x.DATE_CREATE), fc = t(x.UF_CRM_FIRST_CONTACT), cv = t(x.UF_CRM_CONVERTED_AT), cl = t(x.UF_CRM_DEAL_CLOSED);
      if (c && fc && fc >= c) javobSoat.push((fc - c) / 3600e3);
      if (cv && h.opp) uzatishKun.push((cv - (fc && fc <= cv ? fc : c)) / DAY);
      if (h.won && cv && cl && cl >= cv) yopishKun.push((cl - cv) / DAY);
    }
    const bosqichlar = B.map((b, i) => ({
      key: b.key, nom: b.nom, qoida: b.qoida, odoo: b.odoo, yetdi: b.yetdi,
      ulush: pct(b.yetdi, B[0].yetdi), otish: i ? pct(b.yetdi, B[i - 1].yetdi) : null,
      hozir: b.hozir, ortacha: r1(b.dwell.length ? b.dwell.reduce((a, v) => a + v, 0) / b.dwell.length : null), median: r1(median(b.dwell)),
      // «Bosqich kartasi» uchun: hozir turganlar necha kundan beri kutmoqda — <1, 1–3, 3–7, 7–14, 14–30, 30+ kun (faqat sonlar)
      kutish: [1, 3, 7, 14, 30, Infinity].map((hi, j, a) => b.dwell.filter((d) => d >= (j ? a[j - 1] : 0) && d < hi).length),
      norma: norma[i].kun, normaAvto: norma[i].avto, qotgan: b.qotgan,
      yoqotildi: b.yoqotildi, sabablar: [...b.sabab.entries()].sort((a, c) => c[1] - a[1]).map(([n, c]) => ({ n, c })),
    }));
    // Yo'qotilganlar (sabab va kesimlar uchun — UI o'zi guruhlaydi)
    const yoqotilgan = H.filter(({ h }) => h.lost).map(({ x, h }) => ({
      id: x.ID, sabab: x.UF_CRM_LOST_REASON || (h.arxiv ? "Arxivlangan (sabab yo'q)" : "Sababsiz"), sababsiz: !x.UF_CRM_LOST_REASON,
      bosqich: B[h.max].nom, operator: olchov.operator(x), menejer: h.opp ? olchov.menejer(x) : "Managerga o'tmagan",
      manba: olchov.manba(x), segment: olchov.segment(x), hudud: olchov.hudud(x),
      sana: h.yopildi ? new Date(h.yopildi + 5 * 3600e3).toISOString().slice(0, 10) : null, nom: lidNomi(x), url: x.UF_CRM_ODOO_URL || null }));
    // «Xatolar narxi» (2026-09-30): qaysi qo'ng'iroq xatosi yo'qotilgan lidlarda ko'p uchraydi. Lidning tahlil qilingan
    // qo'ng'iroqlari (kohorta boshidan bugungacha) bo'yicha har mezon o'rtachasi; 50% dan past — xato. Solishtirish:
    // yo'qotilgan lidlar ↔ menejerga uzatilgan (yoki undan uzoqqa borgan) va yo'qotilmagan lidlar. Bu BOG'LIQLIK, sabab emas.
    let xato = null;
    try {
      const M = await calls.mezonKesim(bx, db, { from: R.from, to: rng.today() });
      const byLead = new Map();
      for (const c of M) { if (!c.lead) continue; (byLead.get(c.lead) || byLead.set(c.lead, []).get(c.lead)).push(c); }
      const X = Object.fromEntries(RUBRIC.map((r) => [r.id, { yoq: { n: 0, x: 0, ids: [] }, ok: { n: 0, x: 0 } }]));
      let nLid = 0, nYoq = 0, nOk = 0, nCall = 0, xatoli = 0, topilgan = 0;
      for (const { x, h } of H) {
        const cs = byLead.get(String(x.ID)); if (!cs) continue;
        nLid++; nCall += cs.length;
        for (const c of cs) { const k = c.cr.filter((m) => m.p < calls.XATO_CHEGARA).length; if (k) { xatoli++; topilgan += k; } }
        const g = h.lost ? "yoq" : h.max >= 3 ? "ok" : null; if (!g) continue;
        if (g === "yoq") nYoq++; else nOk++;
        const s2 = {}, n2 = {};
        for (const c of cs) for (const m of c.cr) { s2[m.id] = (s2[m.id] || 0) + m.p; n2[m.id] = (n2[m.id] || 0) + 1; }
        for (const id of Object.keys(s2)) { const o = X[id]; if (!o) continue; const bad = s2[id] / n2[id] < calls.XATO_CHEGARA;
          o[g].n++; if (bad) { o[g].x++; if (g === "yoq" && o.yoq.ids.length < 300) o.yoq.ids.push(String(x.ID)); } }
      }
      xato = { nLid, nYoq, nOk, nCall, xatoli, topilgan, chegara: calls.XATO_CHEGARA * 100,
        mezon: RUBRIC.map((r) => { const o = X[r.id], yq = pct(o.yoq.x, o.yoq.n), ok = pct(o.ok.x, o.ok.n);
          return { id: r.id, label: r.label, yoq: yq, ok, farq: yq != null && ok != null ? r1(yq - ok) : null, soni: o.yoq.x, nYoq: o.yoq.n, nOk: o.ok.n, ids: o.yoq.ids }; })
          .sort((a, b) => (b.farq ?? -999) - (a.farq ?? -999)) };
    } catch (e) { xato = { xato: String(e.message || e).slice(0, 160) }; }
    const n0 = B[0].yetdi, last = B[B.length - 1].yetdi;
    const baholangan = H.filter(({ x }) => Q.has(String(x.ID))).length;
    return {
      range: rng.pub ? rng.pub(R) : { from: R.from, to: R.to, label: R.label, days: R.days }, total, soni: items.length, filtr: f, tanlov,
      bosqichlar,
      kpi: { tushgan: n0, uzatildi: B[3].yetdi, uzatildiUlush: pct(B[3].yetdi, n0), shartnoma: B[6].yetdi, tolov: last, umumiy: pct(last, n0),
             ochiq: H.filter(({ h }) => h.ochiq).length, yoqotilgan: yoqotilgan.length, yoqotilganUlush: pct(yoqotilgan.length, n0),
             sababsiz: yoqotilgan.filter((y) => y.sababsiz).length },
      vaqt: { javobSoat: r1(median(javobSoat)), javobN: javobSoat.length, uzatishKun: r1(median(uzatishKun)), uzatishN: uzatishKun.length,
              yopishKun: r1(median(yopishKun)), yopishN: yopishKun.length },
      qotganlar: qotganlar.slice(0, 500), qotganJami: qotganlar.length,
      yoqotilgan, xato,
      ai: { baholangan, jami: items.length },
      sozlama: { norma: cfg.norma, qayta: cfg.qayta },
      at: new Date().toISOString(),
    };
  });
};

// Qayta ishlash ro'yxati (TZ 2.3): sozlamadagi sabablar bilan yo'qotilgan lidlar, yo'qotilganiga `kun`
// kundan oshgan (180 kungacha) — qaytadan qo'ng'iroq qilish uchun. Lid hali ham yo'qotilgan holatda bo'lsa.
export const qayta = (bx, db, { owner = null } = {}) => {
  const cfg = sozlama(db);
  return cached(`voronka:qayta:${owner || "all"}:${cfg.qayta.kun}:${cfg.qayta.sabablar.join("|")}`, TTL, async () => {
    const from = new Date(Date.now() - 400 * DAY + 5 * 3600e3).toISOString().slice(0, 10);
    const { items } = await bx.listAll("crm.lead.list", {
      filter: { ">=DATE_CREATE": `${from}T00:00:00+05:00`, ...leadOwn(owner) },
      select: [...SEL, "PHONE"], order: { DATE_CREATE: "DESC" }, maxItems: 20000,
    });
    const set = new Set(cfg.qayta.sabablar), now = Date.now(), dan = now - 180 * DAY, gacha = now - cfg.qayta.kun * DAY;
    const out = [];
    for (const x of items) {
      if (!set.has(String(x.UF_CRM_LOST_REASON || ""))) continue;
      const opp = x.UF_CRM_TYPE === "opportunity";
      const lost = opp ? x.UF_CRM_DEAL_STATE === "lost" : x.STATUS_SEMANTIC_ID === "F";
      if (!lost) continue;
      const sana = t(opp ? x.UF_CRM_DEAL_CLOSED : x.DATE_CLOSED); if (!sana || sana > gacha || sana < dan) continue;
      const tel = (Array.isArray(x.PHONE) ? x.PHONE : []).map((p) => p && p.VALUE).filter(Boolean)[0] || "";
      out.push({ id: x.ID, nom: lidNomi(x), sabab: x.UF_CRM_LOST_REASON, sana: new Date(sana + 5 * 3600e3).toISOString().slice(0, 10), kun: Math.floor((now - sana) / DAY),
        operator: x.UF_CRM_OPERATOR_NAME || "", operatorId: x.UF_CRM_OPERATOR || "", menejer: opp ? x.UF_CRM_MANAGER || "" : "", tel,
        manba: x.SOURCE_DESCRIPTION || "", tur: opp ? "deal" : "lead", url: x.UF_CRM_ODOO_URL || null });
    }
    out.sort((a, b) => a.kun - b.kun);
    return { sabablar: cfg.qayta.sabablar, kun: cfg.qayta.kun, rows: out, at: new Date().toISOString() };
  });
};

// Sozlama oynasi uchun: kohortada uchragan Odoo imkoniyat bosqichlari va yo'qotish sabablari
export const lugat = (bx) => cached("voronka:lugat", 10 * 60e3, async () => {
  const from = new Date(Date.now() - 400 * DAY + 5 * 3600e3).toISOString().slice(0, 10);
  const { items } = await bx.listAll("crm.lead.list", {
    filter: { ">=DATE_CREATE": `${from}T00:00:00+05:00` }, select: ["ID", "UF_CRM_TYPE", "UF_CRM_DEAL_STAGE", "UF_CRM_LOST_REASON"], maxItems: 20000,
  });
  const st = new Map(), sb = new Map();
  for (const x of items) {
    if (x.UF_CRM_TYPE === "opportunity" && x.UF_CRM_DEAL_STAGE) st.set(x.UF_CRM_DEAL_STAGE, (st.get(x.UF_CRM_DEAL_STAGE) || 0) + 1);
    if (x.UF_CRM_LOST_REASON) sb.set(x.UF_CRM_LOST_REASON, (sb.get(x.UF_CRM_LOST_REASON) || 0) + 1);
  }
  const arr = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => ({ n, c }));
  return { bosqichlar: arr(st), sabablar: arr(sb) };
});
