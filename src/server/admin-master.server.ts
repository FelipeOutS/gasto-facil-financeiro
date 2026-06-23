/**
 * src/server/admin-master.server.ts
 *
 * Fonte ÚNICA de verdade server-side para os e-mails de Admin Master.
 *
 * Regras:
 *  - Lista pode ser configurada via env `ADMIN_MASTER_EMAILS`
 *    (separada por vírgula). Casos vazios/só com espaços são ignorados.
 *  - Se a env estiver ausente OU inválida, cai para o conjunto default
 *    embutido — fail-safe (não derruba bypass legítimo em produção),
 *    nunca abre acesso para terceiros.
 *  - Comparação é case-insensitive e ignora espaços ao redor.
 *  - NÃO expor a lista para front-end, payloads de webhook, respostas
 *    HTTP públicas, logs públicos ou mensagens do WhatsApp.
 *  - NUNCA usar e-mail vindo de payload externo (WhatsApp, requisição
 *    do cliente etc.) como prova de privilégio: o e-mail só pode vir do
 *    Supabase Auth (server-side trust boundary).
 *
 * Este módulo é estritamente server-side. Importações de código de
 * cliente devem usar `src/lib/plans.ts` (`isAdminMasterEmail`), que é o
 * espelho informacional para UI — a autorização real continua aqui.
 */

const DEFAULT_ADMIN_MASTER_EMAILS = [
  "felipe.out.silva@outlook.com",
  "michael@medeiroscenografia.com.br",
] as const;

function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  // Validação mínima: precisa ter um "@" e algo dos dois lados.
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
let cachedSource: "env" | "default" | null = null;

function resolveList(): { list: ReadonlyArray<string>; source: "env" | "default" } {
  if (cachedList) return { list: cachedList, source: cachedSource ?? "default" };
  const envList = parseEnvList(process.env.ADMIN_MASTER_EMAILS);
  if (envList.length > 0) {
    cachedList = Object.freeze(Array.from(new Set(envList)));
    cachedSource = "env";
  } else {
    cachedList = Object.freeze(
      Array.from(new Set(DEFAULT_ADMIN_MASTER_EMAILS.map((e) => e.toLowerCase()))),
    );
    cachedSource = "default";
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
}

/** Retorna a lista normalizada (lowercase, sem duplicatas). Apenas server-side. */
export function getAdminMasterEmails(): string[] {
  return Array.from(resolveList().list);
}

/** Identifica a origem efetiva da lista (`"env"` ou `"default"`). Útil em logs internos. */
export function getAdminMasterSource(): "env" | "default" {
  return resolveList().source;
}

/**
 * Retorna `true` se o e-mail informado pertence a um Admin Master.
 * Comparação case-insensitive e tolerante a espaços. `null`/`undefined`/
 * string vazia retorna `false`.
 */
export function isAdminMasterEmail(email?: string | null): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return resolveList().list.includes(normalized);
}
