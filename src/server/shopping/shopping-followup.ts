/**
 * Continuações do Assistente de Compras (puras, sem I/O).
 * Só são consultadas quando existe contexto de compras do MESMO usuário+telefone.
 * Recalculam a partir das ofertas guardadas: NÃO chamam a SerpApi nem gastam cota.
 * Variante diferente ("e o Pro?", "e o M5?") vira NOVA busca — nunca reaproveita preço.
 */
import type { Offer } from "./serpapi-shopping";
import { rotuloLink } from "./offer-specs";
import { sanitizeQuery } from "./shopping-intent";
import { horaBR, tituloPesquisa, textoCurto, varianteCompacta, instrucoesLinks } from "./shopping-assistant";
import { safeUrl } from "./serpapi-shopping";
import { AVISO_APERTO, LIMITE_PCT_FOLGA, MSG_NAO_AVALIA, estimarCapacidadeCompra, type CapacidadeInput } from "./capacidade-compra";

export type ShoppingContext = { query: string; offers: Offer[]; collectedAt: string; expired: boolean };
export type Followup =
  | { kind: "parcelas"; n: number }
  | { kind: "guardar"; mes: number }
  | { kind: "loja" }
  | { kind: "link"; index: number }
  | { kind: "variante"; termo: string };

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const BLOQUEIO = /\b(comprei|paguei|gastei|parcelei|lancei|recebi|ganhei|cancel|confirm|ajust|desfaz|lembrete|lembra|agenda|comprovante|boleto|fatura|pix|cartao|conta|receita|nota|supermercado|mercado|feira|r\$)\b|\d+,\d{2}/;
const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const VARIANTES = ["air", "pro", "max", "mini", "plus", "ultra"];

export function detectShoppingFollowup(text: string): Followup | null {
  const n = norm(text ?? "").replace(/[?!.]+$/g, "").trim();
  if (!n || n.length > 120 || BLOQUEIO.test(n)) return null;
  const link = /^(?:(?:manda|me manda|envia|me envia) (?:o )?)?link ([1-3])$|^ver (?:a )?oferta ([1-3])$/.exec(n);
  if (link) return { kind: "link", index: Number(link[1] ?? link[2]) - 1 };
  if (/^(?:links?|manda links|me manda links)$/.test(n)) return { kind: "loja" };
  const p = /^(?:e |e se for |se for |e se fosse )?(?:em |no |parcelad[oa] em )?(\d{1,2}) ?(?:x|vezes|parcelas)$/.exec(n);
  if (p) { const k = Number(p[1]); return k >= 2 && k <= 24 ? { kind: "parcelas", n: k } : null; }
  const g = new RegExp(`(?:esperar|guardar|juntar).{0,40}\\b(?:ate|para|em) (${MESES.join("|")})\\b`).exec(n);
  if (g) return { kind: "guardar", mes: MESES.indexOf(g[1]) + 1 };
  if (/^(?:e )?(?:qual|quais|que) (?:e )?(?:a |as )?lojas?$|^onde (?:compro|encontro|tem)$|^(?:manda|me manda|qual) (?:o )?link$/.test(n)) return { kind: "loja" };
  const v = /^e (?:o|a|os|as|se for o|se for a) (.{2,40})$/.exec(n);
  if (v) return { kind: "variante", termo: v[1] };
  return null;
}

/** Nova busca para variante. null = ambíguo (pedir confirmação). */
export function resolverVariante(baseQuery: string, termo: string): string | null {
  const t = norm(termo);
  const palavras = t.split(" ");
  if (/^m\d$/.test(t)) return /\bm\d\b/.test(baseQuery) ? baseQuery.replace(/\bm\d\b/, t) : `${baseQuery} ${t}`;
  if (palavras.every((w) => VARIANTES.includes(w))) {
    const sem = baseQuery.split(" ").filter((w) => !VARIANTES.includes(w));
    if (sem.length === 0) return null;
    sem.splice(Math.min(1, sem.length), 0, ...palavras);
    return sanitizeQuery(sem.join(" "));
  }
  if (palavras.length >= 2 || /[a-z]\d|\d[a-z]/.test(t)) { const q = sanitizeQuery(t); return q.length >= 3 ? q : null; }
  return null;
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
export const ROTULO_SIMULACAO = "simulação matemática sem juros, não é oferta de parcelamento da loja";

/** Divide centavos sem perder nenhum: as primeiras `resto` parcelas levam 1 centavo a mais. */
export function dividirCentavos(total: number, n: number): { maior: number; menor: number; qtdMaior: number } {
  const menor = Math.floor(total / n);
  const qtdMaior = total - menor * n;
  return { maior: menor + (qtdMaior ? 1 : 0), menor, qtdMaior };
}
function textoParcelas(total: number, n: number): string {
  const d = dividirCentavos(total, n);
  return d.qtdMaior === 0 ? `${n}x de ${brl(d.menor)}` : `${d.qtdMaior}x de ${brl(d.maior)} + ${n - d.qtdMaior}x de ${brl(d.menor)}`;
}

export function mesesAte(hojeISO: string, mesAlvo: number): number {
  const mesAtual = Number(hojeISO.slice(5, 7));
  return mesAlvo > mesAtual ? mesAlvo - mesAtual : mesAlvo + 12 - mesAtual;
}

type Fin = Omit<CapacidadeInput, "precoCents"> | null;

function analiseFolga(valorMensal: number, fin: Fin): string {
  if (!fin) return MSG_NAO_AVALIA;
  const cap = estimarCapacidadeCompra({ ...fin, precoCents: Math.max(valorMensal, 1), parcelas: [] });
  if (cap.confianca === "insuficiente" || cap.folgaCents === null) return cap.mensagem;
  const pre = cap.confianca === "baixa" ? `⚠️ Histórico parcial (${cap.meses.length}/3 meses), baixa confiança. Não dá para confirmar que a compra cabe. ` : "";
  if (cap.folgaCents <= 0) return `${pre}Pela estimativa, sua folga mensal está zerada; isso não cabe hoje. ${AVISO_APERTO}`;
  const pct = Math.round((valorMensal * 1000) / cap.folgaCents) / 10;
  const aperta = valorMensal * 100 > LIMITE_PCT_FOLGA * cap.folgaCents;
  return `${pre}Isso é ${String(pct).replace(".", ",")}% da sua folga mensal estimada (${brl(cap.folgaCents)}; dinheiro guardado não entra).${aperta ? ` ${AVISO_APERTO}` : ""}`;
}

export function responderFollowupLocal(f: Exclude<Followup, { kind: "variante" }>, ctx: ShoppingContext, hojeISO: string, fin: Fin): string {
  if (ctx.expired || !ctx.offers.length) return MSG_CONTEXTO_EXPIRADO;
  const o = ctx.offers[0];
  const coleta = `Preço coletado em ${horaBR(ctx.collectedAt)} (Brasília); pode ter mudado.`;
  if (f.kind === "link") {
    const selected = ctx.offers[f.index];
    const url = selected ? safeUrl(selected.url) : null;
    if (!selected || !url) return `Essa oferta não está disponível. ${instrucoesLinks(ctx.offers.length)}`;
    return [`*${tituloPesquisa(ctx.query)}*`, `*${f.index + 1}. ${brl(selected.priceCents)}* — ${textoCurto(selected.store, 60)}`, varianteCompacta(selected.title), "", `${rotuloLink(url)}:`, url, "", coleta, "Frete, estoque, juros e garantia: confira na loja."].join("\n");
  }
  if (f.kind === "loja") {
    const l = ctx.offers.map((x, i) => `*${i + 1}. ${brl(x.priceCents)}* — ${textoCurto(x.store, 60)}\n${varianteCompacta(x.title)}`);
    return [`*Lojas · ${tituloPesquisa(ctx.query)}*`, ...l, "", instrucoesLinks(ctx.offers.length), coleta, "Frete, estoque, juros e garantia: confira na loja."].join("\n");
  }
  if (f.kind === "parcelas") {
    return [`${o.title} (${o.store}, ${brl(o.priceCents)}):`, `${textoParcelas(o.priceCents, f.n)} — ${ROTULO_SIMULACAO}.`,
      analiseFolga(dividirCentavos(o.priceCents, f.n).maior, fin), coleta, "Não fiz nova busca e nada foi descontado."].join("\n");
  }
  const meses = mesesAte(hojeISO, f.mes);
  const d = dividirCentavos(o.priceCents, meses);
  return [`Para juntar ${brl(o.priceCents)} (${o.store}) em ${meses} ${meses === 1 ? "mês" : "meses"}: cerca de ${brl(d.maior)} por mês.`,
    analiseFolga(d.maior, fin), "É só uma simulação: não criei meta nem mexi no seu dinheiro guardado.", coleta,
    "Não fiz nova busca e nada foi descontado."].join("\n");
}

export const MSG_CONTEXTO_EXPIRADO =
  "Sua última pesquisa de compras expirou (vale 20 minutos) e os preços podem ter mudado. Envie, por exemplo, “quero comprar <produto>” para pesquisar de novo.";
export const msgConfirmarVariante = (termo: string) =>
  `Para não misturar preços de produtos diferentes, preciso pesquisar de novo. Envie: “quero comprar ${termo}” (conta como 1 busca).`;
