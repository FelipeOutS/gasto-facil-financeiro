/**
 * Prompt 4A — Suíte estrutural do Mercado Pago (12 cenários).
 *
 * IMPORTANTE: nenhum teste chama a API real do Mercado Pago, nenhum teste
 * escreve no banco e nenhum teste ativa plano de usuário real. Tudo aqui é
 * função pura ou mock local.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveMercadoPagoConfig,
  environmentForPersistence,
  checkoutExpiresAt,
  isCheckoutExpired,
  classifyTokenPrefix,
} from "@/server/mercadopago-config.server";
import {
  resolveCatalogOffer,
  catalogPriceCents,
  validateOfferAgainstProvider,
} from "@/server/mercadopago-plan-catalog.server";
import {
  generateOpaqueExternalReference,
  verifyOpaqueExternalReference,
  checkoutRefSecret,
} from "@/server/mercadopago-checkout-session.server";
import {
  verifyMercadoPagoSignature,
  signMercadoPagoManifest,
} from "@/server/mercadopago-webhook-verify.server";
import {
  sanitizeMercadoPagoPayload,
  payloadHash,
  maskIdentifier,
} from "@/server/mercadopago-payload-sanitize.server";
import { classifyHistoricalPayment } from "@/server/mercadopago-reconcile-dryrun.server";
import { resolveEffectivePlan, type Entitlement } from "@/lib/entitlements";

const SANDBOX_ENV = {
  MERCADO_PAGO_ENVIRONMENT: "sandbox",
  MERCADO_PAGO_SANDBOX_ACCESS_TOKEN: "TEST-1234567890",
  MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET: "sandbox_secret",
  MERCADO_PAGO_SANDBOX_PUBLIC_KEY: "TEST-pub",
  MERCADO_PAGO_SANDBOX_BASE_URL: "https://sandbox.gastointeligente.com.br",
};

const PROD_ENV = {
  MERCADO_PAGO_ENVIRONMENT: "production",
  MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "APP_USR-abcdef",
  MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: "prod_secret",
};

describe("Prompt 4A — Mercado Pago: cenários estruturais", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.MERCADO_PAGO_CHECKOUT_REF_SECRET = "ref_secret_de_teste";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // 1
  it("1) checkout válido: oferta resolvida server-side com preço do catálogo", () => {
    const r = resolveCatalogOffer({ planKey: "pessoal_premium", periodicity: "mensal" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.offer.amountCents).toBe(catalogPriceCents("pessoal_premium", "mensal"));
    expect(r.offer.currency).toBe("BRL");
    expect(r.offer.months).toBe(1);
  });

  // 2
  it("2) plano inválido / indisponível é rejeitado antes de qualquer cobrança", () => {
    expect(resolveCatalogOffer({ planKey: "plano_pirata", periodicity: "mensal" })).toEqual({
      ok: false,
      error: "invalid_plan",
    });
    expect(resolveCatalogOffer({ planKey: "pessoal_premium", periodicity: "decenal" })).toEqual({
      ok: false,
      error: "invalid_period",
    });
    const legacy = resolveCatalogOffer({ planKey: "free", periodicity: "mensal" });
    expect(legacy.ok).toBe(false);
  });

  // 3
  it("3) tentativa de manipular preço no cliente não altera o valor cobrado", () => {
    const attacker = { planKey: "empresa", periodicity: "anual", amountCents: 1 };
    const official = resolveCatalogOffer({
      planKey: attacker.planKey,
      periodicity: attacker.periodicity,
    });
    expect(official.ok).toBe(true);
    if (!official.ok) return;
    expect(official.offer.amountCents).not.toBe(attacker.amountCents);
    const check = validateOfferAgainstProvider({
      expected: {
        planKey: official.offer.planKey,
        periodicity: official.offer.periodicity,
        amountCents: official.offer.amountCents,
        currency: "BRL",
      },
      provider: { amountCents: 1, currency: "BRL" },
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.mismatches).toContain("amount_mismatch");
  });

  // 4
  it("4) external_reference opaca é verificável e referência forjada é rejeitada", () => {
    const secret = checkoutRefSecret()!;
    expect(secret).toBeTruthy();
    const ref = generateOpaqueExternalReference(secret);
    expect(verifyOpaqueExternalReference(ref, secret)).toBe(true);
    // Formato legado adivinhável (user:plano:periodicidade) é inválido.
    expect(
      verifyOpaqueExternalReference("11111111-1111-1111-1111-111111111111:empresa:anual", secret),
    ).toBe(false);
    // Checksum alterado
    const tampered = `${ref.slice(0, -1)}${ref.slice(-1) === "A" ? "B" : "A"}`;
    expect(verifyOpaqueExternalReference(tampered, secret)).toBe(false);
    // Secret diferente (outro ambiente/atacante)
    expect(verifyOpaqueExternalReference(ref, "outro_secret")).toBe(false);
  });

  // 5
  it("5) webhook com assinatura válida é aceito", () => {
    const ts = String(Date.now());
    const header = signMercadoPagoManifest({
      dataId: "123456",
      requestId: "req-1",
      ts,
      secret: "sandbox_secret",
    });
    const v = verifyMercadoPagoSignature({
      signatureHeader: header,
      requestId: "req-1",
      dataId: "123456",
      secret: "sandbox_secret",
    });
    expect(v.ok).toBe(true);
  });

  // 6
  it("6) webhook com assinatura inválida/ausente é rejeitado sem tocar o negócio", () => {
    const ts = String(Date.now());
    const base = {
      requestId: "req-1",
      dataId: "123456",
      secret: "sandbox_secret",
    };
    expect(verifyMercadoPagoSignature({ ...base, signatureHeader: null }).ok).toBe(false);
    expect(
      verifyMercadoPagoSignature({ ...base, signatureHeader: `ts=${ts},v1=deadbeef` }).ok,
    ).toBe(false);
    expect(
      verifyMercadoPagoSignature({ ...base, signatureHeader: `v1=abcd` }).reason,
    ).toBe("missing_timestamp");
    const good = signMercadoPagoManifest({ ...base, ts });
    // request-id divergente muda o manifesto ⇒ inválido
    expect(
      verifyMercadoPagoSignature({ ...base, requestId: "req-2", signatureHeader: good }).ok,
    ).toBe(false);
    // secret de outro ambiente ⇒ inválido
    expect(
      verifyMercadoPagoSignature({ ...base, secret: "prod_secret", signatureHeader: good }).ok,
    ).toBe(false);
  });

  // 7
  it("7) replay antigo é rejeitado por janela de timestamp", () => {
    const oldTs = String(Date.now() - 2 * 60 * 60 * 1000);
    const header = signMercadoPagoManifest({
      dataId: "123456",
      requestId: "req-1",
      ts: oldTs,
      secret: "sandbox_secret",
    });
    const v = verifyMercadoPagoSignature({
      signatureHeader: header,
      requestId: "req-1",
      dataId: "123456",
      secret: "sandbox_secret",
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("timestamp_too_old");
  });

  // 8
  it("8) ambiente é fail-closed: sandbox sem credencial não permite novos checkouts", () => {
    const empty = resolveMercadoPagoConfig({ MERCADO_PAGO_ENVIRONMENT: "sandbox" });
    expect(empty.allowNewCheckouts).toBe(false);
    expect(empty.accessToken).toBeNull();
    expect(JSON.stringify(empty.diagnostics)).not.toContain("TEST-");

    const sandbox = resolveMercadoPagoConfig(SANDBOX_ENV);
    expect(sandbox.allowNewCheckouts).toBe(true);
    expect(sandbox.environment).toBe("sandbox");
    expect(environmentForPersistence(sandbox)).toBe("sandbox");
    expect(sandbox.notificationUrl).toContain("/api/public/webhooks/mercadopago");

    // Credencial de produção declarada como sandbox ⇒ bloqueio.
    const mismatch = resolveMercadoPagoConfig({
      ...SANDBOX_ENV,
      MERCADO_PAGO_SANDBOX_ACCESS_TOKEN: "APP_USR-producao",
    });
    expect(mismatch.allowNewCheckouts).toBe(false);
    expect(mismatch.state).toBe("credential_environment_mismatch");
    expect(classifyTokenPrefix("APP_USR-producao")).not.toBe(classifyTokenPrefix("TEST-abc"));
  });

  // 9
  it("9) produção continua funcionando no modo legado, mas isolada do sandbox", () => {
    const prod = resolveMercadoPagoConfig(PROD_ENV);
    expect(prod.allowNewCheckouts).toBe(true);
    expect(prod.environment).toBe("production");
    expect(prod.accessToken).toBe("APP_USR-abcdef");
    const sandbox = resolveMercadoPagoConfig(SANDBOX_ENV);
    expect(sandbox.accessToken).not.toBe(prod.accessToken);
    expect(sandbox.webhookSecret).not.toBe(prod.webhookSecret);
  });

  // 10
  it("10) expiração de checkout é calculada no servidor e detectada depois", () => {
    const cfg = resolveMercadoPagoConfig(SANDBOX_ENV);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const exp = checkoutExpiresAt(cfg, now);
    expect(exp.getTime()).toBeGreaterThan(now.getTime());
    expect(isCheckoutExpired(exp, now)).toBe(false);
    expect(isCheckoutExpired(exp, new Date(exp.getTime() + 1000))).toBe(true);
  });

  // 11
  it("11) payload persistido é sanitizado (sem PII, cartão ou token) e auditável por hash", () => {
    const raw = {
      id: 99,
      status: "approved",
      transaction_amount: 29.9,
      currency_id: "BRL",
      payer: { email: "cliente@example.com", identification: { number: "12345678900" } },
      card: { last_four_digits: "1234", cardholder: { name: "CLIENTE" } },
      token: "card_token_abc",
      metadata: { secret: "nope" },
    };
    const safe = sanitizeMercadoPagoPayload(raw);
    const asText = JSON.stringify(safe);
    for (const forbidden of ["cliente@example.com", "12345678900", "1234", "card_token_abc"]) {
      expect(asText).not.toContain(forbidden);
    }
    expect(safe).toMatchObject({ id: 99, status: "approved", currency_id: "BRL" });
    expect(payloadHash(JSON.stringify(raw))).toMatch(/^[0-9a-f]{64}$/);
    expect(maskIdentifier("1234567890abcdef")).toBe("1234***cdef");
  });

  // 12
  it("12) reconciliação dry-run classifica sem escrever, e entitlement é neutro de origem", () => {
    const legacy = classifyHistoricalPayment(
      {
        id: "p1",
        user_id: "u1",
        plano: "pessoal_premium",
        amount_cents: 2990,
        currency: "BRL",
        method: "pix",
        status: "approved",
        provider_payment_id: "mp1",
        environment: null,
        purchase_origin: null,
      },
      null,
    );
    expect(legacy.classification).toBe("LEGADO");

    const divergent = classifyHistoricalPayment(
      {
        id: "p2",
        user_id: "u1",
        plano: "pessoal_premium",
        amount_cents: 2990,
        currency: "BRL",
        method: "pix",
        status: "pending",
        provider_payment_id: "mp2",
        environment: "production",
        purchase_origin: "mercado_pago_web",
        checkout_session_id: "s2",
      },
      { id: "mp2", status: "approved", transaction_amount: 29.9, currency_id: "BRL" },
    );
    expect(divergent.classification).toBe("DIVERGENTE");

    const incomplete = classifyHistoricalPayment(
      {
        id: "p3",
        user_id: "u1",
        plano: null,
        amount_cents: null,
        currency: null,
        method: "card",
        status: "pending",
        provider_payment_id: null,
      },
      null,
    );
    expect(incomplete.classification).toBe("INCOMPLETO");

    // Entitlement: mesma decisão para qualquer origem de compra.
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const mp: Entitlement[] = [
      { origin: "mercado_pago_web", planKey: "pessoal_premium", state: "active", validUntil: future },
    ];
    const apple: Entitlement[] = [
      { origin: "apple_app_store", planKey: "pessoal_premium", state: "active", validUntil: future },
    ];
    expect(resolveEffectivePlan(mp).planKey).toBe(resolveEffectivePlan(apple).planKey);
    // Sem entitlement vivo ⇒ free_ads (tier padrão do projeto).
    expect(resolveEffectivePlan([]).planKey).toBe("free_ads");
    // admin_master nunca é rebaixado por evento de pagamento.
    expect(
      resolveEffectivePlan(
        [{ origin: "mercado_pago_web", planKey: "free_ads", state: "expired", validUntil: null }],
        { isAdminMaster: true },
      ).planKey,
    ).toBe("admin_master");
    // Cancelamento agendado mantém acesso até o fim do período pago.
    expect(
      resolveEffectivePlan([
        {
          origin: "mercado_pago_web",
          planKey: "empresa",
          state: "cancelled_scheduled",
          validUntil: future,
        },
      ]).planKey,
    ).toBe("empresa");
  });
});
