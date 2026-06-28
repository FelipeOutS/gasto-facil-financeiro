/**
 * WA-C10.a.1 — Política de segredo do fingerprint de boleto.
 *
 * Produção: exige WHATSAPP_BOLETO_FINGERPRINT_SECRET. Ausência → erro.
 * Dev/test: aceita override por env ou por __setBoletoPepperForTest().
 *           Sem env, usa pepper marcado como dev-only (jamais em prod).
 *
 * O pepper NUNCA é logado.
 */

const DEV_ONLY_PEPPER = "dev-only-wa-c10a-fp";

export class BoletoSecretMissingError extends Error {
  code = "WA_BOLETO_SECRET_MISSING" as const;
  constructor() {
    super("WHATSAPP_BOLETO_FINGERPRINT_SECRET ausente em produção");
  }
}

let cached: string | null = null;
let testOverride: string | null = null;
let devWarned = false;

function isProduction(): boolean {
  return (process.env.NODE_ENV ?? "").toLowerCase() === "production";
}

export function getBoletoFingerprintPepper(): string {
  if (testOverride) return testOverride;
  if (cached) return cached;
  const fromEnv = process.env.WHATSAPP_BOLETO_FINGERPRINT_SECRET;
  if (fromEnv && fromEnv.length > 0) {
    cached = fromEnv;
    return cached;
  }
  if (isProduction()) {
    // Log seguro — nunca inclui o valor (não há valor a logar).
    console.error({ event: "wa_boleto_secret_missing" });
    throw new BoletoSecretMissingError();
  }
  if (!devWarned) {
    devWarned = true;
    console.warn({ event: "wa_boleto_secret_dev_fallback" });
  }
  return DEV_ONLY_PEPPER;
}

// ---------- Helpers para testes ----------

export function __setBoletoPepperForTest(value: string | null): void {
  testOverride = value;
  cached = null;
  devWarned = false;
}

export function __resetBoletoPepperCacheForTest(): void {
  cached = null;
  devWarned = false;
}
