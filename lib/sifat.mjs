// Lid sifati — AI bahosi (TZ «Sales OS» 1.1 «Sifatli / Sifatsiz», 2026-09-24).
//
// Egasi: «sifatli lidni AI o'zi tahlil qilib aniqlab berishi kerak» — Odoo'dagi belgi emas.
// Manba — shu lidning qo'ng'iroq transkriptlari (Odoo VoIP yozuvlari → Gemini STT). Har lidga:
//   sifatli   — haqiqiy mijoz, SUN-HIGHTECH xizmatiga real ehtiyoj/qiziqish bor, davom ettirishga tayyor
//   sifatsiz  — noto'g'ri raqam, aniq rad, ish qidiruvchi, raqobatchi, spam, xizmat doirasidan tashqari
//   noaniq    — suhbat qisqa/tushunarsiz, qiziqish aniqlanmadi
// Qo'shimcha belgilar (TZ 3.2 skoring uchun ham kerak): ehtiyoj, obyekt turi, oylik elektr to'lovi,
// byudjet, muddat, qaror qiluvchi, kelishilgan qadam (KP/uchrashuv/…), muddatli to'lov so'radimi.
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
      signals  TEXT,                       -- JSON: need, object, monthlyBill, budget, timeline, decisionMaker, agreed, installment
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
              object: { type: "STRING", enum: ["uy", "korxona", "ferma", "boshqa"], nullable: true },
              monthlyBill: { type: "STRING", nullable: true },
              budget: { type: "BOOLEAN", nullable: true },
              timeline: { type: "STRING", nullable: true },
              decisionMaker: { type: "BOOLEAN", nullable: true },
              agreed: { type: "STRING", enum: ["kp", "uchrashuv", "obyekt_korigi", "qayta_qongiroq", "yoq"], nullable: true },
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
  return `Sen SUN-HIGHTECH call-markazi suhbatlarini baholovchi tahlilchisan. SUN-HIGHTECH quyosh elektr stansiyalarini (uy, korxona, ferma uchun; quvvati kVt) sotadi, o'rnatadi va servis qiladi.
Quyida bir nechta LID bor. Har lid uchun operator (O) va mijoz (M) o'rtasidagi qo'ng'iroq transkripti(lari) berilgan.
Har LID uchun lid SIFATINI aniqla:
- "sifatli": mijoz haqiqiy, SUN-HIGHTECH xizmatiga (quyosh stansiyasi, panel, invertor, akkumulyator, o'rnatish, servis) real ehtiyoji yoki qiziqishi bor va suhbatni davom ettirishga tayyor (ma'lumot, KP, uchrashuv, obyekt ko'rigi yoki qayta qo'ng'iroqqa rozi).
- "sifatsiz": noto'g'ri raqam, xizmat kerak emasligini aniq aytdi, ish qidiruvchi, raqobatchi yoki boshqa sotuvchi, reklama/spam, hazil, allaqachon o'rnatgan va boshqa ehtiyoji yo'q, xizmat ko'rsatilmaydigan joy.
- "noaniq": suhbat juda qisqa yoki tushunarsiz, mijoz faqat "keyin gaplashamiz" dedi va qiziqishi aniqlanmadi, faqat avtojavob/salomlashuv.

QAT'IY QOIDALAR:
1. Faqat transkriptdagi faktga tayan. Aytilmagan narsani taxmin qilma — belgini null qoldir.
2. "quote" — qaroringni ko'rsatuvchi gap, transkriptdan SO'ZMA-SO'Z (8–120 belgi, "O:"/"M:" belgisisiz). "call" — o'sha gap qaysi qo'ng'iroqdan.
3. "reason" — o'zbek tilida (lotin), bitta qisqa gap.
4. signals: need — ehtiyoj bormi; object — uy/korxona/ferma/boshqa; monthlyBill — mijoz aytgan oylik elektr to'lovi (matnda qanday aytilgan bo'lsa); budget — pul/byudjet borligini aytdimi; timeline — o'rnatish muddati (masalan "1 oy ichida"); decisionMaker — qaror qiluvchi o'zimi; agreed — kelishilgan keyingi qadam; installment — muddatli (bo'lib) to'lov yoki kredit so'radimi.
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
  const ob = String(x.object ?? "").toLowerCase();
  const object = !ob || ob === "null" ? null : /uy|hovli|kvartira|dacha|дом/.test(ob) ? "uy" : /ferma|issiqxona|parranda|chorva/.test(ob) ? "ferma"
    : /korxona|biznes|zavod|sex|do.?kon|ofis|firma|savdo|mehmonxona|restoran|бизнес|предприят/.test(ob) ? "korxona" : "boshqa";
  const ag = String(x.agreed ?? "").toLowerCase();
  const agreed = !ag || ag === "null" ? null : /^(kp|uchrashuv|obyekt_korigi|qayta_qongiroq|yoq)$/.test(ag) ? ag
    : /kp|tijorat|taklif|narx.*yubor/.test(ag) ? "kp" : /ko.?rik|obyekt|o.?lchov|zamer|joyiga/.test(ag) ? "obyekt_korigi"
    : /uchrashuv|ofisga|kel(adi|ish)/.test(ag) ? "uchrashuv" : /qayta|keyin|qo.?ng.?iroq/.test(ag) ? "qayta_qongiroq"
    : /yo.?q|kelishilmadi|rad/.test(ag) ? "yoq" : "boshqa";
  return { need: ha(x.need), object, objectMatn: object && object !== ob ? matn(x.object) : null,
    monthlyBill: matn(x.monthlyBill), budget: typeof x.budget === "string" ? (ha(x.budget) ?? true) : ha(x.budget),
    budgetMatn: typeof x.budget === "string" ? matn(x.budget) : null, timeline: matn(x.timeline), decisionMaker: ha(x.decisionMaker),
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
