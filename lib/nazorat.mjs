// Nazorat — Pitaka (2026-11-10). Mijozning ikki savoliga javob beradigan hisobotlar:
//
//   1) «CRM vs suhbat»: menejer lidga KVAL / NE KVAL to'g'ri qo'yyaptimi? CRM'dagi holat (Bitrix STATUS_ID)
//      qo'ng'iroq suhbatidan chiqqan AI bahosi bilan solishtiriladi.
//        A — CRM'da NE KVAL / Bekor, AI esa «kval» → yaxshi lid yo'qotilgan (eng muhimi)
//        B — CRM'da Kvalifikatsiya, AI esa «nekval» → sifatsiz lid kvalifikatsiyaga o'tkazilgan
//      AI «noaniq» — solishtirilmaydi (xato emas).
//   2) «Menejerlar qoidabuzarliklari»: tahlil qilingan qo'ng'iroqlar bo'yicha har menejerning ssenariy
//      mezonlari, o'tkazib yuborilgan bosqichlari, suhbatdagi yo'qotish sabablari va eng yomon qo'ng'iroqlari.
//
// Hammasi kod bilan hisoblanadi, AI chaqirilmaydi. Bitrix — faqat o'qish.
import { cached } from "./cache.mjs";
import * as rng from "./range.mjs";
import * as sifat from "./sifat.mjs";
import * as dir from "./directory.mjs";
import { XATO_CHEGARA } from "./calls.mjs";
import { RUBRIC } from "./callai.mjs";

const TTL = 60e3;
const LIST_CAP = 300;
const REASON_FIELD = "UF_CRM_1776932197903";   // lid «Rad etish sababi» (ro'yxat)
export const ATTRIBUTION = "RESPONSIBLE_ID (Bitrix)";
export const ATTRIBUTION_NOTE = "Qo'ng'iroq Bitrix'dagi mas'ulga (RESPONSIBLE_ID) yoziladi. Bitrix uni lid egasiga yozishi mumkin, "
  + "suhbatda gapirgan operatorga emas — bu ochiq savol, mijoz bilan aniqlanmoqda.";

export const CRM_STATUS = { UC_3D7LNB: "kval", CONVERTED: "kval", UC_O11I30: "nekval", JUNK: "rad", UC_7YH6KA: "rad" };
const STATUS_NAME = { NEW: "Prioritet", UC_AEH2UE: "Yangi mijoz", UC_3D7LNB: "Kvalifikatsiya", CONVERTED: "Bitimga aylandi",
  UC_O11I30: "NE KVAL", JUNK: "Bekor qilindi", UC_7YH6KA: "Arxiv" };
const SIFAT_TO_KVAL = { sifatli: "kval", sifatsiz: "nekval", noaniq: "noaniq" };
export const MISMATCH = {
  A: "Yaxshi lid yo'qotilgan: CRM'da NE KVAL yoki bekor, suhbatda esa kvalifikatsiyali",
  B: "Sifatsiz lid kvalifikatsiyaga o'tkazilgan: CRM'da Kvalifikatsiya, suhbatda esa sifatsiz",
};

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const portal = () => String(process.env.BITRIX_PORTAL || "").replace(/\/+$/, "");
const leadUrl = (id) => (portal() ? `${portal()}/crm/lead/details/${id}/` : null);
const leadName = (x) => [x.NAME, x.LAST_NAME].filter(Boolean).join(" ") || x.TITLE || `Lid #${x.ID}`;
const ownerOf = (owner) => (owner === null || owner === undefined || owner === "" ? null : String(owner));
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// CRM holati → kval | nekval | rad | ochiq
export const crmSide = (statusId) => CRM_STATUS[statusId] || "ochiq";

// Solishtirish: crm (kval|nekval|rad|ochiq), ai (kval|nekval|noaniq|null) → agree | A | B | null (solishtirilmaydi)
export function classify(crm, ai) {
  if (!ai || ai === "noaniq" || crm === "ochiq") return null;
  if ((crm === "nekval" || crm === "rad") && ai === "kval") return "A";
  if (crm === "kval" && ai === "nekval") return "B";
  return "agree";
}

const reasonEnum = (bx) => cached("nazorat:leadReason", 30 * 60e3, async () => {
  const f = (await bx.call("crm.lead.fields")).result || {};
  return Object.fromEntries((f[REASON_FIELD]?.items || []).map((i) => [String(i.ID), i.VALUE]));
});

// Davrdagi qo'ng'iroq faoliyatlari (Bitrix) — mas'ul va bog'langan lid bilan
const callActs = (bx, R) => cached(`nazorat:acts:${R.key}`, TTL, async () => {
  const MAX = Math.min(20000, Math.max(1500, R.days * 150));
  const { items } = await bx.listAll("crm.activity.list", {
    filter: { TYPE_ID: 2, ">=CREATED": R.fromISO, "<=CREATED": R.toISO },
    select: ["ID", "RESPONSIBLE_ID", "OWNER_ID", "OWNER_TYPE_ID", "START_TIME", "CREATED"],
    order: { ID: "DESC" }, maxItems: MAX,
  });
  return items.map((a) => ({ id: String(a.ID), owner: String(a.RESPONSIBLE_ID || "?"), at: a.START_TIME || a.CREATED || null,
    lead: String(a.OWNER_TYPE_ID) === "1" ? String(a.OWNER_ID) : null }));
});

// call_id → tahlil JSON (faqat tayyorlari)
function analyses(db, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    if (!part.length) continue;
    const rows = db.prepare(`SELECT call_id, json, analyzed_at FROM call_analyses WHERE status='ready' AND call_id IN (${part.map(() => "?").join(",")})`).all(...part);
    for (const r of rows) { const j = parse(r.json); if (j) out.set(r.call_id, { j, analyzedAt: r.analyzed_at }); }
  }
  return out;
}

// ---------------------------------------------------------------- 1) CRM vs suhbat
export const kvalCheck = (bx, db, { range, owner = null } = {}) => {
  const R = rng.normalize(range, 30);
  const ow = ownerOf(owner);
  return cached(`nazorat:kval:${R.key}:${ow || "all"}`, TTL, async () => {
    const [E, acts, leadsRes] = await Promise.all([
      reasonEnum(bx),
      callActs(bx, R),
      bx.listAll("crm.lead.list", {
        filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO, ...(ow ? { ASSIGNED_BY_ID: ow } : {}) },
        select: ["ID", "TITLE", "NAME", "LAST_NAME", "STATUS_ID", "ASSIGNED_BY_ID", "DATE_CREATE", REASON_FIELD],
        order: { DATE_CREATE: "ASC" }, maxItems: 20000,
      }),
    ]);
    const leads = leadsRes.items;
    const leadIds = new Set(leads.map((x) => String(x.ID)));
    // Lidning eng so'nggi, iqtibosli kval bahosi (qo'ng'iroq tahlilidan)
    const leadCalls = acts.filter((a) => a.lead && leadIds.has(a.lead));
    const A = analyses(db, leadCalls.map((a) => a.id));
    const perCall = new Map();
    for (const a of leadCalls.sort((x, y) => String(y.at).localeCompare(String(x.at)))) {
      const k = A.get(a.id)?.j?.kval;
      if (!k || !["kval", "nekval", "noaniq"].includes(k.verdict) || perCall.has(a.lead)) continue;
      if (!k.quote) continue;
      perCall.set(a.lead, { verdict: k.verdict, reason: k.reason || null, quote: k.quote, callId: a.id, source: "call" });
    }
    const Q = sifat.ofLeads(db, [...leadIds]);
    const { names } = await dir.names(bx, leads.map((x) => x.ASSIGNED_BY_ID));

    const totals = { leads: leads.length, compared: 0, agree: 0, A: 0, B: 0, noAi: 0, noaniq: 0, ochiq: 0 };
    const byMgr = new Map();
    const list = [];
    for (const x of leads) {
      const id = String(x.ID);
      const crm = crmSide(x.STATUS_ID);
      const q = Q.get(id);
      const ai = perCall.get(id) || (q ? { verdict: SIFAT_TO_KVAL[q.verdict] || null, reason: q.reason || null, quote: q.quote || null,
        callId: q.callId || null, source: "lead" } : null);
      const mgr = String(x.ASSIGNED_BY_ID || "?");
      if (!byMgr.has(mgr)) byMgr.set(mgr, { id: mgr, name: names[mgr] || `#${mgr}`, leads: 0, compared: 0, agree: 0, A: 0, B: 0 });
      const m = byMgr.get(mgr);
      m.leads++;
      if (crm === "ochiq") { totals.ochiq++; continue; }
      if (!ai) { totals.noAi++; continue; }
      const c = classify(crm, ai.verdict);
      if (!c) { totals.noaniq++; continue; }
      totals.compared++; m.compared++;
      totals[c]++; m[c]++;
      if (c !== "agree" && list.length < LIST_CAP) {
        list.push({ type: c, lead: id, name: leadName(x), manager: m.name, managerId: mgr,
          crm: { side: crm, status: x.STATUS_ID, statusName: STATUS_NAME[x.STATUS_ID] || x.STATUS_ID,
                 reason: E[String(x[REASON_FIELD] || "")] || null },
          ai: { verdict: ai.verdict, reason: ai.reason, quote: ai.quote, callId: ai.callId, source: ai.source },
          url: leadUrl(id) });
      }
    }
    list.sort((a, b) => (a.type === b.type ? 0 : a.type === "A" ? -1 : 1));
    const managers = [...byMgr.values()].map((m) => ({ ...m, agreePct: pct(m.agree, m.compared) }))
      .sort((a, b) => (b.A + b.B) - (a.A + a.B) || b.compared - a.compared);
    return { range: rng.pub ? rng.pub(R) : { from: R.from, to: R.to, days: R.days },
      totals: { ...totals, agreePct: pct(totals.agree, totals.compared) }, types: MISMATCH, managers, list,
      listCapped: list.length >= LIST_CAP, at: new Date().toISOString() };
  });
};

// ---------------------------------------------------------------- 2) Menejerlar qoidabuzarliklari
function emptyAgg(id, name) {
  return { id, name, calls: 0, scoreSum: 0, scored: 0, crit: new Map(), missed: new Map(),
    kval: { kval: 0, nekval: 0, noaniq: 0 }, lost: [], all: [] };
}
function addCall(g, call, j) {
  g.calls++;
  const total = j.operator_score?.total;
  if (Number.isFinite(total)) { g.scoreSum += total; g.scored++; }
  for (const c of j.operator_score?.criteria || []) {
    if (!c || !c.id || !(c.max > 0)) continue;
    const p = Math.max(0, Math.min(1, c.score / c.max));
    const o = g.crit.get(c.id) || { id: c.id, label: c.label || c.id, sum: 0, n: 0, failed: 0 };
    o.sum += p; o.n++; if (p < XATO_CHEGARA) o.failed++;
    g.crit.set(c.id, o);
  }
  for (const s of Array.isArray(j.missedSteps) ? j.missedSteps : []) {
    const k = String(s).trim(); if (k) g.missed.set(k, (g.missed.get(k) || 0) + 1);
  }
  if (j.kval?.verdict && j.kval.verdict in g.kval) g.kval[j.kval.verdict]++;
  if (j.lostReason?.text) g.lost.push({ text: j.lostReason.text, quote: j.lostReason.quote || null, callId: call.id, lead: call.lead });
  g.all.push({ id: call.id, score: Number.isFinite(total) ? total : null, at: call.at, lead: call.lead, url: call.lead ? leadUrl(call.lead) : null });
}
function finish(g) {
  const criteria = [...g.crit.values()].map((o) => ({ id: o.id, label: o.label, avgPct: Math.round((o.sum / o.n) * 100), failed: o.failed, of: o.n }))
    .sort((a, b) => RUBRIC.findIndex((r) => r.id === a.id) - RUBRIC.findIndex((r) => r.id === b.id));
  return {
    id: g.id, name: g.name, calls: g.calls, avgScore: g.scored ? Math.round(g.scoreSum / g.scored) : null,
    criteria, weakest: [...criteria].sort((a, b) => a.avgPct - b.avgPct).slice(0, 3),
    missedSteps: [...g.missed.entries()].sort((a, b) => b[1] - a[1]).map(([step, n]) => ({ step, n })),
    kval: g.kval, lostReasons: g.lost.slice(0, 50),
    worstCalls: g.all.filter((c) => c.score !== null).sort((a, b) => a.score - b.score).slice(0, 5),
  };
}

export const violations = (bx, db, { range, owner = null, menejer = null } = {}) => {
  const R = rng.normalize(range, 30);
  const ow = ownerOf(owner) || ownerOf(menejer);
  return cached(`nazorat:men:${R.key}:${ow || "all"}`, TTL, async () => {
    let acts = await callActs(bx, R);
    if (ow) acts = acts.filter((a) => a.owner === ow);
    const A = analyses(db, acts.map((a) => a.id));
    const used = acts.filter((a) => A.has(a.id));
    const { names } = await dir.names(bx, used.map((a) => a.owner));
    const team = emptyAgg("jamoa", "Jamoa");
    const byMgr = new Map();
    for (const a of used) {
      const j = A.get(a.id).j;
      if (!byMgr.has(a.owner)) byMgr.set(a.owner, emptyAgg(a.owner, names[a.owner] || `#${a.owner}`));
      addCall(byMgr.get(a.owner), a, j);
      addCall(team, a, j);
    }
    return { range: rng.pub ? rng.pub(R) : { from: R.from, to: R.to, days: R.days },
      attribution: ATTRIBUTION, attributionNote: ATTRIBUTION_NOTE, failThresholdPct: XATO_CHEGARA * 100,
      callsInRange: acts.length, analysed: used.length,
      team: ow ? null : finish(team),
      managers: [...byMgr.values()].map(finish).sort((a, b) => (a.avgScore ?? 101) - (b.avgScore ?? 101)),
      at: new Date().toISOString() };
  });
};
