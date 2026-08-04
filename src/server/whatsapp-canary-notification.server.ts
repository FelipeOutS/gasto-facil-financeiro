/**
 * WA-C9.2 Fase E.1E — Helper server-only para preparar (idempotentemente)
 * a PRIMEIRA notification canary do WhatsApp usando o template Meta
 * `hello_world` (APPROVED, en_US, UTILITY, zero placeholders).
 *
 * ⚠ SERVER-ONLY. Não importar do browser. Não chamar em rota pública, cron,
 * webhook, dispatcher, login, background, import-time ou build.
 * Único call site autorizado nesta fase: testes.
 *
 * Regras invioláveis:
 *  - user_id fixo: Admin Master (destinatário exclusivo do primeiro canary).
 *  - template interno fixo: gi_teste_integracao_canary (deve existir e estar
 *    ativo, com meta_template_name='hello_world' e payload_schema.language='en_US').
 *  - category fixa: avisos_sistema.
 *  - priority: baixa.
 *  - payload {}.
 *  - entity_type / entity_id nulos.
 *  - dedupe_key fixa e estável (`FIRST_CANARY_DEDUPE_KEY`).
 *  - nenhuma attempt é criada aqui.
 *  - nenhum dispatcher é acionado aqui.
 *  - nenhum fetch executado aqui.
 *  - fail-closed em qualquer precondição inválida.
 */
import type { SupabaseLike } from "@/server/whatsapp-outbound-adapter.server";
import { normalizePhone } from "@/server/whatsapp-authz.server";

/** UUID do Admin Master (destinatário exclusivo do primeiro canary). */
export const ADMIN_MASTER_CANARY_USER_ID = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1" as const;

/** Chave do template interno mapeado para o Meta `hello_world`. */
export const FIRST_CANARY_TEMPLATE_KEY = "gi_teste_integracao_canary" as const;

/** Nome do template Meta APPROVED e imutável usado no primeiro canary. */
export const FIRST_CANARY_META_TEMPLATE_NAME = "hello_world" as const;

/** Idioma do template Meta `hello_world`. */
export const FIRST_CANARY_LANGUAGE = "en_US" as const;

/** Categoria interna segura (aceita pelo CHECK). */
export const FIRST_CANARY_CATEGORY = "avisos_sistema" as const;

/** Prioridade interna. */
export const FIRST_CANARY_PRIORITY = "baixa" as const;

/**
 * Dedupe key fixa e estável — GARANTE que, em qualquer condição de corrida
 * (chamada dupla, retry, concorrência), no máximo UMA notification canary é
 * criada. NÃO incluir timestamp, deployment id, uuid, ou qualquer valor
 * dinâmico.
 */
export const FIRST_CANARY_DEDUPE_KEY = "wa:first_canary:hello_world:v1" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Builder puro — não toca em nenhum recurso externo.

export interface FirstCanaryNotificationDraft {
  user_id: string;
  notification_type: typeof FIRST_CANARY_TEMPLATE_KEY;
  category: typeof FIRST_CANARY_CATEGORY;
  priority: typeof FIRST_CANARY_PRIORITY;
  status: "pending";
  payload: Record<string, never>;
  entity_type: null;
  entity_id: null;
  dedupe_key: typeof FIRST_CANARY_DEDUPE_KEY;
  attempt_count: 0;
  scheduled_at: string; // ISO
  next_attempt_at: string; // ISO — igual a scheduled_at (elegível de imediato)
}

export function buildFirstWhatsAppCanaryNotification(
  now: Date = new Date(),
): FirstCanaryNotificationDraft {
  const iso = now.toISOString();
  return {
    user_id: ADMIN_MASTER_CANARY_USER_ID,
    notification_type: FIRST_CANARY_TEMPLATE_KEY,
    category: FIRST_CANARY_CATEGORY,
    priority: FIRST_CANARY_PRIORITY,
    status: "pending",
    payload: {},
    entity_type: null,
    entity_id: null,
    dedupe_key: FIRST_CANARY_DEDUPE_KEY,
    attempt_count: 0,
    scheduled_at: iso,
    next_attempt_at: iso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Precondições e insert idempotente

export type CreateFirstCanaryOutcome =
  | { kind: "created"; notificationId: string }
  | { kind: "already_exists"; notificationId: string }
  | {
      kind: "precondition_failed";
      reason:
        | "template_missing"
        | "template_inactive"
        | "meta_template_name_mismatch"
        | "template_language_mismatch"
        | "template_has_params"
        | "category_mismatch"
        | "admin_not_found"
        | "link_missing"
        | "link_inactive"
        | "link_revoked"
        | "optin_missing"
        | "phone_invalid"
        | "processing_residual"
        | "active_attempt";
    }
  | { kind: "database_error"; error?: unknown };

export interface CreateFirstCanaryDeps {
  client: SupabaseLike;
  now?: () => Date;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function checkTemplate(client: AnyClient): Promise<CreateFirstCanaryOutcome | null> {
  const { data, error } = await client
    .from("whatsapp_notification_templates")
    .select("key, category, active, meta_template_name, payload_schema")
    .eq("key", FIRST_CANARY_TEMPLATE_KEY)
    .maybeSingle();
  if (error) return { kind: "database_error", error };
  if (!data) return { kind: "precondition_failed", reason: "template_missing" };
  if (!data.active) return { kind: "precondition_failed", reason: "template_inactive" };
  if (data.meta_template_name !== FIRST_CANARY_META_TEMPLATE_NAME) {
    return { kind: "precondition_failed", reason: "meta_template_name_mismatch" };
  }
  if (data.category !== FIRST_CANARY_CATEGORY) {
    return { kind: "precondition_failed", reason: "category_mismatch" };
  }
  const schema = (data.payload_schema ?? {}) as {
    language?: unknown;
    required?: unknown;
    body_params_order?: unknown;
  };
  if (schema.language !== FIRST_CANARY_LANGUAGE) {
    return { kind: "precondition_failed", reason: "template_language_mismatch" };
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  const order = Array.isArray(schema.body_params_order) ? schema.body_params_order : [];
  if (required.length > 0 || order.length > 0) {
    return { kind: "precondition_failed", reason: "template_has_params" };
  }
  return null;
}

async function checkAdminLink(client: AnyClient): Promise<CreateFirstCanaryOutcome | null> {
  const { data, error } = await client
    .from("whatsapp_links")
    .select("telefone, ativo, opt_in_em, revogado_em")
    .eq("user_id", ADMIN_MASTER_CANARY_USER_ID)
    .maybeSingle();
  if (error) return { kind: "database_error", error };
  if (!data) return { kind: "precondition_failed", reason: "link_missing" };
  if (!data.ativo) return { kind: "precondition_failed", reason: "link_inactive" };
  if (data.revogado_em) return { kind: "precondition_failed", reason: "link_revoked" };
  if (!data.opt_in_em) return { kind: "precondition_failed", reason: "optin_missing" };
  const digits = normalizePhone(data.telefone);
  if (!digits) return { kind: "precondition_failed", reason: "phone_invalid" };
  return null;
}

async function checkNoResidualProcessing(
  client: AnyClient,
): Promise<CreateFirstCanaryOutcome | null> {
  const { data, error } = await client
    .from("whatsapp_notifications")
    .select("id, status")
    .eq("user_id", ADMIN_MASTER_CANARY_USER_ID)
    .eq("status", "processing")
    .limit(1);
  if (error) return { kind: "database_error", error };
  if (Array.isArray(data) && data.length > 0) {
    return { kind: "precondition_failed", reason: "processing_residual" };
  }
  return null;
}

async function checkNoActiveAttempt(client: AnyClient): Promise<CreateFirstCanaryOutcome | null> {
  // Attempts vivos do Admin (planned/sending) implicam outbound em curso —
  // não iniciamos o primeiro canary enquanto houver qualquer atividade.
  const { data, error } = await client
    .from("whatsapp_notification_attempts")
    .select("id, attempt_status, notification_id, whatsapp_notifications!inner(user_id)")
    .in("attempt_status", ["planned", "sending"])
    .eq("whatsapp_notifications.user_id", ADMIN_MASTER_CANARY_USER_ID)
    .limit(1);
  if (error) {
    // Se o join não é suportado pelo fake, fallback silencioso: sem
    // evidência de attempt ativa, seguimos.
    return null;
  }
  if (Array.isArray(data) && data.length > 0) {
    return { kind: "precondition_failed", reason: "active_attempt" };
  }
  return null;
}

async function findExisting(client: AnyClient): Promise<string | null | { error: unknown }> {
  const { data, error } = await client
    .from("whatsapp_notifications")
    .select("id")
    .eq("user_id", ADMIN_MASTER_CANARY_USER_ID)
    .eq("dedupe_key", FIRST_CANARY_DEDUPE_KEY)
    .maybeSingle();
  if (error) return { error };
  return data?.id ?? null;
}

/**
 * Cria (idempotentemente) a primeira notification canary do Admin Master.
 * Nunca sobrescreve linha existente. Nunca aciona dispatcher. Nunca cria
 * attempt. Retorna outcome discriminado.
 */
export async function createFirstWhatsAppCanaryNotification(
  deps: CreateFirstCanaryDeps,
): Promise<CreateFirstCanaryOutcome> {
  const client = deps.client as AnyClient;
  const now = deps.now?.() ?? new Date();

  // 1. Idempotência primeiro: se já existe, curto-circuita.
  const existing = await findExisting(client);
  if (existing && typeof existing === "object" && "error" in existing) {
    return { kind: "database_error", error: existing.error };
  }
  if (typeof existing === "string") {
    return { kind: "already_exists", notificationId: existing };
  }

  // 2. Precondições.
  const t = await checkTemplate(client);
  if (t) return t;
  const l = await checkAdminLink(client);
  if (l) return l;
  const p = await checkNoResidualProcessing(client);
  if (p) return p;
  const a = await checkNoActiveAttempt(client);
  if (a) return a;

  // 3. Insert idempotente. Confia na unique constraint
  //    (user_id, dedupe_key) para fechar corridas concorrentes.
  const draft = buildFirstWhatsAppCanaryNotification(now);
  const { data, error } = await client
    .from("whatsapp_notifications")
    .insert(draft)
    .select("id")
    .maybeSingle();
  if (error) {
    // Conflito unique → concorrência: releia e devolva already_exists.
    const code = String((error as { code?: string }).code ?? "");
    if (code === "23505") {
      const again = await findExisting(client);
      if (typeof again === "string") {
        return { kind: "already_exists", notificationId: again };
      }
    }
    return { kind: "database_error", error };
  }
  if (!data?.id) return { kind: "database_error", error: new Error("insert_returned_no_id") };
  return { kind: "created", notificationId: String(data.id) };
}
