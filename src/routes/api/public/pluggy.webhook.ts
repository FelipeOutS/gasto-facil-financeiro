import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * POST /api/public/pluggy/webhook
 * - Autenticação: somente cabeçalho `X-GI-Webhook-Token`, configurado no
 *   recurso POST /webhooks da Pluggy, campo `headers`. Nunca aceita token
 *   na URL (incluindo Connect Token). Comparação em
 *   tempo constante.
 * - Apenas grava o evento na fila durável e responde; o processamento é feito
 *   por /api/public/pluggy/worker. Nunca confia no conteúdo do payload.
 */
const Payload = z.object({
  event: z.string().trim().min(1).max(80),
  eventId: z.string().trim().min(1).max(100).optional(),
  itemId: z.string().uuid().optional(),
  transactionIds: z.array(z.string().min(1).max(100)).max(5000).optional(),
});

export const Route = createFileRoute("/api/public/pluggy/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { safeEqual, PLUGGY_WEBHOOK_EVENTS } = await import("@/lib/pluggy/rules");
        const expected = process.env.PLUGGY_WEBHOOK_TOKEN ?? "";
        const got = request.headers.get("x-gi-webhook-token") ?? "";
        if (!expected || !safeEqual(got, expected)) return new Response("unauthorized", { status: 401 });

        const parsed = Payload.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("bad_request", { status: 400 });
        const p = parsed.data;
        if (!(PLUGGY_WEBHOOK_EVENTS as readonly string[]).includes(p.event) || !p.itemId) {
          return Response.json({ ok: true, ignored: true });
        }

        // Never merge distinct provider events using a truncated payload key.
        if (!p.eventId) return new Response("event_id_required", { status: 400 });
        const eventId = p.eventId;
        try {
          const { createQueueDb, receiveWebhook } = await import("@/server/pluggy/pluggy-webhook-queue.server");
          const r = await receiveWebhook(await createQueueDb(), {
            eventId,
            event: p.event,
            itemId: p.itemId,
            transactionIds: p.transactionIds,
          });
          return Response.json({ ok: true, status: r.status, duplicate: !r.isNew }, { status: 202 });
        } catch {
          // Não persistiu: 503 faz a Pluggy reenviar depois.
          return new Response("unavailable", { status: 503 });
        }
      },
    },
  },
});
