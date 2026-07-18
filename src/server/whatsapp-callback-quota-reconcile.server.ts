/**
 * WA-C11 FASE 3B.2.E — Reconciliação de quota outbound a partir de callbacks Meta.
 *
 * SERVER-ONLY. Ponto único que traduz callback de status Meta em
 * transição segura da reservation:
 *
 *   sent com PMID → commit idempotente (reserved|ambiguous → committed).
 *   delivered/read → aceite comprovado; força commit idempotente se ainda
 *                    não estiver committed.
 *   failed pós-aceite (com PMID) → mantém committed (Meta já cobrou).
 *   failed sem PMID → NÃO libera aqui: release é responsabilidade
 *                     do dispatcher pré-callback (via runOutboundWithQuota).
 *
 * Regras invioláveis:
 *   - NUNCA cria nova reservation.
 *   - NUNCA consome quota duas vezes.
 *   - NUNCA libera reservation por callback failed pós-aceite.
 *   - NUNCA regride status.
 *   - Fail-closed: erro → outcome "error", zero DML.
 *   - Correlação por notification_id + provider_message_id validado.
 *   - Sem PMID → não reconcilia (retorna "no_correlation").
 *   - Ownership: user_id casado com a reservation (RPC valida).
 *   - Logs sanitizados: hash de PMID, notification prefixo, outcome.
 */
import {
  commitOutboundQuota,
  reconcileReservationFromCallback,
  type QuotaFinalizeResult,
} from "@/server/whatsapp-quota.server";

export type MetaStatus = "sent" | "delivered" | "read" | "failed" | string;

export interface ReconcileInput {
  userId: string;
  notificationId: string;
  providerMessageId: string | null | undefined;
  status: MetaStatus;
  now?: Date;
}

export type ReconcileOutcome =
  | { kind: "no_correlation"; reason: string }
  | { kind: "reconciled"; state: string; outcome: string }
  | { kind: "already_committed" }
  | { kind: "failed_post_accept_preserved" }
  | { kind: "not_applicable"; reason: string }
  | { kind: "error"; reason: string };

export interface ReconcileDeps {
  reconcile?: typeof reconcileReservationFromCallback;
  commit?: typeof commitOutboundQuota;
}

function safeLog(event: string, extra: Record<string, unknown>): void {
  try {
    console.info("[wa-callback-reconcile]", JSON.stringify({ event, ...extra }));
  } catch {
    // no-op
  }
}

function safePmidHash(pmid: string): string {
  // Não é hash criptográfico; só evita vazar PMID cru em logs.
  let h = 0;
  for (let i = 0; i < pmid.length; i++) h = (h * 31 + pmid.charCodeAt(i)) | 0;
  return `p${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Reconcilia a reserva outbound com base em um evento de status Meta.
 *
 * @param input status callback já validado (assinatura + payload).
 */
export async function reconcileOutboundQuotaFromMetaStatus(
  input: ReconcileInput,
  deps: ReconcileDeps = {},
): Promise<ReconcileOutcome> {
  const reconcile = deps.reconcile ?? reconcileReservationFromCallback;

  // 1) Validação mínima: precisamos de notification_id e user_id.
  if (!input.userId || !input.notificationId) {
    return { kind: "no_correlation", reason: "missing_ids" };
  }

  const pmid = typeof input.providerMessageId === "string" ? input.providerMessageId.trim() : "";
  const status = String(input.status ?? "").toLowerCase();

  // 2) Sem PMID: nenhuma reconciliação. Sem PMID não há evidência
  //    Meta-side de aceite; correlação seria por proxy inseguro.
  if (!pmid) {
    safeLog("no_correlation", {
      n: input.notificationId.slice(0, 8),
      status,
      reason: "missing_pmid",
    });
    return { kind: "no_correlation", reason: "missing_pmid" };
  }

  // 3) Roteamento por status.
  switch (status) {
    case "sent":
    case "delivered":
    case "read": {
      // Aceite comprovado. Promove reservation para committed (idempotente).
      const r: QuotaFinalizeResult = await reconcile({
        userId: input.userId,
        notificationId: input.notificationId,
        providerMessageId: pmid,
        now: input.now,
      });
      if (r.outcome === "reconciled") {
        safeLog("reconciled", {
          n: input.notificationId.slice(0, 8),
          status,
          pmid: safePmidHash(pmid),
        });
        return { kind: "reconciled", state: r.state ?? "committed", outcome: r.outcome };
      }
      if (r.outcome === "noop" && r.state === "committed") {
        return { kind: "already_committed" };
      }
      if (r.outcome === "not_found") {
        return { kind: "not_applicable", reason: "reservation_missing" };
      }
      if (r.outcome === "conflict_pmid") {
        safeLog("conflict_pmid", {
          n: input.notificationId.slice(0, 8),
          pmid: safePmidHash(pmid),
        });
        return { kind: "error", reason: "conflict_pmid" };
      }
      if (r.outcome === "invalid_state") {
        // Ex: já released antes do PMID chegar — vestígio de callback tardio.
        return { kind: "not_applicable", reason: `state:${r.state ?? "unknown"}` };
      }
      return { kind: "error", reason: r.outcome || "unknown" };
    }
    case "failed": {
      // Failed pós-aceite: já existe PMID → Meta cobrou pela tentativa.
      // NÃO liberamos. Se a reservation ainda estiver reserved/ambiguous,
      // promovemos para committed (aceite comprovado) — a falha pós-aceite
      // não devolve quota. Se não houver reservation, não fazemos nada.
      const r: QuotaFinalizeResult = await reconcile({
        userId: input.userId,
        notificationId: input.notificationId,
        providerMessageId: pmid,
        now: input.now,
      });
      if (r.outcome === "reconciled" || (r.outcome === "noop" && r.state === "committed")) {
        safeLog("failed_post_accept_preserved", {
          n: input.notificationId.slice(0, 8),
          pmid: safePmidHash(pmid),
          rpc_outcome: r.outcome,
        });
        return { kind: "failed_post_accept_preserved" };
      }
      if (r.outcome === "not_found") {
        return { kind: "not_applicable", reason: "reservation_missing" };
      }
      return { kind: "not_applicable", reason: r.outcome || "unknown" };
    }
    default: {
      // Status desconhecido: nada a fazer.
      return { kind: "not_applicable", reason: `unknown_status:${status}` };
    }
  }
}
