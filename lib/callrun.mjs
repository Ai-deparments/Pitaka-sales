// Tahlilni yurgizuvchi: qoida qatlami + AI qatlami → TZ §5 dagi majburiy JSON.
// AI ishlamasa ham natija bo'ladi (engine: "rules") — modul hech qachon bo'sh qolmaydi.

import * as A from "./callai.mjs";
import * as L from "./callllm.mjs";
import * as S from "./callstore.mjs";
import * as M from "./murabbiy.mjs";   // Telegram murabbiy: qo'ng'iroq egasi va ball qaydi

// Til: harflarni sanab aniqlanadi. "Pitaka" kabi lotincha brend nomi butun suhbatni
// "aralash" deb ko'rsatib yubormasligi uchun nisbat bo'yicha qaror qilinadi.
export function detectLang(raw) {
  const cyr = (String(raw).match(/[\u0400-\u04FF]/g) || []).length;
  const lat = (String(raw).match(/[A-Za-z]/g) || []).length;
  const all = cyr + lat;
  if (!all) return ["uz"];
  const r = cyr / all;
  if (r > 0.85) return ["ru"];
  if (r < 0.15) return ["uz"];
  return ["uz", "ru"];
}

export const ENGINES = { rules: "Qoida", "ai+rules": "AI + qoida" };

// AI ballga izoh qo'shadi, lekin ballning O'ZINI o'zgartirmaydi — ball dalilga asoslangan
// qoidadan chiqadi, shunda baho takrorlanadigan va tushuntiriladigan bo'ladi (TZ §7).
function mergeScore(ruleScore, aiNotes = []) {
  const byId = new Map(aiNotes.filter((n) => n && n.id).map((n) => [n.id, n]));
  return {
    total: ruleScore.total,
    criteria: ruleScore.criteria.map((c) => {
      const n = byId.get(c.id);
      return { ...c,
        aiComment: n?.comment ? String(n.comment).slice(0, 400) : null,
        tip: n?.tip ? String(n.tip).slice(0, 300) : c.tip,
        aiEvidence: n && n.line !== null && n.line !== undefined ? { line: n.line, ts: n.ts || null, quote: n.quote || null } : null };
    }),
  };
}

// §5 majburiy format + UI uchun kengaytmalar
export function buildResult(callId, raw, dict, meta, ai) {
  const r = A.ruleAnalysis(raw, dict);
  const criticalFromRules = r.ev.hits.map((h) => ({
    type: h.kind === "buy" ? "positive" : h.kind === "pain" ? "need" : h.kind === "risk" ? "risk" : "objection",
    color: h.color, kind: h.kind, term: h.term, quote: h.quote, context: h.context,
    speaker: h.speaker, line: h.line, timestamp_sec: h.at, ts: h.ts,
    reason: h.reason, tip: h.tip, source: "rules",
  }));
  const aiProblems = (ai?.problems || []).map((p) => ({ ...p, source: "ai" }));
  // Keyingi qadam tanlash. MUHIM: mijozning TAHDIDI va'da emas — "shikoyat yozaman"
  // NEXT_STEP naqshiga ("yozaman") tushib, keyingi qadam bo'lib qolgandi (sinovda topilgan).
  // Shuning uchun tahdid iborasi bor qator va'dalardan chiqariladi.
  const riskLines = new Set(r.ev.hits.filter((h) => h.kind === "risk").map((h) => h.line));
  const safePromises = r.promises.filter((p) => !riskLines.has(p.line));
  const nextFromRules = safePromises.find((p) => p.by === "operator") || safePromises[0] || null;

  const next = ai?.nextAction
    ? { type: ai.nextAction.type || nextFromRules?.type || "callback",
        text: ai.nextAction.text || null, owner: ai.nextAction.owner || "operator",
        due: ai.nextAction.due || nextFromRules?.due || null,
        line: ai.nextAction.line ?? nextFromRules?.line ?? null,
        ts: ai.nextAction.ts || nextFromRules?.ts || null, source: "ai" }
    : nextFromRules
      ? { type: nextFromRules.type, text: nextFromRules.text, owner: nextFromRules.by,
          due: nextFromRules.due, line: nextFromRules.line, ts: nextFromRules.ts, source: "rules" }
      : null;

  // Bitim xavfi: qoida bahosi asos, AI faqat sabab qo'sha oladi
  const risk = { level: r.risk.level, reasons: r.risk.reasons.slice() };
  if (ai?.dealRisk?.reasons?.length)
    for (const x of ai.dealRisk.reasons) if (!risk.reasons.includes(x)) risk.reasons.push(String(x).slice(0, 200));

  const score = mergeScore(r.score, ai?.scoreNotes);

  return {
    // ---- TZ §5 majburiy maydonlar ----
    call_id: String(callId),
    customer_id: meta.customerId ?? null,
    deal_id: meta.dealId ?? null,
    language: ai?.language?.length ? ai.language : detectLang(raw),
    summary: ai?.summary || null,
    topic: ai?.topic || null,
    customer: ai?.customer || {},
    needs: ai?.needs || [],
    problems: aiProblems,
    objections: ai?.objections || [],
    critical_moments: criticalFromRules,
    sentiment: { overall: r.sentiment.overall, start: r.sentiment.startScore, end: r.sentiment.endScore },
    operator_score: { total: score.total, criteria: score.criteria },
    promises: r.promises.map((p) => ({ ...p, threat: riskLines.has(p.line) })),
    next_action: next,
    deal_risk: risk,
    confidence: ai?.confidence ?? null,
    model_version: A.MODEL_VERSION,
    prompt_version: A.PROMPT_VERSION,
    analyzed_at: new Date().toISOString(),

    // ---- UI kengaytmalari ----
    engine: ai ? "ai+rules" : "rules",
    customerEvidence: ai?.customerEvidence || {},
    droppedByGuard: ai?.dropped || [],
    // Pitaka: AI'ning lid sifati bahosi (CRM'dagi KVAL / NE KVAL bilan solishtirish uchun),
    // suhbatda yo'qotish sababi va ssenariydan o'tkazib yuborilgan bosqichlar — har biri iqtibos bilan.
    kval: ai?.kval || null,
    lostReason: ai?.lostReason || null,
    missedSteps: ai?.missedSteps || [],
    methodology: r.methodology,
    urgency: r.urgency,
    sentimentFull: r.sentiment,
    facts: r.ev.facts,
    stats: { counts: r.ev.counts, talkShare: r.ev.talkShare, measured: r.ev.measured,
             interrupts: r.ev.interrupts, silences: r.ev.silences,
             hasTimestamps: r.hasTimestamps, longestMonologueSec: r.ev.longestMonologueSec },
    lines: r.lines.map((l) => ({ i: l.i, at: l.at, ts: A.mmss(l.at), who: l.who, text: l.text, est: !!l.est })),
    summaryRow: { score: score.total, risk: risk.level, sentiment: r.sentiment.overall,
                  topic: ai?.topic || null, urgency: r.urgency.level, confidence: ai?.confidence ?? null },
  };
}

// Bitta qo'ng'iroqni tahlil qilish. useAi=false bo'lsa faqat qoida qatlami.
export async function runAnalysis(db, callId, meta = {}, { useAi = true, force = false, actor = "?" } = {}) {
  const tr = S.getTranscript(db, callId);
  if (!tr) throw Object.assign(new Error("Bu qo'ng'iroq uchun transkript yo'q"), { status: 409 });
  const hash = S.sha(tr.text);
  const prev = S.getAnalysis(db, callId);

  // TZ §10 idempotency: bir xil transkript ikki marta tahlil qilinmaydi
  if (!force && prev && prev.status === "ready" && prev.hash === hash)
    return { skipped: true, reason: "Bu transkript allaqachon tahlil qilingan", analysis: JSON.parse(prev.json) };
  if (prev && prev.status === "running" && !force)
    return { skipped: true, reason: "Tahlil hozir bajarilmoqda" };

  S.markRunning(db, callId, hash);
  const t0 = Date.now();
  const dict = S.activeDict(db);
  let ai = null, aiError = null, tries = [], aiEngine = null;   // aiEngine: gemini/<model> yoki claude
  if (useAi && L.available()) {
    try {
      const { lines } = A.parseTranscript(tr.text);
      const out = await L.analyzeWithAi(lines, meta);
      ai = out.ai; tries = out.tries; aiEngine = out.engine || "claude";
    } catch (e) { aiError = e.message; tries = e.tries || []; }
  }
  try {
    const result = buildResult(callId, tr.text, dict, meta, ai);
    result.aiError = aiError;
    result.aiTries = tries;
    if (aiEngine) result.aiEngine = aiEngine;
    S.saveAnalysis(db, callId, result, { engine: result.engine, ms: Date.now() - t0, hash });
    // TZ §2.8: kritik holat navbatga qo'yiladi — yuborishni alohida skript bajaradi,
    // shunda Telegram ishlamay qolsa ham tahlil saqlanadi va xabar keyin ketadi.
    try { S.queueAlert(db, callId, result, meta.call || null); } catch {}
    // Murabbiy kartasi uchun: kimning qo'ng'irog'i, ball, mezonlar (yuborishni panel xizmati bajaradi)
    try { M.qayd(db, callId, result, meta.call || null); } catch {}
    return { ok: true, analysis: result, aiError };
  } catch (e) {
    S.failAnalysis(db, callId, e.message, hash);
    throw e;
  }
}
