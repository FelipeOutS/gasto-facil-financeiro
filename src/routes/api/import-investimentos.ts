import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  ensurePremiumFeatureAccess,
} from "@/server/api-auth";
import { enforceUserRateLimit } from "@/server/rate-limit.server";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Importação de INVESTIMENTOS a partir de:
 *  - PDF (extrato B3, corretora ou genérico) — extrai texto com unpdf,
 *    com fallback para Gemini Vision se for escaneado.
 *  - Planilha (CSV/XLSX) — recebe linhas já parseadas no cliente.
 *
 * NUNCA persiste — apenas devolve sugestões para revisão manual.
 *
 * Retorna DOIS conjuntos:
 *  - posicoes: ativos atuais da carteira
 *  - movimentacoes: aplicação, resgate, compra, venda, transferência,
 *    rendimento, juros, dividendos, amortização etc.
 */

const TIPOS_VALIDOS = [
  "acoes",
  "fii",
  "etf",
  "bdr",
  "tesouro",
  "cdb",
  "lci",
  "lca",
  "lc",
  "fundo",
  "previdencia",
  "cripto",
  "outros",
] as const;

const RENT_VALIDAS = ["cdi", "ipca", "prefixado", "selic", "outro"] as const;

const TIPOS_MOV = [
  "compra",
  "venda",
  "aplicacao",
  "resgate",
  "transferencia",
  "rendimento",
  "dividendo",
  "jcp",
  "amortizacao",
  "bonificacao",
  "desdobramento",
  "grupamento",
] as const;

const SYSTEM_PROMPT = `Você analisa documentos brasileiros (PDF ou planilhas) de extratos de investimentos: B3 (Área do Investidor), corretoras (XP, Rico, Clear, Inter, Nubank, BTG, Itaú, etc.), bancos e listas pessoais.

OBJETIVO: extrair DOIS CONJUNTOS de dados do documento:
1) "posicoes" — ativos atualmente na carteira (saldo/posição consolidada).
2) "movimentacoes" — eventos individuais como aplicação, resgate, compra, venda, transferência, rendimento, juros, dividendos, amortização etc.

IMPORTANTE: o arquivo pode conter SOMENTE posições, SOMENTE movimentações ou os DOIS. Extraia tudo que conseguir identificar — nunca devolva listas vazias só porque um dos lados não existe. Se só houver movimentações, retorne posicoes=[] e preencha movimentacoes.

================== POSIÇÕES ==================
Para cada ativo em posição, extraia:
- nome (string): nome ou descrição do ativo. Ex.: "PETR4", "Tesouro IPCA+ 2029", "CDB Banco Inter 110% CDI".
- ticker (string|null): código de negociação quando houver. Para renda fixa pode ser null.
- tipo: um destes ids: ${TIPOS_VALIDOS.join(", ")}.
  Heurística:
    Tickers terminados em 3/4 (PETR4, ITUB3) → "acoes"
    Tickers terminados em 11 com nome de fundo imobiliário → "fii"
    BOVA11/IVVB11/SMAL11 e similares com "ETF" no nome → "etf"
    Nome com "BDR" e ticker terminado em 32/33/34/35 → "bdr"
    "Tesouro Selic/IPCA/Prefixado/Renda+" → "tesouro"
    "CDB" → "cdb", "LCI" → "lci", "LCA" → "lca", "LC"/"Letra de Câmbio" → "lc"
    "Fundo"/"FIM"/"FIA"/"FIRF"/"FIC" → "fundo"
    "Previdência"/"PGBL"/"VGBL" → "previdencia"
    Bitcoin/Ethereum/BTC/ETH/USDT → "cripto"
    Caso contrário → "outros".
- quantidade (number|null), precoMedio (number|null), valorAplicado (number|null), valorAtual (number|null).
- instituicao (string|null), dataInicio (string|null, ISO YYYY-MM-DD), dataVencimento (string|null, ISO).
- rentabilidadeTipo: ${RENT_VALIDAS.join(", ")} ou null.
- rentabilidadePercentual (string|null), liquidez (string|null), observacao (string|null).
- confianca: "alta" | "media" | "baixa".

NÃO inclua em "posicoes" linhas de movimentação isolada (compra avulsa, dividendo recebido, resgate). Essas vão em "movimentacoes".
Ignore totais agregados ("Total da carteira", "Patrimônio total", "Saldo bruto consolidado").

================== MOVIMENTAÇÕES ==================
Para cada movimentação, extraia:
- data (string ISO YYYY-MM-DD): data do evento. OBRIGATÓRIO. Se ausente, deixe null e marque confianca "baixa".
- tipo: um destes ids: ${TIPOS_MOV.join(", ")}.
  Mapeamento:
    "Aplicação"/"Investimento" → "aplicacao"
    "Resgate"/"Saída"/"Devolução" → "resgate"
    "Compra"/"C" (em corretagem) → "compra"
    "Venda"/"V" → "venda"
    "Transferência"/"TED"/"PIX" entre contas → "transferencia"
    "Rendimento"/"Juros" de renda fixa → "rendimento"
    "Dividendo" → "dividendo"
    "JCP"/"Juros sobre Capital" → "jcp"
    "Amortização" → "amortizacao"
    "Bonificação" → "bonificacao"
    "Desdobramento"/"Split" → "desdobramento"
    "Grupamento"/"Inplit" → "grupamento".
- nome (string|null): nome do ativo envolvido. Use o nome do ativo quando não houver ticker.
- ticker (string|null): código de negociação se identificável.
- tipoAtivo: um dos ids de ${TIPOS_VALIDOS.join(", ")} (chute pela mesma heurística das posições). Use "outros" se não souber.
- quantidade (number|null): quantidade quando aplicável.
- valorUnitario (number|null), valorTotal (number|null): valor da operação em reais.
- instituicao (string|null), observacao (string|null), confianca: "alta"|"media"|"baixa".

REGRAS DE VALORES (para os dois conjuntos):
- Padrão brasileiro: vírgula é decimal, ponto é milhar. "1.234,56" = 1234.56.
- Remova R$, %, espaços extras. Para campos numéricos retorne NUMBER, não string.
- Nunca inclua valor 0 ou negativo. Se não souber, use null.
- Não retorne dados sensíveis (CPF, número de conta, senha, token).

Se o arquivo for ilegível, retorne posicoes=[] e movimentacoes=[] com observacao explicando.`;

type AtivoBruto = {
  nome?: unknown;
  ticker?: unknown;
  tipo?: unknown;
  quantidade?: unknown;
  precoMedio?: unknown;
  valorAplicado?: unknown;
  valorAtual?: unknown;
  instituicao?: unknown;
  dataInicio?: unknown;
  dataVencimento?: unknown;
  rentabilidadeTipo?: unknown;
  rentabilidadePercentual?: unknown;
  liquidez?: unknown;
  observacao?: unknown;
  confianca?: unknown;
};

type MovBruta = {
  data?: unknown;
  tipo?: unknown;
  nome?: unknown;
  ticker?: unknown;
  tipoAtivo?: unknown;
  quantidade?: unknown;
  valorUnitario?: unknown;
  valorTotal?: unknown;
  instituicao?: unknown;
  observacao?: unknown;
  confianca?: unknown;
};

const TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "registrar_investimentos",
    description: "Estrutura posições e movimentações de investimentos encontradas no documento.",
    parameters: {
      type: "object",
      properties: {
        posicoes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              nome: { type: ["string", "null"] },
              ticker: { type: ["string", "null"] },
              tipo: { type: "string", enum: [...TIPOS_VALIDOS] },
              quantidade: { type: ["number", "null"] },
              precoMedio: { type: ["number", "null"] },
              valorAplicado: { type: ["number", "null"] },
              valorAtual: { type: ["number", "null"] },
              instituicao: { type: ["string", "null"] },
              dataInicio: { type: ["string", "null"] },
              dataVencimento: { type: ["string", "null"] },
              rentabilidadeTipo: {
                type: ["string", "null"],
                enum: [...RENT_VALIDAS, null],
              },
              rentabilidadePercentual: { type: ["string", "null"] },
              liquidez: { type: ["string", "null"] },
              observacao: { type: ["string", "null"] },
              confianca: { type: "string", enum: ["alta", "media", "baixa"] },
            },
            required: ["tipo", "confianca"],
            additionalProperties: false,
          },
        },
        movimentacoes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              data: { type: ["string", "null"] },
              tipo: { type: "string", enum: [...TIPOS_MOV] },
              nome: { type: ["string", "null"] },
              ticker: { type: ["string", "null"] },
              tipoAtivo: { type: "string", enum: [...TIPOS_VALIDOS] },
              quantidade: { type: ["number", "null"] },
              valorUnitario: { type: ["number", "null"] },
              valorTotal: { type: ["number", "null"] },
              instituicao: { type: ["string", "null"] },
              observacao: { type: ["string", "null"] },
              confianca: { type: "string", enum: ["alta", "media", "baixa"] },
            },
            required: ["tipo", "confianca"],
            additionalProperties: false,
          },
        },
        observacao: { type: ["string", "null"] },
      },
      required: ["posicoes", "movimentacoes"],
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
  return text
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[CPF]")
    .replace(/\b(?:\d[ -]?){12}(\d{4})\b/g, "**** **** **** $1")
    .slice(0, 80_000);
}

async function callAIWithText(apiKey: string, text: string, origem: string) {
  return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
          content: `Origem informada pelo usuário: ${origem}.\n\nConteúdo extraído (texto de PDF ou linhas de planilha):\n\n----INÍCIO----\n${text}\n----FIM----`,
        },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "registrar_investimentos" } },
    }),
  });
}

async function callAIWithPdf(apiKey: string, pdfDataUri: string, origem: string) {
  return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
            {
              type: "text",
              text: `Origem informada pelo usuário: ${origem}. PDF possivelmente escaneado/imagem — extraia posições e movimentações.`,
            },
            { type: "image_url", image_url: { url: pdfDataUri } },
          ],
        },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "registrar_investimentos" } },
    }),
  });
}

function num(x: unknown): number | null {
  if (typeof x === "number" && isFinite(x) && x > 0) return Number(x.toFixed(8));
  return null;
}
function str(x: unknown, max = 200): string | null {
  return typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null;
}
function isoDate(x: unknown): string | null {
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  return null;
}

function normalizePosicoes(raw: AtivoBruto[]) {
  return raw
    .map((a) => {
      const tipo =
        typeof a.tipo === "string" && (TIPOS_VALIDOS as readonly string[]).includes(a.tipo)
          ? a.tipo
          : "outros";
      const rentTipo =
        typeof a.rentabilidadeTipo === "string" &&
        (RENT_VALIDAS as readonly string[]).includes(a.rentabilidadeTipo)
          ? a.rentabilidadeTipo
          : null;
      return {
        nome: str(a.nome, 120),
        ticker: str(a.ticker, 20)?.toUpperCase() ?? null,
        tipo,
        quantidade: num(a.quantidade),
        precoMedio: num(a.precoMedio),
        valorAplicado: num(a.valorAplicado),
        valorAtual: num(a.valorAtual),
        instituicao: str(a.instituicao, 80),
        dataInicio: isoDate(a.dataInicio),
        dataVencimento: isoDate(a.dataVencimento),
        rentabilidadeTipo: rentTipo,
        rentabilidadePercentual: str(a.rentabilidadePercentual, 40),
        liquidez: str(a.liquidez, 40),
        observacao: str(a.observacao, 300),
        confianca:
          a.confianca === "alta" || a.confianca === "media" || a.confianca === "baixa"
            ? a.confianca
            : "baixa",
      };
    })
    .filter((a) => a.nome || a.ticker)
    .filter((a) => a.valorAplicado || a.valorAtual || a.quantidade);
}

function normalizeMovimentacoes(raw: MovBruta[]) {
  return raw
    .map((m) => {
      const tipo =
        typeof m.tipo === "string" && (TIPOS_MOV as readonly string[]).includes(m.tipo)
          ? m.tipo
          : null;
      const tipoAtivo =
        typeof m.tipoAtivo === "string" &&
        (TIPOS_VALIDOS as readonly string[]).includes(m.tipoAtivo)
          ? m.tipoAtivo
          : "outros";
      return {
        data: isoDate(m.data),
        tipo,
        nome: str(m.nome, 120),
        ticker: str(m.ticker, 20)?.toUpperCase() ?? null,
        tipoAtivo,
        quantidade: num(m.quantidade),
        valorUnitario: num(m.valorUnitario),
        valorTotal: num(m.valorTotal),
        instituicao: str(m.instituicao, 80),
        observacao: str(m.observacao, 300),
        confianca:
          m.confianca === "alta" || m.confianca === "media" || m.confianca === "baixa"
            ? m.confianca
            : "baixa",
      };
    })
    .filter((m) => m.tipo)
    .filter((m) => m.nome || m.ticker || m.valorTotal)
    .filter((m) => m.valorTotal || m.quantidade);
}

export const Route = createFileRoute("/api/import-investimentos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __user = await getUserFromRequest(request);
        if (!__user) return unauthorizedResponse();
        const __gate = await ensurePremiumFeatureAccess(__user, "investimentos");
        if (__gate) return __gate;
        const __rl = await enforceUserRateLimit({
          scope: "import",
          userId: __user.id,
          route: "import-investimentos",
          request,
        });
        if (__rl) return __rl;
        try {
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return Response.json(
              { error: "Serviço de IA indisponível no momento." },
              { status: 500 },
            );
          }

          const body = (await request.json()) as {
            origem?: string;
            pdf?: string;
            linhas?: string[][];
            colunas?: string[];
          };

          const origem = typeof body.origem === "string" ? body.origem : "outro";

          if (Array.isArray(body.linhas) && body.linhas.length > 0) {
            const colunas = Array.isArray(body.colunas) ? body.colunas : [];
            const header = colunas.length ? colunas.join(" | ") : "";
            const linhasTxt = body.linhas
              .slice(0, 500)
              .map((row) => row.map((c) => String(c ?? "").trim()).join(" | "))
              .filter((l) => l.replace(/\|/g, "").trim().length > 0)
              .join("\n");
            if (!linhasTxt) {
              return Response.json(
                { error: "A planilha parece vazia ou em um formato não suportado." },
                { status: 400 },
              );
            }
            const text = sanitizeText(`Cabeçalho: ${header}\n\nLinhas:\n${linhasTxt}`);
            const aiResp = await callAIWithText(apiKey, text, origem);
            return await handleAiResponse(aiResp, "texto");
          }

          if (typeof body.pdf === "string" && body.pdf) {
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

            let extractedText = "";
            let totalPages = 0;
            try {
              const docProxy = await getDocumentProxy(bytes);
              totalPages = docProxy.numPages;
              const result = await extractText(docProxy, { mergePages: true });
              extractedText =
                typeof result.text === "string"
                  ? result.text
                  : (result.text as string[]).join("\n");
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (/password/i.test(msg)) {
                return Response.json(
                  {
                    error:
                      "Não foi possível ler este PDF. Se ele tiver senha, exporte uma versão sem senha.",
                  },
                  { status: 400 },
                );
              }
              console.error("[import-investimentos] extractText error", msg);
            }

            const cleanText = sanitizeText(extractedText.trim());
            const hasUsefulText = cleanText.length > 80;

            if (!hasUsefulText) {
              const aiResp = await callAIWithPdf(
                apiKey,
                body.pdf.startsWith("data:") ? body.pdf : `data:application/pdf;base64,${body.pdf}`,
                origem,
              );
              return await handleAiResponse(aiResp, "ocr", totalPages, true);
            }

            const aiResp = await callAIWithText(apiKey, cleanText, origem);
            return await handleAiResponse(aiResp, "texto", totalPages);
          }

          return Response.json(
            { error: "Envie um PDF ou as linhas de uma planilha." },
            { status: 400 },
          );
        } catch (err) {
          console.error("[import-investimentos] erro", err);
          return Response.json(
            { error: "Não foi possível processar o arquivo. Tente novamente." },
            { status: 500 },
          );
        }
      },
    },
  },
});

async function handleAiResponse(
  aiResp: Response,
  modo: "texto" | "ocr",
  paginas = 0,
  pdfEscaneado = false,
) {
  if (!aiResp.ok) {
    const text = await aiResp.text();
    console.error("[import-investimentos] AI gateway error", aiResp.status, text);
    if (aiResp.status === 429) {
      return Response.json(
        { error: "Muitas leituras seguidas. Tente em alguns segundos." },
        { status: 429 },
      );
    }
    if (aiResp.status === 402) {
      return Response.json(
        { error: "Sem créditos da IA no momento. Tente novamente mais tarde." },
        { status: 402 },
      );
    }
    return Response.json({ error: "Não foi possível ler este arquivo." }, { status: 502 });
  }

  const json = await aiResp.json();
  const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
  const argsStr = toolCall?.function?.arguments;
  if (!argsStr) {
    if (pdfEscaneado) {
      return Response.json(
        {
          posicoes: [],
          movimentacoes: [],
          modo,
          paginas,
          observacao:
            "Não foi possível ler automaticamente este PDF porque ele parece ser uma imagem digitalizada. Tente exportar o extrato em PDF com texto selecionável, use CSV/planilha ou cadastre manualmente.",
        },
        { status: 200 },
      );
    }
    return Response.json(
      { error: "A IA não conseguiu estruturar a leitura do arquivo." },
      { status: 502 },
    );
  }
  let parsed: {
    posicoes?: AtivoBruto[];
    movimentacoes?: MovBruta[];
    itens?: AtivoBruto[]; // back-compat caso o modelo use o campo antigo
    observacao?: unknown;
  };
  try {
    parsed = JSON.parse(argsStr);
  } catch {
    return Response.json({ error: "Resposta inválida da IA." }, { status: 502 });
  }
  const posicoesRaw = Array.isArray(parsed.posicoes)
    ? parsed.posicoes
    : Array.isArray(parsed.itens)
      ? parsed.itens
      : [];
  const movsRaw = Array.isArray(parsed.movimentacoes) ? parsed.movimentacoes : [];
  const posicoes = normalizePosicoes(posicoesRaw);
  const movimentacoes = normalizeMovimentacoes(movsRaw);
  return Response.json({
    posicoes,
    movimentacoes,
    modo,
    paginas,
    observacao: typeof parsed.observacao === "string" ? parsed.observacao : null,
  });
}
