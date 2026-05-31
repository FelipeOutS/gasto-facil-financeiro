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

type OcrDiagnostic = {
  provider: "google_vision" | "google_vision_plus_gemini";
  stage: "config" | "payload" | "vision" | "gemini" | "fallback" | "done";
  status: "ok" | "error" | "partial";
  code: string | null;
  hasGoogleVisionKey: boolean;
  imageMime: string;
  originalFileSize: number;
  processedDataUrlLength: number;
  cleanBase64Length: number;
  visionHttpStatus: number | null;
  visionErrorCode: string | null;
  visionErrorMessage: string | null;
  rawTextLength: number;
  priceCandidatesCount: number;
  geminiItemCount: number;
  finalItemCount: number;
  usedFallback: boolean;
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

function estimateBytesFromBase64(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function createDiagnostic(params: {
  provider?: OcrDiagnostic["provider"];
  stage?: OcrDiagnostic["stage"];
  status?: OcrDiagnostic["status"];
  code?: string | null;
  hasGoogleVisionKey: boolean;
  imageMime?: string;
  originalFileSize?: number;
  processedDataUrlLength?: number;
  cleanBase64Length?: number;
}): OcrDiagnostic {
  return {
    provider: params.provider ?? "google_vision",
    stage: params.stage ?? "config",
    status: params.status ?? "ok",
    code: params.code ?? null,
    hasGoogleVisionKey: params.hasGoogleVisionKey,
    imageMime: params.imageMime ?? "unknown",
    originalFileSize: params.originalFileSize ?? 0,
    processedDataUrlLength: params.processedDataUrlLength ?? 0,
    cleanBase64Length: params.cleanBase64Length ?? 0,
    visionHttpStatus: null,
    visionErrorCode: null,
    visionErrorMessage: null,
    rawTextLength: 0,
    priceCandidatesCount: 0,
    geminiItemCount: 0,
    finalItemCount: 0,
    usedFallback: false,
  };
}

function safeDiagnosticForResponse(diagnostic: OcrDiagnostic) {
  return {
    stage: diagnostic.stage,
    code: diagnostic.code,
    provider: diagnostic.provider,
    rawTextLength: diagnostic.rawTextLength,
    priceCandidatesCount: diagnostic.priceCandidatesCount,
    itemCount: diagnostic.finalItemCount,
    usedFallback: diagnostic.usedFallback,
  };
}

function logOcrDiagnostic(diagnostic: OcrDiagnostic) {
  if (process.env.NODE_ENV === "production") return;
  console.info("[mercado-flyer-ocr][diagnostic]", {
    stage: diagnostic.stage,
    status: diagnostic.status,
    code: diagnostic.code,
    rawTextLength: diagnostic.rawTextLength,
    priceCandidatesCount: diagnostic.priceCandidatesCount,
    itemCount: diagnostic.finalItemCount,
    usedFallback: diagnostic.usedFallback,
    provider: diagnostic.provider,
  });
}

function normalizeImagePayload(img: string):
  | { ok: true; cleanBase64: string; imageMime: string }
  | { ok: false; code: "unsupported_image_format" | "invalid_image_payload"; reason: string; imageMime: string; cleanBase64: string } {
  const trimmed = img.trim();
  const dataUrlMatch = trimmed.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
  const heicMatch = trimmed.match(/^data:(image\/(?:heic|heif));base64,/i);
  if (heicMatch) {
    return {
      ok: false,
      code: "unsupported_image_format",
      reason: "Formato HEIC/HEIF não suportado.",
      imageMime: heicMatch[1].toLowerCase(),
      cleanBase64: "",
    };
  }

  const imageMime = dataUrlMatch?.[1]?.toLowerCase() ?? "unknown";
  const cleanBase64 = (dataUrlMatch ? dataUrlMatch[2] : trimmed.includes(",") ? trimmed.split(",").pop() : trimmed)?.replace(/\s/g, "") ?? "";

  if (!dataUrlMatch && !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
    return {
      ok: false,
      code: "invalid_image_payload",
      reason: "Imagem inválida. Envie JPG, PNG ou WEBP em base64.",
      imageMime,
      cleanBase64,
    };
  }

  if (cleanBase64.length <= 1000) {
    return {
      ok: false,
      code: "invalid_image_payload",
      reason: "Base64 da imagem inválido ou muito curto.",
      imageMime,
      cleanBase64,
    };
  }

  return { ok: true, cleanBase64, imageMime };
}

async function callVision(
  apiKey: string,
  base64: string,
): Promise<
  | { ok: true; text: string; status: number }
  | { ok: false; status: number; errorCode: string | null; errorMessage: string | null; reason: string }
> {
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
            imageContext: { languageHints: ["pt-BR", "pt"] },
          },
        ],
      }),
    },
  );
  if (!resp.ok) {
    let reason = "vision_http_error";
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    try {
      const j = await resp.json();
      errorCode = String(j?.error?.status ?? j?.error?.code ?? "").slice(0, 80) || null;
      errorMessage = String(j?.error?.message ?? "").slice(0, 160) || null;
      reason = String(errorCode ?? errorMessage ?? reason).slice(0, 80);
    } catch {
      // ignore
    }
    return { ok: false, status: resp.status, errorCode, errorMessage, reason };
  }
  let json: any;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, status: 502, errorCode: "vision_invalid_json", errorMessage: null, reason: "vision_invalid_json" };
  }
  const r0 = json?.responses?.[0];
  if (r0?.error) {
    const errorCode = String(r0.error.status ?? r0.error.code ?? "vision_response_error").slice(0, 80);
    const errorMessage = String(r0.error.message ?? "vision_response_error").slice(0, 160);
    return {
      ok: false,
      status: 502,
      errorCode,
      errorMessage,
      reason: errorCode,
    };
  }
  const text: string =
    (typeof r0?.fullTextAnnotation?.text === "string" && r0.fullTextAnnotation.text) ||
    (Array.isArray(r0?.textAnnotations) && typeof r0.textAnnotations[0]?.description === "string"
      ? r0.textAnnotations[0].description
      : "") ||
    "";
  return { ok: true, text, status: resp.status };
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

const SIMPLE_FLYER_TEST_IMAGE_BASE64 =
  "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";

async function runOcrPipeline(params: {
  imageBase64: string;
  marketName?: string;
  city?: string;
  neighborhood?: string;
  visionKey: string | undefined;
  aiKey: string | undefined;
}) {
  const hasGoogleVisionKey = Boolean(params.visionKey);
  if (!params.visionKey) {
    const diagnostic = createDiagnostic({ hasGoogleVisionKey });
    logOcrDiagnostic(diagnostic);
    return Response.json(
      {
        success: false,
        error: "OCR ainda não configurado. Configure GOOGLE_VISION_API_KEY no servidor.",
        code: "ocr_config_missing",
        items: [],
        warnings: ["ocr_config_missing"],
        debugInfo: safeDiagnosticForResponse(diagnostic),
      },
      { status: 503 },
    );
  }
  if (!params.aiKey) {
    return Response.json({ success: false, error: "Serviço de IA indisponível.", code: "ai_config_missing" }, { status: 500 });
  }

  const normalized = normalizeImagePayload(params.imageBase64);
  const diagnostic = createDiagnostic({
    hasGoogleVisionKey,
    imageMime: normalized.imageMime,
    processedDataUrlLength: params.imageBase64.length,
    cleanBase64Length: normalized.cleanBase64.length,
    originalFileSize: estimateBytesFromBase64(normalized.cleanBase64),
  });

  if (!normalized.ok) {
    logOcrDiagnostic(diagnostic);
    return Response.json(
      { success: false, error: normalized.reason, code: normalized.code, items: [], warnings: [normalized.code], debugInfo: safeDiagnosticForResponse(diagnostic) },
      { status: normalized.code === "unsupported_image_format" ? 415 : 400 },
    );
  }

  if (params.imageBase64.length > 18 * 1024 * 1024) {
    logOcrDiagnostic(diagnostic);
    return Response.json(
      { success: false, error: "Imagem muito grande. Use uma foto até 10 MB.", code: "image_too_large", items: [], debugInfo: safeDiagnosticForResponse(diagnostic) },
      { status: 413 },
    );
  }

  const visionRes = await callVision(params.visionKey, normalized.cleanBase64);
  diagnostic.visionHttpStatus = visionRes.status;
  if (!visionRes.ok) {
    diagnostic.visionErrorCode = visionRes.errorCode;
    diagnostic.visionErrorMessage = visionRes.errorMessage;
    logOcrDiagnostic(diagnostic);
    return Response.json(
      {
        success: false,
        code: "vision_api_error",
        httpStatus: visionRes.status,
        provider: "google_vision",
        reason: "Falha segura ao chamar Google Vision.",
        items: [],
        warnings: ["vision_api_error"],
        debugInfo: {
          hasGoogleVisionKey,
          visionHttpStatus: visionRes.status,
          visionErrorCode: visionRes.errorCode,
          cleanBase64Length: normalized.cleanBase64.length,
        },
      },
      { status: 502 },
    );
  }

  const rawText = visionRes.text.trim();
  diagnostic.rawTextLength = rawText.length;
  diagnostic.priceCandidatesCount = rawText ? countPriceCandidates(rawText) : 0;
  if (!rawText) {
    logOcrDiagnostic(diagnostic);
    return Response.json(
      { success: false, items: [], warnings: ["no_text_detected"], code: "no_text_detected", message: "Não encontramos texto legível nessa foto.", debugInfo: safeDiagnosticForResponse(diagnostic) },
      { status: 200 },
    );
  }

  const hintParts: string[] = [];
  if (params.marketName) hintParts.push(`Mercado informado pelo usuário: ${String(params.marketName).slice(0, 80)}.`);
  if (params.city) hintParts.push(`Cidade: ${String(params.city).slice(0, 80)}.`);
  if (params.neighborhood) hintParts.push(`Bairro: ${String(params.neighborhood).slice(0, 80)}.`);

  const r = await callGeminiStructure(params.aiKey, rawText, hintParts.join(" "));
  diagnostic.provider = "google_vision_plus_gemini";
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    console.error("[mercado-flyer-ocr] gemini", r.status, text.slice(0, 120));
    logOcrDiagnostic(diagnostic);
    const code = r.status === 429 ? "rate_limited" : r.status === 402 ? "credits" : "structuring_failed";
    return Response.json(
      { success: false, error: r.status === 429 ? "Muitas leituras seguidas. Aguarde alguns segundos e tente de novo." : "Não conseguimos estruturar os itens agora.", code, items: [], warnings: [code], debugInfo: safeDiagnosticForResponse(diagnostic) },
      { status: r.status === 429 || r.status === 402 ? r.status : 502 },
    );
  }

  const j = await r.json();
  const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  const parsed = args ? parseStructured(args, params.marketName) : { items: [], warnings: ["missing_tool_call"] };
  diagnostic.geminiItemCount = parsed.items.length;
  diagnostic.finalItemCount = parsed.items.length;
  logOcrDiagnostic(diagnostic);

  if (parsed.items.length === 0) {
    return Response.json(
      { success: false, items: [], warnings: [...parsed.warnings, "text_found_but_no_items"], code: "text_found_but_no_items", message: "Encontramos texto no panfleto, mas não conseguimos montar os produtos automaticamente.", debugInfo: safeDiagnosticForResponse(diagnostic) },
      { status: 200 },
    );
  }

  return Response.json({ success: true, items: parsed.items, warnings: parsed.warnings, debugInfo: safeDiagnosticForResponse(diagnostic) }, { status: 200 });
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
          const body = (await request.json()) as {
            imageBase64?: string;
            marketName?: string;
            city?: string;
            neighborhood?: string;
            internalOcrSmokeTest?: boolean;
          };

          const img = body?.internalOcrSmokeTest
            ? `data:image/png;base64,${SIMPLE_FLYER_TEST_IMAGE_BASE64}`
            : body?.imageBase64;
          if (!img || typeof img !== "string") {
            return Response.json({ success: false, error: "Envie uma imagem válida.", code: "invalid_image_payload" }, { status: 400 });
          }

          return runOcrPipeline({
            imageBase64: img,
            marketName: body.marketName,
            city: body.city,
            neighborhood: body.neighborhood,
            visionKey: process.env.GOOGLE_VISION_API_KEY,
            aiKey: process.env.LOVABLE_API_KEY,
          });
        } catch (err) {
          console.error("[mercado-flyer-ocr] erro", err);
          return Response.json({ success: false, error: "Erro inesperado ao ler o panfleto.", code: "unknown_error" }, { status: 500 });
        }
      },
    },
  },
});
