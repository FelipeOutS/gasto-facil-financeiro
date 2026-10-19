import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * POST /api/public/pluggy/webhook?t=<PLUGGY_WEBHOOK_TOKEN>
 * - Autentica pelo token secreto (comparação em tempo constante).
 * - Idempotente por eventId (tabela pluggy_webhook_events, chave única).
 * - Dono identificado SOMENTE pelo itemId guardado no servidor.
 * - Nunca confia no conteúdo: busca os dados de novo na API da Pluggy.
 */
const Payload = z.object({
  event: z.string().max(80),
  eventId: z.string().max(100).optional(),
  itemId: z.string().uuid().optional(),
  transactionIds: z.array(z.string().max(100)).max(5000).optional(),
});

export const Route = createFileRoute("/api/public/pluggy/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { safeEqual, PLUGGY_WEBHOOK_EVENTS } = await import("@/lib/pluggy/rules");
        const expected = process.env.PLUGGY_WEBHOOK_TOKEN ?? "";
        const got = new URL(request.url).searchParams.get("t") ?? "";
        if (!expected || !safeEqual(got, expected)) return new Response("unauthorized", { status: 401 });

        const parsed = Payload.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("bad_request", { status: 400 });
        const p = parsed.data;
        if (!(PLUGGY_WEBHOOK_EVENTS as readonly string[]).includes(p.event) || !p.itemId) {
          return Response.json({ ok: true, ignored: true });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabaseAdmin as any;
        const eventId = p.eventId ?? `${p.event}:${p.itemId}:${(p.transactionIds ?? []).join(",").slice(0, 200)}`;
        const ins = await db.from("pluggy_webhook_events").insert({ event_id: eventId, event: p.event, item_id: p.itemId, status: "recebido" });
        if (ins.error) {
          if (ins.error.code === "23505") return Response.json({ ok: true, duplicate: true });
          return new Response("unavailable", { status: 503 }); // Pluggy reenvia depois
        }

        const { createPluggyStore } = await import("@/server/pluggy/pluggy-store.server");
        const store = await createPluggyStore();
        const owner = await store.getItemOwner(p.itemId);
        const finish = (status: string, error?: string) =>
          db.from("pluggy_webhook_events").update({ status, error: error ?? null, processed_at: new Date().toISOString() }).eq("event_id", eventId);
        if (!owner) {
          await finish("item_desconhecido");
          return Response.json({ ok: true });
        }
        try {
          if (p.event === "item/deleted") {
            await store.markItemDeleted(p.itemId);
          } else if (p.event === "transactions/deleted") {
            await store.markTransactionsDeleted(owner.userId, p.transactionIds ?? []);
          } else {
            const { createPluggyApi } = await import("@/server/pluggy/pluggy-api.server");
            const { syncItem } = await import("@/server/pluggy/pluggy-sync.server");
            const r = await syncItem({ api: createPluggyApi(), store }, { userId: owner.userId, itemId: p.itemId });
            await finish(r.ok ? "processado" : "falhou", r.ok ? undefined : r.error);
            return Response.json({ ok: true });
          }
          await finish("processado");
        } catch {
          await finish("falhou", "erro_interno");
        }
        return Response.json({ ok: true });
      },
    },
  },
});
