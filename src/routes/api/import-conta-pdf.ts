import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  ensurePremiumFeatureAccess,
} from "@/server/api-auth";
import { enforceUserRateLimit } from "@/server/rate-limit.server";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Importação de CONTAS A PAGAR a partir de um PDF.
 *
 * Estratégia:
 * 1. Tenta extrair texto selecionável com `unpdf` (Worker-safe).
 * 2. Se houver texto suficiente → manda pro Gemini estruturar.
 * 3. Se for PDF escaneado / sem texto → envia o próprio PDF como data URI
 *    para o Gemini Vision (suporta application/pdf).
 *
 * NUNCA persiste — apenas devolve sugestões pra revisão.
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

const SYSTEM_PROMPT = `Você analisa PDFs brasileiros de boletos, Pix copia e cola, contas de luz/água/internet/condomínio, faturas com vencimento e cobranças similares.

OBJETIVO: extrair UMA LISTA de contas a pagar encontradas no PDF (pode ter 1 ou várias). Cada conta deve vir como item separado.

PARA CADA CONTA, EXTRAIA:
- nome (string curta): tipo da conta. Ex.: "Conta de luz", "Internet Vivo", "Aluguel março", "Boleto Magalu".
- beneficiario (string): "Cedente"/"Beneficiário"/"Recebedor"/"Favorecido".
- valor (number em reais > 0): valor TOTAL a pagar. Vírgula é decimal, ponto é milhar.
  IGNORE valores rotulados como "Mora/Multa", "Desconto", "Juros calculados", "Outros acréscimos".
  NUNCA retorne 0 ou negativo.
- dataVencimento (string ISO YYYY-MM-DD): aceita "12/03/2025", "12 mar 2025". Se vier só "DD/MM", use o ano corrente.
- formaPagamento: um destes ids: ${FORMAS_VALIDAS.join(", ")}.
  Heurística: linha digitável → "boleto"; Pix copia e cola/QR → "pix"; senão null.
- codigoBoleto (string): linha digitável (47/48 dígitos) ou código de barras (44 dígitos). Sem caracteres extras além de pontos/espaços.
- codigoPix (string): Pix copia e cola (BR Code). Começa com "00020126" tipicamente. NÃO confunda com chave Pix.
- chavePix (string): chave Pix (CPF, CNPJ, e-mail, telefone, aleatória).
- bancoEmissor (string): banco que emitiu/recebe. Ex.: "Itaú", "Bradesco", "Mercado Pago".
- categoriaSugerida: ${CATEGORIAS_VALIDAS.join(", ")}.
  Heurística: luz/água/gás/internet/telefone → contas; condomínio/aluguel → moradia; escola → educacao; plano de saúde → saude; Netflix/Spotify → assinaturas. Senão "outros".
- observacao (string curta opcional): detalhes que não couberam (ex.: "Parcela 3/12", "Ref. fevereiro").
- confianca: "alta" | "media" | "baixa".

PRIVACIDADE — NUNCA inclua número completo de cartão, CVV, senha, dados bancários sensíveis além do que é público no boleto/Pix.

Se o PDF não contiver nenhuma conta legível, retorne itens=[] com observacao explicando.`;

type ContaBruta = {
  nome?: unknown;
  beneficiario?: unknown;
  valor?: unknown;
  dataVencimento?: unknown;
  formaPagamento?: unknown;
  codigoBoleto?: unknown;
  codigoPix?: unknown;
  chavePix?: unknown;
  bancoEmissor?: unknown;
  categoriaSugerida?: unknown;
  observacao?: unknown;
  confianca?: unknown;
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
    .replace(/\b(?:\d[ -]?){12}(\d{4})\b/g, "**** **** **** $1")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[CPF]")
    .replace(/\bCVV[:\s]*\d{3,4}\b/gi, "[CVV]")
    .slice(0, 60_000);
}

function sanitizeCodigo(s: string): string {
  return s.replace(/[^0-9A-Za-z. ]/g, "").trim();
}

const TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "registrar_contas_pdf",
    description: "Estrutura a lista de contas a pagar encontradas no PDF.",
    parameters: {
      type: "object",
      properties: {
        itens: {
          type: "array",
          items: {
            type: "object",
            properties: {
              nome: { type: ["string", "null"] },
              beneficiario: { type: ["string", "null"] },
              valor: { type: ["number", "null"] },
              dataVencimento: { type: ["string", "null"] },
              formaPagamento: {
                type: ["string", "null"],
                enum: [...FORMAS_VALIDAS, null],
              },
              codigoBoleto: { type: ["string", "null"] },
              codigoPix: { type: ["string", "null"] },
              chavePix: { type: ["string", "null"] },
              bancoEmissor: { type: ["string", "null"] },
              categoriaSugerida: {
                type: ["string", "null"],
                enum: [...CATEGORIAS_VALIDAS, null],
              },
              observacao: { type: ["string", "null"] },
              confianca: { type: "string", enum: ["alta", "media", "baixa"] },
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
          content: `Texto extraído de PDF de cobrança/boleto/Pix. Extraia a(s) conta(s) a pagar.\n\n----INÍCIO----\n${text}\n----FIM----`,
        },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "registrar_contas_pdf" } },
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
              text: "Este é um PDF de boleto/Pix/conta (provavelmente escaneado). Extraia a(s) conta(s) a pagar.",
            },
            { type: "image_url", image_url: { url: pdfDataUri } },
          ],
        },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "registrar_contas_pdf" } },
    }),
  });
}

function normalizeContas(raw: ContaBruta[]) {
  return raw
    .map((c) => {
      const valor = typeof c.valor === "number" && c.valor > 0 ? Number(c.valor.toFixed(2)) : null;
      const venc =
        typeof c.dataVencimento === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.dataVencimento)
          ? c.dataVencimento
          : null;
      const forma =
        typeof c.formaPagamento === "string" && FORMAS_VALIDAS.includes(c.formaPagamento)
          ? c.formaPagamento
          : null;
      const cat =
        typeof c.categoriaSugerida === "string" && CATEGORIAS_VALIDAS.includes(c.categoriaSugerida)
          ? c.categoriaSugerida
          : null;
      return {
        nome: typeof c.nome === "string" ? c.nome.slice(0, 80) : null,
        beneficiario: typeof c.beneficiario === "string" ? c.beneficiario.slice(0, 120) : null,
        valor,
        dataVencimento: venc,
        formaPagamento: forma,
        codigoBoleto:
          typeof c.codigoBoleto === "string" && c.codigoBoleto.trim()
            ? sanitizeCodigo(c.codigoBoleto).slice(0, 80)
            : null,
        codigoPix:
          typeof c.codigoPix === "string" && c.codigoPix.trim()
            ? c.codigoPix.trim().slice(0, 600)
            : null,
        chavePix:
          typeof c.chavePix === "string" && c.chavePix.trim()
            ? c.chavePix.trim().slice(0, 120)
            : null,
        bancoEmissor: typeof c.bancoEmissor === "string" ? c.bancoEmissor.slice(0, 80) : null,
        categoriaSugerida: cat,
        observacao: typeof c.observacao === "string" ? c.observacao.slice(0, 300) : null,
        confianca:
          c.confianca === "alta" || c.confianca === "media" || c.confianca === "baixa"
            ? c.confianca
            : "baixa",
      };
    })
    .filter((c) => c.valor !== null || c.codigoBoleto || c.codigoPix || c.nome || c.beneficiario);
}

export const Route = createFileRoute("/api/import-conta-pdf")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __user = await getUserFromRequest(request);
        if (!__user) return unauthorizedResponse();
        const __gate = await ensurePremiumFeatureAccess(__user, "importar_conta");
        if (__gate) return __gate;
        const __rl = await enforceUserRateLimit({
          scope: "import",
          userId: __user.id,
          route: "import-conta-pdf",
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
          if (bytes.length > 10 * 1024 * 1024) {
            return Response.json(
              { error: "PDF muito grande. Tente um arquivo menor que 10 MB." },
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
              typeof result.text === "string" ? result.text : (result.text as string[]).join("\n");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/password/i.test(msg)) {
              return Response.json(
                {
                  error:
                    "Não foi possível ler este PDF. Se ele tiver senha, exporte uma versão sem senha ou envie como imagem.",
                },
                { status: 400 },
              );
            }
            console.error("[import-conta-pdf] extractText error", msg);
          }

          const cleanText = sanitizeText(extractedText.trim());
          const hasUsefulText = cleanText.length > 80;

          const aiResp = hasUsefulText
            ? await callGeminiWithText(apiKey, cleanText)
            : await callGeminiWithPdf(
                apiKey,
                pdf.startsWith("data:") ? pdf : `data:application/pdf;base64,${pdf}`,
              );

          if (!aiResp.ok) {
            const text = await aiResp.text();
            console.error("[import-conta-pdf] AI gateway error", aiResp.status, text);
            if (aiResp.status === 429) {
              return Response.json(
                { error: "Muitas leituras seguidas. Tente em alguns segundos." },
                { status: 429 },
              );
            }
            if (aiResp.status === 402) {
              return Response.json(
                { error: "Sem créditos da IA. Adicione créditos no workspace." },
                { status: 402 },
              );
            }
            return Response.json({ error: "Não foi possível ler este PDF." }, { status: 502 });
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
          let parsed: { itens?: ContaBruta[]; observacao?: unknown };
          try {
            parsed = JSON.parse(argsStr);
          } catch {
            return Response.json({ error: "Resposta inválida da IA." }, { status: 502 });
          }
          const itens = normalizeContas(Array.isArray(parsed.itens) ? parsed.itens : []);

          return Response.json({
            itens,
            paginas: totalPages,
            modo: hasUsefulText ? "texto" : "ocr",
            observacao: typeof parsed.observacao === "string" ? parsed.observacao : null,
          });
        } catch (err) {
          console.error("[import-conta-pdf] erro", err);
          return Response.json(
            { error: "Ocorreu um erro interno. Tente novamente." },
            { status: 500 },
          );
        }
      },
    },
  },
});
