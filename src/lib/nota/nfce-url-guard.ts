/**
 * Guarda de segurança para URLs de NFC-e lidas em QR Code.
 *
 * Um QR Code pode apontar para QUALQUER domínio. Este módulo é a única porta
 * de entrada permitida antes de qualquer fetch server-side:
 *
 *  - exige HTTPS;
 *  - exige host em allowlist (.gov.br + pista fiscal: sefaz/fazenda/set./sef./economia/receita);
 *  - bloqueia credenciais embutidas, portas fora de 443, IP literal (v4/v6),
 *    localhost, sufixos internos e endpoints de metadata (SSRF);
 *  - limita tamanho da URL.
 *
 * Função PURA — não faz rede, não lê ambiente. Usada também para revalidar
 * cada hop de redirect.
 */

export type NfceUrlRejectReason =
  | "url_parse_failed"
  | "url_too_long"
  | "bad_protocol"
  | "credentials_in_url"
  | "bad_port"
  | "ip_literal_blocked"
  | "loopback_blocked"
  | "private_or_internal_blocked"
  | "metadata_blocked"
  | "host_not_allowed";

export type NfceUrlGuardResult =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: NfceUrlRejectReason; host?: string };

const MAX_URL_LENGTH = 2048;

const HOST_ALLOW_SUFFIXES = [".gov.br"];
const HOST_FISCAL_HINTS = ["fazenda", "sefaz", "set.", "sef.", "economia", "receita", "nfce"];

const METADATA_HOSTS = [
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
];

const INTERNAL_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".test"];

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isIpv4(host: string): boolean {
  if (!IPV4_RE.test(host)) return false;
  return host.split(".").every((p) => Number(p) >= 0 && Number(p) <= 255);
}

function isIpv6(host: string): boolean {
  // URL.hostname devolve IPv6 entre colchetes.
  return host.startsWith("[") || (host.includes(":") && /^[0-9a-f:]+$/i.test(host));
}

function isPrivateIpv4(host: string): boolean {
  const [a, b] = host.split(".").map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isAllowedNfceHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!HOST_ALLOW_SUFFIXES.some((suf) => h.endsWith(suf))) return false;
  return HOST_FISCAL_HINTS.some((hint) => h.includes(hint));
}

export function validateNfceUrl(raw: unknown): NfceUrlGuardResult {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, reason: "url_parse_failed" };
  if (text.length > MAX_URL_LENGTH) return { ok: false, reason: "url_too_long" };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "url_parse_failed" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "bad_protocol" };
  if (url.username || url.password) return { ok: false, reason: "credentials_in_url" };
  if (url.port && url.port !== "443") return { ok: false, reason: "bad_port", host: url.hostname };

  const host = url.hostname.toLowerCase();

  if (METADATA_HOSTS.includes(host)) return { ok: false, reason: "metadata_blocked", host };
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    return { ok: false, reason: "loopback_blocked", host };
  }
  if (isIpv6(host)) return { ok: false, reason: "ip_literal_blocked", host };
  if (isIpv4(host)) {
    return {
      ok: false,
      reason: isPrivateIpv4(host) ? "private_or_internal_blocked" : "ip_literal_blocked",
      host,
    };
  }
  if (INTERNAL_SUFFIXES.some((suf) => host.endsWith(suf))) {
    return { ok: false, reason: "private_or_internal_blocked", host };
  }
  if (!isAllowedNfceHost(host)) return { ok: false, reason: "host_not_allowed", host };

  return { ok: true, url: url.toString(), host };
}
