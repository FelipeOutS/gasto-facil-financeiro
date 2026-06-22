/**
 * OCR de comprovante — serviço único reutilizável.
 *
 * Origem: extraído de src/routes/api/ocr-gasto.ts (Lovable AI Gateway,
 * Gemini Vision via tool call). O contrato de retorno é IDÊNTICO ao que
 * o site já consome, para garantir uma única implementação de leitura
 * de notas/cupons/comprovantes em todo o produto:
 *   - site (importar gasto por foto)
 *   - WhatsApp (Fase WA-G5A)
 *
 * Privacidade:
 *   - A imagem é enviada APENAS para o gateway de IA do próprio Lovable.
 *   - Nunca persiste imagem; o caller é responsável pela retenção/segurança.
 *   - Nunca expõe URL pública.
 */

export const OCR_CATEGORIAS_VALIDAS = [
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
] as const;

export const OCR_FORMAS = [
  "pix",
  "dinheiro",
  "debito",
  "credito",
  "boleto",
  "transferencia",
  "vale_alimentacao",
  "vale_refeicao",
  "outro",
] as const;

export type OcrConfianca = "alta" | "media" | "baixa";

export type OcrResult = {
  valor: number | null;
  valoresEncontrados: number[];
  data: string | null;
  descricao: string | null;
  categoriaSugerida: string | null;
  formaPagamento: string | null;
  confianca: OcrConfianca;
  observacao: string | null;
};

export type OcrError = {
  error: string;
  status: number;
};

export type OcrOutcome = { ok: true; data: OcrResult } | { ok: false; error: OcrError };

const SYSTEM_PROMPT = `Você analisa imagens de comprovantes financeiros brasileiros (Pix, boletos, notas, recibos, faturas, screenshots de apps).

REGRAS DE VALOR (em reais):
- Reconheça padrões: "R$ 150,00", "R$150,00", "R$ 1.250,90", "RS 150,00", "BRL 150,00", "150 reais".
- Liste TODOS os valores monetários encontrados em "valoresEncontrados" (números, sem R$).
- Para "valor" (principal), priorize valores próximos a: Total, Valor, Valor pago, Pago, Pagamento, Transferência, Pix, Débito, Crédito, Compra.
- EVITE escolher como principal valores próximos a: Desconto, Cashback, Saldo, Troco, Juros, Taxa, Parcelas, Limite, Valor anterior.
- Se não houver pista clara, escolha o maior valor.
- Se confiança for baixa, retorne "confianca": "baixa" e deixe o usuário decidir.

DATA:
- Formato ISO YYYY-MM-DD. Se não achar, deixe null.

DESCRIÇÃO:
- Nome do estabelecimento, recebedor do Pix, ou serviço (ex: "Uber", "Mercado Assaí", "Maria Silva").
- Curto, sem CNPJ.

CATEGORIA SUGERIDA (use apenas estes ids):
${OCR_CATEGORIAS_VALIDAS.join(", ")}
Heurísticas: Uber/99/combustível/estacionamento → transporte; mercado/supermercado → mercado; farmácia/drogaria → farmacia; Netflix/Spotify/assinatura → assinaturas; restaurante/iFood/lanche → alimentacao; aluguel/condomínio → moradia; cabeleireiro/salão/barbeiro → cabeleireiro.

FORMA DE PAGAMENTO (use apenas estes ids): ${OCR_FORMAS.join(", ")}

PRIVACIDADE:
- NUNCA retorne número completo de cartão, CVV, senha ou dados bancários sensíveis.
- Pode citar banco/emissor de forma genérica ("Nubank", "Itaú").

CONFIANÇA: "alta" | "media" | "baixa".`;

const TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "registrar_gasto_extraido",
    description: "Estrutura os dados do gasto extraídos da imagem.",
    parameters: {
      type: "object",
      properties: {
        valor: { type: ["number", "null"] },
        valoresEncontrados: { type: "array", items: { type: "number" } },
        data: { type: ["string", "null"] },
        descricao: { type: ["string", "null"] },
        categoriaSugerida: {
          type: ["string", "null"],
          enum: [...OCR_CATEGORIAS_VALIDAS, null],
        },
        formaPagamento: {
          type: ["string", "null"],
          enum: [...OCR_FORMAS, null],
        },
        confianca: { type: "string", enum: ["alta", "media", "baixa"] },
        observacao: { type: ["string", "null"] },
      },
      required: ["valoresEncontrados", "confianca"],
      additionalProperties: false,
    },
  },
};

/**
 * Lê um comprovante a partir de uma data URL base64.
 * `imageBase64` deve ser uma data URL completa: "data:image/...;base64,...".
 * Limite ~15 MB de imagem (≈20 MB em base64).
 */
export async function extrairDadosComprovante(
  imageBase64: string,
): Promise<OcrOutcome> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return { ok: false, error: { error: "LOVABLE_API_KEY não configurada.", status: 500 } };
  }
  if (!imageBase64 || typeof imageBase64 !== "string" || !imageBase64.startsWith("data:image/")) {
    return { ok: false, error: { error: "Imagem inválida. Envie data URL base64.", status: 400 } };
  }
  if (imageBase64.length > 20 * 1024 * 1024) {
    return { ok: false, error: { error: "Imagem muito grande. Máximo 15 MB.", status: 413 } };
  }

  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Analise este comprovante e extraia os dados do gasto." },
            { type: "image_url", image_url: { url: imageBase64 } },
          ],
        },
      ],
      tools: [TOOL_DEF],
      tool_choice: { type: "function", function: { name: "registrar_gasto_extraido" } },
    }),
  });

  if (!aiResp.ok) {
    const text = await aiResp.text().catch(() => "");
    console.error("[ocr-comprovante] AI gateway error", aiResp.status, text);
    if (aiResp.status === 429) {
      return { ok: false, error: { error: "Muitas leituras seguidas. Tenta de novo em alguns segundos.", status: 429 } };
    }
    if (aiResp.status === 402) {
      return {
        ok: false,
        error: {
          error: "Sem créditos da IA. Adicione créditos no workspace para continuar usando a leitura por imagem.",
          status: 402,
        },
      };
    }
    return { ok: false, error: { error: "Não consegui ler essa imagem agora.", status: 502 } };
  }

  const json = await aiResp.json();
  const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
  const argsStr = toolCall?.function?.arguments;
  if (!argsStr) {
    return { ok: false, error: { error: "A IA não conseguiu estruturar a leitura.", status: 502 } };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(argsStr);
  } catch {
    return { ok: false, error: { error: "Resposta inválida da IA.", status: 502 } };
  }

  const valoresEncontrados = Array.isArray(parsed.valoresEncontrados)
    ? (parsed.valoresEncontrados as unknown[])
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];

  const result: OcrResult = {
    valor: typeof parsed.valor === "number" && parsed.valor > 0 ? parsed.valor : null,
    valoresEncontrados,
    data: typeof parsed.data === "string" ? parsed.data : null,
    descricao: typeof parsed.descricao === "string" ? parsed.descricao : null,
    categoriaSugerida:
      typeof parsed.categoriaSugerida === "string" &&
      (OCR_CATEGORIAS_VALIDAS as readonly string[]).includes(parsed.categoriaSugerida)
        ? parsed.categoriaSugerida
        : null,
    formaPagamento:
      typeof parsed.formaPagamento === "string" &&
      (OCR_FORMAS as readonly string[]).includes(parsed.formaPagamento)
        ? parsed.formaPagamento
        : null,
    confianca:
      parsed.confianca === "alta" || parsed.confianca === "media" || parsed.confianca === "baixa"
        ? parsed.confianca
        : "baixa",
    observacao: typeof parsed.observacao === "string" ? parsed.observacao : null,
  };

  return { ok: true, data: result };
}

// =====================================================================
// Hook de testes — permite injetar uma implementação fake da extração
// sem chamar a rede. Nunca usar fora de testes.
// =====================================================================
type ExtractorFn = (img: string) => Promise<OcrOutcome>;
let __testExtractor: ExtractorFn | null = null;

export function __setOcrExtractorForTests(fn: ExtractorFn | null): void {
  __testExtractor = fn;
}

export async function runExtractor(imageBase64: string): Promise<OcrOutcome> {
  if (__testExtractor) return __testExtractor(imageBase64);
  return extrairDadosComprovante(imageBase64);
}
