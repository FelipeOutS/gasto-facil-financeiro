import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { processarMensagemWhatsApp, sendWhatsAppReply } from "@/server/whatsapp.server";
import { logWebhookEvent, updateWebhookLog } from "@/server/logs.server";

/**
 * Verifies Meta's X-Hub-Signature-256 header against the raw request body
 * using WHATSAPP_APP_SECRET. Returns true when valid.
 */
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

/**
 * Webhook público do WhatsApp Cloud API (Meta).
 *
 *  GET  → verificação (hub.mode=subscribe, hub.verify_token, hub.challenge).
 *  POST → recebimento de mensagens reais.
 *
 * Segue o formato de payload do WhatsApp Cloud API. Mensagens não-texto
 * (imagem, áudio etc.) são ignoradas com 200 ok para não retentar.
 */

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

export const Route = createFileRoute("/api/public/whatsapp/expense")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ---- Verification (Meta calls GET when you save the webhook URL) ----
      // A Meta envia: ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
      // Devemos responder com o conteúdo PURO de hub.challenge (text/plain),
      // status 200. Caso o token esteja errado, retornar 403.
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

        if (mode === "subscribe" && token === envToken) {
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


      // ---- Receiving messages ----
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const rawBody = await request.text();

        if (!process.env.WHATSAPP_APP_SECRET) {
          console.error("[whatsapp] WHATSAPP_APP_SECRET not configured");
          await logWebhookEvent({
            provider: "whatsapp",
            status: "failed",
            http_status: 503,
            request_headers: request.headers,
            error_message: "webhook_not_configured",
          });
          return jsonResponse({ error: "webhook_not_configured" }, 503);
        }
        const sig = request.headers.get("x-hub-signature-256");
        if (!verifyMetaSignature(rawBody, sig)) {
          await logWebhookEvent({
            provider: "whatsapp",
            status: "failed",
            http_status: 403,
            request_headers: request.headers,
            error_message: "invalid_signature",
          });
          return jsonResponse({ error: "invalid_signature" }, 403);
        }

        let payload: unknown;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          await logWebhookEvent({
            provider: "whatsapp",
            status: "failed",
            http_status: 400,
            request_headers: request.headers,
            error_message: "invalid_json",
          });
          return jsonResponse({ error: "invalid_json" }, 400);
        }

        const flatMessages = extractMessages(payload);
        const logId = await logWebhookEvent({
          provider: "whatsapp",
          event_type: "messages",
          status: "received",
          request_headers: request.headers,
          request_body: payload,
        });

        if (flatMessages.length === 0) {
          if (logId) await updateWebhookLog(logId, { status: "ignored", http_status: 200, processing_time_ms: Date.now() - startedAt, error_message: "no_messages" });
          return jsonResponse({ ok: true, processed: 0, skipped: "no_messages" });
        }

        const results: Array<{ status: string; gasto_id?: string }> = [];
        for (const msg of flatMessages) {
          if (!msg.texto?.trim()) continue;
          if (msg.texto.length > 1000) {
            results.push({ status: "ignorada_grande" });
            continue;
          }
          try {
            const out = await processarMensagemWhatsApp(msg);
            results.push({ status: out.status, gasto_id: out.gastoId });
            if (out.resposta && msg.telefone) {
              try {
                await sendWhatsAppReply(msg.telefone, out.resposta);
              } catch (replyErr) {
                console.error("[whatsapp] reply send failed", replyErr);
              }
            }
          } catch (e) {
            console.error("[whatsapp] processar erro", e);
            results.push({ status: "erro" });
          }
        }
        if (logId) {
          await updateWebhookLog(logId, {
            status: "processed",
            http_status: 200,
            external_id: flatMessages[0]?.external_id ?? null,
            processing_time_ms: Date.now() - startedAt,
            response_body: { processed: results.length, results },
          });
        }
        return jsonResponse({ ok: true, processed: results.length, results });
      },
    },
  },
});

type FlatMessage = {
  external_id: string | null;
  telefone: string;
  texto: string;
  recebida_em?: string;
};

/**
 * Aceita 2 formatos:
 *  1) WhatsApp Cloud API: { entry: [{ changes: [{ value: { messages, metadata } }] }] }
 *  2) Formato simples: { telefone, texto, external_id?, recebida_em? }
 */
function extractMessages(payload: unknown): FlatMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;

  // Formato simples
  if (typeof obj.telefone === "string" && typeof obj.texto === "string") {
    return [
      {
        telefone: String(obj.telefone),
        texto: String(obj.texto),
        external_id:
          typeof obj.external_id === "string" ? obj.external_id : null,
        recebida_em:
          typeof obj.recebida_em === "string" ? obj.recebida_em : undefined,
      },
    ];
  }

  // Formato Meta
  const out: FlatMessage[] = [];
  const entries = Array.isArray(obj.entry) ? obj.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as { changes?: unknown[] }).changes)
      ? (entry as { changes: unknown[] }).changes
      : [];
    for (const ch of changes) {
      const value = (ch as { value?: Record<string, unknown> }).value;
      if (!value) continue;
      const messages = Array.isArray(value.messages)
        ? (value.messages as Array<Record<string, unknown>>)
        : [];
      for (const m of messages) {
        if (m.type !== "text") continue;
        const text = (m.text as { body?: string } | undefined)?.body ?? "";
        const from = typeof m.from === "string" ? m.from : "";
        if (!from || !text) continue;
        const id = typeof m.id === "string" ? m.id : null;
        const ts = typeof m.timestamp === "string" ? m.timestamp : null;
        out.push({
          external_id: id,
          telefone: from,
          texto: text,
          recebida_em: ts ? new Date(Number(ts) * 1000).toISOString() : undefined,
        });
      }
    }
  }
  return out;
}
