/**
 * WA-C8 — Rota dispatcher (DRY-RUN).
 *
 * - `/api/public/hooks/whatsapp-dispatcher` é endpoint para pg_cron.
 * - Autentica via HMAC SHA-256 sobre o corpo bruto (header `x-cron-signature`),
 *   chave: env `WHATSAPP_DISPATCHER_SECRET`.
 * - Em WA-C8, `WHATSAPP_DISPATCH_ENABLED` é tratado como `false` por padrão:
 *   apenas avalia gates, marca `skipped` quando aplicável e loga "would send"
 *   para pendentes elegíveis (sem chamar Meta, sem mudar para `sent`).
 *
 * Nenhum PII é logado.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  claimForProcessing,
  listDuePending,
  markSkipped,
  rescheduleForQuietHours,
  type NotificationRow,
} from "@/server/whatsapp-notifications.server";
import {
  canDispatch,
  type GateDecision,
} from "@/server/whatsapp-notification-gates.server";
import { revalidateContaForDispatch } from "@/server/whatsapp-contas-lembretes.server";

interface TemplateMeta {
  requires_template_window: boolean;
  meta_template_name: string | null;
  active: boolean;
}

async function loadTemplate(key: string): Promise<TemplateMeta | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("whatsapp_notification_templates")
    .select("requires_template_window, meta_template_name, active")
    .eq("key", key)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any) ?? null;
}

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

export const Route = createFileRoute("/api/public/hooks/whatsapp-dispatcher")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!verifySignature(raw, request.headers.get("x-cron-signature"))) {
          return new Response("invalid signature", { status: 401 });
        }

        const dispatchEnabled =
          (process.env.WHATSAPP_DISPATCH_ENABLED ?? "false").toLowerCase() === "true";

        const due = await listDuePending(50);
        const summary = {
          considered: due.length,
          skipped: 0,
          rescheduled_quiet_hours: 0,
          would_send: 0,
          dispatch_enabled: dispatchEnabled,
        };

        for (const n of due as NotificationRow[]) {
          // 1) Claim atômico
          const claimed = await claimForProcessing(n.id);
          if (!claimed) continue; // outro worker pegou

          // 1.5) WA-C9.1 — rechecagem da entidade vinculada.
          // Mesmo que o lembrete tenha sido enfileirado horas antes, a conta
          // pode ter sido paga/cancelada/alterada nesse meio-tempo.
          const reval = await revalidateContaForDispatch({
            user_id: claimed.user_id,
            category: claimed.category,
            entity_type: claimed.entity_type,
            entity_id: claimed.entity_id,
            payload: claimed.payload,
          });
          if (!reval.ok) {
            await markSkipped(n.id, reval.reason);
            summary.skipped++;
            console.info(
              "[wa-dispatcher] revalidated_skip",
              JSON.stringify({
                type: n.notification_type,
                category: n.category,
                reason: reval.reason,
              }),
            );
            continue;
          }

          // 2) Template
          const tpl = await loadTemplate(n.notification_type);
          if (!tpl || !tpl.active) {
            await markSkipped(n.id, "template_missing");
            summary.skipped++;
            continue;
          }

          // 3) Gates (canal + categoria + quiet hours + janela 24h/HSM)
          const decision: GateDecision = await canDispatch({
            userId: n.user_id,
            category: n.category,
            requiresTemplateWindow: tpl.requires_template_window,
            hasMetaTemplate: !!tpl.meta_template_name,
          });

          if (!decision.allow) {
            // WA-C8.1 — quiet_hours é bloqueio TEMPORÁRIO: reagenda a mesma
            // linha para o próximo horário permitido no timezone do usuário,
            // preservando dedupe_key/attempt_count.
            if (decision.reason === "quiet_hours" && decision.nextAllowedAt) {
              const ok = await rescheduleForQuietHours(
                n.id,
                decision.nextAllowedAt,
              );
              if (ok) {
                summary.rescheduled_quiet_hours++;
                console.info(
                  "[wa-dispatcher] rescheduled_quiet_hours",
                  JSON.stringify({
                    type: n.notification_type,
                    category: n.category,
                    scheduled_at: decision.nextAllowedAt.toISOString(),
                  }),
                );
              }
              continue;
            }
            await markSkipped(n.id, decision.reason);
            summary.skipped++;
            continue;
          }

          // 4) WA-C8 termina aqui: dry-run.
          summary.would_send++;
          if (!dispatchEnabled) {
            // Volta para `pending` para que WA-C9 (com envio real) possa pegar.
            const { supabaseAdmin } = await import(
              "@/integrations/supabase/client.server"
            );
            await supabaseAdmin
              .from("whatsapp_notifications")
              .update({ status: "pending" })
              .eq("id", n.id);
            console.info(
              "[wa-dispatcher] would_send",
              JSON.stringify({
                id: n.id,
                type: n.notification_type,
                category: n.category,
                priority: n.priority,
              }),
            );
            continue;
          }

          // 5) Envio real será implementado em WA-C9 (atrás da flag).
          // Por ora, qualquer caminho "habilitado" também é noop.
        }

        return Response.json(summary);
      },
    },
  },
});
