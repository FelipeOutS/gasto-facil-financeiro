import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  isAdminMasterUser,
  premiumForbiddenResponse,
} from "@/server/api-auth";
import { enforceUserRateLimit } from "@/server/rate-limit.server";

/**
 * V2.3.4 — Preço Comunitário: OCR de panfleto em 2 etapas.
 *
 *  1) Google Cloud Vision (DOCUMENT_TEXT_DETECTION, pt-BR) → texto bruto.
 *  2) Lovable AI Gateway (Gemini) → estrutura texto em itens JSON.
 *
 * Nada é persistido. Nenhuma chave aparece em logs/respostas. A foto não é
 * salva. Em dev logamos apenas {provider, rawTextLength, priceCandidatesCount,
 * itemCount}.
 */

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

const STRUCTURE_PROMPT = `Você receberá texto extraído por OCR de um panfleto de mercado brasileiro.
Extraia o MÁXIMO possível de pares produto + preço.

Regras:
- Não descarte itens por falta de categoria ou unidade.
- Se o produto estiver parcial, mantenha o nome parcial.
- Se o preço estiver claro mas o produto estiver confuso, use "Produto não identificado" com baixa confiança (0.2-0.4).
- Preços brasileiros: vírgula é decimal ("R$ 9,99" → 9.99; "R$ 1.299,90" → 1299.90).
- "2 por R$ 5,00" → price 2.50; "leve 3 pague 2 a R$ 9" → 6.00 (unitário) ou o preço de capa, o que conseguir calcular.
- unit: kg, g, un, pacote, caixa, litro, ml, bandeja, fardo, lata, garrafa, dúzia ou null.
- category: padaria, açougue, hortifruti, laticínios, mercearia, bebidas, limpeza, higiene, congelados, pet, outros, ou null.
- validUntil: YYYY-MM-DD se houver "válido até dd/mm/aaaa", senão null.
- notes: observações curtas ("clube", "leve 3 pague 2", "app", "a partir de") ou null.
- confidence: 0.0 a 1.0.
- NUNCA invente produtos que não estejam no texto.
- NUNCA retorne CPF, telefone, e-mail, números de cartão ou outros dados pessoais.

Retorne APENAS via a função registrar_itens_panfleto.`;

const TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "registrar_itens_panfleto",
    description: "Lista de itens estruturados a partir do texto OCR.",
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
              notes: { type: ["string", "null"] },
              validUntil: { type: ["string", "null"] },
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

// Regex auxiliar p/ contar candidatos a preço BR no texto OCR.
const BR_PRICE_RE =
  /(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})|(?:R\$\s*)?\d+,\d{2}|\b\d+\.\d{2}\b/g;

function countPriceCandidates(text: string): number {
  const m = text.match(BR_PRICE_RE);
  return m ? m.length : 0;
}

async function callVision(
  apiKey: string,
  base64: string,
): Promise<{ ok: true; text: string } | { ok: false; status: number; reason: string }> {
  const resp = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: { languageHints: ["pt-BR"] },
          },
        ],
      }),
    },
  );
  if (!resp.ok) {
    let reason = "vision_http_error";
    try {
      const j = await resp.json();
      reason = String(j?.error?.status ?? j?.error?.message ?? reason).slice(0, 80);
    } catch {
      // ignore
    }
    return { ok: false, status: resp.status, reason };
  }
  let json: any;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, status: 502, reason: "vision_invalid_json" };
  }
  const r0 = json?.responses?.[0];
  if (r0?.error) {
    return {
      ok: false,
      status: 502,
      reason: String(r0.error.message ?? "vision_response_error").slice(0, 80),
    };
  }
  const text: string =
    (typeof r0?.fullTextAnnotation?.text === "string" && r0.fullTextAnnotation.text) ||
    (Array.isArray(r0?.textAnnotations) && typeof r0.textAnnotations[0]?.description === "string"
      ? r0.textAnnotations[0].description
      : "") ||
    "";
  return { ok: true, text };
}

async function callGeminiStructure(
  apiKey: string,
  ocrText: string,
  hint: string,
): Promise<Response> {
  return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: STRUCTURE_PROMPT },
        {
          role: "user",
          content: `${hint ? hint + "\n\n" : ""}Texto OCR do panfleto:\n"""\n${ocrText.slice(0, 16000)}\n"""`,
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

function parseStructured(
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
      const price = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null;
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
        marketName: fallbackMarketName?.trim().slice(0, 120) ?? null,
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
    .filter((x): x is DetectedItem => x !== null && x.price !== null)
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
          const visionKey = process.env.GOOGLE_VISION_API_KEY;
          const aiKey = process.env.LOVABLE_API_KEY;
          if (!visionKey) {
            return Response.json(
              {
                error: "OCR ainda não configurado. Configure GOOGLE_VISION_API_KEY no servidor.",
                code: "ocr_config_missing",
                items: [],
                warnings: ["ocr_config_missing"],
                debugInfo: { provider: "google_vision", configured: false },
              },
              { status: 503 },
            );
          }
          if (!aiKey) {
            return Response.json({ error: "Serviço de IA indisponível." }, { status: 500 });
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
          if (/^data:image\/(heic|heif)/i.test(img)) {
            return Response.json(
              {
                error:
                  "Formato HEIC/HEIF não suportado. Converta para JPG, PNG ou WEBP antes de enviar.",
              },
              { status: 415 },
            );
          }
          const mimeMatch = img.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
          if (!mimeMatch) {
            return Response.json(
              { error: "Formato não suportado. Use JPG, PNG ou WEBP." },
              { status: 400 },
            );
          }
          if (img.length > 14 * 1024 * 1024) {
            return Response.json(
              { error: "Imagem muito grande. Use uma foto até 10 MB." },
              { status: 413 },
            );
          }

          const base64 = mimeMatch[2];

          // 1) Google Vision
          const visionRes = await callVision(visionKey, base64);
          if (!visionRes.ok) {
            console.error("[mercado-flyer-ocr] vision", visionRes.status, visionRes.reason);
            return Response.json(
              {
                error: "Erro ao ler a imagem com OCR.",
                code: "vision_api_error",
                items: [],
                warnings: ["vision_api_error"],
                debugInfo: { provider: "google_vision", status: visionRes.status },
              },
              { status: 502 },
            );
          }

          const rawText = visionRes.text.trim();
          const rawTextLength = rawText.length;
          const priceCandidatesCount = rawText ? countPriceCandidates(rawText) : 0;

          if (!rawText) {
            return Response.json(
              {
                items: [],
                warnings: ["no_text_detected"],
                code: "no_text_detected",
                message:
                  "Não encontramos texto legível nessa foto. Tente tirar a foto mais perto, com boa luz e sem cortar os preços.",
                debugInfo: { provider: "google_vision", rawTextLength: 0, priceCandidatesCount: 0 },
              },
              { status: 200 },
            );
          }

          // 2) Gemini para estruturar
          const hintParts: string[] = [];
          if (body.marketName)
            hintParts.push(`Mercado informado pelo usuário: ${String(body.marketName).slice(0, 80)}.`);
          if (body.city) hintParts.push(`Cidade: ${String(body.city).slice(0, 80)}.`);
          if (body.neighborhood) hintParts.push(`Bairro: ${String(body.neighborhood).slice(0, 80)}.`);

          const r = await callGeminiStructure(aiKey, rawText, hintParts.join(" "));
          if (!r.ok) {
            const text = await r.text().catch(() => "");
            console.error("[mercado-flyer-ocr] gemini", r.status, text.slice(0, 160));
            if (r.status === 429) {
              return Response.json(
                { error: "Muitas leituras seguidas. Aguarde alguns segundos e tente de novo." },
                { status: 429 },
              );
            }
            if (r.status === 402) {
              return Response.json(
                { error: "Sem créditos da IA. Adicione créditos no workspace para continuar." },
                { status: 402 },
              );
            }
            return Response.json(
              {
                error: "Não conseguimos estruturar os itens agora.",
                items: [],
                warnings: ["structuring_failed"],
                debugInfo: {
                  provider: "google_vision_plus_gemini",
                  rawTextLength,
                  priceCandidatesCount,
                  itemCount: 0,
                },
              },
              { status: 502 },
            );
          }

          const j = await r.json();
          const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
          let items: DetectedItem[] = [];
          let warnings: string[] = [];
          if (args) {
            const parsed = parseStructured(args, body.marketName);
            items = parsed.items;
            warnings = parsed.warnings;
          }

          if (items.length === 0) {
            warnings.push("text_found_but_no_items");
            return Response.json(
              {
                items: [],
                warnings,
                code: "text_found_but_no_items",
                message:
                  "Encontramos texto no panfleto, mas não conseguimos montar os produtos automaticamente. Tente outra foto ou cadastre manualmente.",
                debugInfo: {
                  provider: "google_vision_plus_gemini",
                  rawTextLength,
                  priceCandidatesCount,
                  itemCount: 0,
                },
              },
              { status: 200 },
            );
          }

          if (process.env.NODE_ENV !== "production") {
            console.log("[mercado-flyer-ocr]", {
              provider: "google_vision_plus_gemini",
              rawTextLength,
              priceCandidatesCount,
              itemCount: items.length,
            });
          }

          return Response.json(
            {
              items,
              warnings,
              debugInfo: {
                provider: "google_vision_plus_gemini",
                rawTextLength,
                priceCandidatesCount,
                itemCount: items.length,
                usedFallback: false,
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
