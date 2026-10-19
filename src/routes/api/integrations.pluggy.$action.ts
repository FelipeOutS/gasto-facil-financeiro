import { isGiCategoria } from "@/lib/pluggy/categorias";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getUserFromRequest, unauthorizedResponse, forbiddenResponse } from "@/server/api-auth";

/**
 * /api/integrations/pluggy/:action — Open Finance (Fase 2, somente Sandbox).
 * Acesso: UUID na allowlist + papel owner (verificado no servidor a cada chamada).
 */
const json = (b: unknown, status = 200) => Response.json(b, { status });

async function authorize(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return { res: unauthorizedResponse() } as const;
  const { assertPluggyAccess } = await import("@/server/pluggy/pluggy-access.server");
  try {
    await assertPluggyAccess(user.id);
  } catch {
    return { res: forbiddenResponse("Open Finance restrito às contas autorizadas.") } as const;
  }
  return { userId: user.id } as const;
}

const ItemBody = z.object({ itemId: z.string().uuid() });
const SettingsBody = z.object({
  autoImport: z.boolean(),
  autoCategorize: z.boolean(),
  historyDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]),
});
const CategoriaBody = z.object({ transactionId: z.string().min(1).max(100), categoria: z.string().trim().refine(isGiCategoria, "categoria_invalida") });
const ReviewBody = z.object({ transactionId: z.string().min(1).max(100), decisao: z.enum(["aprovado", "rejeitado"]) });

export const Route = createFileRoute("/api/integrations/pluggy/$action")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const a = await authorize(request);
        if ("res" in a) return a.res;
        if (params.action !== "status") return new Response("not_found", { status: 404 });
        const { pluggyConfigured } = await import("@/server/pluggy/pluggy-api.server");
        const { PLUGGY_MODE } = await import("@/lib/pluggy/rules");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabaseAdmin as any;
        const [settings, items, accounts, txs] = await Promise.all([
          db.from("pluggy_settings").select("*").eq("user_id", a.userId).maybeSingle(),
          db.from("pluggy_items").select("item_id,connector_name,is_sandbox,status,execution_status,last_error,consent_expires_at,last_synced_at").eq("user_id", a.userId).is("deleted_at", null),
          db.from("pluggy_accounts").select("account_id,item_id,type,subtype,name,number_last4,balance,currency,credit_limit,available_credit,balance_due_date,updated_at").eq("user_id", a.userId),
          db.from("pluggy_transactions").select("transaction_id,account_id,description,amount,date,type,status,classification,classification_reason,categoria_sugerida,categoria_manual,review_status,mp_match_ids,total_installments,installment_number").eq("user_id", a.userId).is("deleted_at", null).order("date", { ascending: false }).limit(200),
        ]);
        const schemaReady = !items.error && !accounts.error && !txs.error && !settings.error;
        return json({
          configured: pluggyConfigured(),
          webhookConfigured: !!process.env.PLUGGY_WEBHOOK_TOKEN,
          mode: PLUGGY_MODE,
          schemaReady,
          settings: settings.data ?? null,
          items: items.data ?? [],
          accounts: accounts.data ?? [],
          transactions: txs.data ?? [],
        });
      },
      POST: async ({ request, params }) => {
        const a = await authorize(request);
        if ("res" in a) return a.res;
        const body = await request.json().catch(() => ({}));
        const { createPluggyApi, pluggyConfigured, PluggyHttpError } = await import("@/server/pluggy/pluggy-api.server");
        const { createPluggyStore } = await import("@/server/pluggy/pluggy-store.server");
        const { syncItem } = await import("@/server/pluggy/pluggy-sync.server");
        const { assertConnectorAllowed } = await import("@/lib/pluggy/rules");
        const { pluggyWebhookUrl } = await import("@/server/pluggy/pluggy-access.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabaseAdmin as any;
        if (!pluggyConfigured()) return json({ error: "pluggy_nao_configurado" }, 503);
        const api = createPluggyApi();

        try {
          switch (params.action) {
            case "connect-token": {
              const webhookUrl = pluggyWebhookUrl();
              if (!webhookUrl) return json({ error: "webhook_nao_configurado" }, 503);
              const parsed = z.object({ itemId: z.string().uuid().optional() }).parse(body);
              const prefCt = await db.from("pluggy_settings").select("user_id").eq("user_id", a.userId).maybeSingle();
              if (prefCt.error) return json({ error: "pluggy_store_indisponivel" }, 503);
              if (!prefCt.data) return json({ ok: false, error: "historico_nao_escolhido" }, 409);
              if (parsed.itemId) {
                const store = await createPluggyStore();
                const owner = await store.getItemOwner(parsed.itemId);
                if (owner?.userId !== a.userId) return forbiddenResponse();
              }
              const { results } = await api.sandboxConnectors();
              const connectorIds = results.filter((c) => c.isSandbox === true).map((c) => c.id);
              if (!connectorIds.length) return json({ error: "sem_conector_sandbox" }, 502);
              const { accessToken } = await api.connectToken(a.userId, webhookUrl, parsed.itemId);
              return json({ accessToken, connectorIds, includeSandbox: true });
            }
            case "register-item": {
              const { itemId } = ItemBody.parse(body);
              const item = await api.item(itemId);
              if (item.clientUserId !== a.userId) return forbiddenResponse("Conexão não pertence a esta conta.");
              assertConnectorAllowed(item.connector);
              const existing = await db.from("pluggy_items").select("user_id").eq("item_id", itemId).maybeSingle();
              if (existing.error) return json({ error: "pluggy_store_indisponivel" }, 503);
              if (existing.data && existing.data.user_id !== a.userId) return forbiddenResponse();
              const pref = await db.from("pluggy_settings").select("user_id").eq("user_id", a.userId).maybeSingle();
              if (pref.error) return json({ error: "pluggy_store_indisponivel" }, 503);
              if (!pref.data) return json({ ok: false, error: "historico_nao_escolhido" }, 409);
              if (!existing.data) {
                const ins = await db.from("pluggy_items").insert({
                  user_id: a.userId,
                  item_id: itemId,
                  connector_id: item.connector.id,
                  connector_name: item.connector.name,
                  is_sandbox: item.connector.isSandbox === true,
                  status: item.status,
                });
                if (ins.error) return json({ error: "pluggy_store_indisponivel" }, 503);
              }
              const r = await syncItem({ api, store: await createPluggyStore() }, { userId: a.userId, itemId });
              return json(r, r.ok ? 200 : 409);
            }
            case "sync": {
              const { itemId } = ItemBody.parse(body);
              const r = await syncItem({ api, store: await createPluggyStore() }, { userId: a.userId, itemId });
              return json(r, r.ok ? 200 : 409);
            }
            case "disconnect": {
              const { itemId } = ItemBody.parse(body);
              const store = await createPluggyStore();
              const owner = await store.getItemOwner(itemId);
              if (owner?.userId !== a.userId) return forbiddenResponse();
              await api.deleteItem(itemId).catch(() => undefined);
              await store.markItemDeleted(itemId); // dados já importados são preservados
              return json({ ok: true });
            }
            case "settings": {
              const s = SettingsBody.parse(body);
              // Fase 2: importação para Gastos/Receitas reais permanece travada.
              const r = await db.from("pluggy_settings").upsert(
                // auto_import é sempre false na Fase 2, independentemente do que o cliente enviar.
                { user_id: a.userId, auto_import: false, auto_categorize: s.autoCategorize, history_days: s.historyDays },
                { onConflict: "user_id" },
              );
              if (r.error) return json({ error: "pluggy_store_indisponivel" }, 503);
              // Confirma a persistência relendo do banco.
              const back = await db.from("pluggy_settings").select("history_days,auto_import,auto_categorize").eq("user_id", a.userId).maybeSingle();
              if (back.error || !back.data || back.data.history_days !== s.historyDays || back.data.auto_import !== false) {
                return json({ error: "preferencia_nao_confirmada" }, 503);
              }
              return json({ ok: true, historyDays: back.data.history_days, autoCategorize: back.data.auto_categorize });
            }
            case "resume": {
              const r = await db.from("pluggy_settings").update({ access_state: "ok", paused_reason: null }).eq("user_id", a.userId);
              return r.error ? json({ error: "pluggy_store_indisponivel" }, 503) : json({ ok: true });
            }
            case "categoria": {
              const c = CategoriaBody.parse(body);
              const r = await db.from("pluggy_transactions").update({ categoria_manual: c.categoria }).eq("user_id", a.userId).eq("transaction_id", c.transactionId);
              return r.error ? json({ error: "pluggy_store_indisponivel" }, 503) : json({ ok: true });
            }
            case "review": {
              const c = ReviewBody.parse(body);
              const r = await db.from("pluggy_transactions").update({ review_status: c.decisao }).eq("user_id", a.userId).eq("transaction_id", c.transactionId).eq("classification", "revisao");
              return r.error ? json({ error: "pluggy_store_indisponivel" }, 503) : json({ ok: true });
            }
            default:
              return new Response("not_found", { status: 404 });
          }
        } catch (e) {
          if (e instanceof z.ZodError) return json({ error: "entrada_invalida" }, 400);
          if (e instanceof PluggyHttpError) return json({ error: `pluggy_http_${e.status}` }, 502);
          const msg = e instanceof Error ? e.message : "erro";
          if (msg.startsWith("pluggy_")) return json({ error: msg }, 409);
          console.error("[pluggy] erro inesperado");
          return json({ error: "erro_interno" }, 500);
        }
      },
    },
  },
});
