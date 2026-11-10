// Barcha ma'lumot endpointlari. Har biri jonli Bitrix24'dan o'qiydi, natija keshlanadi.
import { cached } from "./cache.mjs";
import { tashkentNow, ymd } from "./bitrix.mjs";
import * as rng from "./range.mjs";
import * as dir from "./directory.mjs";
import { scoreLead, kalibrlash } from "./scoring.mjs";
import * as cstore from "./callstore.mjs";
import { leadOwn, isOp } from "./roles.mjs";

// Bitrixdagi yozuvga havola — paneldan to'g'ridan-to'g'ri ochish uchun.
const PORTAL = process.env.BITRIX_PORTAL || "http://127.0.0.1:8099";
// Skoring bilan bir xil maydonlar — lidni baholash uchun kerak.
const SF = {
  rev: process.env.BX_FIELD_REVENUE || "UF_CRM_SELECTBOX3",
  svc: process.env.BX_FIELD_SERVICE || "UF_CRM_SELECTBOX",
};
// Kesh muddati. Panel ochiq bo'limni har 45 soniyada o'zi yangilaydi, shuning uchun
// lid/bitim/xulosa qisqa turadi — Bitrixdagi o'zgarish ~20 soniyada ko'rinadi.
// "heavy" so'rovlar o'nlab Bitrix chaqiruvi qiladi (jamoa, manba, mijozlar) —
// ularni ham 20 soniyaga tushirish portal limitiga urardi, shuning uchun 2 daqiqa.
const TTL = { dict: 30 * 60e3, summary: 20e3, list: 20e3, heavy: 2 * 60e3 };
const dayStart = (daysAgo = 0) => {
  const t = tashkentNow(); t.setDate(t.getDate() - daysAgo);
  return `${ymd(t)}T00:00:00+05:00`;
};
const dayEnd = (daysAgo = 0) => {
  const t = tashkentNow(); t.setDate(t.getDate() - daysAgo);
  return `${ymd(t)}T23:59:59+05:00`;
};
// Bitrix portal vaqti (+03) -> Toshkent (+05) kuniga solamiz.
const tkDay = (iso) => {
  const d = new Date(iso);
  return ymd(new Date(d.getTime() + (d.getTimezoneOffset() + 300) * 60000));
};
// Javobda oraliqni ochiq ko'rsatamiz — panel qaysi davrni ko'rsatayotgani aniq bo'lsin.
const pub = (r) => ({ from: r.from, to: r.to, days: r.days, label: r.label, bucket: r.bucket });
// Uzoq oraliqda ko'proq yozuv kerak, lekin Bitrix'ni cho'ktirmaydigan darajada.
const cap = (r) => Math.min(4000, Math.max(1500, r.days * 40));

// ---------- lug'atlar ----------
export const dicts = (bx) => cached("dict:all", TTL.dict, async () => {
  const [cats, statuses, sources] = await Promise.all([
    bx.call("crm.dealcategory.list", {}),
    bx.call("crm.status.list", { filter: { ENTITY_ID: "STATUS" }, select: ["STATUS_ID", "NAME", "SORT"] }),
    bx.call("crm.status.list", { filter: { ENTITY_ID: "SOURCE" }, select: ["STATUS_ID", "NAME"] }),
  ]);
  const categories = (cats.result || []).map((c) => ({ id: String(c.ID), name: c.NAME }));
  // Bitrix "asosiy" voronkani (CATEGORY_ID=0) dealcategory.list qaytarmaydi — qo'lda qo'shamiz.
  if (!categories.some((c) => c.id === "0")) categories.unshift({ id: "0", name: "Asosiy voronka" });
  const stageLists = await Promise.all(
    categories.map((c) =>
      bx.call("crm.status.list", { filter: { ENTITY_ID: c.id === "0" ? "DEAL_STAGE" : `DEAL_STAGE_${c.id}` }, select: ["STATUS_ID", "NAME", "SORT"] })
        .then((r) => [c.id, (r.result || []).map((s) => ({ id: s.STATUS_ID, name: s.NAME, sort: Number(s.SORT || 0) }))
          .sort((a, b) => a.sort - b.sort)])
        .catch(() => [c.id, []])
    )
  );
  return {
    categories,
    stages: Object.fromEntries(stageLists),
    leadStatus: Object.fromEntries((statuses.result || []).map((s) => [s.STATUS_ID, s.NAME])),
    sources: Object.fromEntries((sources.result || []).map((s) => [s.STATUS_ID, s.NAME])),
  };
});

// ---------- kokpit ----------
export const summary = (bx, owner = null, range) => {
  const R = rng.normalize(range, 30);
  return cached(`summary:${owner || "all"}:${R.key}`, TTL.summary, async () => {
  const today = dayStart(0);
  const own = owner ? { ASSIGNED_BY_ID: owner } : {};   // bitimlar (operatorda "op:…" — hech narsa)
  const ownL = leadOwn(owner);                          // lidlar: sotuvchi — mas'ul, operator — «Оператор»
  const inRange = { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO };
  const L = (f) => bx.count("crm.lead.list", { ...f, ...ownL });
  const D = (f) => bx.count("crm.deal.list", { ...f, ...own });
  // Yutilgan bitimlar — summa uchun oxirgi 200 tasi. `total` esa haqiqiy sonni beradi.
  const wonList = (extra) => bx.listAll("crm.deal.list", {
    filter: { STAGE_SEMANTIC_ID: "S", ...own, ...extra },
    select: ["ID", "OPPORTUNITY", "CURRENCY_ID", "CLOSEDATE"],
    order: { CLOSEDATE: "DESC" }, maxItems: 200,
  });

  const [todayTotal, todayJunk, pTotal, pJunk, pArxiv, pConv, openDeals, won, wonP] = await Promise.all([
    L({ ">=DATE_CREATE": today }),
    L({ ">=DATE_CREATE": today, STATUS_SEMANTIC_ID: "F" }),
    L(inRange),
    L({ ...inRange, STATUS_SEMANTIC_ID: "F" }),
    L({ ...inRange, ARXIV: "Y" }),               // TZI P0-04: yaroqsizlarning nechtasi ARXIVdan
    L({ ...inRange, STATUS_SEMANTIC_ID: "S" }),
    D({ CLOSED: "N" }),
    wonList({}),
    wonList({ ">=CLOSEDATE": R.fromISO, "<=CLOSEDATE": R.toISO }),
  ]);

  const sumByCurrency = (items) => {
    const byCur = new Map();
    for (const d of items) {
      const amt = Number(d.OPPORTUNITY || 0);
      if (!amt) continue;
      const c = d.CURRENCY_ID || "UZS";
      byCur.set(c, (byCur.get(c) || 0) + amt);
    }
    return {
      byCurrency: [...byCur.entries()].map(([currency, sum]) => ({ currency, sum })).sort((a, b) => b.sum - a.sum),
      withAmount: items.filter((d) => Number(d.OPPORTUNITY || 0) > 0).length,
      sampled: items.length,
    };
  };

  // Tanlangan oraliq bo'yicha lid ko'rsatkichlari.
  // TZI P0-01: foizning MAXRAJI aniq bo'lsin. Maxraj 0 bo'lsa — null («—»), soxta 0% emas.
  // Lid semantikasi: "F" = yaroqsiz, "S" = bitimga aylangan. Ular bir-birini istisno qiladi,
  // shuning uchun bitimga aylangan lid har doim sifatli guruh ichida bo'ladi.
  const nisbat = (surat, maxraj, kasr = 2) =>
    maxraj > 0 ? +(surat / maxraj * 100).toFixed(kasr) : null;
  const pQuality = pTotal - pJunk;
  const period = {
    total: pTotal, junk: pJunk, converted: pConv, quality: pQuality,
    arxiv: pArxiv,                               // shundan Odoo'da arxivlangani
    arxivSiz: Math.max(0, pJunk - pArxiv),       // bosqich/sabab bo'yicha yo'qotilgani
    junkRate: nisbat(pJunk, pTotal, 1),
    convRate: nisbat(pConv, pTotal),               // jami liddan konversiya
    convRateQuality: nisbat(pConv, pQuality),      // sifatli liddan konversiya
    // Foizlarning surat/maxraji — UI va AI shu yerdan oladi, o'zi qayta hisoblamaydi.
    kasrlar: {
      junkRate: { surat: pJunk, maxraj: pTotal, izoh: "yaroqsiz / jami lid" },
      convRate: { surat: pConv, maxraj: pTotal, izoh: "bitimga aylangan / jami lid" },
      convRateQuality: { surat: pConv, maxraj: pQuality, izoh: "bitimga aylangan / sifatli lid" },
    },
  };

  return {
    range: pub(R),
    today: { total: todayTotal, junk: todayJunk, quality: todayTotal - todayJunk },
    period,
    days30: period,                       // eski nom — mavjud chaqiruvlar buzilmasin
    deals: { open: openDeals, won: won.total, wonInPeriod: wonP.total },
    money: sumByCurrency(won.items),      // butun tarix bo'yicha
    moneyPeriod: sumByCurrency(wonP.items),
    generatedAt: new Date().toISOString(),
  };
  });
};

// ---------- lid oqimi (kunlik) ----------
export const leadFlow = (bx, range) => {
  const R = rng.normalize(range, 14);
  return cached(`flow:${R.key}`, TTL.heavy, async () => {
  const { items, total } = await bx.listAll("crm.lead.list", {
    filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO },
    select: ["ID", "DATE_CREATE", "STATUS_SEMANTIC_ID"],
    order: { DATE_CREATE: "ASC" }, maxItems: cap(R),
  });
  const b = rng.buckets(R);
  const series = new Map(b.keys.map((k) => [k, { date: k, total: 0, quality: 0 }]));
  for (const l of items) {
    const row = series.get(b.at(tkDay(l.DATE_CREATE)));
    if (!row) continue;
    row.total++;
    if (l.STATUS_SEMANTIC_ID !== "F") row.quality++;
  }
  return { range: pub(R), days: R.days, bucket: R.bucket, series: [...series.values()],
           sampled: items.length, capped: items.length < total };
  });
};

// ---------- manba samaradorligi ----------
export const sources = (bx, range) => {
  const R = rng.normalize(range, 30);
  return cached(`sources:${R.key}`, TTL.heavy, async () => {
  const d = await dicts(bx);
  const { items, total } = await bx.listAll("crm.lead.list", {
    filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO },
    select: ["ID", "SOURCE_ID", "STATUS_SEMANTIC_ID"], maxItems: cap(R),
  });
  const agg = new Map();
  for (const l of items) {
    const id = l.SOURCE_ID || "OTHER";
    if (!agg.has(id)) agg.set(id, { id, name: d.sources[id] || id, total: 0, junk: 0, converted: 0 });
    const a = agg.get(id);
    a.total++;
    if (l.STATUS_SEMANTIC_ID === "F") a.junk++;
    if (l.STATUS_SEMANTIC_ID === "S") a.converted++;
  }
  const rows = [...agg.values()]
    .map((a) => ({ ...a, junkRate: a.total ? +(a.junk / a.total * 100).toFixed(1) : 0,
                        convRate: a.total ? +(a.converted / a.total * 100).toFixed(2) : 0 }))
    .sort((a, b) => b.total - a.total);
  return { range: pub(R), days: R.days, rows, sampled: items.length, capped: items.length < total };
  });
};

// ---------- lidlar ro'yxati ----------
// `status` — Bitrix'dagi aniq holat (STATUS_ID: IN_PROCESS, UC_...): xodim Bitrix'da qaysi
// ustunda ishlagan bo'lsa, shu yerda ham o'shani ko'ra olsin. `semantic` (P/S/F) bilan birga ishlaydi.
// `operator` — Odoo «Оператор (Авто танланади)» (sotuv rahbarining usuli: Tushgan Lead → operator filtri).
export const leads = (bx, { range, days, semantic = null, status = null, limit = 60, owner = null, operator = null } = {}) => {
  const R = rng.normalize(range ?? days, 1);
  return cached(`leads3:${R.key}:${semantic}:${status || ""}:${limit}:${owner || "all"}:${operator || ""}`, TTL.list, async () => {
    const d = await dicts(bx);
    const filter = { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO };
    if (semantic) filter.STATUS_SEMANTIC_ID = semantic;
    if (status) filter.STATUS_ID = status;
    Object.assign(filter, leadOwn(owner));   // sotuvchi — o'ziga biriktirilgan, operator — o'zi tanlangan lidlar
    if (operator && !filter.UF_CRM_OPERATOR) filter.UF_CRM_OPERATOR = operator;
    const { items, total } = await bx.listAll("crm.lead.list", {
      filter,
      select: ["ID", "TITLE", "NAME", "LAST_NAME", "COMPANY_TITLE", "SOURCE_ID", "STATUS_ID",
               "STATUS_SEMANTIC_ID", "DATE_CREATE", "ASSIGNED_BY_ID", "OPPORTUNITY",
                 "CURRENCY_ID", "PHONE", "UF_CRM_OPERATOR", "UF_CRM_OPERATOR_NAME", SF.rev, SF.svc],
      order: { DATE_CREATE: "DESC" }, maxItems: limit,
    });
    // Har lid o'lchangan model bo'yicha baholanadi (scoring.mjs) — sotuvchi qaysi
      // liddan boshlashini bilsin. Yosh ballga KIRMAYDI (survivorship bias).
      await kalibrlash(bx);   // SUN modeli tayyor bo'lsin (6 soat keshlanadi)
      const rows = items.map((l) => {
        const sc = scoreLead(l);
        return {
          id: l.ID,
          title: l.COMPANY_TITLE || [l.NAME, l.LAST_NAME].filter(Boolean).join(" ") || l.TITLE || `Lid #${l.ID}`,
          source: d.sources[l.SOURCE_ID] || l.SOURCE_ID || "—",
          sourceId: l.SOURCE_ID,
          status: d.leadStatus[l.STATUS_ID] || l.STATUS_ID,
          semantic: l.STATUS_SEMANTIC_ID,
          owner: String(l.ASSIGNED_BY_ID || ""),
          assignedTo: l.ASSIGNED_BY_ID,
          operator: l.UF_CRM_OPERATOR_NAME || "", operatorId: String(l.UF_CRM_OPERATOR || ""),
          createdAt: l.DATE_CREATE,
          ageDays: sc.ageDays, stale: sc.stale,
          score: sc.total, grade: sc.grade, isAuto: sc.isAuto,
          why: sc.reasons.slice(0, 2),
          amount: Number(l.OPPORTUNITY || 0),
          currency: l.CURRENCY_ID || "UZS",
          phone: (l.PHONE || [])[0]?.VALUE || null,
          url: `${PORTAL}/crm/lead/details/${l.ID}/`,
        };
      });
      // Mas'ul ismi — `user` scope yo'q bo'lsa `#654` ko'rinishida qoladi.
      const { rows: withNames, resolved } = await dir.decorate(bx, rows, "owner", "ownerName");
      // Holatlar kesimi — Bitrix'dagi lid ustunlari. Ro'yxat to'liq tortilgan bo'lsa
      // (limit yetgan), aniq; kesilgan bo'lsa null — taxminiy raqam ko'rsatilmaydi.
      let byStatus = null, byOperator = null;
      if (!status && items.length >= total) {
        const m = new Map();
        for (const l of items) m.set(l.STATUS_ID, (m.get(l.STATUS_ID) || 0) + 1);
        byStatus = [...m.entries()].map(([id, n]) => ({ id, name: d.leadStatus[id] || id, n }))
          .sort((a, b) => b.n - a.n);
      }
      // Operator kesimi — Odoo'da plitka + «Оператор» filtri bilan bir xil son (to'liq ro'yxatdan)
      if (!operator && items.length >= total) {
        const m = new Map();
        for (const l of items) { const k = String(l.UF_CRM_OPERATOR || ""); const o = m.get(k) || { id: k, name: l.UF_CRM_OPERATOR_NAME || "Operator tanlanmagan", n: 0 }; o.n++; m.set(k, o); }
        byOperator = [...m.values()].sort((a, b) => b.n - a.n);
      }
      return { range: pub(R), total, rows: withNames, namesResolved: resolved, byStatus, byOperator,
               capped: items.length < total };
  });
};

// ---------- Lid taqdiri (2026-09-24, egasi: «operator lidlari qayerga ketyapti — B2B ga o'tyaptimi, B2C gami») ----------
// Davrda yaratilgan «Tushgan Lead»lar: qanchasi managerga o'tdi, qaysi klient turiga (B2B/B2C/B2G …),
// qaysi managerga, hozir qaysi bosqichda, yutildi/yo'qotildi. Odoo'da lid va bitim bitta yozuv —
// shuning uchun bosqich va natija o'sha yozuvdan (adapter UF_CRM_DEAL_*), taxmin yo'q.
export const journey = (bx, { range, owner = null, operator = null } = {}) => {
  const R = rng.normalize(range, 30);
  return cached(`journey:${R.key}:${owner || "all"}:${operator || ""}`, TTL.list, async () => {
    const filter = { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO, ...leadOwn(owner) };
    if (operator && !filter.UF_CRM_OPERATOR) filter.UF_CRM_OPERATOR = operator;
    const { items, total } = await bx.listAll("crm.lead.list", {
      filter,
      select: ["ID", "TITLE", "NAME", "LAST_NAME", "COMPANY_TITLE", "STATUS_SEMANTIC_ID", "STATUS_DESCRIPTION", "DATE_CREATE",
               "UF_CRM_OPERATOR", "UF_CRM_OPERATOR_NAME", "UF_CRM_CLIENT_TYPE", "UF_CRM_DEAL_ID", "UF_CRM_DEAL_STAGE", "UF_CRM_DEAL_STATE",
               "UF_CRM_MANAGER", "UF_CRM_DEAL_MOVED", "UF_CRM_DEAL_CLOSED", "UF_CRM_CONVERTED_AT", "OPPORTUNITY", "UF_CRM_SALE_TOTAL", "UF_CRM_ODOO_URL"],
      order: { DATE_CREATE: "DESC" }, maxItems: 5000,
    });
    const conv = items.filter((x) => x.STATUS_SEMANTIC_ID === "S");
    const sana = (m, k, x) => { const o = m.get(k) || { name: k, n: 0, open: 0, won: 0, lost: 0, sum: 0 }; o.n++; o[x.UF_CRM_DEAL_STATE || "open"]++; if (x.UF_CRM_DEAL_STATE === "won") o.sum += Number(x.OPPORTUNITY || 0); m.set(k, o); };
    const byType = new Map(), byManager = new Map(), byStage = new Map();
    for (const x of conv) {
      sana(byType, x.UF_CRM_CLIENT_TYPE || "Belgilanmagan", x);
      sana(byManager, x.UF_CRM_MANAGER || "Biriktirilmagan", x);
      if ((x.UF_CRM_DEAL_STATE || "open") === "open") sana(byStage, x.UF_CRM_DEAL_STAGE || "Bosqichsiz", x);
    }
    const arr = (m) => [...m.values()].sort((a, b) => b.n - a.n);
    const st = (k) => conv.filter((x) => (x.UF_CRM_DEAL_STATE || "open") === k).length;
    return {
      range: pub(R), total, sampled: items.length,
      funnel: { total, open: items.filter((x) => x.STATUS_SEMANTIC_ID === "P").length, junk: items.filter((x) => x.STATUS_SEMANTIC_ID === "F").length,
                converted: conv.length, dealOpen: st("open"), won: st("won"), lost: st("lost") },
      byType: arr(byType), byManager: arr(byManager), byStage: arr(byStage),
      rows: conv.map((x) => ({
        id: x.ID, title: x.COMPANY_TITLE || [x.NAME, x.LAST_NAME].filter(Boolean).join(" ") || x.TITLE || `Lid #${x.ID}`,
        operator: x.UF_CRM_OPERATOR_NAME || "", clientType: x.UF_CRM_CLIENT_TYPE || "", manager: x.UF_CRM_MANAGER || "",
        stage: x.UF_CRM_DEAL_STAGE || "", state: x.UF_CRM_DEAL_STATE || "open", amount: Number(x.OPPORTUNITY || 0),
        createdAt: x.DATE_CREATE, convertedAt: x.UF_CRM_CONVERTED_AT || null, movedAt: x.UF_CRM_DEAL_MOVED || null,
        closedAt: x.UF_CRM_DEAL_CLOSED || null, url: x.UF_CRM_ODOO_URL || null,
      })).sort((a, b) => String(b.convertedAt || "").localeCompare(String(a.convertedAt || ""))),
      capped: items.length < total,
    };
  });
};

// ---------- Lid oynasi — panel ichida, Bitrix'ga chiqmasdan ----------
export const leadRoom = (bx, id, owner = null, db = null) => cached(`lead:${id}:${owner || "all"}`, TTL.list, async () => {
  const [r, d] = await Promise.all([bx.call("crm.lead.get", { id }).catch(() => ({})), dicts(bx), kalibrlash(bx)]);
  const l = r.result;
  if (!l) { const e = new Error("Lid topilmadi"); e.status = 404; throw e; }
  // Sotuvchi faqat o'ziga biriktirilgan lidni ko'radi
  // Operator — «Оператор (Авто танланади)» o'zi bo'lgan lid
  if (owner && (isOp(owner) ? String(l.UF_CRM_OPERATOR || "") !== owner.slice(3) : String(l.ASSIGNED_BY_ID) !== String(owner))) {
    const e = new Error("Bu lid sizga biriktirilmagan"); e.status = 403; throw e;
  }
  const sc = scoreLead(l);
  const [acts, deals, nm] = await Promise.all([
    bx.listAll("crm.activity.list", {
      filter: { OWNER_TYPE_ID: 1, OWNER_ID: id },
      select: ["ID", "SUBJECT", "TYPE_ID", "COMPLETED", "CREATED", "DEADLINE", "DIRECTION", "DESCRIPTION"],
      order: { CREATED: "DESC" }, maxItems: 30,
    }).catch(() => ({ items: [] })),
    bx.listAll("crm.deal.list", {
      filter: { LEAD_ID: id },
      select: ["ID", "TITLE", "STAGE_ID", "CATEGORY_ID", "OPPORTUNITY", "CURRENCY_ID", "CLOSED", "DATE_CREATE"],
      order: { DATE_CREATE: "DESC" }, maxItems: 20,
    }).catch(() => ({ items: [] })),
    dir.names(bx, [l.ASSIGNED_BY_ID]),
  ]);
  const TYPE = { 1: "Uchrashuv", 2: "Qo‘ng‘iroq", 3: "Vazifa", 4: "Xat", 6: "Xabar" };
  const stageName = (cat, st) => (d.stages[String(cat)] || []).find((s) => s.id === st)?.name || st;
  return {
    lead: {
      id: l.ID,
      title: l.COMPANY_TITLE || [l.NAME, l.LAST_NAME].filter(Boolean).join(" ") || l.TITLE || `Lid #${l.ID}`,
      rawTitle: l.TITLE, name: [l.NAME, l.LAST_NAME].filter(Boolean).join(" ") || null, company: l.COMPANY_TITLE || null,
      phones: (l.PHONE || []).map((p) => p.VALUE).filter(Boolean),
      emails: (l.EMAIL || []).map((p) => p.VALUE).filter(Boolean),
      source: d.sources[l.SOURCE_ID] || l.SOURCE_ID || "—", sourceDetail: l.SOURCE_DESCRIPTION || null,
      status: d.leadStatus[l.STATUS_ID] || l.STATUS_ID, semantic: l.STATUS_SEMANTIC_ID,
      owner: String(l.ASSIGNED_BY_ID || ""), ownerName: nm.names[String(l.ASSIGNED_BY_ID)] || `#${l.ASSIGNED_BY_ID}`,
      createdAt: l.DATE_CREATE, modifiedAt: l.DATE_MODIFY,
      amount: Number(l.OPPORTUNITY || 0), currency: l.CURRENCY_ID || "UZS",
      comments: l.COMMENTS || null, address: l.ADDRESS || null,
      contactId: l.CONTACT_ID || null, companyId: l.COMPANY_ID || null,
      ageDays: sc.ageDays, stale: sc.stale, score: sc.total, grade: sc.grade, isAuto: sc.isAuto, why: sc.reasons,
      operator: l.UF_CRM_OPERATOR_NAME || null, clientType: l.UF_CRM_CLIENT_TYPE || null,
      kv: Number(l.UF_CRM_KV || 0) || null, odooUrl: l.UF_CRM_ODOO_URL || null,
      // Lid taqdiri: managerga o'tgach nima bo'layotgani (Odoo'da lid va bitim — bitta yozuv)
      journey: l.UF_CRM_DEAL_ID ? {
        dealId: String(l.UF_CRM_DEAL_ID), convertedAt: l.UF_CRM_CONVERTED_AT || l.DATE_CLOSED || null,
        manager: l.UF_CRM_MANAGER || null, team: l.UF_CRM_TEAM || null, clientType: l.UF_CRM_CLIENT_TYPE || null,
        stage: l.UF_CRM_DEAL_STAGE || null, state: l.UF_CRM_DEAL_STATE || "open",
        movedAt: l.UF_CRM_DEAL_MOVED || null, closedAt: l.UF_CRM_DEAL_CLOSED || null,
        amount: Number(l.OPPORTUNITY || 0), saleTotal: Number(l.UF_CRM_SALE_TOTAL || 0),
      } : null,
    },
    timeline: (() => {
      const tl = (acts.items || []).map((a) => ({
        id: a.ID, typeId: Number(a.TYPE_ID), subject: a.SUBJECT || "(mavzusiz)", type: TYPE[a.TYPE_ID] || `Tur ${a.TYPE_ID}`,
        done: a.COMPLETED === "Y", at: a.CREATED, deadline: a.DEADLINE,
        direction: a.DIRECTION === "2" ? "chiquvchi" : a.DIRECTION === "1" ? "kiruvchi" : null,
        missed: /пропущен|missed/i.test(a.SUBJECT || ""),
        note: a.DESCRIPTION ? String(a.DESCRIPTION).replace(/<[^>]+>/g, "").slice(0, 300) : null,
        call: null,
      }));
      // Qo'ng'iroqlar uchun: transkript va AI tahlil (bazada bo'lsa) — mijoz bilan nima gaplashilgani shu yerda
      if (db) {
        const calls = tl.filter((t) => t.typeId === 2);
        const an = cstore.analysesFor(db, calls.map((t) => t.id));
        for (const t of calls) {
          const tr = cstore.getTranscript(db, t.id);
          const a = an.get(String(t.id)) || null;
          let j = null;
          if (a && a.status === "ready") {
            try { j = JSON.parse(db.prepare("SELECT json FROM call_analyses WHERE call_id=?").get(String(t.id))?.json || "null"); } catch {}
          }
          if (tr || a) t.call = {
            transcript: tr ? (tr.text || null) : null,
            analysis: a ? { status: a.status, score: a.score, risk: a.risk, topic: a.topic, error: a.error,
                            summary: j?.summary || null, next: j?.next_action || null } : null,
          };
        }
      }
      return tl;
    })(),
    deals: (deals.items || []).map((x) => ({
      id: x.ID, title: x.TITLE || `Bitim #${x.ID}`, stage: stageName(x.CATEGORY_ID, x.STAGE_ID),
      category: d.categories.find((c) => String(c.id) === String(x.CATEGORY_ID))?.name || `#${x.CATEGORY_ID}`,
      amount: Number(x.OPPORTUNITY || 0), currency: x.CURRENCY_ID || "UZS", closed: x.CLOSED === "Y", createdAt: x.DATE_CREATE,
    })),
  };
});

// ---------- pipeline / bitimlar ----------
// Bitim bo'limlarida sana oralig'i = "shu davrda ochilgan bitimlar".
export const pipelines = (bx, range) => {
  const R = rng.normalize(range, 30);
  return cached(`pipelines:${R.key}`, TTL.summary, async () => {
  const d = await dicts(bx);
  const win = { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO };
  // Ikkala son ham kerak: davrda ochilgani va umuman ochiq turgani. Faqat birinchisini
  // ko'rsatsak, qisqa davrda taxta bo'sh chiqadi va buzilgandek tuyuladi.
  const rows = await Promise.all(d.categories.map(async (c) => {
    const [open, openAll] = await Promise.all([
      bx.count("crm.deal.list", { CATEGORY_ID: c.id, CLOSED: "N", ...win }),
      bx.count("crm.deal.list", { CATEGORY_ID: c.id, CLOSED: "N" }),
    ]);
    return { id: c.id, name: c.name, open, openAll };
  }));
  return {
    range: pub(R),
    openAll: rows.reduce((a, r) => a + r.openAll, 0),
    openInRange: rows.reduce((a, r) => a + r.open, 0),
    rows: rows.filter((r) => r.open > 0).sort((a, b) => b.open - a.open),
    all: rows,
  };
  });
};

// Kanban — HOZIRGI HOLAT: Bitrix kanbani kabi barcha ochiq bitim, qachon ochilganidan
// qat'i nazar. Ilgari sana oralig'i (DATE_CREATE) va 366 kun chegarasi qo'llanardi — natijada
// 212 ochiq bitimdan 101 tasi (1 yildan eski) hech qaysi oraliqda ko'rinmasdi (2026-09-13 o'lchovi).
// `range` imzoda qoldi (chaqiruvchilar buzilmasin), lekin ishlatilmaydi.
export const kanban = (bx, categoryId = "0", owner = null, range) => {
  const R = rng.normalize(range, 30);
  return cached(`kanban3:${categoryId}:${owner || "all"}`, TTL.list, async () => {
  const d = await dicts(bx);
  const stages = (d.stages[categoryId] || []).filter((s) => !/:(WON|LOSE)$/.test(s.id));
  const { items, total } = await bx.listAll("crm.deal.list", {
    filter: { CATEGORY_ID: categoryId, CLOSED: "N",
              ...(owner ? { ASSIGNED_BY_ID: owner } : {}) },
    select: ["ID", "TITLE", "STAGE_ID", "OPPORTUNITY", "CURRENCY_ID", "DATE_CREATE", "ASSIGNED_BY_ID",
               "MOVED_TIME", "CONTACT_ID", "COMPANY_ID"],
    order: { DATE_CREATE: "DESC" }, maxItems: 3000,   // 2026-10-27: 1000 chegara 1254 bitimdan 254 tasini jim yashirardi
  });
  const byStage = new Map(stages.map((s) => [s.id, { id: s.id, name: s.name, count: 0, sums: {}, cards: [] }]));
  for (const dl of items) {
    const col = byStage.get(dl.STAGE_ID);
    if (!col) continue;
    col.count++;
    // Valyutalar aralash bo'lishi mumkin — hech qachon bir-biriga qo'shilmaydi.
    const cur = dl.CURRENCY_ID || "UZS";
    col.sums[cur] = (col.sums[cur] || 0) + Number(dl.OPPORTUNITY || 0);
    if (col.cards.length < 300) col.cards.push({
      id: dl.ID, title: dl.TITLE || `Bitim #${dl.ID}`,
      amount: Number(dl.OPPORTUNITY || 0), currency: cur, createdAt: dl.DATE_CREATE,
      // MUHIM: "yoshi" bitim ochilganidan emas, SHU BOSQICHDA qancha
      // turganidan hisoblanadi (MOVED_TIME) — harakat kerakligini shu ko'rsatadi.
      movedAt: dl.MOVED_TIME || null,
      stageDays: dl.MOVED_TIME
        ? Math.floor((Date.now() - new Date(dl.MOVED_TIME).getTime()) / 864e5) : null,
      owner: String(dl.ASSIGNED_BY_ID || ""),
      noClient: String(dl.CONTACT_ID || "0") === "0" && String(dl.COMPANY_ID || "0") === "0",
      url: `${PORTAL}/crm/deal/details/${dl.ID}/`,
    });
  }
  // decorate() NUSXA qaytaradi — kartaga yozilmaydi. Ismlar xaritasini
  // olib, har kartaga o'zimiz yozamiz.
  const allCards = [...byStage.values()].flatMap((c) => c.cards);
  const { names: nmap, resolved: nres } = await dir.names(bx, allCards.map((c) => c.owner));
  for (const c of allCards) c.ownerName = nmap[String(c.owner)] || `#${c.owner}`;
  return { range: pub(R), scope: "all-open", categoryId,
           category: d.categories.find((c) => c.id === categoryId)?.name || categoryId,
           total, listed: items.length,
           columns: [...byStage.values()], namesResolved: nres };
  });
};

// Bosqichda uzoq turib qolgan bitimlar.
export const stuck = (bx, minDays = 14, owner = null, range) => {
  const R = rng.normalize(range, 30);
  // Hozirgi holat: barcha ochiq bitim (sana oralig'isiz) — qotib qolgan eng eskisi aynan
  // oraliqdan tashqarida bo'ladi, filtr uni yashirardi.
  return cached(`stuck2:${minDays}:${owner || "all"}`, TTL.heavy, async () => {
  const d = await dicts(bx);
  const stageName = {};
  for (const [cid, list] of Object.entries(d.stages)) for (const s of list) stageName[s.id] = s.name;
  const { items } = await bx.listAll("crm.deal.list", {
    filter: { CLOSED: "N", ...(owner ? { ASSIGNED_BY_ID: owner } : {}) },
    select: ["ID", "TITLE", "STAGE_ID", "CATEGORY_ID", "MOVED_TIME", "DATE_CREATE", "OPPORTUNITY"],
    order: { MOVED_TIME: "ASC" }, maxItems: 1000,
  });
  const now = Date.now();
  return {
    rows: items.map((dl) => {
      const moved = new Date(dl.MOVED_TIME || dl.DATE_CREATE).getTime();
      return { id: dl.ID, title: dl.TITLE || `Bitim #${dl.ID}`,
               stage: stageName[dl.STAGE_ID] || dl.STAGE_ID,
               category: d.categories.find((c) => c.id === String(dl.CATEGORY_ID))?.name || dl.CATEGORY_ID,
               days: Math.floor((now - moved) / 86400000) };
    }).filter((r) => r.days >= minDays)
      .map((r) => ({ ...r, archive: r.days > 365 }))
      .sort((a, b) => (a.archive - b.archive) || (b.days - a.days)).slice(0, 60),
    range: pub(R), scope: "all-open",
  };
  });
};

// ---------- moliya ----------
// ---------- HISOB-FAKTURALAR va HAQIQIY TUSHUM (TZI P0-06, 2026-09-23) ----------
// Manba: Odoo account.move (adapter orqali). Yutilgan bitim summasi ≠ tushum —
// tushum faqat hisob-fakturaga BOG'LANGAN to'lovdan o'lchanadi (payment_state).
// Agar kompaniya to'lovni hisob-fakturaga bog'lamasa, «tushgan pul» O'LCHANMAYDI:
// bu holda soxta 0 emas, «o'lchab bo'lmaydi» deb aytamiz va sababini ko'rsatamiz.
export const invoices = (bx, range) => {
  const R = rng.normalize(range, 30);
  return cached(`inv:${R.key}`, TTL.summary, async () => {
    const { items } = await bx.listAll("crm.invoice.list", { filter: {}, select: ["*"], maxItems: 5000 })
      .catch(() => ({ items: [] }));
    const yil = (d) => String(d || "").slice(0, 10);
    const davr = items.filter((x) => yil(x.DATE) >= R.from && yil(x.DATE) <= R.to);
    const summa = (arr, k) => arr.reduce((a, x) => a + Number(x[k] || 0), 0);
    const holat = (arr) => arr.reduce((m, x) => { m[x.STATE || "?"] = (m[x.STATE || "?"] || 0) + 1; return m; }, {});
    const jamiH = holat(items);
    // To'lov umuman bog'lanadimi: birortasi paid/partial/in_payment bo'lsa — ha
    const bogliSon = (jamiH.paid || 0) + (jamiH.partial || 0) + (jamiH.in_payment || 0);
    const tolovBoglanadi = bogliSon > 0;
    const bugun = new Date().toISOString().slice(0, 10);
    const muddatiOtgan = items.filter((x) => x.STATE !== "paid" && x.DUE && x.DUE < bugun && Number(x.RESIDUAL) > 0);
    return {
      range: pub(R),
      jami: { son: items.length, summa: summa(items, "TOTAL") },
      davr: { son: davr.length, summa: summa(davr, "TOTAL"),
              tushgan: tolovBoglanadi ? summa(davr, "PAID") : null,
              qarz: tolovBoglanadi ? summa(davr, "RESIDUAL") : null },
      holatlar: jamiH,
      tolovBoglanadi, bogliSon,
      muddatiOtgan: tolovBoglanadi ? { son: muddatiOtgan.length, summa: summa(muddatiOtgan, "RESIDUAL") } : null,
      oxirgilar: items.slice().sort((a, b) => String(b.DATE).localeCompare(String(a.DATE))).slice(0, 8)
        .map((x) => ({ id: x.ID, nom: x.NAME, sana: yil(x.DATE), summa: Number(x.TOTAL), mijoz: x.PARTNER, holat: x.STATE })),
      izoh: tolovBoglanadi ? null
        : `Odoo'da ${items.length} ta hisob-faktura bor, lekin birortasiga ham to'lov bog'lanmagan `
          + `(hammasi «to'lanmagan» holatida). Shuning uchun haqiqiy tushgan pul va qarzdorlik O'LCHANMAYDI. `
          + `Moliya bo'limi to'lovni Odoo'da hisob-fakturaga bog'lasa, bu blok o'zi to'ladi.`,
    };
  });
};

export const finance = (bx, range) => {
  const R = rng.normalize(range, 30);
  return cached(`finance2:${R.key}`, TTL.summary, async () => {
  const d = await dicts(bx);
  // To'lov kutayotgan bosqichlar: nomida "оплат" bo'lgan yoki PREPAYMENT/FINAL_INVOICE kodli.
  const waitStages = [];
  for (const [cid, list] of Object.entries(d.stages)) {
    for (const s of list) {
      // Diqqat: bu portalda bosqich KODLARI qayta nomlangan (masalan C6:PREPAYMENT_INVOICE = "Пауза"),
      // shuning uchun faqat ko'rinadigan NOM bo'yicha aniqlaymiz.
      if (/оплат|оплач|to.?lov|avans|шартнома берилди|счёт|schyot|invoice/i.test(s.name)) {
        waitStages.push({ ...s, categoryId: cid,
          category: d.categories.find((c) => c.id === cid)?.name || cid });
      }
    }
  }
  // To'lov kutayotganlar — HOZIRGI HOLAT: bosqichda turgan har bir ochiq bitim, qachon
  // ochilganidan qat'i nazar (Bitrix'dagi 23 ta o'rniga 6 tasi ko'rinardi, 2026-09-13).
  const waiting = [];
  for (const st of waitStages) {
    const { items } = await bx.listAll("crm.deal.list", {
      filter: { STAGE_ID: st.id, CLOSED: "N" },
      select: ["ID", "TITLE", "OPPORTUNITY", "CURRENCY_ID", "MOVED_TIME"], maxItems: 300,
    });
    for (const dl of items) {
      const days = Math.floor((Date.now() - new Date(dl.MOVED_TIME || Date.now()).getTime()) / 86400000);
      waiting.push({
        id: dl.ID, title: dl.TITLE || `Bitim #${dl.ID}`, stage: st.name, category: st.category,
        amount: Number(dl.OPPORTUNITY || 0), currency: dl.CURRENCY_ID || "UZS",
        days, archive: days > 365,   // eski voronkadagi yillar davomida qotib qolgan yozuvlar
      });
    }
  }

  // Oylik yutilgan summa — tanlangan oraliqqa tushadigan oylar bo'yicha.
  const won = await bx.listAll("crm.deal.list", {
    filter: { STAGE_SEMANTIC_ID: "S", ">=CLOSEDATE": R.fromISO, "<=CLOSEDATE": R.toISO },
    select: ["ID", "OPPORTUNITY", "CLOSEDATE", "CURRENCY_ID"], order: { CLOSEDATE: "ASC" }, maxItems: 500,
  });
  const months = new Map();
  for (const k of rng.eachMonth(R)) months.set(k, { month: k, sum: 0, count: 0, currencies: {} });
  for (const dl of won.items) {
    const k = (dl.CLOSEDATE || "").slice(0, 7);
    const m = months.get(k);
    if (!m) continue;
    const amt = Number(dl.OPPORTUNITY || 0), cur = dl.CURRENCY_ID || "UZS";
    m.count++;
    m.currencies[cur] = (m.currencies[cur] || 0) + amt;
    if (cur === "UZS") m.sum += amt;   // grafik faqat UZS'ni chizadi, boshqasi alohida ko'rsatiladi
  }
  waiting.sort((a, b) => (a.archive - b.archive) || (b.days - a.days));
  const monthly = [...months.values()];
  return {
    waiting,
    waitingScope: "all-open",
    waitingCount: waiting.length,
    waitingActive: waiting.filter((w) => !w.archive).length,
    waitingArchive: waiting.filter((w) => w.archive).length,
    monthly,
    // Summasi kiritilmagan yutilgan bitimlar bor — grafikni to'g'ri o'qish uchun kerak.
    monthsWithMissingAmount: monthly.filter((m) => m.count > 0 && m.sum === 0).map((m) => m.month),
    range: pub(R),
  };
  });
};

// ---------- mijozlar (Сопровождение) ----------
// Sana oralig'i bu yerda "kuzatuv oynasi": shu davrda mijoz bilan aloqa bo'lganmi?
// Kunlar oraliq oxiridan sanaladi — o'tgan oyni ochganda "35 kun" o'sha oy oxiriga nisbatan bo'ladi.
export const clients = (bx, owner = null, range) => {
  const R = rng.normalize(range, 30);
  return cached(`clients:${owner || "all"}:${R.key}`, TTL.heavy, async () => {
  const d = await dicts(bx);
  const cat = d.categories.find((c) => /сопровожд/i.test(c.name)) || d.categories[0];
  const stageName = Object.fromEntries((d.stages[cat.id] || []).map((s) => [s.id, s.name]));
  const { items, total } = await bx.listAll("crm.deal.list", {
    // Oraliq tugagandan keyin ochilgan bitimlar o'sha davrda hali mavjud emas edi.
    filter: { CATEGORY_ID: cat.id, CLOSED: "N", "<=DATE_CREATE": R.toISO,
              ...(owner ? { ASSIGNED_BY_ID: owner } : {}) },
    select: ["ID", "TITLE", "STAGE_ID", "OPPORTUNITY", "CURRENCY_ID", "ASSIGNED_BY_ID", "LAST_ACTIVITY_TIME", "DATE_CREATE"],
    order: { LAST_ACTIVITY_TIME: "ASC" }, maxItems: 200,
  });
  const ref = Math.min(new Date(R.toISO).getTime(), Date.now());
  const fromMs = new Date(R.fromISO).getTime();

  const rows = items.map((dl) => {
    const lastIso = dl.LAST_ACTIVITY_TIME || dl.DATE_CREATE;
    const last = new Date(lastIso).getTime();
    const days = Math.max(0, Math.floor((ref - last) / 86400000));
    // Bir yildan ortiq qimirlamagan yozuv — bu "sovigan mijoz" emas, tashlab ketilgan yozuv.
    // Ikkalasini aralashtirsak, ro'yxat butunlay qizil bo'lib qoladi va ish uchun yaroqsiz.
    const archive = days > 365;
    return {
      id: dl.ID, title: dl.TITLE || `Bitim #${dl.ID}`,
      stage: stageName[dl.STAGE_ID] || dl.STAGE_ID,
      days, archive, lastAt: lastIso,
      inWindow: last >= fromMs && last <= ref,
      risk: archive ? "archive" : days >= 30 ? "crit" : days >= 14 ? "warn" : "ok",
      // Umumiy ko'rinish (aloqa xaritasi) uchun: summa, mas'ul, Bitrix havolasi
      amount: Number(dl.OPPORTUNITY || 0), currency: dl.CURRENCY_ID || "UZS",
      owner: String(dl.ASSIGNED_BY_ID || ""), url: `${PORTAL}/crm/deal/details/${dl.ID}/`,
    };
  }).sort((a, b) => (a.archive - b.archive) || (b.days - a.days));
  const { rows: named } = await dir.decorate(bx, rows, "owner", "ownerName");

  return {
    category: cat.name, total, range: pub(R),
    counted: rows.length,
    inWindow: rows.filter((r) => r.inWindow).length,
    silent: rows.filter((r) => !r.inWindow).length,
    archive: rows.filter((r) => r.archive).length,
    rows: named,
  };
  });
};

// ---------- jamoa (mas'ullar kesimida) ----------
export const team = (bx, range) => {
  const R = rng.normalize(range, 30);
  return cached(`team:${R.key}`, TTL.heavy, async () => {
  const { items } = await bx.listAll("crm.lead.list", {
    filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO },
    select: ["ID", "ASSIGNED_BY_ID", "STATUS_SEMANTIC_ID"], maxItems: cap(R),
  });
  const agg = new Map();
  for (const l of items) {
    const id = String(l.ASSIGNED_BY_ID || "0");
    if (!agg.has(id)) agg.set(id, { userId: id, leads: 0, junk: 0, converted: 0 });
    const a = agg.get(id);
    a.leads++;
    if (l.STATUS_SEMANTIC_ID === "F") a.junk++;
    if (l.STATUS_SEMANTIC_ID === "S") a.converted++;
  }
  const deals = await bx.listAll("crm.deal.list", {
    filter: { CLOSED: "N" }, select: ["ID", "ASSIGNED_BY_ID"], maxItems: 400,
  });
  for (const dl of deals.items) {
    const id = String(dl.ASSIGNED_BY_ID || "0");
    if (!agg.has(id)) agg.set(id, { userId: id, leads: 0, junk: 0, converted: 0 });
    agg.get(id).openDeals = (agg.get(id).openDeals || 0) + 1;
  }
  const list = [...agg.values()].map((a) => ({
    ...a, openDeals: a.openDeals || 0,
    junkRate: a.leads ? +(a.junk / a.leads * 100).toFixed(1) : 0,
  })).sort((a, b) => b.leads - a.leads).slice(0, 12);
  // `user` scope qo'shilsa ismlar o'zi chiqadi; bo'lmasa "#44" ko'rinishida qoladi.
  const { rows: named, resolved } = await dir.decorate(bx, list, "userId", "name");
  return {
    range: pub(R),
    days: R.days,
    rows: named,
    namesResolved: resolved,
    note: resolved
      ? "Ismlar Bitrix'dan olindi."
      : "Bitrix webhook'da `user` ruxsati yo'q — ism o'rniga ID ko'rsatilgan. Ruxsat qo'shilsa ismlar o'zi chiqadi.",
  };
  });
};
