// Bitrix24 REST klienti. Webhook URL faqat serverda qoladi — brauzerga hech qachon chiqmaydi.
import { setTimeout as sleep } from "node:timers/promises";

const PAGE = 50;

// AC-41: integratsiya salomatligi uchun o'lchov. Faqat oxirgi 200 chaqiruv
// saqlanadi — p50/p95 shundan hisoblanadi va xotira cheksiz o'smaydi.
export const STATS = { calls: 0, errors: 0, ms: [], lastAt: null, lastErr: null, startedAt: new Date().toISOString() };
const note = (ms, err) => {
  STATS.calls++;
  STATS.lastAt = new Date().toISOString();
  if (err) { STATS.errors++; STATS.lastErr = String(err).slice(0, 200); }
  STATS.ms.push(ms);
  if (STATS.ms.length > 200) STATS.ms.shift();
};
// p — foiz (50, 95). Bo'sh oynada null qaytaradi: "ma'lumot yo'q" ni nol deb
// ko'rsatish xato bo'lardi.
export const pct = (arr, p) => {
  if (!arr || !arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
};

export class Bitrix {
  constructor(webhookUrl, { timeoutMs = 20000 } = {}) {
    if (!webhookUrl) throw new Error("BITRIX_WEBHOOK_URL berilmagan");
    this.base = webhookUrl.endsWith("/") ? webhookUrl : webhookUrl + "/";
    this.timeoutMs = timeoutMs;
  }

  // Bitrix filter/select obyektini uning kutgan query formatiga aylantiradi.
  static qs(params, prefix = "") {
    const out = [];
    const walk = (val, key) => {
      if (val === undefined || val === null) return;
      if (Array.isArray(val)) val.forEach((v) => walk(v, `${key}[]`));
      else if (typeof val === "object") for (const k of Object.keys(val)) walk(val[k], `${key}[${k}]`);
      else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    };
    for (const k of Object.keys(params || {})) walk(params[k], prefix ? `${prefix}[${k}]` : k);
    return out.join("&");
  }

  async call(method, params = {}) {
    const t0 = Date.now();   // AC-41: chaqiruvchi ko'rgan to'liq vaqt (qayta urinishlar bilan)
    const url = `${this.base}${method}.json`;
    const body = Bitrix.qs(params);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), this.timeoutMs);
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          signal: ac.signal,
        });
        if (res.status === 503 || res.status === 429) { await sleep(400 * (attempt + 1)); continue; }
        const json = await res.json();
        if (json.error) throw new Error(`Bitrix ${method}: ${json.error_description || json.error}`);
        clearTimeout(t);
        note(Date.now() - t0, null);
        return json;
      } catch (e) {
        lastErr = e;
        if (e.name === "AbortError") break;
        await sleep(300 * (attempt + 1));
      }
    }
    clearTimeout(t);
    note(Date.now() - t0, lastErr || "noma'lum xato");
    throw lastErr || new Error(`Bitrix ${method}: noma'lum xato`);
  }

  // Faqat umumiy sonni oladi (bitta so'rov, ro'yxatni yuklamaydi).
  async count(method, filter = {}) {
    const r = await this.call(method, { filter, select: ["ID"], start: 0 });
    return Number(r.total || 0);
  }

  // Bir sahifa.
  async page(method, { filter = {}, select = ["ID"], order = {}, start = 0 } = {}) {
    const r = await this.call(method, { filter, select, order, start });
    return { items: r.result || [], total: Number(r.total || 0), next: r.next };
  }

  // Ko'p sahifa — maxItems bilan cheklangan (Bitrix'ni ortiqcha yuklamaslik uchun).
  // Bitrix sahifalashi OFFSET bo'yicha. Saralash kaliti takrorlansa (masalan
  // OPPORTUNITY=0 bo'lgan o'nlab bitim) sahifa chegarasida qatorlar joyini
  // almashtiradi: ba'zisi IKKI MARTA keladi, ba'zisi UMUMAN tushib qoladi.
  // O'lchangan: OPPORTUNITY bo'yicha 111 qatordan 4 tasi takror, 4 tasi yo'q.
  // Yechim: saralashga ID teng-ajratuvchi qo'shiladi va ID bo'yicha takror
  // olib tashlanadi. Metod ID bo'yicha saralashni qabul qilmasa — ID'siz qayta.
  async listAll(method, { filter = {}, select = ["ID"], order = {}, maxItems = 500 } = {}) {
    if ("ID" in order) return this.#page(method, filter, select, order, maxItems);
    const dir = String(Object.values(order)[0] || "ASC").toUpperCase() === "ASC" ? "ASC" : "DESC";
    try {
      return await this.#page(method, filter, select, { ...order, ID: dir }, maxItems);
    } catch {
      return await this.#page(method, filter, select, order, maxItems);
    }
  }

  async #page(method, filter, select, order, maxItems) {
    const out = [], seen = new Set();
    let start = 0, total = 0, guard = 0;
    while (out.length < maxItems && guard++ < 200) {
      const r = await this.call(method, { filter, select, order, start });
      const items = r.result || [];
      total = Number(r.total || 0);
      for (const it of items) {
        const id = it && it.ID != null ? String(it.ID) : null;
        if (id) { if (seen.has(id)) continue; seen.add(id); }
        out.push(it);
      }
      if (r.next === undefined || items.length < PAGE) break;
      start = r.next;
    }
    return { items: out.slice(0, maxItems), total };
  }
}

// Sana yordamchilari — hammasi Asia/Tashkent (UTC+5) bo'yicha.
export const TZ_OFFSET_MIN = 5 * 60;
export function tashkentNow(d = new Date()) {
  return new Date(d.getTime() + (d.getTimezoneOffset() + TZ_OFFSET_MIN) * 60000);
}
export function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// Bitrix filtri uchun ISO — Tashkent yarim tunini +05:00 ofset bilan beradi.
export function tashkentDayStartISO(daysAgo = 0) {
  const t = tashkentNow();
  t.setDate(t.getDate() - daysAgo);
  return `${ymd(t)}T00:00:00+05:00`;
}
