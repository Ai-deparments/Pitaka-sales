// Nutqdan matnga (TZ §6.4). Groq `whisper-large-v3` — o'zbek va rus tilini taniydi.
//
// Spikerlarni ajratish (diarization) Whisper'da yo'q, shuning uchun ikki bosqich:
//   1) Yozuv STEREO bo'lsa (telefoniyada odatda operator va mijoz alohida kanalda) —
//      ffmpeg bilan kanallarga bo'lib, har birini alohida tanitamiz. Bu ANIQ ajratim.
//   2) MONO bo'lsa — bitta tanitib, navbat almashinuvi va salomlashish/tanishtirish
//      bo'yicha taxmin qilamiz va natijaga `speakersAssumed: true` qo'yamiz.
//      Panel buni "spikerlar taxminiy" deb ko'rsatadi — taxmin fakt sifatida berilmaydi.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GREET, INTRO } from "./calldict.mjs";
import * as gem from "./gemini.mjs";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = process.env.STT_MODEL || "whisper-large-v3";
const MAX_BYTES = 24 * 1024 * 1024;      // Groq chegarasi 25 MB
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";

export const available = () => !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);

// ---------------------------------------------------------------------------
// Gemini (2026-09-24, egasi: «groq emas gemini»; «billing'siz sozla») — limitlar va navbat lib/gemini.mjs da
// ---------------------------------------------------------------------------
// Qo'ng'iroq yozuvi Gemini'da: o'zbek/rus aralash nutqni Whisper'dan ANCHA yaxshi tushunadi (sinov:
// Groq «qaychi qazirx qizqqodr…» → Gemini toza matn) va spikerni (operator/mijoz) o'zi ajratadi.
// Hamma model limitda/band bo'lsa — qo'ng'iroq NAVBATDA QOLADI (Groq'ga tushmaydi, urinish sanalmaydi);
// Egasi 2026-09-25: «iloji boricha Gemini'da — ancha xatosiz». Groq ENDI avtomatik ishlamaydi (ilgari 72 soatdan
// eski qo'ng'iroq va xodim «Tahlil qilish» bosganda Gemini band bo'lsa Groq'ga tushardi — 24 soatda 112 ta).
// Gemini band/limitda bo'lsa qo'ng'iroq NAVBATDA kutadi. Groq faqat STT_FALLBACK=groq qo'yilsa.
export const DEFER_MAX_H = Number(process.env.STT_DEFER_MAX_H || 72);
const FALLBACK = (process.env.STT_FALLBACK || "defer").toLowerCase(); // defer | groq
export const geminiOn = () => gem.on() && (process.env.STT_ENGINE || "gemini") === "gemini";
export const geminiState = () => ({ on: geminiOn(), models: gem.state(), fallback: FALLBACK });
const GEM_PROMPT = (outgoing) => `Pitaka (premium telefon chexollari, rasmiy diler) sotuv bo'limining telefon suhbati yozuvi. Vazifa: SO'ZMA-SO'Z transkript.
- Har gapni aytilgan tilida yoz: o'zbekcha — lotin yozuvida, ruscha — kirill yozuvida. Tarjima qilma, tuzatma, qisqartirma, o'zingdan so'z qo'shma.
- Eshitilmagan yoki tushunarsiz joyni [tushunarsiz] deb belgila. Jimlik, musiqa, gudok, avtojavob yozilmaydi.
- Qo'ng'iroq ko'tarilmagan bo'lsa (faqat gudok yoki avtojavob) — segments bo'sh massiv qaytar, bir xil gapni takrorlama.
- Spiker MAZMUNGA qarab: operator — Pitaka xodimi («Pitaka kompaniyasidan ...man», chexol, narx, kafolatni tushuntiradi, Telegram'ga rasm yuborishni taklif qiladi); customer — mijoz (telefon modelini aytadi, narx so'raydi, e'tiroz bildiradi).
- Qo'ng'iroq ${outgoing ? "chiquvchi (operator qo'ng'iroq qilgan)" : "kiruvchi (mijoz qo'ng'iroq qilgan)"}.
Atamalar: Pitaka, Aramid, chexol, iPhone, Pro Max, Samsung, Ultra, MagSafe, kafolat, Click, Payme, Telegram, Instagram, so'm.`;
const GEM_SCHEMA = { type: "OBJECT", properties: { language: { type: "STRING" }, segments: { type: "ARRAY", items: { type: "OBJECT",
  properties: { start: { type: "NUMBER" }, end: { type: "NUMBER" }, speaker: { type: "STRING", enum: ["operator", "customer"] }, text: { type: "STRING" } },
  required: ["start", "end", "speaker", "text"] } } }, required: ["segments"] };
const gemSegments = (txt) => {
  const d = JSON.parse(txt);
  const segs = (d.segments || []).map((x) => ({ at: Math.max(0, Math.round(Number(x.start) || 0)), end: Math.max(0, Math.round(Number(x.end) || Number(x.start) || 0)),
    text: String(x.text || "").trim(), who: x.speaker === "customer" ? "customer" : "operator" }))
    .filter((x) => x.text && !isHallu(x.text)).sort((a, b) => a.at - b.at);
  if (!segs.length) throw new Error("Gemini: transkript bo'sh");
  return segs;
};
async function gemini(file, { outgoing = true } = {}) {
  const buf = fs.readFileSync(file);
  if (buf.length > 18 * 1024 * 1024) throw Object.assign(new Error("Gemini: audio 18 MB dan katta"), { allBusy: false });
  const r = await gem.generate([{ inline_data: { mime_type: "audio/ogg", data: buf.toString("base64") } }, { text: GEM_PROMPT(outgoing) }],
    { json: true, schema: GEM_SCHEMA, timeoutMs: Number(process.env.STT_GEMINI_TIMEOUT_MS || 180000), check: gemSegments });
  return { model: r.model, segments: r.parsed, usage: r.usage, errors: r.errors };
}

const run = (bin, args, { timeoutMs = 120000 } = {}) => new Promise((resolve, reject) => {
  const c = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  const t = setTimeout(() => { c.kill("SIGKILL"); reject(new Error(`${bin}: vaqt tugadi`)); }, timeoutMs);
  c.stdout.on("data", (d) => { out += d; });
  c.stderr.on("data", (d) => { err += d; });
  c.on("error", (e) => { clearTimeout(t); reject(new Error(`${bin} ishga tushmadi: ${e.message}`)); });
  c.on("close", (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(err.slice(-400) || `${bin} ${code}`)); });
});

export async function download(url, dest, { timeoutMs = 60000 } = {}) {
  // Mahalliy fayl ham qabul qilinadi (qo'lda yuklangan audio va sinov uchun)
  if (!/^https?:/i.test(String(url))) {
    const src = String(url).replace(/^file:\/\//, "");
    if (!fs.existsSync(src)) throw new Error("Audio fayl topilmadi: " + src);
    fs.copyFileSync(src, dest);
    return { bytes: fs.statSync(dest).size, contentType: "local" };
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: "follow" });
    if (!r.ok) throw new Error(`Audio yuklanmadi: HTTP ${r.status}`);
    const ct = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (/text\/html/i.test(ct))
      throw new Error("Audio o'rniga HTML keldi — havola sessiya talab qilmoqda (ruxsat yetarli emas)");
    if (!buf.length) throw new Error("Audio fayl bo'sh");
    fs.writeFileSync(dest, buf);
    return { bytes: buf.length, contentType: ct };
  } finally { clearTimeout(t); }
}

export async function probe(file) {
  const out = await run(FFPROBE, ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file]);
  const j = JSON.parse(out);
  const a = (j.streams || []).find((s) => s.codec_type === "audio") || {};
  return { channels: Number(a.channels || 0), sampleRate: Number(a.sample_rate || 0),
           codec: a.codec_name || null, durationSec: Number(j.format?.duration || 0),
           bytes: Number(j.format?.size || 0) };
}

// Katta faylni Groq chegarasiga sig'dirish: 16 kHz mono/kanal, 32 kbps — nutq uchun yetarli
const toOgg = (src, dst, channelFilter) =>
  run(FFMPEG, ["-y", "-i", src, ...(channelFilter ? ["-af", channelFilter] : []),
               "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", dst], { timeoutMs: 180000 });

// Whisper jimlikda "uydirma" matn chiqaradi (subtitr krediti va h.k.) — ularni tashlaymiz.
// Bu real xato: sinovda mijoz kanali "Altyazı M.K." bo'lib chiqqandi.
const HALLU = [
  /^altyaz[iı]/i, /amara\.org/i, /subtitles? by/i, /subtitl?es? .*community/i,
  /^играет музыка/i, /^\[?музыка\]?$/i, /^субтитры/i, /^\[?смех\]?$/i, /^\[?аплодисменты\]?$/i,
  /^musiqa$/i, /^\[?musiqa\]?$/i, /^spasibo za prosmotr/i,
  /^продолжение следует/i, /субтитры (сделал|подготовил)/i, /^подпишись/i,
  /^thanks? for watching/i, /^\s*[.…·-]+\s*$/, /^редактор субтитров/i, /^корректор/i,
];
const isHallu = (t) => HALLU.some((re) => re.test(t.trim()));

async function groqOnce(file, language) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY topilmadi");
  const buf = fs.readFileSync(file);
  if (buf.length > MAX_BYTES) throw new Error(`Audio juda katta (${Math.round(buf.length / 1e6)} MB)`);
  const fd = new FormData();
  fd.set("file", new Blob([buf]), path.basename(file));
  fd.set("model", MODEL);
  fd.set("response_format", "verbose_json");
  // So'z darajasidagi vaqt kodlari — segment chegarasi qo'pol (sinovda 6-soniyalik gap
  // "0.0 s" deb belgilanardi), dalil esa aniq vaqtga bog'lanishi kerak (TZ §4.I, §15).
  fd.append("timestamp_granularities[]", "word");
  fd.append("timestamp_granularities[]", "segment");
  fd.set("temperature", "0");
  if (language) fd.set("language", language);
  // Yo'naltiruvchi prompt: Whisper'ga suhbat qaysi tilda va qanday lug'atda ekanini
  // oldindan aytamiz — busiz 8 kHz telefon yozuvida o'zbek nutqni ruscha "ravon" uydirma
  // bilan almashtirib qo'yardi (sinovda: "У меня есть жена… 1 миллион 800 тысяч").
  if (PROMPTS[language]) fd.set("prompt", PROMPTS[language]);
  const r = await fetch(GROQ_URL, { method: "POST", headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}` }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Groq ${r.status}: ${j.error?.message || "noma'lum xato"}`);
  const words = (j.words || [])
    .map((w) => ({ at: Number(w.start), end: Number(w.end), w: String(w.word || "").trim() }))
    .filter((w) => w.w && Number.isFinite(w.at));
  const segs = (j.segments || [])
    .map((s) => ({ at: Math.round(s.start), end: Math.round(s.end), text: String(s.text || "").trim(),
                   lp: Number(s.avg_logprob ?? -2), nsp: Number(s.no_speech_prob ?? 0) }))
    .filter((s) => s.text && !isHallu(s.text));
  // O'rtacha ishonch — qaysi til yaxshiroq mos kelganini shundan bilamiz
  const conf = segs.length ? segs.reduce((a, s) => a + s.lp, 0) / segs.length : -99;
  return { language: j.language || language || null, segments: segs, words, conf,
           chars: segs.reduce((a, s) => a + s.text.length, 0) };
}

// MUHIM: tilni majburlash shart. Avtomatik aniqlashda Whisper o'zbekchani
// "Indonesian"/"Turkish" deb o'qib, matnni buzadi yoki uydirma chiqaradi (sinovda tasdiqlangan).
// 2026-09-12: "uz va ru ni sinab, ishonchi yuqorisini olish" usuli ham noto'g'ri chiqdi —
// Whisper o'zbek nutqqa RAVON ruscha uydirma yozadi va unga yuqori ishonch beradi, natijada
// hamma transkript ruscha bo'lib qolardi. Endi asosiy til QAT'IY o'zbek (STT_LANGS=uz);
// zaxira til faqat o'zbekcha natija deyarli bo'sh chiqqanda sinaladi.
const DEFAULT_LANGS = (process.env.STT_LANGS || "uz").split(",").map((x) => x.trim()).filter(Boolean);
const FALLBACK_LANG = process.env.STT_FALLBACK || "ru";
const PROMPTS = {
  uz: "Assalomu alaykum. Pitaka kompaniyasi, sotuv bo‘limi. Chexol, Aramid, iPhone, Pro Max, Samsung, Ultra, MagSafe, kafolat, "
    + "narx, so‘m, Click, Payme, Telegram, Instagram, yetkazib berish, ofis, buyurtma. "
    + "Yaxshi, rahmat, xo‘p, bo‘ladi, kelishdik.",
  ru: "Здравствуйте. Компания Pitaka, отдел продаж. Чехол, арамид, iPhone, Samsung, гарантия, цена, сум, доставка, заказ, Telegram.",
};

async function groq(file, { language = null } = {}) {
  const langs = language ? [language] : DEFAULT_LANGS;
  const outs = [];
  for (const L of langs) {
    try { outs.push(await groqOnce(file, L)); } catch (e) { outs.push({ err: e.message, conf: -99, segments: [], chars: 0 }); }
  }
  // Asosiy til deyarli hech narsa bermasa (nutq boshqa tilda bo'lishi mumkin) — zaxira til
  const primaryChars = Math.max(0, ...outs.map((o) => o.err ? 0 : o.chars));
  if (primaryChars < 40 && FALLBACK_LANG && !langs.includes(FALLBACK_LANG)) {
    try { outs.push(await groqOnce(file, FALLBACK_LANG)); langs.push(FALLBACK_LANG); }
    catch (e) { outs.push({ err: e.message, conf: -99, segments: [], chars: 0 }); langs.push(FALLBACK_LANG); }
  }
  const ok = outs.filter((o) => !o.err && o.segments.length);
  if (!ok.length) throw new Error(outs.find((o) => o.err)?.err || "Nutq tanilmadi");
  // Asosiy til ustun: zaxira faqat asosiysi bo'sh bo'lganda o'tadi (ishonch bilan taqqoslanmaydi)
  ok.sort((a, b) => (b.chars >= 40 ? 1 : 0) - (a.chars >= 40 ? 1 : 0) || (b.chars - a.chars));
  const best = ok[0];
  const segments = best.words?.length
    ? sentences(best.words)
    : best.segments.map(({ at, end, text }) => ({ at, end, text }));
  return { language: best.language, segments, words: best.words || [],
           conf: +best.conf.toFixed(2),
           tried: outs.map((o, i) => ({ lang: langs[i], conf: +Number(o.conf).toFixed(2), chars: o.chars, err: o.err || null })) };
}

// So'zlardan gap yig'ish: tinish belgisi yoki uzoq tanaffus gapni yakunlaydi.
// Birinchi so'z ba'zan jimlik chegarasida noto'g'ri 0.00 ga tushadi — uni tuzatamiz.
const TURN_GAP = Number(process.env.STT_TURN_GAP || 0.8);
export function sentences(words) {
  if (!words.length) return [];
  const w = words.map((x) => ({ ...x }));
  // Bitta so'z 2 soniyadan uzun bo'lishi mumkin emas — Whisper jimlik chegarasida
  // birinchi so'zni 0.00 ga tortib qo'yadi (sinovda: 6-soniyalik gap "0.00" chiqqan).
  for (const x of w) if (x.end - x.at > 2) x.at = Math.max(0, x.end - 0.6);
  const out = [];
  let cur = null;
  for (let i = 0; i < w.length; i++) {
    const x = w[i];
    const gap = i ? x.at - w[i - 1].end : 0;
    if (!cur || gap > TURN_GAP) { if (cur) out.push(cur); cur = { at: x.at, end: x.end, parts: [], gapBefore: gap }; }
    cur.parts.push(x.w);
    cur.end = x.end;
    if (/[.!?]$/.test(x.w) && cur.parts.length >= 3) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ at: Math.round(s.at), end: Math.round(s.end),
                           text: s.parts.join(" ").replace(/\s+([,.!?;:])/g, "$1").trim(),
                           gapBefore: +(s.gapBefore || 0).toFixed(2) }))
            .filter((s) => s.text);
}

// Mono yozuvda spikerlarni taxmin qilish: operator o'zini tanishtirgan gapdan boshlab
// navbat almashadi. Taxmin ekani natijada ochiq ko'rsatiladi.
function guessSpeakers(segments, { outgoing = true } = {}) {
  if (!segments.length) return segments;
  // Operatorning tayanch gapi — salomlashish + tanishtirish (SUN-HIGHTECH, "meni zovut", ...)
  let anchor = segments.findIndex((s) => INTRO.test(s.text.toLowerCase()));
  if (anchor < 0) anchor = segments.findIndex((s) => GREET.test(s.text.toLowerCase()));
  if (anchor < 0) anchor = outgoing ? 0 : 1;          // chiquvchida birinchi gapiruvchi — operator
  // Navbat: uzoq tanaffus (>1.2 s) yangi spiker deb olinadi
  let who = "operator";
  const out = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (i === anchor) who = "operator";
    else if (i > 0) {
      // Gap yig'ilishida allaqachon hisoblangan tanaffus — navbat almashuvi belgisi
      const gap = s.gapBefore ?? (s.at - segments[i - 1].end);
      if (gap > TURN_GAP) who = who === "operator" ? "customer" : "operator";
    }
    out.push({ ...s, who });
  }
  return out;
}

const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.round(sec) % 60).padStart(2, "0")}`;
const LABEL = { operator: "Operator", customer: "Mijoz" };
export const toText = (segs) => segs.map((s) => `[${mmss(s.at)}] ${LABEL[s.who] || "Operator"}: ${s.text}`).join("\n");

// Asosiy funksiya: URL → transkript matni
// noDefer — xodim o'zi «Tahlil qilish» bosganda: Gemini band bo'lsa kutmasdan Groq (natija darhol kerak)
// geminiOnly — sifatni yangilash (Groq'dan Gemini'ga qayta o'tkazish): Gemini bo'lmasa HECH QACHON Groq
export async function transcribe(url, { outgoing = true, language = null, keepFiles = false, aiDiarize = null, callAt = null, noDefer = false, geminiOnly = false } = {}) {
  if (!available()) throw new Error("GROQ_API_KEY / GEMINI_API_KEY sozlanmagan — nutqdan matnga ishlamaydi");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sotuv-stt-"));
  const src = path.join(dir, "src.audio");
  const t0 = Date.now();
  const meta = { engine: `groq/${MODEL}` };
  try {
    const dl = await download(url, src);
    meta.bytes = dl.bytes;
    const p = await probe(src);
    meta.channels = p.channels; meta.durationSec = p.durationSec; meta.codec = p.codec;

    // 0) Gemini: bitta o'tishda matn + spiker. Hamma model limitda/band bo'lsa — navbatda qoladi
    //    (Groq'ga tushmaydi), faqat qo'ng'iroq DEFER_MAX_H soatdan ortiq kutgan bo'lsa Groq.
    if (geminiOn()) {
      try {
        const G = path.join(dir, "g.ogg");
        await toOgg(src, G, null);
        const g = await gemini(G, { outgoing });
        meta.engine = `gemini/${g.model}`; meta.method = "gemini"; meta.usage = g.usage;
        if (g.errors.length) meta.geminiErrors = g.errors;
        // Pitaka (10.11): ovozdan spiker belgisi ~50% xato chiqdi (operator gapi «Mijoz» bo'lib qolardi).
        // Ikkinchi qadam — rollarni matn MAZMUNI bo'yicha qayta aniqlash; ishlamasa ovozdagi belgi qoladi.
        let segments = g.segments;
        if (aiDiarize) {
          try { const byAi = await aiDiarize(segments); if (byAi) { segments = byAi; meta.diarize = "ai-text"; } }
          catch (e) { meta.diarizeError = String(e.message || e).slice(0, 200); }
        }
        meta.ms = Date.now() - t0; meta.segments = segments.length;
        // Spikerni AI ajratgan (kanal bo'yicha emas) — panel «spikerlar taxminiy» deb ko'rsatadi
        return { text: toText(segments), segments, speakersAssumed: true, meta };
      } catch (e) {
        meta.geminiError = String(e.message || e).slice(0, 400);
        const yoshH = callAt ? (Date.now() - Date.parse(callAt)) / 3600e3 : 0;
        if (geminiOnly || FALLBACK !== "groq")
          throw Object.assign(new Error(`Gemini hozir band yoki limitda — qo'ng'iroq navbatda qoldi (${meta.geminiError.slice(0, 160)})`), { deferred: true });
      }
    }
    if (geminiOnly) throw Object.assign(new Error("Gemini o'chiq — sifatni yangilash o'tkazildi"), { deferred: true });
    if (!process.env.GROQ_API_KEY) throw new Error(meta.geminiError || "Groq kaliti yo'q");

    let segments, speakersAssumed;
    if (p.channels >= 2) {
      // ANIQ ajratim: chap kanal — operator, o'ng — mijoz (chiquvchida odatda shunday)
      const L = path.join(dir, "l.ogg"), R = path.join(dir, "r.ogg");
      await toOgg(src, L, "pan=mono|c0=c0");
      await toOgg(src, R, "pan=mono|c0=c1");
      const [a, b] = await Promise.all([groq(L, { language }), groq(R, { language })]);
      meta.language = a.language || b.language;
      meta.langTried = a.tried || b.tried;
      meta.conf = Math.min(a.conf ?? 0, b.conf ?? 0);
      const tag = (segs, who) => segs.map((s) => ({ ...s, who }));
      segments = [...tag(a.segments, outgoing ? "operator" : "customer"),
                  ...tag(b.segments, outgoing ? "customer" : "operator")]
        .sort((x, y) => x.at - y.at);
      speakersAssumed = false;
      meta.method = "stereo-split";
    } else {
      const M = path.join(dir, "m.ogg");
      await toOgg(src, M, null);
      const a = await groq(M, { language });
      meta.language = a.language;
      meta.langTried = a.tried;
      meta.conf = a.conf;
      // Mono yozuvda kanal bo'yicha ajratib bo'lmaydi. Tanaffusga tayanish ishonchsiz
      // (sinovda 0,4 s tanaffus navbat almashuvini ko'rsatmadi), shuning uchun avval
      // AI kontekst bo'yicha belgilaydi; u ishlamasa tanaffus qoidasiga qaytamiz.
      let byAi = null;
      if (aiDiarize) { try { byAi = await aiDiarize(a.segments); } catch (e) { meta.diarizeError = e.message; } }
      segments = byAi || guessSpeakers(a.segments, { outgoing });
      speakersAssumed = true;
      meta.method = byAi ? "mono-ai" : "mono-guess";
    }
    meta.ms = Date.now() - t0;
    meta.segments = segments.length;
    return { text: toText(segments), segments, speakersAssumed, meta };
  } finally {
    if (!keepFiles) try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
