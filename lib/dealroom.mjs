// Deal window: one deal straight from Bitrix plus its latest activities.
// Replaces Sun's revenue.dealRoom (which leaned on the revenue forecast); same answer shape.
import { cached } from "./cache.mjs";

const TTL = 2 * 60e3;
const TYPE = { 1: "Uchrashuv", 2: "Qo‘ng‘iroq", 3: "Vazifa", 4: "Xat", 6: "Xabar" };
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null);

export const dealRoom = (bx, id, owner = null) => cached(`deal:room:${id}:${owner || "all"}`, TTL, async () => {
  const raw = (await bx.call("crm.deal.get", { id }).catch(() => ({}))).result;
  if (!raw) { const e = new Error("Bitim topilmadi"); e.status = 404; throw e; }
  // A seller may not open someone else's deal.
  if (owner && String(raw.ASSIGNED_BY_ID) !== String(owner)) {
    const e = new Error("Bu bitim sizga biriktirilmagan"); e.status = 403; throw e;
  }
  const deal = {
    id: raw.ID, title: raw.TITLE, amount: Number(raw.OPPORTUNITY || 0), currency: raw.CURRENCY_ID || "UZS",
    stage: raw.STAGE_ID, category: `#${raw.CATEGORY_ID}`, closeDate: raw.CLOSEDATE, owner: raw.ASSIGNED_BY_ID,
    idleDays: daysSince(raw.LAST_ACTIVITY_TIME), reasons: [], parts: {},
  };
  const acts = await bx.listAll("crm.activity.list", {
    filter: { OWNER_TYPE_ID: 2, OWNER_ID: id },
    select: ["ID", "SUBJECT", "TYPE_ID", "COMPLETED", "CREATED", "DEADLINE", "DIRECTION"],
    order: { CREATED: "DESC" }, maxItems: 25,
  }).catch(() => ({ items: [] }));
  return {
    deal,
    timeline: (acts.items || []).map((a) => ({
      id: a.ID, subject: a.SUBJECT || "(mavzusiz)", type: TYPE[a.TYPE_ID] || `Tur ${a.TYPE_ID}`,
      done: a.COMPLETED === "Y", at: a.CREATED, deadline: a.DEADLINE,
    })),
  };
});
