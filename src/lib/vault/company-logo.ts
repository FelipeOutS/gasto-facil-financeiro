/**
 * Company logo resolver for the Personal Vault.
 *
 * Strategy (no fixed brand list, works for any public site):
 *   1. Extract a clean public domain from URL or free-form text.
 *   2. Try a brand-logo API (Logo.dev with public token) for a real logo.
 *   3. Fall back to favicon providers (DuckDuckGo, Google s2).
 *   4. Fall back to an elegant letter avatar.
 *
 * Only the public domain is ever sent to third parties — never
 * usernames, passwords or notes.
 */

const KNOWN_PUBLIC_SUFFIXES = new Set([
  "com.br", "com.mx", "com.ar", "com.co", "com.pe", "com.uy", "com.pt",
  "co.uk", "co.jp", "co.kr", "co.in", "co.za", "co.nz",
  "org.br", "net.br", "gov.br", "edu.br",
  "com.au", "com.tr", "com.sg", "com.hk",
]);

/** Extract the principal public domain from an arbitrary URL/string. */
export function extractDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = input.trim().toLowerCase();
  if (!raw) return null;
  // strip scheme & path
  raw = raw.replace(/^[a-z]+:\/\//, "");
  raw = raw.split("/")[0];
  raw = raw.split("?")[0].split("#")[0];
  // strip user@host and port
  raw = raw.split("@").pop() ?? raw;
  raw = raw.split(":")[0];
  // strip leading www. / m. / app.
  raw = raw.replace(/^(www\.|m\.|app\.|web\.)/, "");
  if (!raw.includes(".")) return null;
  // basic validation
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw)) return null;

  const parts = raw.split(".");
  if (parts.length <= 2) return raw;
  const lastTwo = parts.slice(-2).join(".");
  const lastThree = parts.slice(-3).join(".");
  if (KNOWN_PUBLIC_SUFFIXES.has(lastTwo)) return lastThree;
  return lastTwo;
}

/** Ordered list of candidate logo URLs to try (with onError fallthrough). */
export function getCompanyLogoCandidates(
  domain: string | null | undefined,
): string[] {
  if (!domain) return [];
  const d = extractDomain(domain) ?? domain;
  return [
    // Logo.dev — public demo token (returns brand logos for known domains).
    `https://img.logo.dev/${d}?token=pk_X-1ZO13ESQOXMI5MlVUVQQ&size=128&format=png`,
    // DuckDuckGo favicon proxy — broad coverage, transparent backgrounds.
    `https://icons.duckduckgo.com/ip3/${d}.ico`,
    // Google s2 — last-resort favicon.
    `https://www.google.com/s2/favicons?domain=${d}&sz=128`,
  ];
}

/** Convenience: derive a stable color from a string for the letter avatar. */
export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 55% 38%)`;
}

export function initialOf(name: string | null | undefined): string {
  if (!name) return "?";
  const s = name.trim();
  return (s[0] ?? "?").toUpperCase();
}
