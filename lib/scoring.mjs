// M03 — Lid skoringi (TZ §6.3).
//
// MUHIM: birinchi variant TAXMIN asosida qurilgan edi (forma to'ldirgan = yaxshi lid,
// qo'ng'iroq = zaif lid) va TARIXDA SINALGANDA TESKARI chiqdi. Shuning uchun bu
// versiya butunlay o'lchangan natijaga qurilgan.
//
// Kalibrlash: 2026-09-05, 4 375 ta avtolidsiz lid, bazaviy konversiya 3.68%.
// Har koeffitsient — o'sha segmentning haqiqiy konversiyasi / bazaviy konversiya.
//
// O'lchangan natijalar taxminga zid chiqqan uchta joy:
//   1) Qo'ng'iroq lidlari (avtolidsiz) 7.16% — vebdan (1.56%) qariyb 5 barobar yaxshi
//   2) Forma to'ldirilgan lidlar 2.08%, to'ldirilmagani 4.59% — forma SALBIY belgi
//   3) Aylanma chiziqli emas: 5–50 mlrd eng yaxshi (5.28%), 50+ (0.49%) va
//      1 mlrd dan kam (0.35%) deyarli sotilmaydi
//
// Koeffitsientlar vaqt o'tishi bilan eskiradi — choraklik qayta kalibrlash kerak.
import { cached } from "./cache.mjs";
import * as rng from "./range.mjs";
import * as dir from "./directory.mjs";
import { leadOwn } from "./roles.mjs";

const TTL = 3 * 60e3;
const F = {
  pos: process.env.BX_FIELD_POSITION || "UF_CRM_SELECTBOX2",
  rev: process.env.BX_FIELD_REVENUE  || "UF_CRM_SELECTBOX3",
  svc: process.env.BX_FIELD_SERVICE  || "UF_CRM_SELECTBOX",
};
const AUTO_RE = /пропущенн|не ответил|исходящ|входящ|обратный звонок|javobsiz/i;

// --- kalibrlash ma'lumoti: [koeffitsient, namuna hajmi, o'lchangan %] ---
export const CALIB = {
  measuredAt: "2026-09-05",
  sample: 4375,
  baseRate: 3.68,
  best: 12.0,          // eng yaxshi real kombinatsiya: 3.68 × 1.94 × 1.43 × 1.18
  source: {
    CALL:        [1.94, 1523, 7.16],
    WEB:         [0.43, 1982, 1.56],
    WEBFORM:     [0.43, 1515, 1.52],
    "7":         [0.32,  854, 1.17],
    ADVERTISING: [0.32,  854, 1.17],
  },
  revenue: {
    "5-50": [1.43, 303, 5.28],
    "1-5":  [0.86, 474, 3.16],
    "50+":  [0.13, 203, 0.49],
    "<1":   [0.09, 579, 0.35],
  },
  service: {
    ekspres: [1.18, 208, 4.33],
    konsult: [0.73, 262, 2.67],
    hamroh:  [0.54, 202, 1.98],
    nizo:    [0.41, 133, 1.50],
    audit:   [0.37, 665, 1.35],
    optim:   [0.31,  87, 1.15],
  },
  // Bo'sh maydon jazolanmaydi: o'lchov bo'sh maydonli lidlar YAXSHIROQ
  // konversiya berishini ko'rsatdi (4.59% va 4.55%).
  emptyIsFine: true,
};

const norm = (v) => String(v ?? "").trim().toLowerCase();

function revBand(v) {
  const s = norm(v).replace(/[''`']/g, "'");
  if (!s) return null;
  if (/50\s*mlrd|50\s*млрд/.test(s) && /yuqori|ortiq|более|\+/.test(s)) return "50+";
  if (/5\s*[–-]\s*50/.test(s)) return "5-50";
  if (/1\s*[–-]\s*5/.test(s))  return "1-5";
  if (/kam|меньше|less/.test(s)) return "<1";
  return null;
}
function svcKey(v) {
  const s = norm(v);
  if (!s) return null;
  if (/ekspres|экспресс/.test(s)) return "ekspres";
  if (/konsul|консул/.test(s))    return "konsult";
  if (/hamroh|сопровожд/.test(s)) return "hamroh";
  if (/nizo|спорн/.test(s))       return "nizo";
  if (/optimal|оптимиз/.test(s))  return "optim";
  if (/audit|аудит/.test(s))      return "audit";
  return null;
}
const srcKey = (id) => {
  const s = String(id || "").toUpperCase();
  return CALIB.source[s] ? s : null;
};

// ================= KOMPANIYANING O'Z MA'LUMOTIDA KALIBRLASH =================
// Eski CALIB (yuqorida) boshqa CRM ma'lumotida qilingan va bu portal lidlariga
// belgilar mos kelmasligi mumkin — natijada hamma lid «Baholanmadi» bo'lardi.
// Bu yerda model kompaniyaning O'Z lidlarida o'lchanadi:
//   * Belgi: MANBA — lid yaratilgan paytda ma'lum, natijadan «oqib o'tmaydi» (leakage yo'q).
//     Tizim turi kabi maydonlar malakalashda to'ldiriladi, shuning uchun ATAYLAB olinmadi.
//   * Kalibrlash faqat 30 kundan ESKI lidlarda: yangi lidga sotilishga vaqt bo'lmagan.
//   * Faqat 30+ lidli manbalar — kichik namunadan xulosa chiqarilmaydi.
//   * Natija «nisbiy baho» (manbaning o'rtachaga nisbati), SOTIB OLISH EHTIMOLI EMAS.
// Vaqt bo'yicha tekshiruv (2026-09-23): kalibrlash davridagi tartib keyingi 30 kunda ham
// saqlandi — Instagram ikkalasida ham o'rtachadan past (0,91 / 0,89), Instagram Direct
// yuqori (1,30 / 1,20), «Менежер таниши» eng yuqori.
let SUN_KALIB = null, SUN_KALIB_AT = 0;
const KALIB_TTL = 6 * 3600e3, MIN_NAMUNA = 30, PISHISH_KUN = 30;

export async function kalibrlash(bx) {
  if (SUN_KALIB && Date.now() - SUN_KALIB_AT < KALIB_TTL) return SUN_KALIB;
  try {
    const chek = new Date(Date.now() - PISHISH_KUN * 864e5).toISOString().slice(0, 10);
    const { items } = await bx.listAll("crm.lead.list", {
      filter: { "<DATE_CREATE": `${chek}T00:00:00+05:00` },
      select: ["ID", "TITLE", "SOURCE_ID", "SOURCE_DESCRIPTION", "STATUS_SEMANTIC_ID", "PHONE"],
      order: { ID: "ASC" }, maxItems: 20000,
    });
    const real = items.filter((l) => !AUTO_RE.test(String(l.TITLE || "")));
    const konv = (arr) => arr.length ? arr.filter((l) => l.STATUS_SEMANTIC_ID === "S").length / arr.length : 0;
    const baza = konv(real);
    if (!real.length || !baza) return SUN_KALIB;
    const by = new Map();
    for (const l of real) {
      const k = String(l.SOURCE_ID || ""); if (!k) continue;
      const a = by.get(k) || { nom: l.SOURCE_DESCRIPTION || k, arr: [] };
      a.arr.push(l); by.set(k, a);
    }
    const manba = {};
    for (const [k, a] of by) if (a.arr.length >= MIN_NAMUNA) {
      const r = konv(a.arr);
      manba[k] = { nom: a.nom, n: a.arr.length, foiz: +(r * 100).toFixed(1), lift: +(r / baza).toFixed(2) };
    }
    const telBor = (l) => { const p = l.PHONE; return Array.isArray(p) ? p.some((x) => x && (x.VALUE || x)) : !!p; };
    const t1 = real.filter(telBor), t0 = real.filter((l) => !telBor(l));
    SUN_KALIB = {
      baza: +(baza * 100).toFixed(2), n: real.length, chek, manba,
      telefonYoq: t0.length >= MIN_NAMUNA ? +(konv(t0) / baza).toFixed(2) : null,
      eng: Math.max(1, ...Object.values(manba).map((m) => m.lift)),
      at: new Date().toISOString(),
    };
    SUN_KALIB_AT = Date.now();
  } catch { /* kalibrlash ishlamasa — eski holat (Baholanmadi) qoladi, panel yolg'on ball bermaydi */ }
  return SUN_KALIB;
}
export const kalibHolati = () => SUN_KALIB;

// Kompaniya modeli bo'yicha baho. Manba kalibrlanmagan bo'lsa — null (eski yo'lga tushadi).
function sunBaho(l) {
  const K = SUN_KALIB; if (!K) return null;
  const m = K.manba[String(l.SOURCE_ID || "")]; if (!m) return null;
  let lift = m.lift;
  const reasons = [`Manba «${m.nom}»: shu kompaniyada o'lchangan konversiya ${m.foiz}% (o'rtacha ${K.baza}%, ${m.n} lid) — o'rtachaning ${m.lift} barobari`];
  const tel = Array.isArray(l.PHONE) ? l.PHONE.some((x) => x && (x.VALUE || x)) : !!l.PHONE;
  if (!tel && K.telefonYoq) { lift *= K.telefonYoq; reasons.push(`Telefon raqami yo'q — bunday lidlar o'rtachaning ${K.telefonYoq} barobari sotiladi`); }
  const total = Math.max(1, Math.min(100, Math.round(lift / K.eng * 100)));
  const grade = lift >= 1.25 ? "HOT" : lift >= 0.95 ? "WARM" : lift >= 0.6 ? "COLD" : "PAST";
  reasons.push("Bu nisbiy baho (manbaning o'rtachaga nisbati), sotib olish ehtimoli emas.");
  return { total, grade, lift: +lift.toFixed(2), reasons, factors: [{ label: "Manba", lift: m.lift, n: m.n, rate: m.foiz }] };
}

export function scoreLead(l) {
  const isAuto = AUTO_RE.test(String(l.TITLE || ""));
  // Avval kompaniyaning o'z ma'lumotida kalibrlangan model (agar manba o'lchangan bo'lsa)
  if (!isAuto) {
    const sb = sunBaho(l);
    if (sb) {
      const age = l.DATE_CREATE ? Math.floor((Date.now() - new Date(l.DATE_CREATE).getTime()) / 864e5) : 999;
      return { total: sb.total, grade: sb.grade, isAuto: false, signals: 1, factors: sb.factors,
               reasons: sb.reasons, stale: age > 30, ageDays: age, expected: null, model: "sun" };
    }
  }
  const reasons = [], factors = [];
  let expected = CALIB.baseRate;

  const apply = (label, entry, note) => {
    if (!entry) return;
    const [lift, n, rate] = entry;
    expected *= lift;
    factors.push({ label, lift, n, rate });
    reasons.push(`${note} — o'lchangan ${rate}% (×${lift}, ${n} lid)`);
  };

  const sk = srcKey(l.SOURCE_ID);
  apply("Manba", sk && CALIB.source[sk],
    sk === "CALL" ? "Jonli qo'ng'iroq" : sk === "WEB" || sk === "WEBFORM" ? "Veb/forma" : "Reklama");

  const rb = revBand(l[F.rev]);
  apply("Aylanma", rb && CALIB.revenue[rb],
    rb === "5-50" ? "Aylanma 5–50 mlrd (eng yaxshi segment)"
    : rb === "50+" ? "Aylanma 50 mlrd dan yuqori — deyarli sotilmaydi"
    : rb === "<1" ? "Aylanma 1 mlrd dan kam — deyarli sotilmaydi"
    : "Aylanma 1–5 mlrd");

  const svk = svcKey(l[F.svc]);
  apply("Xizmat", svk && CALIB.service[svk], `Xizmat: ${l[F.svc]}`);

  if (!rb && !svk) reasons.push("Forma to'ldirilmagan — bu salbiy belgi emas, o'lchovda bunday lidlar yaxshiroq sotilgan");

  // TZI P1-03 / F03: model AYNAN shu lidda nechta belgini tanidi?
  // Bittasi ham tanilmasa — ball bazaviy darajada qotib qoladi va HAMMA lid bir xil
  // «Iliq» bo'lib chiqadi. Bu baho emas, ma'lumot yo'qligi. Shuning uchun ball berilmaydi.
  const signals = [sk, rb, svk].filter(Boolean).length;

  // Lid yoshi BALLGA KIRMAYDI. Sabab: tarixiy tekshiruvda eski lidlar tabiiy ravishda
  // yaxshi ko'rinadi — ularga sotilishga ko'proq vaqt bo'lgan. Yoshni ballga qo'shsak,
  // model sifatni emas, vaqtni o'lchaydi. Shuning uchun u alohida belgi sifatida beriladi.
  const age = l.DATE_CREATE ? Math.floor((Date.now() - new Date(l.DATE_CREATE).getTime()) / 864e5) : 999;
  const stale = age > 30;

  let total = Math.max(0, Math.min(100, Math.round(expected / CALIB.best * 100)));
  if (isAuto) {
    total = 0; expected = 0;
    reasons.length = 0;
    reasons.push("Telefoniya avtomatik yaratgan yozuv — mijoz murojaati emas");
  } else if (!signals) {
    // Belgi yo'q — sun'iy ball bermaymiz.
    total = null; expected = null;
    reasons.length = 0;
    reasons.push("Baholash uchun ma'lumot yetarli emas: model tanigan belgilar (manba turi, "
      + "aylanma, xizmat turi) bu lidda to'ldirilmagan yoki CRM'da bu maydonlar yo'q.");
    reasons.push("Bo'sh maydon SALBIY belgi deb olinmadi — lid shunchaki baholanmadi.");
  }
  const grade = isAuto ? "AUTO"
    : total === null ? "NOMALUM"
    : total >= 55 ? "HOT" : total >= 30 ? "WARM" : total >= 12 ? "COLD" : "PAST";
  return { total, grade, isAuto, signals, factors, reasons, stale, ageDays: age,
           expected: expected === null ? null : +expected.toFixed(2) };
}

export const leadScores = (bx, owner = null, range) => {
  const R = rng.normalize(range, 30);
  return cached(`score2:${owner || "all"}:${R.key}`, TTL, async () => {
    await kalibrlash(bx);
    const { items, total } = await bx.listAll("crm.lead.list", {
      filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO,
                ...leadOwn(owner) },
      select: ["ID", "TITLE", "NAME", "LAST_NAME", "COMPANY_TITLE", "SOURCE_ID", "STATUS_ID",
               "STATUS_SEMANTIC_ID", "DATE_CREATE", "ASSIGNED_BY_ID", F.pos, F.rev, F.svc,
               // TZI P1-03: qoidaviy navbat uchun shu CRM'da HAQIQATAN bor maydonlar
               "PHONE", "EMAIL", "OPPORTUNITY", "UF_CRM_TARIF", "UF_CRM_CALLS", "ADDRESS_CITY", "SOURCE_DESCRIPTION"],
      order: { DATE_CREATE: "DESC" }, maxItems: Math.min(3000, Math.max(800, R.days * 40)),
    });

    // --- TZI P1-03: tushuntiriladigan QOIDAVIY NAVBAT ---
    // Model ball bera olmaganda ham sotuvchi kimdan boshlashini bilishi kerak.
    // Bu ehtimollik emas — har mezon CRM'dagi aniq maydon bor-yo'qligiga qarab belgilanadi.
    const bor = (v) => {
      if (v === null || v === undefined) return false;
      if (Array.isArray(v)) return v.some((x) => String(x?.VALUE ?? x ?? "").trim() !== "");
      return String(v).trim() !== "";
    };
    const mezonlar = (l) => [
      { k: "aloqa",  ok: bor(l.PHONE) || bor(l.EMAIL), matn: "Aloqa ma'lumoti bor (telefon yoki e-pochta)" },
      { k: "ehtiyoj", ok: bor(l[F.svc]),               matn: "Tizim turi aniqlangan (On-Grid / Gibrid / Off-Grid)" },
      { k: "summa",  ok: Number(l.OPPORTUNITY || 0) > 0, matn: "Kutilayotgan summa kiritilgan" },
      { k: "tip",    ok: bor(l[F.pos]),                matn: "Mijoz turi belgilangan" },
      { k: "gaplashilgan", ok: Number(l.UF_CRM_CALLS || 0) > 0, matn: "Qo'ng'iroq qilingan" },
      { k: "hudud",  ok: bor(l.ADDRESS_CITY),          matn: "Hudud ko'rsatilgan" },
    ];

    const scored = items.map((l) => {
      const s = scoreLead(l);
      const mz = mezonlar(l);
      const tayyor = mz.filter((m) => m.ok).length;
      return {
        tayyorlik: tayyor, mezonJami: mz.length,
        bajarilgan: mz.filter((m) => m.ok).map((m) => m.matn),
        yetishmaydi: mz.filter((m) => !m.ok).map((m) => m.matn),
        id: l.ID,
        title: l.COMPANY_TITLE || [l.NAME, l.LAST_NAME].filter(Boolean).join(" ") || l.TITLE || `Lid #${l.ID}`,
        owner: String(l.ASSIGNED_BY_ID || "?"),
        source: String(l.SOURCE_ID || ""), sourceName: String(l.SOURCE_DESCRIPTION || l.SOURCE_ID || ""),
        semantic: l.STATUS_SEMANTIC_ID,
        createdAt: l.DATE_CREATE, ...s,
      };
    });
    const auto = scored.filter((s) => s.isAuto);
    const real = scored.filter((s) => !s.isAuto);
    const by = (g) => real.filter((s) => s.grade === g);
    const pct = (n, d) => (d ? +(n / d * 100).toFixed(1) : 0);

    // TZI P1-03: baholanmagan lidlar alohida guruh; ular «Iliq» ichiga qo'shilmaydi.
    const scoredReal = real.filter((s) => s.total !== null);
    const grades = ["HOT", "WARM", "COLD", "PAST", "NOMALUM"].map((g) => {
      const set = by(g), conv = set.filter((s) => s.semantic === "S").length;
      return { grade: g, count: set.length, share: pct(set.length, real.length),
               converted: conv, convRate: pct(conv, set.length) };
    });
    const top = scoredReal.filter((s) => s.grade === "HOT" || s.grade === "WARM")
      .sort((a, b) => b.total - a.total).slice(0, 40);

    const { rows: owners } = await dir.decorate(bx,
      Object.values(real.reduce((m, s) => {
        (m[s.owner] ||= { owner: s.owner, leads: 0, hot: 0, warm: 0, sum: 0, scored: 0 });
        m[s.owner].leads++;
        if (s.total !== null) { m[s.owner].sum += s.total; m[s.owner].scored++; }
        if (s.grade === "HOT") m[s.owner].hot++;
        if (s.grade === "WARM") m[s.owner].warm++;
        return m;
      }, {})).map((o) => ({ ...o, avg: o.scored ? Math.round(o.sum / o.scored) : null }))
        .sort((a, b) => b.leads - a.leads).slice(0, 12), "owner", "ownerName");

    // --- Manba bo'yicha SHU CRM'da o'lchangan konversiya (kuzatuv, bashorat emas) ---
    const mAgg = new Map();
    for (const x of real) {
      const id = x.source || "NOMALUM";
      if (!mAgg.has(id)) mAgg.set(id, { manba: id, nom: x.sourceName || id, lid: 0, bitim: 0 });
      const a = mAgg.get(id); a.lid++; if (x.semantic === "S") a.bitim++;
    }
    const MIN_NAMUNA = 30;   // bundan kichik namunadan xulosa chiqarilmaydi
    const manbaStat = [...mAgg.values()]
      .map((a) => ({ ...a, konv: a.lid ? +(a.bitim / a.lid * 100).toFixed(2) : null,
                     ishonchli: a.lid >= MIN_NAMUNA }))
      .sort((a, b) => b.lid - a.lid);
    const manbaKonv = new Map(manbaStat.filter((m) => m.ishonchli).map((m) => [m.manba, m.konv]));

    // --- Navbat: avval mezonlari ko'p, so'ng o'lchangan manbasi kuchli, so'ng yangi lid ---
    const navbatXom = real
      .filter((x) => x.semantic === "P")           // hali jarayonda turganlar
      .map((x) => ({ ...x, manbaKonv: manbaKonv.has(x.source) ? manbaKonv.get(x.source) : null }))
      .sort((a, b) => (b.tayyorlik - a.tayyorlik)
                   || ((b.manbaKonv ?? -1) - (a.manbaKonv ?? -1))
                   || (a.ageDays - b.ageDays))
      .slice(0, 40)
      .map((x) => ({ id: x.id, title: x.title, owner: x.owner,
                     source: x.source, sourceName: x.sourceName, manbaKonv: x.manbaKonv, ageDays: x.ageDays,
                     tayyorlik: x.tayyorlik, mezonJami: x.mezonJami,
                     bajarilgan: x.bajarilgan, yetishmaydi: x.yetishmaydi,
                     keyingiQadam: x.yetishmaydi[0]
                       ? `CRM'da to'ldiring: ${x.yetishmaydi[0].toLowerCase()}`
                       : "Ma'lumot to'liq — bog'laning va taklif tayyorlang" }));
    const { rows: navbat } = await dir.decorate(bx, navbatXom, "owner", "ownerName");

    const convReal = real.filter((s) => s.semantic === "S").length;
    return {
      range: { from: R.from, to: R.to, days: R.days, label: R.label },
      calib: { measuredAt: CALIB.measuredAt, sample: CALIB.sample, baseRate: CALIB.baseRate },
      // Kompaniyaning o'z modeli: qaysi manbalar o'lchandi, namuna va nisbiy ko'rsatkich
      sunModel: SUN_KALIB ? { baza: SUN_KALIB.baza, n: SUN_KALIB.n, chek: SUN_KALIB.chek, at: SUN_KALIB.at,
        manbalar: Object.values(SUN_KALIB.manba).sort((a, b) => b.lift - a.lift) } : null,
      totals: {
        all: scored.length, auto: auto.length, autoShare: pct(auto.length, scored.length),
        real: real.length,
        // TZI P0-05: qamrov ochiq ko'rsatiladi — nechta lid umuman baholandi.
        scored: scoredReal.length,
        unscored: real.length - scoredReal.length,
        scoredShare: pct(scoredReal.length, real.length),
        avgScore: scoredReal.length
          ? Math.round(scoredReal.reduce((a, s) => a + s.total, 0) / scoredReal.length) : null,
        convertedReal: convReal,
        convRateReal: pct(convReal, real.length),
        convRateMixed: pct(scored.filter((s) => s.semantic === "S").length, scored.length),
      },
      grades, top, owners, capped: items.length < total, listed: items.length, crmTotal: total,
      // TZI P1-03: ball ishlamaganda ham ishlaydigan, har qatori tushuntiriladigan navbat.
      navbat, manbaStat, minNamuna: MIN_NAMUNA,
      navbatIzoh: "Bu navbat sotib olish ehtimoli EMAS. U CRM'da qaysi ma'lumot to'ldirilganiga "
        + "qarab tuziladi: mezonlari ko'p lid birinchi turadi. Manba konversiyasi shu davrdagi "
        + `kuzatuv (kamida ${MIN_NAMUNA} lid bo'lgan manbalar uchun), kelajak kafolati emas.`,
      // Model qaysi maydonlarga tayanadi va ular shu CRM'da bormi — ochiq aytiladi.
      signalFields: { manba: "SOURCE_ID", aylanma: F.rev, xizmat: F.svc },
      signalCoverage: {
        manba: real.filter((s) => srcKey(s.source)).length,
        belgisiz: real.length - scoredReal.length,
      },
    };
  });
};
