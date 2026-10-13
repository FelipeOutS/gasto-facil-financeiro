/**
 * Ligação do Assistente de Compras ao WhatsApp — atrás de WHATSAPP_SHOPPING_ENABLED
 * (DESLIGADA por padrão). Flag off → retorna null e o roteador segue intacto.
 * Ordem: intenção → flag → elegibilidade → chave → cota persistente → busca.
 * Sem SQL candidato aplicado, a RPC falha e a resposta é fail-closed SEM SerpApi.
 * Somente leitura financeira: nenhum insert/update/delete em tabelas financeiras.
 */
import { detectShoppingIntent } from "./shopping-intent";
import { handleShoppingMessage, type ShoppingDeps } from "./shopping-assistant";
import { createDbQuotaStore, type RpcFn } from "./shopping-quota-db";
import { buildFinanceSnapshot, type FinanceRows } from "./finance-snapshot";
import { ultimosMesesCompletos } from "./capacidade-compra";
import type { ShoppingQuotaStore } from "./shopping-quota";

export const MSG_SHOPPING_NAO_DISPONIVEL =
  "O assistente de compras não está disponível para sua conta. Os comandos financeiros continuam disponíveis.";

export type WhatsAppShoppingDeps = {
  env?: Record<string, string | undefined>;
  isEntitled?: (userId: string) => Promise<boolean>;
  quota?: ShoppingQuotaStore;
  loadFinance?: ShoppingDeps["loadFinance"];
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export function hojeSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Leitor read-only (SELECT apenas) do próprio usuário. */
export async function loadFinanceReadOnly(userId: string, hoje: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const meses = ultimosMesesCompletos(hoje);
  const inicio = `${meses[meses.length - 1]}-01`;
  const LIM = 2000;
  const [rec, gas, recs, contas] = await Promise.all([
    supabaseAdmin.from("receitas").select("id,data,valor,descricao,origem,tipo")
      .eq("user_id", userId).is("deleted_at", null).gte("data", inicio).lt("data", `${hoje.slice(0, 7)}-01`).limit(LIM),
    supabaseAdmin.from("gastos")
      .select("id,data,valor,gasto_fixo,recorrencia_id,total_parcelas,parcela_atual,grupo_parcelamento_id")
      .eq("user_id", userId).is("deleted_at", null).or(`data.gte.${inicio},total_parcelas.gt.1`).limit(LIM),
    supabaseAdmin.from("recorrencias").select("id,valor,status,frequencia").eq("user_id", userId).limit(LIM),
    supabaseAdmin.from("contas_a_pagar").select("id,nome,valor,status,gasto_id,recorrencia_id,data_vencimento")
      .eq("user_id", userId).gte("data_vencimento", `${hoje.slice(0, 7)}-01`).limit(LIM),
  ]);
  for (const r of [rec, gas, recs, contas]) {
    if (r.error || !Array.isArray(r.data)) throw new Error("finance_unavailable");
    if (r.data.length >= LIM) throw new Error("finance_too_many_rows"); // sem análise parcial
  }
  return buildFinanceSnapshot(hoje, {
    receitas: rec.data, gastos: gas.data, recorrencias: recs.data, contas: contas.data,
  } as unknown as FinanceRows);
}

export async function handleWhatsAppShopping(
  msg: { userId: string; externalId: string | null; text: string },
  deps: WhatsAppShoppingDeps = {},
): Promise<{ resposta: string } | null> {
  const env = deps.env ?? process.env;
  if (!detectShoppingIntent(msg.text)) return null;
  if (env.WHATSAPP_SHOPPING_ENABLED !== "true") return null;
  const entitled = deps.isEntitled
    ? await deps.isEntitled(msg.userId).catch(() => false)
    : await (async () => {
        const { getWhatsAppEntitlement } = await import("@/server/whatsapp-entitlement.server");
        return (await getWhatsAppEntitlement(msg.userId)).allowed;
      })().catch(() => false);
  if (!entitled) return { resposta: MSG_SHOPPING_NAO_DISPONIVEL };
  let quota = deps.quota;
  if (!quota) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    quota = createDbQuotaStore(supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as RpcFn);
  }
  const now = deps.now ?? (() => new Date());
  return handleShoppingMessage(msg, {
    enabled: true,
    apiKey: env.SERPAPI_API_KEY,
    quota,
    fetchImpl: deps.fetchImpl,
    now,
    loadFinance: deps.loadFinance ?? ((uid) => loadFinanceReadOnly(uid, hojeSaoPaulo(now()))),
  });
}
