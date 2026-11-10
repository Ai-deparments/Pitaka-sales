// Bitrix telefoniyasidan qo'ng'iroq yozuvini olish (TZ §6.1–6.3).
// `telephony` scope YO'Q bo'lsa hech narsa buzilmaydi — sabab bilan null qaytadi.
//
// Yo'l: crm.activity dagi ORIGIN_ID = "VI_externalCall.<CALL_ID>.<ts>" →
//       voximplant.statistic.get(FILTER:{CALL_ID}) → CALL_RECORD_URL (to'g'ridan-to'g'ri yuklanadi).
// crm_show_file.php havolasi ishlamaydi: u portal sessiyasini talab qiladi (tekshirilgan).
import { cached } from "./cache.mjs";
import * as dir from "./directory.mjs";

export const callIdFromOrigin = (originId) => {
  // Odoo VoIP (voip.call) — adapter "v<id>" beradi: yozuv aniq shu qo'ng'iroqniki. Sana+raqam bo'yicha
  // qidirish bu yerda xato qilardi: kiruvchi qo'ng'iroq bir vaqtda 2–3 operatorga jiringlaydi (bir raqam,
  // bir soniya), javob bergani bittasi — qolganlari yozuvsiz.
  if (/^v\d+$/.test(String(originId || ""))) return String(originId);
  const m = String(originId || "").match(/^VI_\w+\.([0-9a-f]{16,})\./i);
  return m ? m[1] : null;
};

// Pitaka: the webhook has `disk` but no `telephony`. The recording is the call activity's file:
// crm.activity.get → FILES[0].id → disk.file.get → DOWNLOAD_URL (checked on a live call 10.11).
async function recordFromDisk(bx, activityId) {
  const act = (await bx.call("crm.activity.get", { id: activityId })).result || {};
  const file = Array.isArray(act.FILES) ? act.FILES[0] : null;
  if (!file?.id) return { error: "Yozuv fayli yo'q (qo'ng'iroq yozib olinmagan)", code: "no_record" };
  const info = (await bx.call("disk.file.get", { id: file.id })).result || {};
  if (!info.DOWNLOAD_URL) return { error: "Disk yozuv havolasini bermadi", code: "api" };
  const started = act.START_TIME ? new Date(act.START_TIME).getTime() : NaN;
  const ended = act.END_TIME ? new Date(act.END_TIME).getTime() : NaN;
  return {
    url: info.DOWNLOAD_URL,
    callId: callIdFromOrigin(act.ORIGIN_ID) || String(activityId),
    durationSec: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : 0,
    startedAt: act.START_TIME || null,
    direction: String(act.DIRECTION) === "2" ? "out" : "in",
    phone: null,
    failed: false,
  };
}

// Bitta qo'ng'iroq uchun yozuv ma'lumoti. Qaytadi: {url, durationSec, callId} yoki {error}
export async function record(bx, { originId, activityId, at, phone }) {
  const caps = await dir.capabilities(bx);
  if (!caps.telephony && caps.disk && activityId) {
    try { return await recordFromDisk(bx, activityId); }
    catch (e) { return { error: e.message, code: "api" }; }
  }
  if (!caps.telephony)
    return { error: "Bitrix webhook'da «Телефония» yoki «Диск» ruxsati yoqilmagan — audio olinmaydi", code: "no_scope" };

  const callId = callIdFromOrigin(originId);
  const tryFilter = async (filter) => {
    try {
      const r = await bx.call("voximplant.statistic.get", { FILTER: filter, SORT: "CALL_START_DATE", ORDER: "DESC" });
      return r.result || [];
    } catch (e) { return { err: e.message }; }
  };

  let rows = [];
  if (callId) rows = await tryFilter({ CALL_ID: callId });
  // CALL_ID mos kelmasa — sana + raqam bo'yicha izlaymiz (portal yozuvi boshqa formatda bo'lishi mumkin)
  if ((!Array.isArray(rows) || !rows.length) && at) {
    const d = new Date(at);
    // Kun portal vaqtida (+03:00) hisoblanadi: UTC kuni 02:00–04:59 Toshkent
    // qo'ng'iroqlari uchun kechagi sanani berar va yozuv topilmasdi.
    const day = new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
    const f = { ">=CALL_START_DATE": `${day}T00:00:00`, "<=CALL_START_DATE": `${day}T23:59:59` };
    if (phone) f.PHONE_NUMBER = phone;
    const alt = await tryFilter(f);
    if (Array.isArray(alt)) {
      const t = d.getTime();
      rows = alt.filter((x) => Math.abs(new Date(x.CALL_START_DATE).getTime() - t) < 5 * 60e3);
    }
  }
  if (!Array.isArray(rows)) return { error: rows.err || "voximplant.statistic.get xatosi", code: "api" };
  if (!rows.length) return { error: "Bu qo'ng'iroq uchun telefoniya yozuvi topilmadi", code: "not_found" };

  const r = rows[0];
  const url = r.CALL_RECORD_URL || r.RECORD_FILE_ID || null;
  if (!url) return { error: "Yozuv fayli yo'q (qo'ng'iroq yozib olinmagan)", code: "no_record" };
  return {
    url, callId: r.CALL_ID || callId,
    durationSec: Number(r.CALL_DURATION || 0),
    startedAt: r.CALL_START_DATE || null,
    direction: String(r.CALL_TYPE) === "1" ? "out" : "in",
    phone: r.PHONE_NUMBER || phone || null,
    failed: String(r.CALL_FAILED_CODE || "200") !== "200",
  };
}

// Ruxsat yoqilganini bilish uchun — panel shundan o'qiydi
export const available = (bx) => cached("tel:on", 60e3, async () => (await dir.capabilities(bx)).recordings);
