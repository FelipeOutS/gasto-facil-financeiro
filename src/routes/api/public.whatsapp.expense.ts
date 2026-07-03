import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import {
  logWhatsAppInboundReceived,
  processarMensagemWhatsApp,
  sendWhatsAppReply,
  sendWhatsAppInteractiveCtaUrl,
  WHATSAPP_HANDLER_VERSION,
} from "@/server/whatsapp.server";
import { logWebhookEvent, updateWebhookLog } from "@/server/logs.server";
import { checkRateLimit, getClientIp, RATE_LIMIT_PRESETS } from "@/server/rate-limit.server";
import {
  MAX_IMAGE_BYTES,
  validateDownloadedImage,
} from "@/server/whatsapp-media-validation.server";
import { MAX_PDF_BYTES, validateDownloadedPdf } from "@/server/whatsapp-pdf-validation.server";
import { podeUsarOcrComprovante } from "@/server/whatsapp-comprovantes.server";
import {
  canUseWhatsAppForSender,
  shouldSendBlockedReply,
  WHATSAPP_BLOCKED_REPLY,
} from "@/server/whatsapp-authz.server";
import {
  ALLOWED_AUDIO_MIME,
  bucketForBytes,
  getMaxAudioBytes,
  getMaxAudioSeconds,
  isWhatsAppAudioEnabled,
  logAudioDecision,
  validateDownloadedAudio,
  WHATSAPP_AUDIO_DISABLED_REPLY,
  WHATSAPP_AUDIO_UNINTELLIGIBLE_REPLY,
  WHATSAPP_AUDIO_UNSUPPORTED_LANGUAGE_REPLY,
  type AudioBytesBucket,
} from "@/server/whatsapp-audio.server";
import {
  bucketForDuration,
  measureAudioDuration,
  WHATSAPP_AUDIO_DURATION_UNAVAILABLE_REPLY,
  WHATSAPP_AUDIO_TOO_LONG_REPLY,
} from "@/server/whatsapp-audio-duration.server";
import { runTranscriber } from "@/server/whatsapp-transcription.server";
import { normalizeVoiceMoney } from "@/server/whatsapp-voice-number-normalizer.server";

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

// Allowlist de Admin Master vive em `src/server/admin-master.server.ts`
// (fonte única server-side). Este arquivo não precisa importar a lista —
// o gate de autorização (`canUseWhatsAppForSender`) já consulta a fonte
// central via `whatsapp-authz.server.ts`.


// Eligibilidade do telefone: delega ao gate único `canUseWhatsAppForSender`.
// Mantido como wrapper fino para preservar o call-site existente.
async function checkPhoneEligibility(
  telefone: string,
  canaryOn: boolean,
): Promise<{ allowed: boolean; userId?: string }> {
  return canUseWhatsAppForSender(telefone, { canaryOnly: canaryOn });
}

/**
 * WA-G5A.1 / WA-B3.2 — dedup pré-download por `external_id`.
 *
 * Bloqueia o reprocessamento quando a MESMA mensagem já gerou uma
 * confirmação persistida — não apenas de gasto. Cobre:
 *   - gasto confirmado (status = "salva" + gasto_id);
 *   - receita simples confirmada
 *     (status = "salva" + parsed.kind = "receita" + parsed.receita_id);
 *   - receita recorrente confirmada
 *     (status = "salva" + parsed.kind = "receita" + parsed.recorrencia_id);
 *   - comprovante com gasto confirmado
 *     (status = "salva" + gasto_id, kind = "imagem_comprovante").
 *
 * NÃO usa janela de tempo, valor, categoria ou similaridade —
 * deduplicação exclusivamente por `external_message_id` da Meta.
 */
async function externalIdAlreadyConfirmed(externalId: string | null): Promise<boolean> {
  if (!externalId) return false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { data } = await sb
      .from("whatsapp_messages")
      .select("id, status, gasto_id, parsed")
      .eq("external_id", externalId)
      .maybeSingle();
    if (!data) return false;
    if (data.status !== "salva") return false;
    // Gasto / comprovante com gasto confirmado.
    if (data.gasto_id) return true;
    // Receita simples ou recorrente já confirmada.
    const parsed = (data.parsed ?? {}) as {
      kind?: string;
      status?: string;
      receita_id?: string;
      recorrencia_id?: string;
    };
    if (parsed.kind === "receita" && parsed.status === "salva") {
      if (typeof parsed.receita_id === "string" && parsed.receita_id.length > 0) return true;
      if (typeof parsed.recorrencia_id === "string" && parsed.recorrencia_id.length > 0) return true;
    }
    return false;
  } catch {
    return false;
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
  // WA-G5A.4 — diagnóstico de versão do handler ativo em produção.
  // Permite confirmar tecnicamente qual deploy está respondendo sem
  // expor dado sensível algum.
  "X-WA-Handler-Version": WHATSAPP_HANDLER_VERSION,
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
// WA-V1 — mensagens de áudio (Cloud API). Aceita apenas o envelope; a
// validação real do tipo, tamanho e bytes mágicos acontece DEPOIS do
// gate de elegibilidade e da flag (ordem obrigatória do webhook).
const MetaAudioMessage = z.object({
  id: z.string().min(1).max(256),
  from: z.string().min(5).max(40).regex(/^\d+$/),
  timestamp: z.string().min(1).max(20).regex(/^\d+$/),
  type: z.literal("audio"),
  audio: z.object({
    id: z.string().min(1).max(256),
    mime_type: z.string().max(80).optional(),
    sha256: z.string().max(128).optional(),
    voice: z.boolean().optional(),
  }),
});
// WA-C10.b — documentos PDF (Cloud API). Aceitamos apenas application/pdf;
// validação real de bytes mágicos/tamanho/páginas é feita após o download.
const MetaDocumentMessage = z.object({
  id: z.string().min(1).max(256),
  from: z.string().min(5).max(40).regex(/^\d+$/),
  timestamp: z.string().min(1).max(20).regex(/^\d+$/),
  type: z.literal("document"),
  document: z.object({
    id: z.string().min(1).max(256),
    mime_type: z.string().max(80).optional(),
    sha256: z.string().max(128).optional(),
    filename: z.string().max(256).optional(),
    caption: z.string().max(1000).optional(),
  }),
});
const MetaAnyMessage = z.union([
  MetaTextMessage,
  MetaImageMessage,
  MetaAudioMessage,
  MetaDocumentMessage,
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
  audio?: {
    mediaId: string;
    mimeType?: string;
    sha256?: string;
  };
  document?: {
    mediaId: string;
    mimeType?: string;
    sha256?: string;
    filename?: string;
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
        // WA-V1 — áudio. Apenas extrai metadados; download/validação/
        // transcrição acontecem DEPOIS do gate de elegibilidade.
        const a = MetaAudioMessage.safeParse(m);
        if (a.success) {
          out.push({
            external_id: a.data.id,
            telefone: a.data.from,
            texto: "",
            recebida_em: new Date(Number(a.data.timestamp) * 1000).toISOString(),
            audio: {
              mediaId: a.data.audio.id,
              mimeType: a.data.audio.mime_type,
              sha256: a.data.audio.sha256,
            },
          });
        }
        // WA-C10.b — documento PDF. Apenas extrai metadados; download,
        // magic-bytes e pipeline OCR de boleto rodam depois do gate.
        const d = MetaDocumentMessage.safeParse(m);
        if (d.success) {
          const mime = d.data.document.mime_type?.toLowerCase();
          if (mime && mime !== "application/pdf") continue;
          out.push({
            external_id: d.data.id,
            telefone: d.data.from,
            texto: d.data.document.caption ?? "",
            recebida_em: new Date(Number(d.data.timestamp) * 1000).toISOString(),
            document: {
              mediaId: d.data.document.id,
              mimeType: mime,
              sha256: d.data.document.sha256,
              filename: d.data.document.filename,
            },
          });
        }
      }
    }
  }
  return out;
}

/**
 * Baixa os bytes de uma mídia do WhatsApp Cloud API e devolve o buffer
 * bruto + mime declarado pela Meta. A validação real (tamanho + bytes
 * mágicos) é feita pelo caller via `validateDownloadedImage` /
 * `validateDownloadedAudio`, não aqui.
 *
 * Importante: nenhum log inclui URL, token ou conteúdo. Apenas o nome
 * da exceção é registrado em falhas.
 */
async function downloadWhatsappMedia(
  mediaId: string,
  mimeFromMeta: string | undefined,
  maxBytes: number,
): Promise<{ buffer: Buffer; declaredMime?: string } | null> {
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
    // Limite duro: paramos de ler se passar de `maxBytes`, sem
    // bufferizar 100 MB de lixo enviado por um atacante.
    const buf = Buffer.from(await dl.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    return { buffer: buf, declaredMime: (meta.mime_type ?? mimeFromMeta)?.toLowerCase() };
  } catch (err) {
    // Não logamos `err.message`: pode conter a URL assinada da Meta.
    console.error("[whatsapp] media download failed:", err instanceof Error ? err.name : "unknown");
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
          // Mensagem precisa ter texto, imagem OU áudio.
          if (!msg.texto?.trim() && !msg.image && !msg.audio && !msg.document) continue;
          const messageType = msg.audio ? "audio" : msg.image ? "image" : msg.document ? "document" : "text";
          logWhatsAppInboundReceived({
            telefone: msg.telefone,
            externalId: msg.external_id,
            messageType,
          });
          // Gate único de elegibilidade: telefone não vinculado, sem
          // consentimento, sem beta ativa (ou fora do canário) → drop
          // silencioso. NÃO grava texto, NÃO cria sessão/gasto, NÃO
          // envia resposta, NÃO baixa mídia.
          const elig = await checkPhoneEligibility(msg.telefone, canaryOn);
          if (!elig.allowed) {
            // WA-G5B — número não autorizado.
            //  - Texto: resposta neutra, 1× por número/24h (anti-spam).
            //  - Imagem/áudio/anexo: silêncio total (já não baixamos mídia).
            // NÃO grava texto, NÃO grava telefone bruto em logs, NÃO
            // cria sessão, NÃO baixa mídia, NÃO chama OCR/IA/transcrição.
            if (msg.texto?.trim() && !msg.image && !msg.audio) {
              try {
                if (await shouldSendBlockedReply(msg.telefone)) {
                  await sendWhatsAppReply(msg.telefone, WHATSAPP_BLOCKED_REPLY);
                }
              } catch (replyErr) {
                console.error(
                  "[whatsapp] blocked reply failed:",
                  replyErr instanceof Error ? replyErr.name : "unknown",
                );
              }
            }
            if (msg.audio) {
              logAudioDecision({
                handlerVersion: WHATSAPP_HANDLER_VERSION,
                externalId: msg.external_id,
                decision: "blocked",
                mimeTypePresent: Boolean(msg.audio.mimeType),
                audioBytesBucket: null,
              });
            }
            results.push({ status: "nao_elegivel" });
            continue;
          }
          try {
            // WA-G5A.1 — ordem obrigatória para imagens:
            //   1) eligibilidade do telefone (já validada acima);
            //   2) dedup por external_id (mesma mensagem reenviada
            //      pela Meta com gasto JÁ confirmado → silêncio);
            //   3) entitlement de OCR ("importacoes");
            //   4) somente então baixa a mídia da Meta;
            //   5) valida tamanho real + bytes mágicos;
            //   6) converte em data URL e entrega ao pipeline.
            // WA-B3.1 — `authorizedUserId` propaga a identidade já
            // confirmada pelo gate único `canUseWhatsAppForSender`,
            // eliminando o lookup duplicado no pipeline. NÃO confiamos
            // em identidade vinda do payload livre da Meta.
            let runMsg: {
              external_id: string | null;
              telefone: string;
              texto: string;
              recebida_em?: string;
              authorizedUserId?: string;
              image?: { base64: string; mimeType?: string; sha256?: string };
              document?: { kind: "document"; base64: string; mimeType: "application/pdf"; sha256?: string };
              // WA-V1.3 — marcador de origem usado pelo pipeline textual
              // para liberar o vocabulário extra de voz (almoço/jantar)
              // na sugestão de categoria. Mensagens digitadas seguem
              // sem `source` definido e nada muda para elas.
              source?: "audio";
            } = {
              external_id: msg.external_id,
              telefone: msg.telefone,
              texto: msg.texto,
              recebida_em: msg.recebida_em,
              authorizedUserId: elig.userId,
            };
            if (msg.image) {
              // (2) external_id já confirmado → não baixa, não chama OCR.
              if (await externalIdAlreadyConfirmed(msg.external_id)) {
                results.push({ status: "duplicada" });
                continue;
              }
              // (3) entitlement de OCR. Sem plano → drop silencioso,
              // ANTES de qualquer chamada à Graph API.
              const podeOcr = elig.userId ? await podeUsarOcrComprovante(elig.userId) : false;
              if (!podeOcr) {
                results.push({ status: "sem_plano" });
                continue;
              }
              // (4) download da mídia.
              const dl = await downloadWhatsappMedia(msg.image.mediaId, msg.image.mimeType, MAX_IMAGE_BYTES);
              if (!dl) {
                results.push({ status: "imagem_indisponivel" });
                continue;
              }
              // (5) validação real: tamanho + bytes mágicos + mime
              // declarado X mime real.
              const ok = validateDownloadedImage(dl.buffer, dl.declaredMime);
              if (!ok) {
                results.push({ status: "imagem_invalida" });
                continue;
              }
              // (6) só agora converte em data URL para o OCR. A
              // data URL nunca é logada nem persistida.
              const dataUrl = `data:${ok.mimeType};base64,${dl.buffer.toString("base64")}`;
              runMsg.image = {
                base64: dataUrl,
                mimeType: ok.mimeType,
                sha256: msg.image.sha256,
              };
            } else if (msg.document) {
              // ---- WA-C10.b: PDF (sempre boleto). ----
              // Ordem: dedup → entitlement (reaproveita gate de OCR) →
              // download → magic-bytes + tamanho + páginas → data URL.
              if (await externalIdAlreadyConfirmed(msg.external_id)) {
                results.push({ status: "duplicada" });
                continue;
              }
              const podeOcr = elig.userId ? await podeUsarOcrComprovante(elig.userId) : false;
              if (!podeOcr) {
                results.push({ status: "sem_plano" });
                continue;
              }
              const dl = await downloadWhatsappMedia(msg.document.mediaId, msg.document.mimeType, MAX_PDF_BYTES);
              if (!dl) {
                results.push({ status: "documento_indisponivel" });
                continue;
              }
              const pdfOk = validateDownloadedPdf(new Uint8Array(dl.buffer), dl.declaredMime);
              if (!pdfOk.ok) {
                results.push({ status: `pdf_${pdfOk.reason}` });
                continue;
              }
              const dataUrl = `data:application/pdf;base64,${dl.buffer.toString("base64")}`;
              runMsg.document = {
                kind: "document",
                base64: dataUrl,
                mimeType: "application/pdf",
                sha256: msg.document.sha256,
              };
            } else if (msg.audio) {
              // WA-V1 — ordem obrigatória para áudio:
              //   rate-limit / raw body / HMAC / Zod / extração / gate
              //     (todos acima já passaram)
              //   → flag WHATSAPP_AUDIO_ENABLED
              //   → dedup external_id
              //   → validação tipo/tamanho
              //   → download
              //   → validação bytes reais
              //   → transcrição
              //   → pipeline textual
              const mimePresent = Boolean(msg.audio.mimeType);
              // (a) flag — usuário autorizado mas recurso desligado.
              if (!isWhatsAppAudioEnabled()) {
                logAudioDecision({
                  handlerVersion: WHATSAPP_HANDLER_VERSION,
                  externalId: msg.external_id,
                  decision: "feature_disabled",
                  mimeTypePresent: mimePresent,
                  audioBytesBucket: null,
                });
                try {
                  await sendWhatsAppReply(msg.telefone, WHATSAPP_AUDIO_DISABLED_REPLY);
                } catch (replyErr) {
                  console.error({
                    event: "wa_reply_failed",
                    errorName: replyErr instanceof Error ? replyErr.name : "unknown",
                  });
                }
                results.push({ status: "audio_desabilitado" });
                continue;
              }
              // (b) dedup técnico por external_id.
              if (await externalIdAlreadyConfirmed(msg.external_id)) {
                results.push({ status: "duplicada" });
                continue;
              }
              // (c) validação rápida do MIME declarado, ANTES do download.
              const declared = msg.audio.mimeType?.split(";")[0].trim().toLowerCase();
              if (declared && !ALLOWED_AUDIO_MIME.has(declared)) {
                logAudioDecision({
                  handlerVersion: WHATSAPP_HANDLER_VERSION,
                  externalId: msg.external_id,
                  decision: "unsupported_type",
                  mimeTypePresent: true,
                  audioBytesBucket: null,
                });
                results.push({ status: "audio_tipo_invalido" });
                continue;
              }
              // (d) download da mídia, com limite duro de bytes do áudio.
              const dl = await downloadWhatsappMedia(
                msg.audio.mediaId,
                msg.audio.mimeType,
                getMaxAudioBytes(),
              );
              if (!dl) {
                logAudioDecision({
                  handlerVersion: WHATSAPP_HANDLER_VERSION,
                  externalId: msg.external_id,
                  decision: "invalid_media",
                  mimeTypePresent: mimePresent,
                  audioBytesBucket: null,
                });
                results.push({ status: "audio_indisponivel" });
                continue;
              }
              // (e) validação real: tamanho + bytes mágicos + mime.
              const validated = validateDownloadedAudio(dl.buffer, dl.declaredMime);
              if (!validated.ok) {
                const decision =
                  validated.reason === "too_large"
                    ? "too_large"
                    : validated.reason === "unsupported_type" ||
                        validated.reason === "mime_mismatch"
                      ? "unsupported_type"
                      : "invalid_media";
                logAudioDecision({
                  handlerVersion: WHATSAPP_HANDLER_VERSION,
                  externalId: msg.external_id,
                  decision,
                  mimeTypePresent: mimePresent,
                  audioBytesBucket: bucketForBytes(dl.buffer.byteLength),
                });
                results.push({ status: "audio_invalido" });
                continue;
              }
              const bytesBucket: AudioBytesBucket = validated.bytesBucket;
              // (f) validação de duração real ANTES da transcrição.
              // Não confiamos em duração declarada pela Meta; medimos no
              // buffer já validado. Fail-closed: se a duração não pode
              // ser determinada com segurança, não enviamos para o ASR.
              const duration = measureAudioDuration(dl.buffer, validated.mimeType);
              const durationBucket = bucketForDuration(
                duration.durationSeconds,
                getMaxAudioSeconds(),
              );
              if (!duration.ok) {
                const decision =
                  duration.reason === "too_long" ? "too_long" : "duration_unavailable";
                logAudioDecision({
                  handlerVersion: WHATSAPP_HANDLER_VERSION,
                  externalId: msg.external_id,
                  decision,
                  mimeTypePresent: mimePresent,
                  audioBytesBucket: bytesBucket,
                  audioDurationBucket: durationBucket,
                });
                try {
                  await sendWhatsAppReply(
                    msg.telefone,
                    decision === "too_long"
                      ? WHATSAPP_AUDIO_TOO_LONG_REPLY
                      : WHATSAPP_AUDIO_DURATION_UNAVAILABLE_REPLY,
                  );
                } catch (replyErr) {
                  console.error({
                    event: "wa_reply_failed",
                    errorName: replyErr instanceof Error ? replyErr.name : "unknown",
                  });
                }
                results.push({
                  status: decision === "too_long" ? "audio_muito_longo" : "audio_duracao_indisponivel",
                });
                continue;
              }
              logAudioDecision({
                handlerVersion: WHATSAPP_HANDLER_VERSION,
                externalId: msg.external_id,
                decision: "valid_duration",
                mimeTypePresent: mimePresent,
                audioBytesBucket: bytesBucket,
                audioDurationBucket: durationBucket,
              });
              // (g) transcrição. Bytes apenas em memória; transcript não
              // é persistido nem logado.
              const transcription = await runTranscriber(dl.buffer, validated.mimeType);
              if (transcription.ok === false) {
                if (transcription.reason === "unsupported_language") {
                  logAudioDecision({
                    handlerVersion: WHATSAPP_HANDLER_VERSION,
                    externalId: msg.external_id,
                    decision: "transcription_unsupported_language",
                    mimeTypePresent: mimePresent,
                    audioBytesBucket: bytesBucket,
                  });
                  try {
                    await sendWhatsAppReply(
                      msg.telefone,
                      WHATSAPP_AUDIO_UNSUPPORTED_LANGUAGE_REPLY,
                    );
                  } catch (replyErr) {
                    console.error({
                      event: "wa_reply_failed",
                      errorName: replyErr instanceof Error ? replyErr.name : "unknown",
                    });
                  }
                  results.push({ status: "audio_idioma" });
                  continue;
                }
                const decision =
                  transcription.reason === "empty"
                    ? "transcription_empty"
                    : "transcription_failed";
                logAudioDecision({
                  handlerVersion: WHATSAPP_HANDLER_VERSION,
                  externalId: msg.external_id,
                  decision,
                  mimeTypePresent: mimePresent,
                  audioBytesBucket: bytesBucket,
                });
                try {
                  await sendWhatsAppReply(msg.telefone, WHATSAPP_AUDIO_UNINTELLIGIBLE_REPLY);
                } catch (replyErr) {
                  console.error({
                    event: "wa_reply_failed",
                    errorName: replyErr instanceof Error ? replyErr.name : "unknown",
                  });
                }
                results.push({ status: "audio_transcricao_falhou" });
                continue;
              }
              const transcript = transcription.text.trim();
              if (transcript.length < 2) {
                logAudioDecision({
                  handlerVersion: WHATSAPP_HANDLER_VERSION,
                  externalId: msg.external_id,
                  decision: "transcription_empty",
                  mimeTypePresent: mimePresent,
                  audioBytesBucket: bytesBucket,
                });
                try {
                  await sendWhatsAppReply(msg.telefone, WHATSAPP_AUDIO_UNINTELLIGIBLE_REPLY);
                } catch (replyErr) {
                  console.error({
                    event: "wa_reply_failed",
                    errorName: replyErr instanceof Error ? replyErr.name : "unknown",
                  });
                }
                results.push({ status: "audio_transcricao_vazia" });
                continue;
              }
              // (g) WA-V1.2 — normalização monetária em memória para
              // áudios. Converte valores falados por extenso
              // ("quarenta e dois reais") em formato numérico
              // ("R$ 42,00") ANTES de encaminhar ao pipeline textual
              // existente. Não criamos parser financeiro paralelo —
              // apenas adaptamos o texto. Transcript e texto
              // normalizado permanecem só em memória.
              const moneyNorm = normalizeVoiceMoney(transcript);
              console.log({
                event: "wa_audio_money_normalization",
                applied: moneyNorm.normalizedValuesCount > 0,
                moneyDetected: moneyNorm.moneyDetected,
                normalizedValuesCount: moneyNorm.normalizedValuesCount,
              });
              logAudioDecision({
                handlerVersion: WHATSAPP_HANDLER_VERSION,
                externalId: msg.external_id,
                decision: "routed_to_text_pipeline",
                mimeTypePresent: mimePresent,
                audioBytesBucket: bytesBucket,
              });
              runMsg = {
                ...runMsg,
                texto: moneyNorm.normalizedText,
                // WA-V1.3 — sinaliza ao pipeline textual que esta
                // mensagem nasceu de transcrição de áudio, liberando
                // sugestão de categoria por vocabulário de voz.
                source: "audio",
              };
            }

            const out = await processarMensagemWhatsApp(runMsg);
            results.push({ status: out.status, gasto_id: out.gastoId });
            // WA-3.27 — reentregas do mesmo wamid (status "duplicada")
            // NÃO devem gerar resposta visível ao usuário. A idempotência
            // financeira já barrou o gasto; aqui barramos qualquer
            // dispatch de saída (texto ou interactive CTA), evitando
            // "Mensagem já processada anteriormente" no chat.
            if (out.resposta && msg.telefone && out.status !== "duplicada") {
              try {
                // WA-PIX-UX-01.c — se o handler forneceu `interactive`,
                // preferimos a mensagem com botão CTA URL. Se o envio
                // interativo falhar (`sent=false`), caímos para o texto
                // plano `out.resposta` (que já inclui o link de fallback).
                let sentOk = false;
                if (out.interactive) {
                  const r = await sendWhatsAppInteractiveCtaUrl(
                    msg.telefone,
                    out.interactive,
                  );
                  sentOk = r.sent;
                }
                if (!sentOk) {
                  await sendWhatsAppReply(msg.telefone, out.resposta);
                }
              } catch (replyErr) {
                // WA-B3.4 — NUNCA logar err.message; pode conter URL
                // assinada da Graph, telefone, token ou body do payload.
                console.error({
                  event: "wa_reply_failed",
                  errorName: replyErr instanceof Error ? replyErr.name : "unknown",
                });
              }
            }
          } catch (e) {
            // WA-B3.4 — sanitização análoga ao reply: apenas o nome do
            // erro, nunca o message bruto (pode conter conteúdo).
            console.error({
              event: "wa_process_failed",
              errorName: e instanceof Error ? e.name : "unknown",
            });
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
