// =============================================================================
// explain.mjs — "Bu raqam qanday chiqdi?" — KPI kartochkasi uchun tushuntirish.
// Har metrika kartochka ishlatgan AYNI funksiya/filtrni takrorlaydi (revenue.command,
// revenue.radar, api.summary) va raqam ortidagi yozuvlarni, formulani, davrni,
// manbani va yangilik vaqtini qaytaradi. Hech narsa yozmaydi.
// =============================================================================
import * as rng from "./range.mjs";
import * as rev from "./revenue.mjs";
import * as api from "./api.mjs";
import * as sla from "./sla.mjs";
import * as renewal from "./renewal.mjs";
import { tashkentNow, ymd } from "./bitrix.mjs";
import { leadOwn } from "./roles.mjs";

const money = (n) => Math.round(Number(n) || 0);
const SEM = { S: "yutilgan", F: "yutqazilgan", P: "jarayonda" };
// TZI P0-01: foiz har doim surat/maxraj bilan ko'rsatiladi; maxraj 0 bo'lsa «—».
const pf = (qiymat, surat, maxraj) =>
  qiymat === null || qiymat === undefined || !(maxraj > 0)
    ? `— (maxraj 0 — hisoblab bo'lmaydi)`
    : `${qiymat}%  (${surat} ÷ ${maxraj})`;

// ---------- Lidlar / Javob tezligi / Qayta sotuv kartalari uchun (2026-09-23) ----------
// Oynada ko'rsatiladigan qatorlar chegarasi (JSON hajmi uchun). Jami son har doim alohida aytiladi.
const RO_MAX = 1000;
const LSEM = { S: "managerga o'tgan", F: "yaroqsiz", P: "jarayonda" };
const AUTO_RE = /пропущенн|не ответил|исходящ|входящ|обратный звонок|javobsiz/i;   // sla.mjs bilan bir xil
const ulush = (a, b, k = 1) => (b > 0 ? +(a / b * 100).toFixed(k) : null);
const median = (arr) => { const a = arr.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
const sanaq = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); m.set(k, (m.get(k) || 0) + 1); } return m; };
const topN = (m, n = 5) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ");
const kunFarq = (a, b) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 864e5);

// Davrdagi lidlar — kartadagi son bilan AYNI filtr (api.summary: DATE_CREATE oralig'i + mas'ul)
const davrLidlari = (bx, R, owner) => bx.listAll("crm.lead.list", {
  filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO, ...leadOwn(owner) },
  select: ["ID", "TITLE", "STATUS_ID", "STATUS_DESCRIPTION", "STATUS_SEMANTIC_ID", "ARXIV", "SOURCE_ID", "SOURCE_DESCRIPTION",
           "ASSIGNED_BY_ID", "DATE_CREATE", "DATE_CLOSED", "UF_CRM_ODOO_URL", "UF_CRM_LOST_REASON", "UF_CRM_OPERATOR_NAME", "UF_CRM_KV"],
  order: { DATE_CREATE: "DESC" }, maxItems: 5000,
});

// Manba: BITRIX_WEBHOOK_URL qayerga qaraydi — demo CRM, Odoo adapteri yoki Bitrix24
async function sourceInfo() {
  const url = String(process.env.BITRIX_WEBHOOK_URL || "");
  const portal = String(process.env.BITRIX_PORTAL || "");
  const out = { kind: "bitrix", label: "Bitrix24 CRM", portal, freshAt: null, note: "CRM'dan bevosita, panel keshi 2 daqiqa" };
  if (/:8099\//.test(url)) return { ...out, kind: "demo", label: "Demo CRM (namuna ma'lumot)", note: "Bu raqamlar namuna — haqiqiy CRM ulanmagan. Panel keshi 2 daqiqa." };
  if (/:8098\//.test(url)) {
    let h = null;
    try { const r = await fetch(url.replace(/\/rest\/.*$/, "/healthz"), { signal: AbortSignal.timeout(2500) }); h = await r.json(); } catch {}
    return { ...out, kind: "odoo", label: "Odoo CRM (getgreen.biznesim.uz)", freshAt: h?.at || null, counts: h?.counts || null,
             note: h?.at ? `Odoo snapshot ${new Date(h.at).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })} · har 10 daqiqada yangilanadi · panel keshi 2 daqiqa` : "Odoo adapteri javob bermadi — oxirgi keshdagi raqam" };
  }
  return out;
}

async function userMap(bx) {
  try { const r = await bx.call("user.get", {}); const m = {}; for (const u of r.result || []) m[String(u.ID)] = `${u.NAME || ""} ${u.LAST_NAME || ""}`.trim(); return m; }
  catch { return {}; }
}
const who = (m, id) => (id && id !== "0" ? (m[String(id)] ? `${m[String(id)]} (#${id})` : `#${id}`) : "biriktirilmagan");
const dealUrl = (d) => d.UF_CRM_ODOO_URL || (process.env.BITRIX_PORTAL ? `${process.env.BITRIX_PORTAL.replace(/\/$/, "")}/crm/deal/details/${d.ID}/` : null);

export async function explain(bx, db, metric, { owner = null, range, days = 30 } = {}) {
  const R = rng.normalize(range, days);
  const src = await sourceInfo();
  const users = await userMap(bx);
  const period = { from: R.from, to: R.to, days: R.days, label: R.label };
  const base = { metric, period, source: src, generatedAt: new Date().toISOString() };

  if (metric === "plan") {
    const plan = Number(db.prepare("SELECT value FROM settings WHERE key='plan_month'").get()?.value || 0);
    const c = await rev.command(bx, db, R);
    return { ...base, title: "Oylik reja", value: plan, unit: "so'm",
      formula: ["Reja — CRM'dan emas, paneldagi «Reja» tugmasi orqali rahbar kiritgan raqam (sozlamalar: plan_month).",
                "Bajarilish % = Sotuv (shu oy, yutilgan, UZS) ÷ Reja.",
                "Prognoz bilan % = (Sotuv + vaznli prognoz) ÷ Reja."],
      filter: { manba: "panel sozlamalari", oy: c.period },
      count: plan ? 1 : 0, rows: [],
      facts: [["Reja", plan], ["Sotuv (shu oy)", money(c.kpi.fact)], ["Vaznli prognoz", money(c.kpi.weighted)], ["Bajarilish", plan ? `${(c.kpi.fact / plan * 100).toFixed(1)}%` : "—"]],
      notes: [plan ? null : "Reja kiritilmagan — foiz va gap hisoblanmaydi. «Reja» tugmasi orqali kiriting."].filter(Boolean) };
  }

  if (metric === "fact") {
    const c = await rev.command(bx, db, R);
    const ms = rev.monthStart();
    const won = await bx.listAll("crm.deal.list", { filter: { STAGE_SEMANTIC_ID: "S", ">=CLOSEDATE": ms },
      select: ["ID", "TITLE", "OPPORTUNITY", "CURRENCY_ID", "CLOSEDATE", "ASSIGNED_BY_ID", "STAGE_ID", "CATEGORY_ID", "UF_CRM_ODOO_URL"], order: { CLOSEDATE: "DESC" }, maxItems: 200 });
    const rows = won.items.map((d) => ({ id: d.ID, title: d.TITLE, amount: money(d.OPPORTUNITY), currency: d.CURRENCY_ID || "UZS", date: String(d.CLOSEDATE || "").slice(0, 10), owner: who(users, d.ASSIGNED_BY_ID), stage: d.STAGE_ID, url: dealUrl(d), inSum: (d.CURRENCY_ID || "UZS") === "UZS" }));
    const other = rows.filter((r) => !r.inSum);
    return { ...base, title: `Sotuv · ${c.period}`, value: money(c.kpi.fact), unit: "so'm",
      formula: [`Σ OPPORTUNITY (bitim summasi) — faqat UZS valyutasida, bosqichi «yutilgan» (STAGE_SEMANTIC_ID = S) va yopilish sanasi ≥ ${ms.slice(0, 10)} (oy boshi).`,
                "Yopilish sanasi (CLOSEDATE) bo'yicha, yaratilish sanasi emas — o'tgan oyda ochilib bu oy yopilgan bitim shu oyga kiradi.",
                "DIQQAT (TZI P0-06): bu SOTUV summasi, HAQIQIY TUSHUM emas. Kassaga tushgan pul, avans, qisman to'lov va qaytarish panelga ulanmagan — CRM'da to'lov jurnali yo'q.",
                src.kind === "odoo" ? "Odoo'da: tasdiqlangan sale.order (state = sale, SUN jamoalari) + «Аванс тушди» bosqichidagi imkoniyatlar." : null].filter(Boolean),
      filter: { holat: "yutilgan (S)", "yopilish sanasi": `${ms.slice(0, 10)} — ${ymd(tashkentNow())}`, valyuta: "UZS (boshqalari sanalmaydi)" },
      count: rows.length, sum: money(c.kpi.fact), rows: rows.slice(0, 25),
      facts: [["Yutilgan bitimlar (oy)", rows.length], ["Summasi kiritilmaganlar", c.extra.wonNoAmount], ["Boshqa valyutada", other.length]],
      notes: [c.extra.wonNoAmount ? `${c.extra.wonNoAmount} ta yutilgan bitimda summa 0 — Sotuv past ko'rinadi.` : null,
              other.length ? `${other.length} ta bitim ${[...new Set(other.map((o) => o.currency))].join(", ")} valyutasida — UZS yig'indisiga kirmadi.` : null,
              won.items.length >= 200 ? "200 tadan ko'p — namuna cheklangan." : null].filter(Boolean) };
  }

  if (metric === "forecast") {
    const c = await rev.command(bx, db, R);
    const { deals } = await rev.base(bx, R);
    const act = deals.filter((d) => !d.archive && d.currency === "UZS").sort((a, b) => b.weighted - a.weighted);
    const rows = act.slice(0, 25).map((d) => ({ id: d.id, title: d.title, amount: money(d.amount), currency: d.currency, date: String(d.closeDate || "").slice(0, 10), owner: who(users, d.owner), stage: d.stage, prob: Math.round(d.probability * 100), weighted: money(d.weighted), url: null }));
    return { ...base, title: "Oy yakuni prognozi", value: money(c.kpi.fact + c.kpi.weighted), unit: "so'm",
      formula: [`Prognoz = Sotuv (shu oy, ${money(c.kpi.fact).toLocaleString("ru-RU")}) + Vaznli prognoz (${money(c.kpi.weighted).toLocaleString("ru-RU")}).`,
                `Vaznli prognoz = Σ (bitim summasi × ehtimollik) — ${period.label} oralig'ida ochilgan, yopilmagan, UZS, 1 yildan ortiq harakatsiz bo'lmagan bitimlar.`,
                "Ehtimollik CRM'da kiritilmagan — bosqich o'rnidan taxmin qilinadi: birinchi ochiq bosqich 10%, oxirgisi 85%, oraliq — chiziqli; yutilgan 100%, yutqazilgan 0%."],
      filter: { "ochilgan": period.label, holat: "ochiq (CLOSED = N)", valyuta: "UZS", arxiv: "365+ kun harakatsizlar chiqarilgan" },
      count: act.length, sum: money(c.kpi.weighted), rows,
      facts: [["Sotuv (fakt)", money(c.kpi.fact)], ["Vaznli prognoz", money(c.kpi.weighted)], ["Hisobga olingan bitimlar", act.length], ["Arxivga chiqarilgan", c.extra.archivedDeals]],
      notes: ["Bu TAXMIN — ehtimollik bosqichdan olingan, sotuvchi bahosi emas.", c.currencyNote, ...(c.notes || [])].filter(Boolean) };
  }

  if (metric === "pipeline") {
    const c = await rev.command(bx, db, R);
    const { deals } = await rev.base(bx, R);
    const act = deals.filter((d) => !d.archive && d.currency === "UZS").sort((a, b) => b.amount - a.amount);
    const rows = act.slice(0, 25).map((d) => ({ id: d.id, title: d.title, amount: money(d.amount), currency: d.currency, date: String(d.closeDate || "").slice(0, 10), owner: who(users, d.owner), stage: d.stage, idle: d.idleDays, url: null }));
    const noAmt = act.filter((d) => !d.amount).length;
    return { ...base, title: "Faol ochiq summa", value: money(c.extra.openPipeline), unit: "so'm",
      formula: ["Σ OPPORTUNITY — yopilmagan (CLOSED = N), UZS valyutasidagi, 1 yildan ortiq harakatsiz bo'lmagan bitimlar.",
                `Oraliq: ${period.label} ichida ochilgan bitimlar (DATE_CREATE bo'yicha), eng katta 400 tasi.`],
      filter: { "ochilgan": period.label, holat: "ochiq", valyuta: "UZS", arxiv: "365+ kun harakatsizlar chiqarilgan" },
      count: act.length, sum: money(c.extra.openPipeline), rows,
      facts: [["Faol bitimlar", act.length], ["Summasi 0 bo'lganlar", noAmt], ["Arxiv (365+ kun)", c.extra.archivedDeals], ["Jami ochiq (CRM)", c.extra.openDeals]],
      notes: [noAmt ? `${noAmt} ta faol bitimda summa yo'q — yig'indi to'liq emas.` : null, c.currencyNote].filter(Boolean) };
  }

  // ---------- «Mening ish stolim» kartalari (2026-09-23) ----------
  // Ish stoli ro'yxati har doim eng yuqori ballli 7 ta bitimni ko'rsatadi (rev.missions).
  // Shuning uchun «7 ta» — jami ochiq bitim emas, ENG MUHIM 7 tasi; summa ham shu 7 tasiniki.
  if (metric === "missions" || metric === "missions_sum") {
    const m = await rev.missions(bx, owner, R);
    const rows = (m.rows || []).map((d) => ({ id: d.id, title: d.title, amount: money(d.amount), currency: d.currency,
      priority: d.priority, action: d.action, owner: who(users, d.owner),
      idle: d.idleDays, closeIn: d.closeIn, url: null }));
    const jamiSumma = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
    const p0 = rows.filter((r) => r.priority === "P0").length, p1 = rows.filter((r) => r.priority === "P1").length;
    const summasiz = rows.filter((r) => !Number(r.amount)).length;
    let hammaOchiq = null;
    try { const c = await rev.command(bx, db, R); hammaOchiq = money(c.extra?.openPipeline || 0); } catch {}
    const formula = [
      "Har bir faol ochiq bitimga ball beriladi: qiymat × 0,40 + ehtimollik × 0,25 + shoshilinchlik × 0,35.",
      "Qiymat = log10(summa) ÷ 9. Shoshilinchlik = yopilish sanasi 14 kun ichida bo'lsa (o'tib ketgan bo'lsa 1) × 0,6 + aloqasizlik kuni ÷ 45 × 0,4.",
      "Muhimlik: ball ≥ 0,50 — P0 (shoshilinch), ≥ 0,35 — P1, qolgani P2.",
      `Ro'yxatga ENG YUQORI ballli 7 ta bitim olinadi — jami ${m.totalConsidered} ta faol ochiq bitim ko'rib chiqildi.`,
      "Keyingi qadam: 30+ kun tegilmagan → qo'ng'iroq; qadam yo'q → belgilash; yopilish sanasi o'tgan → yangilash; summa yo'q → kiritish.",
    ];
    const filter = { holat: "faol ochiq bitimlar (arxivsiz)", tanlov: "eng yuqori ballli 7 tasi", mas_ul: owner ? who(users, owner) : "hammasi" };
    const facts = [["Vazifa (ko'rsatilgan)", rows.length], ["Shoshilinch (P0)", p0], ["O'rta (P1)", p1],
                   ["Ko'rib chiqilgan ochiq bitim", m.totalConsidered], ["Arxiv (chiqarildi)", m.archivedSkipped]];
    if (metric === "missions") return { ...base, title: "Bugungi vazifalar", value: rows.length, unit: "ta",
      formula, filter, count: m.totalConsidered, rows, facts,
      notes: [`Bu ${m.totalConsidered} ta ochiq bitimning eng muhim 7 tasi. Qolganlari ro'yxatga kirmagan, lekin CRM'da bor.`,
              p0 ? `${p0} tasi shoshilinch (P0) — avval shulardan boshlang.` : null].filter(Boolean) };
    return { ...base, title: "Vazifalardagi summa", value: jamiSumma, unit: "so'm",
      formula: [`Shu 7 ta vazifadagi bitimlarning summasi yig'indisi (UZS). BARCHA ochiq bitimlar summasi emas.`, ...formula],
      filter, count: rows.length, sum: jamiSumma, rows,
      facts: [["7 ta vazifa summasi", jamiSumma], ...(hammaOchiq !== null ? [["Barcha ochiq bitimlar summasi", hammaOchiq]] : []),
              ["Summasi kiritilmagan vazifa", summasiz], ["Ko'rib chiqilgan ochiq bitim", m.totalConsidered]],
      notes: [hammaOchiq ? `Taqqoslash uchun: barcha ochiq bitimlar ${hammaOchiq.toLocaleString("ru-RU")} so'm; ish stolidagi 7 tasi uning ${Math.round(jamiSumma / hammaOchiq * 100)}% i.` : null,
              summasiz ? `${summasiz} ta vazifada summa yo'q — ular yig'indiga 0 bo'lib qo'shildi; CRM'da summani to'ldiring.` : null].filter(Boolean) };
  }

  if (metric === "risk") {
    const r = await rev.radar(bx, owner, R);
    const rows = r.red.map((d) => ({ id: d.id, title: d.title, amount: money(d.amount), currency: d.currency, stage: d.stage, risk: d.risk, idle: d.idleDays, reasons: d.reasons, url: null }));
    return { ...base, title: "Xavf ostida", value: r.counts.red, unit: "bitim",
      formula: ["Har faol ochiq bitimga 0–100 «salomatlik» balli beriladi; xavf = 100 − salomatlik. Xavf ≥ 60 — qizil zona.",
                "Salomatlik: oxirgi aloqa (≤7 kun 25 ball … >60 kun 0) + bosqichda turgan muddat (≤14 kun 20 … >120 kun 0) + kontakt/kompaniya biriktirilgani (12+8) + keyingi qadam bor (20) + summa va yopilish sanasi kiritilgan (10+5).",
                `Oraliq: ${period.label} ichida ochilgan, yopilmagan bitimlar; 365+ kun harakatsizlar arxiv.`],
      filter: { "ochilgan": period.label, zona: "qizil (xavf ≥ 60)", mas_ul: owner ? who(users, owner) : "hammasi" },
      count: r.counts.red, sum: money(r.sums.red), rows,
      facts: [["Qizil", r.counts.red], ["Sariq (35–59)", r.counts.amber], ["Yashil", r.counts.green], ["Qizil summa (UZS)", money(r.sums.red)]],
      notes: [r.topReasons?.length ? `Eng ko'p sabab: ${r.topReasons.map((x) => `${x.reason} (${x.n})`).join("; ")}` : null,
              "Ro'yxatda summasi eng katta 8 ta qizil bitim ko'rsatiladi."].filter(Boolean) };
  }

  // ---------- Lidlar: Kelgan / Sifatli / Yaroqsiz / Bitimga aylangan ----------
  // Karta raqami api.summary'dan (bx.count), ro'yxat esa AYNI filtr bilan olingan to'liq ro'yxat.
  if (metric === "leads" || metric === "leads_quality" || metric === "leads_junk" || metric === "leads_converted") {
    const s = await api.summary(bx, owner, R);
    const per = s.period || s.days30;
    const l = await davrLidlari(bx, R, owner);
    const all = l.items;
    // tashla: hamma qatorda bir xil bo'ladigan ustunlar (masalan, yaroqsizlar ro'yxatida «Natija» doim «yaroqsiz»)
    const lidQ = (x, extra = {}, tashla = []) => {
      const o = { id: x.ID, title: x.TITLE || `Lid #${x.ID}`, stage: x.STATUS_DESCRIPTION || x.STATUS_ID || "—",
        sem: LSEM[x.STATUS_SEMANTIC_ID] || x.STATUS_SEMANTIC_ID || "—", source: x.SOURCE_DESCRIPTION || x.SOURCE_ID || "—",
        op: x.UF_CRM_OPERATOR_NAME || "—", owner: who(users, x.ASSIGNED_BY_ID), date: String(x.DATE_CREATE || "").slice(0, 10), ...extra, url: x.UF_CRM_ODOO_URL || null };
      for (const k of tashla) delete o[k];
      return o;
    };
    const manbaNomi = (x) => x.SOURCE_DESCRIPTION || x.SOURCE_ID || "manbasiz";
    const filter = { "yaratilgan": period.label, mas_ul: owner ? who(users, owner) : "hammasi" };
    const umumiyNotes = (arr) => [
      l.total > all.length ? `CRM'da ${l.total} ta lid; hisob uchun eng yangi ${all.length} tasi olindi.` : null,
      arr.length > RO_MAX ? `Oynada eng yangi ${RO_MAX} tasi ko'rsatildi (jami ${arr.length}).` : null,
      per.total !== l.total ? `Karta ${per.total} ta, ro'yxat ${l.total} ta — panel keshi (2 daqiqa) farqi; «Yangilash»dan keyin tenglashadi.` : null,
    ];
    const tarif = "LID TA'RIFI (2026-09-23, sotuv rahbari ko'rsatgan manba): Odoo → My Dashboard → «SUN-HTC Call Operators» → «Tushgan Lead» plitkasining formulasi AYNAN: SUN kompaniyasi, «Оператор (Авто танланади)» tanlangan, lidni call-markaz ([SUN] Call center) xodimi yoki OdooBot yaratgan, arxivlanganlar ham. Shu sababli «Kelgan lidlar» soni Odoo plitkasidagi bilan bir xil.";
    const arxivFormula = "Yaroqsiz (F) = Odoo'da «yo'qotilgan» deb belgilanib arxivlangan lid (dashboard'dagi «Otkaz») yoki boshqa sabab bilan arxivlangan lid. Managerga o'tgan (S) = imkoniyatga aylantirilgan lid — keyin yutqazilgan bo'lsa ham (operator o'z ishini bajargan). Qolganlari — jarayonda (P), holati dashboard ustunlaridan (Янги лид, Жараёнда, 1-6 ой, Кп …).";
    const nP = all.filter((x) => x.STATUS_SEMANTIC_ID === "P").length;

    if (metric === "leads") return { ...base, title: `Kelgan lidlar · ${period.label}`, value: per.total, unit: "ta",
      formula: [`Yaratilgan sanasi (create_date) ${period.label} oralig'iga tushgan «Tushgan Lead»lar soni.`, tarif,
                "Yaroqsiz = F; Sifatli = yaroqsiz bo'lmaganlar; Managerga o'tgan = S.",
                arxivFormula,
                "Yaroqsiz % = yaroqsiz ÷ JAMI lid.",
                "Konversiya ikki xil bazada beriladi: jami liddan = managerga o'tgan ÷ jami; sifatli liddan = managerga o'tgan ÷ sifatli. Managerga o'tgan lid hech qachon yaroqsiz bo'lmaydi, shuning uchun surat ikkalasida bir xil.",
                "Maxraj 0 bo'lsa foiz «—» bo'ladi, 0% emas."],
      filter, count: per.total, rows: all.slice(0, RO_MAX).map((x) => lidQ(x)),
      facts: [["Jami", per.total], ["Jarayonda", nP], ["Yaroqsiz", per.junk], ["Managerga o'tgan", per.converted],
              ["Kuniga o'rtacha", R.days ? +(per.total / R.days).toFixed(1) : "—"],
              ["Yaroqsiz %", pf(per.junkRate, per.junk, per.total)],
              ["Konversiya % (jami liddan)", pf(per.convRate, per.converted, per.total)],
              ["Konversiya % (sifatli liddan)", pf(per.convRateQuality, per.converted, per.quality)]],
      notes: [...umumiyNotes(all),
              all.length ? `Operatorlar bo'yicha («Оператор (Авто танланади)»): ${topN(sanaq(all, (x) => x.UF_CRM_OPERATOR_NAME || "operatorsiz"), 8)}.` : null,
              all.length ? `Manbalar bo'yicha: ${topN(sanaq(all, manbaNomi), 6)}.` : null,
              "Odoo dashboard'ining boshqa plitkalari (Ishlangan, Managerga o'tgan, KV, Otkaz …) — «Lidlar → Odoo dashboard» tabida, Odoo'ning o'z formulasi bilan.",
              src.kind === "odoo" && per.total === 0 ? "Odoo'da SUN lidlari hali MCP foydalanuvchisiga ochilmagan (record rule) — shuning uchun 0." : null].filter(Boolean) };

    if (metric === "leads_quality") {
      const q = all.filter((x) => x.STATUS_SEMANTIC_ID !== "F");
      const nS = q.filter((x) => x.STATUS_SEMANTIC_ID === "S").length;
      return { ...base, title: `Sifatli lidlar · ${period.label}`, value: per.quality, unit: "ta",
        formula: ["Sifatli lid = davrdagi jami lid − yaroqsiz lid.", tarif, arxivFormula,
                  "Sifatli lid ikki guruhdan iborat: hali jarayonda (P) va managerga o'tgan (S).",
                  "Karta ostidagi foiz = sifatli ÷ jami lid."],
        filter, count: per.quality, rows: q.slice(0, RO_MAX).map((x) => lidQ(x)),
        facts: [["Sifatli", per.quality], ["Jami lid", per.total], ["Sifatli ulushi", pf(ulush(per.quality, per.total), per.quality, per.total)],
                ["Shundan jarayonda", q.length - nS], ["Shundan managerga o'tgan", nS], ["Yaroqsiz", per.junk]],
        notes: [...umumiyNotes(q),
                "«Sifatli» — faqat yaroqsiz deb belgilanmagan degani. Lid bilan ishlangan-ishlanmaganini bildirmaydi: buni «Javob tezligi» bo'limi ko'rsatadi.",
                q.length ? `Manbalar bo'yicha: ${topN(sanaq(q, manbaNomi), 6)}.` : null].filter(Boolean) };
    }

    if (metric === "leads_junk") {
      const j = all.filter((x) => x.STATUS_SEMANTIC_ID === "F");
      const auto = j.filter((x) => AUTO_RE.test(String(x.TITLE || ""))).length;
      // Odoo'ning rasmiy yo'qotish sababi (lost_reason_id) — tanlangan bo'lsa, «Sabab» ustunida ko'rinadi
      const rasmiy = j.filter((x) => String(x.UF_CRM_LOST_REASON || "").trim());
      const sababTop = topN(sanaq(rasmiy, (x) => String(x.UF_CRM_LOST_REASON).trim()), 6);
      const manbaJ = sanaq(j, manbaNomi), manbaA = sanaq(all, manbaNomi);
      const eng = [...manbaJ.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([k, v]) => `${k} ${v} (o'z lidlarining ${Math.round(v / (manbaA.get(k) || v) * 100)}%)`).join(", ");
      return { ...base, title: `Yaroqsiz lidlar · ${period.label}`, value: per.junkRate, unit: per.junkRate === null ? "" : "%",
        formula: ["Yaroqsiz ulushi = yaroqsiz lid ÷ JAMI lid (davrda yaratilgan).", tarif, arxivFormula,
                  "Sabab ustuni: «Otkaz» yoki «Arxivlangan» va yonida Odoo'da tanlangan rasmiy yo'qotish sababi (bo'lsa).",
                  "Odoo'dagi «Otkaz Leadlar» plitkasi boshqa sanaga qaraydi — otkaz qilingan sana (date_closed), lid qachon kelganidan qat'i nazar. Shuning uchun soni farq qilishi mumkin; aniq Odoo raqami «Odoo dashboard» tabida.",
                  "Maxraj 0 bo'lsa foiz «—» bo'ladi, 0% emas."],
        filter, count: per.junk,
        rows: j.slice(0, RO_MAX).map((x) => lidQ(x, { why: [x.STATUS_DESCRIPTION || (x.ARXIV === "Y" ? "Odoo arxivi" : "yo'qotilgan"),
          String(x.UF_CRM_LOST_REASON || "").trim()].filter(Boolean).join(" · ") }, ["sem"])),
        facts: [["Yaroqsiz", per.junk], ["Jami lid", per.total], ["Yaroqsiz ulushi", pf(per.junkRate, per.junk, per.total)],
                ["Odoo arxividan", per.arxiv ?? "—"], ["Bosqich yoki sabab bo'yicha", per.arxivSiz ?? "—"],
                ["Rasmiy sabab tanlangan", rasmiy.length], ["Avtomatik qo'ng'iroq yozuvi", auto]],
        notes: [...umumiyNotes(j),
                per.junk && per.arxiv === per.junk ? "Barcha yaroqsiz lidlar Odoo'da ARXIVLANGAN (arxivlash lidni o'chirmaydi)." : null,
                sababTop ? `Rasmiy yo'qotish sabablari (${rasmiy.length} ta lidda tanlangan): ${sababTop}.` : null,
                j.length && rasmiy.length < j.length ? `${j.length - rasmiy.length} ta yaroqsiz lidda Odoo'da rasmiy yo'qotish sababi tanlanmagan — ularning sababini panel ko'rsata olmaydi.` : null,
                eng ? `Eng ko'p yaroqsiz manbalar: ${eng}.` : null,
                auto ? `${auto} tasi avtomatik qo'ng'iroq yozuvi (nomida «пропущенный», «входящий» va h.k.) — mijoz murojaati emas.` : null].filter(Boolean) };
    }

    // leads_converted
    const c = all.filter((x) => x.STATUS_SEMANTIC_ID === "S");
    const muddat = c.map((x) => (x.DATE_CLOSED && x.DATE_CREATE ? Math.max(0, kunFarq(x.DATE_CREATE, x.DATE_CLOSED)) : NaN));
    const nolKun = muddat.filter((d) => d === 0).length;
    return { ...base, title: `Managerga o'tgan lidlar · ${period.label}`, value: per.converted, unit: "ta",
      formula: [`${period.label} oralig'ida YARATILGAN va keyinchalik imkoniyatga (managerga) o'tkazilgan «Tushgan Lead»lar (Odoo: type = opportunity).`, tarif,
                "Lid yaratilgan sana hisobga olinadi — managerga o'tgan sana davrdan keyin bo'lishi mumkin.",
                "Odoo'dagi «Managerga O'tgan Leadlar» plitkasi esa O'TKAZILGAN sana (date_conversion) bo'yicha sanaydi — shu davrda o'tkazilganlar, qachon kelganidan qat'i nazar. Shuning uchun ikki son farq qiladi; aniq Odoo raqami «Odoo dashboard» tabida.",
                "Konversiya: jami liddan = managerga o'tgan ÷ jami; sifatli liddan = managerga o'tgan ÷ sifatli.",
                "«Managerga, kun» = yaratilgan sanadan managerga o'tkazilgan sanagacha."],
      filter, count: per.converted,
      rows: c.slice(0, RO_MAX).map((x, k) => lidQ(x, { conv: Number.isFinite(muddat[k]) ? muddat[k] : "—" }, ["sem", "stage"])),
      facts: [["Managerga o'tgan", per.converted], ["Jami lid", per.total], ["Sifatli lid", per.quality],
              ["Konversiya (jami liddan)", pf(per.convRate, per.converted, per.total)],
              ["Konversiya (sifatli liddan)", pf(per.convRateQuality, per.converted, per.quality)],
              ["Managerga o'tish, median", median(muddat) !== null ? `${median(muddat)} kun` : "—"]],
      notes: [...umumiyNotes(c),
              c.length ? `Manbalar bo'yicha: ${topN(sanaq(c, manbaNomi), 6)}.` : null,
              c.length ? `Operatorlar bo'yicha: ${topN(sanaq(c, (x) => x.UF_CRM_OPERATOR_NAME || "operatorsiz"), 8)}.` : null,
              nolKun ? `${nolKun} tasi yaratilgan kuniyoq managerga o'tgan — ular Odoo'da to'g'ridan-to'g'ri imkoniyat sifatida ochilgan bo'lishi mumkin.` : null].filter(Boolean) };
  }

  // ---------- Javob tezligi (SLA 24 soat) kartalari ----------
  // Hammasi sla.slaCheck'ning AYNI natijasidan (keshda) — karta va oyna bir xil sonni ko'radi.
  if (metric === "sla_open" || metric === "sla_rate" || metric === "sla_late" || metric === "sla_leads") {
    const r = await sla.slaCheck(bx, owner, R);
    const t = r.totals;
    const lidlar = r.tafsil?.lidlar || [];
    const qb = r.qongiroqBor !== false;
    const olchandi = qb && t.answered > 0 && t.slaRate !== null;
    const ism = (id) => (id && id !== "0" && id !== "?" ? (users[String(id)] || `#${id}`) : "biriktirilmagan");
    const lidUrl = (id) => (src.kind === "odoo" && src.portal ? `${src.portal.replace(/\/$/, "")}/odoo/crm/${id}` : null);
    const manbaById = new Map(lidlar.map((x) => [String(x.id), x.source]));   // kod emas, manba nomi
    const slaQ = (x, extra = {}) => ({ id: x.id, title: x.title, source: manbaById.get(String(x.id)) || x.source || "—", owner: who(users, x.owner === "?" ? "0" : x.owner),
      date: String(x.createdAt || "").slice(0, 10), ...extra, url: lidUrl(x.id) });
    const filter = { "yaratilgan": period.label, mas_ul: owner ? who(users, owner) : "hammasi", chegara: "24 soat" };
    const qIzoh = r.davrQongiroq === 0
      ? "Bu davrda SUN-HIGHTECH operatorlarining telefoniya orqali birorta ham qo'ng'irog'i qayd etilmagan. Telefoniya ulangan, jurnal ishlayapti — qo'ng'iroq shaxsiy telefon yoki messenjer orqali qilingan bo'lsa, bu yerda ko'rinmaydi. Shuning uchun bu «javob berilmagan» emas, «qo'ng'iroq qayd etilmagan» degani."
      : !qb ? `Davrda ${r.davrQongiroq} ta qo'ng'iroq qayd etilgan, lekin birortasining raqami shu davrdagi yangi lidlar telefoniga mos kelmadi (eski mijozga yoki CRM'ga kiritilmagan raqamga qilingan).`
      : null;
    const asos = [
      "Davrda yaratilgan lidlar olinadi; avtomatik qo'ng'iroq yozuvlari (nomida «пропущенный», «входящий», «обратный звонок» va h.k.) chiqariladi — ular mijoz murojaati emas.",
      "Javob = lidga qilingan birinchi CHIQUVCHI qo'ng'iroq. Kiruvchi va o'tkazib yuborilgan qo'ng'iroq javob hisoblanmaydi.",
      "Qo'ng'iroq manbasi — Odoo VoIP (voip.call, 2026-09-24 dan; qo'ng'iroq lidga Odoo'ning o'zida bog'langan) va eski telefoniya jurnali (call.record.api, 31-iyulgacha; raqam lid telefoniga mos kelsa bog'lanadi).",
      "SLA chegarasi — 24 soat (panel sozlamasi; «Javob tezligi» bo'limidagi 2026-09-05 dagi tahlil asosida tanlangan).",
    ];
    const qFacts = [["Davrdagi SUN qo'ng'iroqlari", r.davrQongiroq ?? "—"], ["Shundan chiquvchi", r.davrChiquvchi ?? "—"]];

    if (metric === "sla_open") {
      const risk = r.atRisk || [];
      const kunlar = risk.map((a) => a.hours / 24);
      const orada = (lo, hi) => kunlar.filter((d) => d > lo && d <= hi).length;
      const egalar = sanaq(risk, (a) => ism(a.owner));
      return { ...base, title: "Ochiq, 24 soatdan oshgan lidlar", value: t.atRisk, unit: "ta",
        formula: ["Ro'yxatga tushish sharti: lid ochiq (yaroqsiz ham, bitimga aylangan ham emas), yaratilganiga 24 soatdan oshgan va unga chiquvchi qo'ng'iroq qayd etilmagan.",
                  "«Kutmoqda, kun» = hozirgi vaqt − lid yaratilgan vaqt. Ro'yxat eng uzoq kutayotganidan boshlanadi.", ...asos],
        filter, count: t.atRisk,
        rows: risk.slice(0, RO_MAX).map((a) => slaQ(a, { wait: Math.round(a.hours / 24) })),
        facts: [["Ochiq, 24 soatdan oshgan", t.atRisk], ["Davrdagi haqiqiy lid", t.real],
                ["1–3 kun kutmoqda", orada(1, 3)], ["3–7 kun", orada(3, 7)], ["7–14 kun", orada(7, 14)], ["14 kundan ko'p", orada(14, Infinity)], ...qFacts],
        notes: [qIzoh, egalar.size ? `Mas'ullar bo'yicha: ${topN(egalar, 6)}.` : null,
                t.atRisk > risk.length ? `Jami ${t.atRisk} ta; ro'yxatda ${risk.length} tasi.` : null,
                risk.length > RO_MAX ? `Oynada eng uzoq kutayotgan ${RO_MAX} tasi ko'rsatildi.` : null].filter(Boolean) };
    }

    if (metric === "sla_rate") {
      const javob = lidlar.filter((x) => x.callH !== null).sort((a, b) => b.callH - a.callH);
      return { ...base, title: "SLA bajarilishi (24 soat)", value: olchandi ? t.slaRate : null, unit: olchandi ? "%" : "",
        formula: ["SLA bajarilishi = birinchi chiquvchi qo'ng'irog'i 24 soat ichida bo'lgan lid ÷ chiquvchi qo'ng'iroq olgan lid.",
                  "Javob vaqti = birinchi chiquvchi qo'ng'iroq vaqti − lid yaratilgan vaqt.",
                  "Maxrajga faqat qo'ng'iroq qayd etilgan lidlar kiradi. Umuman qo'ng'iroq qilinmagan ochiq lidlar «Javob kutayotgan lidlar» ro'yxatida alohida.",
                  "Maxraj 0 bo'lsa — «o'lchanmadi», 0% emas (TZI P0-01).", ...asos],
        filter, count: t.answered,
        rows: javob.slice(0, RO_MAX).map((x) => slaQ(x, { hours: x.callH, inSla: x.callH <= 24 ? "ha" : "yo'q" })),
        facts: [["SLA bajarilishi", olchandi ? pf(t.slaRate, t.withinSla, t.answered) : "o'lchanmadi"], ["Qo'ng'iroq olgan lid", t.answered],
                ["24 soat ichida", t.withinSla], ["24 soatdan keyin", t.breached], ["Qo'ng'iroq qayd etilmagan lid", t.neverCalled], ["Davrdagi haqiqiy lid", t.real], ...qFacts],
        notes: [olchandi ? null : (qIzoh || "Davrda chiquvchi qo'ng'iroq olgan lid yo'q — foizni hisoblab bo'lmaydi."),
                olchandi && t.answered < 30 ? `Namuna kichik (${t.answered} ta lid) — foiz tasodifan tebranishi mumkin.` : null].filter(Boolean) };
    }

    if (metric === "sla_late") {
      const kech = lidlar.filter((x) => x.callH !== null && x.callH > 24).sort((a, b) => b.callH - a.callH);
      return { ...base, title: "Kech javob (24 soatdan keyin)", value: olchandi ? t.breached : null, unit: olchandi ? "ta" : "",
        formula: ["Kech javob = birinchi chiquvchi qo'ng'irog'i lid yaratilganidan 24 soatdan KEYIN bo'lgan lidlar.",
                  "Javob vaqti = birinchi chiquvchi qo'ng'iroq − lid yaratilgan vaqt.", ...asos],
        filter, count: t.breached,
        rows: kech.slice(0, RO_MAX).map((x) => slaQ(x, { hours: x.callH })),
        facts: [["Kech javob", olchandi ? t.breached : "o'lchanmadi"], ["Qo'ng'iroq olgan lid", t.answered], ["24 soat ichida", t.withinSla],
                ["Eng kech javob, soat", kech[0]?.callH ?? "—"], ["Median kechikish, soat", median(kech.map((x) => x.callH)) ?? "—"], ...qFacts],
        notes: [olchandi ? null : (qIzoh || "Davrda chiquvchi qo'ng'iroq olgan lid yo'q.")].filter(Boolean) };
    }

    // sla_leads: jurnal bor bo'lsa — umuman qo'ng'iroq qilinmagan lidlar; bo'lmasa — davrdagi barcha lidlar
    const ruyxat = qb ? lidlar.filter((x) => !x.callBor) : lidlar;
    return { ...base, title: qb ? "Umuman qo'ng'iroq qilinmagan lidlar" : "Davrdagi lidlar (javob tezligi bazasi)",
      value: qb ? t.neverCalled : t.real, unit: "ta",
      formula: [qb ? "Davrdagi haqiqiy lidlardan chiquvchi qo'ng'irog'i umuman qayd etilmaganlari (ochiq ham, yopilgan ham)."
                   : "Javob tezligi hisoblanadigan baza: davrda yaratilgan lidlar, avtomatik qo'ng'iroq yozuvlarisiz.", ...asos],
      filter, count: qb ? t.neverCalled : t.real,
      rows: ruyxat.slice(0, RO_MAX).map((x) => slaQ(x, { sem: LSEM[x.sem] || x.sem || "—",
        call: x.callH !== null ? `${x.callH} soatda` : x.callBor ? "lid ochilishidan oldin" : "qayd etilmagan" })),
      facts: [["Davrdagi haqiqiy lid", t.real], ["Qo'ng'iroq olgan", t.answered], ["Qo'ng'iroq qayd etilmagan", t.neverCalled], ["Ochiq, 24 soatdan oshgan", t.atRisk],
              ["Jarayonda", lidlar.filter((x) => x.sem === "P").length], ["Yaroqsiz", lidlar.filter((x) => x.sem === "F").length],
              ["Bitimga aylangan", lidlar.filter((x) => x.sem === "S").length]],
      notes: [qIzoh, ruyxat.length > RO_MAX ? `Oynada eng yangi ${RO_MAX} tasi ko'rsatildi (jami ${ruyxat.length}).` : null].filter(Boolean) };
  }

  // ---------- Qayta sotuv kartalari ----------
  // renewal.renewals'ning AYNI natijasi (keshda). Davr filtri yo'q — butun tarix.
  if (metric === "renewal_work" || metric === "renewal_active" || metric === "renewal_orphan" || metric === "renewal_repeat") {
    const r = await renewal.renewals(bx, owner);
    const t = r.totals, o = r.olchov || {};
    const tf = r.tafsil || { customers: [], orphan: [] };
    const band = (b) => r.bands.find((x) => x.band === b)?.count ?? 0;
    const tarix = { ...period, from: null, to: null, label: "butun tarix" };
    const bitimUrl = (id) => {
      if (src.kind !== "odoo" || !src.portal) return null;
      const n = Number(id), p = src.portal.replace(/\/$/, "");
      return n >= 1e6 ? `${p}/odoo/sales/${n - 1e6}` : `${p}/odoo/crm/${n}`;
    };
    const mijozQ = (c) => ({ id: c.lastId, title: c.lastTitle, owner: who(users, c.owner === "?" ? "0" : c.owner), category: c.category,
      deals: c.deals, first: String(c.firstAt || "").slice(0, 10), last: String(c.lastAt || "").slice(0, 10), since: c.since,
      amount: money(c.amount), url: bitimUrl(c.lastId) });
    const filter = { holat: "yutilgan bitimlar", davr: "butun tarix", mas_ul: owner ? who(users, owner) : "hammasi" };
    const asos = [
      "Manba: CRM'dagi barcha yutilgan bitimlar (STAGE_SEMANTIC_ID = S) — Odoo'da yutilgan imkoniyatlar va imkoniyatga bog'lanmagan tasdiqlangan buyurtmalar (sale.order). Davr filtri qo'llanmaydi.",
      "Mijoz = bitimga biriktirilgan kompaniya yoki kontakt. Ikkalasi ham bo'lmagan bitimni mijozga bog'lab bo'lmaydi («bog'lanmagan»).",
      `Guruh oxirgi xariddan o'tgan kun bo'yicha: faol — ${r.window} kundan kam; yaqinda uzilgan — ${r.window}–500; uzoq — 501–1000; yo'qolgan — 1000 dan ko'p.`,
      `${r.window} kun = qayta xarid oralig'i ${r.cycle} kunning 75%i. ${r.cycle} kun — modul sozlamasi (2026-09-05 dagi o'lchov), joriy CRM'da qayta o'lchangani «Raqamlar»da.`,
      src.kind === "odoo" ? "Odoo adapteri tasdiqlangan buyurtmalarni oxirgi 400 kun uchun yuklaydi — undan eski buyurtmalar bu hisobga kirmaydi." : null,
    ].filter(Boolean);
    const oraliqFakt = o.oraliqSoni ? `median ${o.oraliqMedian} kun (${o.oraliqSoni} ta oraliq)` : "o'lchab bo'lmadi — ketma-ket xarid yo'q";
    const tarixIzoh = o.engEski ? `CRM'dagi eng eski yutilgan bitim: ${String(o.engEski).slice(0, 10)} (${o.engEskiKun} kun oldin).` : null;
    const bandFacts = [["Faol", band("faol")], ["Yaqinda uzilgan", band("yaqinda")], ["Uzoq uzilgan", band("uzoq")], ["Yo'qolgan", band("yo'qolgan")], ["Jami mijoz", t.customers]];
    const qirqildi = t.wonTotal > t.wonDeals ? `CRM'da ${t.wonTotal} ta yutilgan bitim; hisobga eng yangi ${t.wonDeals} tasi olindi.` : null;

    if (metric === "renewal_work") {
      const work = tf.customers.filter((c) => c.band === "yaqinda").sort((a, b) => a.since - b.since);
      const qisqaTarix = o.engEskiKun !== null && o.engEskiKun !== undefined && o.engEskiKun < r.window;
      return { ...base, period: tarix, title: "Bugun ishlash kerak — yaqinda uzilgan mijozlar", value: work.length, unit: "ta",
        formula: [`Oxirgi xarididan ${r.window}–500 kun o'tgan mijozlar. Ro'yxat eng yaqinda uzilganidan boshlanadi — ularni qaytarish osonroq.`, ...asos],
        filter, count: work.length, rows: work.slice(0, RO_MAX).map(mijozQ),
        facts: [...bandFacts, ["Qayta xarid oralig'i (joriy CRM)", oraliqFakt]],
        notes: [!work.length ? `Hozir «yaqinda uzilgan» mijoz yo'q: ${band("faol")} ta mijozning oxirgi xaridi ${r.window} kundan yangi.` : null,
                !work.length && qisqaTarix ? `${tarixIzoh} Bu ${r.window} kundan yangi — ya'ni CRM tarixi hali birorta mijozni «uzilgan» deb belgilashga yetmaydi; ro'yxat vaqt o'tishi bilan to'ladi.` : (work.length ? null : tarixIzoh),
                qirqildi].filter(Boolean) };
    }

    if (metric === "renewal_active") {
      const faol = tf.customers.filter((c) => c.band === "faol").sort((a, b) => a.since - b.since);
      return { ...base, period: tarix, title: "Faol mijozlar", value: faol.length, unit: "ta",
        formula: [`Oxirgi xaridi ${r.window} kundan yangi bo'lgan mijozlar (kompaniya yoki kontakt bo'yicha).`, ...asos],
        filter, count: faol.length, rows: faol.slice(0, RO_MAX).map(mijozQ),
        facts: [...bandFacts, ["Yutilgan bitim (jami)", t.wonDeals], ["Mijozga bog'lanmagan bitim", t.orphan]],
        notes: [tarixIzoh, t.orphan ? `${t.orphan} ta yutilgan bitim mijozga bog'lanmagan — ular hech bir mijozga qo'shilmadi.` : null, qirqildi].filter(Boolean) };
    }

    if (metric === "renewal_orphan") {
      const rows = tf.orphan.slice().sort((a, b) => String(b.CLOSEDATE || "").localeCompare(String(a.CLOSEDATE || ""))).slice(0, RO_MAX)
        .map((d) => ({ id: d.ID, title: d.TITLE || `Bitim #${d.ID}`, amount: money(d.OPPORTUNITY), currency: d.CURRENCY_ID || "UZS",
                       date: String(d.CLOSEDATE || "").slice(0, 10), owner: who(users, d.ASSIGNED_BY_ID), url: bitimUrl(d.ID) }));
      return { ...base, period: tarix, title: "Mijozga bog'lanmagan yutilgan bitimlar", value: t.wonDeals ? t.orphanShare : null, unit: t.wonDeals ? "%" : "",
        formula: ["Bog'lanmagan ulushi = kompaniya ham, kontakt ham biriktirilmagan yutilgan bitim ÷ jami yutilgan bitim.",
                  "Bunday bitimdan kim sotib olganini bilib bo'lmaydi — u qayta sotuv ro'yxatiga tushmaydi.", ...asos],
        filter, count: t.orphan, rows,
        facts: [["Bog'lanmagan", t.orphan], ["Jami yutilgan bitim", t.wonDeals], ["Bog'lanmagan ulushi", pf(t.wonDeals ? t.orphanShare : null, t.orphan, t.wonDeals)], ["Mijozga bog'langan", t.linked]],
        notes: [t.orphan ? "Tuzatish yo'li: Odoo'da shu bitimlarga mijoz (kontakt yoki kompaniya) biriktirilsa, ular qayta sotuv hisobiga kiradi." : "Barcha yutilgan bitimlar mijozga bog'langan.", qirqildi].filter(Boolean) };
    }

    // renewal_repeat
    const qayta = tf.customers.filter((c) => c.repeat).sort((a, b) => b.deals - a.deals || a.since - b.since);
    const birKunlik = qayta.filter((c) => c.firstAt && c.lastAt && Math.abs(kunFarq(c.firstAt, c.lastAt)) < 1).length;
    const haqiqiy = qayta.length - birKunlik;
    return { ...base, period: tarix, title: "Qayta sotib olgan mijozlar", value: t.customers ? t.repeatShare : null, unit: t.customers ? "%" : "",
      formula: ["Qayta sotib olgan ulushi = 2 va undan ko'p yutilgan bitimi bor mijoz ÷ jami mijoz.",
                "Mijozga bog'lanmagan bitimlar hisobga kirmaydi.", ...asos],
      filter, count: t.repeat, rows: qayta.slice(0, RO_MAX).map(mijozQ),
      facts: [["Qayta sotib olgan", t.repeat], ["Jami mijoz", t.customers], ["Ulushi", pf(t.customers ? t.repeatShare : null, t.repeat, t.customers)],
              ["Barcha bitimi bir kunda", birKunlik], ["Qayta xarid oralig'i (joriy CRM)", oraliqFakt]],
      notes: [birKunlik ? `${birKunlik} ta mijozning barcha bitimlari BIR KUNDA yopilgan — bu bitta xaridning bo'laklari bo'lishi mumkin. Ularsiz: ${haqiqiy} ta mijoz, ${pf(ulush(haqiqiy, t.customers), haqiqiy, t.customers)}.` : null,
              tarixIzoh, qirqildi].filter(Boolean) };
  }

  if (metric === "open" || metric === "weighted" || metric === "cycle") {
    const c = await rev.command(bx, db, R);
    const { deals } = await rev.base(bx, R);
    const act = deals.filter((d) => !d.archive);
    const rows = act.sort((a, b) => b.amount - a.amount).slice(0, 25).map((d) => ({ id: d.id, title: d.title, amount: money(d.amount), currency: d.currency, date: String(d.closeDate || "").slice(0, 10), owner: who(users, d.owner), stage: d.stage, prob: Math.round(d.probability * 100), idle: d.idleDays }));
    if (metric === "open") return { ...base, title: "Ochiq bitimlar", value: c.extra.openDeals, unit: "ta",
      formula: [`CRM'da yopilmagan (CLOSED = N) bitimlar soni — ${period.label} oralig'ida ochilganlari.`,
                "«Faol» — oxirgi 365 kun ichida harakat bo'lgani; undan eskisi arxiv deb belgilanadi va prognozga kirmaydi.",
                "Xodim yollash voronkalari (Ish Montajnik, Ish Savdo) bu hisobga kirmaydi — ular sotuv emas."],
      filter: { holat: "ochiq", "ochilgan": period.label }, count: c.extra.openDeals, rows,
      facts: [["Jami ochiq", c.extra.openDeals], ["Faol", c.extra.activeDeals], ["Arxiv (365+ kun)", c.extra.archivedDeals], ["Namunaga olingan", c.extra.sampled]],
      notes: [c.extra.sampled < c.extra.openDeals ? `Ro'yxat va summa eng katta ${c.extra.sampled} ta bitim bo'yicha.` : null].filter(Boolean) };
    if (metric === "weighted") return { ...base, title: "Vaznli prognoz", value: money(c.kpi.weighted), unit: "so'm",
      formula: ["Σ (bitim summasi × ehtimollik) — faol, UZS, yopilmagan bitimlar.",
                "Ehtimollik CRM'da to'ldirilmagan, shuning uchun bosqich o'rnidan hisoblanadi: birinchi ochiq bosqich 10%, oxirgisi 85%, oraliq — chiziqli.",
                "Bu TAXMIN: sotuvchining shaxsiy bahosi emas."],
      filter: { "ochilgan": period.label, valyuta: "UZS", arxiv: "365+ kun chiqarilgan" }, count: act.length, sum: money(c.kpi.weighted), rows,
      facts: [["Vaznli prognoz", money(c.kpi.weighted)], ["Commit (70%+)", money(c.kpi.commit)], ["Xavfdagi vaznli", money(c.kpi.atRisk)], ["Bitimlar", act.length]],
      notes: c.notes || [] };
    return { ...base, title: "O'rtacha sikl", value: c.extra.avgCycle, unit: "kun",
      formula: ["Oxirgi 90 kunda yutilgan bitimlar bo'yicha: (yopilgan sana − ochilgan sana) o'rtachasi.",
                "Faqat ikkala sanasi ham bor bitimlar hisobga olinadi."],
      filter: { davr: "oxirgi 90 kun", holat: "yutilgan" }, count: c.extra.wonThisMonth, rows: [],
      facts: [["O'rtacha sikl", `${c.extra.avgCycle} kun`], ["Win rate (90 kun)", `${c.extra.winRate}%`], ["O'rtacha bitim", money(c.extra.avgDeal)], ["Velocity (kunlik)", money(c.extra.velocity)]],
      notes: ["Sikl uzunligi 180 kundan oshsa, bitimlar voronkada qotib qolayotganini bildiradi."] };
  }

  if (metric === "payment" || metric === "late") {
    const f = await api.finance(bx, R);
    const all = f.waiting || [];
    const late = all.filter((w) => w.days >= 30);
    const src = metric === "late" ? late : all;
    const uzs = src.filter((w) => (w.currency || "UZS") === "UZS");
    const sum = uzs.reduce((a, w) => a + Number(w.amount || 0), 0);
    const rows = src.slice(0, 25).map((w) => ({ id: w.id, title: w.title, amount: money(w.amount), currency: w.currency || "UZS", stage: w.stage || w.stageName, idle: w.days, owner: who(users, w.owner) }));
    return { ...base, title: metric === "late" ? "Kechikkan to'lovlar" : "To'lov kutilmoqda", value: money(sum), unit: "so'm",
      formula: ["CRM'da to'lov bosqichida turgan (nomida «оплат», «avans», «Шартнома берилди», «счёт» bo'lgan) yopilmagan bitimlar summasi.",
                metric === "late" ? "Faqat shu bosqichda 30 kundan ortiq turganlari." : "Bosqichda turgan muddatdan qat'i nazar — hozirgi holat.",
                "Faqat UZS yig'indisi; boshqa valyuta alohida ko'rsatiladi."],
      filter: { holat: "ochiq · to'lov bosqichi", muddat: metric === "late" ? "30+ kun" : "hammasi" },
      count: src.length, sum, rows,
      facts: [["Bitimlar", src.length], ["Summasi (UZS)", sum], ["30+ kun kutayotgan", late.length], ["Arxiv (1+ yil harakatsiz)", all.filter((w) => w.archive).length]],
      notes: [all.length && !src.length ? "Bu shartga mos bitim yo'q." : null].filter(Boolean) };
  }

  const e = new Error(`Noma'lum metrika: ${metric}`); e.status = 400; throw e;
}
