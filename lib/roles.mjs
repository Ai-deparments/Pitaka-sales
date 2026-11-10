// Panel rollari — YAGONA manba (server, CLI va brauzer shu ro'yxatdan oladi).
//
// Egasining ro'yxati (2026-09-23):
//   1. CEO (Elmurod aka)            → ceo
//   2. Ijrochi direktor             → direktor
//   3. Sotuv rahbari — hammasi      → rahbar
//   4. B2B, sotuvchi — filtr, uchrashuv belgilaydi → b2b, sotuvchi
//   5. Operator (call-markaz)       → operator
//   6. Administrator — kuzatuv, to'g'rilash       → admin
// Eski rollar (ega, moliya, auditor, menejer, ekspert) saqlanadi — mavjud hisoblar buzilmasin.

export const ROLES = ["ceo", "direktor", "rahbar", "admin", "b2b", "sotuvchi", "operator",
                      "ega", "moliya", "auditor", "menejer", "ekspert"];

export const LABEL = {
  ceo: "CEO", direktor: "Ijrochi direktor", rahbar: "Sotuv rahbari", admin: "Administrator",
  b2b: "B2B sotuvchi", sotuvchi: "Sotuvchi", operator: "Operator (call-markaz)",
  ega: "Bo‘lim boshlig‘i", moliya: "Moliya", auditor: "Auditor", menejer: "Sotuv menejeri", ekspert: "Soliq eksperti",
};

// Rahbarlar — butun bo'lim ma'lumoti, boshqaruv bo'limlari (Markaz, Jamoa, Moliya, Audit …)
export const LEADER = ["ega", "ceo", "direktor", "rahbar"];
// Hammasini ko'radiganlar: rahbarlar + administrator (kuzatish va xatoni topish uchun)
export const FULL_VIEW = [...LEADER, "admin"];
// Xodimlar hisobini boshqaradiganlar (yaratish, rol, parol, CRM'ga bog'lash)
export const USER_ADMIN = ["ega", "ceo", "rahbar", "admin"];
// Imtiyozli rollar — bu rollarni YARATISH/O'ZGARTIRISH faqat SUPERADMIN qo'lida (imtiyoz oshirishning oldini oladi).
// Ya'ni rahbar/admin boshqa rahbar, admin, direktor, ceo yoki ega hisobini yarata/o'zgartira olmaydi.
export const PRIVILEGED = ["ega", "ceo", "direktor", "rahbar", "admin"];
// Imtiyozli hisob va rollarni boshqara oladiganlar (eng yuqori). Egasi kerak bo'lsa kengaytiradi.
export const SUPERADMIN = ["ega", "ceo"];
// O'z lid/bitimlari bilan ishlaydiganlar: CRM'da mas'ul (ASSIGNED_BY_ID) = o'zi
export const SELLER = ["sotuvchi", "b2b", "menejer"];
// Call-markaz operatori: «Оператор (Авто танланади)» = o'zi bo'lgan lidlar va o'z qo'ng'iroqlari
export const OPERATOR = ["operator"];
// Majburiy 2FA yoqilganda qaysi rollarga talab qilinadi
export const MFA_ROLES = ["ega", "ceo", "direktor", "rahbar", "admin"];

// Ma'lumot doirasi (lib funksiyalariga `owner` sifatida uzatiladi):
//   null        — hammasi
//   "<id>"      — sotuvchi: ASSIGNED_BY_ID = id
//   "op:<id>"   — operator: lidlarda UF_CRM_OPERATOR = id, bitimlarda hech narsa
// CRM ID bog'lanmagan bo'lsa — hech narsa ko'rmaydi (ochiq qoldirishdan xavfsizroq).
export function scopeOf(user) {
  if (!user) return "__none__";
  if (SELLER.includes(user.role)) return String(user.bitrixUserId || "__none__");
  if (OPERATOR.includes(user.role)) return user.bitrixUserId ? `op:${user.bitrixUserId}` : "__none__";
  return null;
}
export const isOp = (owner) => typeof owner === "string" && owner.startsWith("op:");
// Lid filtri: sotuvchi — mas'ul, operator — «Оператор (Авто танланади)»
// Pitaka: operators are Bitrix users too — the lead's responsible person is the operator.
export const leadOwn = (owner) => (!owner ? {} : { ASSIGNED_BY_ID: isOp(owner) ? owner.slice(3) : owner });
// Bitim/faoliyat filtri: operatorda bitim yo'q (lid managerga o'tgach, u sotuvchiniki)
export const dealOwn = (owner) => (!owner ? {} : isOp(owner) ? { ASSIGNED_BY_ID: "__none__" } : { ASSIGNED_BY_ID: owner });
// Qo'ng'iroq egasi (RESPONSIBLE_ID) — sotuvchi ham, operator ham o'z qo'ng'iroqlari
export const callOwner = (owner) => (!owner ? null : isOp(owner) ? owner.slice(3) : owner);

// Brauzerga: qaysi bo'limlar ko'rinadi, qayerdan boshlanadi
export function caps(role) {
  const leader = LEADER.includes(role), full = FULL_VIEW.includes(role);
  const operator = OPERATOR.includes(role), seller = SELLER.includes(role);
  return {
    label: LABEL[role] || role, leader, full, operator, seller,
    users: USER_ADMIN.includes(role),
    start: full ? "command" : operator ? "operator" : "workbench",
  };
}

// ---------------------------------------------------------------- AI agent chat (suzuvchi robot)
// Rol -> qaysi agent(lar) bilan chatlasha oladi. "*" = barcha tirik agent (rahbar/admin).
// Agent id lari lib/agents.mjs dagi AGENTS bilan bir xil. Nafaqadagi agent (marketing) berilmaydi.
// def = robotcha avatarida chiqadigan asosiy agent; set = chatdagi almashtirgichda ko'rinadiganlar.
export const AGENT_ACCESS = {
  ega:      { def: "sotuv",      set: "*" },
  ceo:      { def: "sotuv",      set: "*" },
  direktor: { def: "sotuv",      set: "*" },
  rahbar:   { def: "sotuv",      set: "*" },
  admin:    { def: "qoriqchi",   set: "*" },
  sotuvchi: { def: "sotuvcoach", set: ["sotuvcoach"] },
  b2b:      { def: "tezkorlid",  set: ["tezkorlid"] },
  operator: { def: "qongiroq",   set: ["qongiroq", "sotuvcoach", "tezkorlid"] },
  menejer:  { def: "sotuvcoach", set: ["sotuvcoach", "tezkorlid"] },
  moliya:   { def: "moliya",     set: ["moliya"] },
  auditor:  { def: "auditchi",   set: ["auditchi"] },
  ekspert:  { def: "sotuvcoach", set: ["sotuvcoach"] },
};
const AGENT_FALLBACK = { def: "sotuvcoach", set: ["sotuvcoach"] };

// Foydalanuvchi roli uchun ruxsat etilgan agent id lari (default birinchi).
// liveIds — hozir chatlasa bo'ladigan agent id lari (server lib/agents.mjs dan beradi).
export function allowedAgents(role, liveIds) {
  const live = Array.isArray(liveIds) ? liveIds : [];
  const a = AGENT_ACCESS[role] || AGENT_FALLBACK;
  let ids = a.set === "*" ? live.slice() : a.set.filter((id) => live.includes(id));
  if (!ids.length) ids = AGENT_FALLBACK.set.filter((id) => live.includes(id));
  const def = ids.includes(a.def) ? a.def : ids[0];
  return def ? [def, ...ids.filter((id) => id !== def)] : [];
}
// Default (robotcha) agent id.
export function defaultAgent(role, liveIds) {
  return allowedAgents(role, liveIds)[0] || null;
}
// Ruxsat tekshiruvi — ask/thread uchun (server majburlaydi).
export function canUseAgent(role, agentId, liveIds) {
  return allowedAgents(role, liveIds).includes(agentId);
}
