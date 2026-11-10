// Lid sifati — AI bahosi (TZ «Sales OS» 1.1 «Sifatli / Sifatsiz», 2026-09-24).
//
// Egasi: «sifatli lidni AI o'zi tahlil qilib aniqlab berishi kerak» — Odoo'dagi belgi emas.
// Manba — shu lidning qo'ng'iroq transkriptlari (Odoo VoIP yozuvlari → Gemini STT). Har lidga:
//   sifatli   — haqiqiy mijoz, o'z telefoni uchun Pitaka chexoliga real qiziqish bor, davom ettirishga tayyor
//   sifatsiz  — noto'g'ri raqam, aniq rad, Pitaka'da yo'q model, ish qidiruvchi, raqobatchi, spam
//   noaniq    — suhbat qisqa/tushunarsiz, qiziqish aniqlanmadi
// Qo'shimcha belgilar: ehtiyoj, qurilma (iphone/samsung), model, rang, byudjet, muddat,
// kelishilgan qadam (buyurtma / Telegram'ga rasm / ofisga tashrif / qayta qo'ng'iroq), bo'lib to'lash so'radimi.
//
// Arzon: bir so'rovda bir nechta lid (bepul tarif kvotasi tejaladi). Iqtibos transkriptda
// so'zma-so'z bo'lmasa — iqtibos tashlanadi (TZ §15: AI suhbatda bo'lmagan faktni yozmasin).
import * as gem from "./gemini.mjs";
import { parseTranscript, norm } from "./callai.mjs";
import { runClaude, extractJson, available as claudeOn } from "./callllm.mjs";
import { sha } from "./callstore.mjs";

export const VERSION = "s1";
export const VERDICTS = { sifatli: "Sifatli", sifatsiz: "Sifatsiz", noaniq: "Noaniq" };

export function initSifat(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_quality (
      lead_id  TEXT PRIMARY KEY,
      verdict  TEXT NOT NULL,              -- sifatli | sifatsiz | noaniq
      reason   TEXT, quote TEXT, call_id TEXT,
      signals  TEXT,                       -- JSON: need, device, model, color, budget, timeline, agreed, installment
      basis    TEXT NOT NULL,              -- baholangan transkriptlar izi (yangi qo'ng'iroq qo'shilsa qayta baholanadi)
      calls    TEXT, engine TEXT, version TEXT,
      at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lq_verdict ON lead_quality(verdict);
  `);
}

// lead_id → { verdict, reason, quote, callId, signals, at }
export function ofLeads(db, ids) {
  const out = new Map();
  const list = [...new Set((ids || []).map(String))].filter(Boolean);
  for (let i = 0; i < list.length; i += 400) {
    const part = list.slice(i, i + 400);
    const rows = db.prepare(`SELECT lead_id, verdict, reason, quote, call_id, signals, at FROM lead_quality WHERE lead_id IN (${part.map(() => "?").join(",")})`).all(...part);
    for (const r of rows) {
      let s = null; try { s = r.signals ? JSON.parse(r.signals) : null; } catch {}
      out.set(r.lead_id, { verdict: r.verdict, reason: r.reason, quote: r.quote, callId: r.call_id, signals: s, at: r.at });
    }
  }
  return out;
}

// Baholash asosi: qaysi qo'ng'iroq transkriptlari (va ularning matni) — o'zgarsa qayta baholanadi
export const basisOf = (items) => sha(items.map((c) => `${c.id}:${sha(c.text)}`).sort().join("|") + VERSION);
export function needs(db, leadId, basis) {
  const r = db.prepare("SELECT basis FROM lead_quality WHERE lead_id = ?").get(String(leadId));
  return !r || r.basis !== basis;
}
// Gemini'dan boshqa dvigatelda (Claude zaxirasi) baholangan — Gemini bilan qayta baholanadi (egasi 2026-09-25)
export function geminiEmas(db, leadId) {
  const r = db.prepare("SELECT engine FROM lead_quality WHERE lead_id = ?").get(String(leadId));
  return !!r && !String(r.engine || "").startsWith("gemini");
}

// Transkriptni ixcham shaklga: "O: …" / "M: …" (operator / mijoz), eng ko'pi `max` belgi
function compact(text, max) {
  const { lines } = parseTranscript(text);
  let out = "";
  for (const l of lines) {
    const s = `${l.who === "operator" ? "O" : "M"}: ${l.text}\n`;
    if (out.length + s.length > max) { out += "…\n"; break; }
    out += s;
  }
  return out.trim();
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    leads: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          lead: { type: "STRING" },
          verdict: { type: "STRING", enum: ["sifatli", "sifatsiz", "noaniq"] },
          reason: { type: "STRING" },
          quote: { type: "STRING", nullable: true },
          call: { type: "STRING", nullable: true },
          signals: {
            type: "OBJECT",
            properties: {
              need: { type: "BOOLEAN", nullable: true },
              device: { type: "STRING", enum: ["iphone", "samsung", "boshqa"], nullable: true },
              model: { type: "STRING", nullable: true },
              color: { type: "STRING", nullable: true },
              budget: { type: "BOOLEAN", nullable: true },
              timeline: { type: "STRING", nullable: true },
              agreed: { type: "STRING", enum: ["buyurtma", "telegram_rasm", "ofisga_tashrif", "qayta_qongiroq", "yoq"], nullable: true },
              installment: { type: "BOOLEAN", nullable: true },
            },
          },
        },
        required: ["lead", "verdict", "reason"],
      },
    },
  },
  required: ["leads"],
};

export function buildPrompt(batch) {
  const body = batch.map((b) => `### LID ${b.lead}\n${b.calls.map((c) => `-- qo'ng'iroq ${c.id} (${c.at ? c.at.slice(0, 16).replace("T", " ") : "?"}, ${c.out ? "chiquvchi" : "kiruvchi"})\n${c.compact}`).join("\n")}`).join("\n\n");
  return `Sen Pitaka call-markazi suhbatlarini baholovchi tahlilchisan. Pitaka — O'zbekistondagi rasmiy diler: iPhone va Samsung uchun premium Aramid chexollar (narxi taxminan 889 000 – 1 179 000 so'm). Lidlar asosan Instagram arizalaridan keladi.
Quyida bir nechta LID bor. Har lid uchun operator (O) va mijoz (M) o'rtasidagi qo'ng'iroq transkripti(lari) berilgan.
Har LID uchun lid SIFATINI aniqla (bu CRM'dagi «Kvalifikatsiya» / «NE KVAL» belgisi bilan solishtiriladi):
- "sifatli": mijoz haqiqiy, o'z telefoni uchun chexolga real qiziqishi bor (modelini aytdi, narx yoki rang so'radi) va davom ettirishga tayyor (Telegram'ga rasm, buyurtma, ofisga tashrif yoki qayta qo'ng'iroqqa rozi).
- "sifatsiz": noto'g'ri raqam, ariza qoldirmaganini va qiziqmasligini aniq aytdi, chexol kerak emas, Pitaka'da yo'q model (masalan Xiaomi) va boshqasiga qiziqmaydi, ish qidiruvchi, raqobatchi, spam, hazil.
- "noaniq": suhbat juda qisqa yoki tushunarsiz, ko'tarilmadi, faqat avtojavob/salomlashuv, mijoz faqat "keyin gaplashamiz" dedi va qiziqishi aniqlanmadi.

QAT'IY QOIDALAR:
1. Faqat transkriptdagi faktga tayan. Aytilmagan narsani taxmin qilma — belgini null qoldir.
2. "quote" — qaroringni ko'rsatuvchi gap, transkriptdan SO'ZMA-SO'Z (8–120 belgi, "O:"/"M:" belgisisiz). "call" — o'sha gap qaysi qo'ng'iroqdan.
3. "reason" — o'zbek tilida (lotin), bitta qisqa gap.
4. signals: need — chexolga ehtiyoj bormi; device — iphone/samsung/boshqa; model — mijoz aytgan telefon modeli (masalan "17 Pro Max"); color — so'ragan rangi yoki dizayni; budget — narx unga to'g'ri kelishini aytdimi; timeline — qachon olmoqchi (masalan "oy oxirida"); agreed — kelishilgan keyingi qadam (buyurtma, telegram_rasm, ofisga_tashrif, qayta_qongiroq, yoq); installment — bo'lib to'lash so'radimi.
5. Har LID uchun javobda albatta bitta element bo'lsin, "lead" maydoni LID raqamiga teng.

${body}

Faqat JSON qaytar: {"leads":[{"lead":"…","verdict":"…","reason":"…","quote":"…","call":"…","signals":{…}}]}`;
}

// Iqtibos transkriptda bormi (normallashtirilgan holda)?
function grounded(quote, calls) {
  const q = norm(String(quote || "").replace(/^[OM]:\s*/, ""));
  if (!q || q.length < 8) return null;
  for (const c of calls) if (norm(c.text).includes(q)) return c.id;
  return null;
}

// Belgilarni qat'iy qiymatlarga keltirish. Gemini sxema bilan ishlaydi, Claude (zaxira) esa ba'zan erkin matn
// yozadi («object: biznes», «budget: 30 million naqd»). Asl matn *Matn maydonida saqlanadi.
const ha = (v) => (v === true || /^(ha|bor|true|yes|да)\b/i.test(String(v ?? "").trim()) ? true
  : v === false || /^(yo'?q|yoq|false|no|нет)\b/i.test(String(v ?? "").trim()) ? false : null);
const matn = (v, n = 60) => (v === null || v === undefined || v === true || v === false ? null : String(v).trim().slice(0, n) || null);
export function belgilar(sig) {
  const x = sig && typeof sig === "object" ? sig : {};
  const dv = String(x.device ?? "").toLowerCase();
  const device = !dv || dv === "null" ? null : /iphone|айфон|apple/.test(dv) ? "iphone" : /samsung|самсунг|galaxy/.test(dv) ? "samsung" : "boshqa";
  const ag = String(x.agreed ?? "").toLowerCase();
  const agreed = !ag || ag === "null" ? null : /^(buyurtma|telegram_rasm|ofisga_tashrif|qayta_qongiroq|yoq)$/.test(ag) ? ag
    : /buyurtma|zakaz|заказ|rasmiylashtir|yetkaz|kuryer/.test(ag) ? "buyurtma" : /telegram|rasm|foto|silka|ssilka|link/.test(ag) ? "telegram_rasm"
    : /ofis|kel(adi|ish)|tashrif/.test(ag) ? "ofisga_tashrif" : /qayta|keyin|qo.?ng.?iroq/.test(ag) ? "qayta_qongiroq"
    : /yo.?q|kelishilmadi|rad/.test(ag) ? "yoq" : "boshqa";
  return { need: ha(x.need), device, deviceMatn: device && device !== dv ? matn(x.device) : null,
    model: matn(x.model), color: matn(x.color), budget: typeof x.budget === "string" ? (ha(x.budget) ?? true) : ha(x.budget),
    budgetMatn: typeof x.budget === "string" ? matn(x.budget) : null, timeline: matn(x.timeline),
    agreed, agreedMatn: agreed && agreed !== ag ? matn(x.agreed, 80) : null, installment: ha(x.installment) };
}

// batch: [{ lead, calls: [{ id, at, out, text }] }] → { rows: [{ lead, verdict, reason, quote, callId, signals }], engine }
// Gemini birinchi (egasi: yozilgan qo'ng'iroq tahlili — Gemini). Hamma model limitda/band bo'lsa — qo'ng'iroq
// tahlilidagi kabi zaxira Claude (claude = false bo'lsa zaxirasiz, xato qaytadi va keyingi siklda qayta urinadi).
export async function classify(batch, { models, claude = false } = {}) {
  const prep = batch.map((b) => ({ ...b, calls: b.calls.map((c) => ({ ...c, compact: compact(c.text, 2400) })) }));
  const prompt = buildPrompt(prep);
  const check = (txt) => {
    const j = JSON.parse(txt);
    if (!j || !Array.isArray(j.leads)) throw new Error("javobda leads yo'q");
    return j;
  };
  let parsed, engine, gemXato = null;
  try {
    const r = await gem.generate([{ text: prompt }], { json: true, schema: SCHEMA, timeoutMs: 120000, check, models: models || gem.MATN });
    parsed = r.parsed; engine = `gemini/${r.model}`;
  } catch (e) {
    if (!claude || !claudeOn()) throw e;
    gemXato = String(e.message || e).slice(0, 160);
    parsed = check(JSON.stringify(extractJson(await runClaude(prompt, { timeoutMs: 240000 }))));
    engine = "claude";
  }
  const byLead = new Map((parsed.leads || []).map((x) => [String(x.lead).replace(/\D/g, ""), x]));
  const out = [];
  for (const b of prep) {
    const x = byLead.get(String(b.lead));
    if (!x || !VERDICTS[x.verdict]) continue;
    const callId = grounded(x.quote, b.calls);
    out.push({ lead: String(b.lead), verdict: x.verdict, reason: String(x.reason || "").slice(0, 300),
      quote: callId ? String(x.quote).replace(/^[OM]:\s*/, "").slice(0, 200) : null, callId,
      signals: { ...belgilar(x.signals), dalilsiz: !callId } });
  }
  return { rows: out, engine, gemXato };
}

export function save(db, row, basis, calls, engine) {
  db.prepare(`INSERT INTO lead_quality (lead_id, verdict, reason, quote, call_id, signals, basis, calls, engine, version, at)
              VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
              ON CONFLICT(lead_id) DO UPDATE SET verdict=excluded.verdict, reason=excluded.reason, quote=excluded.quote,
                call_id=excluded.call_id, signals=excluded.signals, basis=excluded.basis, calls=excluded.calls,
                engine=excluded.engine, version=excluded.version, at=datetime('now')`)
    .run(String(row.lead), row.verdict, row.reason, row.quote, row.callId, JSON.stringify(row.signals || {}), basis, calls.join(","), engine, VERSION);
}

export function stats(db) {
  const r = db.prepare("SELECT verdict, COUNT(*) n FROM lead_quality GROUP BY verdict").all();
  return Object.fromEntries(r.map((x) => [x.verdict, x.n]));
}
