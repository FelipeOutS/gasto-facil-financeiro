/**
 * WA-C9.2 Fase B hardening — Ownership estrito de `claim_token`.
 *
 * Bloqueia bypass do ownership:
 *  - markSent / revertProcessingToPending / renewProcessingLease:
 *    claimToken é `string` obrigatório; validação de string vazia/whitespace.
 *  - rescheduleForQuietHours / recoverStuckReschedule: idem (worker-only).
 *  - markFailed / markSkipped com claimToken=null: caminho ADMIN restrito a
 *    `status='pending'`; NUNCA toca processing/terminal.
 *  - Worker antigo pós-recovery / pós-cancelamento externo: não conclui.
 *
 * Sem envio real, sem escrita financeira, sem cron, sem migration adicional.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  enqueueNotification,
  claimForProcessing,
  markSent,
  markFailed,
  markSkipped,
  rescheduleForQuietHours,
  recoverStuckReschedule,
  revertProcessingToPending,
  renewProcessingLease,
  recoverStuckProcessing,
  cancelByEntity,
  type NotificationRow,
} from "../src/server/whatsapp-notifications.server";

// ----------------------- Fake supabase (mínimo) -----------------------
type Row = Record<string, unknown>;

function buildFake() {
  const tables: Record<string, Row[]> = { whatsapp_notifications: [] };

  function makeQuery(table: string) {
    let rows: Row[] = tables[table] ?? [];
    const filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "update" | "insert" | "upsert" = "select";
    let updatePatch: Row | null = null;
    let insertRows: Row[] | null = null;
    let orConflict: string | null = null;
    let ignoreDup = false;
    const chain = {
      select() {
        return chain;
      },
      insert(r: Row | Row[]) {
        mode = "insert";
        insertRows = Array.isArray(r) ? r : [r];
        return chain;
      },
      upsert(r: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        mode = "upsert";
        insertRows = Array.isArray(r) ? r : [r];
        orConflict = opts?.onConflict ?? null;
        ignoreDup = Boolean(opts?.ignoreDuplicates);
        return chain;
      },
      update(patch: Row) {
        mode = "update";
        updatePatch = patch;
        return chain;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return chain;
      },
      in(col: string, list: unknown[]) {
        filters.push((r) => list.includes(r[col] as unknown));
        return chain;
      },
      lte(col: string, val: unknown) {
        filters.push((r) => r[col] != null && String(r[col]) <= String(val));
        return chain;
      },
      or(_expr: string) {
        // aceita "col.is.null,col.lte.X" — usado somente em listDue/claim;
        // não afeta os testes deste arquivo.
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      is(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return chain;
      },
      async maybeSingle() {
        if (mode === "update") {
          return await runUpdate("maybeSingle");
        }
        const found = rows.filter((r) => filters.every((f) => f(r)));
        return { data: found[0] ?? null, error: null };
      },
      then(res: (v: { data: Row[] | null; error: null }) => void, rej: unknown) {
        return runFinal().then(res, rej as unknown as (r: unknown) => void);
      },
    };
    async function runFinal(): Promise<{ data: Row[] | null; error: null }> {
      if (mode === "insert" && insertRows) {
        rows.push(...insertRows);
        return { data: insertRows, error: null };
      }
      if (mode === "upsert" && insertRows) {
        for (const r of insertRows) {
          const conflictKeys = (orConflict ?? "").split(",").map((k) => k.trim());
          const dup = conflictKeys.length
            ? rows.find((existing) => conflictKeys.every((k) => existing[k] === r[k]))
            : null;
          if (dup && ignoreDup) continue;
          rows.push(r);
        }
        return { data: insertRows, error: null };
      }
      if (mode === "update") {
        return runUpdate("list");
      }
      const found = rows.filter((r) => filters.every((f) => f(r)));
      return { data: found, error: null };
    }
    async function runUpdate(shape: "list" | "maybeSingle") {
      const match = rows.filter((r) => filters.every((f) => f(r)));
      for (const r of match) Object.assign(r, updatePatch ?? {});
      if (shape === "maybeSingle") return { data: match[0] ?? null, error: null };
      return { data: match, error: null };
    }
    return chain;
  }

  const client = {
    from(table: string) {
      return makeQuery(table);
    },
  } as unknown as import("@/integrations/supabase/client.server").supabaseAdmin extends infer T
    ? T
    : never;

  return { tables, client } as { tables: typeof tables; client: typeof client };
}

const baseEnqueue = {
  userId: "u1",
  type: "conta_lembrete",
  category: "contas_a_pagar" as const,
  scheduledAt: new Date("2026-07-10T12:00:00Z"),
  dedupeKey: "ded-1",
};

let fake: ReturnType<typeof buildFake>;
beforeEach(() => {
  fake = buildFake();
});

function seedProcessing(overrides: Partial<NotificationRow> = {}): NotificationRow {
  const now = new Date().toISOString();
  const row: NotificationRow = {
    id: "n-1",
    user_id: "u1",
    notification_type: "conta_lembrete",
    category: "contas_a_pagar",
    status: "processing",
    priority: "media",
    scheduled_at: now,
    attempt_count: 0,
    max_attempts: 5,
    next_attempt_at: null,
    payload: {},
    payload_version: 1,
    dedupe_key: "ded-1",
    entity_type: null,
    entity_id: null,
    sent_at: null,
    failed_at: null,
    cancelled_at: null,
    skipped_reason: null,
    provider_message_id: null,
    last_error_code: null,
    claimed_at: now,
    lease_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    claim_token: "TOK-A",
    ...overrides,
  };
  fake.tables.whatsapp_notifications.push(row as unknown as Row);
  return row;
}

// =====================================================================
// markSent — token obrigatório, validação estrita
// =====================================================================
describe("WA-C9.2 ownership :: markSent", () => {
  it("1. token correto atualiza processing → sent", async () => {
    const r = seedProcessing();
    const ok = await markSent(r.id, "wamid.1", "TOK-A", { client: fake.client });
    expect(ok).toBe(true);
    const after = fake.tables.whatsapp_notifications[0] as NotificationRow;
    expect(after.status).toBe("sent");
    expect(after.claim_token).toBeNull();
    expect(after.claimed_at).toBeNull();
    expect(after.lease_expires_at).toBeNull();
  });

  it("2. token errado não altera", async () => {
    const r = seedProcessing();
    const ok = await markSent(r.id, "wamid.x", "WRONG", { client: fake.client });
    expect(ok).toBe(false);
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("processing");
  });

  it("3. string vazia é rejeitada sem UPDATE", async () => {
    const r = seedProcessing();
    const ok = await markSent(r.id, "wamid", "", { client: fake.client });
    expect(ok).toBe(false);
    const after = fake.tables.whatsapp_notifications[0] as NotificationRow;
    expect(after.status).toBe("processing");
    expect(after.sent_at ?? null).toBeNull();
  });

  it("4. whitespace-only é rejeitado", async () => {
    const r = seedProcessing();
    const ok = await markSent(r.id, "wamid", "   ", { client: fake.client });
    expect(ok).toBe(false);
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("processing");
  });
});

// =====================================================================
// markFailed — worker vs admin
// =====================================================================
describe("WA-C9.2 ownership :: markFailed", () => {
  it("5. worker token correto: processing → pending com retry", async () => {
    const r = seedProcessing();
    const res = await markFailed(
      r.id,
      "net",
      { retryable: true, currentAttempt: 0, maxAttempts: 5 },
      "TOK-A",
      { client: fake.client },
    );
    expect(res.updated).toBe(true);
    expect(res.scheduledRetry).toBe(true);
    const after = fake.tables.whatsapp_notifications[0] as NotificationRow;
    expect(after.status).toBe("pending");
    expect(after.claim_token).toBeNull();
    expect(after.next_attempt_at).not.toBeNull();
  });

  it("6. worker token errado não altera", async () => {
    const r = seedProcessing();
    const res = await markFailed(
      r.id,
      "net",
      { retryable: true, currentAttempt: 0, maxAttempts: 5 },
      "WRONG",
      { client: fake.client },
    );
    expect(res.updated).toBe(false);
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("processing");
  });

  it("7. worker token vazio é rejeitado (sem UPDATE)", async () => {
    const r = seedProcessing();
    const res = await markFailed(
      r.id,
      "net",
      { retryable: true, currentAttempt: 0, maxAttempts: 5 },
      "",
      { client: fake.client },
    );
    expect(res.updated).toBe(false);
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("processing");
  });

  it("8. ADMIN (null): NÃO altera processing", async () => {
    const r = seedProcessing();
    const res = await markFailed(
      r.id,
      "admin",
      { retryable: true, currentAttempt: 0, maxAttempts: 5 },
      null,
      { client: fake.client },
    );
    expect(res.updated).toBe(false);
    const after = fake.tables.whatsapp_notifications[0] as NotificationRow;
    expect(after.status).toBe("processing");
    expect(after.claim_token).toBe("TOK-A"); // lease preservado
  });

  it("9. ADMIN (null): opera sobre pending", async () => {
    seedProcessing({
      status: "pending",
      claim_token: null,
      claimed_at: null,
      lease_expires_at: null,
    });
    const res = await markFailed(
      "n-1",
      "admin",
      { retryable: true, currentAttempt: 0, maxAttempts: 5 },
      null,
      { client: fake.client },
    );
    expect(res.updated).toBe(true);
    // retryable → volta a pending com backoff.
    const after = fake.tables.whatsapp_notifications[0] as NotificationRow;
    expect(after.status).toBe("pending");
  });

  it("10. ADMIN (null): não reabre terminal (sent)", async () => {
    seedProcessing({
      status: "sent",
      claim_token: null,
      claimed_at: null,
      lease_expires_at: null,
    });
    const res = await markFailed(
      "n-1",
      "admin",
      { retryable: false, currentAttempt: 4, maxAttempts: 5 },
      null,
      { client: fake.client },
    );
    expect(res.updated).toBe(false);
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("sent");
  });
});

// =====================================================================
// markSkipped — worker vs admin
// =====================================================================
describe("WA-C9.2 ownership :: markSkipped", () => {
  it("11. worker token correto: processing → skipped", async () => {
    const r = seedProcessing();
    const ok = await markSkipped(r.id, "template_missing", "TOK-A", { client: fake.client });
    expect(ok).toBe(true);
    const after = fake.tables.whatsapp_notifications[0] as NotificationRow;
    expect(after.status).toBe("skipped");
    expect(after.claim_token).toBeNull();
  });

  it("12. worker token errado não altera", async () => {
    const r = seedProcessing();
    const ok = await markSkipped(r.id, "template_missing", "WRONG", { client: fake.client });
    expect(ok).toBe(false);
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("processing");
  });

  it("13. worker token vazio é rejeitado", async () => {
    const r = seedProcessing();
    const ok = await markSkipped(r.id, "template_missing", "", { client: fake.client });
    expect(ok).toBe(false);
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("processing");
  });

  it("14. ADMIN (null): NÃO altera processing", async () => {
    const r = seedProcessing();
    const ok = await markSkipped(r.id, "user_disabled", null, { client: fake.client });
    expect(ok).toBe(false);
    const after = fake.tables.whatsapp_notifications[0] as NotificationRow;
    expect(after.status).toBe("processing");
    expect(after.claim_token).toBe("TOK-A");
  });

  it("15. ADMIN (null): não reabre terminal (sent/failed/cancelled/skipped)", async () => {
    for (const term of ["sent", "failed", "cancelled", "skipped"] as const) {
      fake = buildFake();
      seedProcessing({
        status: term,
        claim_token: null,
        claimed_at: null,
        lease_expires_at: null,
      });
      const ok = await markSkipped("n-1", "user_disabled", null, { client: fake.client });
      expect(ok).toBe(false);
      expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe(term);
    }
  });

  it("16. ADMIN (null): opera sobre pending", async () => {
    seedProcessing({
      status: "pending",
      claim_token: null,
      claimed_at: null,
      lease_expires_at: null,
    });
    const ok = await markSkipped("n-1", "user_disabled", null, { client: fake.client });
    expect(ok).toBe(true);
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("skipped");
  });
});

// =====================================================================
// reschedule / recover — worker-only
// =====================================================================
describe("WA-C9.2 ownership :: rescheduleForQuietHours", () => {
  const nextAt = new Date("2026-07-10T13:00:00Z");

  it("17. token correto reagenda", async () => {
    const r = seedProcessing();
    const res = await rescheduleForQuietHours(r.id, nextAt, "TOK-A", { client: fake.client });
    expect(res.ok).toBe(true);
    const after = fake.tables.whatsapp_notifications[0] as NotificationRow;
    expect(after.status).toBe("pending");
    expect(after.claim_token).toBeNull();
  });

  it("18. token errado retorna state_changed sem alterar", async () => {
    const r = seedProcessing();
    const res = await rescheduleForQuietHours(r.id, nextAt, "WRONG", { client: fake.client });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe("state_changed");
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("processing");
  });

  it("19. token vazio é rejeitado", async () => {
    const r = seedProcessing();
    const res = await rescheduleForQuietHours(r.id, nextAt, "", { client: fake.client });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe("state_changed");
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("processing");
  });

  it("20. recoverStuckReschedule idem — token vazio rejeitado", async () => {
    const r = seedProcessing();
    const res = await recoverStuckReschedule(r.id, nextAt, "", { client: fake.client });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe("state_changed");
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("processing");
  });
});

// =====================================================================
// revert / renew — worker-only
// =====================================================================
describe("WA-C9.2 ownership :: revert / renew", () => {
  it("21. revertProcessingToPending token vazio rejeitado", async () => {
    seedProcessing();
    const ok = await revertProcessingToPending("n-1", "", { client: fake.client });
    expect(ok).toBe(false);
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("processing");
  });

  it("22. revertProcessingToPending token errado não altera", async () => {
    seedProcessing();
    const ok = await revertProcessingToPending("n-1", "WRONG", { client: fake.client });
    expect(ok).toBe(false);
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).status).toBe("processing");
  });

  it("23. renewProcessingLease token vazio rejeitado", async () => {
    seedProcessing();
    const lease0 = (fake.tables.whatsapp_notifications[0] as NotificationRow).lease_expires_at;
    const ok = await renewProcessingLease("n-1", "", { client: fake.client });
    expect(ok).toBe(false);
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).lease_expires_at).toBe(
      lease0,
    );
  });

  it("24. renewProcessingLease token errado não estende", async () => {
    seedProcessing();
    const lease0 = (fake.tables.whatsapp_notifications[0] as NotificationRow).lease_expires_at;
    const ok = await renewProcessingLease("n-1", "WRONG", { client: fake.client });
    expect(ok).toBe(false);
    expect((fake.tables.whatsapp_notifications[0] as NotificationRow).lease_expires_at).toBe(
      lease0,
    );
  });
});

// =====================================================================
// Worker antigo pós-recovery — não conclui
// =====================================================================
describe("WA-C9.2 ownership :: worker antigo pós-recovery", () => {
  it("25-28. pós-recovery: token antigo não sent/failed/skipped/reschedule", async () => {
    // seed com lease expirado
    const past = new Date(Date.now() - 60_000).toISOString();
    seedProcessing({ lease_expires_at: past, claim_token: "OLD" });
    // recovery: OLD → pending, claim_token null
    const rec = await recoverStuckProcessing(50, { client: fake.client });
    expect(rec.recovered).toBe(1);
    const row = fake.tables.whatsapp_notifications[0] as NotificationRow;
    expect(row.status).toBe("pending");
    expect(row.claim_token).toBeNull();

    // worker antigo continua tentando com OLD
    const sent = await markSent("n-1", "wamid", "OLD", { client: fake.client });
    expect(sent).toBe(false);
    const failed = await markFailed(
      "n-1",
      "x",
      { retryable: true, currentAttempt: 0, maxAttempts: 5 },
      "OLD",
      { client: fake.client },
    );
    expect(failed.updated).toBe(false);
    const skipped = await markSkipped("n-1", "template_missing", "OLD", { client: fake.client });
    expect(skipped).toBe(false);
    const resched = await rescheduleForQuietHours(
      "n-1",
      new Date("2026-07-10T14:00:00Z"),
      "OLD",
      { client: fake.client },
    );
    expect(resched.ok).toBe(false);

    const after = fake.tables.whatsapp_notifications[0] as NotificationRow;
    expect(after.status).toBe("pending"); // nada mudou pós-recovery
  });
});

// =====================================================================
// Cancelamento externo — pode agir sem token, mas só sobre pending
// =====================================================================
describe("WA-C9.2 ownership :: cancelamento externo", () => {
  it("29. cancelByEntity cancela pending sem token do worker", async () => {
    seedProcessing({
      status: "pending",
      entity_type: "conta_a_pagar",
      entity_id: "c-1",
      claim_token: null,
      claimed_at: null,
      lease_expires_at: null,
    });
    const n = await cancelByEntity("u1", "conta_a_pagar", "c-1", { client: fake.client });
    expect(n).toBe(1);
    const after = fake.tables.whatsapp_notifications[0] as NotificationRow;
    expect(after.status).toBe("cancelled");
    expect(after.claim_token).toBeNull();
  });

  it("30. cancelByEntity NÃO toca processing (segurança)", async () => {
    seedProcessing({ entity_type: "conta_a_pagar", entity_id: "c-1" });
    const n = await cancelByEntity("u1", "conta_a_pagar", "c-1", { client: fake.client });
    expect(n).toBe(0);
    const after = fake.tables.whatsapp_notifications[0] as NotificationRow;
    expect(after.status).toBe("processing");
    expect(after.claim_token).toBe("TOK-A");
  });
});

// =====================================================================
// Novo claim gera token diferente; token anterior invalidado
// =====================================================================
describe("WA-C9.2 ownership :: novo claim após recovery", () => {
  it("31. re-claim usa novo token; token anterior não altera nada", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    seedProcessing({ lease_expires_at: past, claim_token: "TOK-OLD" });
    // Recovery devolve a pending.
    await recoverStuckProcessing(50, { client: fake.client });
    // Novo claim via injeção determinística.
    // Precisa reelegibilizar: força status=pending, scheduled_at<=now, next_attempt_at<=now.
    const row = fake.tables.whatsapp_notifications[0] as Record<string, unknown>;
    row.next_attempt_at = new Date(Date.now() - 1000).toISOString();
    row.scheduled_at = new Date(Date.now() - 1000).toISOString();
    const claimed = await claimForProcessing("n-1", {
      client: fake.client,
      randomUUID: () => "TOK-NEW",
    });
    expect(claimed).not.toBeNull();
    expect(claimed!.claim_token).toBe("TOK-NEW");
    // Token antigo não altera.
    const oldTry = await markSent("n-1", "wamid", "TOK-OLD", { client: fake.client });
    expect(oldTry).toBe(false);
    // Token novo funciona.
    const newTry = await markSent("n-1", "wamid", "TOK-NEW", { client: fake.client });
    expect(newTry).toBe(true);
  });
});

// =====================================================================
// Invariantes de zero-efeito
// =====================================================================
describe("WA-C9.2 ownership :: invariantes globais", () => {
  it("32. nenhuma nova linha criada em nenhum branch de rejeição", async () => {
    seedProcessing();
    await enqueueNotification(baseEnqueue, { client: fake.client }); // pode duplicar? não — upsert
    const initial = fake.tables.whatsapp_notifications.length;
    await markSent("n-1", "w", "WRONG", { client: fake.client });
    await markSent("n-1", "w", "", { client: fake.client });
    await markFailed("n-1", "x", { retryable: true, currentAttempt: 0, maxAttempts: 5 }, "", {
      client: fake.client,
    });
    await markSkipped("n-1", "template_missing", "WRONG", { client: fake.client });
    await rescheduleForQuietHours("n-1", new Date(), "", { client: fake.client });
    await revertProcessingToPending("n-1", "", { client: fake.client });
    await renewProcessingLease("n-1", "", { client: fake.client });
    expect(fake.tables.whatsapp_notifications.length).toBe(initial);
  });

  it("33. nenhum estado terminal reaberto por qualquer combinação de token null/inválido", async () => {
    for (const term of ["sent", "failed", "cancelled", "skipped"] as const) {
      fake = buildFake();
      seedProcessing({
        status: term,
        claim_token: null,
        claimed_at: null,
        lease_expires_at: null,
      });
      await markFailed(
        "n-1",
        "x",
        { retryable: true, currentAttempt: 0, maxAttempts: 5 },
        null,
        { client: fake.client },
      );
      await markSkipped("n-1", "user_disabled", null, { client: fake.client });
      const after = fake.tables.whatsapp_notifications[0] as NotificationRow;
      expect(after.status).toBe(term);
    }
  });
});
