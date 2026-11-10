// Qo'ng'iroqlar tahlili — TZ §3 (LeadSquared call tracking), §6.3 (coaching dalili).
// Bitrix telefoniya API'si (voximplant.*) webhook'ga ochiq emas, lekin qo'ng'iroqlar
// crm.activity ichida TYPE_ID=2 sifatida turadi — hammasi shundan hisoblanadi.
import { cached } from "./cache.mjs";
import { ymd } from "./bitrix.mjs";
import * as rng from "./range.mjs";
import * as dir from "./directory.mjs";

const TTL = 5 * 60e3;
const tkDay = (iso) => { const d = new Date(iso); return ymd(new Date(d.getTime() + (d.getTimezoneOffset() + 300) * 6e4)); };
const secs = (a, b) => { try { return Math.max(0, (new Date(b) - new Date(a)) / 1000); } catch { return 0; } };
const pct = (n, d) => (d ? +(n / d * 100).toFixed(1) : 0);
const quantile = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};

export const calls = (bx, range, owner = null) => {
  const R = rng.normalize(range, 30);
  // Uzoq oraliqda yozuv ko'proq kerak, lekin Bitrix'ni cho'ktirmaydigan chegara bilan.
  const MAX = Math.min(20000, Math.max(2000, R.days * 150));   // VoIP: kuniga ~110 qo'ng'iroq (2026-09-24)
  return cached(`calls:${R.key}:${owner || "all"}`, TTL, async () => {
    const [acts, leads] = await Promise.all([
      bx.listAll("crm.activity.list", {
        filter: { TYPE_ID: 2, ">=CREATED": R.fromISO, "<=CREATED": R.toISO },
        select: ["ID", "RESPONSIBLE_ID", "DIRECTION", "START_TIME", "END_TIME",
                 "SETTINGS", "OWNER_ID", "OWNER_TYPE_ID", "CREATED"],
        order: { CREATED: "ASC" }, maxItems: MAX,
      }),
      bx.listAll("crm.lead.list", {
        filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO },
        select: ["ID", "DATE_CREATE", "ASSIGNED_BY_ID", "STATUS_SEMANTIC_ID"],
        order: { DATE_CREATE: "ASC" }, maxItems: MAX,
      }),
    ]);

    let items = acts.items.map((a) => {
      const st = a.SETTINGS && typeof a.SETTINGS === "object" ? a.SETTINGS : {};
      return {
        id: a.ID, owner: String(a.RESPONSIBLE_ID || "?"),
        out: String(a.DIRECTION) === "2",
        missed: st.MISSED_CALL === true,
        dur: secs(a.START_TIME, a.END_TIME),
        at: a.START_TIME || a.CREATED,
        leadId: String(a.OWNER_TYPE_ID) === "1" ? String(a.OWNER_ID) : null,
      };
    });
    if (owner) items = items.filter((c) => c.owner === String(owner));

    // ---- kunlik dinamika (uzoq oraliqda haftalik) ----
    const bk = rng.buckets(R);
    const buckets = new Map(bk.keys.map((k) => [k, { date: k, in: 0, out: 0, missed: 0 }]));
    for (const c of items) {
      const b = buckets.get(bk.at(tkDay(c.at)));
      if (!b) continue;
      c.out ? b.out++ : b.in++;
      if (c.missed) b.missed++;
    }

    // ---- mas'ullar kesimi ----
    const byOwner = new Map();
    for (const c of items) {
      if (!byOwner.has(c.owner)) byOwner.set(c.owner, { owner: c.owner, total: 0, in: 0, out: 0, missed: 0, talk: 0, answered: 0 });
      const o = byOwner.get(c.owner);
      o.total++; c.out ? o.out++ : o.in++;
      if (c.missed) o.missed++; else { o.answered++; o.talk += c.dur; }
    }

    // ---- javob tezligi ----
    // Muhim nuance: kiruvchi qo'ng'iroq lidni O'ZI yaratadi, shuning uchun u yerda
    // "javob vaqti" har doim ~0 va ma'nosiz. Haqiqiy o'lchov — biz o'zimiz qo'ng'iroq
    // qilishimiz kerak bo'lgan lidlar (veb, Facebook, forma). Ikkalasi alohida sanaladi.
    const firstCall = new Map();   // leadId -> {at, out}
    for (const c of items) {
      if (!c.leadId || c.missed) continue;
      const prev = firstCall.get(c.leadId);
      if (!prev || new Date(c.at) < new Date(prev.at)) firstCall.set(c.leadId, { at: c.at, out: c.out });
    }
    const gaps = [];        // faqat biz qo'ng'iroq qilgan lidlar
    let inbound = 0, noCall = 0;
    const leadRows = owner
      ? leads.items.filter((l) => String(l.ASSIGNED_BY_ID) === String(owner))
      : leads.items;
    for (const l of leadRows) {
      const fc = firstCall.get(String(l.ID));
      if (!fc) { noCall++; continue; }
      if (!fc.out) { inbound++; continue; }        // lidni kiruvchi qo'ng'iroq yaratgan
      const m = secs(l.DATE_CREATE, fc.at) / 60;
      if (m >= 0 && m < 60 * 24 * 14) gaps.push(m);
    }
    const within = (m) => gaps.filter((g) => g <= m).length;

    const answered = items.filter((c) => !c.missed);
    const { rows: ownerRows, resolved: ownersResolved } = await dir.decorate(bx,
      [...byOwner.values()].map((o) => ({
        ...o,
        missedRate: pct(o.missed, o.total),
        avgDur: o.answered ? Math.round(o.talk / o.answered) : 0,
        talkMin: Math.round(o.talk / 60),
      })).sort((a, b) => b.total - a.total), "owner", "ownerName");
    return {
      range: { from: R.from, to: R.to, days: R.days, label: R.label, bucket: R.bucket },
      days: R.days,
      bucket: R.bucket,
      totals: {
        calls: items.length,
        in: items.filter((c) => !c.out).length,
        out: items.filter((c) => c.out).length,
        missed: items.filter((c) => c.missed).length,
        missedRate: pct(items.filter((c) => c.missed).length, items.length),
        avgDur: answered.length ? Math.round(answered.reduce((a, c) => a + c.dur, 0) / answered.length) : 0,
        talkHours: +(answered.reduce((a, c) => a + c.dur, 0) / 3600).toFixed(1),
      },
      response: {
        leads: leadRows.length,
        inbound,                       // kiruvchi qo'ng'iroqdan tug'ilgan — tezlik o'lchanmaydi
        called: gaps.length,           // biz qo'ng'iroq qilganlar — haqiqiy o'lchov shu
        notCalled: noCall,
        medianMin: gaps.length ? Math.round(quantile(gaps, 0.5)) : null,
        p90Min: gaps.length ? Math.round(quantile(gaps, 0.9)) : null,
        within5: within(5), within15: within(15), within60: within(60),
        within5Pct: pct(within(5), gaps.length),
      },
      series: [...buckets.values()],
      owners: ownerRows,
      namesResolved: ownersResolved,
      sampled: acts.items.length,
      capped: acts.items.length >= MAX,
    };
  });
};

// ===========================================================================
// TZ §3 — qo'ng'iroqlar reyestri va AI tahlil ko'rsatkichlari
// ===========================================================================
import * as store from "./callstore.mjs";
import { RISK_LABEL, URGENCY_LABEL, RUBRIC } from "./callai.mjs";

const OT = { 1: "lead", 2: "deal", 3: "contact", 4: "company" };
// "Исходящий на 94 107 55 00" → "941075500". Kiruvchi/javobsizda raqam SUBJECT'da yo'q.
const phoneFromSubject = (s) => {
  const m = String(s || "").match(/(\+?\d[\d\s()-]{6,})$/);
  return m ? m[1].replace(/\D/g, "") : null;
};
export const maskPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length < 7) return d ? "•••" : null;
  return `${d.slice(0, 2)}•••••${d.slice(-2)}`;
};
const firstPhone = (e) => (Array.isArray(e?.PHONE) && e.PHONE[0]?.VALUE) || null;
const chunk = (a, n = 50) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// Bitrix qismini keshlaydi — tahlil natijalari keshdan tashqarida, har safar yangi.
const rawCalls = (bx, range, owner) => {
  const R = rng.normalize(range, 30);
  const MAX = Math.min(20000, Math.max(1500, R.days * 150));   // VoIP: kuniga ~110 qo'ng'iroq (2026-09-24)
  return cached(`callreg:${R.key}:${owner || "all"}`, TTL, async () => {
    const acts = await bx.listAll("crm.activity.list", {
      filter: { TYPE_ID: 2, ">=CREATED": R.fromISO, "<=CREATED": R.toISO },
      select: ["ID", "SUBJECT", "RESPONSIBLE_ID", "DIRECTION", "START_TIME", "END_TIME",
               "SETTINGS", "OWNER_ID", "OWNER_TYPE_ID", "CREATED", "FILES", "ORIGIN_ID"],
      order: { CREATED: "DESC" }, maxItems: MAX,
    });
    let items = acts.items.map((a) => {
      const st = a.SETTINGS && typeof a.SETTINGS === "object" ? a.SETTINGS : {};
      const kind = OT[a.OWNER_TYPE_ID] || null;
      return {
        id: String(a.ID), owner: String(a.RESPONSIBLE_ID || "?"),
        out: String(a.DIRECTION) === "2",
        missed: st.MISSED_CALL === true,
        dur: secs(a.START_TIME, a.END_TIME),
        at: a.START_TIME || a.CREATED,
        subject: a.SUBJECT || "",
        phone: phoneFromSubject(a.SUBJECT),
        entity: kind ? { kind, id: String(a.OWNER_ID) } : null,
        hasRecording: Array.isArray(a.FILES) && a.FILES.length > 0,
        originId: a.ORIGIN_ID || null,      // "VI_externalCall.<CALL_ID>.<ts>" — telefoniya shundan topiladi
      };
    });
    if (owner) items = items.filter((c) => c.owner === String(owner));

    // ---- bog'langan yozuvlarning nomlari (partiyalab, bitta so'rovda 50 tadan) ----
    const ids = { lead: new Set(), deal: new Set(), contact: new Set(), company: new Set() };
    for (const c of items) if (c.entity) ids[c.entity.kind].add(c.entity.id);
    const fetchAll = async (method, idset, select) => {
      const out = new Map();
      for (const part of chunk([...idset])) {
        if (!part.length) continue;
        try {
          const r = await bx.call(method, { filter: { "@ID": part }, select, start: 0 });
          for (const x of r.result || []) out.set(String(x.ID), x);
        } catch {}
      }
      return out;
    };
    const [leads, deals, contacts, companies, stages, caps] = await Promise.all([
      fetchAll("crm.lead.list", ids.lead, ["ID", "TITLE", "COMPANY_TITLE", "NAME", "LAST_NAME", "PHONE", "STATUS_ID"]),
      fetchAll("crm.deal.list", ids.deal, ["ID", "TITLE", "STAGE_ID", "CATEGORY_ID", "OPPORTUNITY", "CURRENCY_ID"]),
      fetchAll("crm.contact.list", ids.contact, ["ID", "NAME", "LAST_NAME", "PHONE"]),
      fetchAll("crm.company.list", ids.company, ["ID", "TITLE", "PHONE"]),
      bx.call("crm.status.list", { filter: { ENTITY_ID: "DEAL_STAGE" } })
        .then((r) => new Map((r.result || []).map((s) => [s.STATUS_ID, s.NAME]))).catch(() => new Map()),
      dir.capabilities(bx),
    ]);

    for (const c of items) {
      if (!c.entity) continue;
      const { kind, id } = c.entity;
      if (kind === "lead") {
        const l = leads.get(id); if (!l) continue;
        c.entity.title = l.COMPANY_TITLE || l.TITLE || [l.NAME, l.LAST_NAME].filter(Boolean).join(" ") || `Lid #${id}`;
        c.entity.label = "Lid";
        c.phone = c.phone || firstPhone(l);
      } else if (kind === "deal") {
        const d = deals.get(id); if (!d) continue;
        c.entity.title = d.TITLE || `Bitim #${id}`;
        c.entity.label = "Bitim";
        c.deal = { id, title: d.TITLE, stage: d.STAGE_ID, stageName: stages.get(d.STAGE_ID) || d.STAGE_ID,
                   amount: Number(d.OPPORTUNITY || 0), currency: d.CURRENCY_ID || "UZS", category: d.CATEGORY_ID };
      } else if (kind === "contact") {
        const k = contacts.get(id); if (!k) continue;
        c.entity.title = [k.NAME, k.LAST_NAME].filter(Boolean).join(" ") || `Kontakt #${id}`;
        c.entity.label = "Kontakt";
        c.phone = c.phone || firstPhone(k);
      } else if (kind === "company") {
        const k = companies.get(id); if (!k) continue;
        c.entity.title = k.TITLE || `Kompaniya #${id}`;
        c.entity.label = "Kompaniya";
        c.phone = c.phone || firstPhone(k);
      }
    }
    // Operator ismlari — `user` scope bo'lsa o'zi chiqadi, bo'lmasa "#654" qoladi
    const { rows, resolved } = await dir.decorate(bx, items, "owner", "ownerName");
    return { items: rows, namesResolved: resolved, caps,
             range: { from: R.from, to: R.to, days: R.days, label: R.label },
             capped: acts.items.length >= MAX, fetchedAt: new Date().toISOString() };
  });
};

const SENT_LABEL = { positive: "Ijobiy", neutral: "Neytral", negative: "Salbiy" };
const STATUS_LABEL = { ready: "Tayyor", running: "Tahlil qilinmoqda", queued: "Navbatda", error: "Xato", none: "Tahlil yo'q" };

// TZ §3.2 — jadval, filtrlar bilan
export async function registry(bx, db, {
  range = 30, owner = null, limit = 50, offset = 0, canSeePhone = false, mineOwner = null,
  dir: direction = null, risk = null, sentiment = null, status = null, minScore = null, maxScore = null,
  hasNext = null, term = null, q = null, stage = null, analyzedOnly = false,
} = {}) {
  const base = await rawCalls(bx, range, owner);
  const an = store.analysesFor(db, base.items.map((c) => c.id));
  // TZ §3.2 "tekshirildi" — rahbar ko'rib chiqqanlari
  const reviewed = new Set(db.prepare("SELECT call_id FROM call_reviews").all().map((r) => r.call_id));

  let rows = base.items.map((c) => {
    const a = an.get(c.id) || null;
    const own = mineOwner && String(c.owner) === String(mineOwner);
    const show = canSeePhone || own;
    return {
      ...c,
      phone: c.phone ? (show ? c.phone : maskPhone(c.phone)) : null,
      phoneMasked: !show && !!c.phone,
      analysis: a ? {
        status: a.status, engine: a.engine, score: a.score, risk: a.risk,
        riskLabel: RISK_LABEL[a.risk] || null, sentiment: a.sentiment,
        sentimentLabel: SENT_LABEL[a.sentiment] || null, topic: a.topic,
        urgency: a.urgency, urgencyLabel: URGENCY_LABEL[a.urgency] || null,
        confidence: a.confidence, error: a.error, at: a.analyzed_at,
      } : null,
      reviewed: reviewed.has(c.id),
      status: a ? a.status : "none",
      statusLabel: reviewed.has(c.id) && a?.status === "ready" ? "Tekshirildi"
        : a ? (STATUS_LABEL[a.status] || a.status) : "Tahlil yo'q",
    };
  });

  // Keyingi qadam / kritik so'z filtri uchun to'liq JSON kerak
  if (hasNext !== null || term) {
    const full = new Map();
    for (const r of rows) {
      if (r.status !== "ready") continue;
      const row = db.prepare("SELECT json FROM call_analyses WHERE call_id=?").get(r.id);
      if (row?.json) { try { full.set(r.id, JSON.parse(row.json)); } catch {} }
    }
    rows = rows.filter((r) => {
      const j = full.get(r.id);
      if (hasNext !== null) {
        const has = !!(j && j.next_action && (j.next_action.text || j.next_action.type));
        if (has !== hasNext) return false;
      }
      if (term) {
        if (!j) return false;
        const t = String(term).toLowerCase();
        if (!(j.critical_moments || []).some((m) => String(m.term).toLowerCase().includes(t))) return false;
      }
      return true;
    });
    for (const r of rows) {
      const j = full.get(r.id);
      if (j?.next_action) r.next = { type: j.next_action.type, text: j.next_action.text, due: j.next_action.due };
    }
  }

  const f = (cond) => { rows = rows.filter(cond); };
  if (direction === "in") f((r) => !r.out);
  if (direction === "out") f((r) => r.out);
  if (direction === "missed") f((r) => r.missed);
  if (risk) f((r) => r.analysis?.risk === risk);
  if (sentiment) f((r) => r.analysis?.sentiment === sentiment);
  if (status) f((r) => r.status === status);
  if (analyzedOnly) f((r) => r.status === "ready");
  if (minScore !== null) f((r) => (r.analysis?.score ?? -1) >= minScore);
  if (maxScore !== null) f((r) => (r.analysis?.score ?? 101) <= maxScore);
  if (stage) f((r) => r.deal?.stage === stage);
  if (q) {
    const s = String(q).toLowerCase();
    f((r) => (r.entity?.title || "").toLowerCase().includes(s)
          || (r.analysis?.topic || "").toLowerCase().includes(s)
          || (r.ownerName || "").toLowerCase().includes(s)
          || String(r.phone || "").includes(s));
  }

  return {
    total: rows.length, range: base.range,
    rows: rows.slice(offset, offset + limit),
    owners: [...new Map(base.items.map((c) => [c.owner, c.ownerName])).entries()]
      .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    namesResolved: base.namesResolved,
    stages: [...new Map(base.items.filter((c) => c.deal).map((c) => [c.deal.stage, c.deal.stageName])).entries()]
      .map(([id, name]) => ({ id, name })),
    capped: base.capped, fetchedAt: base.fetchedAt,
    // Audio: Bitrix'da yozuv bor, lekin telephony ruxsati bo'lmasa yuklab bo'lmaydi
    recordings: { present: base.items.filter((c) => c.hasRecording).length,
                  downloadable: !!base.caps?.telephony },
    caps: base.caps,
  };
}

// TZ §3.1 — yuqori KPI kartalari
// Tanlangan davrda qo'ng'iroq bo'lmasa — eng oxirgi qo'ng'iroq qachon bo'lganini aytamiz
// (Odoo adapteri /healthz da beradi). Bo'sh sahifa «ma'lumot yo'q» emas, «oxirgi qo'ng'iroq
// 31-iyul» deb tushuntiriladi — foydalanuvchi integratsiya to'xtaganini ko'radi.
async function oxirgiQongiroq() {
  const url = String(process.env.BITRIX_WEBHOOK_URL || "");
  if (!/:8098\//.test(url)) return null;
  try {
    const r = await fetch(url.replace(/\/rest\/.*$/, "/healthz"), { signal: AbortSignal.timeout(2500) });
    return (await r.json())?.counts?.callsOxirgi || null;
  } catch { return null; }
}

export async function qualityKpi(bx, db, { range = 30, owner = null } = {}) {
  const base = await rawCalls(bx, range, owner);
  const an = store.analysesFor(db, base.items.map((c) => c.id));
  const ready = [...an.values()].filter((a) => a.status === "ready");
  const scores = ready.map((a) => a.score).filter((n) => Number.isFinite(n));

  let promisedNoTask = 0, noNextStep = 0;
  const atRiskAmount = new Map(), problems = new Map(), objections = new Map();
  for (const a of ready) {
    let j;
    try { j = JSON.parse(db.prepare("SELECT json FROM call_analyses WHERE call_id=?").get(a.call_id).json); }
    catch { continue; }
    const hasPromise = (j.promises || []).some((p) => p.by === "operator");
    const hasTask = db.prepare(
      "SELECT COUNT(*) c FROM call_tasks WHERE call_id=? AND state IN ('confirmed','pushed')").get(a.call_id).c > 0;
    if (hasPromise && !hasTask) promisedNoTask++;
    if (!j.next_action || !/\S/.test(String(j.next_action.text || "").replace(/^(null|none|undefined|n\/a|yo.?q|—|-)$/i, ""))) noNextStep++;   // v2: «null» matni ham yo'q
    for (const p of j.problems || []) if (p.title) problems.set(p.title, (problems.get(p.title) || 0) + 1);
    for (const o of j.objections || []) if (o.text) objections.set(o.text, (objections.get(o.text) || 0) + 1);
    if (["high", "critical"].includes(a.risk)) {
      const call = base.items.find((c) => c.id === a.call_id);
      if (call?.deal?.amount) {
        const cur = call.deal.currency || "UZS";
        atRiskAmount.set(cur, (atRiskAmount.get(cur) || 0) + call.deal.amount);
      }
    }
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ text: k, n: v }));

  return {
    range: base.range,
    oxirgi: base.items.length ? null : await oxirgiQongiroq(),
    calls: base.items.length,
    analyzable: base.items.filter((c) => !c.missed).length,
    analyzed: ready.length,
    pending: base.items.filter((c) => !c.missed).length - an.size,
    errors: [...an.values()].filter((a) => a.status === "error").length,
    avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    positivePct: ready.length ? Math.round(ready.filter((a) => a.sentiment === "positive").length / ready.length * 100) : null,
    critical: ready.filter((a) => a.risk === "critical").length,
    highRisk: ready.filter((a) => ["critical", "high"].includes(a.risk)).length,
    promisedNoTask, noNextStep,
    topProblem: top(problems)[0] || null,
    topProblems: top(problems), topObjections: top(objections),
    atRisk: [...atRiskAmount.entries()].map(([currency, amount]) => ({ currency, amount })),
    recordings: { present: base.items.filter((c) => c.hasRecording).length,
                  downloadable: !!base.caps?.telephony },
    caps: base.caps, capped: base.capped,
  };
}

// TZ §7 — rahbar paneli "Qo'ng'iroq sifati" bloki
export async function leaderQuality(bx, db, { range = 30 } = {}) {
  const base = await rawCalls(bx, range, null);
  const an = store.analysesFor(db, base.items.map((c) => c.id));
  const ready = [...an.values()].filter((a) => a.status === "ready");
  const byOwner = new Map(), critEvents = [];
  const cSum = {}, cN = {}, cLabel = {};

  for (const a of ready) {
    const call = base.items.find((c) => c.id === a.call_id);
    if (!call) continue;
    if (!byOwner.has(call.owner))
      byOwner.set(call.owner, { owner: call.owner, ownerName: call.ownerName, n: 0, sum: 0, critical: 0, positive: 0 });
    const o = byOwner.get(call.owner);
    o.n++; o.sum += a.score || 0;
    if (a.risk === "critical") o.critical++;
    if (a.sentiment === "positive") o.positive++;
    if (["critical", "high"].includes(a.risk)) {
      const rv = store.getReview(db, a.call_id);
      critEvents.push({ id: a.call_id, at: call.at, owner: call.owner, ownerName: call.ownerName,
        risk: a.risk, riskLabel: RISK_LABEL[a.risk], score: a.score, topic: a.topic,
        title: call.entity?.title || null, reviewed: !!rv, reviewer: rv?.actor || null });
    }
    let j;
    try { j = JSON.parse(db.prepare("SELECT json FROM call_analyses WHERE call_id=?").get(a.call_id).json); }
    catch { continue; }
    for (const c of j.operator_score?.criteria || []) {
      cSum[c.id] = (cSum[c.id] || 0) + c.score / c.max;
      cN[c.id] = (cN[c.id] || 0) + 1;
      cLabel[c.id] = c.label;
    }
  }
  const criteria = Object.keys(cSum)
    .map((id) => ({ id, label: cLabel[id] || id, pct: Math.round(cSum[id] / cN[id] * 100) }))
    .sort((a, b) => b.pct - a.pct);
  // Umumiy ko'rinish uchun: ball taqsimoti (0–49 / 50–74 / 75+) va mijoz kayfiyati
  const bands = { low: 0, mid: 0, high: 0 }, sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const a of ready) {
    const sc = Number(a.score || 0);
    bands[sc >= 75 ? "high" : sc >= 50 ? "mid" : "low"]++;
    if (a.sentiment in sentiment) sentiment[a.sentiment]++;
  }

  return {
    range: base.range, analyzed: ready.length, bands, sentiment,
    avgScore: (() => { const v = ready.map((a) => a.score).filter((x) => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; })(),   // v2: bahosizlar hisobga kirmaydi
    best: criteria.slice(0, 3), worst: criteria.slice(-3).reverse(), criteria,
    owners: [...byOwner.values()].map((o) => ({ ...o, avg: o.n ? Math.round(o.sum / o.n) : 0 }))
      .sort((a, b) => b.avg - a.avg),
    namesResolved: base.namesResolved,
    critical: critEvents.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 20),
    reviewedPct: critEvents.length
      ? Math.round(critEvents.filter((c) => c.reviewed).length / critEvents.length * 100) : null,
  };
}

// ---------------------------------------------------------------- mezonlar kesimi (2026-09-30)
// «Xatolar narxi» (voronka) va operator radari uchun: har tayyor tahlil — 8 mezon (RUBRIC) bo'yicha
// ball ÷ max. Mezon 50% dan past bo'lsa — shu qo'ng'iroqda XATO. Lid — qo'ng'iroq bog'langan CRM yozuvi
// (Odoo'da lid va imkoniyat bitta crm.lead, ID bir xil — shuning uchun «deal» ham lid hisoblanadi).
export const XATO_CHEGARA = 0.5;
export const mezonKesim = (bx, db, range) => {
  const R = rng.normalize(range, 30);
  return cached(`mezon:${R.key}`, TTL, async () => {
    const base = await rawCalls(bx, R, null);
    const ready = [];
    const ids = base.items.map((c) => c.id);
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      ready.push(...db.prepare(`SELECT call_id, json FROM call_analyses WHERE status='ready' AND call_id IN (${part.map(() => "?").join(",")})`).all(...part));
    }
    const J = new Map(ready.map((r) => [r.call_id, r.json]));
    const out = [];
    for (const c of base.items) {
      const js = J.get(c.id); if (!js) continue;
      let j; try { j = JSON.parse(js); } catch { continue; }
      const cr = (j.operator_score?.criteria || []).filter((x) => x && x.id && x.max > 0).map((x) => ({ id: x.id, p: Math.max(0, Math.min(1, x.score / x.max)) }));
      if (cr.length) out.push({ id: c.id, owner: c.owner, lead: c.entity && (c.entity.kind === "lead" || c.entity.kind === "deal") ? c.entity.id : null, cr });
    }
    return out;
  });
};

// Operator radari: 8 mezon bo'yicha operator o'rtachasi va jamoa o'rtachasi (%, davr — odatda 30 kun)
export async function radar(bx, db, { range = 30, owner } = {}) {
  const M = await mezonKesim(bx, db, range);
  const agg = (rows) => { const s = {}, n = {};
    for (const r of rows) for (const c of r.cr) { s[c.id] = (s[c.id] || 0) + c.p; n[c.id] = (n[c.id] || 0) + 1; }
    return Object.fromEntries(Object.keys(s).map((k) => [k, Math.round(s[k] / n[k] * 100)])); };
  const mine = M.filter((r) => r.owner === String(owner));
  const op = agg(mine), team = agg(M);
  return { range: rng.pub(rng.normalize(range, 30)), n: mine.length, nTeam: M.length,
    criteria: RUBRIC.map((c) => ({ id: c.id, label: c.label, max: c.max, op: op[c.id] ?? null, team: team[c.id] ?? null })) };
}

// Bitta qo'ng'iroq — butun reyestrni skanerlamasdan (tahlil oynasi shundan ochiladi).
export async function one(bx, db, id, { canSeePhone = false, mineOwner = null, owner = null } = {}) {
  const r = await bx.call("crm.activity.get", { id: String(id) });
  const a = r.result;
  if (!a || String(a.TYPE_ID) !== "2") return null;
  if (owner && String(a.RESPONSIBLE_ID) !== String(owner)) return null;   // sotuvchi faqat o'zinikini
  const st = a.SETTINGS && typeof a.SETTINGS === "object" ? a.SETTINGS : {};
  const kind = OT[a.OWNER_TYPE_ID] || null;
  const own = mineOwner && String(a.RESPONSIBLE_ID) === String(mineOwner);
  const c = {
    id: String(a.ID), owner: String(a.RESPONSIBLE_ID || "?"),
    out: String(a.DIRECTION) === "2", missed: st.MISSED_CALL === true,
    dur: secs(a.START_TIME, a.END_TIME), at: a.START_TIME || a.CREATED,
    subject: a.SUBJECT || "", phone: phoneFromSubject(a.SUBJECT),
    entity: kind ? { kind, id: String(a.OWNER_ID) } : null,
    hasRecording: Array.isArray(a.FILES) && a.FILES.length > 0,
    originId: a.ORIGIN_ID || null,
  };
  const M = { lead: ["crm.lead.get", "Lid"], deal: ["crm.deal.get", "Bitim"],
              contact: ["crm.contact.get", "Kontakt"], company: ["crm.company.get", "Kompaniya"] };
  if (c.entity && M[c.entity.kind]) {
    const [method, label] = M[c.entity.kind];
    try {
      const e = (await bx.call(method, { id: c.entity.id })).result || {};
      c.entity.label = label;
      c.entity.title = e.COMPANY_TITLE || e.TITLE || [e.NAME, e.LAST_NAME].filter(Boolean).join(" ")
        || `${label} #${c.entity.id}`;
      c.phone = c.phone || firstPhone(e);
      if (c.entity.kind === "deal") {
        const stages = await bx.call("crm.status.list", { filter: { ENTITY_ID: "DEAL_STAGE" } })
          .then((x) => new Map((x.result || []).map((s) => [s.STATUS_ID, s.NAME]))).catch(() => new Map());
        c.deal = { id: c.entity.id, title: e.TITLE, stage: e.STAGE_ID,
                   stageName: stages.get(e.STAGE_ID) || e.STAGE_ID,
                   amount: Number(e.OPPORTUNITY || 0), currency: e.CURRENCY_ID || "UZS" };
      }
    } catch {}
  }
  const [{ rows }, caps] = await Promise.all([dir.decorate(bx, [c], "owner", "ownerName"), dir.capabilities(bx)]);
  const out = rows[0];
  out.phoneMasked = !(canSeePhone || own) && !!out.phone;
  if (out.phone && out.phoneMasked) out.phone = maskPhone(out.phone);
  out.caps = caps;
  return out;
}
