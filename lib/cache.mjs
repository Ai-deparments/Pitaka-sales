// Oddiy TTL kesh — Bitrix'ga bir xil so'rovni takror yubormaslik uchun.
const store = new Map();       // key -> {exp, val}
const inflight = new Map();    // key -> Promise (bir vaqtda bir xil so'rovni birlashtiradi)

export async function cached(key, ttlMs, fn) {
  const hit = store.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const val = await fn();
      store.set(key, { exp: Date.now() + ttlMs, val });
      return val;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function invalidate(prefix = "") {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}

export function stats() {
  return { entries: store.size, inflight: inflight.size };
}
