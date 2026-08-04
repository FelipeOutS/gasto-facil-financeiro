import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  ensurePremiumFeatureAccess,
} from "@/server/api-auth";
import { enforceUserRateLimit } from "@/server/rate-limit.server";

/**
 * Importação de fatura por imagem/print via Lovable AI Gateway (Gemini Vision).
 * Recebe { images: ["data:image/...;base64,...", ...] } (1 a 4 imagens) e
 * retorna { itens: [...], confianca, observacao }.
 *
 * IMPORTANTE: nunca persiste nada — apenas estrutura sugestões para o usuário
 * revisar. Não retorna número completo de cartão, CVV ou senha.
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

const SYSTEM_PROMPT = `Você analisa imagens de FATURAS de cartão de crédito brasileiras (PDFs convertidos em imagem, prints de app de banco, capturas com lista de compras).

OBJETIVO: extrair UMA LISTA de compras encontradas, com descrição, valor, data, parcelas e categoria sugerida.

REGRAS DE VALOR (em reais):
- Reconheça padrões: "R$ 150,00", "R$150,00", "1.250,90", "RS 150,00", "BRL 150,00", "150,00".
- Trate vírgula como decimal e ponto como separador de milhar (formato BR).
- IGNORE valores marcados como "Pagamento", "Crédito", "Estorno", "Saldo anterior", "Total da fatura", "Limite", "Disponível", "Próxima fatura".
- Se um valor estiver claramente negativo (ex: "-R$ 50,00" ou "CRED"), pule.

DATAS:
- Formato ISO YYYY-MM-DD. Aceite formatos brasileiros como "12/03", "12/03/2025", "12 MAR".
- Se só tiver dia/mês, use o ano atual da fatura quando souber, senão deixe null.

HORÁRIO (opcional):
- Quando o print/fatura mostrar horário da compra (ex: "14:30", "14h30", "às 19:45", "08:15"), preencha "horario" no formato HH:mm (24h).
- Se não houver horário, deixe null.

PARCELAS:
- Reconheça "1/10", "01/10", "PARC 02/06", "parcela 3 de 12", "3 de 12 vezes".
- Quando achar, preencha parcelaAtual e totalParcelas. Caso contrário, deixe null.

DESCRIÇÃO/ESTABELECIMENTO:
- Pegue o nome do estabelecimento como aparece (ex: "IFOOD MARIA SILVA", "UBER *TRIP", "MERCADO PAGO BR").
- Curto, sem números longos de cartão, sem CNPJ.

CATEGORIA SUGERIDA (use apenas estes ids):
${CATEGORIAS_VALIDAS.join(", ")}
Heurísticas: iFood/restaurante/lanche → alimentacao; Uber/99/posto/combustível → transporte; Netflix/Spotify/Prime/Disney → assinaturas; farmácia/drogaria → farmacia; mercado/supermercado/atacado → mercado; Shopee/Mercado Livre/Amazon/AliExpress → online; conta/boleto/energia/água/internet → contas. Se não tiver certeza, use "outros".

CONFIANÇA por item: "alta" | "media" | "baixa".
- "baixa" se faltar valor ou data.
- "media" se faltar categoria ou parcela quando parecia haver.
- "alta" se tudo estiver claro.

PRIVACIDADE — NUNCA inclua:
- número completo do cartão (apenas últimos 4 dígitos quando aparecerem visíveis ok, mas em "observacao", nunca em "descricao")
- CVV, senha, validade completa, dados bancários sensíveis.

Se a imagem não for legível como fatura, retorne itens=[] com observacao explicando.`;

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

export const Route = createFileRoute("/api/import-fatura-imagem")({
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
          route: "import-fatura-imagem",
          request,
        });
        if (__rl) return __rl;
        try {
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return Response.json({ error: "Serviço de IA indisponível." }, { status: 500 });
          }

          const body = (await request.json()) as { images?: string[] };
          const images = Array.isArray(body?.images) ? body.images : [];
          const valid = images
            .filter((s) => typeof s === "string" && s.startsWith("data:image/"))
            .slice(0, 10);
          if (valid.length === 0) {
            return Response.json(
              { error: "Envie ao menos uma imagem em base64." },
              { status: 400 },
            );
          }
          const totalSize = valid.reduce((s, img) => s + img.length, 0);
          if (totalSize > 30 * 1024 * 1024) {
            return Response.json(
              { error: "Imagens muito grandes. Reduza o tamanho ou envie menos imagens." },
              { status: 413 },
            );
          }

          const userContent: Array<
            { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
          > = [
            {
              type: "text",
              text: "Analise esta(s) imagem(ns) de fatura/print e extraia a lista de compras.",
            },
            ...valid.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ];

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
                              confianca: {
                                type: "string",
                                enum: ["alta", "media", "baixa"],
                              },
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
                },
              ],
              tool_choice: {
                type: "function",
                function: { name: "registrar_compras_fatura" },
              },
            }),
          });

          if (!aiResp.ok) {
            const text = await aiResp.text();
            console.error("[import-fatura-imagem] AI gateway error", aiResp.status, text);
            if (aiResp.status === 429) {
              return Response.json(
                {
                  error: "Muitas leituras seguidas. Tenta de novo em alguns segundos.",
                },
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
            return Response.json({ error: "Não consegui ler essa imagem agora." }, { status: 502 });
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

          let parsed: { itens?: ItemBruto[]; observacao?: unknown };
          try {
            parsed = JSON.parse(argsStr);
          } catch {
            return Response.json({ error: "Resposta inválida da IA." }, { status: 502 });
          }

          const itensRaw = Array.isArray(parsed.itens) ? parsed.itens : [];
          const itens = itensRaw
            .map((it) => {
              const valor = typeof it.valor === "number" && it.valor > 0 ? it.valor : null;
              const data =
                typeof it.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.data) ? it.data : null;
              const horarioMatch =
                typeof it.horario === "string"
                  ? it.horario.match(/\b(\d{1,2})[:hH](\d{2})\b/)
                  : null;
              const horario = horarioMatch
                ? `${String(Math.min(23, parseInt(horarioMatch[1], 10))).padStart(2, "0")}:${String(Math.min(59, parseInt(horarioMatch[2], 10))).padStart(2, "0")}`
                : null;
              const cat =
                typeof it.categoriaSugerida === "string" &&
                CATEGORIAS_VALIDAS.includes(it.categoriaSugerida)
                  ? it.categoriaSugerida
                  : null;
              const desc = typeof it.descricao === "string" ? it.descricao.slice(0, 80) : null;
              const estab =
                typeof it.estabelecimento === "string" ? it.estabelecimento.slice(0, 80) : null;
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
            // Mantém só itens com pelo menos um sinal útil
            .filter((it) => it.valor !== null || it.descricao || it.estabelecimento);

          return Response.json({
            itens,
            observacao: typeof parsed.observacao === "string" ? parsed.observacao : null,
          });
        } catch (err) {
          console.error("[import-fatura-imagem] erro", err);
          return Response.json(
            { error: "Ocorreu um erro interno. Tente novamente." },
            { status: 500 },
          );
        }
      },
    },
  },
});
