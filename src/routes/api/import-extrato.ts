import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  ensurePremiumFeatureAccess,
} from "@/server/api-auth";
import { enforceUserRateLimit } from "@/server/rate-limit.server";
import { extractText, extractTextItems, getDocumentProxy } from "unpdf";

/**
 * Importação de extrato bancário (Pix, transferências, débito, tarifas, entradas, saídas).
 *
 * Aceita:
 *   - { pdf: "data:application/pdf;base64,..." }            → PDF (texto ou OCR)
 *   - { imagens: ["data:image/jpeg;base64,...", ...] }      → até 10 imagens/prints
 *
 * NUNCA persiste nada — apenas devolve sugestões para o usuário revisar.
 * Mascara CPF, número de cartão completo, agência/conta longas antes de mandar pra IA.
 */

const CATEGORIAS_VALIDAS = [
  "aluguel",
  "moradia",
  "mercado",
  "alimentacao",
  "transporte",
  "casa",
  "saude",
  "lazer",
  "educacao",
  "contas",
  "assinaturas",
  "farmacia",
  "online",
  "presentes",
  "pet",
  "trabalho",
  "roupas",
  "besteiras",
  "cabeleireiro",
  "outros",
];

const FORMAS_VALIDAS = [
  "pix",
  "dinheiro",
  "debito",
  "credito",
  "boleto",
  "transferencia",
  "vale_alimentacao",
  "vale_refeicao",
  "outro",
];

const TIPOS_MOV = ["despesa", "receita", "transferencia_interna"] as const;

const SYSTEM_PROMPT = `Você analisa EXTRATOS BANCÁRIOS brasileiros (Pix, transferências, TED, débito, tarifas, entradas e saídas).

OBJETIVO: extrair UMA LISTA de movimentações da conta. Para CADA item, preencha:
- descricao: descrição curta e clara do lançamento (ex: "Pix recebido de João", "Compra no débito - Padaria")
- idOperacao: ID/código da operação quando existir no extrato (Mercado Pago usa "ID da operação")
- valor: SEMPRE positivo, em reais. Vírgula é decimal, ponto é milhar.
- saldo: saldo após o lançamento quando existir
- data: ISO YYYY-MM-DD
- horario: HH:mm 24h se aparecer, senão null
- tipoMovimentacao: "despesa" | "receita" | "transferencia_interna"
- formaPagamento: um destes ids → ${FORMAS_VALIDAS.join(", ")}
- categoriaSugerida: um destes ids (use "outros" se não souber) → ${CATEGORIAS_VALIDAS.join(", ")}
- origemImportacao: "extrato_pdf" quando vier de PDF
- bancoOrigem: "Mercado Pago" quando identificado
- statusRevisao: "novo" | "pagamento_fatura_cartao" | "reserva" | "resgate_reserva" | "investimentos" | "revisar"
- contraparte: nome do remetente/destinatário se aparecer (ex: "MARIA DA SILVA"), curto, sem CPF/CNPJ
- confianca: "alta" | "media" | "baixa"

REGRAS DE CLASSIFICAÇÃO:
- Pix enviado, compra no débito, pagamento de boleto, tarifa, IOF, anuidade → tipoMovimentacao="despesa"
- Pix recebido, salário, transferência recebida, reembolso, estorno, rendimento → tipoMovimentacao="receita"
- "Transferência entre contas próprias", "Aplicação", "Resgate de investimento", "Movimentação interna" → tipoMovimentacao="transferencia_interna"
- Mercado Pago: "Pagamento Cartão de crédito" → transferencia_interna, statusRevisao="pagamento_fatura_cartao", não despesa comum.
- Mercado Pago: "Reserva por gastos", "Dinheiro reservado" → transferencia_interna, statusRevisao="reserva".
- Mercado Pago: "Dinheiro retirado" → transferencia_interna, statusRevisao="resgate_reserva".
- IGNORE linhas que claramente NÃO são lançamentos: saldo anterior, saldo do dia, total, subtotal, cabeçalhos.
- NÃO transforme pagamento de fatura em despesa comum; isso duplicaria gastos do cartão.

FORMA DE PAGAMENTO heurística:
- "PIX" → pix
- "TED", "DOC", "TRANSF" → transferencia
- "DÉBITO", "DEB", "COMPRA NO DÉBITO" → debito
- "BOLETO", "PGTO BOLETO" → boleto
- "TARIFA", "IOF", "ANUIDADE" → outro
- Crédito de salário, depósito → transferencia

CATEGORIA SUGERIDA heurística:
- iFood/restaurante/lanchonete → alimentacao
- Uber/99/posto/combustível → transporte
- Netflix/Spotify/assinatura → assinaturas
- Farmácia/drogaria → farmacia
- Mercado/supermercado/atacado → mercado
- Shopee/Amazon/Magalu → online
- Conta de luz/água/internet/telefone → contas
- Salário/freelance/comissão → trabalho
- Tarifa bancária, IOF → contas

PRIVACIDADE — NUNCA inclua na descrição: número completo do cartão, CVV, senha, CPF, número completo de conta/agência. Se aparecer, omita ou mascare.

COMPLETUDE OBRIGATÓRIA — Liste TODAS as movimentações do trecho, sem cortar, sem resumir, sem limitar a 20/24/30 itens. Se houver 80, devolva 80. Mantenha a descrição completa do lançamento (não trunque). Não invente movimentações que não estejam no texto.

Se o conteúdo não parece um extrato legível, retorne itens=[] com observacao explicando.`;

type ItemBruto = {
  descricao: unknown;
  valor: unknown;
  data: unknown;
  idOperacao?: unknown;
  saldo?: unknown;
  origemImportacao?: unknown;
  bancoOrigem?: unknown;
  statusRevisao?: unknown;
  horario?: unknown;
  tipoMovimentacao?: unknown;
  formaPagamento?: unknown;
  categoriaSugerida?: unknown;
  contraparte?: unknown;
  confianca?: unknown;
  observacao?: unknown;
};

type ExtratoResumo = {
  banco: string | null;
  periodoInicio: string | null;
  periodoFim: string | null;
  saldoInicial: number | null;
  totalEntradas: number | null;
  totalSaidas: number | null;
  saldoFinal: number | null;
};

const TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "registrar_movimentacoes_extrato",
    description: "Estrutura a lista de movimentações encontradas no extrato bancário.",
    parameters: {
      type: "object",
      properties: {
        itens: {
          type: "array",
          items: {
            type: "object",
            properties: {
              descricao: { type: ["string", "null"] },
              valor: { type: ["number", "null"] },
              data: { type: ["string", "null"] },
              idOperacao: { type: ["string", "null"] },
              saldo: { type: ["number", "null"] },
              origemImportacao: { type: ["string", "null"] },
              bancoOrigem: { type: ["string", "null"] },
              statusRevisao: { type: ["string", "null"] },
              horario: { type: ["string", "null"] },
              tipoMovimentacao: {
                type: "string",
                enum: [...TIPOS_MOV],
              },
              formaPagamento: {
                type: ["string", "null"],
                enum: [...FORMAS_VALIDAS, null],
              },
              categoriaSugerida: {
                type: ["string", "null"],
                enum: [...CATEGORIAS_VALIDAS, null],
              },
              contraparte: { type: ["string", "null"] },
              confianca: { type: "string", enum: ["alta", "media", "baixa"] },
              observacao: { type: ["string", "null"] },
            },
            required: ["confianca", "tipoMovimentacao"],
            additionalProperties: false,
          },
        },
        observacao: { type: ["string", "null"] },
      },
      required: ["itens"],
      additionalProperties: false,
    },
  },
};

function decodeBase64Pdf(dataUri: string): Uint8Array | null {
  const m = dataUri.match(/^data:application\/pdf(?:;[^,]*)?;base64,(.+)$/i);
  const b64 = m ? m[1] : dataUri.startsWith("data:") ? null : dataUri;
  if (!b64) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function sanitizeText(text: string): string {
  return (
    text
      // 16 dígitos com ou sem espaços/hífens → mantém só últimos 4
      .replace(/\b(?:\d[ -]?){12}(\d{4})\b/g, "**** **** **** $1")
      // CPF formatado
      .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[CPF]")
      // CPF sem formato (11 dígitos isolados)
      .replace(/(?<!\d)\d{11}(?!\d)/g, "[CPF]")
      // CNPJ
      .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "[CNPJ]")
      // Agência/conta longas (ex: 1234-5 / 12345678-9)
      .replace(/\bAg(?:ência|encia)?[:\s]*\d{4,6}[-\s]?\d{0,2}\b/gi, "[Agência]")
      .replace(/\bConta[:\s]*\d{5,}[-\s]?\d{0,2}\b/gi, "[Conta]")
      // CVV
      .replace(/\bCVV[:\s]*\d{3,4}\b/gi, "[CVV]")
      .slice(0, 200_000)
  );
}

function stripAccents(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseValorBR(raw: string): number | null {
  const cleaned = raw.replace(/R\$/gi, "").replace(/\s/g, "").trim();
  if (!cleaned) return null;
  const negative = /^-/.test(cleaned) || /-$/.test(cleaned) || /^\(/.test(cleaned);
  let n = cleaned.replace(/[()\-+]/g, "");
  if (n.includes(",") && n.includes(".")) n = n.replace(/\./g, "").replace(",", ".");
  else if (n.includes(",")) n = n.replace(",", ".");
  const parsed = Number(n);
  if (!Number.isFinite(parsed) || parsed === 0) return null;
  return negative ? -parsed : parsed;
}

function parseDataBR(raw: string, fallbackYear?: number): string | null {
  let m = raw.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
  if (m) {
    const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    const mo = Number(m[2]);
    const d = Number(m[1]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = raw.match(/\b(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = raw.match(/\b(\d{1,2})[\/.\-](\d{1,2})\b/);
  if (m && fallbackYear) {
    const mo = Number(m[2]);
    const d = Number(m[1]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      return `${fallbackYear}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function guessYearFromText(text: string): number {
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  const valid = years.find((y) => y >= 2020 && y <= 2100);
  return valid ?? new Date().getFullYear();
}

function suggestCategory(desc: string): string {
  const t = stripAccents(desc).toLowerCase();
  if (/uber|\b99\b|transporte|posto|combustivel|metro|onibus/.test(t)) return "transporte";
  if (/mercado|mercearia|comercial|supermerc|atacad|carrefour|assai|extra/.test(t))
    return "mercado";
  if (/sabesp|eletropaulo|enel|claro|vivo|tim\b|internet|energia|agua|conta/.test(t))
    return "contas";
  if (/food|burger|lanches|grill|restaurante|ifood|rappi|padaria|pizzaria/.test(t))
    return "alimentacao";
  if (/rendimento|juros/.test(t)) return "outros";
  if (/meli dolar|invest|resgate|aplicacao/.test(t)) return "outros";
  return "outros";
}

function classifyMercadoPago(
  desc: string,
  signedValue: number,
): Pick<
  ItemBruto,
  "tipoMovimentacao" | "formaPagamento" | "categoriaSugerida" | "statusRevisao" | "observacao"
> {
  const t = stripAccents(desc).toLowerCase();
  if (
    /pagamento.*cart[aã]o.*cr[eé]dito|cart[aã]o de cr[eé]dito|pagamento.*fatura|fatura.*cart[aã]o/.test(
      t,
    )
  ) {
    return {
      tipoMovimentacao: "transferencia_interna",
      formaPagamento: "boleto",
      categoriaSugerida: "contas",
      statusRevisao: "pagamento_fatura_cartao",
      observacao:
        "Pagamento de fatura detectado. Não será contado como nova despesa para evitar duplicidade.",
    };
  }
  // Cofrinho / Guardado — termos do Mercado Pago e nomes de objetivo (ex: "COMPRAR PLAY 5")
  if (
    /reserva por gastos|dinheiro reservado|reservado|cofrinho|guardar|guardei|caixinha|meta de poupanca/.test(
      t,
    )
  ) {
    return {
      tipoMovimentacao: "transferencia_interna",
      formaPagamento: "transferencia",
      categoriaSugerida: "outros",
      statusRevisao: "reserva",
      observacao: "Movimento para Guardado/Cofrinho. Não conta como gasto comum.",
    };
  }
  if (
    /dinheiro retirado|retirado.*reserva|resgate.*reserva|retirei.*cofrinho|resgate.*cofrinho/.test(
      t,
    )
  ) {
    return {
      tipoMovimentacao: "transferencia_interna",
      formaPagamento: "transferencia",
      categoriaSugerida: "outros",
      statusRevisao: "resgate_reserva",
      observacao: "Retirada do Guardado/Cofrinho. Não entra como receita comum.",
    };
  }
  // Transferência entre contas próprias
  if (
    /transferencia.*entre.*contas|entre contas proprias|minha conta|conta nubank|conta itau|conta inter|para minha conta/.test(
      t,
    )
  ) {
    return {
      tipoMovimentacao: "transferencia_interna",
      formaPagamento: "transferencia",
      categoriaSugerida: "outros",
      statusRevisao: "revisar",
      observacao: "Possível transferência entre contas próprias. Revise antes de confirmar.",
    };
  }
  if (/rendimento|venda de meli dolar/.test(t)) {
    return {
      tipoMovimentacao: "receita",
      formaPagamento: "transferencia",
      categoriaSugerida: "outros",
      statusRevisao: /venda de meli dolar/.test(t) ? "investimentos" : "novo",
      observacao: /venda de meli dolar/.test(t)
        ? "Investimento/resgate identificado; revise antes de confirmar."
        : null,
    };
  }
  if (/pix recebido|transferencia recebida|recebido/.test(t) && signedValue > 0) {
    return {
      tipoMovimentacao: "receita",
      formaPagamento: "pix",
      categoriaSugerida: "outros",
      statusRevisao: "novo",
      observacao: null,
    };
  }
  if (/pagamento com qr pix|qr pix|pix enviado|pix/.test(t)) {
    return {
      tipoMovimentacao: signedValue > 0 ? "receita" : "despesa",
      formaPagamento: "pix",
      categoriaSugerida: suggestCategory(desc),
      statusRevisao: "novo",
      observacao: null,
    };
  }
  if (/pagamento de conta|boleto|conta/.test(t)) {
    return {
      tipoMovimentacao: "despesa",
      formaPagamento: "boleto",
      categoriaSugerida: suggestCategory(desc),
      statusRevisao: "novo",
      observacao: null,
    };
  }
  return {
    tipoMovimentacao: signedValue > 0 ? "receita" : "despesa",
    formaPagamento: /ted|doc|transf/.test(t) ? "transferencia" : "outro",
    categoriaSugerida: suggestCategory(desc),
    statusRevisao: "novo",
    observacao: null,
  };
}

function parseMercadoPagoStructuredText(text: string): {
  itens: ItemBruto[];
  observacao: string | null;
  banco: string | null;
  resumo: ExtratoResumo;
} | null {
  const normalized = stripAccents(text).toLowerCase();
  const hasMercadoPago = /mercado\s*pago/.test(normalized);
  const hasColumns =
    /data[\s\S]{0,80}descri[cç][aã]o[\s\S]{0,160}id da opera[cç][aã]o[\s\S]{0,160}valor/i.test(
      text,
    );
  if (!hasMercadoPago && !hasColumns) return null;

  const fallbackYear = guessYearFromText(text);
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Linhas a ignorar (cabeçalhos, totais)
  const skipLine = (l: string) => {
    const lo = stripAccents(l).toLowerCase();
    return (
      /^(data|descricao|id da operacao|valor|saldo)$/i.test(l) ||
      /saldo (inicial|final|do dia|anterior)/i.test(lo) ||
      /total de (entradas|saidas)/i.test(lo) ||
      /^periodo\b|^per[ií]odo\b/i.test(lo) ||
      /^p[áa]gina\b|^pagina \d+/i.test(lo) ||
      /^extrato\b/i.test(lo) ||
      /^cnpj\b|^cpf\b/i.test(lo)
    );
  };

  const dateAtStart = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?\b/;
  const moneyRegex = /[+-]?\s*(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|[+-]?\s*(?:R\$\s*)?\d+,\d{2}/g;
  const opIdRegex = /\b([A-Z0-9][A-Z0-9._\-]{6,})\b/;

  // Segmenta em blocos: cada bloco começa numa linha que começa com data.
  type Block = { dateStr: string; lines: string[] };
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const line of rawLines) {
    if (skipLine(line)) continue;
    const m = line.match(dateAtStart);
    if (m) {
      if (current) blocks.push(current);
      current = { dateStr: m[0], lines: [line.slice(m[0].length).trim()].filter(Boolean) };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);

  const itens: ItemBruto[] = [];
  for (const block of blocks) {
    const data = parseDataBR(block.dateStr, fallbackYear);
    if (!data) continue;
    const joined = block.lines.join(" ").replace(/\s+/g, " ").trim();
    if (!joined) continue;

    // Encontra todos os valores monetários do bloco
    const moneyMatches = joined.match(moneyRegex) || [];
    if (moneyMatches.length === 0) continue;

    // Heurística: o último valor é o saldo (quando há 2+); o penúltimo é o valor da movimentação.
    // Se houver apenas 1, esse é o valor da movimentação.
    let valorStr: string | undefined;
    let saldoStr: string | undefined;
    if (moneyMatches.length >= 2) {
      valorStr = moneyMatches[moneyMatches.length - 2];
      saldoStr = moneyMatches[moneyMatches.length - 1];
    } else {
      valorStr = moneyMatches[0];
    }
    if (!valorStr) continue;
    const signedValue = parseValorBR(valorStr);
    if (signedValue === null) continue;

    // ID da operação: token alfanumérico longo (>=7) que não seja um valor.
    const opMatch = joined.match(opIdRegex);
    let idOperacao: string | null = null;
    if (opMatch && !/^\d+[.,]?\d*$/.test(opMatch[1])) {
      idOperacao = opMatch[1];
    }

    // Descrição: remove os matches de valor e o ID encontrado.
    let desc = joined;
    for (const mv of moneyMatches) desc = desc.replace(mv, " ");
    if (idOperacao) desc = desc.replace(idOperacao, " ");
    desc = desc.replace(/\s+/g, " ").trim();
    if (!desc) desc = "Movimentação bancária";

    const classification = classifyMercadoPago(desc, signedValue);
    itens.push({
      descricao: desc,
      valor: Math.abs(signedValue),
      data,
      horario: null,
      idOperacao,
      saldo: saldoStr ? parseValorBR(saldoStr) : null,
      origemImportacao: "extrato_pdf",
      bancoOrigem: hasMercadoPago ? "Mercado Pago" : null,
      confianca: idOperacao ? "alta" : "media",
      ...classification,
    });
  }

  const resumo = extractMercadoPagoResumo(
    text,
    hasMercadoPago ? "Mercado Pago" : null,
    fallbackYear,
  );
  if (itens.length === 0 && hasColumns) {
    return {
      itens: [],
      banco: resumo.banco,
      resumo,
      observacao:
        "Encontramos texto no PDF, mas não conseguimos identificar as colunas de movimentação.",
    };
  }
  return itens.length > 0 ? { itens, banco: resumo.banco, resumo, observacao: null } : null;
}

function extractMercadoPagoResumo(
  text: string,
  banco: string | null,
  fallbackYear: number,
): ExtratoResumo {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const money = /[+-]?\s*(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|[+-]?\s*(?:R\$\s*)?\d+,\d{2}/g;
  const amountFromLine = (line: string) => {
    const matches = line.match(money);
    return matches?.length ? parseValorBR(matches[matches.length - 1]) : null;
  };
  const findByLabel = (labels: RegExp[]) => {
    const line = lines.find((l) =>
      labels.some((label) => label.test(stripAccents(l).toLowerCase())),
    );
    return line ? amountFromLine(line) : null;
  };
  const periodText = lines.find((l) => /periodo|período/i.test(l)) ?? "";
  const periodDates = [...periodText.matchAll(/\b\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?\b/g)].map(
    (m) => parseDataBR(m[0], fallbackYear),
  );
  return {
    banco,
    periodoInicio: periodDates[0] ?? null,
    periodoFim: periodDates[1] ?? null,
    saldoInicial: findByLabel([/saldo inicial/]),
    totalEntradas: findByLabel([/total de entradas/, /entradas/]),
    totalSaidas: findByLabel([/total de saidas/, /saidas/]),
    saldoFinal: findByLabel([/saldo final/]),
  };
}

async function extractTextPreservingRows(docProxy: Awaited<ReturnType<typeof getDocumentProxy>>) {
  const result = await extractTextItems(docProxy);
  return result.items
    .map((pageItems) => {
      const rows: Array<{
        y: number;
        items: Array<{ str: string; x: number; y: number; height: number }>;
      }> = [];
      for (const item of pageItems) {
        const str = item.str.trim();
        if (!str) continue;
        const row = rows.find((r) => Math.abs(r.y - item.y) <= Math.max(2, item.height * 0.75));
        if (row) row.items.push({ str, x: item.x, y: item.y, height: item.height });
        else rows.push({ y: item.y, items: [{ str, x: item.x, y: item.y, height: item.height }] });
      }
      return rows
        .sort((a, b) => b.y - a.y)
        .map((row) =>
          row.items
            .sort((a, b) => a.x - b.x)
            .map((item) => item.str)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

async function callGemini(apiKey: string, messages: unknown[]) {
  return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages,
      tools: [TOOL_SCHEMA],
      tool_choice: {
        type: "function",
        function: { name: "registrar_movimentacoes_extrato" },
      },
    }),
  });
}

function normalizeItens(rawItens: ItemBruto[]) {
  return rawItens
    .map((it) => {
      const valorRaw = typeof it.valor === "number" ? it.valor : null;
      const valor = valorRaw !== null && valorRaw !== 0 ? Math.abs(valorRaw) : null;
      const data =
        typeof it.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.data) ? it.data : null;
      const horarioMatch =
        typeof it.horario === "string" ? it.horario.match(/\b(\d{1,2})[:hH](\d{2})\b/) : null;
      const horario = horarioMatch
        ? `${String(Math.min(23, parseInt(horarioMatch[1], 10))).padStart(2, "0")}:${String(
            Math.min(59, parseInt(horarioMatch[2], 10)),
          ).padStart(2, "0")}`
        : null;
      const tipoMovimentacao =
        it.tipoMovimentacao === "despesa" ||
        it.tipoMovimentacao === "receita" ||
        it.tipoMovimentacao === "transferencia_interna"
          ? it.tipoMovimentacao
          : "despesa";
      const formaPagamento =
        typeof it.formaPagamento === "string" && FORMAS_VALIDAS.includes(it.formaPagamento)
          ? it.formaPagamento
          : tipoMovimentacao === "receita"
            ? "transferencia"
            : "outro";
      const cat =
        typeof it.categoriaSugerida === "string" &&
        CATEGORIAS_VALIDAS.includes(it.categoriaSugerida)
          ? it.categoriaSugerida
          : null;
      const desc = typeof it.descricao === "string" ? it.descricao.trim() : null;
      const contraparte = typeof it.contraparte === "string" ? it.contraparte.trim() : null;
      const idOperacao = typeof it.idOperacao === "string" ? it.idOperacao.trim() : null;
      const saldo = typeof it.saldo === "number" && Number.isFinite(it.saldo) ? it.saldo : null;
      const origemImportacao =
        typeof it.origemImportacao === "string" ? it.origemImportacao.slice(0, 40) : "extrato_pdf";
      const bancoOrigem = typeof it.bancoOrigem === "string" ? it.bancoOrigem.slice(0, 60) : null;
      const statusRevisao =
        typeof it.statusRevisao === "string" ? it.statusRevisao.slice(0, 60) : null;
      const conf =
        it.confianca === "alta" || it.confianca === "media" || it.confianca === "baixa"
          ? it.confianca
          : "baixa";
      return {
        descricao: desc,
        valor,
        data,
        idOperacao,
        saldo,
        origemImportacao,
        bancoOrigem,
        statusRevisao,
        horario,
        tipoMovimentacao,
        formaPagamento,
        categoriaSugerida: cat,
        contraparte,
        confianca: conf,
        observacao: typeof it.observacao === "string" ? it.observacao.slice(0, 200) : null,
      };
    })
    .filter((it) => it.valor !== null || it.descricao);
}

export const Route = createFileRoute("/api/import-extrato")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __user = await getUserFromRequest(request);
        if (!__user) return unauthorizedResponse();
        const __gate = await ensurePremiumFeatureAccess(__user, "importar_extrato");
        if (__gate) return __gate;
        const __rl = await enforceUserRateLimit({
          scope: "import",
          userId: __user.id,
          route: "import-extrato",
          request,
        });
        if (__rl) return __rl;
        try {
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return Response.json({ error: "LOVABLE_API_KEY não configurada." }, { status: 500 });
          }

          const contentType = request.headers.get("content-type") || "";

          // ---------- PDF via multipart/form-data (caminho preferido p/ PDFs) ----------
          if (contentType.includes("multipart/form-data")) {
            let form: FormData;
            try {
              form = await request.formData();
            } catch (err) {
              console.error("[import-extrato] formData parse error", err);
              return Response.json(
                { error: "Não consegui ler o arquivo enviado. Tente novamente." },
                { status: 400 },
              );
            }
            const file = form.get("pdf");
            if (!(file instanceof File)) {
              return Response.json(
                { error: "Envie um arquivo PDF no campo 'pdf'." },
                { status: 400 },
              );
            }
            if (file.size === 0) {
              return Response.json({ error: "Arquivo PDF vazio." }, { status: 400 });
            }
            if (file.size > 15 * 1024 * 1024) {
              return Response.json(
                { error: "PDF muito grande. Tente um arquivo menor que 15 MB." },
                { status: 413 },
              );
            }
            const bytes = new Uint8Array(await file.arrayBuffer());
            return await processPdfBytes(bytes, apiKey);
          }

          // ---------- JSON (compat: imagens, ou pdf em base64 quando bem pequeno) ----------
          let body: { pdf?: string; imagens?: string[] };
          try {
            body = (await request.json()) as { pdf?: string; imagens?: string[] };
          } catch {
            return Response.json({ error: "Requisição inválida." }, { status: 400 });
          }

          // ---------- PDF (compat JSON base64) ----------
          if (typeof body?.pdf === "string" && body.pdf.length > 0) {
            const bytes = decodeBase64Pdf(body.pdf);
            if (!bytes || bytes.length === 0) {
              return Response.json({ error: "Envie um arquivo PDF válido." }, { status: 400 });
            }
            if (bytes.length > 12 * 1024 * 1024) {
              return Response.json(
                { error: "PDF muito grande. Tente um arquivo menor que 12 MB." },
                { status: 413 },
              );
            }
            return await processPdfBytes(bytes, apiKey);
          }

          // ---------- Imagens ----------
          if (Array.isArray(body?.imagens) && body.imagens.length > 0) {
            const imgs = body.imagens.slice(0, 10).filter((s) => typeof s === "string");
            if (imgs.length === 0) {
              return Response.json(
                { error: "Envie ao menos uma imagem do extrato." },
                { status: 400 },
              );
            }
            // Cap simples de tamanho total (~30MB de base64)
            const totalSize = imgs.reduce((s, i) => s + i.length, 0);
            if (totalSize > 30 * 1024 * 1024) {
              return Response.json(
                { error: "Imagens muito grandes. Reduza a quantidade ou qualidade." },
                { status: 413 },
              );
            }

            const messages = [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Estes são ${imgs.length} print(s) do meu extrato bancário. Extraia a lista de movimentações de TODAS as imagens, sem repetir.`,
                  },
                  ...imgs.map((url) => ({
                    type: "image_url" as const,
                    image_url: { url },
                  })),
                ],
              },
            ];

            const aiResp = await callGemini(apiKey, messages);
            return await handleAIResponse(aiResp, 0, "ocr");
          }

          return Response.json({ error: "Envie um PDF ou imagens do extrato." }, { status: 400 });
        } catch (err) {
          console.error("[import-extrato] erro", err);
          return Response.json(
            { error: "Ocorreu um erro interno. Tente novamente." },
            { status: 500 },
          );
        }
      },
    },
  },
});

// (helper removido — não mandamos mais o PDF como image_url ao gateway)

async function processPdfBytes(bytes: Uint8Array, apiKey: string) {
  let extractedText = "";
  let layoutText = "";
  let totalPages = 0;
  try {
    const docProxy = await getDocumentProxy(bytes);
    totalPages = docProxy.numPages;
    const [result, positionedText] = await Promise.all([
      extractText(docProxy, { mergePages: true }),
      extractTextPreservingRows(docProxy).catch((err) => {
        console.error("[import-extrato] extractTextItems error", err);
        return "";
      }),
    ]);
    extractedText =
      typeof result.text === "string" ? result.text : (result.text as string[]).join("\n");
    layoutText = positionedText;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password/i.test(msg)) {
      return Response.json(
        {
          error:
            "Este PDF parece estar protegido por senha. Exporte uma versão sem senha ou envie prints do extrato.",
        },
        { status: 400 },
      );
    }
    console.error("[import-extrato] extractText error", msg);
  }

  const combinedText = `${layoutText}\n\n${extractedText}`.trim();
  const cleanText = sanitizeText(combinedText);
  // Limiar baixo: qualquer extrato real tem facilmente >50 chars.
  const hasUsefulText = cleanText.length > 50;

  if (!hasUsefulText) {
    // Sem texto extraível. Não tentamos mandar o PDF inteiro como image_url
    // ao Gemini porque o gateway costuma responder 502 nesse caminho.
    // O usuário deve enviar prints (caminho de imagens já funciona bem).
    return Response.json(
      {
        error:
          "Esse PDF parece ser escaneado (sem texto selecionável). Tente exportar uma versão com texto, ou envie prints do extrato — o app lê imagens normalmente.",
      },
      { status: 422 },
    );
  }

  const mercadoPago = parseMercadoPagoStructuredText(cleanText);
  if (mercadoPago) {
    const itens = normalizeItens(mercadoPago.itens);
    if (itens.length === 0) {
      return Response.json(
        {
          error:
            mercadoPago.observacao ||
            "Encontramos texto no PDF, mas não conseguimos identificar as colunas de movimentação.",
        },
        { status: 422 },
      );
    }
    return Response.json({
      itens,
      paginas: totalPages,
      modo: "texto_mercado_pago",
      banco: mercadoPago.banco,
      resumo: mercadoPago.resumo,
      observacao: mercadoPago.observacao,
    });
  }

  const chunks = chunkTextByLines(cleanText, 12_000);
  const allItens: ItemBruto[] = [];
  let aggObs: string | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Texto extraído do extrato bancário em PDF (parte ${i + 1} de ${chunks.length}). Extraia TODAS as movimentações deste trecho, sem cortar.\n\n----INÍCIO----\n${chunk}\n----FIM----`,
      },
    ];
    const aiResp = await callGemini(apiKey, messages);
    const parsed = await parseAIResponse(aiResp);
    if ("error" in parsed) {
      // Se é o primeiro chunk e falhou, devolve erro. Senão, segue com o que já temos.
      if (i === 0 && allItens.length === 0) return parsed.error;
      console.error("[import-extrato] chunk falhou, seguindo com itens parciais", i, parsed);
      continue;
    }
    allItens.push(...parsed.itens);
    if (parsed.observacao && !aggObs) aggObs = parsed.observacao;
  }
  return Response.json({
    itens: normalizeItens(allItens),
    paginas: totalPages,
    modo: "texto",
    observacao: aggObs,
  });
}

/** Divide o texto em chunks por linha, sem ultrapassar maxChars por chunk. */
function chunkTextByLines(text: string, maxChars: number): string[] {
  const lines = text.split(/\r?\n/);
  const chunks: string[] = [];
  let buf = "";
  for (const line of lines) {
    if (buf.length + line.length + 1 > maxChars && buf.length > 0) {
      chunks.push(buf);
      buf = "";
    }
    buf += (buf ? "\n" : "") + line;
  }
  if (buf) chunks.push(buf);
  return chunks.length > 0 ? chunks : [text];
}

/**
 * Parse de resposta da IA que devolve tool-call estruturado.
 * Retorna {itens, observacao} em sucesso, ou {error: Response} pré-formatado em falha.
 */
async function parseAIResponse(
  aiResp: Response,
): Promise<{ itens: ItemBruto[]; observacao: string | null } | { error: Response }> {
  if (!aiResp.ok) {
    const text = await aiResp.text().catch(() => "");
    console.error("[import-extrato] AI gateway error", aiResp.status, text.slice(0, 300));
    if (aiResp.status === 429) {
      return {
        error: Response.json(
          { error: "Muitas leituras seguidas. Tenta de novo em alguns segundos." },
          { status: 429 },
        ),
      };
    }
    if (aiResp.status === 402) {
      return {
        error: Response.json(
          { error: "Sem créditos da IA. Adicione créditos no workspace para continuar." },
          { status: 402 },
        ),
      };
    }
    return {
      error: Response.json(
        {
          error:
            "A leitura inteligente está instável agora. Tente novamente em instantes — ou envie prints do extrato (esse caminho costuma funcionar).",
        },
        { status: 502 },
      ),
    };
  }
  const json = await aiResp.json().catch(() => null);
  const toolCall = (
    json as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    } | null
  )?.choices?.[0]?.message?.tool_calls?.[0];
  const argsStr = toolCall?.function?.arguments;
  if (!argsStr) {
    return {
      error: Response.json({ error: "A IA não conseguiu estruturar o extrato." }, { status: 502 }),
    };
  }
  let parsed: { itens?: ItemBruto[]; observacao?: unknown };
  try {
    parsed = JSON.parse(argsStr);
  } catch {
    return { error: Response.json({ error: "Resposta inválida da IA." }, { status: 502 }) };
  }
  const itens = Array.isArray(parsed.itens) ? parsed.itens : [];
  const observacao = typeof parsed.observacao === "string" ? parsed.observacao : null;
  return { itens, observacao };
}

async function handleAIResponse(aiResp: Response, paginas: number, modo: string) {
  const parsed = await parseAIResponse(aiResp);
  if ("error" in parsed) {
    return parsed.error;
  }
  return Response.json({
    itens: normalizeItens(parsed.itens),
    paginas,
    modo,
    observacao: parsed.observacao,
  });
}
