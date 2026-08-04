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

/**
 * WA-C9.2 Fase D.2B.2 (hardening) — parser estrito de flag boolean.
 * Aceita EXCLUSIVAMENTE a string "true" (case-insensitive, sem espaços).
 * Rejeita "1", "yes", "on", "enabled", vazio, undefined.
 */
function parseStrictBool(v: string | undefined): boolean {
  if (typeof v !== "string") return false;
  return v.trim().toLowerCase() === "true";
}

export const Route = createFileRoute("/api/public/hooks/whatsapp-dispatcher")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!verifySignature(raw, request.headers.get("x-cron-signature"))) {
          return new Response("invalid signature", { status: 401 });
        }

        // ─── WA-C9.2 Fase D.2B.2 HARDENING ──────────────────────────────────
        // Early exit imediatamente após HMAC. Enquanto o envio operacional
        // estiver desligado, o handler NÃO deve tocar o banco: nada de
        // recovery, listagem, claim, revalidate, template, gates, revert,
        // reschedule, skip, factory, prepare, mark sending ou transport.
        const dispatchEnabled = parseStrictBool(process.env.WHATSAPP_DISPATCH_ENABLED);
        const outboundHttpEnabled = parseStrictBool(process.env.WHATSAPP_OUTBOUND_HTTP_ENABLED);

        if (!dispatchEnabled || !outboundHttpEnabled) {
          const disabledSummary = {
            considered: 0,
            skipped: 0,
            rescheduled_quiet_hours: 0,
            would_send: 0,
            dispatch_enabled: dispatchEnabled,
            outbound_http_enabled: outboundHttpEnabled,
            disabled: true,
            reason: !dispatchEnabled ? "dispatcher_disabled" : "outbound_http_disabled",
            recovered_stuck_processing: 0,
            recovery_state_changed: 0,
            recovery_errors: 0,
            attempts_prepared: 0,
            attempts_prepare_failed: 0,
            attempts_marked_sending: 0,
            attempts_mark_sending_failed: 0,
            transport_accepted: 0,
            transport_rejected: 0,
            transport_ambiguous: 0,
            finalize_accepted: 0,
            finalize_rejected: 0,
            finalize_ambiguous: 0,
            finalize_errors: 0,
            outbound_gate_blocked: 0,
            outbound_factory_errors: 0,
            ownership_changed: 0,
            state_changed: 0,
          };
          console.info(
            "[wa-dispatcher] disabled_early_exit",
            JSON.stringify({
              dispatch_enabled: dispatchEnabled,
              outbound_http_enabled: outboundHttpEnabled,
              reason: disabledSummary.reason,
            }),
          );
          return Response.json(disabledSummary);
        }

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
          outbound_http_enabled: outboundHttpEnabled,
          disabled: false,
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

          // 1.6) WA-C11 Fase 1 — revalidação de entitlement no momento do
          // envio. Bloqueia downgrade / cancelamento / expiração / beta
          // revogado / link revogado ocorridos entre a criação e o dispatch.
          try {
            const { getWhatsAppEntitlement } = await import("@/server/whatsapp-entitlement.server");
            const ent = await getWhatsAppEntitlement(claimed.user_id);
            if (!ent.allowed) {
              await markSkipped(n.id, "entitlement_revoked", token);
              summary.skipped++;
              console.info(
                "[wa-dispatcher] entitlement_revoked_skip",
                JSON.stringify({
                  type: n.notification_type,
                  category: n.category,
                  reason: ent.reason,
                }),
              );
              continue;
            }
          } catch {
            // fail-closed: qualquer falha no gate cancela o envio.
            await markSkipped(n.id, "entitlement_revoked", token);
            summary.skipped++;
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

          // 4) WA-C9.2 Fase D.2B.2 (hardening) — chegar aqui já implica
          //    `WHATSAPP_DISPATCH_ENABLED=true` e `WHATSAPP_OUTBOUND_HTTP_ENABLED=true`
          //    (early exit no topo). Não há mais branch dry-run mutável.
          summary.would_send++;

          // 5) WA-C11 Fase 3B.2.D — Envio real com wiring de quota outbound.
          //    Reserva atômica ANTES do transport; commit em accepted;
          //    release em rejeição definitiva / falha local pré-HTTP;
          //    reservation permanece `reserved` em ambiguous (nunca libera).
          //    A dupla-trava (env + runtime) já foi validada no topo do
          //    handler; `runOutboundWithQuota` revalida internamente e o
          //    gate `isOutboundHttpAllowed` reavalia imediatamente antes
          //    do transport.
          const { runOutboundWithQuota } =
            await import("@/server/whatsapp-outbound-quota-wire.server");
          const outcome = await runOutboundWithQuota(
            {
              id: n.id,
              user_id: n.user_id,
              notification_type: n.notification_type,
              payload: n.payload,
            },
            token,
          );
          switch (outcome.kind) {
            case "plan_load_failed":
            case "cycle_invalid":
            case "quota_denied":
            case "reserved_then_gated":
            case "reserved_then_local_error":
            case "state_changed": {
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
            case "committed":
            case "released_after_reject":
            case "left_ambiguous": {
              // Finalização autoritativa é das RPCs atômicas do adapter
              // (D.2A) + reconciliação por callback (fase B.2.e). Não
              // mexemos em notification.status aqui.
              console.info(
                "[wa-dispatcher] outbound_finalized",
                JSON.stringify({
                  id: n.id,
                  type: n.notification_type,
                  category: n.category,
                  kind: outcome.kind,
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
