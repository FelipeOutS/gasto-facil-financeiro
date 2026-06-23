/**
 * src/server/admin-master.server.ts
 *
 * Fonte ÚNICA de verdade server-side para os e-mails de Admin Master.
 *
 * Política (WA-B4 — fail-closed real):
 *  - Lista é configurada EXCLUSIVAMENTE via env `ADMIN_MASTER_EMAILS`
 *    (separada por vírgula). NÃO existe fallback compilado de e-mails.
 *  - Se a env estiver ausente, vazia ou inválida:
 *      * `getAdminMasterEmails()` retorna `[]`;
 *      * `isAdminMasterEmail()` retorna `false` para qualquer entrada;
 *      * nenhum bypass administrativo é concedido (fail-closed).
 *  - Comparação é case-insensitive e tolerante a espaços ao redor.
 *  - NÃO expor a lista para front-end, payloads de webhook, respostas
 *    HTTP públicas, logs públicos ou mensagens do WhatsApp.
 *  - NUNCA usar e-mail vindo de payload externo (WhatsApp, requisição
 *    do cliente etc.) como prova de privilégio: o e-mail só pode vir do
 *    Supabase Auth (server-side trust boundary).
 *
 * Quando a configuração estiver ausente/ inválida, registramos UMA vez
 * por processo um evento técnico seguro `admin_master_config_missing`
 * (sem incluir o valor da variável, e-mails ou detalhes do ambiente).
 */

function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const at = trimmed.indexOf("@");
  if (at <= 0 || at >= trimmed.length - 1) return null;
  return trimmed;
}

function parseEnvList(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((part) => normalizeEmail(part))
    .filter((v): v is string => typeof v === "string");
}

let cachedList: ReadonlyArray<string> | null = null;
let cachedSource: "env" | "none" | null = null;
let missingLogged = false;

function logMissingOnce(): void {
  if (missingLogged) return;
  missingLogged = true;
  try {
    // Evento técnico seguro: sem valor da env, sem e-mails, sem detalhes
    // do ambiente. Apenas sinaliza que o bypass está desativado.
    console.warn(
      JSON.stringify({
        event: "admin_master_config_missing",
        message:
          "ADMIN_MASTER_EMAILS ausente ou inválida — bypass de Admin Master desativado (fail-closed).",
      }),
    );
  } catch {
    // logging nunca pode derrubar o caminho crítico
  }
}

function resolveList(): { list: ReadonlyArray<string>; source: "env" | "none" } {
  if (cachedList) return { list: cachedList, source: cachedSource ?? "none" };
  const envList = parseEnvList(process.env.ADMIN_MASTER_EMAILS);
  if (envList.length > 0) {
    cachedList = Object.freeze(Array.from(new Set(envList)));
    cachedSource = "env";
  } else {
    cachedList = Object.freeze([] as string[]);
    cachedSource = "none";
    logMissingOnce();
  }
  return { list: cachedList, source: cachedSource };
}

/**
 * Helper de teste: limpa o cache para permitir re-leitura da env.
 * NÃO usar em código de produção.
 */
export function __resetAdminMasterCacheForTests(): void {
  cachedList = null;
  cachedSource = null;
  missingLogged = false;
}

/** Retorna a lista normalizada (lowercase, sem duplicatas). Apenas server-side. */
export function getAdminMasterEmails(): string[] {
  return Array.from(resolveList().list);
}

/** Origem efetiva da lista (`"env"` quando configurada; `"none"` quando fail-closed). */
export function getAdminMasterSource(): "env" | "none" {
  return resolveList().source;
}

/** `true` se a configuração de Admin Master está presente e válida. */
export function isAdminMasterConfigured(): boolean {
  return resolveList().source === "env";
}

/**
 * Retorna `true` se o e-mail informado pertence a um Admin Master.
 * Comparação case-insensitive e tolerante a espaços. Sem configuração
 * válida, retorna `false` para qualquer entrada (fail-closed).
 */
export function isAdminMasterEmail(email?: string | null): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const { list } = resolveList();
  if (list.length === 0) return false;
  return list.includes(normalized);
}
