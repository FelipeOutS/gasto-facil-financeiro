/**
 * META-GRAPH-UPGRADE-01 — Fonte única e validada da versão da Graph API.
 *
 * Este módulo é server-only (`.server.ts`) e por isso é bloqueado do bundle
 * client pela guarda de import do projeto. Ele:
 *  - lê SOMENTE `process.env.WHATSAPP_GRAPH_VERSION` (nenhum fallback,
 *    nenhuma env alternativa);
 *  - valida estruturalmente com `^v[0-9]+\.[0-9]+$`;
 *  - autoriza somente `v20.0` na etapa atual (U-B);
 *  - NÃO executa `trim()` para "salvar" entradas com espaço — espaço é
 *    tratado como valor inválido;
 *  - retorna um discriminado `{ ok: false, reason }` para permitir
 *    comportamento fail-closed nos call sites, sem vazar segredos, sem
 *    imprimir o conjunto de envs e sem lançar exceção.
 *
 * Também expõe `buildWhatsAppGraphUrl(resource)` — um builder fechado que
 * emite apenas URLs `https://graph.facebook.com/<version>/<segmento>` para
 * os recursos hoje efetivamente usados pelo projeto (mensagem operacional,
 * register, subscribed_apps, lookup de mídia, path administrativo já
 * controlado internamente). Nenhum call site pode montar URL literal.
 *
 * Nenhum fetch é executado aqui. Nenhum token é lido. Nenhuma constante
 * global cria efeito colateral em import — a leitura acontece somente em
 * cada chamada de `getWhatsAppGraphVersion`, o que permite que os testes
 * injetem `process.env.WHATSAPP_GRAPH_VERSION` sem contaminar o cofre real.
 */

const VERSION_PATTERN = /^v[0-9]+\.[0-9]+$/;
/** Versão autorizada operacionalmente nesta etapa (U-B). */
export const AUTHORIZED_GRAPH_VERSION = "v20.0" as const;

export type WhatsAppGraphVersionResult =
  | { ok: true; version: typeof AUTHORIZED_GRAPH_VERSION }
  | { ok: false; reason: "missing" | "invalid" | "unsupported" };

/**
 * Retorna a versão validada da Graph API a partir de
 * `process.env.WHATSAPP_GRAPH_VERSION`.
 *
 * Regras (fail-closed):
 *  - variável ausente / string vazia → `missing`;
 *  - formato estrutural inválido (inclui espaços, caixa alta,
 *    números soltos, URL, `latest`, etc.) → `invalid`;
 *  - versão estruturalmente válida porém diferente da autorizada
 *    nesta etapa (ex.: `v25.0`) → `unsupported`.
 *
 * Nunca retorna a versão sem validação. Nunca imprime `process.env`.
 * Nunca lança exceção — o chamador decide como falhar fechado.
 */
export function getWhatsAppGraphVersion(): WhatsAppGraphVersionResult {
  const raw = process.env.WHATSAPP_GRAPH_VERSION;
  if (raw === undefined || raw === null || raw === "") {
    return { ok: false, reason: "missing" };
  }
  if (typeof raw !== "string" || !VERSION_PATTERN.test(raw)) {
    return { ok: false, reason: "invalid" };
  }
  if (raw !== AUTHORIZED_GRAPH_VERSION) {
    return { ok: false, reason: "unsupported" };
  }
  return { ok: true, version: AUTHORIZED_GRAPH_VERSION };
}

/**
 * Union interna dos recursos permitidos hoje. Ampliar somente com
 * necessidade auditada — não aceitar path arbitrário externo.
 */
export type WhatsAppGraphResource =
  | { kind: "messages"; phoneNumberId: string }
  | { kind: "register"; phoneNumberId: string }
  | { kind: "subscribed_apps"; wabaId: string }
  | { kind: "media_lookup"; mediaId: string }
  /**
   * Path administrativo já construído server-side por
   * `whatsapp-admin.functions.ts`. Aceita `me?fields=...`,
   * `${WABA_ID}/message_templates?...`, etc. O path é rejeitado se
   * contiver esquema, host, `..`, começar com `/`, ou incluir
   * caracteres fora do conjunto seguro.
   */
  | { kind: "admin_path"; path: string };

export type WhatsAppGraphUrlResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: "configuration_error" | "invalid_resource";
      /**
       * Motivo estruturado da falha de configuração, sanitizado.
       * Nunca contém token, phone number ID ou lista de envs.
       */
      configReason?: "missing" | "invalid" | "unsupported";
    };

const DIGITS_ONLY = /^[0-9]+$/;
const MEDIA_ID = /^[A-Za-z0-9_-]+$/;
// Path admin: letras, dígitos, ponto, barra, `_`, `-`, `?`, `=`, `&`,
// `%`, `,` e `:`. Rejeita esquemas, hostname, `..`, e caracteres exóticos.
const ADMIN_PATH_SAFE = /^[A-Za-z0-9_./?=&%,:-]+$/;

/**
 * Monta uma URL Graph fechada. Hostname (`graph.facebook.com`) e
 * protocolo (`https`) são fixos. A versão vem exclusivamente do helper
 * validado. Falha fechada quando a versão não é autorizada ou o recurso
 * não passa nas validações estritas.
 */
export function buildWhatsAppGraphUrl(resource: WhatsAppGraphResource): WhatsAppGraphUrlResult {
  const v = getWhatsAppGraphVersion();
  if (!v.ok) {
    return { ok: false, reason: "configuration_error", configReason: v.reason };
  }
  const base = `https://graph.facebook.com/${v.version}`;

  switch (resource.kind) {
    case "messages": {
      if (!DIGITS_ONLY.test(resource.phoneNumberId)) {
        return { ok: false, reason: "invalid_resource" };
      }
      return { ok: true, url: `${base}/${resource.phoneNumberId}/messages` };
    }
    case "register": {
      if (!DIGITS_ONLY.test(resource.phoneNumberId)) {
        return { ok: false, reason: "invalid_resource" };
      }
      return { ok: true, url: `${base}/${resource.phoneNumberId}/register` };
    }
    case "subscribed_apps": {
      if (!DIGITS_ONLY.test(resource.wabaId)) {
        return { ok: false, reason: "invalid_resource" };
      }
      return { ok: true, url: `${base}/${resource.wabaId}/subscribed_apps` };
    }
    case "media_lookup": {
      if (!MEDIA_ID.test(resource.mediaId)) {
        return { ok: false, reason: "invalid_resource" };
      }
      return {
        ok: true,
        url: `${base}/${encodeURIComponent(resource.mediaId)}`,
      };
    }
    case "admin_path": {
      const p = resource.path;
      if (
        typeof p !== "string" ||
        p.length === 0 ||
        p.startsWith("/") ||
        p.includes("..") ||
        p.includes("://") ||
        !ADMIN_PATH_SAFE.test(p)
      ) {
        return { ok: false, reason: "invalid_resource" };
      }
      return { ok: true, url: `${base}/${p}` };
    }
  }
}
