import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/public/pluggy/worker  (para agendamento; ainda NÃO agendado)
 * Cabeçalho obrigatório `X-GI-Worker-Token` = PLUGGY_WORKER_TOKEN, separado do
 * token do webhook (que viaja na URL registrada na Pluggy); nunca a
 * chave pública). Processa a fila de webhooks e reconcilia itens atrasados.
 */
export const Route = createFileRoute("/api/public/pluggy/worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { safeEqual } = await import("@/lib/pluggy/rules");
        const expected = process.env.PLUGGY_WORKER_TOKEN ?? "";
        const got = request.headers.get("x-gi-worker-token") ?? "";
        if (!expected || !safeEqual(got, expected)) return new Response("unauthorized", { status: 401 });

        try {
          const q = await import("@/server/pluggy/pluggy-webhook-queue.server");
          const { createPluggyStore } = await import("@/server/pluggy/pluggy-store.server");
          const { createPluggyApi } = await import("@/server/pluggy/pluggy-api.server");
          const { syncItem } = await import("@/server/pluggy/pluggy-sync.server");
          const { assertPluggyAccess } = await import("@/server/pluggy/pluggy-access.server");
          const deps = {
            db: await q.createQueueDb(),
            store: await createPluggyStore(),
            api: createPluggyApi(),
            assertAccess: assertPluggyAccess,
            syncItem,
          };
          const processed = await q.drainWebhooks(deps);
          const reconciled = await q.reconcileItems(deps);
          return Response.json({ ok: true, processed, reconciled });
        } catch {
          return new Response("unavailable", { status: 503 });
        }
      },
    },
  },
});
