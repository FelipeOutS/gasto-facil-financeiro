import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  ensurePremiumFeatureAccess,
} from "@/server/api-auth";
import { enforceUserRateLimit } from "@/server/rate-limit.server";

/**
 * Importação de conta a pagar (boleto / Pix copia e cola / fatura solta)
 * via Lovable AI Gateway. Aceita imagens (base64), texto livre, ou ambos.
 *
 * IMPORTANTE: nunca persiste nada — apenas estrutura sugestões para revisão.
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

const SYSTEM_PROMPT = `Você analisa boletos brasileiros, Pix copia e cola, faturas com vencimento, contas de luz/água/internet/condomínio e similares. O OBJETIVO é extrair UMA conta a pagar para o usuário revisar antes de salvar.

EXTRAIA quando possível:
- nome (string curta): tipo da conta. Ex.: "Conta de luz", "Internet Vivo", "Aluguel março", "Boleto Magalu". Se houver "Histórico" ou "Descrição" no boleto, use isso.
- beneficiario (string): quem recebe. Em boleto, é o "Cedente"/"Beneficiário". Em Pix, é o "Recebedor"/"Favorecido".
- valor (number em reais): valor TOTAL a pagar. Trate vírgula como decimal.
  IGNORE valores rotulados como "Mora/Multa", "Desconto", "Juros calculados", "Outros acréscimos" — pegue o valor principal/cobrado.
  NUNCA retorne valor 0 ou negativo.
- dataVencimento (string ISO YYYY-MM-DD): aceita "12/03/2025", "12 mar 2025", "Vencimento: 10/04". Se vier só "DD/MM", use o ano corrente.
- formaPagamento: um destes ids exatamente:
  ${FORMAS_VALIDAS.join(", ")}
  Heurística: presença de linha digitável → "boleto"; presença de Pix copia e cola/QR → "pix"; senão deixe null.
- codigoBoleto (string): linha digitável do boleto (47 ou 48 dígitos, com ou sem pontos/espaços). Se a imagem mostrar só código de barras numérico de 44 dígitos, retorne esse mesmo. Sem caracteres não-numéricos extras além de pontos e espaços.
- codigoPix (string): Pix copia e cola (BR Code). Começa tipicamente com "00020126" e termina com 4 dígitos de CRC. Pode ser longo. NÃO confunda com chave Pix.
- chavePix (string): chave Pix (CPF, CNPJ, e-mail, telefone, ou aleatória). Se houver tanto chave quanto BR Code, preencha os dois campos.
- bancoEmissor (string): banco que emitiu o boleto/recebe Pix. Ex.: "Itaú", "Bradesco", "Banco do Brasil", "Mercado Pago".
- categoriaSugerida (use apenas estes ids):
  ${CATEGORIAS_VALIDAS.join(", ")}
  Heurísticas: luz/água/gás/internet/telefone → contas; condomínio/aluguel → moradia; escola/curso → educacao; plano de saúde/consulta → saude; Netflix/Spotify → assinaturas; iFood/restaurante → alimentacao. Se não tiver certeza, "outros".
- observacao (string curta opcional): qualquer detalhe relevante que não coube nos campos acima (ex.: "Parcela 3/12", "Referente a fevereiro").

CONFIANÇA geral: "alta" | "media" | "baixa".
- "alta" se valor + vencimento + (boleto OU pix) estiverem claros.
- "baixa" se faltar valor ou vencimento.

PRIVACIDADE — NUNCA inclua número completo de cartão, CVV, senha, dados bancários sensíveis além do que é público num boleto/Pix.

Se a imagem/texto não for legível como conta, retorne conta=null com observacao explicando.`;

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

function sanitizeCodigo(s: string): string {
  return s.replace(/[^0-9A-Za-z. ]/g, "").trim();
}

export const Route = createFileRoute("/api/import-conta")({
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
          route: "import-conta",
          request,
        });
        if (__rl) return __rl;
        try {
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return Response.json({ error: "LOVABLE_API_KEY não configurada." }, { status: 500 });
          }

          const body = (await request.json()) as {
            images?: string[];
            text?: string;
          };
          const images = Array.isArray(body?.images)
            ? body.images
                .filter((s) => typeof s === "string" && s.startsWith("data:image/"))
                .slice(0, 4)
            : [];
          const text = typeof body?.text === "string" ? body.text.slice(0, 8000) : "";

          if (images.length === 0 && !text.trim()) {
            return Response.json(
              { error: "Envie uma imagem ou cole o texto da conta." },
              { status: 400 },
            );
          }

          const userContent: Array<
            { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
          > = [];
          userContent.push({
            type: "text",
            text:
              text.trim().length > 0
                ? `Texto da conta a interpretar:\n\n${text}\n\nExtraia uma única conta a pagar.`
                : "Analise esta imagem de boleto/Pix/conta e extraia uma única conta a pagar.",
          });
          for (const url of images) {
            userContent.push({ type: "image_url", image_url: { url } });
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
                { role: "user", content: userContent },
              ],
              tools: [
                {
                  type: "function",
                  function: {
                    name: "registrar_conta_a_pagar",
                    description: "Estrutura a conta a pagar identificada para revisão do usuário.",
                    parameters: {
                      type: "object",
                      properties: {
                        conta: {
                          type: ["object", "null"],
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
                            confianca: {
                              type: "string",
                              enum: ["alta", "media", "baixa"],
                            },
                          },
                          required: ["confianca"],
                          additionalProperties: false,
                        },
                        observacao: { type: ["string", "null"] },
                      },
                      required: ["conta"],
                      additionalProperties: false,
                    },
                  },
                },
              ],
              tool_choice: {
                type: "function",
                function: { name: "registrar_conta_a_pagar" },
              },
            }),
          });

          if (!aiResp.ok) {
            const t = await aiResp.text();
            console.error("[import-conta] AI gateway", aiResp.status, t);
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
            return Response.json({ error: "Não consegui ler essa conta agora." }, { status: 502 });
          }

          const json = await aiResp.json();
          const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
          const argsStr = toolCall?.function?.arguments;
          if (!argsStr) {
            return Response.json(
              { error: "A IA não conseguiu estruturar a leitura." },
              { status: 502 },
            );
          }

          let parsed: { conta?: ContaBruta | null; observacao?: unknown };
          try {
            parsed = JSON.parse(argsStr);
          } catch {
            return Response.json({ error: "Resposta inválida da IA." }, { status: 502 });
          }

          const c = parsed.conta;
          if (!c) {
            return Response.json({
              conta: null,
              observacao:
                typeof parsed.observacao === "string"
                  ? parsed.observacao
                  : "Não consegui identificar uma conta na leitura.",
            });
          }

          const valor =
            typeof c.valor === "number" && c.valor > 0 ? Number(c.valor.toFixed(2)) : null;
          const venc =
            typeof c.dataVencimento === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.dataVencimento)
              ? c.dataVencimento
              : null;
          const forma =
            typeof c.formaPagamento === "string" && FORMAS_VALIDAS.includes(c.formaPagamento)
              ? c.formaPagamento
              : null;
          const cat =
            typeof c.categoriaSugerida === "string" &&
            CATEGORIAS_VALIDAS.includes(c.categoriaSugerida)
              ? c.categoriaSugerida
              : null;

          const conta = {
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

          return Response.json({
            conta,
            observacao: typeof parsed.observacao === "string" ? parsed.observacao : null,
          });
        } catch (err) {
          console.error("[import-conta] erro", err);
          return Response.json(
            { error: "Ocorreu um erro interno. Tente novamente." },
            { status: 500 },
          );
        }
      },
    },
  },
});
