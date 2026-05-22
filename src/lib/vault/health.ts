// Vault health: detects pwned (HIBP k-anonymity), reused, weak and old passwords.
// HIBP uses SHA-1 prefix — only the first 5 hex chars leave the device, never the full password.

const pwnedCache = new Map<string, number>();
const PWNED_NEG = -1;

async function sha1Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** Returns the number of times the password appears in known breaches (0 = safe). -1 = check failed. */
export async function checkPwnedCount(password: string): Promise<number> {
  if (!password) return 0;
  const hash = await sha1Hex(password);
  const cached = pwnedCache.get(hash);
  if (cached !== undefined) return cached;
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) {
      pwnedCache.set(hash, PWNED_NEG);
      return PWNED_NEG;
    }
    const text = await res.text();
    let count = 0;
    for (const line of text.split("\n")) {
      const [suf, c] = line.trim().split(":");
      if (suf && suf.toUpperCase() === suffix) {
        count = Number(c) || 0;
        break;
      }
    }
    pwnedCache.set(hash, count);
    return count;
  } catch {
    pwnedCache.set(hash, PWNED_NEG);
    return PWNED_NEG;
  }
}

export type EntryForHealth = {
  id: string;
  name: string;
  category: string;
  site?: string | null;
  updated_at: string;
  password_strength: string;
  password: string;
};

export type HealthReport = {
  total: number;
  weak: EntryForHealth[];
  reused: { password: string; entries: EntryForHealth[] }[];
  old: EntryForHealth[];
  pwned: { entry: EntryForHealth; count: number }[];
  pwnedFailed: number;
  scannedAt: number;
};

const OLD_DAYS = 365;

export function computeReused(entries: EntryForHealth[]): HealthReport["reused"] {
  const groups = new Map<string, EntryForHealth[]>();
  for (const e of entries) {
    if (!e.password) continue;
    const list = groups.get(e.password) ?? [];
    list.push(e);
    groups.set(e.password, list);
  }
  return Array.from(groups.entries())
    .filter(([, list]) => list.length > 1)
    .map(([password, list]) => ({ password, entries: list }))
    .sort((a, b) => b.entries.length - a.entries.length);
}

export function computeOld(entries: EntryForHealth[], days = OLD_DAYS): EntryForHealth[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return entries
    .filter((e) => {
      const t = Date.parse(e.updated_at);
      return Number.isFinite(t) && t < cutoff;
    })
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
}

export function computeWeak(entries: EntryForHealth[]): EntryForHealth[] {
  return entries.filter((e) => e.password_strength === "fraca");
}

/** Runs HIBP checks for every distinct password, with limited concurrency. */
export async function analyzeVault(
  entries: EntryForHealth[],
  onProgress?: (done: number, total: number) => void,
): Promise<HealthReport> {
  const weak = computeWeak(entries);
  const reused = computeReused(entries);
  const old = computeOld(entries);

  // Deduplicate passwords for HIBP
  const distinct = new Map<string, EntryForHealth[]>();
  for (const e of entries) {
    if (!e.password) continue;
    const list = distinct.get(e.password) ?? [];
    list.push(e);
    distinct.set(e.password, list);
  }
  const pwds = Array.from(distinct.keys());
  const total = pwds.length;
  let done = 0;
  const pwned: HealthReport["pwned"] = [];
  let pwnedFailed = 0;
  const CONCURRENCY = 4;
  let idx = 0;
  async function worker() {
    while (idx < pwds.length) {
      const my = idx++;
      const pwd = pwds[my];
      const count = await checkPwnedCount(pwd);
      done++;
      onProgress?.(done, total);
      if (count === PWNED_NEG) {
        pwnedFailed++;
        continue;
      }
      if (count > 0) {
        for (const e of distinct.get(pwd) ?? []) pwned.push({ entry: e, count });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pwds.length) }, worker));
  pwned.sort((a, b) => b.count - a.count);

  return {
    total: entries.length,
    weak,
    reused,
    old,
    pwned,
    pwnedFailed,
    scannedAt: Date.now(),
  };
}
