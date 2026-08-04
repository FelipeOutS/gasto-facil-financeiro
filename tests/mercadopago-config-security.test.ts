import { describe, it, expect, vi } from "vitest";
import {
  resolveMercadoPagoConfig,
  classifyTokenPrefix,
  type MpResolvedConfig,
} from "../src/server/mercadopago-config.server";

describe("Mercado Pago Config - Fail-Closed & Cross-Environment Blocking", () => {
  it("should classify token prefixes correctly", () => {
    expect(classifyTokenPrefix("APP_USR-123")).toBe("production");
    expect(classifyTokenPrefix("TEST-123")).toBe("sandbox");
    expect(classifyTokenPrefix("OTHER-123")).toBe("unknown");
    expect(classifyTokenPrefix("")).toBe("unknown");
  });

  it("should fail-closed if MERCADO_PAGO_ENVIRONMENT is invalid", () => {
    const env = { MERCADO_PAGO_ENVIRONMENT: "invalid" };
    const cfg = resolveMercadoPagoConfig(env);
    expect(cfg.ok).toBe(false);
    expect(cfg.state).toBe("unresolved_environment");
    expect(cfg.allowNewCheckouts).toBe(false);
  });

  it("should block production environment with sandbox token", () => {
    const env = {
      MERCADO_PAGO_ENVIRONMENT: "production",
      MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "TEST-should-fail",
      MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: "secret",
    };
    const cfg = resolveMercadoPagoConfig(env);
    expect(cfg.ok).toBe(false);
    expect(cfg.state).toBe("credential_environment_mismatch");
    expect(cfg.diagnostics).toContain(
      "Token de produção com prefixo de teste (TEST-) — BLOQUEIO CRUZADO",
    );
  });

  it("should allow sandbox environment with APP_USR- token (Prompt 4A.1)", () => {
    const env = {
      MERCADO_PAGO_ENVIRONMENT: "sandbox",
      MERCADO_PAGO_SANDBOX_ACCESS_TOKEN: "APP_USR-test-token",
      MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET: "secret",
      MERCADO_PAGO_SANDBOX_PUBLIC_KEY: "pk",
      MERCADO_PAGO_SANDBOX_BASE_URL: "https://preview.lovable.app",
    };
    const cfg = resolveMercadoPagoConfig(env);
    expect(cfg.ok).toBe(true);
    expect(cfg.environment).toBe("sandbox");
    expect(cfg.accessToken).toBe("APP_USR-test-token");
  });

  it("should still block production environment with TEST- token", () => {
    const env = {
      MERCADO_PAGO_ENVIRONMENT: "production",
      MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "TEST-should-fail",
      MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: "secret",
    };
    const cfg = resolveMercadoPagoConfig(env);
    expect(cfg.ok).toBe(false);
    expect(cfg.state).toBe("credential_environment_mismatch");
  });

  it("should block production with preview URL", () => {
    const env = {
      MERCADO_PAGO_ENVIRONMENT: "production",
      MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "APP_USR-valid",
      MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: "secret",
      MERCADO_PAGO_PRODUCTION_BASE_URL: "https://something.lovable.app",
    };
    const cfg = resolveMercadoPagoConfig(env);
    expect(cfg.ok).toBe(false);
    expect(cfg.state).toBe("unresolved_environment");
    expect(cfg.diagnostics).toContain(
      "URL de produção configurada para preview/localhost — BLOQUEADO por segurança",
    );
  });

  it("should allow sandbox with preview URL", () => {
    const env = {
      MERCADO_PAGO_ENVIRONMENT: "sandbox",
      MERCADO_PAGO_SANDBOX_ACCESS_TOKEN: "TEST-valid",
      MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET: "secret",
      MERCADO_PAGO_SANDBOX_PUBLIC_KEY: "pk",
      MERCADO_PAGO_SANDBOX_BASE_URL: "https://preview.lovable.app",
    };
    const cfg = resolveMercadoPagoConfig(env);
    expect(cfg.ok).toBe(true);
    expect(cfg.environment).toBe("sandbox");
    expect(cfg.siteBaseUrl).toBe("https://preview.lovable.app");
  });

  it("should block sandbox if MERCADO_PAGO_SANDBOX_BASE_URL is missing", () => {
    const env = {
      MERCADO_PAGO_ENVIRONMENT: "sandbox",
      MERCADO_PAGO_SANDBOX_ACCESS_TOKEN: "TEST-valid",
      MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET: "secret",
      MERCADO_PAGO_SANDBOX_PUBLIC_KEY: "pk",
      // missing BASE_URL
    };
    const cfg = resolveMercadoPagoConfig(env);
    expect(cfg.ok).toBe(false);
    expect(cfg.state).toBe("missing_sandbox_base_url");
  });
});
