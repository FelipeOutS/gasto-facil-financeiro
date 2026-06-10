/**
 * URL pública canônica do app, usada nos e-mails de autenticação
 * (recuperação de senha, confirmação de cadastro, etc.) e em qualquer
 * link compartilhado com o usuário final.
 *
 * Regra:
 *  - Em produção (gastointeligente.com.br / www.gastointeligente.com.br),
 *    sempre usar o domínio oficial.
 *  - Em preview / dev / lovable.app / lovableproject.com, usar
 *    window.location.origin para não quebrar o fluxo de teste.
 *  - Permitir override via VITE_PUBLIC_APP_URL quando definido.
 */

const OFFICIAL_PUBLIC_URL = "https://gastointeligente.com.br";

function isProductionHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "gastointeligente.com.br" || h === "www.gastointeligente.com.br";
}

function isPreviewLikeHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h.endsWith(".lovableproject.com") ||
    h.endsWith(".lovable.app") ||
    h.endsWith(".lovable.dev") ||
    h === "localhost" ||
    h.startsWith("127.") ||
    h.startsWith("192.168.") ||
    h.endsWith(".local")
  );
}

/**
 * Retorna a base pública (sem barra final) a ser usada para montar links
 * enviados ao usuário final (e-mails de auth, convites, etc.).
 */
export function getPublicAppUrl(): string {
  // Override explícito por env (útil para staging em domínio próprio).
  const fromEnv =
    (typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PUBLIC_APP_URL) ||
    "";
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  if (typeof window === "undefined") return OFFICIAL_PUBLIC_URL;

  const host = window.location.hostname;
  // Produção: sempre domínio oficial.
  if (isProductionHost(host)) return OFFICIAL_PUBLIC_URL;
  // Preview / dev: mantém origin para que o link de teste continue válido.
  if (isPreviewLikeHost(host)) return window.location.origin.replace(/\/+$/, "");
  // Qualquer outro host desconhecido: usa o oficial por segurança.
  return OFFICIAL_PUBLIC_URL;
}

/**
 * Monta uma URL absoluta a partir de um path relativo, usando a base
 * pública canônica.
 */
export function buildPublicUrl(path: string): string {
  const base = getPublicAppUrl();
  if (!path) return base;
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}
