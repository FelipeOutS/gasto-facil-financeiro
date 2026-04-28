import { createFileRoute } from "@tanstack/react-router";

/**
 * OCR de comprovante via Lovable AI Gateway (Gemini Vision).
 * Recebe { imageBase64: "data:image/...;base64,..." } e retorna JSON com:
 *   { valor, valoresEncontrados[], data, descricao, categoriaSugerida,
 *     formaPagamento, confianca, observacao }
 *
 * Nunca salva nada — apenas sugere. O usuário revisa antes de salvar.
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

const FORMAS = [
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
${CATEGORIAS_VALIDAS.join(", ")}
Heurísticas: Uber/99/combustível/estacionamento → transporte; mercado/supermercado → mercado; farmácia/drogaria → farmacia; Netflix/Spotify/assinatura → assinaturas; restaurante/iFood/lanche → alimentacao; aluguel/condomínio → moradia; cabeleireiro/salão/barbeiro → cabeleireiro.

FORMA DE PAGAMENTO (use apenas estes ids): ${FORMAS.join(", ")}

PRIVACIDADE:
- NUNCA retorne número completo de cartão, CVV, senha ou dados bancários sensíveis.
- Pode citar banco/emissor de forma genérica ("Nubank", "Itaú").

CONFIANÇA: "alta" | "media" | "baixa".`;

export const Route = createFileRoute("/api/ocr-gasto")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return Response.json(
              { error: "LOVABLE_API_KEY não configurada." },
              { status: 500 },
            );
          }

          const body = (await request.json()) as { imageBase64?: string };
          const img = body?.imageBase64;
          if (!img || typeof img !== "string" || !img.startsWith("data:image/")) {
            return Response.json(
              { error: "Imagem inválida. Envie data URL base64." },
              { status: 400 },
            );
          }

          const aiResp = await fetch(
            "https://ai.gateway.lovable.dev/v1/chat/completions",
            {
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
                        text: "Analise este comprovante e extraia os dados do gasto.",
                      },
                      { type: "image_url", image_url: { url: img } },
                    ],
                  },
                ],
                tools: [
                  {
                    type: "function",
                    function: {
                      name: "registrar_gasto_extraido",
                      description: "Estrutura os dados do gasto extraídos da imagem.",
                      parameters: {
                        type: "object",
                        properties: {
                          valor: {
                            type: ["number", "null"],
                            description: "Valor principal em reais. null se não identificado.",
                          },
                          valoresEncontrados: {
                            type: "array",
                            items: { type: "number" },
                            description: "Todos os valores monetários encontrados na imagem.",
                          },
                          data: {
                            type: ["string", "null"],
                            description: "Data ISO YYYY-MM-DD ou null.",
                          },
                          descricao: {
                            type: ["string", "null"],
                            description: "Estabelecimento ou descrição curta.",
                          },
                          categoriaSugerida: {
                            type: ["string", "null"],
                            enum: [...CATEGORIAS_VALIDAS, null],
                          },
                          formaPagamento: {
                            type: ["string", "null"],
                            enum: [...FORMAS, null],
                          },
                          confianca: {
                            type: "string",
                            enum: ["alta", "media", "baixa"],
                          },
                          observacao: {
                            type: ["string", "null"],
                            description: "Resumo curto opcional.",
                          },
                        },
                        required: ["valoresEncontrados", "confianca"],
                        additionalProperties: false,
                      },
                    },
                  },
                ],
                tool_choice: {
                  type: "function",
                  function: { name: "registrar_gasto_extraido" },
                },
              }),
            },
          );

          if (!aiResp.ok) {
            const text = await aiResp.text();
            console.error("[ocr-gasto] AI gateway error", aiResp.status, text);
            if (aiResp.status === 429) {
              return Response.json(
                { error: "Muitas leituras seguidas. Tenta de novo em alguns segundos." },
                { status: 429 },
              );
            }
            if (aiResp.status === 402) {
              return Response.json(
                {
                  error:
                    "Sem créditos da IA. Adicione créditos no workspace para continuar usando a leitura por imagem.",
                },
                { status: 402 },
              );
            }
            return Response.json(
              { error: "Não consegui ler essa imagem agora." },
              { status: 502 },
            );
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

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(argsStr);
          } catch {
            return Response.json(
              { error: "Resposta inválida da IA." },
              { status: 502 },
            );
          }

          // Sanitização básica
          const valoresEncontrados = Array.isArray(parsed.valoresEncontrados)
            ? (parsed.valoresEncontrados as unknown[])
                .map((v) => Number(v))
                .filter((n) => Number.isFinite(n) && n > 0)
            : [];

          const result = {
            valor:
              typeof parsed.valor === "number" && parsed.valor > 0
                ? parsed.valor
                : null,
            valoresEncontrados,
            data: typeof parsed.data === "string" ? parsed.data : null,
            descricao: typeof parsed.descricao === "string" ? parsed.descricao : null,
            categoriaSugerida:
              typeof parsed.categoriaSugerida === "string" &&
              CATEGORIAS_VALIDAS.includes(parsed.categoriaSugerida)
                ? parsed.categoriaSugerida
                : null,
            formaPagamento:
              typeof parsed.formaPagamento === "string" &&
              FORMAS.includes(parsed.formaPagamento)
                ? parsed.formaPagamento
                : null,
            confianca:
              parsed.confianca === "alta" ||
              parsed.confianca === "media" ||
              parsed.confianca === "baixa"
                ? parsed.confianca
                : "baixa",
            observacao:
              typeof parsed.observacao === "string" ? parsed.observacao : null,
          };

          return Response.json(result);
        } catch (err) {
          console.error("[ocr-gasto] erro", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Erro desconhecido" },
            { status: 500 },
          );
        }
      },
    },
  },
});
