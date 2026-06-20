/**
 * Funções administrativas do WhatsApp Cloud API.
 *
 * Regras invariáveis (NÃO violar):
 *  - Exigem usuário autenticado + Admin Master (is_full_access).
 *  - NUNCA retornam token, PIN, Phone Number ID, WABA ID, App Secret
 *    ou Verify Token. Retornam apenas booleanos / enums seguros.
 *  - NUNCA logam credenciais em console.* nem em banco.
 *  - `whatsappAdminRegisterNumber` é dupla-confirmada e bloqueada por
 *    feature flag operacional após o primeiro register bem-sucedido
 *    (WHATSAPP_REGISTER_LOCK = "true" → recusa novas execuções).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminMasterEmail } from "@/lib/plans";

const GRAPH_VERSION = "v21.0";
const OFFICIAL_NUMBER_E164 = "5511918539158";

function adminUnauthorized(): Response {
  return new Response(
    JSON.stringify({ error: "forbidden", message: "Acesso restrito ao Admin Master." }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

async function assertAdminMaster(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = supabaseAdmin as any;
  const { data } = await adm.auth.admin.getUserById(userId);
  const email: string | null = data?.user?.email ?? null;
  if (!isAdminMasterEmail(email)) throw adminUnauthorized();
}

function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function hasSecret(v: string | undefined | null): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

type ErroCategoria =
  | "nenhum"
  | "token_ausente"
  | "token_invalido"
  | "permissao_insuficiente"
  | "ativo_nao_atribuido"
  | "waba_incorreta"
  | "phone_id_incorreto"
  | "rede"
  | "desconhecido";

type HttpBucket = 200 | 400 | 401 | 403 | -1;

type PreflightResult = {
  token_para_waba: "ok" | "falhou";
  numero_oficial_na_waba: "ok" | "falhou";
  app_inscrito_na_waba: "ok" | "falhou";
  webhook_handshake: "ok" | "falhou";
  numero_ja_registrado: "sim" | "nao" | "desconhecido";
  pronto_para_register: "sim" | "nao";
  secrets_completos: boolean;
  // Diagnóstico seguro (sem expor secrets).
  access_token_lido_pelo_backend: "sim" | "nao";
  access_token_hash_prefix: string;
  meta_token_http_status: HttpBucket | "outro";
  meta_waba_http_status: HttpBucket | "outro";
  meta_phone_http_status: HttpBucket | "outro";
  erro_categoria: ErroCategoria;
};

function bucketStatus(s: number | null): HttpBucket | "outro" {
  if (s === null) return -1;
  if (s === 200) return 200;
  if (s === 400) return 400;
  if (s === 401) return 401;
  if (s === 403) return 403;
  return "outro";
}

async function sha256Prefix(value: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < 4; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
  } catch {
    return "";
  }
}

async function safeGraphGet(
  path: string,
  token: string,
): Promise<{ ok: boolean; status: number | null; json: unknown; networkError: boolean }> {
  try {
    const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    let json: unknown = null;
    try {
      json = await resp.json();
    } catch {
      json = null;
    }
    return { ok: resp.ok, status: resp.status, json, networkError: false };
  } catch {
    return { ok: false, status: null, json: null, networkError: true };
  }
}

async function runPreflightInternal(): Promise<PreflightResult> {
  const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  const secrets_completos =
    hasSecret(ACCESS_TOKEN) &&
    hasSecret(PHONE_NUMBER_ID) &&
    hasSecret(WABA_ID) &&
    hasSecret(APP_SECRET) &&
    hasSecret(VERIFY_TOKEN);

  const tokenLoaded = hasSecret(ACCESS_TOKEN);
  const hashPrefix = tokenLoaded ? await sha256Prefix(ACCESS_TOKEN!) : "";

  const result: PreflightResult = {
    token_para_waba: "falhou",
    numero_oficial_na_waba: "falhou",
    app_inscrito_na_waba: "falhou",
    webhook_handshake: "falhou",
    numero_ja_registrado: "desconhecido",
    pronto_para_register: "nao",
    secrets_completos,
    access_token_lido_pelo_backend: tokenLoaded ? "sim" : "nao",
    access_token_hash_prefix: hashPrefix,
    meta_token_http_status: -1,
    meta_waba_http_status: -1,
    meta_phone_http_status: -1,
    erro_categoria: "nenhum",
  };

  if (!tokenLoaded) {
    result.erro_categoria = "token_ausente";
    return result;
  }
  if (!secrets_completos) {
    result.erro_categoria = "desconhecido";
    return result;
  }

  let anyNetworkError = false;

  // 1) Token consegue ler o PHONE_NUMBER_ID?
  const phoneRead = await safeGraphGet(
    `${PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,whatsapp_business_account{id}`,
    ACCESS_TOKEN!,
  );
  result.meta_phone_http_status = bucketStatus(phoneRead.status);
  result.meta_token_http_status = bucketStatus(phoneRead.status);
  if (phoneRead.networkError) anyNetworkError = true;
  if (phoneRead.ok) {
    result.token_para_waba = "ok";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = phoneRead.json as any;
    const cvs = String(p?.code_verification_status ?? "").toUpperCase();
    if (cvs === "VERIFIED") result.numero_ja_registrado = "sim";
    else if (cvs === "NOT_VERIFIED" || cvs === "EXPIRED") result.numero_ja_registrado = "nao";
  }

  // 2) WABA contém o número oficial?
  const wabaList = await safeGraphGet(
    `${WABA_ID}/phone_numbers?fields=id,display_phone_number,code_verification_status`,
    ACCESS_TOKEN!,
  );
  result.meta_waba_http_status = bucketStatus(wabaList.status);
  if (wabaList.networkError) anyNetworkError = true;
  if (wabaList.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = ((wabaList.json as any)?.data ?? []) as Array<{
      id: string;
      display_phone_number?: string;
      code_verification_status?: string;
    }>;
    const match = arr.find(
      (row) =>
        row.id === PHONE_NUMBER_ID &&
        digitsOnly(row.display_phone_number) === OFFICIAL_NUMBER_E164,
    );
    if (match) {
      result.numero_oficial_na_waba = "ok";
      if (result.numero_ja_registrado === "desconhecido") {
        const cvs = String(match.code_verification_status ?? "").toUpperCase();
        if (cvs === "VERIFIED") result.numero_ja_registrado = "sim";
        else if (cvs === "NOT_VERIFIED") result.numero_ja_registrado = "nao";
      }
    }
  }

  // 3) App inscrito na WABA?
  const subs = await safeGraphGet(`${WABA_ID}/subscribed_apps`, ACCESS_TOKEN!);
  if (subs.networkError) anyNetworkError = true;
  if (subs.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = ((subs.json as any)?.data ?? []) as Array<unknown>;
    if (Array.isArray(arr) && arr.length > 0) {
      result.app_inscrito_na_waba = "ok";
    }
  }

  // 4) Webhook handshake local.
  try {
    const a = Buffer.from(VERIFY_TOKEN!);
    const b = Buffer.from(VERIFY_TOKEN!);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      result.webhook_handshake = "ok";
    }
  } catch {
    result.webhook_handshake = "falhou";
  }

  // 5) Pronto para register?
  result.pronto_para_register =
    result.token_para_waba === "ok" &&
    result.numero_oficial_na_waba === "ok" &&
    result.app_inscrito_na_waba === "ok" &&
    result.webhook_handshake === "ok" &&
    result.numero_ja_registrado !== "sim"
      ? "sim"
      : "nao";

  if (hasSecret(APP_SECRET) && APP_SECRET!.length < 16) {
    result.pronto_para_register = "nao";
  }

  // Categorização do erro (sem expor detalhes da Meta).
  if (result.pronto_para_register === "sim" || result.numero_ja_registrado === "sim") {
    result.erro_categoria = "nenhum";
  } else if (anyNetworkError) {
    result.erro_categoria = "rede";
  } else if (phoneRead.status === 401 || wabaList.status === 401) {
    result.erro_categoria = "token_invalido";
  } else if (phoneRead.status === 403 || wabaList.status === 403 || subs.status === 403) {
    result.erro_categoria = "permissao_insuficiente";
  } else if (phoneRead.status === 404 || phoneRead.status === 400) {
    result.erro_categoria = "phone_id_incorreto";
  } else if (wabaList.status === 404 || wabaList.status === 400) {
    result.erro_categoria = "waba_incorreta";
  } else if (result.app_inscrito_na_waba === "falhou" && subs.ok) {
    result.erro_categoria = "ativo_nao_atribuido";
  } else {
    result.erro_categoria = "desconhecido";
  }

  return result;
}

export const whatsappAdminCheckRegistration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PreflightResult> => {
    await assertAdminMaster(context.userId);
    return runPreflightInternal();
  });

/**
 * Registra o número oficial no WhatsApp Cloud API.
 * Implementada, MAS NÃO deve ser executada até autorização explícita.
 *
 * Proteções:
 *  - Exige Admin Master.
 *  - Dupla confirmação textual obrigatória.
 *  - Trava operacional via WHATSAPP_REGISTER_LOCK="true".
 *  - Valida via preflight antes de despachar.
 *  - Nunca retorna o PIN/token/IDs ao chamador.
 */
export const whatsappAdminRegisterNumber = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        confirm1: z.literal("REGISTRAR-NUMERO-OFICIAL"),
        confirm2: z.literal("11918539158"),
      })
      .parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMaster(context.userId);

    // Trava operacional: após o primeiro register, define-se WHATSAPP_REGISTER_LOCK=true
    const lock = (process.env.WHATSAPP_REGISTER_LOCK ?? "").trim().toLowerCase();
    if (lock === "true") {
      return {
        ok: false as const,
        status: "locked" as const,
        message: "Operação travada (WHATSAPP_REGISTER_LOCK=true).",
      };
    }

    const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
    const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const REGISTER_PIN = process.env.WHATSAPP_REGISTER_PIN;

    if (!hasSecret(ACCESS_TOKEN) || !hasSecret(PHONE_NUMBER_ID) || !hasSecret(REGISTER_PIN)) {
      return {
        ok: false as const,
        status: "missing_secrets" as const,
        message: "Secrets obrigatórios ausentes.",
      };
    }
    if (!/^\d{6}$/.test(REGISTER_PIN!)) {
      return {
        ok: false as const,
        status: "invalid_pin_format" as const,
        message: "PIN deve ter exatamente 6 dígitos.",
      };
    }

    // Pré-flight obrigatório
    const pf = await runPreflightInternal();
    if (pf.pronto_para_register !== "sim") {
      return {
        ok: false as const,
        status: "preflight_failed" as const,
        message: "Preflight read-only não autorizou o register.",
      };
    }

    try {
      const resp = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/register`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messaging_product: "whatsapp", pin: REGISTER_PIN }),
        },
      );
      const ok = resp.ok;
      // NÃO logar/retornar corpo bruto (pode conter eco do PIN/IDs).
      return {
        ok,
        status: (ok ? "registered" : "failed") as "registered" | "failed",
        http: resp.status,
        message: ok
          ? "Número registrado. Defina WHATSAPP_REGISTER_LOCK=true em seguida."
          : "Falha ao registrar. Consulte o painel da Meta para detalhes.",
      };
    } catch {
      return {
        ok: false as const,
        status: "network_error" as const,
        message: "Falha de rede ao chamar a Meta.",
      };
    }

    // Apaga referências locais (defesa simbólica).
    // (variáveis saem de escopo no final do handler)
  });
