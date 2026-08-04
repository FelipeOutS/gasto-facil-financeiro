/**
 * WA-C9 — Rota de geração de lembretes de contas a pagar (DRY-RUN).
 *
 * POST /api/public/hooks/whatsapp-contas-lembretes-generate
 *
 * - Autenticação: HMAC SHA-256 do corpo bruto via header `x-cron-signature`,
 *   chave `WHATSAPP_DISPATCHER_SECRET` (mesma da WA-C8).
 * - Não envia nada à Meta. Apenas itera usuários com `whatsapp_links.ativo`
 *   e enfileira lembretes idempotentes em `whatsapp_notifications`.
 *
 * Cron sugerido (NÃO cadastrar ainda — depende de validação humana):
 *   SELECT cron.schedule(
 *     'whatsapp-contas-lembretes-generate',
 *     '0 11 * * *', -- 11:00 UTC = 08:00 America/Sao_Paulo
 *     $$
 *       SELECT net.http_post(
 *         url := 'https://project--5de62d63-2340-4175-8a16-26c2beff1e71.lovable.app/api/public/hooks/whatsapp-contas-lembretes-generate',
 *         headers := jsonb_build_object(
 *           'Content-Type','application/json',
 *           'x-cron-signature', encode(hmac('{}'::bytea, current_setting('app.wa_dispatcher_secret'), 'sha256'), 'hex')
 *         ),
 *         body := '{}'::jsonb
 *       );
 *     $$
 *   );
 *
 * Logs sem PII: apenas contadores e contagem de usuários considerados.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { gerarLembretesContasUsuario } from "@/server/whatsapp-contas-lembretes.server";

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.WHATSAPP_DISPATCHER_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/hooks/whatsapp-contas-lembretes-generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!verifySignature(raw, request.headers.get("x-cron-signature"))) {
          return new Response("invalid signature", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Usuários com canal WhatsApp ativo. Sem PII no log; só contagem.
        const { data: links } = await supabaseAdmin
          .from("whatsapp_links")
          .select("user_id")
          .eq("ativo", true);

        const userIds = Array.from(
          new Set(
            ((links as { user_id: string }[] | null) ?? []).map((l) => l.user_id).filter(Boolean),
          ),
        );

        const summary = {
          users_considered: userIds.length,
          enqueued_or_existing: 0,
        };

        for (const uid of userIds) {
          try {
            const r = await gerarLembretesContasUsuario(uid);
            summary.enqueued_or_existing += r.length;
          } catch (err) {
            // Falha em um usuário não derruba os outros; sem PII no log.
            console.error("[wa-c9] gerar falhou", (err as Error)?.name ?? "err");
          }
        }

        return Response.json(summary);
      },
    },
  },
});
