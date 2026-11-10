#!/usr/bin/env node
// Sotuv KPI — agentlar uchun yig'ma raqamlar. Panel bilan AYNI hisob (lib/api.summary, lib/sla.slaCheck).
//
// Nega kerak (2026-09-23 majlisi): agentlar ro'yxat skriptlaridan (20–50 qator) xulosa chiqardi —
// «jami 7492 lid (so'nggi 50 tadan hisoblangan taqsimot)», «oxirgi 20 tasi yig'indisi». Bu vosita
// JAMI sonni to'g'ridan-to'g'ri beradi, foizni surat/maxraj bilan, davrni aniq aytadi.
// Faqat o'qiydi: CRM'ga (adapter) va panel bazasiga hech narsa yozmaydi.
//
//   kpi-cli.mjs [kun]              — oxirgi N kun (standart 7), Asia/Tashkent
//   kpi-cli.mjs bugun              — bugun
//   kpi-cli.mjs <YYYY-MM-DD> <YYYY-MM-DD>
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const APP = process.env.SOTUV_APP || "/home/claude/projects/sotuv-web";
for (const f of ["/home/claude/secrets/bitrix-sotuv.env", path.join(APP, ".env")]) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
// Modullar env o'qilgandan KEYIN yuklanadi (ular modul darajasida env o'qiydi)
const { Bitrix } = await import(`${APP}/lib/bitrix.mjs`);
const api = await import(`${APP}/lib/api.mjs`);
const sla = await import(`${APP}/lib/sla.mjs`);
const rng = await import(`${APP}/lib/range.mjs`);

const arg = process.argv.slice(2);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const R = arg.length >= 2 && YMD.test(arg[0]) && YMD.test(arg[1]) ? rng.normalize({ from: arg[0], to: arg[1] })
  : arg[0] === "bugun" ? rng.normalize(1)
  : rng.normalize(Number(arg[0]) > 0 ? Math.min(Number(arg[0]), 366) : 7);
const bx = new Bitrix(process.env.BITRIX_WEBHOOK_URL, { timeoutMs: 60000 });

const n = (x) => Number(x || 0).toLocaleString("ru-RU");
const kasr = (a, b) => (b > 0 ? `${(a / b * 100).toFixed(1)}% = ${n(a)} ÷ ${n(b)}` : "— (maxraj 0)");
const tk = (iso) => new Date(new Date(iso).getTime() + 5 * 3600e3).toISOString().slice(0, 10);
const out = [];
const say = (s = "") => out.push(s);
// KPI_JSON=<fayl> — xuddi shu raqamlar mashina o'qiydigan ko'rinishda (majlis rasmi: majlis-rasm.py).
// Matn bilan BIR hisobdan to'ldiriladi — rasm va matnda har xil raqam chiqmaydi.
const J = { davr: { from: R.fromISO.slice(0, 10), to: R.toISO.slice(0, 10), kun: R.days } };

try {
  const [s, q] = await Promise.all([api.summary(bx, null, R), sla.slaCheck(bx, null, R)]);
  const p = s.period;
  say(`SOTUV KPI · ${R.label} (${R.days} kun, Asia/Tashkent) · manba: Bitrix24 CRM, panel bilan bir xil hisob`);
  say("");
  // Lid ta'rifi = davrda Bitrix'da yaratilgan lid
  say(`LIDLAR («Tushgan Lead», yaratilgan sana bo'yicha): jami ${n(p.total)} · sifatli ${n(p.quality)} · yaroqsiz/otkaz ${n(p.junk)} (${kasr(p.junk, p.total)})`);
  say(`  shu davrda kelib managerga o'tgan ${n(p.converted)} — jami liddan ${kasr(p.converted, p.total)}; sifatli liddan ${kasr(p.converted, p.quality)}`);
  J.lid = { jami: p.total || 0, sifatli: p.quality || 0, yaroqsiz: p.junk || 0, managerga: p.converted || 0 };
  // Lid taqdiri: davrda kelib managerga o'tganlar qayerda (klient turi, natija)
  try {
    const j = await api.journey(bx, { range: R });
    const f = j.funnel;
    say(`LID TAQDIRI (shu davrda kelgan ${n(f.total)} lid): managerga o'tgan ${n(f.converted)} (${kasr(f.converted, f.total)}) → yutilgan ${n(f.won)} · bitim jarayonda ${n(f.dealOpen)} · yo'qotilgan ${n(f.lost)}`);
    if (j.byType.length) say(`  klient turi bo'yicha: ${j.byType.map((t) => `${t.name} ${n(t.n)} (yutildi ${t.won}, yo'q ${t.lost})`).join("; ")}`);
  } catch (e) { say(`LID TAQDIRI: olinmadi (${String(e.message).slice(0, 80)})`); }
  if (p.arxiv) say(`  yaroqsizlardan ${n(p.arxiv)} tasi Bitrix'da arxivlangan`);

  const t = q.totals;
  say(`JAVOB TEZLIGI: 24 soatdan oshgan ochiq lid ${n(t.atRisk)} ta (haqiqiy lid ${n(t.real)} tadan)`);
  if (q.qongiroqBor === false) say(`  SLA o'lchanmadi — davrda qo'ng'iroq ${q.davrQongiroq ? "lidlarga bog'lanmadi" : "qayd etilmagan"} (bu «javob berilmagan» degani emas)`);
  else say(`  SLA 24 soat: ${t.slaRate === null ? "o'lchanmadi" : kasr(t.withinSla, t.answered)} · kech ${n(t.breached)} ta`);
  J.sla = { olchandi: q.qongiroqBor !== false && t.slaRate !== null, ichida: t.withinSla || 0, javob: t.answered || 0,
    kech: t.breached || 0, ochiq24: t.atRisk || 0, haqiqiy: t.real || 0 };

  const mp = s.moneyPeriod || { byCurrency: [], sampled: 0 };
  const summa = mp.byCurrency.map((c) => `${n(Math.round(c.sum))} ${c.currency}`).join(" + ") || "0";
  say(`YUTILGAN BITIMLAR (yopilgan sana bo'yicha): ${n(s.deals.wonInPeriod)} ta · summa ${summa} — bu bitim summasi, kassaga tushgan pul emas`);
  if (mp.sampled && mp.sampled < s.deals.wonInPeriod) say(`  DIQQAT: summa oxirgi ${mp.sampled} ta bitim bo'yicha (jami ${s.deals.wonInPeriod})`);
  if (mp.withAmount < mp.sampled) say(`  ${n(mp.sampled - mp.withAmount)} ta yutilgan bitimda summa kiritilmagan`);
  say(`OCHIQ BITIMLAR (hozirgi holat, davrdan qat'i nazar): ${n(s.deals.open)} ta`);
  say(`YO'QOTILGAN BITIMLAR (davrda yopilgan): ${n(q.lost.total)} ta · sababi bor ${n(q.lost.withReason)} ta (${kasr(q.lost.withReason, q.lost.total)})`);
  J.bitim = { yutilgan: s.deals.wonInPeriod || 0, summa: mp.byCurrency.map((c) => ({ v: Math.round(c.sum), cur: c.currency })),
    ochiq: s.deals.open || 0, yoqotilgan: q.lost.total || 0, sababli: q.lost.withReason || 0 };

  // Qo'ng'iroqlar — qo'ng'iroq sanasi bo'yicha; tahlil qamrovi panel bazasidan (faqat o'qish)
  // 2026-11-01: listAll bir chaqiruvda ko'pi bilan 200 sahifa × 50 = 10 000 qator beradi (lib/bitrix.mjs
  // guard). Oylik oynada (oktabr ≈14 500 qo'ng'iroq) ro'yxat JIM kesilib «10 000 ta» chiqardi va AI tahlil
  // soni ham kam sanaldi — majlisda Sarvar shu raqam bilan Ovozni nohaq qaytardi. Endi oyna 7 kunlik
  // bo'laklarga bo'linadi (haftasiga ≈4 700), ID bo'yicha takror olib tashlanadi.
  const calls = [], callIds = new Set(); let kesildi = false;
  const tkIso = (ms) => new Date(ms + 5 * 3600e3).toISOString().slice(0, 19) + "+05:00";
  const QADAM = 7 * 86400e3, BOSH = Date.parse(R.fromISO), OXIR = Date.parse(R.toISO);
  for (let t = BOSH; t <= OXIR; t += QADAM) {
    const { items, total } = await bx.listAll("crm.activity.list", {
      filter: { TYPE_ID: 2, ">=CREATED": tkIso(t), "<=CREATED": tkIso(Math.min(t + QADAM, OXIR)) },
      select: ["ID", "SETTINGS"], order: { CREATED: "DESC" }, maxItems: 20000 });
    if (total > items.length) kesildi = true;
    for (const c of items) { const id = String(c.ID); if (!callIds.has(id)) { callIds.add(id); calls.push(c); } }
  }
  let tahlil = 0;
  try {
    const db = new DatabaseSync(path.join(APP, "data", "sotuv.db"), { readOnly: true });
    const tayyor = new Set(db.prepare("SELECT call_id FROM call_analyses WHERE status='ready'").all().map((r) => String(r.call_id)));
    tahlil = calls.filter((c) => tayyor.has(String(c.ID))).length;
  } catch { tahlil = null; }
  if (calls.length) {
    const javobsiz = calls.filter((c) => c.SETTINGS && c.SETTINGS.MISSED_CALL === true).length;
    say(`QO'NG'IROQLAR (qo'ng'iroq sanasi bo'yicha): ${n(calls.length)} ta · javobsiz ${n(javobsiz)} · AI tahlil qilingan ${tahlil === null ? "—" : n(tahlil)}`);
    if (kesildi) say(`  DIQQAT: bir haftalik bo'lakda qo'ng'iroqlar ro'yxat chegarasidan (10 000) oshdi — ro'yxat to'liq emas, qo'ng'iroq raqamini aytmang`);
    J.qongiroq = { jami: calls.length, javobsiz, tahlil, toliq: !kesildi };
  } else {
    let oxirgi = null;
    try { const h = await (await fetch(String(process.env.BITRIX_WEBHOOK_URL).replace(/\/rest\/.*$/, "/healthz"), { signal: AbortSignal.timeout(3000) })).json(); oxirgi = h?.counts?.callsOxirgi || null; } catch {}
    say(`QO'NG'IROQLAR: davrda qayd etilmagan — o'lchanmadi (0 emas)${oxirgi ? `. Eng oxirgi qo'ng'iroq ${tk(oxirgi)} — undan keyin Bitrix'ga tushmagan` : ""}`);
  }
  console.log(out.join("\n"));
  if (process.env.KPI_JSON) { try { fs.writeFileSync(process.env.KPI_JSON, JSON.stringify(J)); } catch (e) { console.error(`KPI_JSON yozilmadi: ${e.message}`); } }
  process.exit(0);
} catch (e) {
  console.log(`XATO: CRM'dan ma'lumot olinmadi (${e.message}). Raqam aytmang — «o'lchanmadi» deng.`);
  process.exit(1);
}
