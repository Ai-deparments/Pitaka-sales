// Murabbiy v2 — kunlik mahorat («Bugungi mahorat»), kun yakuni natija qatori va mini-darslar (2026-11-01).
// Operatorning oxirgi suhbatlaridagi eng past mezon kuniga BITTA fokus bo'ladi; kechqurun o'sish ko'rsatiladi.
// Faqat matn va bazaga yozish; tarmoq yo'q. murabbiy.mjs dan IMPORT QILINMAYDI (aylana bo'lmasin) — QISQA/MASLAHAT shu yerda.
import { RUBRIC } from "./callai.mjs";
import { yashir } from "./ertalab.mjs";

export const QISQA = { greeting: "Salomlashish", needs: "Ehtiyoj", questions: "Savollar", listening: "Tinglash",
  value: "Qiymat", objection: "E’tiroz", nextStep: "Keyingi qadam", closing: "Yakun" };
// Mezon zaif chiqqanda — Pitaka «oltin ssenariylari»dan (ProAudit: Pre Sale, Qayta) bitta aniq gap
export const MASLAHAT = {
  greeting: "Boshida ismingiz va kompaniyani ayting: «Assalomu alaykum, [ism] aka! Men Pitaka kompaniyasidan [ismingiz] bo‘laman. Premium chexollarimizga qiziqish qoldirgan ekansiz — 2 daqiqa vaqtingiz bormi?»",
  needs: "Narxdan oldin kvalifikatsiya qiling: qaysi telefon modeli, oldin Pitaka ishlatganmi, yupqa kerakmi yoki himoyasi kuchlirog‘i.",
  questions: "Ha/yo‘q savol o‘rniga ochiq savol bering: «Chexolda siz uchun eng muhimi nima — yupqaligi, himoyasi yoki dizayni?»",
  listening: "Mijoz gapini oxirigacha tinglang — suhbatda sizning ulushingiz 60% dan oshmasin.",
  value: "Narxdan oldin qiymatni ayting: «Aramid tolasi — po‘latdan 5 barobar pishiq, chexol bor-yo‘g‘i 18 gramm, sirpanmaydi, barmoq izi qolmaydi».",
  objection: "E’tirozni tan oling, aniqlang, keyin dalil bering: rasmiy diler, kafolat, 10 kun ichida qaytarish, oddiy chexol 2–3 oyda almashadi.",
  nextStep: "Suhbatni aniq qadam bilan yoping: «Hozir Telegram’ga telefoningizga mos 2–3 model rasmini tashlayman — shu nomerda Telegram bormi?»",
  closing: "Xayrlashishdan oldin kelishuvni takrorlang (Dojim): nima, qachon, qayerga — va ismingizni yana bir bor ayting.",
};

// ---------------------------------------------------------------- yordamchilar
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kes = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const MIN_SEK = 60;            // fokus faqat ≥60 s tahlil qilingan suhbatlardan
const MIN_N = 3;               // bundan kam suhbatda fokus yo'q
const MAQSAD = 70;
const kunChegara = (sana) => { const a = Date.parse(`${sana}T00:00:00+05:00`); return [new Date(a).toISOString(), new Date(a + 864e5).toISOString()]; };
const parse = (s) => { try { const o = JSON.parse(s); return o && typeof o === "object" ? o : {}; } catch { return {}; } };
const pct = (p) => Math.round(p * 100);

export function init(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS coach_focus (
    user_id INTEGER NOT NULL, day TEXT NOT NULL, crit TEXT NOT NULL, base REAL, sent_at TEXT,
    PRIMARY KEY (user_id, day))`);
}

// ---------------------------------------------------------------- fokus
// O'rtacha mezon bo'yicha: faqat shu mezon bahosi bor suhbatlar sanaladi; teng bo'lsa — vazni (max) katta mezon.
export function fokus(db, owner, n = 10) {
  const rows = db.prepare(`SELECT crit FROM coach_calls WHERE owner=? AND dur>=? AND score IS NOT NULL
    AND crit IS NOT NULL AND crit<>'{}' ORDER BY at DESC LIMIT ?`).all(String(owner), MIN_SEK, n)
    .map((r) => parse(r.crit)).filter((c) => Object.keys(c).length);
  if (rows.length < MIN_N) return null;
  let best = null;
  for (const r of RUBRIC) {
    const v = rows.map((c) => c[r.id]).filter((x) => typeof x === "number" && Number.isFinite(x));
    if (!v.length) continue;
    const p = v.reduce((a, b) => a + b, 0) / v.length;
    if (!best || p < best.p - 1e-9 || (Math.abs(p - best.p) <= 1e-9 && r.max > best.max)) best = { crit: r.id, p, max: r.max };
  }
  return best ? { crit: best.crit, p: best.p, n: rows.length } : null;
}

// ---------------------------------------------------------------- eng yaxshi namuna
// Faqat shu mezon bahosi ≥ 0.5 bo'lgan suhbatlardan; «tinglash» (gap bo'lish dalili) umuman iqtibos qilinmaydi;
// dalilda gapiruvchi (by/speaker/who) ko'rsatilgan bo'lsa — faqat operator; telefon/pochta yashiriladi.
export function iqtibos(db, owner, crit, days = 30) {
  if (crit === "listening") return null;
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const rows = db.prepare(`SELECT call_id, crit FROM coach_calls WHERE owner=? AND at>=? AND crit IS NOT NULL ORDER BY at DESC`)
    .all(String(owner), since)
    .map((r) => ({ id: r.call_id, v: parse(r.crit)[crit] })).filter((r) => typeof r.v === "number" && r.v >= 0.5)
    .sort((a, b) => b.v - a.v)                        // barqaror saralash: teng bo'lsa yangisi oldin
    .slice(0, 30);
  const js = db.prepare("SELECT json FROM call_analyses WHERE call_id=? AND status='ready'");
  const operatorMi = (e) => { const k = e.by ?? e.speaker ?? e.who; return k == null || k === "" || String(k).toLowerCase() === "operator"; };
  for (const r of rows) {
    const j = parse(js.get(r.id)?.json);
    const c = (j.operator_score?.criteria || []).find((x) => x.id === crit);
    const ev = (c?.evidence || []).find((e) => e && String(e.quote ?? "").trim() && operatorMi(e));
    if (ev) return { quote: kes(yashir(ev.quote), 140), ts: ev.ts ?? null, callId: r.id };
  }
  return null;
}

// ---------------------------------------------------------------- ertalabki xabar
export function mahorat(db, { userId, owner }, sana) {
  init(db);
  if (db.prepare("SELECT 1 FROM coach_focus WHERE user_id=? AND day=?").get(userId, sana)) return null;
  const f = fokus(db, owner);
  if (!f) return null;
  const nom = QISQA[f.crit] || f.crit;
  const L = [`🎯 <b>Bugungi mahorat:</b> ${esc(nom)} — oxirgi ${f.n} suhbatda ${pct(f.p)}%`, esc(MASLAHAT[f.crit] || "")];
  const q = iqtibos(db, owner, f.crit);
  if (q) L.push(`⭐ Sizning eng yaxshi namunangiz: «${esc(q.quote)}»`);
  L.push(`🎯 Maqsad: bugungi suhbatlarda ${esc(nom)} ≥ ${MAQSAD}%`);
  const r = db.prepare("INSERT OR IGNORE INTO coach_focus(user_id, day, crit, base, sent_at) VALUES (?,?,?,?,?)")
    .run(userId, sana, f.crit, f.p, new Date().toISOString());
  if (!r.changes) return null;
  return { html: L.join("\n"), crit: f.crit, base: f.p };
}

// ---------------------------------------------------------------- kun yakuni: fokus natijasi
export function natija(db, userId, owner, sana) {
  init(db);
  const fr = db.prepare("SELECT crit, base FROM coach_focus WHERE user_id=? AND day=?").get(userId, sana);
  if (!fr || fr.base == null) return null;
  const [a, b] = kunChegara(sana);
  const v = db.prepare(`SELECT crit FROM coach_calls WHERE owner=? AND at>=? AND at<? AND dur>=? AND score IS NOT NULL
    AND crit IS NOT NULL`).all(String(owner), a, b, MIN_SEK)
    .map((r) => parse(r.crit)[fr.crit]).filter((x) => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return null;
  const x = pct(fr.base), y = pct(v.reduce((s, t) => s + t, 0) / v.length), d = y - x;
  const belgi = d >= 5 ? "✅" : d <= -5 ? "⚠️" : "➖";
  return `🎯 Fokus «${esc(QISQA[fr.crit] || fr.crit)}»: ${x}% → ${y}% ${belgi}`;
}

// ---------------------------------------------------------------- mini-darslar (Pitaka ssenariylari ruhida: Pre Sale, Qayta)
export const DARS = {
  greeting: {
    qoida: "Suhbat boshida salomlashing, ismingiz va Pitaka’ni ayting, murojaat sababini va 2 daqiqaga ruxsat so‘rang.",
    yaxshi: "Assalomu alaykum, Aziz aka! Yaxshimisiz? Men Pitaka kompaniyasidan Dilshod bo‘laman. Premium chexollarimizga qiziqish qoldirgan ekansiz — hozir gaplashishga 2 daqiqa vaqtingiz bormi?",
    yomon: "Allo, ha, eshityapman… sizga nima kerak edi?",
    mashq: "Bugun har qo‘ng‘iroqni shu tartibda boshlang: salom → ism → Pitaka → murojaat sababi → «2 daqiqa vaqtingiz bormi?».",
  },
  needs: {
    qoida: "Narxdan oldin kvalifikatsiya qiling: telefon modeli, Pitaka tajribasi, yupqa yoki himoyasi kuchli chexol kerakligi.",
    yaxshi: "Qaysi telefon modeli uchun qidiryapsiz? Oldin Pitaka ishlatib ko‘rganmisiz? Sizga yupqa, telefonda bilinmaydigani kerakmi yoki himoyasi kuchlirog‘i?",
    yomon: "Chexol 889 ming turadi. Olasizmi?",
    mashq: "Bugun narxni aytishdan oldin modelni, tajribani va ehtiyojni (yupqa/himoya) aniqlang va CRM izohiga yozing.",
  },
  questions: {
    qoida: "Ha/yo‘q savol o‘rniga ochiq savol bering: «qaysi», «qanday», «nima uchun».",
    yaxshi: "Chexolda siz uchun eng muhimi nima — yupqaligi, himoyasi yoki dizayni?",
    yomon: "Chexol kerakmi?",
    mashq: "Bugun kamida 3 ta savolni «qaysi / qanday / nima uchun» so‘zi bilan boshlang.",
  },
  listening: {
    qoida: "Mijoz gapini oxirigacha tinglang, gapini bo‘lmang — suhbatda sizning ulushingiz 60% dan oshmasin.",
    yaxshi: "Tushundim, ya’ni oldingi chexolingiz tez rangini yo‘qotgan. Yana nimasi yoqmagan edi?",
    yomon: "Yo‘q-yo‘q, buni gapirmang, avval mening taklifimni eshiting…",
    mashq: "Mijoz gapini tugatgach 2 soniya jim turing, keyin gapini bir gapda takrorlab javob bering.",
  },
  value: {
    qoida: "Xususiyat → afzallik → foyda: Aramid tolasi → telefon himoyada va yengil → qo‘lda premium his, barmoq izi qolmaydi.",
    yaxshi: "Pitaka chexollari Aramid tolasidan to‘qiladi — po‘latdan 5 barobar pishiq, harbiylarning bronjiletlarida ishlatiladi. Chexol bor-yo‘g‘i 18 gramm, qo‘lda sezilmaydi, sirpanmaydi va barmoq izi qolmaydi.",
    yomon: "Biz eng yaxshimiz, eng arzonmiz, boshqalardan ancha yaxshi.",
    mashq: "Bugun har suhbatda narxni aytishdan oldin Aramid, 18 gramm va kafolatni bir gapda ayting.",
  },
  objection: {
    qoida: "E’tirozni tan oling, aniqlang, keyin dalil bering — bahslashmang: rasmiy diler, kafolat, 10 kun ichida qaytarish.",
    yaxshi: "To‘g‘ri aytyapsiz, bozorda arzonroq variantlar bor — ular ko‘pincha nusxa. Biz rasmiy dilermiz, kafolat beramiz va 10 kun ichida yoqmasa pulingizni qaytaramiz. Oddiy chexol 2–3 oyda almashadi, Pitaka yillar xizmat qiladi.",
    yomon: "Yo‘q, bizniki qimmat emas, boshqalar yomon ishlaydi.",
    mashq: "Bugun e’tirozga javobdan oldin «Aniqrog‘i, nimasi sizni o‘ylantiryapti — narximi yoki modelimi?» savolini bering.",
  },
  nextStep: {
    qoida: "Suhbatni aniq qadam bilan yoping: buyurtma, ofisga tashrif yoki Telegram’ga rasmlar — «keyinroq» demang.",
    yaxshi: "Keling, hozir Telegram’dan telefoningiz rangiga mos 2–3 ta eng chiroyli model rasmini tashlab beraman — shu nomerda Telegramingiz bormi?",
    yomon: "Mayli, keyinroq bog‘lanamiz.",
    mashq: "Bugun har suhbat oxirida «qachon va nimani qilamiz» deb so‘rang va CRM’ga sana bilan yozing.",
  },
  closing: {
    qoida: "Dojim: xayrlashishdan oldin kelishuvni takrorlang — nima, qachon, qayerga — va ismingizni yana ayting.",
    yaxshi: "Bo‘ldi, kelishdik: buyurtmangizni rasmiylashtirdim, kuryerimiz borishidan oldin siz bilan bog‘lanadi. Savol bo‘lsa shu nomerga qo‘ng‘iroq qiling, ismim Dilshod. Xaridingiz bilan tabriklayman!",
    yomon: "Ha, mayli, xayr.",
    mashq: "Bugun har suhbatni 1 gaplik xulosa bilan tugating: «Kelishdik: …».",
  },
};

export function dars(crit, { quote } = {}) {
  const d = DARS[crit];
  if (!d) return null;
  const L = [`📘 <b>Mini-dars: ${esc(QISQA[crit] || crit)}</b>`, `📌 ${esc(d.qoida)}`,
    `✅ <i>${esc(d.yaxshi)}</i>`, `❌ <i>${esc(d.yomon)}</i>`];
  if (quote && String(quote).trim()) L.push(`⭐ Sizning namunangiz: «${esc(kes(quote, 140))}»`);
  L.push(`🏋️ Mashq: ${esc(d.mashq)}`);
  return L.join("\n");
}

// ---------------------------------------------------------------- /dars <mezon>
const KIR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i",
  ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h" };
const norm = (s) => String(s ?? "").toLowerCase().replace(/[а-яёўқғҳ]/g, (c) => KIR[c] ?? c)
  .replace(/[‘’ʻʼ'`´]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const ALIAS = {
  greeting: ["salom", "salomlashish", "tanishuv", "tanishtirish", "assalomu alaykum"],
  needs: ["ehtiyoj", "ehtiyojlar", "ehtiyojni aniqlash", "needs"],
  questions: ["savol", "savollar", "savol berish"],
  listening: ["tinglash", "eshitish", "tingla"],
  value: ["qiymat", "qadriyat", "foyda"],
  objection: ["etiroz", "etirozlar", "etiroz bilan ishlash"],
  nextStep: ["keyingi qadam", "qadam", "nextstep", "next step"],
  closing: ["yakun", "yakunlash", "xayrlashish", "xayr"],
};
const TOP = new Map();
for (const [id, arr] of Object.entries(ALIAS)) { TOP.set(norm(id), id); for (const a of arr) TOP.set(norm(a), id); }
export function mezonTop(text) {
  const t = norm(text);
  if (!t) return null;
  if (TOP.has(t)) return TOP.get(t);
  for (const [a, id] of TOP) if (a.length >= 4 && ` ${t} `.includes(` ${a} `)) return id;
  return null;
}
