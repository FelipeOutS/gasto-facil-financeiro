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
  "com.br",
  "com.mx",
  "com.ar",
  "com.co",
  "com.pe",
  "com.uy",
  "com.pt",
  "co.uk",
  "co.jp",
  "co.kr",
  "co.in",
  "co.za",
  "co.nz",
  "org.br",
  "net.br",
  "gov.br",
  "edu.br",
  "com.au",
  "com.tr",
  "com.sg",
  "com.hk",
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

/** Build plausible domain guesses from a free-form company name. */
export function guessDomainsFromName(name: string | null | undefined): string[] {
  if (!name) return [];
  const cleaned = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(aplicativo|app|site|web|conta|login|acesso|portal|minha|meu)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const slug = cleaned.replace(/\s+/g, "");
  const firstWord = cleaned.split(" ")[0];
  const candidates = new Set<string>();
  for (const base of [slug, firstWord]) {
    if (!base || base.length < 2) continue;
    for (const tld of [".com", ".com.br", ".io", ".dev", ".app", ".co"]) {
      candidates.add(`${base}${tld}`);
    }
  }
  return [...candidates];
}

/** Ordered list of candidate logo URLs to try (with onError fallthrough). */
export function getCompanyLogoCandidates(
  domain: string | null | undefined,
  name?: string | null,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const pushFor = (d: string) => {
    const norm = extractDomain(d) ?? d;
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    urls.push(
      `https://img.logo.dev/${norm}?token=pk_X-1ZO13ESQOXMI5MlVUVQQ&size=128&format=png`,
      `https://icons.duckduckgo.com/ip3/${norm}.ico`,
      `https://www.google.com/s2/favicons?domain=${norm}&sz=128`,
    );
  };
  if (domain) pushFor(domain);
  for (const guess of guessDomainsFromName(name)) pushFor(guess);
  return urls;
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
