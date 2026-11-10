// Telegram tugmalari (Murabbiy boti) — ko'p so'raladigan raqamlar bir bosishda, KOD bilan (2026-10-29).
//
// Qoidalar (buzilmaydi):
//   • Bo'lim raqamlari (lidlar, ochiq bitimlar…) — faqat rahbarlarga (roles.FULL_VIEW): panel agentidagi tezkor bilan bir xil shart.
//   • Sotuvchi va operator — faqat O'Z raqamlari (roles.scopeOf: sotuvchi = mas'ul, operator = «Оператор» maydoni).
//   • callback_data mijozdan keladi: har bosishda rol qayta tekshiriladi — soxta tugma bo'lim raqamini ochmaydi.
//   • Raqamni tezkor.hisobla yoki gigiena hisoblaydi; ma'lumot to'liq bo'lmasa — raqam emas, «hisoblab bo'lmadi».
import * as tezkor from "./tezkor.mjs";
import * as RL from "./roles.mjs";

export const PREFIKS = "m:";

// kim: rahbar — bo'lim raqami; sotuvchi — o'z bitimlari; shaxsiy — sotuvchi yoki operatorning o'z lidlari;
// buyruq — Murabbiy'ning mavjud buyrug'i (o'z qo'ng'iroqlari), murabbiy.mjs o'zi bajaradi.
export const TUGMA = {
  lid_bugun: { matn: "📥 Bugun lidlar", kim: "rahbar", q: { tur: "lid_kun", kun: "bugun" } },
  lid_kecha: { matn: "📥 Kecha lidlar", kim: "rahbar", q: { tur: "lid_kun", kun: "kecha" } },
  lid_7: { matn: "📅 7 kun lidlar", kim: "rahbar", q: { tur: "lid_n", n: 7 } },
  javobsiz24: { matn: "⏰ Javobsiz lidlar", kim: "rahbar", q: { tur: "javobsiz24" } },
  ochiq: { matn: "💼 Ochiq bitimlar", kim: "rahbar", q: { tur: "ochiq" } },
  qadamsiz: { matn: "⚠️ Qadamsiz bitimlar", kim: "rahbar", q: { tur: "qadamsiz" } },
  top: { matn: "🏆 Kimda ko'p bitim", kim: "rahbar", q: { tur: "top" } },
  qongiroq: { matn: "📞 Kecha qo'ng'iroqlar", kim: "rahbar", q: { tur: "qongiroq", kun: "kecha" } },
  mening_bitim: { matn: "💼 Mening bitimlarim", kim: "sotuvchi" },
  mening_lid_bugun: { matn: "📥 Bugungi lidlarim", kim: "shaxsiy", kun: "bugun" },
  mening_lid_kecha: { matn: "📥 Kechagi lidlarim", kim: "shaxsiy", kun: "kecha" },
  k_bugun: { matn: "📞 Bugungi qo'ng'iroqlarim", kim: "buyruq", buyruq: "bugun" },
  k_oxirgi: { matn: "🕐 Oxirgi qo'ng'iroq", kim: "buyruq", buyruq: "oxirgi" },
  k_mezon: { matn: "🎯 Mezonlarim", kim: "buyruq", buyruq: "mezon" },
};

const QATOR = {
  rahbar: [["lid_bugun", "lid_kecha"], ["lid_7", "javobsiz24"], ["ochiq", "qadamsiz"], ["top", "qongiroq"]],
  sotuvchi: [["mening_bitim"], ["mening_lid_bugun", "mening_lid_kecha"], ["k_bugun", "k_oxirgi"], ["k_mezon"]],
  operator: [["mening_lid_bugun", "mening_lid_kecha"], ["k_bugun", "k_oxirgi"], ["k_mezon"]],
};

// Faqat o'z kalitlari: «constructor», «__proto__» kabi meros nomlar tugma emas (ko'rib chiqish, 029)
const tugmaOf = (key) => (Object.hasOwn(TUGMA, key) ? TUGMA[key] : null);
export { tugmaOf };

const turi = (role) => (RL.FULL_VIEW.includes(role) ? "rahbar" : RL.SELLER.includes(role) ? "sotuvchi" : RL.OPERATOR.includes(role) ? "operator" : null);

// Bu odam shu tugmani bosishi mumkinmi — klaviaturada ko'rsatishda ham, bosilganda ham shu bitta tekshiruv.
export function ruxsat(key, { role, owner } = {}) {
  const t = tugmaOf(key), tur = turi(role);
  if (!t || !tur) return false;
  if (t.kim === "rahbar") return tur === "rahbar";
  if (!owner) return false;                                           // CRM ID'siz shaxsiy raqam yo'q
  if (t.kim === "sotuvchi") return tur === "sotuvchi";
  if (t.kim === "shaxsiy") return tur === "sotuvchi" || tur === "operator";
  return t.kim === "buyruq";                                         // buyruq — Murabbiy o'z qo'ng'iroqlarini o'zi tekshiradi; boshqa tur — yo'q
}

// Bu rolga menyu bormi (CRM ID bo'lmasa ham) — /start da «CRM'ga bog'lanmagan» faqat shularga aytiladi
export const menyuRoli = (role) => turi(role) !== null;

// → inline_keyboard qatorlari yoki null (bu odamga tugma yo'q)
export function klaviatura(user = {}, panelUrl = "") {
  const tur = turi(user.role);
  if (!tur) return null;
  const rows = QATOR[tur].map((r) => r.filter((k) => ruxsat(k, user)).map((k) => ({ text: TUGMA[k].matn, callback_data: PREFIKS + k })))
    .filter((r) => r.length);
  if (!rows.length) return null;
  if (/^https:\/\//.test(panelUrl)) rows.push([{ text: "📊 Panelda ochish", url: panelUrl }]);
  return rows;
}

const MANBA = "\nManba: panel (tezkor javob).";
export const XATO = "⏳ Hozir hisoblab bo'lmadi: ma'lumot to'liq emas yoki CRM javob bermadi. Bir daqiqadan keyin qayta bosing yoki panelda ko'ring.";
export const MAN = "🔒 Bu tugma sizning rolingiz uchun emas.";

// Bosilgan tugmaga javob matni (oddiy matn, HTML emas). ctx — panel funksiyalari (tezkor ctx + leadsScoped).
// → string; tugma noma'lum yoki «buyruq» turida — null (murabbiy.mjs o'zi bajaradi).
// log — xato jurnalga (javob baribir XATO, istisno tashlanmaydi)
export async function javob(key, user, ctx, now = Date.now(), log = () => {}) {
  const t = tugmaOf(key);
  if (!t || t.kim === "buyruq") return null;
  if (!ruxsat(key, user)) return MAN;
  if (!ctx) return XATO;
  try {
    if (t.kim === "rahbar") {
      const r = await tezkor.hisobla(t.q, ctx, "uz", now);
      return r ? r.text : XATO;
    }
    if (t.kim === "sotuvchi") {
      const ov = await ctx.overview();
      if (!tezkor.toliq(ov)) return XATO;
      const o = (ov.owners || []).find((x) => String(x.owner) === String(user.owner));
      if (!o) return `💼 Sizda hozir faol ochiq bitim yo'q. Kesim ${tezkor.hhmm(now)}.` + MANBA;
      const c = o.counts || {};
      return [`💼 Sizning faol ochiq bitimlaringiz: ${tezkor.son(o.total)} ta.`,
        `• Keyingi qadam belgilanmagan: ${tezkor.son(c.qadam || 0)}`,
        `• Yopilish sanasi qo'yilmagan: ${tezkor.son(c.sana || 0)}`,
        `• Gigiena bo'yicha muammosiz: ${tezkor.son(o.clean || 0)}`,
        `Kesim ${tezkor.hhmm(now)}.`].join("\n") + MANBA;
    }
    if (t.kim === "shaxsiy") {
      const scope = RL.scopeOf({ role: user.role, bitrixUserId: user.owner });
      if (!scope || scope === "__none__") return MAN;               // scope null = hammasi — shaxsiy tugmada bo'lmaydi
      const R = tezkor.kunOraligi(t.kun), r = await ctx.leadsScoped(R, scope);
      if (!Number.isFinite(r?.total)) return XATO;
      const kim = RL.isOp(scope) ? "siz ishlagan" : "sizga biriktirilgan";
      return `📥 ${t.kun === "bugun" ? "Bugun" : "Kecha"} (${R.from}) ${kim} lidlar: ${tezkor.son(r.total)} ta.` + tezkor.dum("uz", t.kun, now) + MANBA;
    }
  } catch (e) {
    log(`menyu ${key}: ${e?.message || e}`);
    return XATO;
  }
  return null;
}
