// Bitrix xodimlar spravochnigi: ID -> ism.
// `user` scope YO'Q bo'lsa hech narsa buzilmaydi — "#44" ko'rinishida qaytaradi.
// Scope qo'shilgan zahoti ismlar o'zi chiqa boshlaydi, kodga tegish shart emas.
import { cached } from "./cache.mjs";

const TTL_SCOPE = 5 * 60e3;      // scope o'zgarishi tez sezilsin
const TTL_NAMES = 30 * 60e3;
const CHUNK = 50;

export const scopes = (bx) => cached("bx:scopes", TTL_SCOPE, async () => {
  try {
    const r = await bx.call("app.info");
    return { scope: r.result?.SCOPE || [], license: r.result?.LICENSE || null };
  } catch {
    return { scope: [], license: null };
  }
});

export const has = async (bx, name) => (await scopes(bx)).scope.includes(name);

// Panelda "nima ochiq, nima yopiq"ni halol ko'rsatish uchun.
export const capabilities = (bx) => cached("bx:caps", TTL_SCOPE, async () => {
  const { scope, license } = await scopes(bx);
  return {
    scope, license,
    names: scope.includes("user"),
    telephony: scope.includes("telephony"),
    tasks: scope.includes("task") || scope.includes("tasks"),
  };
});

const key = (ids) => {
  // Kesh kaliti qisqa bo'lsin — ro'yxat uzun bo'lishi mumkin.
  let h = 0;
  for (const c of ids.join(",")) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `${ids.length}:${h}`;
};

// ids: raqam yoki matn ID'lar. Qaytadi: { names: {id: "Ism"}, resolved: bool }
export const names = (bx, ids) => {
  const uniq = [...new Set((ids || []).map((x) => String(x || "")).filter(Boolean))].sort();
  if (!uniq.length) return Promise.resolve({ names: {}, resolved: false });
  return cached(`dir:${key(uniq)}`, TTL_NAMES, async () => {
    const out = Object.fromEntries(uniq.map((id) => [id, `#${id}`]));
    if (!(await has(bx, "user"))) return { names: out, resolved: false };
    try {
      for (let i = 0; i < uniq.length; i += CHUNK) {
        const r = await bx.call("user.get", { FILTER: { ID: uniq.slice(i, i + CHUNK) } });
        for (const u of r.result || []) {
          const full = [u.LAST_NAME, u.NAME].filter(Boolean).join(" ").trim();
          out[String(u.ID)] = full || u.EMAIL || `#${u.ID}`;
        }
      }
      return { names: out, resolved: true };
    } catch {
      return { names: out, resolved: false };   // scope bor, lekin metod rad etdi
    }
  });
};

// Ro'yxatdagi har bir qatorga `ownerName` qo'shadi.
export async function decorate(bx, rows, idField = "owner", nameField = "ownerName") {
  const { names: map, resolved } = await names(bx, rows.map((r) => r[idField]));
  return { rows: rows.map((r) => ({ ...r, [nameField]: map[String(r[idField])] || `#${r[idField]}` })), resolved };
}
