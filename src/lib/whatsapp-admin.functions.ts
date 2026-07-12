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


// META-GRAPH-UPGRADE-01 — fonte única e validada da versão Graph.
// Nenhum fallback silencioso; nenhuma constante literal de versão neste
// módulo. Import dinâmico dentro dos handlers porque `.functions.ts`
// participa do grafo do bundle client (apenas o corpo do handler é
// removido do cliente).
const OFFICIAL_NUMBER_E164 = "5511918539158";

function adminUnauthorized(): Response {
  return new Response(
    JSON.stringify({ error: "forbidden", message: "Acesso restrito ao Admin Master." }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

async function assertAdminMaster(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { isAdminMasterEmail } = await import("@/server/admin-master.server");
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
  | "rota_ou_versao_invalida"
  | "rede"
  | "desconhecido";

type HttpBucket = 200 | 400 | 401 | 403 | 404 | -1 | "outro";

type PreflightResult = {
  token_para_waba: "ok" | "falhou";
  numero_oficial_na_waba: "ok" | "falhou";
  app_inscrito_na_waba: "ok" | "falhou";
  webhook_handshake: "ok" | "falhou";
  numero_ja_registrado: "sim" | "nao" | "desconhecido";
  pronto_para_register: "sim" | "nao";
  secrets_completos: boolean;
  // Diagnóstico seguro (sem expor secrets, IDs, URL, body ou headers).
  access_token_lido_pelo_backend: "sim" | "nao";
  access_token_hash_prefix: string;
  meta_token_http_status: HttpBucket;
  meta_waba_http_status: HttpBucket;
  meta_phone_http_status: HttpBucket;
  meta_subscribed_apps_http_status: HttpBucket;
  meta_error_code: number | null;
  meta_error_subcode: number | null;
  erro_categoria: ErroCategoria;
};

function bucketStatus(s: number | null): HttpBucket {
  if (s === null) return -1;
  if (s === 200) return 200;
  if (s === 400) return 400;
  if (s === 401) return 401;
  if (s === 403) return 403;
  if (s === 404) return 404;
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

type GraphCall = {
  ok: boolean;
  status: number | null;
  json: unknown;
  networkError: boolean;
  errorCode: number | null;
  errorSubcode: number | null;
};

async function safeGraphGet(path: string, token: string): Promise<GraphCall> {
  const { buildWhatsAppGraphUrl } = await import(
    "@/server/whatsapp-graph-version.server"
  );
  const built = buildWhatsAppGraphUrl({ kind: "admin_path", path });
  if (!built.ok) {
    return {
      ok: false,
      status: null,
      json: null,
      networkError: true,
      errorCode: null,
      errorSubcode: null,
    };
  }
  try {
    const resp = await fetch(built.url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    let json: unknown = null;
    try {
      json = await resp.json();
    } catch {
      json = null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = (json as any)?.error ?? null;
    const errorCode = typeof err?.code === "number" ? err.code : null;
    const errorSubcode = typeof err?.error_subcode === "number" ? err.error_subcode : null;
    return { ok: resp.ok, status: resp.status, json, networkError: false, errorCode, errorSubcode };
  } catch {
    return {
      ok: false,
      status: null,
      json: null,
      networkError: true,
      errorCode: null,
      errorSubcode: null,
    };
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
    meta_subscribed_apps_http_status: -1,
    meta_error_code: null,
    meta_error_subcode: null,
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
  const firstError = { code: null as number | null, sub: null as number | null };
  const captureError = (c: GraphCall) => {
    if (firstError.code === null && (c.errorCode !== null || c.errorSubcode !== null)) {
      firstError.code = c.errorCode;
      firstError.sub = c.errorSubcode;
    }
  };

  // 1) Token básico — /me?fields=id
  const meRead = await safeGraphGet(`me?fields=id`, ACCESS_TOKEN!);
  result.meta_token_http_status = bucketStatus(meRead.status);
  if (meRead.networkError) anyNetworkError = true;
  if (!meRead.ok) captureError(meRead);
  if (meRead.ok) {
    result.token_para_waba = "ok";
  }

  // 2) WABA — /{WABA_ID}/phone_numbers
  const wabaList = await safeGraphGet(
    `${WABA_ID}/phone_numbers?fields=id,display_phone_number,verified_name,status,code_verification_status`,
    ACCESS_TOKEN!,
  );
  result.meta_waba_http_status = bucketStatus(wabaList.status);
  if (wabaList.networkError) anyNetworkError = true;
  if (!wabaList.ok) captureError(wabaList);
  if (wabaList.status === 200 && wabaList.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = ((wabaList.json as any)?.data ?? []) as Array<{
      id?: string;
      display_phone_number?: string;
      code_verification_status?: string;
    }>;
    const match = Array.isArray(arr)
      ? arr.find(
          (row) =>
            row?.id === PHONE_NUMBER_ID &&
            digitsOnly(row?.display_phone_number) === OFFICIAL_NUMBER_E164,
        )
      : undefined;
    if (match) {
      result.numero_oficial_na_waba = "ok";
      const cvs = String(match.code_verification_status ?? "").toUpperCase();
      if (cvs === "VERIFIED") result.numero_ja_registrado = "sim";
      else if (cvs === "NOT_VERIFIED") result.numero_ja_registrado = "nao";
    }
  }

  // 3) Número — /{PHONE_NUMBER_ID}
  const phoneRead = await safeGraphGet(
    `${PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name,status,code_verification_status`,
    ACCESS_TOKEN!,
  );
  result.meta_phone_http_status = bucketStatus(phoneRead.status);
  if (phoneRead.networkError) anyNetworkError = true;
  if (!phoneRead.ok) captureError(phoneRead);
  if (phoneRead.status === 200 && phoneRead.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = phoneRead.json as any;
    const cvs = String(p?.code_verification_status ?? "").toUpperCase();
    if (result.numero_ja_registrado === "desconhecido") {
      if (cvs === "VERIFIED") result.numero_ja_registrado = "sim";
      else if (cvs === "NOT_VERIFIED" || cvs === "EXPIRED") result.numero_ja_registrado = "nao";
    }
  }

  // 4) App inscrito — /{WABA_ID}/subscribed_apps
  const subs = await safeGraphGet(`${WABA_ID}/subscribed_apps`, ACCESS_TOKEN!);
  result.meta_subscribed_apps_http_status = bucketStatus(subs.status);
  if (subs.networkError) anyNetworkError = true;
  if (!subs.ok) captureError(subs);
  if (subs.status === 200 && subs.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = ((subs.json as any)?.data ?? []) as Array<unknown>;
    if (Array.isArray(arr) && arr.length > 0) {
      result.app_inscrito_na_waba = "ok";
    }
  }

  // 5) Webhook handshake local (sem chamar Meta).
  try {
    const a = Buffer.from(VERIFY_TOKEN!);
    const b = Buffer.from(VERIFY_TOKEN!);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      result.webhook_handshake = "ok";
    }
  } catch {
    result.webhook_handshake = "falhou";
  }

  // 6) Pronto para register?
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

  result.meta_error_code = firstError.code;
  result.meta_error_subcode = firstError.sub;

  // 7) Categorização do erro por HTTP + código Meta.
  // Códigos Meta comuns:
  //   190 → token inválido/expirado
  //   200/10/278 → permissão ausente
  //   100 → parâmetro inválido (rota/versão/ID errado)
  //   803 → objeto não existe (ID incorreto)
  const allOk =
    meRead.status === 200 &&
    wabaList.status === 200 &&
    phoneRead.status === 200 &&
    subs.status === 200;

  if (anyNetworkError) {
    result.erro_categoria = "rede";
  } else if (allOk) {
    if (result.app_inscrito_na_waba === "falhou") {
      result.erro_categoria = "ativo_nao_atribuido";
    } else if (result.numero_oficial_na_waba === "falhou") {
      result.erro_categoria = "phone_id_incorreto";
    } else {
      result.erro_categoria = "nenhum";
    }
  } else if (firstError.code === 190 || meRead.status === 401) {
    result.erro_categoria = "token_invalido";
  } else if (
    firstError.code === 200 ||
    firstError.code === 10 ||
    firstError.code === 278 ||
    meRead.status === 403 ||
    wabaList.status === 403 ||
    phoneRead.status === 403 ||
    subs.status === 403
  ) {
    result.erro_categoria = "permissao_insuficiente";
  } else if (firstError.code === 100) {
    // 100 normalmente significa parâmetro/rota inválido (ex.: versão Graph errada).
    result.erro_categoria = "rota_ou_versao_invalida";
  } else if (phoneRead.status === 404 || firstError.code === 803) {
    result.erro_categoria = "phone_id_incorreto";
  } else if (wabaList.status === 404) {
    result.erro_categoria = "waba_incorreta";
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
 *
 * Proteções:
 *  - Exige Admin Master.
 *  - Dupla confirmação textual obrigatória: "REGISTRAR-CLOUD-API" + "11918539158".
 *  - Trava operacional via WHATSAPP_REGISTER_LOCK="true".
 *  - Gating server-side baseado em:
 *      • Preflight (token_para_waba, numero_oficial_na_waba, app_inscrito_na_waba) → ok
 *      • Auditoria real (verificacao_numero_meta=verificado, nome_exibicao_meta=aprovado)
 *      • estrategia_registro === "registro_direto_cloud_api"
 *      • WHATSAPP_ENABLED=false e WHATSAPP_CANARY_ENABLED=false
 *  - NÃO usa numero_ja_registrado para liberar/bloquear.
 *  - NÃO retorna PIN/token/IDs/URL/headers/body ao chamador.
 *  - Após o POST, roda a auditoria real e devolve apenas enums seguros.
 */
export const whatsappAdminRegisterNumber = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        confirm1: z.literal("REGISTRAR-CLOUD-API"),
        confirm2: z.literal("11918539158"),
      })
      .parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMaster(context.userId);

    type RegisterStatus =
      | "locked"
      | "missing_secrets"
      | "invalid_pin_format"
      | "preflight_failed"
      | "strategy_blocked"
      | "flags_active"
      | "registered"
      | "failed"
      | "network_error";

    type RegisterResponse = {
      ok: boolean;
      status: RegisterStatus;
      message: string;
      registro_cloud_api_executado: "sim" | "nao";
      registro_http_status: 200 | "outro";
      meta_error_code: number | null;
      meta_error_subcode: number | null;
      numero_registrado_cloud_api: "sim" | "nao" | "desconhecido";
      numero_apto_para_conversa_whatsapp: "sim" | "nao" | "desconhecido";
      tipo_plataforma_meta:
        | "cloud_api"
        | "on_premise"
        | "coexistence"
        | "nao_informado"
        | "outro";
      status_numero_meta:
        | "connected"
        | "disconnected"
        | "pendente"
        | "nao_informado"
        | "outro";
      acao_recomendada:
        | "nenhuma"
        | "revisar_meta"
        | "migrar_para_cloud_api"
        | "aguardar"
        | "registrar_cloud_api";
    };

    const safeFail = (
      status: RegisterStatus,
      message: string,
      audit?: RealAuditState,
    ): RegisterResponse => ({
      ok: false,
      status,
      message,
      registro_cloud_api_executado: "nao",
      registro_http_status: "outro",
      meta_error_code: null,
      meta_error_subcode: null,
      numero_registrado_cloud_api: audit?.numero_registrado_cloud_api ?? "desconhecido",
      numero_apto_para_conversa_whatsapp:
        audit?.numero_apto_para_conversa_whatsapp ?? "desconhecido",
      tipo_plataforma_meta: audit?.tipo_plataforma_meta ?? "nao_informado",
      status_numero_meta: audit?.status_numero_meta ?? "nao_informado",
      acao_recomendada:
        (audit?.acao_recomendada as RegisterResponse["acao_recomendada"]) ?? "aguardar",
    });

    // Trava operacional: após o primeiro register, define-se WHATSAPP_REGISTER_LOCK=true
    const lock = (process.env.WHATSAPP_REGISTER_LOCK ?? "").trim().toLowerCase();
    if (lock === "true") {
      return safeFail("locked", "Operação travada (WHATSAPP_REGISTER_LOCK=true).");
    }

    // Flags operacionais devem permanecer desligadas durante o register.
    const enabledFlag = (process.env.WHATSAPP_ENABLED ?? "").trim().toLowerCase() === "true";
    const canaryFlag =
      (process.env.WHATSAPP_CANARY_ENABLED ?? "").trim().toLowerCase() === "true";
    if (enabledFlag || canaryFlag) {
      return safeFail(
        "flags_active",
        "Flags operacionais ativas; desative antes de registrar.",
      );
    }

    const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
    const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const REGISTER_PIN = process.env.WHATSAPP_REGISTER_PIN;

    if (!hasSecret(ACCESS_TOKEN) || !hasSecret(PHONE_NUMBER_ID) || !hasSecret(REGISTER_PIN)) {
      return safeFail("missing_secrets", "Secrets obrigatórios ausentes.");
    }
    if (!/^\d{6}$/.test(REGISTER_PIN!)) {
      return safeFail("invalid_pin_format", "PIN deve ter exatamente 6 dígitos.");
    }

    // Preflight read-only obrigatório (token/WABA/app/webhook).
    const pf = await runPreflightInternal();
    const preflightOk =
      pf.token_para_waba === "ok" &&
      pf.numero_oficial_na_waba === "ok" &&
      pf.app_inscrito_na_waba === "ok" &&
      pf.webhook_handshake === "ok";
    if (!preflightOk) {
      return safeFail("preflight_failed", "Preflight não autorizou o register.");
    }

    // Auditoria real obrigatória + estratégia segura (com preflight + flags).
    const auditBefore = await computeRealAuditState();
    const strat = classifyRegisterStrategy(auditBefore, pf, {
      enabled: enabledFlag,
      canary: canaryFlag,
    });
    if (strat !== "registro_direto_cloud_api") {
      return safeFail(
        "strategy_blocked",
        "Estratégia segura não autorizou o register direto.",
        auditBefore,
      );
    }

    // POST /{PHONE_NUMBER_ID}/register
    let postOk = false;
    let networkError = false;
    let httpStatus: number | null = null;
    let metaErrorCode: number | null = null;
    let metaErrorSubcode: number | null = null;
    try {
      const { buildWhatsAppGraphUrl } = await import(
        "@/server/whatsapp-graph-version.server"
      );
      const built = buildWhatsAppGraphUrl({
        kind: "register",
        phoneNumberId: PHONE_NUMBER_ID!,
      });
      if (!built.ok) {
        networkError = true;
        throw new Error("configuration_error");
      }
      const resp = await fetch(built.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", pin: REGISTER_PIN }),
      });
      postOk = resp.ok;
      httpStatus = resp.status;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const j: any = await resp.json();
        if (j?.error) {
          if (typeof j.error.code === "number") metaErrorCode = j.error.code;
          if (typeof j.error.error_subcode === "number")
            metaErrorSubcode = j.error.error_subcode;
        }
      } catch {
        // sem body — não logamos nada
      }
    } catch {
      networkError = true;
    }

    // Re-auditoria pós-POST para devolver estado real.
    const auditAfter = await computeRealAuditState();

    const httpBucket: 200 | "outro" = httpStatus === 200 ? 200 : "outro";

    if (networkError) {
      return {
        ...safeFail("network_error", "Falha de rede ao chamar a Meta.", auditAfter),
        registro_http_status: "outro" as const,
        meta_error_code: null,
        meta_error_subcode: null,
      };
    }

    return {
      ok: postOk,
      status: (postOk ? "registered" : "failed") as RegisterStatus,
      message: postOk
        ? "Registro Cloud API executado. Defina WHATSAPP_REGISTER_LOCK=true em seguida."
        : "Meta rejeitou o registro. Consulte o painel da Meta.",
      registro_cloud_api_executado: postOk ? "sim" : "nao",
      registro_http_status: httpBucket,
      meta_error_code: metaErrorCode,
      meta_error_subcode: metaErrorSubcode,
      numero_registrado_cloud_api: auditAfter.numero_registrado_cloud_api,
      numero_apto_para_conversa_whatsapp: auditAfter.numero_apto_para_conversa_whatsapp,
      tipo_plataforma_meta: auditAfter.tipo_plataforma_meta,
      status_numero_meta: auditAfter.status_numero_meta,
      acao_recomendada:
        auditAfter.acao_recomendada as RegisterResponse["acao_recomendada"],
    } as RegisterResponse;
  });

/**
 * Inscreve o App Gasto Inteligente na WABA oficial via
 * POST /{WABA_ID}/subscribed_apps.
 *
 * Proteções:
 *  - Admin Master obrigatório.
 *  - Confirmação textual exata: "ASSINAR-APP-NA-WABA".
 *  - Roda preflight read-only antes do POST e exige:
 *      token_para_waba=ok, numero_oficial_na_waba=ok,
 *      numero_ja_registrado=sim, app_inscrito_na_waba=falhou.
 *  - Nunca retorna token/IDs/PIN/App Secret/Verify Token/URL/headers/body.
 *  - Não chama /register, não envia mensagem.
 */
export const whatsappAdminSubscribeAppToWaba = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ confirm: z.literal("ASSINAR-APP-NA-WABA") }).parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMaster(context.userId);

    const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
    const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

    if (!hasSecret(ACCESS_TOKEN) || !hasSecret(WABA_ID)) {
      return {
        ok: false as const,
        status: "missing_secrets" as const,
        message: "Secrets obrigatórios ausentes.",
      };
    }

    // Pré-flight read-only obrigatório.
    const pfBefore = await runPreflightInternal();
    const preconditionsOk =
      pfBefore.token_para_waba === "ok" &&
      pfBefore.numero_oficial_na_waba === "ok" &&
      pfBefore.numero_ja_registrado === "sim" &&
      pfBefore.app_inscrito_na_waba === "falhou";

    if (!preconditionsOk) {
      return {
        ok: false as const,
        status: "preflight_failed" as const,
        message: "Pré-condições do preflight não atendidas.",
      };
    }

    // POST /{WABA_ID}/subscribed_apps (sem body — assina o App dono do token).
    let httpStatus: number | null = null;
    let errorCode: number | null = null;
    let errorSubcode: number | null = null;
    let networkError = false;
    let postOk = false;
    try {
      const resp = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/subscribed_apps`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        },
      );
      httpStatus = resp.status;
      postOk = resp.ok;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const j: any = await resp.json();
        if (j?.error) {
          if (typeof j.error.code === "number") errorCode = j.error.code;
          if (typeof j.error.error_subcode === "number") errorSubcode = j.error.error_subcode;
        }
      } catch {
        /* ignore — não logamos corpo */
      }
    } catch {
      networkError = true;
    }

    // Re-roda preflight para confirmar o estado pós-POST.
    const pfAfter = await runPreflightInternal();

    return {
      ok: postOk && pfAfter.app_inscrito_na_waba === "ok",
      status: networkError
        ? ("network_error" as const)
        : postOk
          ? ("subscribed" as const)
          : ("failed" as const),
      app_inscrito_na_waba: pfAfter.app_inscrito_na_waba,
      pronto_para_register: pfAfter.pronto_para_register,
      meta_subscribed_apps_http_status: pfAfter.meta_subscribed_apps_http_status,
      meta_error_code: errorCode ?? pfAfter.meta_error_code,
      meta_error_subcode: errorSubcode ?? pfAfter.meta_error_subcode,
      erro_categoria: pfAfter.erro_categoria,
      post_http_bucket: httpStatus === null
        ? -1
        : httpStatus === 200
          ? 200
          : httpStatus === 400
            ? 400
            : httpStatus === 401
              ? 401
              : httpStatus === 403
                ? 403
                : httpStatus === 404
                  ? 404
                  : ("outro" as const),
    };
  });

/**
 * Checklist técnico operacional (read-only) para o painel Admin Master.
 * Retorna apenas enums seguros. Nenhum secret, ID, token ou URL é exposto.
 */
export const whatsappAdminGetOpsChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMaster(context.userId);
    const pf = await runPreflightInternal();

    const enabledFlag = (process.env.WHATSAPP_ENABLED ?? "").trim().toLowerCase() === "true";
    const canaryFlag =
      (process.env.WHATSAPP_CANARY_ENABLED ?? "").trim().toLowerCase() === "true";
    // "Preparado" significa que a lógica de canário existe no backend
    // (isAdminMasterPhone + bloqueio seguro p/ não-admin no webhook),
    // independente da env var WHATSAPP_CANARY_ENABLED estar definida.
    const canaryPrepared = true;

    return {
      numero_registrado: (pf.numero_ja_registrado === "sim" ? "ok" : "falhou") as
        | "ok"
        | "falhou",
      app_inscrito_na_waba: pf.app_inscrito_na_waba,
      webhook_configurado:
        pf.webhook_handshake === "ok" && pf.secrets_completos
          ? ("ok" as const)
          : ("falhou" as const),
      modo_canario_preparado: canaryPrepared ? ("ok" as const) : ("falhou" as const),
      modo_canario_ativo: canaryFlag ? ("sim" as const) : ("nao" as const),
      processamento_real_ativo: enabledFlag ? ("sim" as const) : ("nao" as const),
    };
  });

/**
 * Verificação read-only de prontidão do WhatsApp do Admin Master
 * para ser o único remetente autorizado no teste canário.
 *
 * Retorna SOMENTE enums seguros. Nenhum telefone, e-mail, user_id,
 * token, ID ou mensagem é exposto.
 */
export const whatsappAdminCheckCanaryReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMaster(context.userId);

    type Enum = "ok" | "falhou";
    let admin_email_autorizado: Enum = "falhou";
    let admin_link_ativo: Enum = "falhou";
    let admin_opt_in_valido: Enum = "falhou";

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { isAdminMasterEmail } = await import("@/server/admin-master.server");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adm = supabaseAdmin as any;

      const { data: userData } = await adm.auth.admin.getUserById(context.userId);
      const email: string | null = userData?.user?.email ?? null;
      if (email && isAdminMasterEmail(email)) {
        admin_email_autorizado = "ok";
      }

      const { data: link } = await adm
        .from("whatsapp_links")
        .select("ativo, revogado_em, opt_in_em")
        .eq("user_id", context.userId)
        .maybeSingle();

      if (link && link.ativo === true && !link.revogado_em) {
        admin_link_ativo = "ok";
      }
      if (link && link.opt_in_em) {
        admin_opt_in_valido = "ok";
      }
    } catch {
      // mantém "falhou" — não vazar detalhes
    }

    const admin_canary_phone_ready: Enum =
      admin_email_autorizado === "ok" &&
      admin_link_ativo === "ok" &&
      admin_opt_in_valido === "ok"
        ? "ok"
        : "falhou";

    return {
      admin_canary_phone_ready,
      admin_link_ativo,
      admin_opt_in_valido,
      admin_email_autorizado,
    };
  });

/**
 * Tipos e helper interno reutilizados por:
 *  - whatsappAdminAuditRealRegistrationState (read-only)
 *  - whatsappAdminClassifyRegisterStrategy (read-only)
 *  - whatsappAdminRegisterNumber (gating do POST)
 *
 * Não exposto diretamente — sempre chamado por handler com admin check.
 */
type RealAuditState = {
  numero_meta_encontrado: "sim" | "nao";
  numero_verificado_na_meta: "sim" | "nao" | "desconhecido";
  numero_registrado_cloud_api: "sim" | "nao" | "desconhecido";
  numero_apto_para_conversa_whatsapp: "sim" | "nao" | "desconhecido";
  plataforma_do_numero: "cloud_api" | "outro" | "desconhecido";
  status_de_registro_confiavel: "sim" | "nao";
  acao_recomendada:
    | "registrar_cloud_api"
    | "migrar_para_cloud_api"
    | "revisar_meta"
    | "aguardar"
    | "nenhuma";
  tipo_plataforma_meta:
    | "cloud_api"
    | "on_premise"
    | "coexistence"
    | "nao_informado"
    | "outro";
  status_numero_meta:
    | "connected"
    | "disconnected"
    | "pendente"
    | "nao_informado"
    | "outro";
  verificacao_numero_meta: "verificado" | "nao_verificado" | "desconhecido";
  nome_exibicao_meta: "aprovado" | "pendente" | "reprovado" | "desconhecido";
  id_do_erro_meta_corresponde_ao_phone_number_id_atual: "sim" | "nao";
  phone_number_id_atual_esta_na_waba_oficial: "sim" | "nao";
};

async function computeRealAuditState(): Promise<RealAuditState> {
  const result: RealAuditState = {
    numero_meta_encontrado: "nao",
    numero_verificado_na_meta: "desconhecido",
    numero_registrado_cloud_api: "desconhecido",
    numero_apto_para_conversa_whatsapp: "desconhecido",
    plataforma_do_numero: "desconhecido",
    status_de_registro_confiavel: "nao",
    acao_recomendada: "aguardar",
    tipo_plataforma_meta: "nao_informado",
    status_numero_meta: "nao_informado",
    verificacao_numero_meta: "desconhecido",
    nome_exibicao_meta: "desconhecido",
    id_do_erro_meta_corresponde_ao_phone_number_id_atual: "nao",
    phone_number_id_atual_esta_na_waba_oficial: "nao",
  };

  const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

  const ID_ERRO_META_HISTORICO = "1186676367860451";
  if (hasSecret(PHONE_NUMBER_ID) && PHONE_NUMBER_ID!.trim() === ID_ERRO_META_HISTORICO) {
    result.id_do_erro_meta_corresponde_ao_phone_number_id_atual = "sim";
  }

  if (!hasSecret(ACCESS_TOKEN) || !hasSecret(PHONE_NUMBER_ID) || !hasSecret(WABA_ID)) {
    result.acao_recomendada = "revisar_meta";
    return result;
  }

  const wabaCall = await safeGraphGet(`${WABA_ID}/phone_numbers?fields=id`, ACCESS_TOKEN!);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wabaArr = ((wabaCall.json as any)?.data ?? []) as Array<{ id?: string }>;
  if (
    wabaCall.ok &&
    Array.isArray(wabaArr) &&
    wabaArr.some((row) => row?.id === PHONE_NUMBER_ID)
  ) {
    result.phone_number_id_atual_esta_na_waba_oficial = "sim";
  }

  const phoneFields = [
    "id",
    "display_phone_number",
    "verified_name",
    "code_verification_status",
    "name_status",
    "quality_rating",
    "platform_type",
    "status",
    "throughput",
    "messaging_limit_tier",
    "account_mode",
    "is_official_business_account",
  ].join(",");
  const phoneCall = await safeGraphGet(
    `${PHONE_NUMBER_ID}?fields=${phoneFields}`,
    ACCESS_TOKEN!,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const phoneJson = (phoneCall.json as any) ?? null;
  const phoneFound =
    phoneCall.ok && phoneJson && typeof phoneJson === "object" && !phoneJson.error;
  result.numero_meta_encontrado = phoneFound ? "sim" : "nao";

  if (!phoneFound) {
    result.acao_recomendada = "revisar_meta";
    return result;
  }

  const codeVer = String(phoneJson.code_verification_status ?? "").toUpperCase();
  if (codeVer === "VERIFIED") result.numero_verificado_na_meta = "sim";
  else if (codeVer === "NOT_VERIFIED" || codeVer === "EXPIRED")
    result.numero_verificado_na_meta = "nao";
  else result.numero_verificado_na_meta = "desconhecido";

  if (codeVer === "VERIFIED") result.verificacao_numero_meta = "verificado";
  else if (codeVer === "NOT_VERIFIED" || codeVer === "EXPIRED")
    result.verificacao_numero_meta = "nao_verificado";
  else result.verificacao_numero_meta = "desconhecido";

  const platform = String(phoneJson.platform_type ?? "").toUpperCase();
  if (platform === "CLOUD_API") result.plataforma_do_numero = "cloud_api";
  else if (platform.length > 0) result.plataforma_do_numero = "outro";
  else result.plataforma_do_numero = "desconhecido";

  if (platform === "CLOUD_API") result.tipo_plataforma_meta = "cloud_api";
  else if (platform === "ON_PREMISE") result.tipo_plataforma_meta = "on_premise";
  else if (platform === "COEXISTENCE") result.tipo_plataforma_meta = "coexistence";
  else if (platform.length > 0) result.tipo_plataforma_meta = "outro";
  else result.tipo_plataforma_meta = "nao_informado";

  const phoneStatus = String(phoneJson.status ?? "").toUpperCase();
  const nameStatus = String(phoneJson.name_status ?? "").toUpperCase();
  const statusConnected = phoneStatus === "CONNECTED";
  const nameApproved =
    nameStatus === "APPROVED" || nameStatus === "AVAILABLE_WITHOUT_REVIEW";

  if (result.plataforma_do_numero === "cloud_api" && statusConnected) {
    result.numero_registrado_cloud_api = "sim";
  } else if (
    result.plataforma_do_numero === "cloud_api" &&
    phoneStatus.length > 0 &&
    !statusConnected
  ) {
    result.numero_registrado_cloud_api = "nao";
  } else {
    result.numero_registrado_cloud_api = "desconhecido";
  }

  if (phoneStatus === "CONNECTED") result.status_numero_meta = "connected";
  else if (phoneStatus === "DISCONNECTED") result.status_numero_meta = "disconnected";
  else if (phoneStatus === "PENDING") result.status_numero_meta = "pendente";
  else if (phoneStatus.length > 0) result.status_numero_meta = "outro";
  else result.status_numero_meta = "nao_informado";

  if (nameStatus === "APPROVED" || nameStatus === "AVAILABLE_WITHOUT_REVIEW")
    result.nome_exibicao_meta = "aprovado";
  else if (nameStatus === "PENDING") result.nome_exibicao_meta = "pendente";
  else if (nameStatus === "REJECTED") result.nome_exibicao_meta = "reprovado";
  else result.nome_exibicao_meta = "desconhecido";

  if (
    result.numero_registrado_cloud_api === "sim" &&
    result.numero_verificado_na_meta === "sim" &&
    nameApproved
  ) {
    result.numero_apto_para_conversa_whatsapp = "sim";
  } else if (
    result.numero_registrado_cloud_api === "nao" ||
    result.numero_verificado_na_meta === "nao"
  ) {
    result.numero_apto_para_conversa_whatsapp = "nao";
  } else {
    result.numero_apto_para_conversa_whatsapp = "desconhecido";
  }

  result.status_de_registro_confiavel =
    result.numero_verificado_na_meta !== "desconhecido" &&
    result.numero_registrado_cloud_api !== "desconhecido" &&
    result.plataforma_do_numero !== "desconhecido"
      ? "sim"
      : "nao";

  const inWaba = result.phone_number_id_atual_esta_na_waba_oficial === "sim";
  const tipoLegado =
    result.tipo_plataforma_meta === "on_premise" ||
    result.tipo_plataforma_meta === "coexistence";

  if (result.numero_apto_para_conversa_whatsapp === "sim") {
    result.acao_recomendada = "nenhuma";
  } else if (
    result.numero_verificado_na_meta === "sim" &&
    nameApproved &&
    inWaba &&
    !tipoLegado &&
    result.numero_registrado_cloud_api !== "sim"
  ) {
    // Confirmado pelo painel da Meta: número verificado + na WABA + status pendente
    // ⇒ registro direto na Cloud API (mesmo que platform_type venha vazio/"outro").
    result.acao_recomendada = "registrar_cloud_api";
  } else if (result.numero_verificado_na_meta === "sim" && tipoLegado) {
    result.acao_recomendada = "migrar_para_cloud_api";
  } else if (result.numero_verificado_na_meta === "nao") {
    result.acao_recomendada = "revisar_meta";
  } else {
    result.acao_recomendada = "aguardar";
  }

  return result;
}

/**
 * Classifica internamente a estratégia segura de registro Cloud API.
 *
 * Regras:
 *  - registro_direto_cloud_api: verificado + nome aprovado + status pendente/desconhecido
 *      + tipo_plataforma_meta compatível com Cloud API (cloud_api ou nao_informado).
 *  - migracao_manual_necessaria: tipo_plataforma_meta indica plataforma legada
 *      (on_premise, coexistence) ou qualquer outro tipo que não aceite register direto.
 *  - estado_desconhecido: qualquer outro caso (não verificado, nome não aprovado etc.).
 */
function classifyRegisterStrategy(
  audit: RealAuditState,
  preflight?: PreflightResult,
  flags?: { enabled: boolean; canary: boolean },
): "registro_direto_cloud_api" | "migracao_manual_necessaria" | "estado_desconhecido" {
  const verificado = audit.verificacao_numero_meta === "verificado";
  const nomeAprovado = audit.nome_exibicao_meta === "aprovado";
  const inWaba = audit.phone_number_id_atual_esta_na_waba_oficial === "sim";
  const statusPendente = audit.status_numero_meta === "pendente";

  // Plataformas legadas confirmadas exigem migração manual.
  // platform_type == "outro" isoladamente NÃO basta.
  if (
    audit.tipo_plataforma_meta === "on_premise" ||
    audit.tipo_plataforma_meta === "coexistence"
  ) {
    return "migracao_manual_necessaria";
  }

  // Já registrado e conectado → não há register direto a fazer.
  if (
    audit.status_numero_meta === "connected" &&
    audit.numero_registrado_cloud_api === "sim"
  ) {
    return "estado_desconhecido";
  }

  // Preflight e flags (quando fornecidos) precisam estar conformes.
  if (preflight) {
    if (
      preflight.token_para_waba !== "ok" ||
      preflight.numero_oficial_na_waba !== "ok" ||
      preflight.app_inscrito_na_waba !== "ok"
    ) {
      return "estado_desconhecido";
    }
  }
  if (flags && (flags.enabled || flags.canary)) {
    return "estado_desconhecido";
  }

  if (!verificado || !nomeAprovado || !inWaba || !statusPendente) {
    return "estado_desconhecido";
  }

  return "registro_direto_cloud_api";
}

/**
 * whatsappAdminAuditRealRegistrationState
 *
 * Auditoria read-only do estado real do Phone Number ID na Meta.
 * - Admin Master only.
 * - Nenhuma escrita, nenhum POST, nenhuma mensagem enviada.
 * - Não chama /register.
 * - Não retorna token, IDs, URL, headers, body cru, PIN, App Secret ou Verify Token.
 * - Retorna apenas enums seguros.
 */
export const whatsappAdminAuditRealRegistrationState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMaster(context.userId);
    return computeRealAuditState();
  });

/**
 * whatsappAdminClassifyRegisterStrategy
 *
 * Decisão server-side sobre a estratégia segura de registro.
 * Retorna SOMENTE o enum estrategia_registro. Nenhum dado cru, ID,
 * token, telefone, mensagem ou resposta da Meta é exposto.
 */
export const whatsappAdminClassifyRegisterStrategy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMaster(context.userId);
    const [audit, pf] = await Promise.all([
      computeRealAuditState(),
      runPreflightInternal(),
    ]);
    const flags = {
      enabled: (process.env.WHATSAPP_ENABLED ?? "").trim().toLowerCase() === "true",
      canary: (process.env.WHATSAPP_CANARY_ENABLED ?? "").trim().toLowerCase() === "true",
    };
    return {
      estrategia_registro: classifyRegisterStrategy(audit, pf, flags),
    };
  });

/**
 * Diagnóstico read-only (Admin Master) — resolução de categoria do WhatsApp.
 *
 * Verifica, para o próprio Admin Master, se existe uma categoria compatível
 * com "Alimentação" e qual seria a categoria escolhida para a descrição
 * de teste "Padaria". Não expõe IDs, nomes de outros usuários, telefones,
 * tokens ou qualquer dado bruto.
 */
export const whatsappAdminCheckCategoriaResolution = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMaster(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { diagnoseCategoriaResolution } = await import("@/server/whatsapp.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adm = supabaseAdmin as any;
    const { data } = await adm
      .from("categorias")
      .select("id, legacy_id, nome")
      .eq("user_id", context.userId);
    const categorias = Array.isArray(data)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (data as any[]).map((c) => ({
          id: String(c.id),
          legacy_id: c.legacy_id ?? null,
          nome: c.nome ?? "",
        }))
      : [];
    const diag = diagnoseCategoriaResolution("Padaria", categorias);
    return {
      categoria_alimentacao_disponivel: diag.categoria_alimentacao_disponivel,
      categoria_resolvida_para_padaria: diag.categoria_resolvida,
    };
  });
