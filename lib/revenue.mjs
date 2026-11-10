// Revenue Command Center — TZ v3.0 §6, §7.1.
// Barcha formulalar §6.2 dan. Bitrix'da PROBABILITY bo'sh bo'lgani uchun
// win_probability bosqich pozitsiyasidan hisoblanadi — bu taxmin, UI'da shunday belgilanadi.
import { cached } from "./cache.mjs";
import * as rng from "./range.mjs";
import { dicts } from "./api.mjs";
import { tashkentNow, ymd } from "./bitrix.mjs";

const TTL = { heavy: 5 * 60e3, mid: 2 * 60e3 };
export const day = (d = 0) => { const t = tashkentNow(); t.setDate(t.getDate() - d); return `${ymd(t)}T00:00:00+05:00`; };
export const monthStart = () => { const t = tashkentNow(); return `${ymd(t).slice(0, 7)}-01T00:00:00+05:00`; };
const daysSince = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : 9999;

// Bosqich pozitsiyasidan ehtimollik: birinchi bosqich 10%, oxirgisi (WON oldidan) 85%.
function stageProbabilities(dictStages) {
  const map = {};
  for (const [cat, list] of Object.entries(dictStages)) {
    const open = list.filter((s) => !/:(WON|LOSE)$/.test(s.id) && !/^(WON|LOSE)$/.test(s.id));
    open.forEach((s, i) => {
      map[s.id] = open.length <= 1 ? 0.5 : +(0.10 + (0.75 * i) / (open.length - 1)).toFixed(3);
    });
    for (const s of list) if (/WON/.test(s.id)) map[s.id] = 1;
    for (const s of list) if (/LOSE/.test(s.id)) map[s.id] = 0;
  }
  return map;
}

// Deal Health — §6.2: engagement 25 + stage age 20 + stakeholder 20 + next step 20 + fit 15
function dealHealth(d, hasNextStep) {
  const eng = daysSince(d.LAST_ACTIVITY_TIME);
  const engScore = eng <= 7 ? 25 : eng <= 14 ? 19 : eng <= 30 ? 12 : eng <= 60 ? 5 : 0;
  const age = daysSince(d.MOVED_TIME || d.DATE_CREATE);
  const ageScore = age <= 14 ? 20 : age <= 30 ? 14 : age <= 60 ? 8 : age <= 120 ? 3 : 0;
  const stake = (d.CONTACT_ID && d.CONTACT_ID !== "0" ? 12 : 0) + (d.COMPANY_ID && d.COMPANY_ID !== "0" ? 8 : 0);
  const next = hasNextStep ? 20 : 0;
  const amt = Number(d.OPPORTUNITY || 0);
  const fit = (amt > 0 ? 10 : 0) + (d.CLOSEDATE ? 5 : 0);
  const total = engScore + ageScore + stake + next + fit;
  return {
    health: total,
    risk: 100 - total,
    parts: { engagement: engScore, stageAge: ageScore, stakeholder: stake, nextStep: next, fit },
    reasons: [
      eng > 30 && `${eng} kundan beri CRM yozuvi o‘zgarmagan`,
      age > 60 && `bosqichda ${age} kun qotib qolgan`,
      !stake && "biriktirilgan kontakt/kompaniya yo‘q",
      !hasNextStep && "keyingi qadam belgilanmagan",
      !amt && "summa kiritilmagan",
    ].filter(Boolean),
  };
}

// Ochiq bitimlar + rejalashtirilgan faoliyat — bir marta yig'ib, hamma hisob shundan.
export const base = (bx, range) => {
  const R = range ? rng.normalize(range, 30) : null;
  const win = R ? { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO } : {};
  return cached(`rev:base:${R ? R.key : "all"}`, TTL.heavy, async () => {
  const d = await dicts(bx);
  const prob = stageProbabilities(d.stages);
  const stageName = {};
  for (const list of Object.values(d.stages)) for (const s of list) stageName[s.id] = s.name;

  const [open, activities] = await Promise.all([
    bx.listAll("crm.deal.list", {
      filter: { CLOSED: "N", ...win },
      select: ["ID", "TITLE", "CATEGORY_ID", "STAGE_ID", "OPPORTUNITY", "CURRENCY_ID", "CLOSEDATE",
               "DATE_CREATE", "MOVED_TIME", "LAST_ACTIVITY_TIME", "CONTACT_ID", "COMPANY_ID", "ASSIGNED_BY_ID"],
      order: { OPPORTUNITY: "DESC" }, maxItems: 400,
    }),
    // Kelajakdagi bajarilmagan faoliyat = "keyingi qadam bor"
    bx.listAll("crm.activity.list", {
      filter: { OWNER_TYPE_ID: 2, COMPLETED: "N" },
      select: ["ID", "OWNER_ID", "SUBJECT", "DEADLINE"], maxItems: 500,
    }).catch(() => ({ items: [] })),
  ]);

  const nextStep = new Set((activities.items || []).map((a) => String(a.OWNER_ID)));
  const deals = open.items.map((dl) => {
    const p = prob[dl.STAGE_ID] ?? 0.3;
    const amount = Number(dl.OPPORTUNITY || 0);
    const h = dealHealth(dl, nextStep.has(String(dl.ID)));
    return {
      id: dl.ID, title: dl.TITLE || `Bitim #${dl.ID}`,
      category: d.categories.find((c) => c.id === String(dl.CATEGORY_ID))?.name || `#${dl.CATEGORY_ID}`,
      categoryId: String(dl.CATEGORY_ID),
      stage: stageName[dl.STAGE_ID] || dl.STAGE_ID, stageId: dl.STAGE_ID,
      amount, currency: dl.CURRENCY_ID || "UZS", probability: p,
      weighted: amount * p,
      closeDate: dl.CLOSEDATE, lastActivity: dl.LAST_ACTIVITY_TIME,
      idleDays: daysSince(dl.LAST_ACTIVITY_TIME), stageDays: daysSince(dl.MOVED_TIME || dl.DATE_CREATE),
      owner: dl.ASSIGNED_BY_ID, hasNextStep: nextStep.has(String(dl.ID)),
      // 1 yildan ortiq harakatsiz — eski voronkadagi o'lik yozuv, forecastni buzadi
      archive: daysSince(dl.LAST_ACTIVITY_TIME) > 365,
      ...h,
    };
  });
  return { deals, sampled: open.items.length, total: open.total, activitiesSampled: (activities.items || []).length };
  });
};

// ---------- §6.1 + §6.2 Revenue Command Center ----------
export const command = (bx, db, range) => {
  const R = rng.normalize(range, 30);
  return cached(`rev:command:${R.key}`, TTL.mid, async () => {
  const { deals, total, sampled } = await base(bx, R);
  const active = deals.filter((d) => !d.archive);
  const archived = deals.filter((d) => d.archive);
  const uzs = active.filter((d) => d.currency === "UZS");

  const [wonMonth, wonQtr] = await Promise.all([
    bx.listAll("crm.deal.list", {
      filter: { STAGE_SEMANTIC_ID: "S", ">=CLOSEDATE": monthStart() },
      select: ["ID", "OPPORTUNITY", "CURRENCY_ID", "CLOSEDATE"], maxItems: 5000,   // v2: 200 chegarasi olib tashlandi
    }),
    bx.listAll("crm.deal.list", {
      filter: { STAGE_SEMANTIC_ID: "S", ">=CLOSEDATE": day(89) },
      select: ["ID", "OPPORTUNITY", "CURRENCY_ID", "CLOSEDATE", "DATE_CREATE"], maxItems: 5000,
    }),
  ]);
  const sumUZS = (arr) => arr.filter((x) => (x.CURRENCY_ID || "UZS") === "UZS")
                            .reduce((a, x) => a + Number(x.OPPORTUNITY || 0), 0);

  const fact = sumUZS(wonMonth.items);
  // "Reja va sotuv sur'ati" grafigi: oy kunlari bo'yicha jamlanma sotuv (UZS, CLOSEDATE bo'yicha)
  const tn = tashkentNow(), tyd = ymd(tn);
  const dim = new Date(Number(tyd.slice(0, 4)), Number(tyd.slice(5, 7)), 0).getDate();
  const perDay = new Array(dim + 1).fill(0);
  for (const x of wonMonth.items) {
    if ((x.CURRENCY_ID || "UZS") !== "UZS") continue;
    const dd = Number(String(x.CLOSEDATE || "").slice(8, 10));
    if (dd >= 1 && dd <= dim) perDay[dd] += Number(x.OPPORTUNITY || 0);
  }
  const daily = []; let cum = 0;
  for (let dd = 1; dd <= dim; dd++) { cum += perDay[dd]; daily.push(cum); }
  const pace = { daysInMonth: dim, today: Number(tyd.slice(8, 10)), daily };
  const wonNoAmount = wonMonth.items.filter((x) => !Number(x.OPPORTUNITY || 0)).length;
  const plan = Number(db.prepare("SELECT value FROM settings WHERE key='plan_month'").get()?.value || 0);

  const weighted = uzs.reduce((a, d) => a + d.weighted, 0);
  const commit = uzs.filter((d) => d.probability >= 0.7).reduce((a, d) => a + d.amount, 0);
  const gap = plan - (fact + commit);
  const atRisk = uzs.filter((d) => d.risk >= 60).reduce((a, d) => a + d.weighted, 0);
  const openPipeline = uzs.reduce((a, d) => a + d.amount, 0);
  const remainingQuota = Math.max(0, plan - fact);
  const coverage = remainingQuota > 0 ? +(openPipeline / remainingQuota).toFixed(2) : null;

  // Velocity — §6.2: qualified × win rate × avg deal / avg cycle days
  const qualified = uzs.filter((d) => d.probability >= 0.3).length;
  const wonCount = wonQtr.items.length;
  const lostQ = await bx.count("crm.deal.list", { STAGE_SEMANTIC_ID: "F", ">=CLOSEDATE": day(89) });
  const winRate = (wonCount + lostQ) > 0 ? wonCount / (wonCount + lostQ) : 0;
  const avgDeal = wonCount ? sumUZS(wonQtr.items) / wonCount : 0;
  const cycles = wonQtr.items.filter((x) => x.DATE_CREATE && x.CLOSEDATE)
    .map((x) => (new Date(x.CLOSEDATE) - new Date(x.DATE_CREATE)) / 864e5).filter((n) => n > 0);
  const avgCycle = cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : 0;
  const velocity = avgCycle > 0 ? (qualified * winRate * avgDeal) / avgCycle : 0;

  // Kunlik snapshot — §6.3 "What changed?" uchun
  const today = ymd(tashkentNow());
  db.prepare(`INSERT INTO forecast_snapshots (date, plan, fact, weighted, commit_sum, gap, at_risk)
              VALUES (?,?,?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET
              plan=excluded.plan, fact=excluded.fact, weighted=excluded.weighted,
              commit_sum=excluded.commit_sum, gap=excluded.gap, at_risk=excluded.at_risk`)
    .run(today, plan, fact, weighted, commit, gap, atRisk);
  const prev = db.prepare("SELECT * FROM forecast_snapshots WHERE date < ? ORDER BY date DESC LIMIT 1").get(today);

  return {
    period: ymd(tashkentNow()).slice(0, 7),
    kpi: { plan, fact, weighted, commit, gap, atRisk },
    pace,
    extra: {
      coverage, velocity, winRate: +(winRate * 100).toFixed(1), avgDeal, avgCycle: Math.round(avgCycle),
      openPipeline, openDeals: total, sampled, wonThisMonth: wonMonth.items.length, wonNoAmount,
      activeDeals: active.length, archivedDeals: archived.length,
      archivedAmount: archived.filter((d) => d.currency === "UZS").reduce((a, d) => a + d.amount, 0),
    },
    notes: [
      wonNoAmount ? `Shu oy yopilgan ${wonMonth.items.length} bitimdan ${wonNoAmount} tasida summa kiritilmagan — Fakt past ko'rinadi.` : null,
      archived.length ? `${archived.length} ta bitim 1 yildan ortiq harakatsiz — forecastdan chiqarildi (arxiv).` : null,
      "Bitrix'da PROBABILITY maydoni bo'sh — ehtimollik bosqich pozitsiyasidan hisoblangan (taxmin).",
      (wonCount + lostQ) < 20 ? `Win rate ${wonCount}+${lostQ} bitimdan hisoblangan — statistik ishonch past.` : null,
    ].filter(Boolean),
    changed: prev ? {
      since: prev.date,
      weighted: weighted - prev.weighted, fact: fact - prev.fact,
      commit: commit - prev.commit_sum, atRisk: atRisk - prev.at_risk,
    } : null,
    planSet: plan > 0,
    // Har xil valyutalar aralashmasligi uchun — faqat UZS hisoblanadi
    currencyNote: active.length !== uzs.length
      ? `${active.length - uzs.length} ta faol bitim boshqa valyutada — UZS hisobiga kirmadi`
      : null,
  };
  });
};

// ---------- §6.1 Revenue Pulse: 14 kunlik forecast trend ----------
export const pulse = (db, range) => {
  const R = rng.normalize(range, 30);
  const rows = db.prepare(
    "SELECT * FROM forecast_snapshots WHERE date >= ? AND date <= ? ORDER BY date DESC LIMIT 400"
  ).all(R.from, R.to).reverse();
  return { range: { from: R.from, to: R.to, days: R.days, label: R.label },
           series: rows.map((r) => ({ date: r.date, weighted: r.weighted, fact: r.fact, plan: r.plan })) };
};

// ---------- §7.1 Bugungi missiyalar: qiymat × ehtimol × shoshilinchlik ----------
export const missions = (bx, owner = null, range) => {
  const R = rng.normalize(range, 30);
  return cached(`rev:missions:${owner || "all"}:${R.key}`, TTL.mid, async () => {
  const { deals } = await base(bx, R);
  const scored = deals
    .filter((d) => !d.archive && (!owner || String(d.owner) === String(owner)))
    .map((d) => {
    const closeIn = d.closeDate ? Math.ceil((new Date(d.closeDate) - Date.now()) / 864e5) : null;
    // shoshilinchlik: yaqin close date yoki uzoq turgan aloqasizlik
    const urgency = (closeIn !== null && closeIn <= 14 ? (closeIn < 0 ? 1 : 1 - closeIn / 14) : 0) * 0.6
                  + Math.min(1, d.idleDays / 45) * 0.4;
    const value = Math.log10(Math.max(1, d.amount)) / 9;
    const score = value * 0.4 + d.probability * 0.25 + urgency * 0.35;
    const priority = score >= 0.5 ? "P0" : score >= 0.35 ? "P1" : "P2";
    const action = d.idleDays > 30 ? "Qo‘ng‘iroq qiling — yozuvga 30 kundan beri tegilmagan"
      : !d.hasNextStep ? "Keyingi qadamni belgilang"
      : closeIn !== null && closeIn < 0 ? "Close date o‘tib ketgan — yangilang"
      : !d.amount ? "Bitim summasini kiriting"
      : "Bosqichni ilgari suring";
    return { ...d, score: +score.toFixed(3), priority, action, closeIn,
             why: d.reasons.slice(0, 2).join("; ") || "yuqori qiymat va ehtimollik" };
  }).sort((a, b) => b.score - a.score);
  return {
    rows: scored.slice(0, 7),
    totalConsidered: scored.length,
    archivedSkipped: deals.length - scored.length,
  };
  });
};

// ---------- §6.1 Deal Risk Radar ----------
export const radar = (bx, owner = null, range) => {
  const R = rng.normalize(range, 30);
  return cached(`rev:radar:${owner || "all"}:${R.key}`, TTL.mid, async () => {
  const all = (await base(bx, R)).deals;
  const deals = owner ? all.filter((d) => String(d.owner) === String(owner)) : all;
  const act = deals.filter((d) => !d.archive);
  const band = (d) => d.risk >= 60 ? "red" : d.risk >= 35 ? "amber" : "green";
  const buckets = { red: [], amber: [], green: [] };
  for (const d of act) buckets[band(d)].push(d);
  const top = (k) => buckets[k].sort((a, b) => b.amount - a.amount).slice(0, 8)
    .map((d) => ({ id: d.id, title: d.title, amount: d.amount, currency: d.currency,
                   stage: d.stage, category: d.category, risk: d.risk, health: d.health,
                   idleDays: d.idleDays, reasons: d.reasons }));
  // Nega qizil? Eng ko'p uchraydigan sabablarni sanaymiz — bu radar'ni signalga aylantiradi.
  const reasonCount = new Map();
  for (const d of act) for (const r of d.reasons) {
    const key = r.replace(/^\d+\s/, "").replace(/bosqichda \d+ kun/, "bosqichda uzoq");
    reasonCount.set(key, (reasonCount.get(key) || 0) + 1);
  }
  const topReasons = [...reasonCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([reason, n]) => ({ reason, n }));

  return {
    counts: { red: buckets.red.length, amber: buckets.amber.length, green: buckets.green.length },
    active: act.length, topReasons,
    sums: {
      red: buckets.red.filter(d=>d.currency==="UZS").reduce((a, d) => a + d.amount, 0),
      amber: buckets.amber.filter(d=>d.currency==="UZS").reduce((a, d) => a + d.amount, 0),
      green: buckets.green.filter(d=>d.currency==="UZS").reduce((a, d) => a + d.amount, 0),
    },
    red: top("red"), amber: top("amber"),
    archived: deals.length - act.length,
  };
  });
};

// ---------- §8.1 Deal Room ----------
export const dealRoom = (bx, id, owner = null) => cached(`rev:deal:${id}:${owner || "all"}`, TTL.mid, async () => {
  const { deals } = await base(bx);
  let d = deals.find((x) => String(x.id) === String(id));
  if (!d) {
    const r = await bx.call("crm.deal.get", { id }).catch(() => ({}));
    if (!r.result) { const e = new Error("Bitim topilmadi"); e.status = 404; throw e; }
    const raw = r.result;
    d = { id: raw.ID, title: raw.TITLE, amount: Number(raw.OPPORTUNITY || 0),
          currency: raw.CURRENCY_ID || "UZS", stage: raw.STAGE_ID, category: `#${raw.CATEGORY_ID}`,
          probability: 0, health: 0, risk: 0, reasons: [], idleDays: daysSince(raw.LAST_ACTIVITY_TIME),
          closeDate: raw.CLOSEDATE, owner: raw.ASSIGNED_BY_ID, parts: {} };
  }
  // Sotuvchi begona bitimni ocha olmasin. Tekshiruv Bitrix'dan olingan bitimga HAM
  // tegishli: ilgari faqat keshdagi 400 ochiq bitim tekshirilar, yopiq yoki undan
  // tashqaridagi bitim ID orqali ochilib va tahrirlanib ketardi.
  if (owner && String(d.owner) !== String(owner)) {
    const e = new Error("Bu bitim sizga biriktirilmagan"); e.status = 403; throw e;
  }
  const acts = await bx.listAll("crm.activity.list", {
    filter: { OWNER_TYPE_ID: 2, OWNER_ID: id },
    select: ["ID", "SUBJECT", "TYPE_ID", "COMPLETED", "CREATED", "DEADLINE", "DIRECTION"],
    order: { CREATED: "DESC" }, maxItems: 25,
  }).catch(() => ({ items: [] }));
  const TYPE = { 1: "Uchrashuv", 2: "Qo‘ng‘iroq", 3: "Vazifa", 4: "Xat", 6: "Xabar" };
  return {
    deal: d,
    timeline: (acts.items || []).map((a) => ({
      id: a.ID, subject: a.SUBJECT || "(mavzusiz)", type: TYPE[a.TYPE_ID] || `Tur ${a.TYPE_ID}`,
      done: a.COMPLETED === "Y", at: a.CREATED, deadline: a.DEADLINE,
    })),
  };
});
