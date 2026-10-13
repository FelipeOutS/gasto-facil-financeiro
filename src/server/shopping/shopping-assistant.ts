/**
 * Orquestrador do MVP do Assistente de Compras (dependências injetadas).
 * NÃO está ligado ao pipeline do WhatsApp nem a banco/chave reais.
 * Leitura financeira é só via `loadFinance` (read-only); nada é gravado.
 */
import { detectShoppingIntent } from "./shopping-intent";
import { searchShopping, type Offer } from "./serpapi-shopping";
import { estimarCapacidadeCompra, type CapacidadeInput } from "./capacidade-compra";
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
const horaBR = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function quotaLine(remaining: number): string {
  if (remaining <= 0) return "Você usou todas as 10 buscas deste mês.";
  if (remaining === 2) return "Atenção: restam só 2 buscas de compras este mês.";
  return `Você ainda tem ${remaining} de ${USER_MONTHLY_LIMIT} buscas este mês.`;
}

export function formatOffers(query: string, offers: Offer[], collectedAt: string): string {
  if (offers.length === 0) return MSG_SEM_OFERTAS;
  const l = [`🛒 Ofertas para "${query}":`, ""];
  offers.forEach((o, i) => l.push(`${i + 1}. ${o.title}`, `   ${brl(o.priceCents)} — ${o.store}`, `   ${o.url}`));
  l.push("", `Preços coletados em ${horaBR(collectedAt)} (Brasília). Podem mudar.`,
    "Frete, estoque, juros e garantia: confira na loja.");
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
): Promise<{ resposta: string } | null> {
  const intent = detectShoppingIntent(msg.text);
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
  let body = res.ok ? formatOffers(intent.query, res.offers, res.collectedAt) : MSG_FALHA;
  if (res.ok && res.offers.length > 0 && deps.loadFinance) {
    try {
      const fin = await deps.loadFinance(msg.userId);
      const cap = estimarCapacidadeCompra({ ...fin, precoCents: res.offers[0].priceCents });
      body += `\n\n💰 Com base na oferta mais barata encontrada:\n${cap.mensagem}`;
    } catch {
      body += "\n\nNão consegui estimar o impacto no seu orçamento agora.";
    }
  }
  const { userRemaining } = await deps.quota.finish(msg.userId, msg.externalId, month, res.apiCalls, body);
  const resposta = res.apiCalls > 0 ? `${body}\n\n${quotaLine(userRemaining)}` : body;
  return { resposta };
}
