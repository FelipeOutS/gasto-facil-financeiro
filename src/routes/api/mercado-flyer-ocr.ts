import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  isAdminMasterUser,
  premiumForbiddenResponse,
} from "@/server/api-auth";
import { enforceUserRateLimit } from "@/server/rate-limit.server";

/**
 * V2.3.3 — Preço Comunitário: leitura de panfleto/encarte por foto.
 *
 * Recebe { imageBase64, marketName?, city?, neighborhood? } e devolve
 * { items, warnings, debugInfo }. Nada é salvo — o usuário revisa e
 * confirma antes de gravar via `createCommunityPrices`.
 *
 * Estratégia de extração:
 *  1) Primeira tentativa com prompt "completo" e modelo rápido.
 *  2) Se 0 itens, fallback automático com prompt MAIS PERMISSIVO usando
 *     modelo mais forte (gemini-2.5-pro) que pede qualquer par
 *     produto+preço visível.
 *
 * Segurança:
 *  - exige autenticação (Bearer) e plano `mercado_avancado`;
 *  - rate-limit (escopo "import");
 *  - chave da IA só em process.env.LOVABLE_API_KEY;
 *  - imagem NUNCA é persistida;
 *  - debugInfo NÃO contém base64, coordenadas nem PII.
 */

const SYSTEM_PROMPT_PRIMARY = `Você analisa fotos de panfletos, encartes e ofertas de supermercados brasileiros.

OBJETIVO: extrair o MÁXIMO de produtos visíveis com nome e preço. O usuário SEMPRE revisa antes de salvar — prefira retornar a mais do que a menos.

PARA CADA PRODUTO VISÍVEL extraia:
- productName: nome do produto (string, obrigatório). Se o nome estiver parcialmente legível, retorne o que conseguir ler com confidence menor. Se o preço estiver claro mas o nome não, use "Produto não identificado" e adicione note explicando.
- price: preço em reais como NÚMERO. "R$ 9,99" → 9.99; "R$ 1.299,90" → 1299.90; "2 por R$ 5,00" → 2.50; "leve 3 pague 2 a R$ 9" → 6.00 (preço unitário efetivo se calculável, senão o de capa).
- unit: quando aparecer (kg, g, un, pacote, caixa, litro, ml, bandeja, fardo, lata, garrafa, dúzia). Se não souber, deixe null.
- category: categoria provável (padaria, açougue, hortifruti, laticínios, mercearia, bebidas, limpeza, higiene, congelados, pet, outros). Se não souber, deixe null.
- marketName: se aparecer no panfleto, senão null.
- validUntil: data YYYY-MM-DD se aparecer "válido até dd/mm/aaaa", senão null.
- notes: observações relevantes ("clube", "app", "leve 3 pague 2", "a partir de", "somente unidade selecionada", "promoção"). String curta ou null.
- confidence: 0.0 a 1.0 indicando sua confiança naquele item específico.

REGRAS IMPORTANTES:
- NÃO descarte itens só porque não tem categoria ou unidade. Se tem nome (mesmo parcial) E preço, RETORNE.
- Se a foto tem MUITOS produtos, retorne TODOS que conseguir identificar — não pare nos primeiros.
- Preços brasileiros: vírgula é decimal, ponto é separador de milhar.
- NUNCA invente produtos que não estão na imagem.
- NUNCA retorne dados pessoais, CPF, telefone ou números de cartão.

Se a imagem não é um panfleto de mercado ou está completamente ilegível, retorne items vazio e adicione um warning explicando.`;

const SYSTEM_PROMPT_FALLBACK = `Você está vendo uma foto que PROVAVELMENTE é um panfleto, encarte ou prateleira de mercado.

Sua tarefa: extrair QUALQUER par visual de "nome de produto" e "preço em reais". Não seja conservador. O usuário irá revisar manualmente cada item antes de salvar, então é melhor retornar pares aproximados do que retornar nada.

Para cada par produto+preço visível:
- productName: o texto do produto. Se ilegível, use "Produto não identificado".
- price: número em reais (vírgula é decimal).
- unit, category, marketName, validUntil: null se não tiver certeza.
- notes: qualquer observação ("clube", "leve X pague Y", etc.) ou null.
- confidence: baixa (0.2-0.5) é OK quando você está em dúvida.

Retorne o MÁXIMO de itens possível. Não limite a quantidade.
NUNCA invente produtos que não estão na imagem.
NUNCA retorne dados pessoais.`;

type DetectedItem = {
  productName: string;
  price: number | null;
  unit: string | null;
  category: string | null;
  marketName: string | null;
  validUntil: string | null;
  notes: string | null;
  confidence: number | null;
};

const TOOL_SCHEMA = {
  type: "function" as const,
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
              unit: { type: ["string", "null"] },
              category: { type: ["string", "null"] },
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
};

async function callGateway(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
  imageDataUrl: string,
) {
  return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: {
        type: "function",
        function: { name: "registrar_itens_panfleto" },
      },
    }),
  });
}

function parseItems(
  argsStr: string,
  fallbackMarketName: string | undefined,
): { items: DetectedItem[]; warnings: string[] } {
  let parsed: { items?: unknown[]; warnings?: unknown[] };
  try {
    parsed = JSON.parse(argsStr);
  } catch {
    return { items: [], warnings: ["parse_error"] };
  }
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = rawItems
    .map((raw): DetectedItem | null => {
      const it = raw as Record<string, unknown>;
      const productName =
        typeof it.productName === "string" ? it.productName.trim().slice(0, 200) : "";
      if (!productName) return null;
      const priceNum = typeof it.price === "number" ? it.price : Number(it.price);
      const price = Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null;
      return {
        productName,
        price,
        unit:
          typeof it.unit === "string" && it.unit.trim()
            ? it.unit.trim().toLowerCase().slice(0, 24)
            : null,
        category:
          typeof it.category === "string" && it.category.trim()
            ? it.category.trim().toLowerCase().slice(0, 40)
            : null,
        marketName:
          typeof it.marketName === "string" && it.marketName.trim()
            ? it.marketName.trim().slice(0, 120)
            : fallbackMarketName?.trim().slice(0, 120) ?? null,
        validUntil:
          typeof it.validUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.validUntil)
            ? it.validUntil
            : null,
        notes:
          typeof it.notes === "string" && it.notes.trim()
            ? it.notes.trim().slice(0, 240)
            : null,
        confidence:
          typeof it.confidence === "number" && it.confidence >= 0 && it.confidence <= 1
            ? it.confidence
            : null,
      };
    })
    .filter((x): x is DetectedItem => x !== null)
    .slice(0, 100);

  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings
        .filter((w): w is string => typeof w === "string")
        .map((w) => w.slice(0, 200))
        .slice(0, 10)
    : [];
  return { items, warnings };
}

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
          if (!img || typeof img !== "string") {
            return Response.json({ error: "Envie uma imagem válida." }, { status: 400 });
          }
          // HEIC / HEIF não é suportado pelos modelos de visão atuais.
          if (/^data:image\/(heic|heif)/i.test(img)) {
            return Response.json(
              {
                error:
                  "Formato HEIC/HEIF não suportado. Converta para JPG, PNG ou WEBP antes de enviar.",
              },
              { status: 415 },
            );
          }
          if (!img.startsWith("data:image/")) {
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
          if (body.marketName)
            hintParts.push(`Mercado informado pelo usuário: ${String(body.marketName).slice(0, 80)}.`);
          if (body.city) hintParts.push(`Cidade: ${String(body.city).slice(0, 80)}.`);
          if (body.neighborhood) hintParts.push(`Bairro: ${String(body.neighborhood).slice(0, 80)}.`);

          const userTextPrimary = `Analise este panfleto/encarte e liste TODOS os produtos em oferta que conseguir identificar. ${hintParts.join(" ")}`;
          const userTextFallback = `Esta imagem é um panfleto/encarte de mercado. Extraia QUALQUER par visual nome+preço que conseguir ver, mesmo com baixa confiança. ${hintParts.join(" ")}`;

          let usedFallback = false;
          let items: DetectedItem[] = [];
          let warnings: string[] = [];

          // 1ª tentativa — modelo rápido + prompt principal
          const r1 = await callGateway(
            apiKey,
            "google/gemini-2.5-flash",
            SYSTEM_PROMPT_PRIMARY,
            userTextPrimary,
            img,
          );
          if (!r1.ok) {
            const text = await r1.text();
            console.error("[mercado-flyer-ocr] gateway #1", r1.status, text.slice(0, 200));
            if (r1.status === 429) {
              return Response.json(
                { error: "Muitas leituras seguidas. Aguarde alguns segundos e tente de novo." },
                { status: 429 },
              );
            }
            if (r1.status === 402) {
              return Response.json(
                { error: "Sem créditos da IA. Adicione créditos no workspace para continuar." },
                { status: 402 },
              );
            }
            return Response.json({ error: "Não conseguimos ler esse panfleto agora." }, { status: 502 });
          }
          const j1 = await r1.json();
          const args1 = j1?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
          if (args1) {
            const parsed = parseItems(args1, body.marketName);
            items = parsed.items;
            warnings = parsed.warnings;
          }

          // 2ª tentativa (fallback) — modelo mais forte + prompt permissivo
          if (items.length === 0) {
            usedFallback = true;
            const r2 = await callGateway(
              apiKey,
              "google/gemini-2.5-pro",
              SYSTEM_PROMPT_FALLBACK,
              userTextFallback,
              img,
            );
            if (r2.ok) {
              const j2 = await r2.json();
              const args2 = j2?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
              if (args2) {
                const parsed = parseItems(args2, body.marketName);
                items = parsed.items;
                if (parsed.warnings.length) warnings = [...warnings, ...parsed.warnings];
              }
            } else {
              const text = await r2.text();
              console.error("[mercado-flyer-ocr] gateway #2", r2.status, text.slice(0, 200));
              if (r2.status === 429 || r2.status === 402) {
                // Não interrompe — segue retornando 0 itens com warning.
                warnings.push("fallback_rate_limited");
              }
            }
            if (items.length === 0) {
              warnings.push("no_items_detected");
            }
          }

          return Response.json(
            {
              items,
              warnings,
              debugInfo: {
                usedFallback,
                itemCount: items.length,
              },
            },
            { status: 200 },
          );
        } catch (err) {
          console.error("[mercado-flyer-ocr] erro", err);
          return Response.json({ error: "Erro inesperado ao ler o panfleto." }, { status: 500 });
        }
      },
    },
  },
});
