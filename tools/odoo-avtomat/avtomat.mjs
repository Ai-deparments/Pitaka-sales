#!/usr/bin/env node
// avtomat.mjs — videoda ko'rsatilgan qo'l ishini avtomatlashtiradi: lid -> kvalifikatsiya -> kalkulyator -> КП.
// STANDART REJIM — SINOV (dry-run): nima yozilishini ko'rsatadi, CRM'ga tegmaydi. Yozish uchun `--yoz`.
// Narx faqat `--narx-tasdiq` bilan yoziladi (qoida.json dagi narx_kitobi._tasdiq = "kutilmoqda").
//
//   node avtomat.mjs holat
//   node avtomat.mjs lid --nom "Ali" --telefon 901112233 [--xudud Toshkent] [--jamoa 21] [--biriktirmasdan] [--yoz]
//   node avtomat.mjs kvalifikatsiya <id> --maqsad 1 --stansiya On-Grid --oylik-tolov 500000 [--yoz]
//   node avtomat.mjs kp <id> [--tom tekis] [--narx-tasdiq] [--docx] [--yoz]
//   node avtomat.mjs sinov [--yoz]        # uchdan-uchiga: yaratadi, to'ldiradi, o'qiydi, arxivlaydi
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Odoo } from "./mcp.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const Q = JSON.parse(fs.readFileSync(path.join(DIR, "qoida.json"), "utf8"));
try { const _k = JSON.parse(fs.readFileSync("/home/claude/shared/qes-koef.json", "utf8"));
  if (_k.unum) Q.kalkulyator.unum_kwh_kvt_yil = Number(_k.unum); } catch {}   // sotuv rahbari tanlovi
const F = Q.maydon;

const argv = process.argv.slice(2);
const buyruq = argv[0] || "holat";
const bayroq = (n, d = null) => { const i = argv.indexOf(`--${n}`); if (i < 0) return d; const v = argv[i + 1]; return v && !v.startsWith("--") ? v : true; };
const YOZ = argv.includes("--yoz");
const BIRIKTIRMA = argv.includes("--biriktirmasdan");   // lid masʼulsiz yaratiladi (jamoa oʻzi biriktiradi)
const NARX_OK = argv.includes("--narx-tasdiq");
const son = (x) => Number(String(x).replace(/[^\d.]/g, "")) || 0;
const pul = (n) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

// ---------- telefon: +998 formatiga ----------
export function telefon(x) {
  const d = String(x || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith("998")) return `+${d}`;
  if (d.length === 13 && d.startsWith("9998")) return `+${d.slice(1)}`;
  return `+${d}`;
}

// ---------- kalkulyator (video mantig'i) ----------
export function hisobla({ oylikTolov = 0, oylikKwh = 0, yillikKwh = 0 }) {
  const k = Q.kalkulyator;
  let kwh = oylikKwh || 0;
  if (!kwh && oylikTolov) kwh = oylikTolov / k.tarif_som_kwh;          // 500 000 / 846 = 590,9
  let yil = yillikKwh || kwh * 12;
  const kerakliXom = yil / k.unum_kwh_kvt_yil;                          // 7 091 / 1500 = 4,7
  const pogona = (v) => k.pogona_kvt.find((p) => p >= v) ?? k.pogona_kvt.at(-1);
  const kerakli = pogona(Math.max(kerakliXom, 0.1));
  const tavsiya = pogona(kerakli * (k.tavsiya_koef || 1));
  return { oylikKwh: Math.round(kwh * 100) / 100, yillikKwh: Math.round(yil), kerakliXom: Math.round(kerakliXom * 100) / 100, kerakli, tavsiya };
}

// ---------- narx kitobi: pog'onalar orasida chiziqli ----------
export function narx1kvt(kvt) {
  const p = [...Q.narx_kitobi.pogona].sort((a, b) => a.kvt - b.kvt);
  if (kvt <= p[0].kvt) return { som: p[0].som_kvt, manba: p[0].manba };
  if (kvt >= p.at(-1).kvt) return { som: p.at(-1).som_kvt, manba: p.at(-1).manba };
  for (let i = 1; i < p.length; i++) {
    if (kvt <= p[i].kvt) {
      const a = p[i - 1], b = p[i];
      const t = (kvt - a.kvt) / (b.kvt - a.kvt);
      return { som: Math.round(a.som_kvt + t * (b.som_kvt - a.som_kvt)), manba: `${a.kvt}–${b.kvt} kVt orasida (chiziqli)` };
    }
  }
  return { som: p.at(-1).som_kvt, manba: p.at(-1).manba };
}

// ---------- to'plam: quvvat × tom ----------
export function toplam(kvt, tom = "tekis") {
  const r = Q.toplam.qatorlar.find((x) => kvt <= x.kvt_max && (x.tom === "*" || x.tom === tom)) || Q.toplam.qatorlar.at(-1);
  const invQ = Q.variant.invertor_quvvati.find((v) => son(v) >= kvt) || null;   // 5/10/15/20 kW
  return { ...r, invertor_quvvati: invQ };
}

export const marshrut = (kvt) => (kvt <= Q.marshrut.call_center_kvt_max ? "call-center (telefon orqali sotadi)" : "sotuv menejeri (obyektga chiqadi)");
export const tolov = (kvt) => (kvt <= Q.tolov.kichik_kvt ? Q.tolov.kichik : Q.tolov.katta);

// ---------- yozish o'rami: sinovda faqat ko'rsatadi ----------
async function yozuv(o, model, ids, values, izoh) {
  if (ids.some((x) => !Number.isFinite(Number(x)))) { console.log(`  ✗ ${izoh}: id noto'g'ri (${ids}) — yozilmadi`); return { xato: "id" }; }
  const tavsif = Object.entries(values).map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 42) : v}`).join(", ");
  if (!YOZ) { console.log(`  [SINOV] ${izoh}: ${model}#${ids} ← ${tavsif}`); return { sinov: true }; }
  const r = await o.yoz(model, ids, values);
  console.log(`  ✓ ${izoh}: ${model}#${ids} ← ${tavsif}`);
  return r;
}

async function lidYarat(o, { nom, tel, xudud, jamoa, manba, kompaniya, tur = "lead" }) {
  const t = telefon(tel);
  if (t) {                                   // dublikat: telefon bo'yicha (videodagi «Похожие лиды»)
    const bor = await o.oqi("crm.lead", [["phone", "=", t]], ["name", "stage_id", "create_date"], { limit: 3 });
    if (bor.records?.length) { console.log(`  ! dublikat: ${bor.records.map((r) => `#${r.id} ${r.name}`).join("; ")}`); return { dublikat: bor.records }; }
  }
  // 1-bosqich (CREATE): faqat res.company'ga tegmaydigan maydonlar. team_id va «Тип клиента»
  // create'da yuborilsa Odoo res.company o'qishni talab qiladi va yozuv ko'rinmas bo'lib qoladi.
  const values = { [F.nom]: nom, [F.kontakt]: nom, [F.tur]: tur, [F.telefon]: t };
  if (BIRIKTIRMA) values.user_id = false;   // --biriktirma: lid masʼulsiz qoladi, jamoa oʻzi oladi
  if (kompaniya) values.company_id = Number(kompaniya);
  // 2026-09-20: Odoo endi yaratishda ham «Тип клиента» ni talab qiladi (422) — majburiy maydonlar create'ga ham qo'shiladi
  for (const [k, v] of Object.entries(Q.majburiy || {})) if (!k.startsWith("_") && F[k]) values[F[k]] = v;
  // 2-bosqich (WRITE) uchun: jamoa, majburiy maydonlar, hudud, manba
  const keyin = {};
  for (const [k, v] of Object.entries(Q.majburiy || {})) if (!k.startsWith("_") && F[k]) keyin[F[k]] = v;  // avval «Тип клиента»
  if (xudud) { keyin[F.xudud] = xudud; keyin[F.shahar] = xudud; }
  if (manba) keyin[F.manba] = manba;
  keyin[F.jamoa] = Number(jamoa || Q.crm.sinov_team_id);   // jamoa OXIRIDA: validatsiya majburiy maydonlarni talab qiladi
  if (!YOZ) { console.log(`  [SINOV] lid yaratish ← ${JSON.stringify(values)}`); return { sinov: true }; }
  try {
    const id = await o.yaratVaTop("crm.lead", values);   // create javobi bo'sh — belgi bo'yicha topamiz
    console.log(`  ✓ lid yaratildi: #${id} (${nom}, ${t})`);
    // 2-bosqich: qolgan maydonlar write bilan (maydonma-maydon — biri to'sib qolsa qolgani yoziladi)
    for (const [k, v] of Object.entries(keyin)) {
      try { await o.yoz("crm.lead", [id], { [k]: v }); console.log(`    ✓ ${k} = ${v}`); }
      catch (e2) { console.log(`    ✗ ${k}: ${String(e2.message).split("\n")[0].slice(0, 80)}`); }
    }
    return { id };
  } catch (e) {
    if (e.korinmas) {
      console.log(`  ✗ ${e.message}`);
      console.log(`     Sabab: yozuv kalitning standart kompaniyasiga (SUN-HIGHTECH) tushdi, kalit esa uni o'qiy olmaydi.`);
      console.log(`     Yechim: Odoo'da MCP user'ga CRM "User: All Documents" bering, yoki sinovni company_id=${Q.crm.sinov_company_id} bilan qiling.`);
      return { korinmas: true };
    }
    throw e;
  }
}

async function kvalifikatsiya(o, id, { maqsad, stansiya, oylikTolov, oylikKwh, yillikKwh, tip, muddat }) {
  const h = hisobla({ oylikTolov: son(oylikTolov), oylikKwh: son(oylikKwh), yillikKwh: son(yillikKwh) });
  console.log(`  hisob: ${oylikTolov ? pul(son(oylikTolov)) + " so'm/oy → " : ""}${h.oylikKwh} kVt·soat/oy → yillik ${pul(h.yillikKwh)} → kerakli ${h.kerakli} kVt (xom ${h.kerakliXom}), tavsiya ${h.tavsiya} kVt`);
  console.log(`  marshrut: ${marshrut(h.kerakli)} · to'lov: ${tolov(h.kerakli)}`);
  const v = { [F.kerakli_kvt]: h.kerakli, [F.fakt_quvvat]: h.tavsiya, [F.yillik_istemol]: h.yillikKwh, [F.oylik_sarf_kwh]: String(h.oylikKwh) };
  if (maqsad) v[F.maqsad] = Q.variant.maqsad[Number(maqsad) - 1] || maqsad;
  if (stansiya) v[F.stansiya_turi] = stansiya;
  if (oylikTolov) v[F.oylik_tolov_matn] = String(son(oylikTolov));
  if (tip) v[F.mijoz_tipi] = tip;
  if (muddat) v[F.ornatish_muddati] = muddat;
  await yozuv(o, "crm.lead", [Number(id)], v, "kvalifikatsiya");
  return h;
}

async function kp(o, id, { tom = "tekis", kvt, docx = false }) {
  let quvvat = son(kvt);
  if (!quvvat) {
    const r = await o.oqi("crm.lead", [["id", "=", Number(id)]], [F.fakt_quvvat, F.kerakli_kvt, F.nom], { limit: 1 });
    const rec = r.records?.[0] || {};
    quvvat = son(rec[F.fakt_quvvat]) || son(rec[F.kerakli_kvt]);
  }
  if (!quvvat) { console.log("  ! quvvat aniqlanmadi — avval kvalifikatsiya"); return null; }
  const t = toplam(quvvat, tom);
  const n = narx1kvt(quvvat);
  console.log(`  to'plam (${quvvat} kVt, ${tom} tom): ${t.tarif} · ${t.panel} · ${t.invertor} ${t.invertor_quvvati || ""} ${t.faza} · ${t.konstruksiya} · kafolat ${t.kafolat}`);
  console.log(`  narx: 1 kVt = ${pul(n.som)} so'm (${n.manba}) → jami ≈ ${pul(n.som * quvvat)} so'm`);
  const v = { [F.tarif]: t.tarif, [F.panel_brendi]: t.panel, [F.invertor_brendi]: t.invertor, [F.invertor_fazasi]: t.faza, [F.konstruksiya_materiali]: t.konstruksiya };
  if (t.invertor_quvvati) v[F.invertor_quvvati] = t.invertor_quvvati;
  if (NARX_OK) { v[F.narx_1kvt_qolda] = n.som; v[F.stansiya_narxi] = n.som * quvvat; v[F.kutilgan_summa] = n.som * quvvat; }
  else console.log(`  ⚠ narx YOZILMADI — qoida.json narx_kitobi._tasdiq="kutilmoqda"; tasdiqlangach --narx-tasdiq bilan`);
  await yozuv(o, "crm.lead", [Number(id)], v, "КП maydonlari");
  console.log(`  ℹ to'plam m2o maydonlari (x_panel/x_power) kalit scope'ida yo'q — 42 qatorli spetsifikatsiya Odoo'da scope ochilgach yoziladi`);
  if (docx) {
    if (!YOZ) console.log(`  [SINOV] server action ${Q.crm.server_amallari.kp} (КП docx) chaqirilardi`);
    else {
      try { const r = await o.amal(Q.crm.server_amallari.kp, "crm.lead", [Number(id)]); console.log(`  ✓ КП docx amali: ${JSON.stringify(r).slice(0, 120)}`); }
      catch (e) { console.log(`  ! КП amali: ${e.message}${e.tasdiq ? " (tasdiq zanjiri)" : ""}`); }
    }
  }
  return { toplam: t, narx: n, quvvat };
}

// ---------- buyruqlar ----------
const o = await new Odoo().boshla();
console.log(`Odoo MCP: ${o.server?.name || "?"} ${o.server?.version || ""} · rejim: ${YOZ ? "YOZISH" : "SINOV (dry-run)"}\n`);

if (buyruq === "holat") {
  const ctx = await o.ch("odoo_user_context", {});
  console.log(`foydalanuvchi: ${ctx.name} (${ctx.login}), kompaniya: ${ctx.company}`);
  for (const [m, d] of [["crm.lead", []], ["crm.lead", [["type", "=", "lead"]]], ["res.partner", []], ["sale.order", []], ["client.contract", []]]) {
    const r = await o.son(m, d).catch((e) => ({ matn: e.message }));
    console.log(`  ${m}${d.length ? " " + JSON.stringify(d) : ""}: ${r.count ?? r.matn}`);
  }
  console.log(`\nkalkulyator sinovi (500 000 so'm/oy): ${JSON.stringify(hisobla({ oylikTolov: 500000 }))}`);
  console.log(`to'plam 20 kVt tekis: ${JSON.stringify(toplam(20, "tekis"))}`);
  console.log(`narx 20 kVt: ${pul(narx1kvt(20).som)} so'm/kVt`);
} else if (buyruq === "lid") {
  await lidYarat(o, { nom: bayroq("nom", "Nomsiz lid"), tel: bayroq("telefon"), xudud: bayroq("xudud"), jamoa: bayroq("jamoa"), manba: bayroq("manba") });
} else if (buyruq === "kvalifikatsiya") {
  await kvalifikatsiya(o, argv[1], { maqsad: bayroq("maqsad"), stansiya: bayroq("stansiya"), oylikTolov: bayroq("oylik-tolov"), oylikKwh: bayroq("oylik-kwh"), yillikKwh: bayroq("yillik-kwh"), tip: bayroq("tip"), muddat: bayroq("muddat") });
} else if (buyruq === "kp") {
  await kp(o, argv[1], { tom: bayroq("tom", "tekis"), kvt: bayroq("kvt"), docx: argv.includes("--docx") });
} else if (buyruq === "sinov") {
  // Uchdan-uchiga: ko'rinadigan «Test» jamoasida belgilangan sinov lidi, oxirida arxivlanadi
  const belgi = Math.random().toString(36).slice(2, 6).toUpperCase();
  const nom = `AVTOMAT SINOV ${belgi} ${new Date().toISOString().slice(0, 16)} — o'chirish mumkin`;
  const sinovTel = `90${String(1000000 + Math.floor(Math.random() * 8999999))}`;   // 9 raqam -> +998 90 xxxxxxx
  const mavjud = bayroq("lid");
  let id;
  if (mavjud) { console.log(`1) mavjud lid: #${mavjud} (yaratish o'tkazib yuborildi)`); id = Number(mavjud); }
  else { console.log("1) lid yaratish"); const l = await lidYarat(o, { nom, tel: sinovTel, xudud: "Toshkent", jamoa: Q.crm.sinov_team_id, kompaniya: Q.crm.sinov_company_id }); id = l.id; }
  if (!id || Number.isNaN(Number(id))) { console.log(YOZ ? "\nsinov to'xtadi: id aniqlanmadi (yuqoridagi sabab)" : "\n[SINOV] qolgan qadamlar id bo'lmagani uchun ko'rsatilmadi — jonli sinov: --yoz"); console.log(`\nMCP: ${o.stats.calls} chaqiruv, ${o.stats.errors} xato`); process.exit(0); }
  console.log("2) kvalifikatsiya + kalkulyator"); await kvalifikatsiya(o, id, { maqsad: 1, stansiya: "On-Grid", oylikTolov: 500000, tip: "Истемолчи" });
  console.log("3) КП maydonlari"); await kp(o, id, { tom: "tekis", docx: false });
  console.log("4) aktivlik (keyingi qadam)");
  const ertaga = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  try { const a = await o.aktivlik("crm.lead", id, { summary: "Avtomat: mijozga qo'ng'iroq", date_deadline: ertaga }); console.log(`  ✓ aktivlik (${ertaga}): ${JSON.stringify(a).slice(0, 90)}`); } catch (e) { console.log(`  ! aktivlik: ${e.message}`); }
  console.log("5) qayta o'qish");
  const r = await o.oqi("crm.lead", [["id", "=", id]], ["name", F.telefon, F.maqsad, F.stansiya_turi, F.kerakli_kvt, F.fakt_quvvat, F.tarif, F.panel_brendi, F.invertor_brendi, F.kafolat, F.yillik_istemol], { limit: 1 });
  console.log("  " + JSON.stringify(r.records?.[0] || r).slice(0, 460));
  if (!mavjud) { console.log("6) arxivlash (o'chirish yopiq — active=false)"); await yozuv(o, "crm.lead", [id], { active: false }, "arxivlash"); }
  else console.log("6) arxivlanmadi — mavjud lid (--lid) tegilmaydi");
} else {
  console.log("Buyruqlar: holat | lid | kvalifikatsiya <id> | kp <id> | sinov   (--yoz bo'lmasa sinov rejimi)");
}
console.log(`\nMCP: ${o.stats.calls} chaqiruv, ${o.stats.errors} xato`);
