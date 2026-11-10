// M06 + M18 — Javob tezligi SLA va lid yo'qotish tahlili (TZ §6.3).
//
// Ikki modul birlashtirildi, chunki o'lchov ularning bitta ekanini ko'rsatdi:
// lidlar asosan javob kechikkani uchun o'lyapti.
//
// O'LCHOV (2026-09-05, 3 oy, 649 ta javob vaqti aniqlangan lid, bazaviy 2.00%):
//   5 daqiqagacha   36 lid · 2.78%  ×1.39
//   5–30 daqiqa     37 lid · 2.70%  ×1.35
//   30 daq–2 soat   67 lid · 2.99%  ×1.49
//   2–24 soat      273 lid · 2.56%  ×1.28
//   1–7 kun        231 lid · 0.87%  ×0.43   <- jarlik shu yerda
//
// Xulosa taxminga zid: "5 daqiqada javob ber" qoidasi bu bazada TASDIQLANMADI —
// 5 daqiqa bilan 2 soat orasida farq yo'q (namunalar ham kichik: 36 va 37 lid).
// Haqiqiy chegara — 24 soat. Undan keyin konversiya uch barobar tushadi.
// Shuning uchun SLA 24 soat qilib olindi, 5 daqiqa emas.
import { cached } from "./cache.mjs";
import * as rng from "./range.mjs";
import * as dir from "./directory.mjs";
import { leadOwn } from "./roles.mjs";

const TTL = 3 * 60e3;
const PORTAL = process.env.BITRIX_PORTAL || "http://127.0.0.1:8099";
const SLA_HOURS = 24;                  // o'lchangan jarlik
const AUTO_RE = /пропущенн|не ответил|исходящ|входящ|обратный звонок|javobsiz/i;

export const MEASURED = {
  at: "2026-09-05", sample: 649, baseRate: 2.00, slaHours: SLA_HOURS,
  bands: [
    { label: "5 daqiqagacha",   n: 36,  rate: 2.78, lift: 1.39 },
    { label: "5–30 daqiqa",     n: 37,  rate: 2.70, lift: 1.35 },
    { label: "30 daq – 2 soat", n: 67,  rate: 2.99, lift: 1.49 },
    { label: "2–24 soat",       n: 273, rate: 2.56, lift: 1.28 },
    { label: "24 soatdan ko'p", n: 231, rate: 0.87, lift: 0.43 },
  ],
};

const hrs = (ms) => ms / 3600000;

export const slaCheck = (bx, owner = null, range) => {
  const R = rng.normalize(range, 30);
  return cached(`sla:${owner || "all"}:${R.key}`, TTL, async () => {
    const own = owner ? { ASSIGNED_BY_ID: owner } : {};   // yo'qotilgan bitimlar
    const [leads, acts, lost] = await Promise.all([
      bx.listAll("crm.lead.list", {
        filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO, ...leadOwn(owner) },
        select: ["ID", "TITLE", "NAME", "LAST_NAME", "COMPANY_TITLE", "DATE_CREATE",
                 "STATUS_SEMANTIC_ID", "STATUS_ID", "SOURCE_ID", "SOURCE_DESCRIPTION", "ASSIGNED_BY_ID"],
        order: { DATE_CREATE: "DESC" }, maxItems: Math.min(3000, Math.max(800, R.days * 40)),
      }),
      bx.listAll("crm.activity.list", {
        filter: { TYPE_ID: 2, ">=CREATED": R.fromISO },
        select: ["ID", "OWNER_ID", "OWNER_TYPE_ID", "START_TIME", "CREATED", "DIRECTION", "SETTINGS"],
        order: { CREATED: "ASC" }, maxItems: 30000,   // VoIP: kuniga ~110 qo'ng'iroq — 90 kunda 9 000 dan oshadi
      }).catch(() => ({ items: [] })),
      // Yo'qotilgan bitimlar — TANLANGAN DAVRDA yopilganlarining HAMMASI. Ilgari davrdan qat'i nazar
      // faqat oxirgi 300 tasi olinardi (sahifa sarlavhasi esa davrni ko'rsatardi).
      bx.listAll("crm.deal.list", {
        filter: { STAGE_SEMANTIC_ID: "F", ">=CLOSEDATE": R.fromISO, "<=CLOSEDATE": R.toISO, ...own },
        select: ["ID", "TITLE", "COMMENTS", "UF_CRM_LOST_REASON", "CLOSEDATE", "ASSIGNED_BY_ID", "CATEGORY_ID", "UF_CRM_ODOO_URL"],
        order: { CLOSEDATE: "DESC" }, maxItems: 5000,
      }),
    ]);

    // Lid -> birinchi CHIQUVCHI (biz qilgan) qo'ng'iroq vaqti.
    // Kiruvchi qo'ng'iroq hisobga olinmaydi: u lidni o'zi yaratadi, "javob" emas.
    const firstOut = new Map();
    for (const a of acts.items || []) {
      if (String(a.OWNER_TYPE_ID) !== "1") continue;
      const st = a.SETTINGS && typeof a.SETTINGS === "object" ? a.SETTINGS : {};
      if (st.MISSED_CALL === true || String(a.DIRECTION) !== "2") continue;
      const id = String(a.OWNER_ID);
      const t = new Date(a.START_TIME || a.CREATED).getTime();
      if (!firstOut.has(id) || t < firstOut.get(id)) firstOut.set(id, t);
    }

    // CRM'da umuman chiquvchi qo'ng'iroq yozuvi bormi. Odoo'da telefoniya jurnali yo'q —
    // u holda "javob berilmagan" deb ko'rsatish noto'g'ri bo'ladi, "o'lchanmadi" deymiz.
    const qongiroqBor = firstOut.size > 0;
    const davrQongiroq = (acts.items || []).length;              // davrdagi SUN qo'ng'iroqlari
    const davrChiquvchi = (acts.items || []).filter((a) => String(a.DIRECTION) === "2").length;
    const real = (leads.items || []).filter((l) => !AUTO_RE.test(l.TITLE || ""));
    const now = Date.now();
    const name = (l) => l.COMPANY_TITLE || [l.NAME, l.LAST_NAME].filter(Boolean).join(" ") || l.TITLE || `Lid #${l.ID}`;

    let answered = 0, breached = 0, withinSla = 0;
    const atRisk = [];         // hali ochiq, SLA o'tgan, qo'ng'iroq yo'q — ISHLASH KERAK
    const lateAnswered = [];   // javob berilgan, lekin kech
    const tafsilLid = [];      // explain oynasi uchun har lidning holati (API javobiga chiqmaydi)

    for (const l of real) {
      const t0 = new Date(l.DATE_CREATE).getTime();
      const t1 = firstOut.get(String(l.ID));
      const closed = l.STATUS_SEMANTIC_ID === "S" || l.STATUS_SEMANTIC_ID === "F";
      tafsilLid.push({ id: l.ID, title: name(l), owner: String(l.ASSIGNED_BY_ID || "?"), createdAt: l.DATE_CREATE,
                       sem: l.STATUS_SEMANTIC_ID, source: String(l.SOURCE_DESCRIPTION || l.SOURCE_ID || ""), callBor: firstOut.has(String(l.ID)),
                       callH: t1 && t1 >= t0 ? Math.round(hrs(t1 - t0)) : null });
      if (t1 && t1 >= t0) {
        answered++;
        const h = hrs(t1 - t0);
        if (h > SLA_HOURS) {
          breached++;
          lateAnswered.push({ id: l.ID, title: name(l), owner: String(l.ASSIGNED_BY_ID || "?"),
                              hours: Math.round(h), createdAt: l.DATE_CREATE,
                              url: `${PORTAL}/crm/lead/details/${l.ID}/` });
        } else withinSla++;
      } else if (!closed) {
        const h = hrs(now - t0);
        if (h > SLA_HOURS) {
          atRisk.push({ id: l.ID, title: name(l), owner: String(l.ASSIGNED_BY_ID || "?"),
                        hours: Math.round(h), createdAt: l.DATE_CREATE,
                        source: String(l.SOURCE_ID || ""),
                        url: `${PORTAL}/crm/lead/details/${l.ID}/` });
        }
      }
    }
    atRisk.sort((a, b) => b.hours - a.hours);
    lateAnswered.sort((a, b) => b.hours - a.hours);

    // Yo'qotilgan bitimlar — sabab bormi. Ikki manba:
    //   * rasmiy sabab — Odoo'da yo'qotish oynasida tanlanadigan lost_reason_id (masalan «нархи тўғри келмади»);
    //   * izoh — bitim tavsifi (description), sotuvchi o'zi yozgan matn.
    // Ilgari faqat izoh tekshirilardi: rasmiy sabab tanlagan sotuvchi ham «sabab yozilmagan» chiqardi.
    const cleanTxt = (v) => String(v || "").replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
    const lostRows = (lost.items || []).map((d) => {
      const rasmiy = String(d.UF_CRM_LOST_REASON || "").trim(), izoh = cleanTxt(d.COMMENTS);
      return {
        id: d.ID, title: d.TITLE || `Bitim #${d.ID}`,
        rasmiy, izoh, reason: [rasmiy, izoh].filter(Boolean).join(" — "),
        hasReason: !!rasmiy || izoh.length >= 4,
        closedAt: d.CLOSEDATE, owner: String(d.ASSIGNED_BY_ID || "?"),
        url: d.UF_CRM_ODOO_URL || `${PORTAL}/crm/deal/details/${d.ID}/`,
      };
    });
    const LOST_MAX = 2000;

    const RISK_MAX = 2000;   // TZI P0-04: ilgari 40 edi — sarlavha 400 derdi, jadval 40 ko'rsatardi
    const { rows: riskNamed } = await dir.decorate(bx, atRisk.slice(0, RISK_MAX), "owner", "ownerName");
    const { rows: lateNamed } = await dir.decorate(bx, lateAnswered.slice(0, RISK_MAX), "owner", "ownerName");
    const { rows: lostNamed } = await dir.decorate(bx, lostRows.slice(0, LOST_MAX), "owner", "ownerName");

    const pct = (n, d) => (d ? +(n / d * 100).toFixed(1) : 0);
    const natija = {
      range: { from: R.from, to: R.to, days: R.days, label: R.label },
      measured: MEASURED,
      qongiroqBor, davrQongiroq, davrChiquvchi,
      totals: {
        real: real.length, answered,
        withinSla, breached,
        slaRate: answered ? pct(withinSla, answered) : null,   // TZI P0-01: javob berilgan lid yo'q — «o'lchanmadi», 0% emas
        atRisk: atRisk.length, atRiskListed: Math.min(atRisk.length, RISK_MAX),
        neverCalled: real.filter((l) => !firstOut.has(String(l.ID))).length,
      },
      atRisk: riskNamed,
      late: lateNamed,
      lost: {
        total: Math.max(Number(lost.total) || 0, lostRows.length),   // davrda yo'qotilgan — CRM'dagi haqiqiy soni
        sampled: lostRows.length,                                    // sababi tekshirilgani (odatda = total)
        withReason: lostRows.filter((r) => r.hasReason).length,
        withOfficial: lostRows.filter((r) => r.rasmiy).length,       // Odoo'da rasmiy sabab tanlangan
        withNote: lostRows.filter((r) => r.izoh.length >= 4).length, // izoh yozilgan
        rows: lostNamed,                                             // hammasi (2000 tagacha), sahifalash UI'da
      },
      portal: PORTAL,
    };
    // Explain oynasi uchun to'liq lid ro'yxati. enumerable: false — /api/sla JSON'iga chiqmaydi,
    // lekin keshdagi obyekt bilan birga turadi (explain qayta so'rov yubormaydi).
    Object.defineProperty(natija, "tafsil", { value: { lidlar: tafsilLid }, enumerable: false });
    return natija;
  });
};
