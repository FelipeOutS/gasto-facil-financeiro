/** Pure WhatsApp research flow: public encyclopedia facts and user-supplied prices only. */
import {
  brl, comparisonNames, detectResearchIntent, isCurrentPriceQuestion, namedUserPrices,
  normalizeResearch, parseInstallmentOffer, parseInstallments, parseUserPriceCents, researchConcepts, splitInstallments,
  type ResearchContext, type ResearchProduct,
} from "./whatsapp-research-core";
import type { WikimediaArticle, WikimediaSource } from "./whatsapp-wikimedia.server";

export type ResearchResult = { reply: string; context: ResearchContext | null; contextChanged: boolean; lookups: number };
type Budget = (priceCents: number) => Promise<string>;
const NO_PRICE = "Não consulto preços ou estoque atuais de lojas. Se você me disser os preços que encontrou, posso comparar os valores.";
const NO_FACTS = "Não encontrei informação aberta suficiente para comparar esses modelos com segurança. Diga os preços que você encontrou se quiser comparar apenas o valor.";
const ATTRIBUTION = "Trecho abreviado da Wikipédia (CC BY-SA 4.0). Veja o artigo para contexto e atribuição completa:";

function selected(text: string, products: ResearchProduct[]): ResearchProduct | null {
  const t = normalizeResearch(text);
  const index = /\b(?:terceir[oa]|3)\b/.test(t) ? 2 : /\b(?:segund[oa]|2)\b/.test(t) ? 1 : /\b(?:primeir[oa]|1)\b/.test(t) ? 0 : -1;
  if (index >= 0) return products[index] ?? null;
  const named = products.filter(p => t.includes(normalizeResearch(p.name)));
  return named.length === 1 ? named[0] : products.length === 1 ? products[0] : null;
}

function product(name: string, article: WikimediaArticle | null, priceCents: number | null = null): ResearchProduct {
  return { name, priceCents, priceOrigin: priceCents === null ? null : "USER_PROVIDED", sourceUrl: article?.url ?? null, summary: article?.extract ?? null };
}

function articleLine(article: WikimediaArticle): string {
  return `${article.title}: ${article.extract}\n${ATTRIBUTION} ${article.url}`;
}

function priceComparison(products: ResearchProduct[]): string | null {
  if (products.length < 2 || products.some(p => p.priceOrigin !== "USER_PROVIDED" || p.priceCents === null)) return null;
  const [a, b] = products;
  if (products.length === 3) {
    const ordered = [...products].sort((left, right) => left.priceCents! - right.priceCents!);
    return `${products.map(p => `${p.name}: ${brl(p.priceCents!)}`).join("; ")}. ` +
      `${ordered[0].name} tem o menor preço informado por você; diferença até o maior: ${brl(ordered[2].priceCents! - ordered[0].priceCents!)}. ` +
      "Não confirmei preços atuais, estoque nem qual produto é melhor no conjunto.";
  }
  const difference = Math.abs(a.priceCents! - b.priceCents!);
  const cheaper = a.priceCents! === b.priceCents! ? null : a.priceCents! < b.priceCents! ? a.name : b.name;
  return `${a.name}: ${brl(a.priceCents!)}; ${b.name}: ${brl(b.priceCents!)}. ` +
    (cheaper ? `${cheaper} custa ${brl(difference)} menos pelos preços que você informou.` : "Os preços que você informou são iguais.") +
    " Não confirmei preços atuais, estoque nem qual produto é melhor no conjunto.";
}

function cleanName(text: string): string | null {
  const raw = text.trim().replace(/^(?:pesquis[ae]|procur[ae]|busqu[ae]|encontr[ae])\s+(?:um[ae]?\s+)?/i, "")
    .replace(/[?.!]+$/, "").trim();
  if (raw.length < 3 || raw.length > 70 || /\b(?:ate|até|por|preco|preço|barato|oferta|loja)\b/i.test(raw) || /https?:\/\//i.test(raw)) return null;
  return raw;
}

export async function runResearchMvp(input: {
  text: string; context: ResearchContext | null; source: WikimediaSource; budget: Budget; signal: AbortSignal; now?: Date;
}): Promise<ResearchResult | null> {
  const { text, context, source, budget, signal } = input;
  const intent = detectResearchIntent(text, !!context);
  if (!intent) return null;
  let lookups = 0;
  const lookup = async (topic: string) => { lookups++; return source.lookup(topic, signal); };
  const unchanged = (reply: string): ResearchResult => ({ reply, context, contextChanged: false, lookups });
  const changed = (reply: string, products: ResearchProduct[]): ResearchResult => ({
    reply, context: { products, researchedAt: (input.now ?? new Date()).toISOString() }, contextChanged: true, lookups,
  });

  if (/^\s*(?:pesquisar com ia|pesquisa inteligente)\s*$/i.test(text))
    return unchanged("Posso explicar conceitos e pesquisar informações abertas na Wikipédia. Para comparar preços, diga os valores que você encontrou. O que quer pesquisar?");
  if (/^\s*(?:pesquis[ae]|procur[ae])\s+(?:um[ae]?\s+)?(?:samsung|motorola|apple)\s*[.!?]*$/i.test(text))
    return unchanged("Você procura um celular, TV, notebook ou outro produto? Diga o modelo para eu buscar informações abertas.");
  const namedPrices = namedUserPrices(text);
  if (namedPrices.length === 2) {
    const products = namedPrices.map(p => product(p.name, null, p.priceCents));
    return changed(priceComparison(products)!, products);
  }

  if (context && intent === "followup") {
    const offer = parseInstallmentOffer(text);
    if (offer) {
      const chosen = selected(text, context.products);
      const productNote = chosen ? ` para ${chosen.name}` : context.products.length > 1 ? " (diga a qual produto se refere)" : "";
      return unchanged(`${offer.count}x de ${brl(offer.installmentCents)} corresponde a ${brl(offer.totalCents)} no total${productNote}, se não houver juros adicionais. ` +
        "É uma condição informada por você; não confirmei a oferta na loja nem alterei o preço salvo do produto.");
    }
    const count = parseInstallments(text);
    const userPrice = parseUserPriceCents(text);
    const chosen = selected(text, context.products);
    if (userPrice) {
      if (!chosen) return unchanged("Para qual produto é esse preço? Diga o nome ou use “primeiro” ou “segundo”.");
      const updated = context.products.map(p => p === chosen ? { ...p, priceCents: userPrice, priceOrigin: "USER_PROVIDED" as const } : p);
      return changed(`Anotei ${brl(userPrice)} para ${chosen.name} como preço informado por você. Não confirmei esse valor em lojas.`, updated);
    }
    if (/https?:\/\//i.test(text)) return unchanged("Não abro links enviados diretamente. Diga o preço que você encontrou e o nome do produto para eu comparar.");
    if (isCurrentPriceQuestion(text)) return unchanged(priceComparison(context.products) ?? NO_PRICE);
    if (/\b(?:compare|qual (?:tem|e) melhor|mais barato)\b/.test(normalizeResearch(text))) {
      const comparison = priceComparison(context.products);
      return unchanged(comparison ?? (context.products.every(p => p.summary) ?
        context.products.map(p => `${p.name}: ${p.summary}\nFonte: ${p.sourceUrl}`).join("\n\n") : NO_FACTS));
    }
    if (count) {
      if (!chosen) return unchanged("Qual produto você quer simular? Diga “primeiro em 10x”, por exemplo.");
      if (chosen.priceOrigin !== "USER_PROVIDED" || !chosen.priceCents) return unchanged("Informe o preço que você encontrou para simular parcelas.");
      const values = splitInstallments(chosen.priceCents, count);
      const low = Math.min(...values), high = Math.max(...values);
      return unchanged(`${chosen.name}: ${count} parcelas ${low === high ? `de ${brl(low)}` : `entre ${brl(low)} e ${brl(high)}`}, total ${brl(chosen.priceCents)}. Simulação sem juros; confira as condições reais da loja ou do cartão.`);
    }
    if (/\b(?:cabe no meu orcamento|consigo comprar)\b/.test(normalizeResearch(text))) {
      if (!chosen) return unchanged("Qual produto você quer avaliar? Diga “o primeiro cabe no meu orçamento?”.");
      if (chosen.priceOrigin !== "USER_PROVIDED" || !chosen.priceCents) return unchanged("Informe o preço que você encontrou antes de avaliar o orçamento.");
      return unchanged(`Preço informado por você para ${chosen.name}. ${await budget(chosen.priceCents)}`);
    }
    if (/\b(?:tela|camera|bateria|desempenho|avaliacoes|reclamam|problema conhecido)\b/.test(normalizeResearch(text)))
      return unchanged("Não encontrei dados comparáveis suficientes nas fontes abertas para responder a esse critério com segurança.");
    return unchanged(context.products.length ? `Posso explicar o que encontrei, comparar preços informados por você ou simular parcelas. ${NO_PRICE}` : NO_FACTS);
  }

  if (/https?:\/\//i.test(text))
    return unchanged("Não abro links enviados diretamente. Diga o nome ou modelo para pesquisar informações abertas; se tiver um preço, informe o valor.");

  const concepts = researchConcepts(text);
  if (intent === "general" && concepts.length) {
    const found = await Promise.all(concepts.map(c => lookup(c.query)));
    const articles = found.filter((x): x is WikimediaArticle => !!x);
    if (!articles.length) return unchanged("Não encontrei um artigo confiável para explicar esse conceito agora. Tente informar o nome exato do tema.");
    const missing = concepts.filter((_, i) => !found[i]).map(c => c.term);
    return unchanged(articles.map(articleLine).join("\n\n") +
      (missing.length ? `\n\nNão encontrei fonte Wikimedia suficiente para ${missing.join(" e ")}; não consigo compará-los com segurança.` : ""));
  }

  if (isCurrentPriceQuestion(text)) return unchanged(NO_PRICE);
  const names = comparisonNames(text);
  if (names.length >= 2) {
    const articles = await Promise.all(names.map(lookup));
    const products = names.map((name, i) => product(name, articles[i]));
    if (articles.some(a => !a)) return changed(NO_FACTS, products);
    return changed(`${articles.map(a => articleLine(a!)).join("\n\n")}\n\nEsses trechos não confirmam preço, estoque ou qual opção é melhor para você.`, products);
  }

  if (intent === "compare" && /^(?:compare|comparar)\s+/i.test(text.trim()))
    return unchanged("Para comparar com segurança, separe dois ou três modelos por vírgulas, por exemplo: “compare Galaxy, Motorola e iPhone”.");

  if (/\b(?:ate|até|por menos|oferta|barato|melhores opcoes|melhores opções)\b/i.test(text))
    return unchanged(`Posso pesquisar informações abertas sobre um modelo específico. ${NO_PRICE}`);
  const name = cleanName(text);
  if (!name) return unchanged(`Diga o modelo ou tema específico que quer pesquisar. ${NO_PRICE}`);
  const article = await lookup(name);
  if (!article) return changed("Não encontrei um artigo aberto que confirme informações sobre esse modelo. Não vou inventar especificações; informe outro modelo ou os preços que você encontrou.", [product(name, null)]);
  return changed(`${articleLine(article)}\n\nNão confirmei preço ou estoque atual.`, [product(name, article)]);
}
