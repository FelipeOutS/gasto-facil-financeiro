import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  ensurePremiumFeatureAccess,
} from "@/server/api-auth";
import { enforceUserRateLimit } from "@/server/rate-limit.server";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Importação de fatura por PDF.
 *
 * Estratégia:
 * 1. Tenta extrair texto selecionável do PDF com `unpdf` (Worker-safe, sem
 *    dependências nativas).
 * 2. Se houver texto suficiente → manda o texto pro Gemini estruturar.
 * 3. Se for PDF escaneado / imagem (texto vazio) → envia o próprio PDF como
 *    data URI para o Gemini Vision (suporta application/pdf).
 *
 * NUNCA persiste nada — apenas devolve sugestões para o usuário revisar.
 * Não retorna número completo de cartão, CVV, senha.
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

const SYSTEM_PROMPT = `Você analisa FATURAS de cartão de crédito brasileiras (PDFs ou texto extraído de PDFs).

OBJETIVO: extrair UMA LISTA de compras encontradas, com descrição, valor, data, parcelas, horário (se houver) e categoria sugerida.

REGRAS DE VALOR (em reais):
- Reconheça padrões: "R$ 150,00", "R$150,00", "1.250,90", "150,00".
- Vírgula é decimal, ponto é milhar (formato BR).
- IGNORE valores marcados como "Pagamento", "Crédito", "Estorno", "Saldo anterior", "Total da fatura", "Limite", "Disponível", "Próxima fatura", "Subtotal", "IOF" isolado.
- Se o valor estiver claramente negativo (ex: "-R$ 50,00", "CRED"), pule.

DATAS: ISO YYYY-MM-DD. Aceite "12/03", "12/03/2025", "12 MAR".

HORÁRIO (opcional): formato HH:mm 24h, se aparecer no PDF. Caso contrário null.

PARCELAS: reconheça "1/10", "PARC 02/06", "parcela 3 de 12". Preencha parcelaAtual e totalParcelas.

DESCRIÇÃO: nome do estabelecimento como aparece (ex: "IFOOD MARIA SILVA"), curto, sem números longos de cartão e sem CNPJ.

CATEGORIA SUGERIDA (use apenas estes ids):
${CATEGORIAS_VALIDAS.join(", ")}
Heurísticas: iFood/restaurante → alimentacao; Uber/posto → transporte; Netflix/Spotify → assinaturas; farmácia → farmacia; mercado/atacado → mercado; Shopee/Amazon → online; conta/boleto → contas. Se não tiver certeza, "outros".

CONFIANÇA por item: "alta" | "media" | "baixa".

PRIVACIDADE — NUNCA inclua: número completo do cartão, CVV, senha, validade completa, dados bancários sensíveis. CPF e número de conta devem ser ignorados.

Se o conteúdo não parece uma fatura legível, retorne itens=[] com observacao explicando.`;

type ItemBruto = {
  descricao: unknown;
  valor: unknown;
  data: unknown;
  horario?: unknown;
  estabelecimento?: unknown;
  parcelaAtual?: unknown;
  totalParcelas?: unknown;
  categoriaSugerida?: unknown;
  confianca?: unknown;
  observacao?: unknown;
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
  // Remove possíveis dados sensíveis óbvios antes de mandar pra IA.
  return (
    text
      // Mascaras de cartão (16 dígitos com ou sem espaços/hífens) → mantém só últimos 4
      .replace(/\b(?:\d[ -]?){12}(\d{4})\b/g, "**** **** **** $1")
      // CPF
      .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[CPF]")
      .replace(/\b\d{11}\b/g, (m) => (m.length === 11 ? "[CPF]" : m))
      // CVV explícito
      .replace(/\bCVV[:\s]*\d{3,4}\b/gi, "[CVV]")
      .slice(0, 60_000)
  ); // hard cap
}

async function callGeminiWithText(apiKey: string, text: string) {
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
          content: `Texto extraído da fatura em PDF. Extraia a lista de compras.\n\n----INÍCIO----\n${text}\n----FIM----`,
        },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "registrar_compras_fatura" } },
    }),
  });
}

async function callGeminiWithPdf(apiKey: string, pdfDataUri: string) {
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
              text: "Esta é uma fatura em PDF (provavelmente escaneada). Extraia a lista de compras.",
            },
            { type: "image_url", image_url: { url: pdfDataUri } },
          ],
        },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "registrar_compras_fatura" } },
    }),
  });
}

const TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "registrar_compras_fatura",
    description: "Estrutura a lista de compras encontradas na fatura.",
    parameters: {
      type: "object",
      properties: {
        itens: {
          type: "array",
          items: {
            type: "object",
            properties: {
              descricao: { type: ["string", "null"] },
              estabelecimento: { type: ["string", "null"] },
              valor: { type: ["number", "null"] },
              data: { type: ["string", "null"] },
              horario: { type: ["string", "null"] },
              parcelaAtual: { type: ["number", "null"] },
              totalParcelas: { type: ["number", "null"] },
              categoriaSugerida: {
                type: ["string", "null"],
                enum: [...CATEGORIAS_VALIDAS, null],
              },
              confianca: { type: "string", enum: ["alta", "media", "baixa"] },
              observacao: { type: ["string", "null"] },
            },
            required: ["confianca"],
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

function normalizeItens(rawItens: ItemBruto[]) {
  return rawItens
    .map((it) => {
      const valor = typeof it.valor === "number" && it.valor > 0 ? it.valor : null;
      const data =
        typeof it.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.data) ? it.data : null;
      const horarioMatch =
        typeof it.horario === "string" ? it.horario.match(/\b(\d{1,2})[:hH](\d{2})\b/) : null;
      const horario = horarioMatch
        ? `${String(Math.min(23, parseInt(horarioMatch[1], 10))).padStart(2, "0")}:${String(
            Math.min(59, parseInt(horarioMatch[2], 10)),
          ).padStart(2, "0")}`
        : null;
      const cat =
        typeof it.categoriaSugerida === "string" &&
        CATEGORIAS_VALIDAS.includes(it.categoriaSugerida)
          ? it.categoriaSugerida
          : null;
      const desc = typeof it.descricao === "string" ? it.descricao.slice(0, 80) : null;
      const estab = typeof it.estabelecimento === "string" ? it.estabelecimento.slice(0, 80) : null;
      const pa =
        typeof it.parcelaAtual === "number" && it.parcelaAtual > 0
          ? Math.floor(it.parcelaAtual)
          : null;
      const tp =
        typeof it.totalParcelas === "number" && it.totalParcelas > 1
          ? Math.floor(it.totalParcelas)
          : null;
      const conf =
        it.confianca === "alta" || it.confianca === "media" || it.confianca === "baixa"
          ? it.confianca
          : "baixa";
      return {
        descricao: desc,
        estabelecimento: estab,
        valor,
        data,
        horario,
        parcelaAtual: pa,
        totalParcelas: tp,
        categoriaSugerida: cat,
        confianca: conf,
        observacao: typeof it.observacao === "string" ? it.observacao.slice(0, 200) : null,
      };
    })
    .filter((it) => it.valor !== null || it.descricao || it.estabelecimento);
}

export const Route = createFileRoute("/api/import-fatura-pdf")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __user = await getUserFromRequest(request);
        if (!__user) return unauthorizedResponse();
        const __gate = await ensurePremiumFeatureAccess(__user, "importar_fatura");
        if (__gate) return __gate;
        const __rl = await enforceUserRateLimit({
          scope: "import",
          userId: __user.id,
          route: "import-fatura-pdf",
          request,
        });
        if (__rl) return __rl;
        try {
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return Response.json({ error: "LOVABLE_API_KEY não configurada." }, { status: 500 });
          }

          const body = (await request.json()) as { pdf?: string };
          const pdf = typeof body?.pdf === "string" ? body.pdf : "";
          const bytes = decodeBase64Pdf(pdf);
          if (!bytes || bytes.length === 0) {
            return Response.json({ error: "Envie um arquivo PDF válido." }, { status: 400 });
          }
          if (bytes.length > 12 * 1024 * 1024) {
            return Response.json(
              { error: "PDF muito grande. Tente um arquivo menor que 12 MB." },
              { status: 413 },
            );
          }

          // 1. Tenta extrair texto
          let extractedText = "";
          let totalPages = 0;
          try {
            const docProxy = await getDocumentProxy(bytes);
            totalPages = docProxy.numPages;
            const result = await extractText(docProxy, { mergePages: true });
            extractedText =
              typeof result.text === "string" ? result.text : (result.text as string[]).join("\n");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/password/i.test(msg)) {
              return Response.json(
                {
                  error:
                    "Este PDF parece estar protegido por senha. Exporte uma versão sem senha ou envie prints da fatura.",
                },
                { status: 400 },
              );
            }
            console.error("[import-fatura-pdf] extractText error", msg);
          }

          const cleanText = sanitizeText(extractedText.trim());
          const hasUsefulText = cleanText.length > 200;

          // 2. Chamada IA
          const aiResp = hasUsefulText
            ? await callGeminiWithText(apiKey, cleanText)
            : await callGeminiWithPdf(
                apiKey,
                pdf.startsWith("data:") ? pdf : `data:application/pdf;base64,${pdf}`,
              );

          if (!aiResp.ok) {
            const text = await aiResp.text();
            console.error("[import-fatura-pdf] AI gateway error", aiResp.status, text);
            if (aiResp.status === 429) {
              return Response.json(
                { error: "Muitas leituras seguidas. Tenta de novo em alguns segundos." },
                { status: 429 },
              );
            }
            if (aiResp.status === 402) {
              return Response.json(
                {
                  error: "Sem créditos da IA. Adicione créditos no workspace para continuar.",
                },
                { status: 402 },
              );
            }
            return Response.json({ error: "Não consegui ler esse PDF agora." }, { status: 502 });
          }

          const json = await aiResp.json();
          const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
          const argsStr = toolCall?.function?.arguments;
          if (!argsStr) {
            return Response.json(
              { error: "A IA não conseguiu estruturar a leitura do PDF." },
              { status: 502 },
            );
          }
          let parsed: { itens?: ItemBruto[]; observacao?: unknown };
          try {
            parsed = JSON.parse(argsStr);
          } catch {
            return Response.json({ error: "Resposta inválida da IA." }, { status: 502 });
          }
          const itensRaw = Array.isArray(parsed.itens) ? parsed.itens : [];
          const itens = normalizeItens(itensRaw);

          return Response.json({
            itens,
            paginas: totalPages,
            modo: hasUsefulText ? "texto" : "ocr",
            observacao: typeof parsed.observacao === "string" ? parsed.observacao : null,
          });
        } catch (err) {
          console.error("[import-fatura-pdf] erro", err);
          return Response.json(
            { error: "Ocorreu um erro interno. Tente novamente." },
            { status: 500 },
          );
        }
      },
    },
  },
});
