// AI talqin qatlami. `claude -p` bilan ishlaydi (agent ko'prigi bilan bir xil usul),
// tashqi API kaliti talab qilmaydi.
//
// Eng muhim qism — GROUNDING: AI qaytargan har bir iqtibos transkriptda HAQIQATAN
// bor-yo'qligi tekshiriladi. Yo'q bo'lsa — o'sha element tashlab yuboriladi va
// `dropped` ro'yxatiga yoziladi. TZ §15: AI suhbatda bo'lmagan faktni yozmasligi kerak.

import { spawn } from "node:child_process";
import { norm, mmss } from "./callai.mjs";
import * as gem from "./gemini.mjs";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "/usr/bin/claude";
const BASE = process.env.AI_AGENT_HOME || "/home/claude";
const AGENT = process.env.CALLAI_AGENT || "sotuvcoach";     // qaysi profil ostida ishlaydi
const TIMEOUT_MS = Number(process.env.CALLAI_TIMEOUT_MS || 150000);
const MAX_CONCURRENT = Number(process.env.CALLAI_CONCURRENCY || 1);

let running = 0; const waiting = [];
const slot = () => (running < MAX_CONCURRENT ? (running++, Promise.resolve()) : new Promise((r) => waiting.push(r)));
const release = () => { running--; const n = waiting.shift(); if (n) { running++; n(); } };
export const queueDepth = () => ({ running, waiting: waiting.length });
export const available = () => process.env.CALLAI_DISABLED !== "1";

// ---------------------------------------------------------------- prompt
export function buildPrompt(lines, meta = {}) {
  const body = lines.map((l) => `${l.i}|${mmss(l.at)}|${l.who === "operator" ? "OPERATOR" : "MIJOZ"}|${l.text}`).join("\n");
  return `Sen SUN-HIGHTECH kompaniyasining sotuv suhbatlarini tahlil qiluvchi tahlilchisan. Quyida telefon suhbati transkripti berilgan.
SUN-HIGHTECH — quyosh elektr stansiyalarini (uy va biznes uchun, quvvati kVt bilan o'lchanadi) sotadi va o'rnatadi. Suhbatlarda narx, nasiya yoki bo'lib to'lash, davlat subsidiyasi, elektr tarmog'iga ulash (texnik shart) va o'rnatish joyi kabi mavzular uchrashi mumkin.

QAT'IY QOIDALAR:
1. FAQAT transkriptda aytilgan narsani yoz. Transkriptda yo'q ma'lumotni TAXMIN QILMA va O'YLAB TOPMA.
2. Ma'lumot aytilmagan bo'lsa — null qo'y. Bo'sh qoldirish xato emas, o'ylab topish xato.
3. Har bir xulosa uchun "line" maydonida o'sha gap raqamini ko'rsat, "quote" da o'sha gapdan AYNAN ko'chirilgan matn bo'lsin.
4. Javob FAQAT JSON bo'lsin. Izoh, sarlavha, markdown belgisi yozma.
5. Matnlar o'zbek tilida bo'lsin (suhbat rus tilida bo'lsa ham xulosa o'zbekcha).

TRANSKRIPT (format: raqam|vaqt|kim|matn):
${body}

Quyidagi JSON'ni to'ldir:
{
  "summary": "3-7 gapda: nima haqida gaplashildi, mijozning maqsadi, muammosi, SUN-HIGHTECH'dan kutgani, suhbat qanday yakunlandi, kelishilgan keyingi qadam",
  "topic": "suhbat mavzusi, 2-5 so'z",
  "language": ["uz"],
  "customer": {
    "name": null, "company": null, "role": null, "industry": null, "region": null,
    "decisionMaker": null, "service": null, "budget": null, "decisionDate": null
  },
  "customerEvidence": { "name": {"line": null, "quote": null}, "company": {"line": null, "quote": null}, "role": {"line": null, "quote": null}, "industry": {"line": null, "quote": null}, "region": {"line": null, "quote": null}, "service": {"line": null, "quote": null}, "budget": {"line": null, "quote": null}, "decisionDate": {"line": null, "quote": null} },
  "problems": [{"title":"muammo nomi","impact":"biznesga ta'siri","evidence":"mijoz aytgan dalil","urgency":"low|medium|high|critical","service":"kerakli SUN-HIGHTECH xizmati","opportunity":"sotuv imkoniyati","line":0,"quote":""}],
  "needs": [{"text":"ehtiyoj","line":0,"quote":""}],
  "objections": [{"text":"e'tiroz","answered":true,"answerQuality":"good|weak|none","line":0,"quote":"","tip":"operator nima deyishi kerak edi"}],
  "scoreNotes": [{"id":"greeting|needs|questions|listening|value|objection|nextStep|closing","comment":"qisqa izoh","tip":"yaxshilash tavsiyasi","line":0,"quote":""}],
  "nextAction": {"type":"callback|document|quote|meeting|payment","text":"nima qilinishi kerak","owner":"operator|customer","due":"matnda aytilgan muddat yoki null","line":0,"quote":""},
  "dealRisk": {"level":"low|medium|high|critical","reasons":["sabab"]},
  "confidence": 0.0
}

Muhim: "customer" ichidagi har bir maydon uchun "customerEvidence" da o'sha ma'lumot aytilgan gap raqami va aynan iqtibos bo'lishi shart. Iqtibos yo'q bo'lsa maydonni null qoldir.
Faqat JSON qaytar.`;
}

// ---------------------------------------------------------------- ishga tushirish
export function runClaude(prompt, { timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, ["-p", prompt, "--permission-mode", "bypassPermissions"], {
      cwd: `${BASE}/agents/${AGENT}`,
      env: { ...process.env, HOME: BASE, CLAUDE_CONFIG_DIR: `${BASE}/.claude-${AGENT}`,
             PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${BASE}/.bun/bin`, AI_AGENT_HOME: BASE },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("AI javob bermadi (vaqt tugadi)")); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; if (out.length > 400000) child.kill("SIGKILL"); });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`AI ishga tushmadi: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = out.trim();
      if (/OAuth session expired|Failed to authenticate|Invalid API key|credit balance|Not logged in|Please run \/login/i.test(text))
        return reject(new Error("AI hisobi autentifikatsiyadan o'tmadi (kirish tokeni yo'q yoki muddati tugagan) — CLAUDE_CODE_OAUTH_TOKEN kerak"));
      // Xato kodi bilan tugagan bo'lsa matn — model javobi emas, xato xabari
      if (code !== 0) return reject(new Error((text || err.trim()).slice(0, 300) || `claude ${code} kodi bilan tugadi`));
      resolve(text);
    });
  });
}

// JSON'ni erkin matndan ajratib olish (model markdown blok qo'shib qo'yishi mumkin)
export function extractJson(text) {
  const s = String(text || "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cand = fence ? fence[1] : s;
  const a = cand.indexOf("{"), b = cand.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("AI javobida JSON topilmadi");
  return JSON.parse(cand.slice(a, b + 1));
}

// ---------------------------------------------------------------- GROUNDING
// Har bir iqtibos transkriptda bormi? Yo'q bo'lsa — element tashlanadi.
const MIN_Q = 8;
function quoteOk(quote, lines, line) {
  const q = norm(quote);
  if (!q || q.length < MIN_Q) return false;
  const target = lines[line];
  if (target && target.n.includes(q)) return true;
  // qator raqami xato bo'lsa ham matn transkriptda bo'lsa — qabul qilamiz, lekin qatorni tuzatamiz
  const found = lines.find((l) => l.n.includes(q));
  return found ? found.i : false;
}
export function ground(ai, lines) {
  const dropped = [];
  const fix = (obj, path) => {
    if (!obj || typeof obj !== "object") return null;
    const ln = Number.isInteger(obj.line) ? obj.line : null;
    const res = quoteOk(obj.quote, lines, ln);
    if (res === false) { dropped.push({ path, quote: String(obj.quote || "").slice(0, 80), reason: "transkriptda topilmadi" }); return null; }
    if (typeof res === "number") obj.line = res;
    if (ln === null || !lines[obj.line]) obj.line = typeof res === "number" ? res : null;
    if (obj.line !== null && lines[obj.line]) obj.ts = mmss(lines[obj.line].at);
    return obj;
  };
  const arr = (list, path) => (Array.isArray(list) ? list : []).map((x, i) => fix(x, `${path}[${i}]`)).filter(Boolean);

  const out = {
    summary: typeof ai.summary === "string" ? ai.summary.slice(0, 2000) : null,
    topic: typeof ai.topic === "string" ? ai.topic.slice(0, 120) : null,
    language: Array.isArray(ai.language) ? ai.language.filter((x) => typeof x === "string").slice(0, 3) : [],
    customer: {}, customerEvidence: {},
    problems: arr(ai.problems, "problems"),
    needs: arr(ai.needs, "needs"),
    objections: arr(ai.objections, "objections"),
    scoreNotes: arr(ai.scoreNotes, "scoreNotes"),
    nextAction: fix(ai.nextAction, "nextAction"),
    dealRisk: ai.dealRisk && typeof ai.dealRisk === "object"
      ? { level: ["low", "medium", "high", "critical"].includes(ai.dealRisk.level) ? ai.dealRisk.level : "medium",
          reasons: (Array.isArray(ai.dealRisk.reasons) ? ai.dealRisk.reasons : []).map(String).slice(0, 6) } : null,
    confidence: Number.isFinite(+ai.confidence) ? Math.max(0, Math.min(1, +ai.confidence)) : null,
    dropped,
  };

  // Mijoz profili: har maydon dalil bilan tasdiqlanishi shart (TZ §4.B)
  const C = ai.customer && typeof ai.customer === "object" ? ai.customer : {};
  const E = ai.customerEvidence && typeof ai.customerEvidence === "object" ? ai.customerEvidence : {};
  for (const k of ["name", "company", "role", "industry", "region", "service", "budget", "decisionDate", "decisionMaker"]) {
    const v = C[k];
    if (v === null || v === undefined || v === "" || /^(null|yo'q|noma'lum|—|-)$/i.test(String(v))) continue;
    const e = fix(E[k] ? { ...E[k] } : null, `customer.${k}`);
    if (e) { out.customer[k] = String(v).slice(0, 200); out.customerEvidence[k] = e; }
    else dropped.push({ path: `customer.${k}`, quote: String(v).slice(0, 80), reason: "dalil (iqtibos) berilmadi" });
  }
  return out;
}

// ---------------------------------------------------------------- to'liq yurgizish
// 3 martagacha urinish (TZ §6.7). Har urinish natijasi validatsiyadan o'tadi.
// Tahlil dvigateli: CALLAI_ENGINE=gemini (standart, kalit bo'lsa) — avval Gemini, bo'lmasa Claude.
// Egasi 2026-09-24: «Gemini yozib olingan qo'ng'iroqlarni transkript qilishga VA tahlil qilishga».
// Grounding (iqtibos transkriptda bormi) ikkala dvigatelda bir xil qo'llanadi.
const aiEngine = () => (process.env.CALLAI_ENGINE || (gem.on() ? "gemini" : "claude")).toLowerCase();
export async function analyzeWithAi(lines, meta = {}, { attempts = 3 } = {}) {
  if (!available()) throw new Error("AI tahlil o'chirilgan (CALLAI_DISABLED=1)");
  const prompt = buildPrompt(lines, meta);
  const tries = [];
  if (aiEngine() === "gemini" && gem.on()) {
    const t0 = Date.now();
    try {
      const r = await gem.generate([{ text: prompt }], { json: true, timeoutMs: 150000, models: gem.MATN,
        check: (txt) => { const g = ground(extractJson(txt), lines); if (!g.summary) throw new Error("AI xulosa qaytarmadi"); return g; } });
      tries.push({ attempt: 1, ok: true, engine: `gemini/${r.model}`, ms: Date.now() - t0, dropped: r.parsed.dropped.length });
      return { ai: r.parsed, tries, engine: `gemini/${r.model}` };
    } catch (e) {
      tries.push({ attempt: 1, ok: false, engine: "gemini", ms: Date.now() - t0, error: String(e.message).slice(0, 200) });
      // Egasi 2026-09-25: «iloji boricha Gemini». Claude zaxirasi faqat CALLAI_CLAUDE_FALLBACK=1 bo'lsa;
      // aks holda AI qismi keyingi siklda Gemini bilan qayta uriniladi (ishchidagi «AI tahlilni yangilash»).
      if (process.env.CALLAI_CLAUDE_FALLBACK !== "1") throw Object.assign(new Error(tries[0].error), { tries, gemini: true });
    }
  }
  await slot();
  try {
    for (let i = 1; i <= attempts; i++) {
      const t0 = Date.now();
      try {
        const raw = await runClaude(prompt);
        const parsed = extractJson(raw);
        const g = ground(parsed, lines);
        if (!g.summary) throw new Error("AI xulosa qaytarmadi");
        tries.push({ attempt: i, ok: true, ms: Date.now() - t0, dropped: g.dropped.length });
        return { ai: g, tries };
      } catch (e) {
        tries.push({ attempt: i, ok: false, ms: Date.now() - t0, error: e.message.slice(0, 200) });
        // autentifikatsiya xatosi — qayta urinishning ma'nosi yo'q
        if (/autentifikatsiya|OAuth/i.test(e.message)) break;
        if (i === attempts) break;
      }
    }
  } finally { release(); }
  const last = tries[tries.length - 1];
  throw Object.assign(new Error(last?.error || "AI tahlil bajarilmadi"), { tries });
}

// ---------------------------------------------------------------- spiker ajratish (mono)
// Mono yozuvda kanal yo'q, tanaffus esa ishonchsiz. Model kontekstdan ajratadi:
// kim salomlashdi/tanishtirdi, kim savol berdi, kim muammosini aytdi.
// Bu FAKT emas, TUZILISH — shuning uchun grounding qoidasi bu yerda qo'llanmaydi,
// lekin natija baribir "spikerlar taxminiy" deb belgilanadi.
export async function diarize(segments) {
  if (!available() || !segments?.length) return null;
  const list = segments.map((s, i) => `${i}|${s.text}`).join("\n");
  const prompt = `Quyida telefon suhbatining gaplari berilgan (raqam|matn). Bu SUN-HIGHTECH kompaniyasi
(quyosh elektr stansiyalari sotuvi va o'rnatish) operatori bilan mijoz o'rtasidagi suhbat.

Har bir gap kimga tegishli ekanini aniqla: operator (SUN-HIGHTECH xodimi) yoki customer (mijoz).
Belgilar: operator salomlashadi, o'zini tanishtiradi, savol beradi, xizmatni tushuntiradi;
mijoz o'z muammosini aytadi, e'tiroz bildiradi, savolga javob beradi.

FAQAT JSON massiv qaytar, boshqa hech narsa yozma. Format:
[{"i":0,"who":"operator"},{"i":1,"who":"customer"}]

Gaplar:
${list}`;
  try {
    const raw = await runClaude(prompt, { timeoutMs: 90000 });
    const a = raw.indexOf("["), b = raw.lastIndexOf("]");
    if (a < 0 || b <= a) return null;
    const arr = JSON.parse(raw.slice(a, b + 1));
    const map = new Map(arr.filter((x) => Number.isInteger(x.i)).map((x) => [x.i, x.who === "customer" ? "customer" : "operator"]));
    if (map.size < segments.length * 0.6) return null;      // yarmidan ko'pi belgilanmasa — ishonmaymiz
    let last = "operator";
    return segments.map((s, i) => { const w = map.get(i) || last; last = w; return { ...s, who: w }; });
  } catch { return null; }
}
