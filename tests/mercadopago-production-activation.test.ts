/**
 * Prompt 4 — Ativação Oficial do Mercado Pago.
 *
 * Este teste valida a logicidade de ambiente para PRODUÇÃO OFICIAL.
 */
import { describe, it, expect } from "vitest";
import {
  resolveMercadoPagoConfig,
  classifyTokenPrefix,
} from "../src/server/mercadopago-config.server";

describe("Mercado Pago - Produção Oficial", () => {
  it("deve aceitar ambiente production com token APP_USR-", () => {
    const env = {
      MERCADO_PAGO_ENVIRONMENT: "production",
      MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "APP_USR-666",
      MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: "whsec_prod",
      MERCADO_PAGO_PRODUCTION_PUBLIC_KEY: "pk_prod",
    };
    const cfg = resolveMercadoPagoConfig(env);
    expect(cfg.ok).toBe(true);
    expect(cfg.environment).toBe("production");
    expect(cfg.siteBaseUrl).toBe("https://gastointeligente.com.br");
    expect(cfg.allowNewCheckouts).toBe(true);
  });

  it("deve rejeitar ambiente production se a base URL for de preview", () => {
    const env = {
      MERCADO_PAGO_ENVIRONMENT: "production",
      MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "APP_USR-666",
      MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: "whsec_prod",
      MERCADO_PAGO_PRODUCTION_BASE_URL: "https://id-preview--5de62d63.lovable.app",
    };
    const cfg = resolveMercadoPagoConfig(env);
    expect(cfg.ok).toBe(false);
    expect(cfg.state).toBe("unresolved_environment");
    expect(cfg.diagnostics).toContain(
      "URL de produção configurada para preview/localhost — BLOQUEADO por segurança",
    );
  });

  it("deve rejeitar token TEST- em ambiente production", () => {
    const env = {
      MERCADO_PAGO_ENVIRONMENT: "production",
      MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "TEST-should-fail",
      MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: "whsec_prod",
    };
    const cfg = resolveMercadoPagoConfig(env);
    expect(cfg.ok).toBe(false);
    expect(cfg.state).toBe("credential_environment_mismatch");
  });

  it("deve usar o domínio oficial se MERCADO_PAGO_PRODUCTION_BASE_URL estiver ausente", () => {
    const env = {
      MERCADO_PAGO_ENVIRONMENT: "production",
      MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "APP_USR-666",
      MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: "whsec_prod",
    };
    const cfg = resolveMercadoPagoConfig(env);
    expect(cfg.siteBaseUrl).toBe("https://gastointeligente.com.br");
    expect(cfg.notificationUrl).toBe(
      "https://gastointeligente.com.br/api/public/webhooks/mercadopago",
    );
  });
});
