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
  /** true quando a data extraída é contextualmente impossível/divergente. */
  dataIncerta?: boolean;
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
- Em notas fiscais (NFC-e/NF-e/SAT), a data oficial é a de EMISSÃO ("Emissão", "Data de emissão") ou AUTORIZAÇÃO ("Protocolo de autorização"). Preencha "dataEmissao" e "dataAutorizacao" com elas quando estiverem impressas.
- Leia os 4 dígitos do ano com atenção, caractere por caractere (ex.: "2026" e "2006" são anos diferentes). Copie exatamente o que está impresso; não corrija nem adivinhe.
- Em "tipoDocumento" informe "nfce", "nfe", "sat", "pix", "boleto" ou "outro".

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
        dataEmissao: { type: ["string", "null"] },
        dataAutorizacao: { type: ["string", "null"] },
        tipoDocumento: {
          type: ["string", "null"],
          enum: ["nfce", "nfe", "sat", "pix", "boleto", "outro", null],
        },
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
export async function extrairDadosComprovante(imageBase64: string): Promise<OcrOutcome> {
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

  let aiResp: Response;
  try {
  aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    // Pacote 2/C: leitura por IA com tempo limite.
    signal: AbortSignal.timeout(45_000),
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
  } catch (err) {
    const n = (err as { name?: string } | null)?.name;
    console.error("[ocr-comprovante] AI gateway falhou", { kind: n === "TimeoutError" || n === "AbortError" ? "timeout" : "network" });
    return { ok: false, error: { error: "A leitura demorou demais. Tente de novo em instantes.", status: 504 } };
  }

  if (!aiResp.ok) {
    const text = await aiResp.text().catch(() => "");
    console.error("[ocr-comprovante] AI gateway error", aiResp.status, text.length);
    if (aiResp.status === 429) {
      return {
        ok: false,
        error: {
          error: "Muitas leituras seguidas. Tenta de novo em alguns segundos.",
          status: 429,
        },
      };
    }
    if (aiResp.status === 402) {
      return {
        ok: false,
        error: {
          error:
            "Sem créditos da IA. Adicione créditos no workspace para continuar usando a leitura por imagem.",
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

  const datas = escolherDataComprovante({
    data: parsed.data,
    dataEmissao: parsed.dataEmissao,
    dataAutorizacao: parsed.dataAutorizacao,
    tipoDocumento: parsed.tipoDocumento,
  });

  const result: OcrResult = {
    valor: typeof parsed.valor === "number" && parsed.valor > 0 ? parsed.valor : null,
    valoresEncontrados,
    data: datas.data,
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
    ...(datas.incerta ? { dataIncerta: true } : {}),
  };

  return { ok: true, data: result };
}

function isoValida(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Ano mínimo plausível por tipo de documento fiscal eletrônico. */
const ANO_MINIMO_POR_TIPO: Record<string, number> = { nfce: 2012, nfe: 2006, sat: 2015, pix: 2020 };

/**
 * Escolhe a data do comprovante priorizando a data fiscal impressa
 * (emissão > autorização > data genérica). Nunca troca o ano por palpite:
 * quando as datas lidas divergem entre si ou o ano é impossível para o tipo
 * de documento (ex.: NFC-e em 2006), marca `incerta` para o usuário confirmar.
 */
export function escolherDataComprovante(input: {
  data?: unknown;
  dataEmissao?: unknown;
  dataAutorizacao?: unknown;
  tipoDocumento?: unknown;
}): { data: string | null; incerta: boolean } {
  const emissao = isoValida(input.dataEmissao);
  const autorizacao = isoValida(input.dataAutorizacao);
  const generica = isoValida(input.data);
  const data = emissao ?? autorizacao ?? generica;
  if (!data) return { data: null, incerta: false };
  const lidas = [emissao, autorizacao, generica].filter((d): d is string => !!d);
  const divergente = lidas.some((d) => d !== data);
  const tipo = typeof input.tipoDocumento === "string" ? input.tipoDocumento : "";
  const anoMin = ANO_MINIMO_POR_TIPO[tipo];
  const anoImpossivel = anoMin !== undefined && Number(data.slice(0, 4)) < anoMin;
  return { data, incerta: divergente || anoImpossivel };
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
