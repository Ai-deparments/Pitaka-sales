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

function refresh(key, ttlMs, fn) {
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

// Stale-while-revalidate: a known value is returned at once; when it is past its TTL a background
// refresh starts and the next request gets the new value. Only the very first request waits for Bitrix.
export async function swr(key, ttlMs, fn) {
  const hit = store.get(key);
  if (!hit) return refresh(key, ttlMs, fn);
  if (hit.exp <= Date.now()) refresh(key, ttlMs, fn).catch(() => {});
  return hit.val;
}

// Marks entries stale without dropping them: swr keeps serving the old value while it refreshes.
export function expire(prefix = "") {
  for (const [k, v] of store) if (k.startsWith(prefix)) v.exp = 0;
}

export function invalidate(prefix = "") {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}

export function stats() {
  return { entries: store.size, inflight: inflight.size };
}
