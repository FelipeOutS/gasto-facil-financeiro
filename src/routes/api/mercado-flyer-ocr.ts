import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  isAdminMasterUser,
  premiumForbiddenResponse,
} from "@/server/api-auth";
import { enforceUserRateLimit } from "@/server/rate-limit.server";

/**
 * V2.3 — Preço Comunitário: leitura de panfleto/encarte por foto.
 *
 * Recebe { imageBase64, marketName?, city?, neighborhood? } e devolve
 * uma LISTA de itens detectados (productName, price, unit, marketName,
 * validUntil, notes, category, confidence). Nada é salvo — o usuário
 * revisa e confirma antes de gravar via `createCommunityPrices`.
 *
 * Segurança:
 *  - exige autenticação (Bearer);
 *  - exige plano com feature `mercado_avancado` (inline check para evitar
 *    estender a lista fechada de `ensurePremiumFeatureAccess`);
 *  - rate-limit reaproveita escopo "import" (já dimensionado para chamadas
 *    pesadas de IA por usuário);
 *  - chave da IA permanece apenas em `process.env.LOVABLE_API_KEY`;
 *  - imagem NÃO é persistida — apenas enviada à IA via gateway.
 */

const UNITS = [
  "un",
  "kg",
  "g",
  "l",
  "ml",
  "pacote",
  "caixa",
  "fardo",
  "duzia",
  "bandeja",
  "garrafa",
  "lata",
  "saco",
];

const CATEGORIES = [
  "padaria",
  "acougue",
  "hortifruti",
  "laticinios",
  "mercearia",
  "bebidas",
  "limpeza",
  "higiene",
  "congelados",
  "pet",
  "outros",
];

const SYSTEM_PROMPT = `Você analisa fotos de panfletos, encartes e ofertas de supermercados brasileiros.

OBJETIVO: extrair uma lista de produtos em oferta com preço, unidade, validade e observações relevantes.

REGRAS DE EXTRAÇÃO:
- Para cada produto visível, extraia: nome do produto, preço (em reais), unidade (un, kg, g, L, ml, pacote, caixa, etc.), mercado (se aparecer no panfleto), validade da promoção (se aparecer) e observações como "leve 3 pague 2", "a partir de", "no clube", "oferta válida até dd/mm".
- Preços brasileiros: "R$ 9,99", "R$9,99", "R$ 1.299,90" → retorne sempre como número (9.99, 1299.90).
- Se o preço estiver visível só em "preço por kg" ou "por unidade", coloque na unidade correspondente.
- NÃO invente produtos. Se um item não tem preço claro, descarte.
- Limite-se aos 30 itens mais bem identificáveis.

CATEGORIAS válidas (use apenas estes ids): ${CATEGORIES.join(", ")}
UNIDADES válidas (use apenas estes ids, normalizadas): ${UNITS.join(", ")}

CONFIDENCE: 0.0 a 1.0 indicando o quão confiante você está naquele item específico.

PRIVACIDADE:
- NUNCA retorne dados pessoais, números de cartão, CPF ou telefones que apareçam no panfleto.

Se a imagem não for um panfleto/encarte de mercado ou estiver ilegível, retorne items vazio e adicione um warning.`;

export const Route = createFileRoute("/api/mercado-flyer-ocr")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getUserFromRequest(request);
        if (!user) return unauthorizedResponse("Você precisa estar logado.");

        // Gate de plano — mercado_avancado.
        if (!isAdminMasterUser(user)) {
          try {
            const { getSubscriptionForUserIdentity } = await import("@/server/subscription.server");
            const { planAllowsFeature } = await import("@/lib/plans");
            const sub = await getSubscriptionForUserIdentity({
              userId: user.id,
              email: user.email ?? null,
              repairLink: false,
            });
            if (!sub.active) {
              return premiumForbiddenResponse(
                "mercado_avancado",
                "Sua assinatura não está ativa. Acesse Meu plano para liberar este recurso.",
              );
            }
            if (!planAllowsFeature(sub.plan, "mercado_avancado")) {
              return premiumForbiddenResponse(
                "mercado_avancado",
                "Preço Comunitário está disponível nos planos Controle Completo Pessoal, MEI Completo e Empresa.",
                "Controle Completo Pessoal",
              );
            }
          } catch (err) {
            console.error("[mercado-flyer-ocr] gate erro", err);
            return premiumForbiddenResponse("mercado_avancado", "Não foi possível validar seu plano.");
          }
        }

        const rl = await enforceUserRateLimit({
          scope: "import",
          userId: user.id,
          route: "mercado-flyer-ocr",
          request,
        });
        if (rl) return rl;

        try {
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return Response.json({ error: "Serviço indisponível no momento." }, { status: 500 });
          }

          const body = (await request.json()) as {
            imageBase64?: string;
            marketName?: string;
            city?: string;
            neighborhood?: string;
          };

          const img = body?.imageBase64;
          if (!img || typeof img !== "string" || !img.startsWith("data:image/")) {
            return Response.json({ error: "Envie uma imagem válida." }, { status: 400 });
          }

          const mimeMatch = img.match(/^data:image\/(jpeg|jpg|png|webp);base64,/i);
          if (!mimeMatch) {
            return Response.json(
              { error: "Formato não suportado. Use JPG, PNG ou WEBP." },
              { status: 400 },
            );
          }

          // Limite ~10 MB de imagem (≈14 MB em base64).
          if (img.length > 14 * 1024 * 1024) {
            return Response.json(
              { error: "Imagem muito grande. Use uma foto até 10 MB." },
              { status: 413 },
            );
          }

          const hintParts: string[] = [];
          if (body.marketName) hintParts.push(`Mercado informado pelo usuário: ${String(body.marketName).slice(0, 80)}.`);
          if (body.city) hintParts.push(`Cidade: ${String(body.city).slice(0, 80)}.`);
          if (body.neighborhood) hintParts.push(`Bairro: ${String(body.neighborhood).slice(0, 80)}.`);

          const userText = `Analise este panfleto/encarte e liste os produtos em oferta. ${hintParts.join(" ")}`;

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
                      { type: "text", text: userText },
                      { type: "image_url", image_url: { url: img } },
                    ],
                  },
                ],
                tools: [
                  {
                    type: "function",
                    function: {
                      name: "registrar_itens_panfleto",
                      description: "Lista de itens extraídos do panfleto.",
                      parameters: {
                        type: "object",
                        properties: {
                          items: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                productName: { type: "string" },
                                price: { type: ["number", "null"] },
                                unit: { type: ["string", "null"], enum: [...UNITS, null] },
                                category: { type: ["string", "null"], enum: [...CATEGORIES, null] },
                                marketName: { type: ["string", "null"] },
                                validUntil: {
                                  type: ["string", "null"],
                                  description: "Data ISO YYYY-MM-DD ou null.",
                                },
                                notes: { type: ["string", "null"] },
                                confidence: { type: ["number", "null"] },
                              },
                              required: ["productName"],
                              additionalProperties: false,
                            },
                          },
                          warnings: { type: "array", items: { type: "string" } },
                        },
                        required: ["items"],
                        additionalProperties: false,
                      },
                    },
                  },
                ],
                tool_choice: {
                  type: "function",
                  function: { name: "registrar_itens_panfleto" },
                },
              }),
            },
          );

          if (!aiResp.ok) {
            const text = await aiResp.text();
            console.error("[mercado-flyer-ocr] AI gateway", aiResp.status, text.slice(0, 300));
            if (aiResp.status === 429) {
              return Response.json(
                { error: "Muitas leituras seguidas. Aguarde alguns segundos e tente de novo." },
                { status: 429 },
              );
            }
            if (aiResp.status === 402) {
              return Response.json(
                { error: "Sem créditos da IA. Adicione créditos no workspace para continuar." },
                { status: 402 },
              );
            }
            return Response.json({ error: "Não conseguimos ler esse panfleto agora." }, { status: 502 });
          }

          const json = await aiResp.json();
          const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
          const argsStr = toolCall?.function?.arguments;
          if (!argsStr) {
            return Response.json({ items: [], warnings: ["empty"] }, { status: 200 });
          }

          let parsed: { items?: unknown[]; warnings?: unknown[] };
          try {
            parsed = JSON.parse(argsStr);
          } catch {
            return Response.json({ items: [], warnings: ["parse_error"] }, { status: 200 });
          }

          const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
          const items = rawItems
            .map((raw) => {
              const it = raw as Record<string, unknown>;
              const productName =
                typeof it.productName === "string" ? it.productName.trim().slice(0, 200) : "";
              if (!productName) return null;
              const priceNum = typeof it.price === "number" ? it.price : Number(it.price);
              const price = Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null;
              return {
                productName,
                price,
                unit: typeof it.unit === "string" ? it.unit : null,
                category: typeof it.category === "string" ? it.category : null,
                marketName:
                  typeof it.marketName === "string" && it.marketName.trim()
                    ? it.marketName.trim().slice(0, 120)
                    : body.marketName?.toString().trim().slice(0, 120) ?? null,
                validUntil:
                  typeof it.validUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.validUntil)
                    ? it.validUntil
                    : null,
                notes:
                  typeof it.notes === "string" && it.notes.trim() ? it.notes.trim().slice(0, 240) : null,
                confidence:
                  typeof it.confidence === "number" && it.confidence >= 0 && it.confidence <= 1
                    ? it.confidence
                    : null,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
            .slice(0, 50);

          const warnings = Array.isArray(parsed.warnings)
            ? parsed.warnings.filter((w): w is string => typeof w === "string").slice(0, 10)
            : [];

          return Response.json({ items, warnings }, { status: 200 });
        } catch (err) {
          console.error("[mercado-flyer-ocr] erro", err);
          return Response.json({ error: "Erro inesperado ao ler o panfleto." }, { status: 500 });
        }
      },
    },
  },
});
