/**
 * Orquestrador do MVP do Assistente de Compras (dependências injetadas).
 * NÃO está ligado ao pipeline do WhatsApp nem a banco/chave reais.
 * Leitura financeira é só via `loadFinance` (read-only); nada é gravado.
 */
import { detectShoppingIntent, type ShoppingIntent } from "./shopping-intent";
import { searchShopping, type Offer } from "./serpapi-shopping";
import { rotuloVariante, variantesMisturadas } from "./offer-specs";
import { MSG_NAO_AVALIA, estimarCapacidadeCompra, resumoCapacidade, type CapacidadeInput } from "./capacidade-compra";
import { monthKeySaoPaulo, USER_MONTHLY_LIMIT, type ShoppingQuotaStore } from "./shopping-quota";

export const MSG_SEM_CHAVE =
  "A busca de ofertas ainda não está configurada. Nenhuma busca foi feita nem descontada. Os comandos financeiros continuam disponíveis.";
export const MSG_LIMITE_USUARIO =
  `Você já usou as ${USER_MONTHLY_LIMIT} buscas de compras deste mês. Elas renovam no dia 1º.`;
export const MSG_LIMITE_GLOBAL =
  "A busca de ofertas atingiu o limite geral do serviço neste mês. Tente novamente no próximo mês; isso não consumiu suas buscas.";
export const MSG_FALHA =
  "Não consegui buscar ofertas agora. Nada foi descontado se a busca não chegou a ser feita. Tente novamente em alguns minutos.";
export const MSG_SEM_OFERTAS = "Não encontrei ofertas confiáveis para esse produto exato agora.";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
export const horaBR = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
// Strip layout/URL injection from third-party text, retaining the real URL only in link replies.
export const textoCurto = (s: string, max: number) => s.replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/[*_~`\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
export const tituloPesquisa = (q: string) => textoCurto(q, 80).replace(/\bmacbook\b/gi, "MacBook").replace(/\b(air|pro)\b/gi, (s) => s[0].toUpperCase() + s.slice(1)).replace(/\bm(\d)\b/gi, "M$1").replace(/\b(\d+)gb\b/gi, "$1 GB");
export const varianteCompacta = (title: string) => rotuloVariante(title).replace(/Tela (\d+)"/, "$1″").replace(/SSD /, "").replace(/(\d+)(GB|TB)/g, "$1 $2");
export const instrucoesLinks = (n: number) => `🔗 Para abrir, responda ${Array.from({ length: n }, (_, i) => `*link ${i + 1}*`).join(", ")}. Também pode perguntar *em 10x?*`;

export function quotaLine(remaining: number): string {
  return `🔎 ${remaining}/${USER_MONTHLY_LIMIT} buscas restantes.${remaining === 2 ? " Atenção: restam só 2." : ""}`;
}

export function formatOffers(query: string, offers: Offer[], collectedAt: string, budget?: string): string {
  if (offers.length === 0) return MSG_SEM_OFERTAS;
  const shown = offers.slice(0, 3);
  const l = [`🛍️ *${tituloPesquisa(query)}*`, ""];
  shown.forEach((o, i) => l.push(`*${i + 1}. ${brl(o.priceCents)}* — ${textoCurto(o.store, 60)}`, varianteCompacta(o.title)));
  if (variantesMisturadas(shown.map((o) => o.title))) l.push("", "⚠️ Tela/SSD diferentes ou não informados: não digo qual é o mais barato. Diga a tela e o SSD para comparar a mesma configuração.");
  if (budget) l.push("", budget);
  l.push("", instrucoesLinks(shown.length), `🕒 ${horaBR(collectedAt)} (Brasília) · Preços sujeitos a mudanças.`, "Frete, estoque, juros e garantia: confira na loja.");
  return l.join("\n");
}

export type ShoppingDeps = {
  enabled: boolean;
  apiKey: string | undefined;
  quota: ShoppingQuotaStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Read-only; retorna dados do usuário sem o preço. */
  loadFinance?: (userId: string) => Promise<Omit<CapacidadeInput, "precoCents">>;
};

export async function handleShoppingMessage(
  msg: { userId: string; externalId: string | null; text: string },
  deps: ShoppingDeps,
  opts: { intent?: ShoppingIntent } = {},
): Promise<{ resposta: string; search?: { query: string; offers: Offer[]; collectedAt: string } } | null> {
  const intent = opts.intent ?? detectShoppingIntent(msg.text);
  if (!intent) return null;
  if (!deps.enabled) return { resposta: "O assistente de compras está em preparação. Os comandos financeiros continuam disponíveis." };
  if (!deps.apiKey?.trim()) return { resposta: MSG_SEM_CHAVE };
  if (!msg.externalId) return { resposta: MSG_FALHA };
  const now = deps.now?.() ?? new Date();
  const month = monthKeySaoPaulo(now);
  let r: Awaited<ReturnType<ShoppingQuotaStore["reserve"]>>;
  // Cota indisponível (ex.: SQL candidato não aplicado) → fail-closed, sem SerpApi.
  try { r = await deps.quota.reserve(msg.userId, msg.externalId, month); }
  catch { return { resposta: MSG_FALHA }; }
  if (r.state === "duplicate") return { resposta: r.previousReply ?? "Essa busca já está em andamento." };
  if (r.state === "user_quota") return { resposta: MSG_LIMITE_USUARIO };
  if (r.state === "global_quota") return { resposta: MSG_LIMITE_GLOBAL };

  const res = await searchShopping({ query: intent.query, wantsUsed: intent.wantsUsed, apiKey: deps.apiKey, fetchImpl: deps.fetchImpl, now: () => now });
  let budget: string | undefined;
  if (res.ok && res.offers.length > 0 && deps.loadFinance) {
    try {
      const fin = await deps.loadFinance(msg.userId);
      const cap = estimarCapacidadeCompra({ ...fin, precoCents: res.offers[0].priceCents });
      budget = variantesMisturadas(res.offers.map((o) => o.title))
        ? `${resumoCapacidade({ ...cap, cenarios: [] }, fin.alertas, fin.compromissos.filter((c) => c.tipo === "divida").length)}\nEscolha a tela e o SSD antes de simular.`
        : resumoCapacidade(cap, fin.alertas, fin.compromissos.filter((c) => c.tipo === "divida").length);
    } catch {
      budget = `💰 *Seu orçamento*\n${MSG_NAO_AVALIA}`;
    }
  }
  const body = res.ok ? formatOffers(intent.query, res.offers, res.collectedAt, budget) : MSG_FALHA;
  let userRemaining: number | null = null;
  // Falha ao finalizar deixa a reserva pendente; o banco a expira contando 2 chamadas (conservador).
  try { userRemaining = (await deps.quota.finish(msg.userId, msg.externalId, month, res.apiCalls, body)).userRemaining; }
  catch { userRemaining = null; }
  const resposta = res.apiCalls > 0 && userRemaining !== null ? `${body}\n\n${quotaLine(userRemaining)}` : body;
  return { resposta, ...(res.ok && res.offers.length > 0 ? { search: { query: intent.query, offers: res.offers, collectedAt: res.collectedAt } } : {}) };
}
