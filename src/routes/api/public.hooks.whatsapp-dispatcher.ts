/**
 * WA-C8 — Rota dispatcher (DRY-RUN).
 * WA-C9.2 Fase B — Lease/ownership token + recuperação de processing preso.
 *
 * - `/api/public/hooks/whatsapp-dispatcher` é endpoint para pg_cron.
 * - Autentica via HMAC SHA-256 sobre o corpo bruto (header `x-cron-signature`),
 *   chave: env `WHATSAPP_DISPATCHER_SECRET`.
 * - Cada tick: (1) recovery de processing preso, (2) list due, (3) claim
 *   por linha com token de ownership, (4) revalida entidade, template e gates,
 *   (5) dry-run revert (envio real desligado). Nenhum PII é logado.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  claimForProcessing,
  listDuePending,
  markSkipped,
  recoverStuckProcessing,
  recoverStuckReschedule,
  rescheduleForQuietHours,
  revertProcessingToPending,
  type NotificationRow,
} from "@/server/whatsapp-notifications.server";
import { canDispatch, type GateDecision } from "@/server/whatsapp-notification-gates.server";
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

        // 0) WA-C9.2 Fase B — recovery de processing preso ANTES da listagem.
        const recovery = await recoverStuckProcessing(50);
        console.info(
          "[wa-dispatcher] recover_stuck_processing",
          JSON.stringify({
            recovered: recovery.recovered,
            state_changed: recovery.state_changed,
            errors: recovery.errors,
          }),
        );

        const due = await listDuePending(50);
        const summary = {
          considered: due.length,
          skipped: 0,
          rescheduled_quiet_hours: 0,
          would_send: 0,
          dispatch_enabled: dispatchEnabled,
          recovered_stuck_processing: recovery.recovered,
          recovery_state_changed: recovery.state_changed,
          recovery_errors: recovery.errors,
        };

        for (const n of due as NotificationRow[]) {
          // 1) Claim atômico com ownership token (Fase B).
          const claimed = await claimForProcessing(n.id);
          if (!claimed) continue;
          const token = claimed.claim_token;
          if (!token) {
            // Defesa em profundidade: sem token não devemos tocar a linha.
            continue;
          }

          // 1.5) WA-C9.1 — rechecagem da entidade vinculada.
          const reval = await revalidateContaForDispatch({
            user_id: claimed.user_id,
            category: claimed.category,
            entity_type: claimed.entity_type,
            entity_id: claimed.entity_id,
            payload: claimed.payload,
          });
          if (!reval.ok) {
            await markSkipped(n.id, reval.reason, token);
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
            await markSkipped(n.id, "template_missing", token);
            summary.skipped++;
            continue;
          }

          // 3) Gates
          const decision: GateDecision = await canDispatch({
            userId: n.user_id,
            category: n.category,
            requiresTemplateWindow: tpl.requires_template_window,
            hasMetaTemplate: !!tpl.meta_template_name,
          });

          if (!decision.allow) {
            if (decision.reason === "quiet_hours" && decision.nextAllowedAt) {
              const res = await rescheduleForQuietHours(n.id, decision.nextAllowedAt, token);
              if (res.ok) {
                summary.rescheduled_quiet_hours++;
                console.info(
                  "[wa-dispatcher] rescheduled_quiet_hours",
                  JSON.stringify({
                    type: n.notification_type,
                    category: n.category,
                    scheduled_at: decision.nextAllowedAt.toISOString(),
                  }),
                );
                continue;
              }
              if (res.status === "state_changed") continue;
              const rec = await recoverStuckReschedule(n.id, decision.nextAllowedAt, token);
              if (rec.ok) {
                summary.rescheduled_quiet_hours++;
                console.info(
                  "[wa-dispatcher] rescheduled_quiet_hours_recovered",
                  JSON.stringify({
                    type: n.notification_type,
                    category: n.category,
                    scheduled_at: decision.nextAllowedAt.toISOString(),
                  }),
                );
              } else if (rec.status === "error") {
                console.error(
                  "[wa-dispatcher] reschedule_quiet_hours_stuck",
                  JSON.stringify({
                    id: n.id,
                    type: n.notification_type,
                    category: n.category,
                  }),
                );
              }
              continue;
            }
            await markSkipped(n.id, decision.reason, token);
            summary.skipped++;
            continue;
          }

          // 4) Dry-run: revert processing → pending mantendo dedupe/attempt.
          summary.would_send++;
          if (!dispatchEnabled) {
            await revertProcessingToPending(n.id, token);
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

          // 5) WA-C9.2 Fase D.2B.2 — Envio real ATRÁS da dupla trava.
          //    Enquanto WHATSAPP_OUTBOUND_HTTP_ENABLED/WHATSAPP_CANARY_ENABLED
          //    permanecerem OFF, `runOutboundForNotification` retorna `gated`
          //    e a linha volta para `pending`.
          const { runOutboundForNotification } = await import(
            "@/server/whatsapp-dispatcher-outbound.server"
          );
          const outcome = await runOutboundForNotification(
            { id: n.id, user_id: n.user_id, notification_type: n.notification_type, payload: n.payload },
            token,
          );
          switch (outcome.kind) {
            case "gated":
            case "no_recipient":
            case "no_template":
            case "transport_unavailable": {
              await revertProcessingToPending(n.id, token);
              console.info(
                "[wa-dispatcher] outbound_deferred",
                JSON.stringify({
                  id: n.id,
                  type: n.notification_type,
                  category: n.category,
                  kind: outcome.kind,
                }),
              );
              break;
            }
            case "executed": {
              // A finalização autoritativa é da RPC atômica (D.2A). Não
              // mexemos em notification.status aqui: a máquina de estados
              // é responsabilidade das RPCs finalize_* / reconcile_callback.
              console.info(
                "[wa-dispatcher] outbound_executed",
                JSON.stringify({
                  id: n.id,
                  type: n.notification_type,
                  category: n.category,
                  result_kind: outcome.result.kind,
                }),
              );
              break;
            }
          }
        }

        return Response.json(summary);
      },
    },
  },
});
