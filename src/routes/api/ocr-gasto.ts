import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  ensurePremiumFeatureAccess,
} from "@/server/api-auth";
import { enforceUserRateLimit } from "@/server/rate-limit.server";
import { runExtractor } from "@/server/ocr-comprovante.server";

/**
 * OCR de comprovante via Lovable AI Gateway (Gemini Vision).
 * A leitura em si vive em `@/server/ocr-comprovante.server` e é
 * reaproveitada também pelo WhatsApp (Fase WA-G5A), garantindo um
 * único serviço/contrato/sanitização para todo o produto.
 *
 * Recebe { imageBase64: "data:image/...;base64,..." } e retorna JSON com:
 *   { valor, valoresEncontrados[], data, descricao, categoriaSugerida,
 *     formaPagamento, confianca, observacao }
 *
 * Nunca salva nada — apenas sugere. O usuário revisa antes de salvar.
 */

export const Route = createFileRoute("/api/ocr-gasto")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __user = await getUserFromRequest(request);
        if (!__user) return unauthorizedResponse();
        const __gate = await ensurePremiumFeatureAccess(__user, "importacoes");
        if (__gate) return __gate;
        const __rl = await enforceUserRateLimit({
          scope: "import",
          userId: __user.id,
          route: "ocr-gasto",
          request,
        });
        if (__rl) return __rl;
        try {
          const body = (await request.json()) as { imageBase64?: string };
          const out = await runExtractor(body?.imageBase64 ?? "");
          if (!out.ok) {
            return Response.json({ error: out.error.error }, { status: out.error.status });
          }
          return Response.json(out.data);
        } catch (err) {
          console.error("[ocr-gasto] erro", err);
          return Response.json(
            { error: "Ocorreu um erro interno. Tente novamente." },
            { status: 500 },
          );
        }
      },
    },
  },
});
