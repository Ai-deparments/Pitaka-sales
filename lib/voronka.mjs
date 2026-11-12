// Sotuv voronkasi — Pitaka (Bitrix24 crm.smartworld.uz), 2026-11-10.
//
// Liddan to'lovgacha: har bosqichda nechta lid, bosqichlararo konversiya, lid qayerda va NIMA SABABDAN yo'qolgani,
// bosqichda turish vaqti, «qotib qolgan» lidlar, 30 kundan keyin qayta ishlash.
//
// KOHORTA: tanlangan davrda yaratilgan lidlar va har biri qaysi bosqichgacha yetgani. Bosqichlar ketma-ket:
// keyingi bosqichga yetgan lid oldingilaridan ham o'tgan hisoblanadi, shuning uchun konversiya 100% dan oshmaydi.
//
// Pitaka tuzilishi (Bitrix'dan o'qilgan 10.11):
//   Lid:   NEW Prioritet → UC_AEH2UE Yangi mijoz → UC_3D7LNB Kvalifikatsiya → CONVERTED (bitim yaratildi)
//          yo'qotish: JUNK Bekor qilindi · UC_O11I30 NE KVAL · UC_7YH6KA ARXIV
//   Bitim «Sotuv Bo'limi» (CATEGORY_ID 0): … → NEW Ma'lumot berildi → UC_PZILMJ Hisob berildi → UC_934502 100% to'lov → WON
//          yo'qotish: LOSE Bekor qilindi
//   Yo'qotish sababi: lid UF_CRM_1776932197903, bitim UF_CRM_1776938212406 («Rad etish sababi», ro'yxat).
//   UF_CRM_LOSS_REASON portalda bor, lekin hech kim to'ldirmaydi — o'qilmaydi.
import { cached } from "./cache.mjs";
import * as rng from "./range.mjs";
import * as sifat from "./sifat.mjs";
import * as dir from "./directory.mjs";
import { leadOwn } from "./roles.mjs";
import * as calls from "./calls.mjs";
import { RUBRIC } from "./callai.mjs";

const TTL = 60e3;
const DAY = 864e5;
const ANSWERED_SEC = 10;          // shundan uzun qo'ng'iroq — suhbat bo'lgan deb olinadi

export const F = {
  leadReason: "UF_CRM_1776932197903",
  dealReason: "UF_CRM_1776938212406",
  region: "UF_CRM_1776932053923",
  volume: "UF_CRM_1776932137210",
};
export const LEAD_LOST = { JUNK: "Bekor qilindi", UC_O11I30: "NE KVAL", UC_7YH6KA: "Arxiv" };
const LEAD_KVAL = new Set(["UC_3D7LNB", "CONVERTED"]);
const DEAL_RANK = { NEW: 1, UC_PZILMJ: 2, UC_934502: 3, WON: 3 };   // ma'lumot / hisob / to'lov

// ---- Sozlama (settings.voronka, JSON): bosqich nomlari, normalar, qayta ishlash ----
export const STD = {
  bosqichlar: [
    { key: "tushgan", nom: "Yangi lid", qoida: "davrda yaratilgan lid" },
    { key: "boglandi", nom: "Bog'lanildi", qoida: `${ANSWERED_SEC} soniyadan uzun qo'ng'iroq bor yoki lid Kvalifikatsiya / NE KVAL holatiga o'tgan` },
    { key: "kval", nom: "Kvalifikatsiya", qoida: "lid «Kvalifikatsiya» holatida yoki bitimga aylangan" },
    { key: "bitim", nom: "Bitim ochildi", qoida: "lid bitimga aylantirilgan (CONVERTED)" },
    { key: "malumot", nom: "Ma'lumot berildi", qoida: "bitim «Ma'lumot berildi» yoki undan keyingi bosqichda" },
    { key: "hisob", nom: "Hisob berildi", qoida: "bitim «Hisob berildi» yoki undan keyingi bosqichda" },
    { key: "tolov", nom: "To'lov", qoida: "bitim «100% to'lov» yoki «Muvaffaqiyatli»" },
  ],
  norma: {},
  qayta: { sabablar: ["Hozir emas", "Qimmat"], kun: 30 },
};
const KEYS = STD.bosqichlar.map((b) => b.key);
const IX = Object.fromEntries(KEYS.map((k, i) => [k, i]));

export function sozlama(db) {
  let v = null;
  try { v = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='voronka'").get()?.value || "null"); } catch {}
  const b = STD.bosqichlar.map((s) => {
    const o = (v?.bosqichlar || []).find((x) => x.key === s.key) || {};
    return { ...s, nom: String(o.nom || s.nom).slice(0, 40) };
  });
  const norma = {}; for (const k of KEYS) { const n = Number(v?.norma?.[k]); if (n > 0 && n <= 365) norma[k] = n; }
  const q = v?.qayta || {};
  return { bosqichlar: b, norma, qayta: { sabablar: Array.isArray(q.sabablar) ? q.sabablar.map(String).slice(0, 30) : STD.qayta.sabablar,
    kun: Number(q.kun) >= 1 && Number(q.kun) <= 365 ? Number(q.kun) : STD.qayta.kun } };
}
export function setSozlama(db, patch, userId) {
  const was = sozlama(db);
  const cur = { bosqichlar: was.bosqichlar.map(({ key, nom }) => ({ key, nom })), norma: { ...was.norma }, qayta: { ...was.qayta } };
  for (const p of Array.isArray(patch.bosqichlar) ? patch.bosqichlar : []) {
    const b = cur.bosqichlar.find((x) => x.key === p.key); if (!b) continue;
    if (p.nom !== undefined) { const n = String(p.nom).replace(/\s+/g, " ").trim(); if (!n) throw bad("Bosqich nomi bo'sh bo'lmasin"); b.nom = n.slice(0, 40); }
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
const lidNomi = (x) => [x.NAME, x.LAST_NAME].filter(Boolean).join(" ") || x.TITLE || `Lid #${x.ID}`;
const ymdTash = (ms) => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);
const portal = () => String(process.env.BITRIX_PORTAL || "").replace(/\/+$/, "");
const leadUrl = (id) => (portal() ? `${portal()}/crm/lead/details/${id}/` : null);
const dealUrl = (id) => (portal() ? `${portal()}/crm/deal/details/${id}/` : null);
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

const LEAD_SEL = ["ID", "TITLE", "NAME", "LAST_NAME", "DATE_CREATE", "DATE_CLOSED", "MOVED_TIME", "STATUS_ID", "SOURCE_ID",
  "ASSIGNED_BY_ID", F.leadReason, F.region, F.volume];
const DEAL_SEL = ["ID", "LEAD_ID", "STAGE_ID", "CATEGORY_ID", "ASSIGNED_BY_ID", "DATE_CREATE", "MOVED_TIME", "CLOSEDATE", F.dealReason];

// Ro'yxat maydonlari (ID → nom) va manbalar — kam o'zgaradi, 30 daqiqa keshlanadi.
export const lugatlar = (bx) => cached("voronka:enums", 30 * 60e3, async () => {
  const enumOf = (fields, code) => Object.fromEntries((fields[code]?.items || []).map((i) => [String(i.ID), i.VALUE]));
  const [lf, df, src] = await Promise.all([
    bx.call("crm.lead.fields").then((r) => r.result || {}),
    bx.call("crm.deal.fields").then((r) => r.result || {}),
    bx.call("crm.status.list", { filter: { ENTITY_ID: "SOURCE" } }).then((r) => r.result || []),
  ]);
  return {
    leadReason: enumOf(lf, F.leadReason), dealReason: enumOf(df, F.dealReason),
    region: enumOf(lf, F.region), volume: enumOf(lf, F.volume),
    source: Object.fromEntries(src.map((s) => [s.STATUS_ID, s.NAME])),
  };
});

// Kohorta lidlari + ularning bitimlari + qo'ng'iroqlari
async function kohorta(bx, R, owner) {
  const { items: leads, total } = await bx.listAll("crm.lead.list", {
    filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO, ...leadOwn(owner) },
    select: LEAD_SEL, order: { DATE_CREATE: "ASC" }, maxItems: 20000,
  });
  const deals = await lidBitimlari(bx, leads);
  const { items: acts } = await bx.listAll("crm.activity.list", {
    filter: { TYPE_ID: 2, OWNER_TYPE_ID: 1, ">=CREATED": R.fromISO },
    select: ["ID", "OWNER_ID", "START_TIME", "END_TIME"], order: { ID: "ASC" }, maxItems: 30000,
  });
  const firstTalk = new Map();
  for (const a of acts) {
    const s = t(a.START_TIME), e = t(a.END_TIME);
    if (s === null || e === null || (e - s) / 1000 < ANSWERED_SEC) continue;
    const k = String(a.OWNER_ID), cur = firstTalk.get(k);
    if (cur === undefined || s < cur) firstTalk.set(k, s);
  }
  return { leads, total, deals, firstTalk };
}
const dealRank = (d) => (d.STAGE_ID === "LOSE" ? 0.5 : DEAL_RANK[d.STAGE_ID] || 0);

// CONVERTED lidlarning «Sotuv Bo'limi» bitimlari: lid ID → eng ilgarilagan bitimi
async function lidBitimlari(bx, leads) {
  const converted = leads.filter((x) => x.STATUS_ID === "CONVERTED").map((x) => String(x.ID));
  const deals = new Map();
  for (const ids of chunks(converted, 50)) {
    const { items } = await bx.listAll("crm.deal.list", { filter: { LEAD_ID: ids, CATEGORY_ID: 0 }, select: DEAL_SEL, maxItems: 1000 });
    for (const d of items) {
      const prev = deals.get(String(d.LEAD_ID));
      if (!prev || dealRank(d) > dealRank(prev)) deals.set(String(d.LEAD_ID), d);
    }
  }
  return deals;
}

// Bitta lid: qaysi bosqichgacha yetgan, holati, joriy bosqichga kirgan vaqti, yo'qotish sababi
function holat(x, deal, talkAt, Q, E) {
  const st = x.STATUS_ID;
  let max = IX.tushgan;
  if (talkAt || st === "UC_3D7LNB" || st === "UC_O11I30" || st === "CONVERTED") max = IX.boglandi;
  if (Q.get(String(x.ID))?.verdict === "sifatli" || LEAD_KVAL.has(st)) max = Math.max(max, IX.kval);
  if (st === "CONVERTED") max = Math.max(max, IX.bitim);
  const r = deal ? DEAL_RANK[deal.STAGE_ID] || 0 : 0;
  if (r >= 1) max = Math.max(max, IX.malumot);
  if (r >= 2) max = Math.max(max, IX.hisob);
  if (r >= 3) max = Math.max(max, IX.tolov);
  const won = max === IX.tolov;
  const leadLost = !!LEAD_LOST[st];
  const dealLost = !!deal && deal.STAGE_ID === "LOSE";
  const lost = !won && (leadLost || dealLost);
  const sabab = dealLost ? E.dealReason[String(deal[F.dealReason] || "")] || null
    : leadLost ? E.leadReason[String(x[F.leadReason] || "")] || null : null;
  const kirdi = deal && max >= IX.bitim ? t(deal.MOVED_TIME) || t(deal.DATE_CREATE)
    : max === IX.tushgan ? t(x.DATE_CREATE) : t(x.MOVED_TIME) || talkAt || t(x.DATE_CREATE);
  const yopildi = lost ? (dealLost ? t(deal.MOVED_TIME) || t(deal.CLOSEDATE) : t(x.DATE_CLOSED) || t(x.MOVED_TIME)) : won ? t(deal?.MOVED_TIME) : null;
  return { max, key: KEYS[max], won, lost, leadLost, dealLost, holatNomi: LEAD_LOST[st] || null, sabab, ochiq: !won && !lost, kirdi, yopildi, deal };
}

// Filtr o'lchovlari (UI tanlovlari) — lid ustidan
function olchovlar(E, names) {
  return {
    operator: (x) => names[String(x.ASSIGNED_BY_ID)] || `#${x.ASSIGNED_BY_ID}`,
    menejer: (x, h) => (h?.deal ? names[String(h.deal.ASSIGNED_BY_ID)] || `#${h.deal.ASSIGNED_BY_ID}` : "—"),
    manba: (x) => E.source[x.SOURCE_ID] || x.SOURCE_ID || "Manbasiz",
    segment: (x) => E.volume[String(x[F.volume] || "")] || "Belgilanmagan",
    hudud: (x) => E.region[String(x[F.region] || "")] || "Belgilanmagan",
  };
}

// range — rng.normalize natijasi; f — { operator, menejer, manba, segment, hudud } (qiymat = ko'rsatiladigan nom)
export const voronka = (bx, db, { range, owner = null, f = {} } = {}) => {
  const R = rng.normalize(range, 30);
  const fk = ["operator", "menejer", "manba", "segment", "hudud"].map((k) => `${k}=${f[k] || ""}`).join("&");
  return cached(`voronka:${R.key}:${owner || "all"}:${fk}`, TTL, async () => {
    const cfg = sozlama(db);
    const E = await lugatlar(bx);
    const { leads, total, deals, firstTalk } = await kohorta(bx, R, owner);
    const userIds = [...leads.map((x) => x.ASSIGNED_BY_ID), ...[...deals.values()].map((d) => d.ASSIGNED_BY_ID)];
    const { names } = await dir.names(bx, userIds);
    const Q = sifat.ofLeads(db, leads.map((x) => x.ID));
    const O = olchovlar(E, names);
    const all = leads.map((x) => ({ x, h: holat(x, deals.get(String(x.ID)), firstTalk.get(String(x.ID)) || null, Q, E) }));

    const tanlov = {};
    for (const [k, fn] of Object.entries(O)) {
      const m = new Map(); for (const { x, h } of all) { const v = fn(x, h); m.set(v, (m.get(v) || 0) + 1); }
      tanlov[k] = [...m.entries()].filter(([v]) => v !== "—").sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, n }));
    }
    const H = all.filter(({ x, h }) => Object.entries(O).every(([k, fn]) => !f[k] || fn(x, h) === f[k]));
    const now = Date.now();
    const B = cfg.bosqichlar.map((b) => ({ key: b.key, nom: b.nom, qoida: b.qoida, yetdi: 0, hozir: 0, qotgan: 0, yoqotildi: 0, dwell: [], sabab: new Map() }));
    for (const { h } of H) for (let i = 0; i <= h.max; i++) B[i].yetdi++;
    for (const { h } of H) if (h.ochiq && h.kirdi) B[h.max].dwell.push((now - h.kirdi) / DAY);
    const norma = B.map((b) => cfg.norma[b.key] ? { kun: cfg.norma[b.key], avto: false }
      : { kun: Math.max(2, Math.round((median(b.dwell) || 1) * 2)), avto: true });

    const sababOf = (h) => h.sabab || (h.holatNomi ? `${h.holatNomi} (sabab yo'q)` : "Sababsiz");
    const qotganlar = [];
    for (const { x, h } of H) {
      if (h.ochiq) {
        B[h.max].hozir++;
        const kun = h.kirdi ? (now - h.kirdi) / DAY : null;
        if (kun !== null && kun > norma[h.max].kun) {
          B[h.max].qotgan++;
          qotganlar.push({ id: x.ID, nom: lidNomi(x), bosqich: B[h.max].nom, key: B[h.max].key, kun: r1(kun), norma: norma[h.max].kun,
            masul: h.deal ? O.menejer(x, h) : O.operator(x), bitrixBosqich: h.deal ? h.deal.STAGE_ID : x.STATUS_ID,
            url: h.deal ? dealUrl(h.deal.ID) : leadUrl(x.ID) });
        }
      }
      if (h.lost) { const s = sababOf(h); B[h.max].yoqotildi++; B[h.max].sabab.set(s, (B[h.max].sabab.get(s) || 0) + 1); }
    }
    qotganlar.sort((a, b) => (b.kun / b.norma) - (a.kun / a.norma));

    // O'tish vaqtlari (median): yaratilgan → birinchi suhbat (soat), yaratilgan → bitim (kun), bitim → to'lov (kun)
    const javobSoat = [], uzatishKun = [], yopishKun = [];
    for (const { x, h } of H) {
      const c = t(x.DATE_CREATE), talk = firstTalk.get(String(x.ID)), dc = h.deal ? t(h.deal.DATE_CREATE) : null;
      if (c && talk && talk >= c) javobSoat.push((talk - c) / 3600e3);
      if (c && dc && dc >= c) uzatishKun.push((dc - c) / DAY);
      if (h.won && dc && h.yopildi && h.yopildi >= dc) yopishKun.push((h.yopildi - dc) / DAY);
    }
    const bosqichlar = B.map((b, i) => ({
      key: b.key, nom: b.nom, qoida: b.qoida, yetdi: b.yetdi,
      ulush: pct(b.yetdi, B[0].yetdi), otish: i ? pct(b.yetdi, B[i - 1].yetdi) : null,
      hozir: b.hozir, ortacha: r1(b.dwell.length ? b.dwell.reduce((a, v) => a + v, 0) / b.dwell.length : null), median: r1(median(b.dwell)),
      kutish: [1, 3, 7, 14, 30, Infinity].map((hi, j, a) => b.dwell.filter((d) => d >= (j ? a[j - 1] : 0) && d < hi).length),
      norma: norma[i].kun, normaAvto: norma[i].avto, qotgan: b.qotgan,
      yoqotildi: b.yoqotildi, sabablar: [...b.sabab.entries()].sort((a, c) => c[1] - a[1]).map(([n, c]) => ({ n, c })),
    }));
    const yoqotilgan = H.filter(({ h }) => h.lost).map(({ x, h }) => ({
      id: x.ID, sabab: sababOf(h), sababsiz: !h.sabab, holat: h.dealLost ? "Bitim bekor" : h.holatNomi,
      bosqich: B[h.max].nom, operator: O.operator(x), menejer: h.deal ? O.menejer(x, h) : "Bitimga o'tmagan",
      manba: O.manba(x), segment: O.segment(x), hudud: O.hudud(x),
      sana: h.yopildi ? ymdTash(h.yopildi) : null, nom: lidNomi(x), url: h.dealLost ? dealUrl(h.deal.ID) : leadUrl(x.ID) }));

    // «Xatolar narxi»: qaysi qo'ng'iroq xatosi yo'qotilgan lidlarda ko'p uchraydi. Bu BOG'LIQLIK, sabab emas.
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
        const g = h.lost ? "yoq" : h.max >= IX.bitim ? "ok" : null; if (!g) continue;
        if (g === "yoq") nYoq++; else nOk++;
        const s2 = {}, n2 = {};
        for (const c of cs) for (const m of c.cr) { s2[m.id] = (s2[m.id] || 0) + m.p; n2[m.id] = (n2[m.id] || 0) + 1; }
        for (const id of Object.keys(s2)) { const o = X[id]; if (!o) continue; const isBad = s2[id] / n2[id] < calls.XATO_CHEGARA;
          o[g].n++; if (isBad) { o[g].x++; if (g === "yoq" && o.yoq.ids.length < 300) o.yoq.ids.push(String(x.ID)); } }
      }
      xato = { nLid, nYoq, nOk, nCall, xatoli, topilgan, chegara: calls.XATO_CHEGARA * 100,
        mezon: RUBRIC.map((r) => { const o = X[r.id], yq = pct(o.yoq.x, o.yoq.n), ok = pct(o.ok.x, o.ok.n);
          return { id: r.id, label: r.label, yoq: yq, ok, farq: yq != null && ok != null ? r1(yq - ok) : null, soni: o.yoq.x, nYoq: o.yoq.n, nOk: o.ok.n, ids: o.yoq.ids }; })
          .sort((a, b) => (b.farq ?? -999) - (a.farq ?? -999)) };
    } catch (e) { xato = { xato: String(e.message || e).slice(0, 160) }; }

    const n0 = B[0].yetdi, last = B[IX.tolov].yetdi;
    const nekval = H.filter(({ x }) => x.STATUS_ID === "UC_O11I30").length;
    return {
      range: rng.pub ? rng.pub(R) : { from: R.from, to: R.to, label: R.label, days: R.days }, total, soni: H.length, filtr: f, tanlov,
      bosqichlar,
      kpi: { tushgan: n0, uzatildi: B[IX.bitim].yetdi, uzatildiUlush: pct(B[IX.bitim].yetdi, n0), shartnoma: B[IX.hisob].yetdi, tolov: last,
             umumiy: pct(last, n0), ochiq: H.filter(({ h }) => h.ochiq).length, yoqotilgan: yoqotilgan.length,
             yoqotilganUlush: pct(yoqotilgan.length, n0), sababsiz: yoqotilgan.filter((y) => y.sababsiz).length,
             nekval, nekvalUlush: pct(nekval, n0), boglanilmagan: H.filter(({ h }) => h.max === IX.tushgan).length },
      vaqt: { javobSoat: r1(median(javobSoat)), javobN: javobSoat.length, uzatishKun: r1(median(uzatishKun)), uzatishN: uzatishKun.length,
              yopishKun: r1(median(yopishKun)), yopishN: yopishKun.length },
      qotganlar: qotganlar.slice(0, 500), qotganJami: qotganlar.length,
      yoqotilgan, xato,
      ai: { baholangan: H.filter(({ x }) => Q.has(String(x.ID))).length, jami: H.length },
      sozlama: { norma: cfg.norma, qayta: cfg.qayta },
      at: new Date().toISOString(),
    };
  });
};

// Oylar bo'yicha kohorta (2026-11-12, egasining so'rovi: «oyda 1000 lid keldi, 300 tasi sotib oldi» — foiz emas, aniq son).
// Har oy: shu oyda YARATILGAN lidlar va ulardan bugungacha qanchasi kvalifikatsiya / bitim / to'lovga yetgani,
// qanchasi yo'qotilgani, qanchasi hali ochiq. Joriy oy — bugungacha. Lidsiz (to'g'ridan-to'g'ri) bitimlar kirmaydi.
// Qo'ng'iroqlar o'qilmaydi: 6 oylik faoliyat ro'yxati og'ir, «Bog'lanildi» bosqichi esa bu jadvalda ko'rsatilmaydi.
export const OYLAR_MAX = 12;
const OY_NOMI = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
export function oyChegaralari(today, n) {
  let [y, m] = today.split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const mm = String(m).padStart(2, "0"), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.unshift({ oy: `${y}-${mm}`, nom: `${OY_NOMI[m - 1]} ${y}`, from: `${y}-${mm}-01`, to: i ? `${y}-${mm}-${last}` : today, joriy: !i });
    if (--m < 1) { m = 12; y--; }
  }
  return out;
}
export function oylarHisob(leads, deals, Q, oylar) {
  const E0 = { leadReason: {}, dealReason: {} };
  const by = new Map(oylar.map((o) => [o.oy, { ...o, lidlar: 0, kval: 0, bitim: 0, tolov: 0, yoqotilgan: 0, nekval: 0, ochiq: 0 }]));
  for (const x of leads) {
    const c = t(x.DATE_CREATE); if (c === null) continue;
    const r = by.get(ymdTash(c).slice(0, 7)); if (!r) continue;
    const h = holat(x, deals.get(String(x.ID)), null, Q, E0);
    r.lidlar++;
    if (h.max >= IX.kval) r.kval++;
    if (h.max >= IX.bitim) r.bitim++;
    if (h.won) r.tolov++;
    if (h.lost) r.yoqotilgan++;
    if (h.ochiq) r.ochiq++;
    if (x.STATUS_ID === "UC_O11I30") r.nekval++;
  }
  return [...by.values()];
}
export const oylar = (bx, db, { n = 6, owner = null } = {}) => {
  const k = Math.min(Math.max(Math.floor(Number(n)) || 6, 1), OYLAR_MAX);
  const O = oyChegaralari(rng.today(), k);
  return cached(`voronka:oylar:${O[0].from}_${O.at(-1).to}:${owner || "all"}`, 5 * 60e3, async () => {
    const { items: leads, total } = await bx.listAll("crm.lead.list", {
      filter: { ">=DATE_CREATE": `${O[0].from}T00:00:00+05:00`, "<=DATE_CREATE": `${O.at(-1).to}T23:59:59+05:00`, ...leadOwn(owner) },
      select: LEAD_SEL, order: { DATE_CREATE: "ASC" }, maxItems: 50000,
    });
    const deals = await lidBitimlari(bx, leads);
    const Q = sifat.ofLeads(db, leads.map((x) => x.ID));
    const rows = oylarHisob(leads, deals, Q, O);
    const jami = rows.reduce((s, r) => { for (const f of ["lidlar", "kval", "bitim", "tolov", "yoqotilgan", "nekval", "ochiq"]) s[f] += r[f]; return s; },
      { lidlar: 0, kval: 0, bitim: 0, tolov: 0, yoqotilgan: 0, nekval: 0, ochiq: 0 });
    return { oylar: rows, jami, total, toliq: leads.length >= (Number(total) || 0), at: new Date().toISOString() };
  });
};

// Qayta ishlash ro'yxati: sozlamadagi sabablar bilan yo'qotilgan lidlar, yo'qotilganiga `kun` kundan oshgan (180 kungacha).
export const qayta = (bx, db, { owner = null } = {}) => {
  const cfg = sozlama(db);
  return cached(`voronka:qayta:${owner || "all"}:${cfg.qayta.kun}:${cfg.qayta.sabablar.join("|")}`, TTL, async () => {
    const E = await lugatlar(bx);
    const from = ymdTash(Date.now() - 400 * DAY);
    const { items } = await bx.listAll("crm.lead.list", {
      filter: { ">=DATE_CREATE": `${from}T00:00:00+05:00`, STATUS_ID: Object.keys(LEAD_LOST), ...leadOwn(owner) },
      select: [...LEAD_SEL, "PHONE"], order: { DATE_CREATE: "DESC" }, maxItems: 20000,
    });
    const { names } = await dir.names(bx, items.map((x) => x.ASSIGNED_BY_ID));
    const set = new Set(cfg.qayta.sabablar), now = Date.now(), dan = now - 180 * DAY, gacha = now - cfg.qayta.kun * DAY;
    const out = [];
    for (const x of items) {
      const sabab = E.leadReason[String(x[F.leadReason] || "")];
      if (!sabab || !set.has(sabab)) continue;
      const sana = t(x.DATE_CLOSED) || t(x.MOVED_TIME); if (!sana || sana > gacha || sana < dan) continue;
      const tel = (Array.isArray(x.PHONE) ? x.PHONE : []).map((p) => p && p.VALUE).filter(Boolean)[0] || "";
      out.push({ id: x.ID, nom: lidNomi(x), sabab, sana: ymdTash(sana), kun: Math.floor((now - sana) / DAY),
        operator: names[String(x.ASSIGNED_BY_ID)] || "", operatorId: String(x.ASSIGNED_BY_ID || ""), menejer: "", tel,
        manba: E.source[x.SOURCE_ID] || "", tur: "lead", url: leadUrl(x.ID) });
    }
    out.sort((a, b) => a.kun - b.kun);
    return { sabablar: cfg.qayta.sabablar, kun: cfg.qayta.kun, rows: out, at: new Date().toISOString() };
  });
};

// Sozlama oynasi uchun: Bitrix bosqichlari va yo'qotish sabablari ro'yxati
export const lugat = (bx) => cached("voronka:lugat", 10 * 60e3, async () => {
  const E = await lugatlar(bx);
  const arr = (m) => Object.values(m).map((n) => ({ n, c: null }));
  return { bosqichlar: STD.bosqichlar.map((b) => ({ n: b.nom, c: null })), sabablar: arr(E.leadReason) };
});
