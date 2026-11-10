// Mijozsiz bitimga MIJOZ KIRITISH — panel orqali, xodimning o'zi.
//
// Nega alohida modul: writes.mjs faqat mavjud ID ni yozadi. Bu yerda xodim
// ism va telefonni kiritadi, tizim esa avval BAZADAN QIDIRADI — topsa shunga
// ulaydi, topmasa yangi yaratadi. Dublikat yaratmaslik shu qidiruvga bog'liq.
//
// Himoyalar (writes.mjs bilan bir xil):
//   · yozish rejimi off bo'lsa — yozmaydi (lekin oldindan ko'rsatadi)
//   · faqat mijozi YO'Q bitimga ulaydi, mavjud biriktiruvni almashtirmaydi
//   · yozgandan keyin qayta o'qib tasdiqlaydi
//   · audit jurnaliga writes.mjs formatida yoziladi -> bir bosishda qaytariladi
import { invalidate } from "./cache.mjs";
import * as wr from "./writes.mjs";

const E = (msg, status) => Object.assign(new Error(msg), { status });

// O'zbek raqami -> 998XXXXXXXXX. Bazada raqamlar turli ko'rinishda saqlangan,
// shuning uchun qidirishda hamma variant sinaladi.
export function normPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 9) return "998" + d;
  if (d.length === 12 && d.startsWith("998")) return d;
  if (d.length === 11 && d.startsWith("98")) return "9" + d;
  return null;
}
const variants = (p) => {
  const s = p.replace(/^998/, "");
  return [...new Set([p, "+" + p, s, "998" + s, "+998" + s])];
};

function cleanName(raw, kind) {
  const t = String(raw || "").replace(/\s+/g, " ").trim();
  if (t.length < 2) throw E("Ism kamida 2 harf bo'lsin", 400);
  if (t.length > 60) throw E("Ism 60 belgidan oshmasin", 400);
  if (!/\p{L}/u.test(t)) throw E("Ismda kamida bitta harf bo'lishi kerak", 400);
  if (/^\d+$/.test(t)) throw E(kind === "company" ? "Kompaniya nomi raqam bo'la olmaydi"
                                                  : "Ism raqam bo'la olmaydi", 400);
  return t;
}

// Telefon bo'yicha mavjud yozuvni izlash. findbycomm formatga sezgir —
// barcha variant bitta so'rovda yuboriladi.
export async function lookup(bx, phone) {
  const vs = variants(phone);
  for (const type of ["CONTACT", "COMPANY"]) {
    const r = await bx.call("crm.duplicate.findbycomm",
      { entity_type: type, type: "PHONE", values: vs }).catch(() => ({}));
    const id = (r.result?.[type] || [])[0];
    if (!id) continue;
    const g = await bx.call(type === "COMPANY" ? "crm.company.get" : "crm.contact.get",
      { id }).catch(() => ({}));
    const it = g.result;
    if (!it) continue;
    return { kind: type.toLowerCase(), id: String(it.ID),
             name: type === "COMPANY" ? it.TITLE : [it.NAME, it.LAST_NAME].filter(Boolean).join(" ") };
  }
  return null;
}

// Oldindan ko'rish — hech narsa yozmaydi.
export async function preview(bx, dealId, { name, phone, kind = "contact" }) {
  const d = (await bx.call("crm.deal.get", { id: dealId }).catch(() => ({}))).result;
  if (!d) throw E("Bitim topilmadi", 404);
  if (String(d.CONTACT_ID || "0") !== "0" || String(d.COMPANY_ID || "0") !== "0")
    throw E("Bu bitimda mijoz allaqachon biriktirilgan", 409);
  const p = normPhone(phone);
  if (!p) throw E("Telefon noto'g'ri. Masalan: 901234567 yoki +998901234567", 400);
  const nm = cleanName(name, kind);
  const found = await lookup(bx, p);
  return {
    dealId: String(d.ID), title: d.TITLE || `Bitim #${d.ID}`,
    phone: "+" + p, name: nm, kind: found ? found.kind : kind,
    action: found ? "reuse" : "create", existing: found,
  };
}

// Bajarish: kerak bo'lsa yaratadi, keyin bitimga ulaydi.
export async function attach(bx, db, { dealId, name, phone, kind = "contact", user, cid }) {
  const m = wr.mode(db);
  if (m === "off")
    throw E("Yozish rejimi o'chiq. Sozlamalar > Bitrixga yozish bo'limida 'test' yoki 'on' qiling.", 403);
  const pv = await preview(bx, dealId, { name, phone, kind });
  if (m === "test" && wr.todayCount(db) + 1 > 20)
    throw E(`Sinov rejimi: kuniga 20 ta yozuv. Bugun ${wr.todayCount(db)} ta ishlatilgan.`, 429);

  let targetId = pv.existing?.id, targetKind = pv.existing?.kind || kind, created = false;
  if (!targetId) {
    const isCo = kind === "company";
    const fields = isCo
      ? { TITLE: pv.name, PHONE: [{ VALUE: pv.phone, VALUE_TYPE: "WORK" }] }
      : { NAME:  pv.name, PHONE: [{ VALUE: pv.phone, VALUE_TYPE: "WORK" }], OPENED: "Y" };
    fields.SOURCE_DESCRIPTION = `Bitim #${dealId} uchun panel orqali kiritildi (${user.login})`;
    const r = await bx.call(isCo ? "crm.company.add" : "crm.contact.add",
      { fields, params: { REGISTER_SONET_EVENT: "N" } });
    targetId = r.result;
    if (!targetId) throw E("Bitrix mijoz yozuvini yaratmadi", 502);
    // yaratilgani rostdan joyidami
    const chk = (await bx.call(isCo ? "crm.company.get" : "crm.contact.get", { id: targetId })).result;
    if (!chk) throw E(`Yaratilgan yozuv #${targetId} qayta o'qishda topilmadi`, 502);
    targetKind = isCo ? "company" : "contact";
    created = true;
    db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
      .run(user.login, `bitrix.${targetKind}.add`, `${targetKind}:${targetId}`,
        JSON.stringify({ cid, name: pv.name, phone: pv.phone, fromDeal: String(dealId) }));
  }

  const bxField = targetKind === "company" ? "COMPANY_ID" : "CONTACT_ID";
  const up = await bx.call("crm.deal.update", { id: dealId, fields: { [bxField]: targetId } });
  if (up.result !== true) throw E("Bitrix bitimni yangilamadi", 502);
  const after = (await bx.call("crm.deal.get", { id: dealId })).result;
  if (String(after?.[bxField]) !== String(targetId))
    throw E(`Ulangandan keyin tekshiruv mos kelmadi (${after?.[bxField]})`, 502);

  // writes.mjs formati — shu tufayli mavjud "qaytarish" tugmasi shu yozuvda ham ishlaydi
  const changes = [{ field: targetKind === "company" ? "companyId" : "contactId",
                     label: targetKind === "company" ? "Kompaniya" : "Kontakt",
                     bx: bxField, before: null, after: String(targetId) }];
  db.prepare("INSERT INTO audit_events (actor,action,entity,detail) VALUES (?,?,?,?)")
    .run(user.login, "bitrix.write", `deal:${dealId}`, JSON.stringify({ cid, mode: m, changes }));
  invalidate("");
  return { ...pv, applied: true, created, targetId: String(targetId), targetKind, mode: m, undoable: true };
}
