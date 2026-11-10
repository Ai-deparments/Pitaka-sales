// TZ §4, §5 — qo'ng'iroq tahlili dvigateli.
//
// Ikki qatlam:
//   1) QOIDA qatlami — determinstik. Transkriptdan dalilni O'ZI topadi: kritik iboralar,
//      vaqt kodlari, savollar, gap bo'lish, va'dalar, faktlar. Har doim ishlaydi, AI shart emas.
//   2) AI qatlami — talqin: xulosa, muammo, ehtiyoj, e'tiroz matni.
//      AI natijasi transkriptga taqqoslanadi: matnda yo'q iqtibos — tashlab yuboriladi.
//
// TZ §15: "AI hech qachon suhbatda bo'lmagan faktni tasdiqlangan ma'lumot sifatida yozmasin".
// Shuning uchun har bir AI da'vosi `line` indeksiga bog'lanadi va matn bo'yicha tekshiriladi.
//
// Muhim qaror (sinovda topilgan): mijozning MUAMMOSI (jarima, tekshiruv) va bizga
// qarshi E'TIROZI (qimmat, o'ylab ko'raman) bir xil emas. Muammo — sotuv imkoniyati,
// u kayfiyatni tushirmaydi; e'tiroz — javob talab qiladigan to'siq. Shuning uchun
// lug'atda `kind` bor va ball/kayfiyat/xavf shunga qarab hisoblanadi.

import { COLORS, KINDS, DEFAULT_DICT, FACT_PATTERNS, OPEN_Q, GREET, INTRO, CLOSE, VALUE, NEXT_STEP, URGENCY } from "./calldict.mjs";

export const MODEL_VERSION = "pitaka-callai/1.0";
export const PROMPT_VERSION = "p3";   // p3 (2026-11-10): Pitaka — premium Aramid chexollar, ProAudit ssenariylari (eski: SUN-HIGHTECH)
export { COLORS, KINDS, DEFAULT_DICT };

const CPS = 14;               // taxminiy nutq tezligi (belgi/soniya) — vaqt kodi yo'q bo'lsa
// Apostrof uch xil yoziladi (' ' ʻ ʼ) — solishtirishdan oldin bittaga keltiriladi.
export const norm = (s) => String(s || "").toLowerCase().replace(/[''`ʻʼ‘’]/g, "'").replace(/\s+/g, " ").trim();
export const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// ---------------------------------------------------------------- transkript
const SPK = [
  { who: "operator", re: /^(operator|оператор|menejer|менеджер|sotuvchi|продавец|pitaka|консультант|maslahatchi|agent|s|o|m)$/i },
  { who: "customer", re: /^(mijoz|клиент|customer|abonent|абонент|k|c|mij)$/i },
];
export function parseTranscript(raw) {
  const out = [];
  const src = String(raw || "").replace(/\r/g, "");
  let lastWho = "operator", clock = 0, anyTs = false;

  for (const line of src.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let rest = s, ts = null;
    const tm = rest.match(/^[[(]?\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[\])]?\s*[-–—]?\s*/);
    if (tm) {
      ts = (tm[1] ? +tm[1] * 3600 : 0) + +tm[2] * 60 + +tm[3];
      rest = rest.slice(tm[0].length);
      anyTs = true;
    }
    let who = null;
    const sm = rest.match(/^([^:]{1,24}):\s*/);
    if (sm) {
      const tag = sm[1].trim().replace(/\s*\(.*\)$/, "");
      for (const p of SPK) if (p.re.test(tag)) { who = p.who; break; }
      if (who) rest = rest.slice(sm[0].length);
    }
    rest = rest.trim();
    if (!rest) continue;
    if (!who) who = out.length ? lastWho : "operator";
    lastWho = who;

    const dur = Math.max(1, Math.round(rest.length / CPS));
    const at = ts !== null ? ts : clock;
    clock = at + dur + 1;
    out.push({ i: out.length, at, dur, end: at + dur, who, text: rest, n: norm(rest) });
  }
  for (const l of out) l.est = !anyTs;
  return { lines: out, hasTimestamps: anyTs };
}

// ---------------------------------------------------------------- dalil qatlami
// Iqtibosni so'z o'rtasidan kesmaslik uchun chegaraga tekislaymiz
// (sinovda «mi? Men shikoyat yozaman…» bo'lib chiqqandi).
function clip(text, pos, len, before = 45, after = 65) {
  let a = Math.max(0, pos - before), b = Math.min(text.length, pos + len + after);
  if (a > 0) { const sp = text.indexOf(" ", a); a = sp >= 0 && sp < pos ? sp + 1 : a; }
  if (b < text.length) { const sp = text.lastIndexOf(" ", b); b = sp > pos + len ? sp : b; }
  return (a > 0 ? "…" : "") + text.slice(a, b).trim() + (b < text.length ? "…" : "");
}

function findHits(lines, dict) {
  const hits = [];
  const seen = new Set();
  for (const l of lines) {
    for (const d of dict) {
      const term = norm(d.term);
      if (!term || !l.n.includes(term)) continue;
      const k = `${l.i}|${term}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const pos = l.n.indexOf(term);
      hits.push({
        color: d.color, kind: d.kind || "objection", term: d.term,
        line: l.i, at: l.at, ts: mmss(l.at), speaker: l.who,
        quote: clip(l.text, pos, term.length),
        context: l.text, reason: d.reason, tip: d.tip, est: !!l.est,
      });
    }
  }
  return hits;
}

function findFacts(lines) {
  const facts = [];
  const seen = new Set();
  for (const l of lines) {
    for (const p of FACT_PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(l.text)) !== null) {
        const v = m[0].trim();
        const k = `${l.i}|${p.kind}|${norm(v)}`;
        if (!seen.has(k)) {
          seen.add(k);
          facts.push({ kind: p.kind, label: p.label, value: v, line: l.i, at: l.at, ts: mmss(l.at), speaker: l.who });
        }
        if (m.index === p.re.lastIndex) p.re.lastIndex++;   // nol uzunlikdagi moslikdan qotib qolmaslik
        if (facts.length > 200) return facts;
      }
    }
  }
  return facts;
}

const byKind = (hits, kind, who) => hits.filter((h) => h.kind === kind && (!who || h.speaker === who));

export function evidence(lines, dict = DEFAULT_DICT, hasTs = false) {
  const hits = findHits(lines, dict);
  const facts = findFacts(lines);
  const op = lines.filter((l) => l.who === "operator");
  const cu = lines.filter((l) => l.who === "customer");
  const chars = (a) => a.reduce((s, l) => s + l.text.length, 0);
  const opChars = chars(op), cuChars = chars(cu), all = opChars + cuChars || 1;

  const questions = op.filter((l) => /\?/.test(l.text));
  const openQ = op.filter((l) => OPEN_Q.test(l.n) && /\?/.test(l.text));

  // Gap bo'lish va sukut — faqat HAQIQIY vaqt kodi bo'lganda o'lchanadi.
  // Taxminiy vaqtda bu ko'rsatkich ma'nosiz, shuning uchun "o'lchanmadi" deb beriladi (TZ §10).
  const interrupts = [], silences = [];
  if (hasTs) {
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1], b = lines[i];
      if (a.who !== b.who && b.at < a.end - 1)
        interrupts.push({ line: b.i, at: b.at, ts: mmss(b.at), by: b.who, quote: b.text.slice(0, 90) });
      const gap = b.at - a.end;
      if (gap >= 5) silences.push({ line: b.i, at: a.end, ts: mmss(a.end), sec: Math.round(gap) });
    }
  }

  return {
    hits, facts,
    counts: {
      lines: lines.length, operator: op.length, customer: cu.length,
      red: hits.filter((h) => h.color === "red").length,
      yellow: hits.filter((h) => h.color === "yellow").length,
      green: hits.filter((h) => h.color === "green").length,
      // mantiq uchun — faqat MIJOZ aytgani hisobga olinadi
      pain: byKind(hits, "pain", "customer").length,
      objection: byKind(hits, "objection", "customer").length,
      risk: byKind(hits, "risk", "customer").length,
      buy: byKind(hits, "buy", "customer").length,
      questions: questions.length, openQuestions: openQ.length,
      interrupts: interrupts.length, silences: silences.length,
    },
    talkShare: { operator: Math.round(opChars / all * 100), customer: Math.round(cuChars / all * 100) },
    longestMonologueSec: lines.reduce((m, l) => Math.max(m, l.dur), 0),
    interrupts, silences,
    measured: { interrupts: hasTs, silences: hasTs },
    greeting: op.slice(0, 3).some((l) => GREET.test(l.n)),
    intro:    op.slice(0, 6).some((l) => INTRO.test(l.n)),
    closing:  op.slice(-4).some((l) => CLOSE.test(l.n)),
    valueTalk: op.filter((l) => VALUE.test(l.n)),
    nextStepTalk: op.filter((l) => NEXT_STEP.test(l.n)),
    questionLines: questions, openQLines: openQ,
    urgentLines: lines.filter((l) => URGENCY.test(l.n)),
  };
}

// ---------------------------------------------------------------- §F 100 ballik
export const RUBRIC = [
// Pitaka Pre Sale / Qayta ssenariysi bosqichlari bo'yicha (ProAudit, data/pitaka-scenarios.json).
  { id: "greeting",  label: "Salomlashish, Pitaka va ismini aytish, ruxsat so'rash", max: 10 },
  { id: "needs",     label: "Kvalifikatsiya: telefon modeli, Pitaka tajribasi, yupqa yoki himoya", max: 20 },
  { id: "questions", label: "Ochiq savollar", max: 15 },
  { id: "listening", label: "Faol tinglash va gapni bo'lmaslik", max: 10 },
  { id: "value",     label: "Mini taqdimot: Aramid, 18 g, kafolat, rasmiy diler, 10 kunda qaytarish", max: 15 },
  { id: "objection", label: "E'tirozlar: qimmat, o'ylab ko'raman, pulim yo'q, ariza qoldirmaganman", max: 15 },
  { id: "nextStep",  label: "Keyingi qadam: buyurtma, ofisga tashrif yoki Telegram'ga rasmlar", max: 10 },
  { id: "closing",   label: "Dojim: kelishuvni takrorlash va xayrlashish", max: 5 },
];
const cite = (l, max = 160) => ({ line: l.i, ts: mmss(l.at), quote: l.text.slice(0, max) });

export function ruleScore(lines, ev) {
  const op = lines.filter((l) => l.who === "operator");
  const C = [];
  const put = (id, score, evidence, tip, note) => {
    const r = RUBRIC.find((x) => x.id === id);
    C.push({ id, label: r.label, max: r.max,
      score: Math.max(0, Math.min(r.max, Math.round(score))),
      evidence: evidence || [], tip: tip || null, note: note || null });
  };

  const gl = op.slice(0, 3).find((l) => GREET.test(l.n));
  const il = op.slice(0, 6).find((l) => INTRO.test(l.n));
  put("greeting", (gl ? 5 : 0) + (il ? 5 : 0), [gl, il].filter(Boolean).map((l) => cite(l)),
      gl && il ? null : !gl ? "Suhbat boshida salomlashing" : "O'zingizni va kompaniyani tanishtiring",
      gl || il ? null : "Salomlashish ham, tanishtirish ham topilmadi");

  // Ehtiyojni aniqlash: savollar soni + mijozning gapirish ulushi
  const nq = ev.counts.questions, share = ev.talkShare.customer;
  put("needs", Math.min(12, nq * 3) + Math.min(8, share / 5),
      ev.questionLines.slice(0, 3).map((l) => cite(l)),
      nq >= 4 ? null : "Kamida 4–5 savol bilan ehtiyojni oching",
      `${nq} ta savol berilgan, mijoz suhbatning ${share}% ini gapirgan`);

  const oq = ev.counts.openQuestions;
  put("questions", Math.min(15, oq * 4), ev.openQLines.slice(0, 3).map((l) => cite(l)),
      oq >= 3 ? null : "Yopiq savol o'rniga «nima uchun», «qanday», «qancha» bilan boshlang",
      `${oq} ta ochiq savol`);

  if (ev.measured.interrupts) {
    let s = 10 - ev.counts.interrupts * 2;
    if (ev.talkShare.operator > 75) s -= 3;
    put("listening", s, ev.interrupts.slice(0, 3).map((x) => ({ line: x.line, ts: x.ts, quote: x.quote })),
        ev.counts.interrupts ? "Mijozning gapini bo'lmang — javobni oxirigacha eshiting" : null,
        `${ev.counts.interrupts} marta gap bo'lingan, operator ulushi ${ev.talkShare.operator}%`);
  } else {
    const s = ev.talkShare.operator > 75 ? 5 : ev.talkShare.operator > 60 ? 8 : 10;
    put("listening", s, [], ev.talkShare.operator > 70 ? "Ko'proq eshiting — operator ulushi juda katta" : null,
        `Vaqt kodi yo'q — gap bo'lish o'lchanmadi. Operator ulushi ${ev.talkShare.operator}%`);
  }

  const vl = ev.valueTalk;
  put("value", Math.min(15, vl.length * 5), vl.slice(0, 3).map((l) => cite(l)),
      vl.length >= 2 ? null : "Narxdan oldin qiymatni ayting: Aramid (po'latdan 5 barobar pishiq), 18 gramm, kafolat, rasmiy diler, 10 kunda qaytarish",
      vl.length ? `${vl.length} marta qiymat tilga olingan` : "Qiymat tushuntirilgani topilmadi");

  // E'tiroz — faqat MIJOZ aytgan `objection`/`risk`. Mijozning muammosi (pain) e'tiroz emas.
  const obj = ev.hits.filter((h) => h.speaker === "customer" && (h.kind === "objection" || h.kind === "risk"));
  if (!obj.length) {
    put("objection", 15, [], null, "Suhbatda e'tiroz bo'lmagan — mezon to'liq hisoblandi");
  } else {
    const uniq = [...new Map(obj.map((h) => [h.line, h])).values()];
    let answered = 0;
    const proof = [];
    for (const h of uniq) {
      const next = lines.find((l) => l.i > h.line && l.who === "operator" && l.text.length > 40);
      if (next) { answered++; proof.push({ line: next.i, ts: mmss(next.at), quote: next.text.slice(0, 160) }); }
    }
    put("objection", 15 * (answered / uniq.length),
        (answered ? proof : uniq.map((h) => ({ line: h.line, ts: h.ts, quote: h.quote }))).slice(0, 3),
        answered < uniq.length ? "Har bir e'tirozga javob bering — javobsiz qolgani bitimni o'ldiradi" : null,
        `${uniq.length} e'tirozdan ${answered} tasiga javob berilgan`);
  }

  const ns = ev.nextStepTalk;
  const hasDate = ev.facts.some((f) => f.kind === "date" || f.kind === "time");
  put("nextStep", (ns.length ? 6 : 0) + (hasDate ? 4 : 0), ns.slice(0, 2).map((l) => cite(l)),
      ns.length && hasDate ? null : !ns.length ? "Suhbat oxirida aniq keyingi qadamni ayting" : "Keyingi qadamga aniq sana qo'ying",
      hasDate ? null : "Aniq sana kelishilmagan");

  const cl = op.slice(-4).find((l) => CLOSE.test(l.n));
  put("closing", cl ? 5 : 0, cl ? [cite(cl)] : [], cl ? null : "Kelishuvni takrorlab tasdiqlang va xayrlashing");

  return { total: C.reduce((s, c) => s + c.score, 0), criteria: C };
}

// ---------------------------------------------------------------- §G metodika
export function methodology(lines, ev) {
  const mk = (id, label, state, why) => ({ id, label, state, why });
  const st = (b, p) => (b ? "done" : p ? "partial" : "missed");
  // Pitaka Pre Sale ssenariysi bosqichlari (ProAudit): tanishuv → kvalifikatsiya (model) → mini taqdimot →
  // narx kafolat bilan → e'tirozlar → keyingi qadam. B2B bandlari (qaror qiluvchi, qaror muddati) olib tashlangan.
  // `\b` is ASCII-only in JS, so Cyrillic names have no boundary; a bare number needs a suffix ("15 minut" is not a model);
  // plain "ultra" is left out because the operator says "Ultra Slim" about the case itself.
  const MODEL = /(iphone|samsung|galaxy|айфон|самсунг|\b1[1-7]\s*(pro\s*max|pro|max|plus|mini)\b|\bs2[1-6]\b|z\s*(fold|flip))/i;
  const modelLine = lines.find((l) => MODEL.test(l.text));
  const askedModel = lines.some((l) => l.who === "operator" && /model|qaysi telefon|qanaqa telefon|какой телефон|модел/i.test(l.text));
  const money = ev.facts.some((f) => f.kind === "money");
  const warranty = lines.some((l) => l.who === "operator" && /kafolat|garantiya|гаранти|кафолат/i.test(l.text));
  const obj = ev.hits.filter((h) => h.speaker === "customer" && (h.kind === "objection" || h.kind === "risk"));
  const objAnswered = obj.length
    ? obj.every((h) => lines.some((l) => l.i > h.line && l.who === "operator" && l.text.length > 40)) : true;
  return [
    mk("contact", "Salomlashdi, Pitaka nomidan tanishtirdi", st(ev.greeting && ev.intro, ev.greeting || ev.intro),
       ev.greeting ? (ev.intro ? "Salomlashdi va tanishtirdi" : "Salomlashdi, lekin tanishtirmadi") : ev.intro ? "Tanishtirdi, salomlashish topilmadi" : "Salomlashish topilmadi"),
    mk("model", "Telefon modeli aniqlandi", st(!!modelLine, askedModel),
       modelLine ? `Model aytildi: «${modelLine.text.slice(0, 60)}»` : askedModel ? "Model so'raldi, lekin javob aniq emas" : "Model so'ralmagan"),
    mk("need", "Ehtiyoj ochildi (yupqa yoki himoya, rang)",
       st(ev.counts.questions >= 3 && ev.talkShare.customer >= 30, ev.counts.questions >= 1),
       `${ev.counts.questions} ta savol, mijoz suhbatning ${ev.talkShare.customer}% ini gapirgan`),
    mk("value", "Pitaka qiymati tushuntirildi (Aramid, yengil, kafolat)", st(ev.valueTalk.length >= 2, ev.valueTalk.length >= 1),
       ev.valueTalk.length ? `${ev.valueTalk.length} marta qiymat tilga olingan` : "Qiymat tushuntirilmagan"),
    mk("price", "Narx kafolat bilan birga aytildi", st(money && warranty, money || warranty),
       money ? (warranty ? "Narx va kafolat aytildi" : "Narx aytildi, kafolat aytilmadi") : warranty ? "Kafolat aytildi, narx aytilmadi" : "Narx aytilmagan"),
    mk("objection", "E'tirozga javob berildi", obj.length ? st(objAnswered, true) : "done",
       obj.length ? `${obj.length} e'tiroz${objAnswered ? ", hammasiga javob berilgan" : ""}` : "E'tiroz bo'lmagan"),
    mk("nextStep", "Keyingi qadam kelishildi (buyurtma, Telegram'ga rasm, ofis)", st(ev.nextStepTalk.length > 0, false),
       ev.nextStepTalk.length ? `«${ev.nextStepTalk[0].text.slice(0, 60)}»` : "Keyingi qadam aytilmagan"),
  ];
}

// ---------------------------------------------------------------- §E kayfiyat
// Faqat MIJOZ aytgani kayfiyatni o'lchaydi. Mijozning muammosi (pain) — bu norozilik
// emas, ehtiyoj signali; shuning uchun u kayfiyatga ta'sir qilmaydi.
const MOOD = { risk: -3, objection: -1.5, buy: 3, pain: 0 };
export function sentiment(lines, ev) {
  const cu = lines.filter((l) => l.who === "customer");
  const idx = new Map(cu.map((l, k) => [l.i, k]));
  // Oyna ichida keyingi gaplar og'irroq: suhbat oxiridagi holat muhimroq.
  // (Sinovda topilgan: 4 e'tirozdan keyin «roziman» degan suhbat «salbiy» chiqib qolgandi.)
  const window = (from, to) => {
    let s = 0, w = 0;
    for (const h of ev.hits) {
      if (h.speaker !== "customer") continue;
      const k = idx.get(h.line);
      if (k === undefined || k < from || k >= to) continue;
      const weight = k - from + 1;
      s += (MOOD[h.kind] ?? 0) * weight; w += weight;
    }
    return w ? Math.max(-100, Math.min(100, Math.round(s / w * 33))) : 0;
  };
  const n = cu.length || 1;
  const third = Math.max(1, Math.ceil(n / 3));
  const start = window(0, third), end = window(n - third, n);
  // Umumiy baho yakuniga ko'proq og'ir — suhbat qanday tugagani muhimroq
  const overallScore = Math.round(start * 0.3 + end * 0.7);
  const band = (v) => (v > 12 ? "positive" : v < -12 ? "negative" : "neutral");

  const cuQ = cu.filter((l) => /\?/.test(l.text)).length;
  const interest = Math.max(0, Math.min(100, Math.round(ev.talkShare.customer * 1.4 + cuQ * 6 + ev.counts.buy * 5)));
  const trust = Math.max(0, Math.min(100, Math.round(
    55 + ev.counts.buy * 12 - ev.counts.risk * 22 - ev.counts.objection * 5)));
  const readiness = (trust >= 62 && ev.counts.buy >= 2) ? "hot" : trust >= 42 ? "warm" : "cold";

  const timeline = [];
  let run = 0;
  for (const l of lines) {
    for (const h of ev.hits.filter((x) => x.line === l.i && x.speaker === "customer"))
      run += (MOOD[h.kind] ?? 0) * 9;
    run = Math.max(-100, Math.min(100, run * 0.93));
    timeline.push({ line: l.i, at: l.at, ts: mmss(l.at), v: Math.round(run), who: l.who });
  }
  return { overall: band(overallScore), start: band(start), end: band(end),
           startScore: start, endScore: end, overallScore,
           interest, trust, readiness, timeline };
}

// §4.C shoshilinchlik
export function urgency(ev) {
  const pain = ev.counts.pain, urg = ev.urgentLines.length, risk = ev.counts.risk;
  const level = (pain >= 2 && urg) || risk >= 2 ? "critical"
    : pain >= 2 || (pain && urg) || risk ? "high"
    : pain || urg ? "medium" : "low";
  const why = [];
  if (pain) why.push(`${pain} ta muammo signali`);
  if (urg) why.push(`${urg} ta muddat/shoshilinchlik iborasi`);
  if (risk) why.push(`${risk} ta tahdid iborasi`);
  return { level, why };
}
export const URGENCY_LABEL = { critical: "Kritik", high: "Yuqori", medium: "O'rta", low: "Past" };

// ---------------------------------------------------------------- §H va'dalar
const DUE_RE = /(?<![\p{L}\p{N}_])(bugun|ertaga|indinga|сегодня|завтра|послезавтра|dushanba|seshanba|chorshanba|payshanba|juma|shanba|понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2,4})?)(?![\p{L}\p{N}_])/iu;
const TASK_KIND = [
  { type: "document", re: /hujjat|shartnoma|договор|документ|akt|акт/i, label: "Hujjat" },
  { type: "quote",    re: /taklif|прайс|цен|narx|коммерческ/i,          label: "Tijorat taklifi" },
  { type: "meeting",  re: /uchrash|встреч|zoom|ofis|офис/i,             label: "Uchrashuv" },
  { type: "payment",  re: /to'lov|оплат|hisob|счёт|счет/i,              label: "To'lov nazorati" },
  { type: "callback", re: /qo'ng'iroq|позвон|перезвон|aloqa|свяж/i,     label: "Qo'ng'iroq" },
];
export function promises(lines) {
  const out = [];
  for (const l of lines) {
    if (!NEXT_STEP.test(l.n)) continue;
    const due = (l.n.match(DUE_RE) || [null])[0];
    const kind = TASK_KIND.find((k) => k.re.test(l.n)) || { type: "callback", label: "Qo'ng'iroq" };
    out.push({ by: l.who, line: l.i, at: l.at, ts: mmss(l.at), text: l.text.slice(0, 220),
               type: kind.type, typeLabel: kind.label, due: due || null, hasDue: !!due });
  }
  return out;
}

// ---------------------------------------------------------------- bitim xavfi
// Xavf = bitimni YO'QOTISH ehtimoli. Mijozning muammosi buni oshirmaydi (aksincha,
// bu bizning imkoniyatimiz) — faqat tahdid, e'tiroz va salbiy yakun oshiradi.
export function riskLevel(ev, score, sent) {
  const reasons = [];
  const risks = ev.hits.filter((h) => h.speaker === "customer" && h.kind === "risk");
  const objs  = ev.hits.filter((h) => h.speaker === "customer" && h.kind === "objection");
  if (risks.length) reasons.push(`Tahdid: ${[...new Set(risks.map((h) => h.term))].slice(0, 3).join(", ")}`);
  if (objs.length >= 2) reasons.push(`${objs.length} ta e'tiroz: ${[...new Set(objs.map((h) => h.term))].slice(0, 3).join(", ")}`);
  if (sent.overall === "negative") reasons.push("Suhbat salbiy kayfiyatda yakunlandi");
  if (sent.endScore < sent.startScore - 30) reasons.push("Kayfiyat suhbat davomida tushdi");
  if (score.total < 50) reasons.push(`Operator balli past (${score.total}/100)`);
  if (!ev.nextStepTalk.length) reasons.push("Keyingi qadam kelishilmagan");

  const level = (risks.length >= 2 || (risks.length && sent.overall === "negative")) ? "critical"
    : (risks.length || sent.overall === "negative" || objs.length >= 3) ? "high"
    : (objs.length >= 1 || score.total < 55 || !ev.nextStepTalk.length) ? "medium" : "low";
  return { level, reasons };
}
export const RISK_LABEL = { critical: "Kritik", high: "Yuqori", medium: "O'rta", low: "Past" };

// ---------------------------------------------------------------- to'liq qoida tahlili
export function ruleAnalysis(raw, dict = DEFAULT_DICT) {
  const { lines, hasTimestamps } = parseTranscript(raw);
  if (!lines.length) throw Object.assign(new Error("Transkript bo'sh"), { status: 400 });
  const ev = evidence(lines, dict, hasTimestamps);
  const score = ruleScore(lines, ev);
  const sent = sentiment(lines, ev);
  return {
    lines, hasTimestamps, ev, score, sentiment: sent,
    methodology: methodology(lines, ev),
    promises: promises(lines),
    urgency: urgency(ev),
    risk: riskLevel(ev, score, sent),
  };
}
