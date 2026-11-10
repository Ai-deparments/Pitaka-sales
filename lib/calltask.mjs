// TZ §4.H — AI topgan keyingi qadamni CRM'ga yozish.
//
// `tasks` REST ruxsati ro'yxatda bor, lekin metodlari `insufficient_scope` beradi
// (webhook egasi Bitrix ichida vazifalarga huquqsiz). Shuning uchun vazifa
// `crm.activity.add` orqali CRM FAOLIYATI sifatida yaratiladi — portalda bu
// allaqachon ishlatiladigan uslub (TYPE_ID=3 bo'yicha 1674 ta yozuv bor) va
// natija mijoz tarixida ko'rinadi.
//
// Muhim: sana O'YLAB TOPILMAYDI. AI "ertaga soat 15:00" desa — aniq sanaga
// aylantiramiz; "keyinroq" kabi noaniq gapdan sana yasamaymiz, muddat bo'sh qoladi
// va oldindan ko'rishda shu ochiq yoziladi.
import { tashkentNow, ymd } from "./bitrix.mjs";
import * as store from "./callstore.mjs";
import * as wr from "./writes.mjs";

// tur → Bitrix faoliyat turi
const TYPE = {
  callback: { id: 2, label: "Qo'ng'iroq", direction: 2 },
  meeting:  { id: 1, label: "Uchrashuv" },
  document: { id: 3, label: "Vazifa" },
  quote:    { id: 3, label: "Vazifa" },
  payment:  { id: 3, label: "Vazifa" },
};
const OWNER_TYPE = { lead: 1, deal: 2, contact: 3, company: 4 };
const WD = { dushanba:1, seshanba:2, chorshanba:3, payshanba:4, juma:5, shanba:6, yakshanba:7,
             "понедельник":1, "вторник":2, "среда":3, "среду":3, "четверг":4, "пятница":5, "пятницу":5,
             "суббота":6, "субботу":6, "воскресенье":7 };

// "ertaga soat 15:00" → 2026-09-10T15:00:00+05:00. Aniqlab bo'lmasa null.
export function parseDue(text, now = tashkentNow()) {
  const t = String(text || "").toLowerCase().replace(/[''`ʻʼ‘’]/g, "'");
  if (!t) return null;
  const d = new Date(now);
  let matched = false;

  // `\b` kirill bilan ISHLAMAYDI (JS'da \w faqat ASCII) — Unicode chegarasi shart.
  // Shu tuzoq bu loyihada ikkinchi marta uchradi: "завтра" topilmay qolgandi.
  const W = (...a) => new RegExp("(?<![\\p{L}\\p{N}_])(?:" + a.join("|") + ")(?![\\p{L}\\p{N}_])", "iu");
  let rest = t;                                     // sanani kesib tashlaymiz — vaqt qidiruvi unga tegmasin

  const dm = t.match(/(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?/);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : d.getFullYear();
    d.setFullYear(y, +dm[2] - 1, +dm[1]);
    rest = t.slice(0, dm.index) + " " + t.slice(dm.index + dm[0].length);
    matched = true;
  } else if (W("bugun", "сегодня").test(t)) { matched = true; }
  else if (W("ertaga", "завтра").test(t)) { d.setDate(d.getDate() + 1); matched = true; }
  else if (W("indinga", "послезавтра").test(t)) { d.setDate(d.getDate() + 2); matched = true; }
  else {
    for (const [w, n] of Object.entries(WD)) {
      if (!t.includes(w)) continue;
      const cur = d.getDay() === 0 ? 7 : d.getDay();
      d.setDate(d.getDate() + ((n - cur + 7) % 7 || 7));
      matched = true; break;
    }
  }
  if (!matched) return null;

  // Vaqt uchun faqat ":" — "12.09" sanasi 12:09 vaqti bo'lib o'qilgandi (sinovda topilgan).
  const tm = rest.match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
  if (tm) d.setHours(+tm[1], +tm[2], 0, 0);
  else d.setHours(10, 0, 0, 0);                     // vaqt aytilmagan bo'lsa — ish kuni boshi
  const p = (n) => String(n).padStart(2, "0");
  return `${ymd(d)}T${p(d.getHours())}:${p(d.getMinutes())}:00+05:00`;
}

// Bitrix'ga yuboriladigan aniq tanani quradi — yozmaydi.
export function build(call, task, analysis) {
  const kind = TYPE[task.kind] || TYPE.callback;
  const ownerType = call.entity ? OWNER_TYPE[call.entity.kind] : null;
  if (!ownerType || !call.entity?.id)
    throw Object.assign(new Error("Bu qo'ng'iroq CRM yozuviga bog'lanmagan — vazifa biriktiriladigan joy yo'q"), { status: 409 });

  const due = task.due ? parseDue(task.due) : null;
  const lines = [];
  lines.push(String(task.title || "").trim());
  if (analysis?.topic) lines.push(`Mavzu: ${analysis.topic}`);
  if (analysis?.deal_risk?.level && analysis.deal_risk.level !== "low")
    lines.push(`Xavf: ${analysis.deal_risk.level} — ${(analysis.deal_risk.reasons || []).slice(0, 2).join("; ")}`);
  const q = (analysis?.critical_moments || []).find((m) => m.speaker === "customer" && m.kind === "risk")
        || (analysis?.critical_moments || []).find((m) => m.speaker === "customer");
  if (q) lines.push(`Mijoz aytdi (${q.ts}): «${String(q.quote).slice(0, 180)}»`);
  if (task.due && !due) lines.push(`Muddat matnda: "${task.due}" — aniq sanaga aylanmadi, qo'lda qo'ying.`);
  lines.push("");
  lines.push(`AI qo'ng'iroq tahlilidan (#${call.id}). Tavsiya — yakuniy qaror insonniki.`);

  const body = {
    fields: {
      TYPE_ID: kind.id,
      SUBJECT: String(task.title || "Keyingi qadam").slice(0, 200),
      DESCRIPTION: lines.join("\n").slice(0, 4000),
      DESCRIPTION_TYPE: 1,
      RESPONSIBLE_ID: Number(call.owner) || undefined,
      OWNER_TYPE_ID: ownerType,
      OWNER_ID: Number(call.entity.id),
      COMPLETED: "N",
      PRIORITY: analysis?.deal_risk?.level === "critical" ? 3 : 2,
      COMMUNICATIONS: [{
        VALUE: call.phoneRaw || call.phone || "",
        ENTITY_ID: Number(call.entity.id),
        ENTITY_TYPE_ID: ownerType,
        TYPE: "PHONE",
      }],
    },
  };
  if (kind.direction) body.fields.DIRECTION = kind.direction;
  if (due) { body.fields.DEADLINE = due; body.fields.START_TIME = due; }
  return { body, due, dueText: task.due || null, typeLabel: kind.label,
           bindTo: `${call.entity.label || call.entity.kind} #${call.entity.id}` };
}

// Haqiqiy yozuv. Yozish rejimi 'off' bo'lsa — bajarilmaydi.
export async function push(bx, db, { call, task, analysis, taskId, user }) {
  // Faoliyat (crm.activity.add) — «faoliyat yozish» kaliti yetarli; bitim maydonlari rejimi (write_mode) shart emas
  if (!wr.activityOn(db) && wr.mode(db) === "off")
    throw Object.assign(new Error("CRM'ga faoliyat yozish o'chirilgan (sozlama: faoliyat yozish)."), { status: 409 });
  const built = build(call, task, analysis);
  const r = await bx.call("crm.activity.add", built.body);
  if (r.error) throw Object.assign(new Error(`Bitrix rad etdi: ${r.error_description || r.error}`), { status: 502 });
  const id = String(r.result);
  if (taskId) store.setTaskState(db, taskId, "pushed", { bitrixId: id, detail: built.bindTo });
  db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
    .run(user?.login || "?", "bitrix.write", `activity:${id}`,
         `qo'ng'iroq #${call.id} → ${built.typeLabel} "${built.body.fields.SUBJECT}" (${built.bindTo})`);
  return { ok: true, bitrixId: id, ...built };
}
