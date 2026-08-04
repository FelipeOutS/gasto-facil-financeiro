/**
 * WA-C9.2 Fase D.2B.2 — Wiring operacional do transport Meta atrás da dupla trava.
 *
 * SERVER-ONLY. Este módulo é o ÚNICO ponto autorizado a costurar:
 *   isOutboundHttpAllowed  →  MetaWhatsAppNotificationTransport (factory)
 *                           →  executeNotificationAttemptDryTechnical (D.1 + D.2A)
 *
 * Fase D.2B.2: SEM ATIVAÇÃO. A dupla trava (`WHATSAPP_ENABLED`,
 * `WHATSAPP_CANARY_ENABLED`, `WHATSAPP_DISPATCH_ENABLED`,
 * `WHATSAPP_OUTBOUND_HTTP_ENABLED`) permanece OFF em produção. O caller
 * (dispatcher) só chega aqui quando o operador ligar EXPLICITAMENTE todas as
 * flags. Enquanto isso, o retorno esperado é `{ kind: "gated", reasons }`.
 *
 * Regras invioláveis:
 *   - Nenhum fetch é disparado quando o gate nega.
 *   - Nenhum token/telefone é logado. Nenhum payload bruto sai daqui.
 *   - Recipient é lido de `whatsapp_links` (fonte canônica); nunca do payload
 *     da notificação.
 *   - Template completo é lido com `payload_schema` + `language` para permitir
 *     render determinístico.
 *   - Toda dependência externa é injetável para permitir testes 100% sem rede.
 */
import type { NotificationRow } from "@/server/whatsapp-notifications.server";
import {
  type ExecuteInput,
  type ExecuteResult,
  type NotificationTemplateRow,
  type SupabaseLike,
  executeNotificationAttemptDryTechnical,
} from "@/server/whatsapp-outbound-adapter.server";
import {
  type MetaTransportFactoryInput,
  type MetaTransportFactoryResult,
  createMetaWhatsAppNotificationTransport,
} from "@/server/whatsapp-meta-transport.server";
import {
  type OutboundGateReason,
  type OutboundGateResult,
  isOutboundHttpAllowed,
} from "@/server/whatsapp-outbound-gates.server";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos

export type RunOutboundOutcome =
  | { kind: "gated"; reasons: OutboundGateReason[] }
  | { kind: "no_recipient" }
  | { kind: "no_template" }
  | { kind: "transport_unavailable"; reason: string }
  | { kind: "executed"; result: ExecuteResult };

export interface RunOutboundDeps {
  /** Cliente Supabase (default: supabaseAdmin, lazy). */
  supabaseClient?: SupabaseLike;
  /** Gate override (default: isOutboundHttpAllowed). */
  gate?: (userId: string) => OutboundGateResult;
  /** Factory override do transport Meta (default: createMetaWhatsAppNotificationTransport). */
  transportFactory?: (input?: MetaTransportFactoryInput) => MetaTransportFactoryResult;
  /** Carregador de recipient (default: leitura de `whatsapp_links`). */
  loadRecipient?: (userId: string, client: SupabaseLike) => Promise<string | null>;
  /** Carregador de template completo (default: `whatsapp_notification_templates`). */
  loadTemplate?: (key: string, client: SupabaseLike) => Promise<NotificationTemplateRow | null>;
  /** phoneNumberId override para testes; em produção lê do env via factory. */
  phoneNumberId?: string;
  /** Executor D.1/D.2A injetável (default: executeNotificationAttemptDryTechnical). */
  execute?: typeof executeNotificationAttemptDryTechnical;
  /** Relógio determinístico para testes. */
  now?: () => Date;
  /** Logger injetável (default: console.log JSON). */
  logger?: (entry: Record<string, unknown>) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults

async function defaultClient(): Promise<SupabaseLike> {
  const mod = await import("@/integrations/supabase/client.server");
  return mod.supabaseAdmin as unknown as SupabaseLike;
}

async function defaultLoadRecipient(userId: string, client: SupabaseLike): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = client as any;
  const { data } = await c
    .from("whatsapp_links")
    .select("telefone, ativo, opt_in_em, revogado_em")
    .eq("user_id", userId)
    .eq("ativo", true)
    .order("opt_in_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    telefone: string | null;
    ativo: boolean;
    opt_in_em: string | null;
    revogado_em: string | null;
  };
  if (!row.ativo || row.revogado_em || !row.opt_in_em) return null;
  return row.telefone ?? null;
}

/**
 * WA-C9.2 Fase E.3A — Loader corrigido.
 *
 * Regressão observada em produção: a query anterior selecionava a coluna
 * `language`, que NÃO existe em `whatsapp_notification_templates`. O
 * PostgREST retornava `error` + `data=null` e o dispatcher classificava
 * como `no_template`, revertendo a notification para `pending` sem tocar
 * o transport.
 *
 * Correção mínima: selecionar apenas colunas reais do schema. O idioma
 * continua sendo resolvido por `resolveTemplateLanguage` a partir de
 * `payload_schema.language` (fallback `pt_BR`).
 *
 * Erros reais de query são logados de forma sanitizada (apenas mensagem
 * e código) e retornam `null` — fail-closed — sem expor SQL, credenciais
 * ou payload.
 */
export async function defaultLoadTemplate(
  key: string,
  client: SupabaseLike,
): Promise<NotificationTemplateRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = client as any;
  const { data, error } = await c
    .from("whatsapp_notification_templates")
    .select(
      "key, category, meta_template_name, payload_schema, active, requires_template_window, default_priority",
    )
    .eq("key", key)
    .maybeSingle();
  if (error) {
    try {
      console.log(
        JSON.stringify({
          module: "wa-dispatcher-outbound",
          event: "template_query_error",
          key,
          code: (error as { code?: unknown })?.code ?? null,
          message: (error as { message?: unknown })?.message ?? null,
        }),
      );
    } catch {
      // no-op
    }
    return null;
  }
  if (!data) return null;
  return data as NotificationTemplateRow;
}

function log(logger: RunOutboundDeps["logger"], entry: Record<string, unknown>): void {
  const fn =
    logger ??
    ((e: Record<string, unknown>) => {
      try {
        console.log(JSON.stringify({ module: "wa-dispatcher-outbound", ...e }));
      } catch {
        // no-op
      }
    });
  try {
    fn({ module: "wa-dispatcher-outbound", ...entry });
  } catch {
    // no-op
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orquestrador único

/**
 * Executa o envio de UMA notificação atrás da dupla trava.
 *
 * Pré-condição: caller já fez claim atômico com `claim_token` válido e
 * `notification.status = 'processing'`. Este orquestrador NÃO manipula
 * `notification.status`; delega para o adapter/RPCs atômicas.
 *
 * Retornos:
 *  - `gated`: gate negou. Nenhum fetch, nenhuma tentativa criada. Caller deve
 *    reverter a notificação para `pending`.
 *  - `no_recipient` / `no_template`: dados de suporte ausentes. Caller decide
 *    (reverter ou marcar skipped).
 *  - `transport_unavailable`: factory falhou (não deveria acontecer se o gate
 *    passou; defesa em profundidade).
 *  - `executed`: adapter foi chamado; `result` carrega o veredito autoritativo.
 */
export async function runOutboundForNotification(
  notification: Pick<NotificationRow, "id" | "user_id" | "notification_type" | "payload">,
  claimToken: string,
  deps: RunOutboundDeps = {},
): Promise<RunOutboundOutcome> {
  const gateFn = deps.gate ?? ((userId: string) => isOutboundHttpAllowed({ userId }));
  const gate = gateFn(notification.user_id);
  if (!gate.allowed) {
    log(deps.logger, {
      event: "outbound_gated",
      notification_id: notification.id,
      reasons: gate.reasons,
    });
    return { kind: "gated", reasons: gate.reasons };
  }

  const client = deps.supabaseClient ?? (await defaultClient());
  const loadRecipient = deps.loadRecipient ?? defaultLoadRecipient;
  const loadTemplate = deps.loadTemplate ?? defaultLoadTemplate;

  const recipient = await loadRecipient(notification.user_id, client);
  if (!recipient || recipient.trim() === "") {
    log(deps.logger, { event: "no_recipient", notification_id: notification.id });
    return { kind: "no_recipient" };
  }

  const template = await loadTemplate(notification.notification_type, client);
  if (!template || !template.active) {
    log(deps.logger, {
      event: "no_template",
      notification_id: notification.id,
      key: notification.notification_type,
    });
    return { kind: "no_template" };
  }

  const factory = deps.transportFactory ?? createMetaWhatsAppNotificationTransport;
  const factoryInput: MetaTransportFactoryInput = {};
  if (deps.phoneNumberId !== undefined) factoryInput.phoneNumberId = deps.phoneNumberId;
  const built = factory(factoryInput);
  if (!built.ok) {
    log(deps.logger, {
      event: "transport_unavailable",
      notification_id: notification.id,
      reason: built.reason,
    });
    return { kind: "transport_unavailable", reason: built.reason };
  }

  // phoneNumberId para o payload Meta: preferimos o override injetado; caso
  // ausente, lemos do env — a factory já validou digits-only quando não veio
  // via input.
  const phoneNumberId = deps.phoneNumberId ?? String(process.env.WHATSAPP_PHONE_NUMBER_ID ?? "");

  const executeFn = deps.execute ?? executeNotificationAttemptDryTechnical;
  const input: ExecuteInput = {
    notificationId: notification.id,
    claimToken,
    phoneNumberId,
    template,
    payload: notification.payload ?? {},
    recipient,
  };

  const result = await executeFn(input, { client, now: deps.now }, built.transport);

  log(deps.logger, {
    event: "outbound_executed",
    notification_id: notification.id,
    kind: result.kind,
  });

  return { kind: "executed", result };
}
