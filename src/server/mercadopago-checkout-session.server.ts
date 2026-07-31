/**
 * Prompt 4A — Sessão interna de checkout (`payment_checkout_sessions`).
 *
 * Server-only.
 *
 * Substitui a referência externa adivinhável `user.id:plano:periodicidade`
 * por um identificador OPACO, aleatório e verificável (checksum HMAC),
 * persistido no servidor antes de chamar o Mercado Pago.
 *
 * Resolução no webhook (determinística, nunca por usuário isolado):
 *   external_reference opaca → sessão interna → user_id, plano,
 *   periodicidade, preço esperado, moeda, ambiente, origem.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  environmentForPersistence,
  checkoutExpiresAt,
  isCheckoutExpired,
  type MpResolvedConfig,
} from "./mercadopago-config.server";
import type { ResolvedCatalogOffer } from "./mercadopago-plan-catalog.server";

export const CHECKOUT_REF_PREFIX = "gi1";

export type PurchaseOrigin =
  | "mercado_pago_web"
  | "apple_app_store"
  | "google_play"
  | "manual"
  | "admin"
  | "trial"
  | "legacy_unknown";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Secret de assinatura da referência. Nunca é exposto ao cliente. */
export function checkoutRefSecret(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string | null {
  const explicit = env["MERCADO_PAGO_CHECKOUT_REF_SECRET"];
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  // Derivação estável a partir do webhook secret do ambiente resolvido.
  const derived =
    env["MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET"] ??
    env["MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET"] ??
    env["MERCADO_PAGO_WEBHOOK_SECRET"];
  if (typeof derived === "string" && derived.trim()) {
    return createHmac("sha256", derived.trim()).update("checkout_reference_v1").digest("hex");
  }
  return null;
}

function checksum(random: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(random).digest()).slice(0, 16);
}

/** Gera referência opaca: `gi1.<random>.<checksum>`. */
export function generateOpaqueExternalReference(secret: string): string {
  const random = b64url(randomBytes(24));
  return `${CHECKOUT_REF_PREFIX}.${random}.${checksum(random, secret)}`;
}

/** Verifica formato + checksum ANTES de qualquer consulta ao banco. */
export function verifyOpaqueExternalReference(ref: string | null | undefined, secret: string): boolean {
  if (!ref || typeof ref !== "string") return false;
  const parts = ref.split(".");
  if (parts.length !== 3) return false;
  const [prefix, random, sig] = parts;
  if (prefix !== CHECKOUT_REF_PREFIX) return false;
  if (!random || !/^[A-Za-z0-9_-]{16,64}$/.test(random)) return false;
  const expected = Buffer.from(checksum(random, secret));
  const got = Buffer.from(sig ?? "");
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

export interface CheckoutSessionRow {
  id: string;
  user_id: string;
  plan_key: string;
  periodicity: string;
  expected_amount_cents: number;
  currency: string;
  environment: string;
  purchase_origin: string;
  external_reference: string;
  provider_preference_id: string | null;
  provider_payment_id: string | null;
  method: string | null;
  status: string;
  expires_at: string;
  consumed_at: string | null;
}

const SESSION_COLUMNS =
  "id, user_id, plan_key, periodicity, expected_amount_cents, currency, environment, purchase_origin, external_reference, provider_preference_id, provider_payment_id, method, status, expires_at, consumed_at";

/**
 * Cria a intenção de checkout ANTES de chamar o Mercado Pago.
 * Nenhum dado de cartão, nenhum token do provedor é persistido aqui.
 */
export async function createCheckoutSession(input: {
  userId: string;
  offer: ResolvedCatalogOffer;
  method: "pix" | "card";
  config: MpResolvedConfig;
  purchaseOrigin?: PurchaseOrigin;
  now?: Date;
}): Promise<
  | { ok: true; session: CheckoutSessionRow; externalReference: string; expiresAt: Date }
  | { ok: false; error: "ref_secret_missing" | "db_error" }
> {
  const secret = checkoutRefSecret();
  if (!secret) return { ok: false, error: "ref_secret_missing" };
  const externalReference = generateOpaqueExternalReference(secret);
  const expiresAt = checkoutExpiresAt(input.config, input.now ?? new Date());

  const { data, error } = await supabaseAdmin
    .from("payment_checkout_sessions")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert({
      user_id: input.userId,
      plan_key: input.offer.planKey,
      periodicity: input.offer.periodicity,
      expected_amount_cents: input.offer.amountCents,
      currency: input.offer.currency,
      environment: environmentForPersistence(input.config),
      purchase_origin: input.purchaseOrigin ?? "mercado_pago_web",
      external_reference: externalReference,
      provider: "mercado_pago",
      method: input.method,
      status: "created",
      expires_at: expiresAt.toISOString(),
      metadata: {
        months: input.offer.months,
        discount_percent: input.offer.discountPercent,
        plan_name: input.offer.planName,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .select(SESSION_COLUMNS)
    .single();

  if (error || !data) return { ok: false, error: "db_error" };
  return {
    ok: true,
    session: data as unknown as CheckoutSessionRow,
    externalReference,
    expiresAt,
  };
}

/** Vincula os identificadores devolvidos pelo provedor à sessão. */
export async function attachProviderIdsToSession(input: {
  sessionId: string;
  preferenceId?: string | null;
  paymentId?: string | null;
  status?: string;
}): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.preferenceId) patch.provider_preference_id = String(input.preferenceId);
  if (input.paymentId) patch.provider_payment_id = String(input.paymentId);
  if (input.status) patch.status = input.status;
  if (Object.keys(patch).length === 0) return;
  await supabaseAdmin
    .from("payment_checkout_sessions")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(patch as any)
    .eq("id", input.sessionId);
}

export type CheckoutResolutionFailure =
  | "no_reference"
  | "invalid_reference"
  | "ref_secret_missing"
  | "session_not_found"
  | "session_expired"
  | "environment_mismatch";

/**
 * Resolve a sessão de checkout de forma determinística.
 *
 * Ordem de tentativa (todas determinísticas — jamais "qualquer pagamento
 * do mesmo usuário"):
 *   1. external_reference opaca validada por checksum;
 *   2. provider_payment_id;
 *   3. provider_preference_id.
 */
export async function resolveCheckoutSession(input: {
  externalReference?: string | null;
  providerPaymentId?: string | null;
  providerPreferenceId?: string | null;
  environment: "production" | "sandbox";
  now?: Date;
  /** Eventos tardios legítimos podem chegar após a expiração da sessão. */
  allowExpired?: boolean;
}): Promise<
  | { ok: true; session: CheckoutSessionRow; expired: boolean }
  | { ok: false; error: CheckoutResolutionFailure }
> {
  const now = input.now ?? new Date();
  let session: CheckoutSessionRow | null = null;

  if (input.externalReference) {
    const secret = checkoutRefSecret();
    if (!secret) return { ok: false, error: "ref_secret_missing" };
    if (!verifyOpaqueExternalReference(input.externalReference, secret)) {
      return { ok: false, error: "invalid_reference" };
    }
    const { data } = await supabaseAdmin
      .from("payment_checkout_sessions")
      .select(SESSION_COLUMNS)
      .eq("external_reference", input.externalReference)
      .maybeSingle();
    session = (data as unknown as CheckoutSessionRow | null) ?? null;
  }

  if (!session && input.providerPaymentId) {
    const { data } = await supabaseAdmin
      .from("payment_checkout_sessions")
      .select(SESSION_COLUMNS)
      .eq("provider", "mercado_pago")
      .eq("provider_payment_id", String(input.providerPaymentId))
      .maybeSingle();
    session = (data as unknown as CheckoutSessionRow | null) ?? null;
  }

  if (!session && input.providerPreferenceId) {
    const { data } = await supabaseAdmin
      .from("payment_checkout_sessions")
      .select(SESSION_COLUMNS)
      .eq("provider", "mercado_pago")
      .eq("provider_preference_id", String(input.providerPreferenceId))
      .maybeSingle();
    session = (data as unknown as CheckoutSessionRow | null) ?? null;
  }

  if (!session) {
    return { ok: false, error: input.externalReference ? "session_not_found" : "no_reference" };
  }
  if (session.environment !== input.environment) {
    return { ok: false, error: "environment_mismatch" };
  }
  const expired = isCheckoutExpired(session.expires_at, now);
  if (expired && !input.allowExpired) {
    return { ok: false, error: "session_expired" };
  }
  return { ok: true, session, expired };
}

/** Marca a sessão como consumida (idempotente). */
export async function markCheckoutSessionConsumed(sessionId: string, status = "consumed"): Promise<void> {
  await supabaseAdmin
    .from("payment_checkout_sessions")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status, consumed_at: new Date().toISOString() } as any)
    .eq("id", sessionId)
    .is("consumed_at", null);
}
