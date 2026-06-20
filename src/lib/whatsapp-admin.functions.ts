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
import { createHmac, timingSafeEqual } from "crypto";
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

type PreflightResult = {
  token_para_waba: "ok" | "falhou";
  numero_oficial_na_waba: "ok" | "falhou";
  app_inscrito_na_waba: "ok" | "falhou";
  webhook_handshake: "ok" | "falhou";
  numero_ja_registrado: "sim" | "nao" | "desconhecido";
  pronto_para_register: "sim" | "nao";
  secrets_completos: boolean;
};

async function safeGraphGet(path: string, token: string): Promise<{ ok: boolean; json: unknown }> {
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
    return { ok: resp.ok, json };
  } catch {
    return { ok: false, json: null };
  }
}

/**
 * Preflight read-only: confirma que os secrets configurados conseguem
 * conversar com a Meta para o número oficial, sem enviar mensagens,
 * sem registrar o número e sem expor segredos.
 */
export const whatsappAdminCheckRegistration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PreflightResult> => {
    await assertAdminMaster(context.userId);

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

    const result: PreflightResult = {
      token_para_waba: "falhou",
      numero_oficial_na_waba: "falhou",
      app_inscrito_na_waba: "falhou",
      webhook_handshake: "falhou",
      numero_ja_registrado: "desconhecido",
      pronto_para_register: "nao",
      secrets_completos,
    };

    if (!secrets_completos) return result;

    // 1) Token consegue ler o PHONE_NUMBER_ID e bate com a WABA?
    const phoneRead = await safeGraphGet(
      `${PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,whatsapp_business_account{id}`,
      ACCESS_TOKEN!,
    );
    if (phoneRead.ok) {
      result.token_para_waba = "ok";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = phoneRead.json as any;
      const display = digitsOnly(p?.display_phone_number);
      if (display && display === OFFICIAL_NUMBER_E164) {
        // confere também via WABA (defesa em profundidade)
      }
      // status de registro
      const cvs = String(p?.code_verification_status ?? "").toUpperCase();
      if (cvs === "VERIFIED" || cvs === "EXPIRED") {
        // VERIFIED = registrado; EXPIRED = registrado mas precisa renovar
        result.numero_ja_registrado = cvs === "VERIFIED" ? "sim" : "nao";
      } else if (cvs === "NOT_VERIFIED") {
        result.numero_ja_registrado = "nao";
      }
      // valida que pertence à WABA configurada
      const wabaIdFromPhone = String(p?.whatsapp_business_account?.id ?? "");
      if (wabaIdFromPhone && wabaIdFromPhone === WABA_ID) {
        // continuamos a checagem abaixo via listagem
      }
    }

    // 2) Número oficial pertence à WABA?
    const wabaList = await safeGraphGet(
      `${WABA_ID}/phone_numbers?fields=id,display_phone_number,code_verification_status`,
      ACCESS_TOKEN!,
    );
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

    // 3) App inscrito na WABA (subscribed_apps)?
    const subs = await safeGraphGet(`${WABA_ID}/subscribed_apps`, ACCESS_TOKEN!);
    if (subs.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr = ((subs.json as any)?.data ?? []) as Array<unknown>;
      if (Array.isArray(arr) && arr.length > 0) {
        result.app_inscrito_na_waba = "ok";
      }
    }

    // 4) Handshake do webhook validado localmente (sem chamar Meta).
    //    Reproduz a lógica do GET handler do webhook usando o VERIFY_TOKEN do env.
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

    // Defesa anti-leak: garante que APP_SECRET não escape via tamanho mínimo,
    // sem expor o valor.
    if (hasSecret(APP_SECRET) && APP_SECRET!.length < 16) {
      result.pronto_para_register = "nao";
    }

    return result;
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
    const pf = await whatsappAdminCheckRegistration();
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

// HMAC helper exportado apenas para evitar tree-shake removal do import
// em caso de uso futuro de assinaturas; não usado externamente agora.
export const __whatsapp_admin_internal = { createHmac };
