import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { processarMensagemWhatsApp, sendWhatsAppReply } from "@/server/whatsapp.server";
import { logWebhookEvent, updateWebhookLog } from "@/server/logs.server";
import { checkRateLimit, getClientIp, RATE_LIMIT_PRESETS } from "@/server/rate-limit.server";

/**
 * Webhook público do WhatsApp Cloud API (Meta).
 *
 * Estado atual (2026-06):
 *   - O número oficial do WhatsApp Business ainda NÃO está configurado.
 *   - O endpoint está preparado, validado e seguro, mas só processa
 *     mensagens reais quando TODOS os secrets exigidos estiverem definidos
 *     e `WHATSAPP_ENABLED !== "false"`.
 *   - Enquanto a integração não estiver habilitada, o POST responde 503
 *     `whatsapp_not_configured`, NUNCA escreve no banco e NUNCA envia
 *     mensagem de resposta.
 *
 * Segurança:
 *   - HMAC SHA-256 verificada contra `WHATSAPP_APP_SECRET` (cabeçalho
 *     `x-hub-signature-256`) com comparação de tempo constante.
 *   - Payload validado com Zod (apenas o formato Meta é aceito; o "simple
 *     format" antigo foi removido para reduzir a superfície de ataque).
 *   - Rate limit por IP+rota.
 *   - Telefones e textos completos NUNCA são gravados em `webhook_logs`;
 *     apenas contagens e identificadores externos.
 */

// ----- Feature flags --------------------------------------------------
// `WHATSAPP_ENABLED` precisa estar explicitamente "true" para permitir
// gravação. Qualquer outro valor (vazio, "false", undefined) mantém o
// endpoint em modo seguro de "preparado, mas inativo".
function isWhatsAppEnabled(): boolean {
  const flag = (process.env.WHATSAPP_ENABLED ?? "").trim().toLowerCase();
  if (flag !== "true") return false;
  const required = [
    process.env.WHATSAPP_APP_SECRET,
    process.env.WHATSAPP_VERIFY_TOKEN,
    process.env.WHATSAPP_ACCESS_TOKEN,
    process.env.WHATSAPP_PHONE_NUMBER_ID,
  ];
  return required.every((v) => typeof v === "string" && v.trim().length > 0);
}

// Modo canário: quando "true", APENAS mensagens vindas de um telefone
// vinculado a um Admin Master (vínculo ativo + consentimento LGPD válido)
// são processadas. Mensagens de qualquer outro número recebem 200 OK,
// SEM criar gasto, SEM responder, SEM salvar texto ou dados financeiros.
function isCanaryEnabled(): boolean {
  return (process.env.WHATSAPP_CANARY_ENABLED ?? "").trim().toLowerCase() === "true";
}

const ADMIN_MASTER_EMAILS = [
  "felipe.out.silva@outlook.com",
  "michael@medeiroscenografia.com.br",
] as const;

/**
 * Resolve o telefone para userId via whatsapp_links e checa elegibilidade:
 *  - Admin Master sempre passa.
 *  - Demais usuários só passam se houver beta ativa (whatsapp_beta_access).
 *  - Em modo canário, somente Admin Master passa, independente de beta.
 * Retorna `{ allowed: false }` para qualquer caso negativo, inclusive
 * telefone sem vínculo ou sem consentimento.
 */
async function checkPhoneEligibility(
  telefone: string,
  canaryOn: boolean,
): Promise<{ allowed: boolean }> {
  const digits = telefone.replace(/\D/g, "");
  if (!digits) return { allowed: false };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const candidatos = new Set<string>([telefone, digits]);
    if (digits.startsWith("55")) candidatos.add(digits.slice(2));
    else candidatos.add(`55${digits}`);

    const { data: link } = await sb
      .from("whatsapp_links")
      .select("user_id, ativo, opt_in_em, revogado_em")
      .in("telefone", Array.from(candidatos))
      .limit(1)
      .maybeSingle();
    if (!link || !link.ativo || link.revogado_em || !link.opt_in_em) {
      return { allowed: false };
    }
    const { data: u } = await sb.auth.admin.getUserById(link.user_id);
    const email: string | null = (u?.user?.email ?? "").trim().toLowerCase() || null;
    const isAdmin =
      !!email && (ADMIN_MASTER_EMAILS as ReadonlyArray<string>).includes(email);

    if (canaryOn) return { allowed: isAdmin };
    if (isAdmin) return { allowed: true };

    // Beta fechada
    const { data: ok } = await sb.rpc("can_use_whatsapp", { _user_id: link.user_id });
    return { allowed: ok === true };
  } catch {
    return { allowed: false };
  }
}

function verifyMetaSignature(rawBody: string, headerValue: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !headerValue) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = headerValue.startsWith("sha256=") ? headerValue.slice(7) : headerValue;
  if (received.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// ----- Zod schema do payload Meta -------------------------------------
// Aceita apenas a estrutura oficial do WhatsApp Cloud API. Mensagens não-texto
// e eventos desconhecidos são ignorados sem erro (200 ok) para evitar retentativas.
const MetaTextMessage = z.object({
  id: z.string().min(1).max(256),
  from: z.string().min(5).max(40).regex(/^\d+$/),
  timestamp: z.string().min(1).max(20).regex(/^\d+$/),
  type: z.literal("text"),
  text: z.object({ body: z.string().min(1).max(1000) }),
});
// WA-G5A — mensagens de imagem (Cloud API). Aceita apenas mime-types
// suportados pelo OCR existente do site: jpeg/png/webp.
const MetaImageMessage = z.object({
  id: z.string().min(1).max(256),
  from: z.string().min(5).max(40).regex(/^\d+$/),
  timestamp: z.string().min(1).max(20).regex(/^\d+$/),
  type: z.literal("image"),
  image: z.object({
    id: z.string().min(1).max(256),
    mime_type: z.string().max(80).optional(),
    sha256: z.string().max(128).optional(),
    caption: z.string().max(1000).optional(),
  }),
});
const MetaAnyMessage = z.union([
  MetaTextMessage,
  MetaImageMessage,
  z.object({ id: z.string().optional(), type: z.string() }).passthrough(),
]);
const MetaChange = z.object({
  value: z
    .object({
      messages: z.array(MetaAnyMessage).max(50).optional(),
      metadata: z.unknown().optional(),
    })
    .passthrough(),
  field: z.string().optional(),
});
const MetaEntry = z.object({
  id: z.string().optional(),
  changes: z.array(MetaChange).max(20),
});
const MetaPayload = z.object({
  object: z.string().optional(),
  entry: z.array(MetaEntry).max(20),
});

type FlatMessage = {
  external_id: string | null;
  telefone: string;
  texto: string;
  recebida_em?: string;
  image?: {
    mediaId: string;
    mimeType?: string;
    sha256?: string;
  };
};

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

function extractIncomingMessages(payload: z.infer<typeof MetaPayload>): FlatMessage[] {
  const out: FlatMessage[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const messages = change.value.messages ?? [];
      for (const m of messages) {
        const t = MetaTextMessage.safeParse(m);
        if (t.success) {
          out.push({
            external_id: t.data.id,
            telefone: t.data.from,
            texto: t.data.text.body,
            recebida_em: new Date(Number(t.data.timestamp) * 1000).toISOString(),
          });
          continue;
        }
        const i = MetaImageMessage.safeParse(m);
        if (i.success) {
          const mime = i.data.image.mime_type;
          if (mime && !ALLOWED_IMAGE_MIME.has(mime.toLowerCase())) continue;
          out.push({
            external_id: i.data.id,
            telefone: i.data.from,
            texto: i.data.image.caption ?? "",
            recebida_em: new Date(Number(i.data.timestamp) * 1000).toISOString(),
            image: {
              mediaId: i.data.image.id,
              mimeType: mime,
              sha256: i.data.image.sha256,
            },
          });
        }
      }
    }
  }
  return out;
}

/**
 * Baixa o bytes de uma mídia do WhatsApp Cloud API e devolve uma data URL
 * pronta para o OCR. Faz duas chamadas: GET /v20.0/{media_id} → url; depois
 * GET dessa url com bearer. Nunca expõe a URL retornada. Retorna null em
 * qualquer erro.
 */
async function downloadWhatsappMedia(
  mediaId: string,
  mimeFromMeta?: string,
): Promise<{ dataUrl: string; mimeType: string } | null> {
  try {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) return null;
    const lookup = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!lookup.ok) return null;
    const meta = (await lookup.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;
    const dl = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!dl.ok) return null;
    const buf = Buffer.from(await dl.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 15 * 1024 * 1024) return null;
    const mimeType = (meta.mime_type ?? mimeFromMeta ?? "image/jpeg").toLowerCase();
    if (!ALLOWED_IMAGE_MIME.has(mimeType)) return null;
    return { dataUrl: `data:${mimeType};base64,${buf.toString("base64")}`, mimeType };
  } catch (err) {
    console.error("[whatsapp] media download failed", err instanceof Error ? err.message : "unknown");
    return null;
  }
}

const MAX_RAW_BODY = 64 * 1024; // 64KB

export const Route = createFileRoute("/api/public/whatsapp/expense")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ---- Verificação (Meta chama GET ao salvar o webhook) ----
      GET: async ({ request }) => {
        const envToken = process.env.WHATSAPP_VERIFY_TOKEN;
        if (!envToken) {
          return new Response("Verify token not configured", {
            status: 500,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }

        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        if (
          mode === "subscribe" &&
          typeof token === "string" &&
          token.length === envToken.length &&
          timingSafeEqual(Buffer.from(token), Buffer.from(envToken))
        ) {
          return new Response(challenge ?? "", {
            status: 200,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
        return new Response("Invalid verify token", {
          status: 403,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        });
      },

      // ---- Recebimento de mensagens ----
      POST: async ({ request }) => {
        const startedAt = Date.now();

        // Rate limit por IP+rota antes de qualquer trabalho pesado.
        const ip = getClientIp(request);
        const ua = request.headers.get("user-agent");
        const rl = await checkRateLimit({
          key: `whatsapp_webhook:${ip ?? "unknown"}`,
          route: "/api/public/whatsapp/expense",
          ip_address: ip,
          user_agent: ua,
          method: "POST",
          ...RATE_LIMIT_PRESETS.whatsappWebhook,
        });
        if (rl.blocked) {
          await logWebhookEvent({
            provider: "whatsapp",
            status: "ignored",
            http_status: 429,
            error_message: "rate_limited",
            processing_time_ms: Date.now() - startedAt,
          });
          return new Response(JSON.stringify({ error: "rate_limited" }), {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(rl.retryAfterSeconds),
              ...corsHeaders,
            },
          });
        }

        // Feature flag: enquanto a integração não estiver habilitada, o
        // endpoint NÃO escreve no banco, NÃO envia resposta e NÃO loga
        // payload. Apenas retorna 503 com mensagem genérica.
        if (!isWhatsAppEnabled()) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.warn("[whatsapp] whatsapp_not_configured — webhook in safe mode");
          }
          await logWebhookEvent({
            provider: "whatsapp",
            status: "failed",
            http_status: 503,
            error_message: "whatsapp_not_configured",
            processing_time_ms: Date.now() - startedAt,
          });
          return jsonResponse({ error: "whatsapp_not_configured" }, 503);
        }

        // Limite de tamanho do corpo bruto antes de qualquer parse.
        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (contentLength > MAX_RAW_BODY) {
          await logWebhookEvent({
            provider: "whatsapp",
            status: "failed",
            http_status: 413,
            error_message: "payload_too_large",
            processing_time_ms: Date.now() - startedAt,
          });
          return jsonResponse({ error: "payload_too_large" }, 413);
        }

        const rawBody = await request.text();
        if (rawBody.length > MAX_RAW_BODY) {
          await logWebhookEvent({
            provider: "whatsapp",
            status: "failed",
            http_status: 413,
            error_message: "payload_too_large",
            processing_time_ms: Date.now() - startedAt,
          });
          return jsonResponse({ error: "payload_too_large" }, 413);
        }

        // Verificação HMAC obrigatória.
        const sig = request.headers.get("x-hub-signature-256");
        if (!verifyMetaSignature(rawBody, sig)) {
          await logWebhookEvent({
            provider: "whatsapp",
            status: "failed",
            http_status: 403,
            error_message: "invalid_signature",
            processing_time_ms: Date.now() - startedAt,
          });
          return jsonResponse({ error: "invalid_signature" }, 403);
        }

        // Parse + validação Zod.
        let payload: z.infer<typeof MetaPayload>;
        try {
          const json = JSON.parse(rawBody);
          payload = MetaPayload.parse(json);
        } catch {
          await logWebhookEvent({
            provider: "whatsapp",
            status: "failed",
            http_status: 400,
            error_message: "invalid_payload",
            processing_time_ms: Date.now() - startedAt,
          });
          // 200 para a Meta não retentar payloads malformados.
          return jsonResponse({ ok: true, skipped: "invalid_payload" });
        }

        const flatMessages = extractIncomingMessages(payload);

        // Log seguro: apenas contagem e primeiro external_id, sem texto/telefone.
        const logId = await logWebhookEvent({
          provider: "whatsapp",
          event_type: "messages",
          status: "received",
          external_id: flatMessages[0]?.external_id ?? null,
        });

        if (flatMessages.length === 0) {
          if (logId) {
            await updateWebhookLog(logId, {
              status: "ignored",
              http_status: 200,
              processing_time_ms: Date.now() - startedAt,
              error_message: "no_messages",
            });
          }
          return jsonResponse({ ok: true, processed: 0, skipped: "no_messages" });
        }

        const canaryOn = isCanaryEnabled();
        const results: Array<{ status: string; gasto_id?: string }> = [];
        for (const msg of flatMessages) {
          // Mensagem precisa ter texto OU imagem (WA-G5A).
          if (!msg.texto?.trim() && !msg.image) continue;
          // Gate único de elegibilidade: telefone não vinculado, sem
          // consentimento, sem beta ativa (ou fora do canário) → drop
          // silencioso. NÃO grava texto, NÃO cria sessão/gasto, NÃO
          // envia resposta.
          const elig = await checkPhoneEligibility(msg.telefone, canaryOn);
          if (!elig.allowed) {
            results.push({ status: "nao_elegivel" });
            continue;
          }
          try {
            // Para imagens, baixar a mídia agora (com WHATSAPP_ACCESS_TOKEN)
            // e converter em data URL ANTES de chamar o pipeline. A imagem
            // bruta não é persistida — só hash e mime ficam em parsed.
            let runMsg: {
              external_id: string | null;
              telefone: string;
              texto: string;
              recebida_em?: string;
              image?: { base64: string; mimeType?: string; sha256?: string };
            } = { external_id: msg.external_id, telefone: msg.telefone, texto: msg.texto, recebida_em: msg.recebida_em };
            if (msg.image) {
              const dl = await downloadWhatsappMedia(msg.image.mediaId, msg.image.mimeType);
              if (!dl) {
                // Falha no download → drop silencioso para o usuário.
                results.push({ status: "imagem_indisponivel" });
                continue;
              }
              runMsg.image = {
                base64: dl.dataUrl,
                mimeType: dl.mimeType,
                sha256: msg.image.sha256,
              };
            }
            const out = await processarMensagemWhatsApp(runMsg);
            results.push({ status: out.status, gasto_id: out.gastoId });
            if (out.resposta && msg.telefone) {
              try {
                await sendWhatsAppReply(msg.telefone, out.resposta);
              } catch (replyErr) {
                // Não logar o erro com payload; apenas a mensagem.
                console.error(
                  "[whatsapp] reply send failed:",
                  replyErr instanceof Error ? replyErr.message : "unknown",
                );
              }
            }
          } catch (e) {
            console.error(
              "[whatsapp] processar erro:",
              e instanceof Error ? e.message : "unknown",
            );
            results.push({ status: "erro" });
          }
        }
        if (logId) {
          await updateWebhookLog(logId, {
            status: "processed",
            http_status: 200,
            processing_time_ms: Date.now() - startedAt,
            // response_body sem PII: só contagem por status
            response_body: {
              processed: results.length,
              statuses: results.reduce<Record<string, number>>((acc, r) => {
                acc[r.status] = (acc[r.status] ?? 0) + 1;
                return acc;
              }, {}),
            },
          });
        }
        return jsonResponse({ ok: true, processed: results.length });
      },
    },
  },
});
