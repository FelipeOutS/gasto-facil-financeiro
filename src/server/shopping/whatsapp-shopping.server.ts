/**
 * Ligação do Assistente de Compras ao WhatsApp — atrás de WHATSAPP_SHOPPING_ENABLED
 * (DESLIGADA por padrão). Flag off → retorna null e o roteador segue intacto.
 * Ordem: intenção → flag → elegibilidade → chave → cota persistente → busca.
 * Sem SQL candidato aplicado, a RPC falha e a resposta é fail-closed SEM SerpApi.
 * Somente leitura financeira: nenhum insert/update/delete em tabelas financeiras.
 */
import { createHash } from "node:crypto";
import { detectShoppingIntent, type ShoppingIntent } from "./shopping-intent";
import { detectShoppingFollowup, resolverVariante, responderFollowupLocal, MSG_CONTEXTO_EXPIRADO, msgConfirmarVariante, type ShoppingContext } from "./shopping-followup";
import { createDbContextStore, type ShoppingContextStore } from "./shopping-context";
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
  contexts?: ShoppingContextStore;
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
  const [rec, gas, recs, contas, cards] = await Promise.all([
    supabaseAdmin.from("receitas").select("id,user_id,data,valor,descricao,origem,tipo")
      .eq("user_id", userId).is("deleted_at", null).gte("data", inicio).lt("data", `${hoje.slice(0, 7)}-01`).limit(LIM),
    supabaseAdmin.from("gastos")
      .select("id,user_id,data,valor,gasto_fixo,recorrencia_id,total_parcelas,parcela_atual,grupo_parcelamento_id,cartao_id")
      .eq("user_id", userId).is("deleted_at", null).or(`data.gte.${inicio},total_parcelas.gt.1`).limit(LIM),
    supabaseAdmin.from("recorrencias").select("id,user_id,valor,status,frequencia").eq("user_id", userId).limit(LIM),
    supabaseAdmin.from("contas_a_pagar").select("id,user_id,nome,valor,status,gasto_id,recorrencia_id,data_vencimento")
      // histórico dos 3 meses (fixos pagos) + qualquer conta não paga (vencidas antigas)
      .eq("user_id", userId).or(`data_vencimento.gte.${inicio},status.neq.pago`).limit(LIM),
    supabaseAdmin.from("cartoes").select("id,user_id,nome,banco").eq("user_id", userId).limit(LIM),
  ]);
  for (const r of [rec, gas, recs, contas, cards]) {
    if (r.error || !Array.isArray(r.data)) throw new Error("finance_unavailable");
    if (r.data.length >= LIM) throw new Error("finance_too_many_rows"); // sem análise parcial
  }
  return buildFinanceSnapshot(hoje, {
    receitas: rec.data, gastos: gas.data, recorrencias: recs.data, contas: contas.data, cartoes: cards.data,
  } as FinanceRows, { userId });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Piloto: WHATSAPP_SHOPPING_PILOT_USER_IDS (CSV de UUIDs) precisa conter o userId.
 * Vazio, ausente ou com qualquer item malformado → ninguém entra (sem fallback).
 */
export function isShoppingPilotUser(raw: string | undefined, userId: string | null | undefined): boolean {
  if (!raw || !userId || !UUID_RE.test(userId)) return false;
  const ids = raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (ids.length === 0 || ids.some((x) => !UUID_RE.test(x))) return false;
  return ids.some((x) => x.toLowerCase() === userId.toLowerCase());
}

export function phoneHash(phone: string): string {
  return createHash("sha256").update(phone.replace(/\D/g, "")).digest("hex");
}

export async function handleWhatsAppShopping(
  msg: { userId: string; phone: string; externalId: string | null; text: string },
  deps: WhatsAppShoppingDeps = {},
): Promise<{ resposta: string } | null> {
  const env = deps.env ?? process.env;
  // Flag OFF: nenhuma leitura (nem de contexto/tabelas novas) — o bot segue intacto.
  if (env.WHATSAPP_SHOPPING_ENABLED !== "true") return null;
  // Piloto: fora da allowlist → bot segue normal, sem contexto/cota/finanças/SerpApi.
  if (!isShoppingPilotUser(env.WHATSAPP_SHOPPING_PILOT_USER_IDS, msg.userId)) return null;
  const intent = detectShoppingIntent(msg.text);
  const fu = intent ? null : detectShoppingFollowup(msg.text);
  if (!intent && !fu) return null;
  const now = deps.now ?? (() => new Date());
  let rpc: RpcFn | null = null;
  const getRpc = async () => {
    if (!rpc) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as RpcFn;
    }
    return rpc;
  };
  const contexts = deps.contexts ?? createDbContextStore((fn, a) => getRpc().then((r) => r(fn, a)));
  const hash = phoneHash(msg.phone);

  let ctx: ShoppingContext | null = null;
  if (fu) {
    // Sem contexto de compras deste usuário+telefone, a frase curta não é nossa.
    try { ctx = await contexts.get(msg.userId, hash); } catch { return null; }
    if (!ctx) return null;
  }
  const entitled = deps.isEntitled
    ? await deps.isEntitled(msg.userId).catch(() => false)
    : await (async () => {
        const { getWhatsAppEntitlement } = await import("@/server/whatsapp-entitlement.server");
        return (await getWhatsAppEntitlement(msg.userId)).allowed;
      })().catch(() => false);
  if (!entitled) return { resposta: MSG_SHOPPING_NAO_DISPONIVEL };
  const loadFinance = deps.loadFinance ?? ((uid: string) => loadFinanceReadOnly(uid, hojeSaoPaulo(now())));

  let searchIntent: ShoppingIntent | undefined;
  if (fu && ctx) {
    if (ctx.expired || ctx.offers.length === 0) return { resposta: MSG_CONTEXTO_EXPIRADO };
    if (fu.kind !== "variante") {
      const fin = fu.kind === "loja" || fu.kind === "link" ? null : await loadFinance(msg.userId).catch(() => null);
      return { resposta: responderFollowupLocal(fu, ctx, hojeSaoPaulo(now()), fin) };
    }
    const q = resolverVariante(ctx.query, fu.termo);
    if (!q) return { resposta: msgConfirmarVariante(fu.termo) };
    searchIntent = { query: q, wantsBudget: true, wantsUsed: false };
  }
  const quota = deps.quota ?? createDbQuotaStore((fn, a) => getRpc().then((r) => r(fn, a)));
  const out = await handleShoppingMessage(msg, {
    enabled: true, apiKey: env.SERPAPI_API_KEY, quota, fetchImpl: deps.fetchImpl, now, loadFinance,
  }, { intent: searchIntent });
  if (!out) return null;
  if (out.search) {
    try { await contexts.save(msg.userId, hash, out.search.query, out.search.offers, out.search.collectedAt); }
    catch { /* sem contexto: continuações pedirão nova pesquisa */ }
  }
  return { resposta: out.resposta };
}
