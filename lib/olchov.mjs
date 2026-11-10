// Sotuv Web v2 — yagona ko'rsatkichlar (2026-10-03). SPEC §4: bitta nomli raqam — bitta ta'rif, hamma sahifada.
//
// Ta'riflar (egasi tasdiqlagan):
//   Yangi lid        — davrda yaratilgan «Tushgan Lead» (Odoo 1006 plitkasi bilan bir xil domen)
//   Menejerga uzatildi — davrda imkoniyatga aylantirilgan va hozir ham imkoniyat (date_conversion + type; Odoo 863 plitkasi)
//   Uzatish %        — uzatildi ÷ yangi lid (davr bo'yicha voqealar)
//   Qo'ng'iroqsiz    — davrda kelgan, hali ochiq va bironta qo'ng'iroq yozuvi yo'q lid
//   Javobsiz >24 soat — ochiq, 24 soatdan oshgan, chiquvchi javob berilgan qo'ng'iroq yo'q (sla.mjs, oxirgi 30 kun)
//   Sotuv · oy       — joriy oyda yutilgan bitimlar summasi (so'm), prognoz = sur'at bo'yicha (fakt ÷ o'tgan kun × oy kunlari)
//   To'lov kutilmoqda — «Шартнома берилди» bosqichidagi ochiq bitimlar (arxivsiz, so'm), «hozir»
//   Ball             — tahlil qilingan barcha suhbatlar o'rtachasi (/100)
// Hamma «jami» shu yerda — brauzer birinchi sahifadan sanamaydi.
import { cached } from "./cache.mjs";
import * as rng from "./range.mjs";
import { leadOwn, isOp } from "./roles.mjs";
import { tashkentNow, ymd } from "./bitrix.mjs";
import * as sla from "./sla.mjs";
import * as calls from "./calls.mjs";
import * as sifat from "./sifat.mjs";
// The Odoo daily report (kunlik.mjs) is gone: today's date comes from range.mjs, the report answers "not connected".
const kunlik = { bugun: () => rng.today(), hisobot: async () => ({ ulangan: false, sabab: "Kunlik hisobot (Odoo) bu panelda yo'q" }) };
import * as voronka from "./voronka.mjs";
import { dicts } from "./api.mjs";
import * as dir from "./directory.mjs";


const TTL = 60e3, DAY = 864e5;
export const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const ts = (s) => { const x = Date.parse(s || ""); return Number.isFinite(x) ? x : null; };
const tkIso = (ms) => new Date(ms + 5 * 3600e3).toISOString().slice(0, 19) + "+05:00";
// AI ba'zan bo'sh maydonga «null» deb yozadi — yo'q hisoblanadi
export const bor = (v) => v != null && !/^(null|none|undefined|n\/a|yo.?q|—|-|\s*)$/i.test(String(v).trim());

// Oldingi teng davr (taqqoslash uchun): kalendar oraliq — oldingi shuncha kun; «oxirgi N kun» — undan oldingi N×24 soat
export function oldingi(R) {
  if (R.rolling) {
    const a = Date.parse(R.fromISO), b = Date.parse(R.toISO), d = b - a;
    return { ...R, fromISO: tkIso(a - d), toISO: tkIso(a), from: tkIso(a - d).slice(0, 10), to: tkIso(a).slice(0, 10), key: `${R.key}~old` };
  }
  const sh = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
  return rng.normalize({ from: sh(R.from, -R.days), to: sh(R.from, -1) });
}

// ---------------------------------------------------------------- lidlar
export const lid = (bx, R, owner = null) => cached(`olc:lid:${owner || "all"}:${R.key}`, TTL, async () => {
  const own = leadOwn(owner), dav = { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO };
  const [yangi, uzatildi, qongiroqsiz] = await Promise.all([
    bx.count("crm.lead.list", { ...dav, ...own }),
    bx.count("crm.lead.list", { ">=UF_CRM_CONVERTED_AT": R.fromISO, "<=UF_CRM_CONVERTED_AT": R.toISO, UF_CRM_TYPE: "opportunity", ...own }),   // Odoo #863 kabi
    bx.count("crm.lead.list", { ...dav, STATUS_SEMANTIC_ID: "P", UF_CRM_CALLS_N: 0, ...own }),
  ]);
  return { yangi, uzatildi, qongiroqsiz, uzatishPct: yangi >= 10 && uzatildi <= yangi ? pct(uzatildi, yangi) : null };
});

// Javobsiz >24 soat — oxirgi 30 kun («30 kun» tugmasi oynasi), hozirgi holat
export const javobsiz = (bx, owner = null) => sla.slaCheck(bx, owner, rng.rolling(30)).then((s) => ({
  soni: s?.totals?.atRisk ?? 0,
  engEski: s?.atRisk?.[0] ? Math.round(s.atRisk[0].hours) : null,
  kim: s?.atRisk?.[0]?.ownerName || null,
}));

// ---------------------------------------------------------------- sotuv (oy) va reja sur'ati
export const sotuv = (bx, db) => cached(`olc:sotuv:${ymd(tashkentNow())}`, 2 * 60e3, async () => {
  const now = tashkentNow(), oy = ymd(now).slice(0, 7);
  const r = await bx.listAll("crm.deal.list", {
    filter: { STAGE_SEMANTIC_ID: "S", ">=CLOSEDATE": `${oy}-01T00:00:00+05:00` },
    select: ["ID", "OPPORTUNITY", "CURRENCY_ID", "CLOSEDATE"], order: { CLOSEDATE: "ASC" }, maxItems: 5000,
  });
  const kunlar = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).getUTCDate(), bugunKun = now.getDate();
  const kun = new Array(kunlar).fill(0); let fakt = 0, soni = 0, boshqa = 0;
  for (const d of r.items) {
    if ((d.CURRENCY_ID || "UZS") !== "UZS") { boshqa++; continue; }
    const a = Number(d.OPPORTUNITY) || 0, c = ts(d.CLOSEDATE);
    fakt += a; soni++;
    if (c != null) { const dd = new Date(c + 5 * 3600e3).getUTCDate(); if (dd >= 1 && dd <= kunlar) kun[dd - 1] += a; }
  }
  let s = 0; const kumulyativ = kun.slice(0, bugunKun).map((v) => (s += v));
  const reja = Number(db.prepare("SELECT value FROM settings WHERE key='plan_month'").get()?.value || 0) || null;
  // Prognoz oyning 7-kunidan: undan oldin 1–2 bitimdan chiziladigan «sur'at» chalg'itadi
  const prognoz = bugunKun >= 7 ? Math.round((fakt / bugunKun) * kunlar) : null;
  return { oy, fakt, soni, boshqaValyuta: boshqa, reja, rejaPct: reja ? pct(fakt, reja) : null,
           prognoz, prognozPct: reja && prognoz != null ? pct(prognoz, reja) : null, kunlar, bugunKun, kumulyativ };
});

// ---------------------------------------------------------------- ochiq bitimlar: to'lov kutilmoqda, qotib qolganlar
const ochiqBitimlar = (bx, owner = null) => cached(`olc:ochiq:${owner || "all"}`, 2 * 60e3, async () => {
  const own = owner && !isOp(owner) ? { ASSIGNED_BY_ID: owner } : owner ? { ASSIGNED_BY_ID: "__none__" } : {};
  const r = await bx.listAll("crm.deal.list", {
    filter: { CLOSED: "N", ...own },
    select: ["ID", "TITLE", "STAGE_ID", "CATEGORY_ID", "OPPORTUNITY", "CURRENCY_ID", "MOVED_TIME", "DATE_CREATE", "ASSIGNED_BY_ID"],
    order: { ID: "DESC" }, maxItems: 5000,
  });
  const yil = Date.now() - 365 * DAY;
  return r.items.filter((d) => (ts(d.MOVED_TIME) ?? ts(d.DATE_CREATE) ?? Date.now()) >= yil);   // arxivsiz (1 yildan eski — arxiv)
});
export const tolov = (bx, owner = null) => ochiqBitimlar(bx, owner).then((rows) => {
  const st = rows.filter((d) => /(^|:)PREPAYMENT_INVOICE$/.test(String(d.STAGE_ID)) && (d.CURRENCY_ID || "UZS") === "UZS");
  const kun = (d) => Math.floor((Date.now() - (ts(d.MOVED_TIME) ?? Date.now())) / DAY);
  return { soni: st.length, summa: st.reduce((a, d) => a + (Number(d.OPPORTUNITY) || 0), 0), kech: st.filter((d) => kun(d) > 30).length,
           items: st.map((d) => ({ id: d.ID, nom: d.TITLE, summa: Number(d.OPPORTUNITY) || 0, kun: kun(d) })).sort((a, b) => b.summa - a.summa).slice(0, 50) };
});
export const qotgan = (bx, owner = null, idle = 14) => ochiqBitimlar(bx, owner).then((rows) => {
  const q = rows.filter((d) => Date.now() - (ts(d.MOVED_TIME) ?? Date.now()) >= idle * DAY);
  return { soni: q.length, idle };
});

// ---------------------------------------------------------------- Bitimlar «Umumiy» (v2): hozirgi ochiq bitimlar — bitta ro'yxatdan
const dealOwnF = (owner) => (owner && !isOp(owner) ? { ASSIGNED_BY_ID: owner } : owner ? { ASSIGNED_BY_ID: "__none__" } : {});
const uzsOf = (d) => ((d.CURRENCY_ID || "UZS") === "UZS" ? Number(d.OPPORTUNITY) || 0 : 0);
const harakatsiz = (d) => Math.floor((Date.now() - (ts(d.MOVED_TIME) ?? ts(d.DATE_CREATE) ?? Date.now())) / DAY);
// Yutilgan bitimlar (davr yoki joriy oy) — «Sotuv · oy» bilan bir xil filtr: yutilgan bosqich + yopilish sanasi, faqat so'm
const yutilgan = (bx, from, to, owner = null) => cached(`olc:yut:${owner || "all"}:${from}:${to || ""}`, 2 * 60e3, async () => {
  const r = await bx.listAll("crm.deal.list", {
    filter: { STAGE_SEMANTIC_ID: "S", ">=CLOSEDATE": from, ...(to ? { "<=CLOSEDATE": to } : {}), ...dealOwnF(owner) },
    select: ["ID", "OPPORTUNITY", "CURRENCY_ID", "ASSIGNED_BY_ID"], maxItems: 5000,
  });
  return r.items.filter((x) => (x.CURRENCY_ID || "UZS") === "UZS");
});
export const bitimlar = (bx, owner = null, idle = 14) => cached(`olc:bitim:${owner || "all"}:${idle}`, 2 * 60e3, async () => {
  const oy = ymd(tashkentNow()).slice(0, 7);
  const [rows, d, Y] = await Promise.all([ochiqBitimlar(bx, owner), dicts(bx).catch(() => ({ stages: {} })), yutilgan(bx, `${oy}-01T00:00:00+05:00`, null, owner)]);
  // Bosqichlar — CRM tartibida, nomi CRM'dan
  const tartib = new Map(), nomi = new Map(); let t = 0;
  for (const list of Object.values(d.stages || {})) for (const st of list) if (!tartib.has(st.id)) { tartib.set(st.id, t++); nomi.set(st.id, st.name); }
  const B = new Map(), M = new Map(), Q = [];
  let summa = 0, summasiz = 0;
  for (const x of rows) {
    const s = uzsOf(x), k = harakatsiz(x), st = String(x.STAGE_ID), m = String(x.ASSIGNED_BY_ID || "");
    summa += s; if (!s) summasiz++;
    // bir xil nomli bosqichlar (Odoo'da turli jamoalarda «Сотув бўлими») — bitta qator
    const bn = nomi.get(st) || st, b = B.get(bn) || { id: st, nom: bn, soni: 0, summa: 0, qotgan: 0 }; b.soni++; b.summa += s; if (k >= idle) b.qotgan++; B.set(bn, b);
    const o = M.get(m) || { id: m, soni: 0, summa: 0, qotgan: 0 }; o.soni++; o.summa += s; if (k >= idle) o.qotgan++; M.set(m, o);
    if (k >= idle) Q.push({ id: String(x.ID), nom: x.TITLE || `Bitim #${x.ID}`, bosqich: nomi.get(st) || st, summa: s, kun: k, masul: m });
  }
  const ism = (await dir.names(bx, [...M.keys()]).catch(() => ({ names: {} }))).names || {};
  const masul = [...M.values()].map((o) => ({ ...o, ism: ism[o.id] || (o.id ? `#${o.id}` : "Mas'ulsiz") })).sort((a, b) => b.soni - a.soni || b.summa - a.summa);
  for (const q of Q) q.masulNom = ism[q.masul] || (q.masul ? `#${q.masul}` : "—");
  Q.sort((a, b) => b.summa - a.summa || b.kun - a.kun);
  const qs = Q.reduce((a, q) => a + q.summa, 0);
  return { soni: rows.length, summa, summasiz, idle,
    qotgan: { soni: Q.length, summa: qs }, yutildi: { oy, soni: Y.length, summa: Y.reduce((a, x) => a + (Number(x.OPPORTUNITY) || 0), 0) },
    bosqich: [...B.values()].sort((a, b) => (tartib.get(a.id) ?? 999) - (tartib.get(b.id) ?? 999)),
    masul: owner ? [] : masul, qotganlar: Q.slice(0, 3000) };
});

// ---------------------------------------------------------------- Jamoa (v2): xodim kartalari — davr bo'yicha
// Operator — davrda kelgan lidlarida «Оператор» bo'lganlar; menejer — ochiq yoki davrda yutilgan bitimi borlar.
export const jamoa = (bx, db, R) => cached(`olc:jamoa:${R.key}`, 2 * 60e3, async () => {
  const [L, U, C, Q, D, W] = await Promise.all([
    bx.listAll("crm.lead.list", { filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO }, select: ["ID", "UF_CRM_OPERATOR", "UF_CRM_OPERATOR_NAME"], maxItems: 50000 }),
    bx.listAll("crm.lead.list", { filter: { ">=UF_CRM_CONVERTED_AT": R.fromISO, "<=UF_CRM_CONVERTED_AT": R.toISO, UF_CRM_TYPE: "opportunity" }, select: ["ID", "UF_CRM_OPERATOR"], maxItems: 50000 }),
    calls.calls(bx, R, null).catch(() => null),
    calls.leaderQuality(bx, db, { range: R }).catch(() => null),
    ochiqBitimlar(bx, null),
    yutilgan(bx, R.fromISO, R.toISO, null),
  ]);
  const opNom = new Map(), op = new Map();
  const g = (id) => { if (!op.has(id)) op.set(id, { id, yangi: 0, uzatildi: 0 }); return op.get(id); };
  for (const x of L.items) { const id = String(x.UF_CRM_OPERATOR || ""); if (!id) continue; g(id).yangi++; if (x.UF_CRM_OPERATOR_NAME && !opNom.has(id)) opNom.set(id, x.UF_CRM_OPERATOR_NAME); }
  for (const x of U.items) { const id = String(x.UF_CRM_OPERATOR || ""); if (id) g(id).uzatildi++; }
  const CA = new Map((C?.owners || []).map((o) => [String(o.owner), o])), QA = new Map((Q?.owners || []).map((o) => [String(o.owner), o]));
  const mg = new Map(), m = (id) => { if (!mg.has(id)) mg.set(id, { id, ochiq: 0, summa: 0, qotgan: 0, yutildi: 0, yutSumma: 0 }); return mg.get(id); };
  for (const x of D) { const id = String(x.ASSIGNED_BY_ID || ""); if (!id || op.has(id)) continue; const o = m(id); o.ochiq++; o.summa += uzsOf(x); if (harakatsiz(x) >= 14) o.qotgan++; }
  for (const x of W) { const id = String(x.ASSIGNED_BY_ID || ""); if (!id || op.has(id)) continue; const o = m(id); o.yutildi++; o.yutSumma += Number(x.OPPORTUNITY) || 0; }
  const ism = (await dir.names(bx, [...op.keys(), ...mg.keys()]).catch(() => ({ names: {} }))).names || {};
  const nom = (id) => opNom.get(id) || CA.get(id)?.ownerName || QA.get(id)?.ownerName || ism[id] || `#${id}`;
  const qong = (id) => { const c = CA.get(id); return c ? { qongiroq: c.total, javobPct: c.total ? pct(c.total - c.missed, c.total) : null, suhbat: c.avgDur || null } : { qongiroq: 0, javobPct: null, suhbat: null }; };
  const bal = (id) => { const q = QA.get(id); return { ball: q?.avg ?? null, tahlil: q?.n || 0 }; };
  const operatorlar = [...op.values()].map((o) => ({ ...o, ism: nom(o.id), uzatishPct: o.yangi >= 10 && o.uzatildi <= o.yangi ? pct(o.uzatildi, o.yangi) : null, ...qong(o.id), ...bal(o.id) }))
    .sort((a, b) => b.uzatildi - a.uzatildi || (b.ball ?? -1) - (a.ball ?? -1) || b.yangi - a.yangi);
  const menejerlar = [...mg.values()].map((o) => ({ ...o, ism: nom(o.id), ...qong(o.id), ...bal(o.id) }))
    .sort((a, b) => b.yutSumma - a.yutSumma || b.yutildi - a.yutildi || b.ochiq - a.ochiq);
  return { range: rng.pub(R), operatorlar, menejerlar };
});

// ---------------------------------------------------------------- qo'ng'iroq sifati
export const ball = (bx, db, R, owner = null) =>
  calls.qualityKpi(bx, db, { range: R, owner }).then((k) => ({
    ortacha: k?.avgScore ?? null, tahlil: k?.analyzed ?? 0,
    keyingiQadamsiz: k?.noNextStep ?? null, keyingiQadamsizPct: k?.analyzed ? pct(k.noNextStep || 0, k.analyzed) : null,
    kritik: k?.critical ?? null,
  }));

// ---------------------------------------------------------------- sifatli, lekin uzatilmagan (AI bahosi bo'yicha, oxirgi 30 kun)
export const sifatliUzatilmagan = (bx, db, owner = null) => cached(`olc:sifu:${owner || "all"}`, 3 * 60e3, async () => {
  const R = rng.rolling(30);
  const r = await bx.listAll("crm.lead.list", {
    filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO, STATUS_SEMANTIC_ID: "P", ...leadOwn(owner) },
    select: ["ID", "UF_CRM_OPERATOR_NAME", "UF_CRM_TYPE"], maxItems: 5000,
  });
  const ochiq = r.items.filter((x) => x.UF_CRM_TYPE !== "opportunity");
  const Q = sifat.ofLeads(db, ochiq.map((x) => String(x.ID)));
  const sif = ochiq.filter((x) => Q.get(String(x.ID))?.verdict === "sifatli");
  const by = new Map(); for (const x of sif) { const n = x.UF_CRM_OPERATOR_NAME || "Operator tanlanmagan"; by.set(n, (by.get(n) || 0) + 1); }
  const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  return { soni: sif.length, kim: top ? top[0] : null, kimSoni: top ? top[1] : 0, ids: sif.map((x) => String(x.ID)) };
});

// ---------------------------------------------------------------- voronka (30 kun, qisqa)
export const voronkaQisqa = (bx, db, owner = null) =>
  voronka.voronka(bx, db, { range: rng.rolling(30), owner }).then((v) => {
    const by = new Map((v?.bosqichlar || []).map((b) => [b.key, b]));
    const bosqich = ["tushgan", "boglandi", "uzatildi", "kp", "uchrashuv", "tolov"].map((k) => by.get(k)).filter(Boolean)
      .map((b) => ({ key: b.key, nom: b.nom, soni: b.yetdi }));
    for (let i = 1; i < bosqich.length; i++) bosqich[i].otish = pct(bosqich[i].soni, bosqich[i - 1].soni);
    let eng = null;   // eng katta yo'qotish: avvalgi bosqichda ≥10 lid bo'lganda, eng ko'p tushib qolgan joy
    for (let i = 1; i < bosqich.length; i++) {
      const tushdi = bosqich[i - 1].soni - bosqich[i].soni;
      if (bosqich[i - 1].soni >= 10 && (!eng || tushdi > eng.tushdi)) eng = { i, tushdi };
    }
    if (eng) bosqich[eng.i].engKatta = true;
    return { bosqich, jami: bosqich[0]?.soni || 0, yutildi: bosqich.at(-1)?.soni || 0, range: v?.range || null };
  });

// ---------------------------------------------------------------- operatorlar (kunlik hisobotdan) + ball
// Kun bo'yicha AI ball: operator → tahlil qilingan suhbatlar bali yig'indisi va soni. Kunlik hisobot (panel, rasm,
// Telegram) shu manbadan oladi — server ishga tushganda kunlik.ballManba() ga ulanadi.
export const kunBall = (bx, db, sana) => cached(`olc:kunball:${sana}`, 60e3, async () => {
  const reg = await calls.registry(bx, db, { range: rng.normalize({ from: sana, to: sana }), limit: 100000, analyzedOnly: true });
  const ops = {};
  for (const c of reg.rows || []) {
    const s = c.analysis?.score; if (s == null) continue;
    const x = ops[String(c.owner)] || (ops[String(c.owner)] = { s: 0, n: 0 }); x.s += s; x.n++;
  }
  return { sana, ops };
});
export const operatorlarBugun = (bx, db, sana = null) => cached(`olc:opb:${sana || kunlik.bugun()}`, 60e3, () => operatorlarBugun0(bx, db, sana));
async function operatorlarBugun0(bx, db, sana = null) {
  const rep = await kunlik.hisobot(db, { sana: sana || kunlik.bugun() });
  if (!rep || rep.ulangan === false) return { ulangan: false, sabab: rep?.sabab || null, rows: [] };
  const D = rep.sana || sana || kunlik.bugun();
  // Ball — kunlik hisobotning o'zidan (bitta manba); hisobot ballsiz kelsa (manba ulanmagan) — shu yerda hisoblanadi
  const kb = rep.ballBor ? null : await kunBall(bx, db, D).catch(() => null);
  const rows = (rep.rows || []).filter((r) => r.callMarkaz || r.yangi || r.uzatildi).map((r) => {
    const b = kb?.ops?.[String(r.id)];
    return { id: r.id, ism: r.ism, yangi: r.yangi || 0, ishlangan: r.ishlangan || 0, uzatildi: r.uzatildi || 0,
      qongiroq: r.q?.qildi || 0, javobli: r.q?.javobli || 0, sek: r.q?.sek || 0,
      suhbatOrtacha: r.q?.javobli ? Math.round((r.q.sek || 0) / r.q.javobli) : null,
      ball: kb ? (b ? Math.round(b.s / b.n) : null) : (r.ball ?? null), tahlil: kb ? (b ? b.n : 0) : (r.tahlil || 0) };
  });
  rows.sort((a, b) => (b.uzatildi - a.uzatildi) || ((b.ball ?? -1) - (a.ball ?? -1)) || (b.qongiroq - a.qongiroq));
  return { ulangan: true, sana: D, rows };
}

// ---------------------------------------------------------------- Boshqaruv markazi bloklari
export async function markazKpi(bx, db, R) {
  const P = oldingi(R);
  const [l, lo, j, s, t, b, bo] = await Promise.allSettled([
    lid(bx, R), lid(bx, P), javobsiz(bx), sotuv(bx, db), tolov(bx), ball(bx, db, R), ball(bx, db, P),
  ]);
  const v = (x) => (x.status === "fulfilled" ? x.value : null);
  return { range: rng.pub(R), oldingi: { from: P.from, to: P.to }, lid: v(l), lidOldin: v(lo), javobsiz: v(j), sotuv: v(s), tolov: v(t), ball: v(b), ballOldin: v(bo) };
}
export async function markazMuammo(bx, db, R) {
  const [j, su, b, q] = await Promise.allSettled([javobsiz(bx), sifatliUzatilmagan(bx, db), ball(bx, db, R), qotgan(bx)]);
  const v = (x) => (x.status === "fulfilled" ? x.value : null);
  const out = [];
  const J = v(j), SU = v(su), B = v(b), Q = v(q);
  if (J) out.push({ k: "javobsiz", ton: J.soni ? "risk" : "ok", nom: "24 soatdan javobsiz lidlar", soni: J.soni,
    izoh: J.soni ? `${J.soni} lid${J.engEski ? ` · eng eskisi ${J.engEski} soat` : ""}` : "hammasi vaqtida", go: "lidlar:javob" });
  if (SU) out.push({ k: "sifatli", ton: SU.soni ? "risk" : "ok", nom: "Sifatli, lekin uzatilmagan", soni: SU.soni,
    izoh: SU.soni ? `${SU.soni} lid${SU.kim ? ` · eng ko'p: ${SU.kim} (${SU.kimSoni})` : ""}` : "yo'q", go: "voronka" });
  if (B && B.keyingiQadamsizPct != null) out.push({ k: "qadam", ton: B.keyingiQadamsizPct >= 30 ? "warn" : "ok", nom: "Keyingi qadamsiz qo'ng'iroqlar",
    soni: B.keyingiQadamsiz, izoh: `${B.keyingiQadamsizPct}% suhbat · ${B.tahlil} ta tahlil`, go: "qongiroq" });
  if (Q) out.push({ k: "qotgan", ton: Q.soni ? "warn" : "ok", nom: "Qotib qolgan bitimlar", soni: Q.soni,
    izoh: Q.soni ? `${Q.soni} bitim · ${Q.idle}+ kun harakatsiz` : "yo'q", go: "bitimlar" });
  const tartib = { risk: 0, warn: 1, ok: 2 };
  out.sort((a, b2) => tartib[a.ton] - tartib[b2.ton] || (b2.soni || 0) - (a.soni || 0));
  return { muammolar: out };
}

// ---------------------------------------------------------------- Mening ishim (operator)
// owner — "op:<id>" (operator) yoki "<id>" (sotuvchi); callOwner — qo'ng'iroq RESPONSIBLE_ID
export async function menKpi(bx, db, R, owner, callOwner) {
  const P = oldingi(R);
  const [l, lo, jl, c, b, bj, l7, jl7] = await Promise.allSettled([
    lid(bx, R, owner), lid(bx, P, owner), lid(bx, R), calls.calls(bx, R, callOwner),
    ball(bx, db, rng.rolling(30), callOwner), ball(bx, db, rng.rolling(30)),
    lid(bx, rng.rolling(7), owner), lid(bx, rng.rolling(7)),
  ]);
  const v = (x) => (x.status === "fulfilled" ? x.value : null);
  const C = v(c);
  // Qo'ng'iroqlar — kunlik hisobot bilan bir xil ta'rif: chiquvchi + javob berilgan kiruvchi (javobsiz kiruvchi
  // bir vaqtda bir necha operatorga jiringlaydi — operator ishi emas). Operator uchun kunlik qatoridan, aks holda CRM'dan.
  let qongiroq = null;
  if (isOp(owner) && R.from === R.to) {
    const rep = await kunlik.hisobot(db, { sana: R.from, operator: String(owner).slice(3) }).catch(() => null);
    if (rep && rep.ulangan !== false) {
      const q = rep.rows?.[0]?.q || {};
      qongiroq = { jami: q.qildi || 0, javobli: q.javobli || 0, ortachaSek: q.javobli ? Math.round((q.sek || 0) / q.javobli) : 0 };
    }
  }
  if (!qongiroq && C?.totals) qongiroq = { jami: C.totals.calls, javobli: C.totals.calls - C.totals.missed, ortachaSek: C.totals.avgDur };
  return { range: rng.pub(R), lid: v(l), lidOldin: v(lo), jamoaLid: v(jl), lid7: v(l7), jamoaLid7: v(jl7), qongiroq, ball: v(b), jamoaBall: v(bj) };
}

// «Hozir qo'ng'iroq qiling» — o'z ochiq lidlarim: hali qo'ng'iroq qilinmagan, eng eskisi birinchi; + kelishilgan qayta qo'ng'iroqlar
export const navbat = (bx, db, owner) => cached(`olc:navbat:${owner}`, 30e3, async () => {
  const R = rng.rolling(30);
  const r = await bx.listAll("crm.lead.list", {
    filter: { ">=DATE_CREATE": R.fromISO, STATUS_SEMANTIC_ID: "P", UF_CRM_CALLS_N: 0, ...leadOwn(owner) },
    select: ["ID", "TITLE", "NAME", "LAST_NAME", "COMPANY_TITLE", "DATE_CREATE", "SOURCE_DESCRIPTION", "UF_CRM_KWT", "UF_CRM_MAQSAD", "PHONE"],
    order: { DATE_CREATE: "ASC" }, maxItems: 500,
  });
  const Q = sifat.ofLeads(db, r.items.map((x) => String(x.ID)));
  const now = Date.now();
  const rows = r.items.map((x) => {
    const soat = (now - (ts(x.DATE_CREATE) ?? now)) / 3600e3;
    const nom = [x.NAME, x.LAST_NAME].filter(Boolean).join(" ") || x.COMPANY_TITLE || x.TITLE || `Lid #${x.ID}`;
    const tel = Array.isArray(x.PHONE) && x.PHONE[0]?.VALUE ? String(x.PHONE[0].VALUE) : null;
    const izoh = [x.SOURCE_DESCRIPTION, x.UF_CRM_KWT ? `${x.UF_CRM_KWT} kVt` : null, x.UF_CRM_MAQSAD || null,
      Q.get(String(x.ID))?.verdict === "sifatli" ? "AI: sifatli" : null].filter(Boolean).join(" · ");
    return { id: String(x.ID), nom, izoh, soat: Math.round(soat * 10) / 10, ton: soat > 24 ? "risk" : soat > 2 ? "warn" : "ok", tel };
  }).sort((a, b) => b.soat - a.soat);
  return { jami: rows.length, rows: rows.slice(0, 50) };
});

// Lidlarim taqdiri — 30 kun: kelgan → ishlangan (qo'ng'iroq bor) → uzatildi → yutildi
export const taqdir = (bx, db, owner) => cached(`olc:taqdir:${owner}`, 2 * 60e3, async () => {
  const R = rng.rolling(30);
  const r = await bx.listAll("crm.lead.list", {
    filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO, ...leadOwn(owner) },
    select: ["ID", "STATUS_SEMANTIC_ID", "UF_CRM_TYPE", "UF_CRM_CALLS_N", "UF_CRM_DEAL_STATE", "UF_CRM_STAGE_AT", "DATE_CREATE"], maxItems: 5000,
  });
  const L = r.items;
  const ishlangan = L.filter((x) => Number(x.UF_CRM_CALLS_N) > 0 || x.UF_CRM_TYPE === "opportunity" || (x.UF_CRM_STAGE_AT && x.UF_CRM_STAGE_AT !== x.DATE_CREATE)).length;
  const uzatildi = L.filter((x) => x.UF_CRM_TYPE === "opportunity").length;
  const yutildi = L.filter((x) => x.UF_CRM_DEAL_STATE === "won").length;
  const ochiqIds = L.filter((x) => x.STATUS_SEMANTIC_ID === "P" && x.UF_CRM_TYPE !== "opportunity").map((x) => String(x.ID));
  const Q = sifat.ofLeads(db, ochiqIds);
  const sifatli = ochiqIds.filter((id) => Q.get(id)?.verdict === "sifatli").length;
  return { kelgan: L.length, ishlangan, uzatildi, yutildi, sifatliUzatilmagan: sifatli };
});

// Oxirgi qo'ng'iroqlarim (bugun) — vaqt, lid, davomiylik, ball
export async function oxirgiQongiroqlar(bx, db, callOwner, n = 5) {
  const D = kunlik.bugun();
  const reg = await calls.registry(bx, db, { range: rng.normalize({ from: D, to: D }), owner: callOwner, limit: n, mineOwner: callOwner });
  return { rows: (reg.rows || []).map((c) => ({ id: c.id, at: c.at, dur: c.dur, out: c.out, missed: c.missed,
    nom: c.entity?.title || null, ball: c.analysis?.score ?? null })) };
}

// Eng past mezonlarim (30 kun) — jamoa bilan
export const pastMezonlar = (bx, db, callOwner, n = 3) =>
  calls.radar(bx, db, { range: 30, owner: callOwner }).then((r) => ({ tahlil: r.n,
    rows: (r.criteria || []).filter((c) => c.op != null).sort((a, b) => a.op - b.op).slice(0, n)
      .map((c) => ({ id: c.id, nom: c.label, op: c.op, jamoa: c.team })) }));

// ---------------------------------------------------------------- Lidlar «Umumiy» (v2): o'z doirasi — operator o'z lidlari
const tkDay = (s) => { const x = ts(s); return x == null ? null : new Date(x + 5 * 3600e3).toISOString().slice(0, 10); };
// Davrda yaratilgan va davrda uzatilgan lidlar — KPI, manba va oqim shu ikki ro'yxatdan (raqamlar bir-biriga mos)
const davrLidlar = (bx, R, owner) => cached(`olc:dl:${owner || "all"}:${R.key}`, TTL, async () => {
  const own = leadOwn(owner);
  const [a, b] = await Promise.all([
    bx.listAll("crm.lead.list", { filter: { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO, ...own },
      select: ["ID", "DATE_CREATE", "SOURCE_ID", "SOURCE_DESCRIPTION", "STATUS_SEMANTIC_ID"], maxItems: 50000 }),
    bx.listAll("crm.lead.list", { filter: { ">=UF_CRM_CONVERTED_AT": R.fromISO, "<=UF_CRM_CONVERTED_AT": R.toISO, UF_CRM_TYPE: "opportunity", ...own },
      select: ["ID", "SOURCE_ID", "UF_CRM_CONVERTED_AT"], maxItems: 50000 }),
  ]);
  return { yangi: a.items, uzat: b.items };
});
const sifatOf = (D) => {
  if (!D) return null;
  const n = D.yangi.length, y = D.yangi.filter((x) => x.STATUS_SEMANTIC_ID === "F").length;
  return { jami: n, yaroqsiz: y, sifatli: n - y, sifatliPct: pct(n - y, n) };
};
export async function lidlarKpi(bx, R, owner) {
  const P = oldingi(R);
  const [l, lo, d, dO, j] = await Promise.allSettled([lid(bx, R, owner), lid(bx, P, owner), davrLidlar(bx, R, owner), davrLidlar(bx, P, owner), javobsiz(bx, owner)]);
  const v = (x) => (x.status === "fulfilled" ? x.value : null);
  return { range: rng.pub(R), lid: v(l), lidOldin: v(lo), sifat: sifatOf(v(d)), sifatOldin: sifatOf(v(dO)), javobsiz: v(j) };
}
// Manba: davrda kelgan, yaroqsiz, davrda uzatilgan (uzatish % — 5 tadan kam lidda yo'q). Oqim: kun (uzun davrda hafta) bo'yicha.
export async function lidlarUmumiy(bx, R, owner) {
  const [D, d] = await Promise.all([davrLidlar(bx, R, owner), dicts(bx).catch(() => ({ sources: {} }))]);
  const m = new Map();
  // Nomi: CRM lug'ati, bo'lmasa Odoo'dagi asl yozuvi («Э.Т. шахсий бренд»), bo'lmasa kodi
  const asl = new Map(); for (const x of D.yangi) if (x.SOURCE_ID && x.SOURCE_DESCRIPTION && !asl.has(x.SOURCE_ID)) asl.set(x.SOURCE_ID, String(x.SOURCE_DESCRIPTION));
  const g = (id) => { const k = id || "OTHER"; if (!m.has(k)) m.set(k, { id: k, nom: d.sources?.[k] || asl.get(k) || (id ? k.replace(/_/g, " ") : "Manbasiz"), yangi: 0, yaroqsiz: 0, uzatildi: 0 }); return m.get(k); };
  for (const x of D.yangi) { const r = g(x.SOURCE_ID); r.yangi++; if (x.STATUS_SEMANTIC_ID === "F") r.yaroqsiz++; }
  for (const x of D.uzat) g(x.SOURCE_ID).uzatildi++;
  const manba = [...m.values()]
    .map((r) => ({ ...r, sifatliPct: pct(r.yangi - r.yaroqsiz, r.yangi), uzatishPct: r.yangi >= 5 && r.uzatildi <= r.yangi ? pct(r.uzatildi, r.yangi) : null }))
    .sort((a, b) => b.yangi - a.yangi || b.uzatildi - a.uzatildi);
  const B = rng.buckets(R), o = new Map(B.keys.map((k) => [k, { d: k, yangi: 0, sifatli: 0, uzatildi: 0 }]));
  for (const x of D.yangi) { const r = o.get(B.at(tkDay(x.DATE_CREATE))); if (r) { r.yangi++; if (x.STATUS_SEMANTIC_ID !== "F") r.sifatli++; } }
  for (const x of D.uzat) { const r = o.get(B.at(tkDay(x.UF_CRM_CONVERTED_AT))); if (r) r.uzatildi++; }
  return { range: rng.pub(R), bucket: R.bucket, jami: D.yangi.length, uzatildi: D.uzat.length, manba, oqim: [...o.values()] };
}
// Lidlar muammolari — eng muhimi birinchi; har biri bosilsa tegishli ro'yxatga o'tadi
export async function lidlarMuammo(bx, db, R, owner) {
  const [k, su, u, j] = await Promise.allSettled([lid(bx, R, owner), sifatliUzatilmagan(bx, db, owner), lidlarUmumiy(bx, R, owner), javobsiz(bx, owner)]);
  const v = (x) => (x.status === "fulfilled" ? x.value : null);
  const K = v(k), SU = v(su), U = v(u), J = v(j), out = [], rahbar = !owner;
  if (J) out.push({ k: "javobsiz", ton: J.soni ? "risk" : "ok", nom: "24 soatdan javobsiz lidlar", soni: J.soni,
    izoh: J.soni ? `${J.soni} lid${J.engEski ? ` · eng eskisi ${J.engEski} soat` : ""}` : "hammasi vaqtida", go: "lidlar:javob" });
  if (K) out.push({ k: "qongiroqsiz", ton: K.qongiroqsiz ? "warn" : "ok", nom: "Qo'ng'iroq qilinmagan", soni: K.qongiroqsiz,
    izoh: K.qongiroqsiz ? `davrda kelgan, ochiq, bitta ham qo'ng'iroq yo'q · ${K.qongiroqsiz} lid` : "hammasiga qo'ng'iroq qilingan", go: "lidlar:list" });
  if (SU) out.push({ k: "sifatli", ton: SU.soni ? "risk" : "ok", nom: "Sifatli, lekin uzatilmagan", soni: SU.soni,
    izoh: SU.soni ? `AI sifatli degan, oxirgi 30 kun · ${SU.soni} lid${rahbar && SU.kim ? ` · eng ko'p: ${SU.kim} (${SU.kimSoni})` : ""}` : "yo'q",
    go: rahbar ? "voronka" : "lidlar:list" });
  const W = (U?.manba || []).filter((r) => r.yangi >= 10 && r.sifatliPct != null && r.sifatliPct < 40).sort((a, b) => a.sifatliPct - b.sifatliPct)[0];
  if (W) out.push({ k: "manba", ton: "warn", nom: `Yaroqsiz ko'p: ${W.nom}`, soni: W.yaroqsiz,
    izoh: `${W.yangi} liddan ${W.yaroqsiz} tasi yaroqsiz (${Math.round((100 - W.sifatliPct) * 10) / 10}%)`, go: "" });
  const tartib = { risk: 0, warn: 1, ok: 2 };
  out.sort((a, b2) => tartib[a.ton] - tartib[b2.ton] || (b2.soni || 0) - (a.soni || 0));
  return { muammolar: out };
}
// Birinchi suhbat tezligi → uzatish. Oxirgi 90 kun, kamida 7 kun oldin kelgan lidlar (uzatilishga vaqt bo'lsin).
// Birinchi suhbat — lid kelgandan keyin birinchi JAVOB BERILGAN qo'ng'iroq (kiruvchi yoki chiquvchi; adapter UF_CRM_FIRST_CONTACT).
// Ilgari sla.MEASURED — 2026-09-05 dagi Bitrix davri o'lchovi edi (qotib qolgan). Endi har 6 soatda Odoo'dan qayta hisoblanadi.
export const javobTasiri = (bx) => cached("olc:javobtasir", 6 * 3600e3, async () => {
  const now = Date.now(), dan = tkIso(now - 90 * DAY), gacha = tkIso(now - 7 * DAY);
  const { items } = await bx.listAll("crm.lead.list", { filter: { ">=DATE_CREATE": dan, "<=DATE_CREATE": gacha },
    select: ["ID", "DATE_CREATE", "UF_CRM_FIRST_CONTACT", "UF_CRM_CONVERTED_AT"], maxItems: 50000 });
  const CH = [["5 daqiqagacha", 5], ["5–30 daqiqa", 30], ["30 daq – 2 soat", 120], ["2–24 soat", 1440], ["24 soatdan keyin", Infinity]];
  const bands = CH.map(([nom]) => ({ nom, n: 0, uz: 0 })), yoq = { nom: "Suhbat bo'lmagan", n: 0, uz: 0 };
  let n = 0, uz = 0;
  for (const l of items) {
    const c = ts(l.DATE_CREATE); if (c == null) continue;
    const f = ts(l.UF_CRM_FIRST_CONTACT), u = !!l.UF_CRM_CONVERTED_AT;
    n++; if (u) uz++;
    if (f == null) { yoq.n++; if (u) yoq.uz++; continue; }
    const b = bands[CH.findIndex(([, x]) => Math.max(0, (f - c) / 60e3) <= x)];
    b.n++; if (u) b.uz++;
  }
  const yig = (arr) => arr.reduce((a, r) => ({ n: a.n + r.n, uz: a.uz + r.uz }), { n: 0, uz: 0 });
  const tez = yig(bands.slice(0, 3)), kech = bands[4];
  const out = [...bands, yoq].map((r) => ({ ...r, pct: r.n >= 20 ? pct(r.uz, r.n) : null,
    nisbat: r.n >= 20 && uz ? Math.round(((r.uz / r.n) / (uz / n)) * 100) / 100 : null }));
  return { dan: dan.slice(0, 10), gacha: gacha.slice(0, 10), n, uz, baza: pct(uz, n), bands: out,
    tez: tez.n >= 20 ? pct(tez.uz, tez.n) : null, kech: kech.n >= 20 ? pct(kech.uz, kech.n) : null, at: new Date().toISOString() };
});


