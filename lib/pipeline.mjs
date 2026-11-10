// Konveyer: qo'ng'iroq → audio → transkript → tahlil (TZ §6 ma'lumot oqimi).
//
// Siyosat — nega shunday:
//   Median qo'ng'iroq 37 soniya. Bunday suhbatga 90 soniyalik AI tahlili ishlatish
//   isrof: unda hech qanday sotuv suhbati yo'q. Shuning uchun ikki bosqich —
//   avval arzon qoida qatlami (bir soniya, bepul), keyin FAQAT kerak bo'lganda AI.
//   Qoida qatlami xavfni "kritik/yuqori" desa yoki suhbat uzun bo'lsa — AI ishlaydi.
import * as tel from "./telephony.mjs";
import * as stt from "./stt.mjs";
import * as store from "./callstore.mjs";
import { runAnalysis } from "./callrun.mjs";
import * as llm from "./callllm.mjs";

export const POLICY = {
  minSec: Number(process.env.PIPE_MIN_SEC || 30),      // bundan qisqasi tahlil qilinmaydi
  aiSec:  Number(process.env.PIPE_AI_SEC || 90),       // bundan uzuniga darrov AI
  maxAttempts: Number(process.env.PIPE_MAX_TRIES || 3),// TZ §6.7
};

export const SKIP = {
  missed:   "javobsiz qo'ng'iroq — suhbat bo'lmagan (TZ §14.10)",
  tooShort: "juda qisqa — tahlil qilishga arziydigan suhbat yo'q",
  done:     "allaqachon tahlil qilingan",
  running:  "hozir bajarilmoqda",
  attempts: "3 marta urinilgan, har safar xato — qo'lda tekshirish kerak",
  noRecord: "ovoz yozuvi yo'q (Odoo'da yozilmagan yoki MCP kalitida «Вложение» ruxsati yo'q)",
};

// Shu qo'ng'iroq konveyerdan o'tishi kerakmi?
export function shouldProcess(db, call) {
  if (call.missed) return { ok: false, why: SKIP.missed };
  if ((call.dur || 0) < POLICY.minSec) return { ok: false, why: SKIP.tooShort };
  // Odoo VoIP qo'ng'irog'i ("v<id>"): yozuv yo'q bo'lsa — urinish sarflanmaydi. Aks holda yozuvlar
  // ruxsati (ir.attachment) ochilguncha har qo'ng'iroq 3 marta xato bilan tugab, keyin butunlay
  // tashlab ketilardi. Yozuv paydo bo'lishi bilan (FILES) navbatga o'zi qaytadi.
  if (/^v\d+$/.test(String(call.id)) && call.hasRecording === false && !store.getTranscript(db, call.id))
    return { ok: false, why: SKIP.noRecord };
  const a = store.getAnalysis(db, call.id);
  if (a?.status === "ready") return { ok: false, why: SKIP.done };
  if (a?.status === "running") return { ok: false, why: SKIP.running };
  if (a && a.attempts >= POLICY.maxAttempts) return { ok: false, why: SKIP.attempts, error: a.error };
  return { ok: true };
}

// Bitta qo'ng'iroqni boshidan oxirigacha o'tkazadi.
// force=true bo'lsa tayyor tahlil ham qaytadan yuriladi.
export async function processCall(bx, db, call, { force = false, actor = "worker", useAi = null, noDefer = false, geminiOnly = false } = {}) {
  const t0 = Date.now();
  const step = [];
  if (!force) {
    const chk = shouldProcess(db, call);
    if (!chk.ok) return { skipped: true, why: chk.why, error: chk.error || null };
  }

  // ---- 1) transkript bormi? bo'lmasa audiodan olamiz ----
  let tr = store.getTranscript(db, call.id);
  if (!tr || force) {
    const rec = await tel.record(bx, { originId: call.originId, activityId: call.id, at: call.at, phone: call.phone });
    if (rec.error) {
      store.failAnalysis(db, call.id, `Audio olinmadi: ${rec.error}`, null);
      return { failed: true, stage: "audio", why: rec.error, code: rec.code };
    }
    step.push(`audio ${rec.durationSec || "?"}s`);
    let out;
    try {
      // aiDiarize — mono yozuvda spikerlarni AI ajratadi; /transcribe marshruti
      // bilan bir xil sifat bo'lsin.
      out = await stt.transcribe(rec.url, { outgoing: call.out, aiDiarize: llm.diarize, callAt: call.at, noDefer, geminiOnly });
    } catch (e) {
      // Gemini limitda/band — qo'ng'iroqning aybi emas: urinish SANALMAYDI, keyingi siklda qayta
      if (e.deferred) return { skipped: true, deferred: true, why: e.message };
      // Groq limiti (429) — qo'ng'iroqning aybi emas: urinish SANALMAYDI (aks holda uchta limit
      // xatosidan keyin qo'ng'iroq butunlay tashlab yuborilardi). Ishchi siklni to'xtatadi.
      if (/\b429\b|rate.?limit/i.test(String(e.message))) return { failed: true, stage: "stt", why: e.message, rateLimited: true };
      store.failAnalysis(db, call.id, `Nutqdan matnga: ${e.message}`, null);
      return { failed: true, stage: "stt", why: e.message };
    }
    if (!out.text || out.text.length < 40) {
      store.failAnalysis(db, call.id, "Transkript bo'sh yoki juda qisqa (nutq tanilmadi)", null);
      return { failed: true, stage: "stt", why: "nutq tanilmadi" };
    }
    store.putTranscript(db, call.id, out.text, {
      source: `stt:${String(out.meta.engine || "?").slice(0, 40)}`, lang: (out.meta.language || "").slice(0, 12), actor,
    });
    step.push(`transkript ${out.segments.length} gap · ${out.meta.engine || "?"} · ${out.meta.method}${out.speakersAssumed ? " (spikerlar taxminiy)" : ""}${out.meta.geminiError ? " · Gemini o'tkazildi: " + String(out.meta.geminiError).replace(/This model is currently experiencing high demand[^|]*/g, "band").replace(/You exceeded your current quota[^|\[]*/g, "kvota").slice(0, 320) : ""}`);
    tr = store.getTranscript(db, call.id);
    var sttMeta = { ...out.meta, speakersAssumed: out.speakersAssumed };
  } else {
    step.push("transkript mavjud");
  }

  // ---- 2) qoida qatlami (arzon) ----
  const wantAi = useAi !== null ? useAi : (call.dur || 0) >= POLICY.aiSec;
  let res = await runAnalysis(db, call.id, { call, dealId: call.deal?.id || null }, {
    useAi: wantAi, force: true, actor,
  });
  step.push(wantAi ? `AI + qoida${res.analysis?.aiEngine ? ` (${res.analysis.aiEngine})` : res.analysis?.aiError ? " (AI ishlamadi)" : ""}` : "qoida");

  // ---- 3) qisqa suhbat xavfli chiqsa — AI bilan chuqurlashtiramiz ----
  const risk = res.analysis?.deal_risk?.level;
  if (!wantAi && ["critical", "high"].includes(risk)) {
    step.push(`xavf ${risk} → AI bilan qayta`);
    res = await runAnalysis(db, call.id, { call, dealId: call.deal?.id || null }, {
      useAi: true, force: true, actor,
    });
  }

  return {
    ok: true, ms: Date.now() - t0, steps: step,
    score: res.analysis?.operator_score?.total ?? null,
    risk: res.analysis?.deal_risk?.level ?? null,
    engine: res.analysis?.engine ?? null,
    aiError: res.aiError || null,
    stt: typeof sttMeta !== "undefined" ? sttMeta : null,
  };
}
