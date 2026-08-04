/**
 * WA-C9.2 Fase D.1 — Testes do adapter outbound técnico.
 *
 * Cobre: validação de recipient, renderer determinístico, request_hash
 * canônica, prepare/sending/accepted/rejected/ambiguous/cancel, ownership,
 * concorrência, FakeTransport, e proteções contra retry automático de
 * ambiguous.
 *
 * NÃO faz chamadas reais. NÃO altera estado da notificação. Usa fake
 * SupabaseLike em memória com simulação de unique parcial.
 */

import { describe, it, expect } from "bun:test";
import {
  FakeWhatsAppNotificationTransport,
  buildClientReference,
  buildNotificationRequestHash,
  buildWhatsAppTemplateRequest,
  cancelPlannedAttempt,
  completeAttemptAccepted,
  completeAttemptAmbiguous,
  completeAttemptRejected,
  executeNotificationAttemptDryTechnical,
  markAttemptSending,
  maskPhone,
  prepareNotificationAttempt,
  renderTemplateComponents,
  validateRecipient,
  type AttemptStatus,
  type NotificationTemplateRow,
  type SupabaseLike,
} from "@/server/whatsapp-outbound-adapter.server";

const NOW = new Date("2026-07-12T20:00:00Z");
const LEASE = new Date("2026-07-12T20:10:00Z").toISOString();
const now = () => NOW;

function template(overrides: Partial<NotificationTemplateRow> = {}): NotificationTemplateRow {
  return {
    key: "gi_conta_vencendo_hoje",
    category: "contas_a_pagar",
    meta_template_name: "gi_conta_vencendo_hoje_v1",
    language: "pt_BR",
    payload_schema: {
      required: ["nome", "valor", "vencimento"],
      body_params_order: ["nome", "valor", "vencimento"],
    },
    active: true,
    ...overrides,
  };
}

const OK_PAYLOAD = { nome: "Conta X", valor: "R$ 120,00", vencimento: "12/07" };

/**
 * Fake SupabaseLike com suporte a:
 *  - whatsapp_notifications (select por id)
 *  - whatsapp_notification_attempts (insert com unique parcial simulada,
 *    select + eq + in, update + eq + in)
 */
function fakeClient(initial?: {
  notif?: Partial<{
    id: string;
    status: string;
    claim_token: string;
    lease_expires_at: string;
  }>;
  attempts?: Array<Record<string, unknown>>;
}) {
  const notifs: Array<Record<string, unknown>> = initial?.notif
    ? [
        {
          id: "n1",
          status: "processing",
          claim_token: "claim-A",
          lease_expires_at: LEASE,
          ...initial.notif,
        },
      ]
    : [
        {
          id: "n1",
          status: "processing",
          claim_token: "claim-A",
          lease_expires_at: LEASE,
        },
      ];
  const attempts: Array<Record<string, unknown>> = initial?.attempts ?? [];
  const ACTIVE: AttemptStatus[] = ["planned", "sending", "ambiguous"];

  const client: SupabaseLike & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  } = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from(table: string): any {
      const rows = table === "whatsapp_notifications" ? notifs : attempts;
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        _insert: null as Record<string, unknown> | null,
        _update: null as Record<string, unknown> | null,
        select() {
          return q;
        },
        insert(row: Record<string, unknown>) {
          q._insert = row;
          return q;
        },
        update(patch: Record<string, unknown>) {
          q._update = patch;
          return q;
        },
        eq(c: string, v: unknown) {
          filters.push((r) => r[c] === v);
          return q;
        },
        in(c: string, vals: unknown[]) {
          filters.push((r) => (vals as unknown[]).includes(r[c]));
          return q;
        },
        maybeSingle() {
          if (q._insert) {
            if (table === "whatsapp_notification_attempts") {
              const nid = q._insert.notification_id;
              const ctok = q._insert.claim_token;
              const status = q._insert.attempt_status as AttemptStatus;
              // UNIQUE (notification_id, claim_token) — fecha B.
              if (attempts.some((a) => a.notification_id === nid && a.claim_token === ctok)) {
                return Promise.resolve({
                  data: null,
                  error: { code: "23505", message: "unique_violation notification_claim" },
                });
              }
              if (
                ACTIVE.includes(status) &&
                attempts.some(
                  (a) =>
                    a.notification_id === nid && ACTIVE.includes(a.attempt_status as AttemptStatus),
                )
              ) {
                return Promise.resolve({
                  data: null,
                  error: { code: "23505", message: "unique_violation active_attempt" },
                });
              }
              if (
                attempts.some((a) => a.attempt_token === q._insert!.attempt_token) ||
                attempts.some((a) => a.client_reference === q._insert!.client_reference)
              ) {
                return Promise.resolve({
                  data: null,
                  error: { code: "23505", message: "unique_violation token" },
                });
              }
            }
            const inserted = { id: `att-${attempts.length + 1}`, ...q._insert };
            rows.push(inserted);
            return Promise.resolve({ data: inserted, error: null });
          }
          const found = rows.find((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data: found ?? null, error: null });
        },
        then(resolve: (v: { data: unknown; error: null }) => unknown) {
          if (q._update) {
            const affected: Record<string, unknown>[] = [];
            for (const r of rows) {
              if (filters.every((f) => f(r))) {
                Object.assign(r, q._update);
                affected.push(r);
              }
            }
            return Promise.resolve({ data: affected, error: null }).then(resolve);
          }
          const matched = rows.filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data: matched, error: null }).then(resolve);
        },
      };
      return q;
    },
    // Simula as RPCs atômicas do Postgres.
    //
    //  - whatsapp_attempt_prepare_atomic: valida ownership + verifica ativos
    //    + insere numa "transação" única (SECURITY DEFINER + FOR UPDATE).
    //  - whatsapp_attempt_mark_sending_atomic: revalida ownership sob lock
    //    e move planned → sending; se ownership caiu, cancela a tentativa
    //    atomicamente (planned → cancelled com error_code='ownership_lost').
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "whatsapp_attempt_prepare_atomic") {
        const nid = args.p_notification_id as string;
        const ctok = args.p_claim_token as string;
        const nowIso = String(args.p_now ?? new Date().toISOString());
        const notif = notifs.find((n) => n.id === nid);
        const valid =
          notif &&
          notif.status === "processing" &&
          notif.claim_token === ctok &&
          typeof notif.lease_expires_at === "string" &&
          (notif.lease_expires_at as string) > nowIso;
        if (!valid) {
          return { data: [{ outcome: "state_changed", attempt_id: null }], error: null };
        }
        const existing = attempts.find(
          (a) => a.notification_id === nid && ACTIVE.includes(a.attempt_status as AttemptStatus),
        );
        if (existing) {
          return {
            data: [
              {
                outcome:
                  existing.attempt_status === "ambiguous" ? "quarantined" : "active_attempt_exists",
                attempt_id: null,
              },
            ],
            error: null,
          };
        }
        if (attempts.some((a) => a.notification_id === nid && a.claim_token === ctok)) {
          return { data: [{ outcome: "active_attempt_exists", attempt_id: null }], error: null };
        }
        const inserted = {
          id: `att-${attempts.length + 1}`,
          notification_id: nid,
          attempt_token: args.p_attempt_token,
          claim_token: ctok,
          request_hash: args.p_request_hash,
          template_key: args.p_template_key,
          template_name: args.p_template_name,
          template_language: args.p_template_language,
          client_reference: args.p_client_reference,
          attempt_status: "planned" as AttemptStatus,
          started_at: nowIso,
        };
        attempts.push(inserted);
        return { data: [{ outcome: "prepared", attempt_id: inserted.id }], error: null };
      }
      if (name === "whatsapp_attempt_mark_sending_atomic") {
        const aid = args.p_attempt_id as string;
        const atok = args.p_attempt_token as string;
        const nowIso = String(args.p_now ?? new Date().toISOString());
        const att = attempts.find((a) => a.id === aid && a.attempt_token === atok);
        if (!att) return { data: [{ outcome: "not_found" }], error: null };
        if (att.attempt_status !== "planned") {
          return { data: [{ outcome: "state_changed" }], error: null };
        }
        const nf = notifs.find((n) => n.id === att.notification_id);
        const ownershipValid =
          nf &&
          nf.status === "processing" &&
          nf.claim_token === att.claim_token &&
          typeof nf.lease_expires_at === "string" &&
          (nf.lease_expires_at as string) > nowIso;
        if (!ownershipValid) {
          att.attempt_status = "cancelled";
          att.error_code = "ownership_lost";
          att.error_category = "cancelled";
          att.retryable = null;
          att.finished_at = nowIso;
          return { data: [{ outcome: "ownership_lost" }], error: null };
        }
        att.attempt_status = "sending";
        return { data: [{ outcome: "sending" }], error: null };
      }
      return { data: null, error: { message: "unknown_rpc" } };
    },
  };
  return { client, notifs, attempts };
}

// ─────────────────────────────────────────────────────────────────────────────
// validateRecipient

describe("validateRecipient", () => {
  it("aceita e normaliza E.164 BR", () => {
    const r = validateRecipient("+55 (11) 91234-5678");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.digits).toBe("5511912345678");
      expect(r.hash).toHaveLength(64);
    }
  });
  it("rejeita vazio", () => {
    expect(validateRecipient("").ok).toBe(false);
    expect(validateRecipient(null).ok).toBe(false);
    expect(validateRecipient(undefined).ok).toBe(false);
  });
  it("rejeita muito curto", () => {
    const r = validateRecipient("123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid");
  });
  it("maskPhone não expõe centro", () => {
    expect(maskPhone("5511912345678")).toBe("55*********78");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Renderer

describe("renderTemplateComponents", () => {
  it("ordena parâmetros conforme body_params_order", () => {
    const r = renderTemplateComponents(template(), OK_PAYLOAD);
    if (!("components" in r)) throw new Error("expected ok");
    expect(r.paramsOrdered).toEqual(["Conta X", "R$ 120,00", "12/07"]);
    expect(r.components[0].parameters.map((p) => p.text)).toEqual([
      "Conta X",
      "R$ 120,00",
      "12/07",
    ]);
  });
  it("rejeita parâmetro ausente", () => {
    const r = renderTemplateComponents(template(), { nome: "X", valor: "R$1" });
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "param_missing") expect(r.param).toBe("vencimento");
  });
  it("ignora parâmetro extra", () => {
    const r = renderTemplateComponents(template(), { ...OK_PAYLOAD, extra: "junk" });
    if (!("components" in r)) throw new Error("expected ok");
    expect(r.paramsOrdered).toEqual(["Conta X", "R$ 120,00", "12/07"]);
  });
  it("sanitiza whitespace / quebras", () => {
    const r = renderTemplateComponents(template(), {
      nome: "  Conta\n\tX  ",
      valor: "R$ 120,00",
      vencimento: "12/07",
    });
    if (!("components" in r)) throw new Error("expected ok");
    expect(r.paramsOrdered[0]).toBe("Conta X");
  });
  it("rejeita param vazio (só espaços)", () => {
    const r = renderTemplateComponents(template(), {
      nome: "   ",
      valor: "R$ 1",
      vencimento: "12/07",
    });
    expect(r.ok).toBe(false);
  });
  it("rejeita template desabilitado", () => {
    const r = renderTemplateComponents(template({ active: false }), OK_PAYLOAD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("template_disabled");
  });
  it("rejeita template sem meta_template_name", () => {
    const r = renderTemplateComponents(template({ meta_template_name: null }), OK_PAYLOAD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("template_name_missing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// request_hash

describe("buildNotificationRequestHash", () => {
  const base = {
    templateName: "gi_conta_vencendo_hoje_v1",
    languageCode: "pt_BR",
    components: [
      { type: "body" as const, parameters: [{ type: "text" as const, text: "Conta X" }] },
    ],
    recipientHash: "a".repeat(64),
    clientReference: "wa_attempt:u1",
  };
  it("é determinístico e independe da ordem de chaves", () => {
    const h1 = buildNotificationRequestHash(base);
    const h2 = buildNotificationRequestHash({
      clientReference: base.clientReference,
      components: base.components,
      languageCode: base.languageCode,
      recipientHash: base.recipientHash,
      templateName: base.templateName,
    });
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });
  it("muda com template diferente", () => {
    expect(buildNotificationRequestHash({ ...base, templateName: "other" })).not.toBe(
      buildNotificationRequestHash(base),
    );
  });
  it("muda com parâmetro diferente", () => {
    expect(
      buildNotificationRequestHash({
        ...base,
        components: [{ type: "body", parameters: [{ type: "text", text: "Conta Y" }] }],
      }),
    ).not.toBe(buildNotificationRequestHash(base));
  });
  it("muda com recipient diferente", () => {
    expect(buildNotificationRequestHash({ ...base, recipientHash: "b".repeat(64) })).not.toBe(
      buildNotificationRequestHash(base),
    );
  });
  it("não contém telefone em claro", () => {
    const h = buildNotificationRequestHash(base);
    // Hash é 64 hex chars, não pode conter dígitos de telefone.
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
  });
});

describe("buildWhatsAppTemplateRequest / buildClientReference", () => {
  it("gera payload canônico com biz_opaque_callback_data", () => {
    const r = buildWhatsAppTemplateRequest({
      recipientDigits: "5511912345678",
      templateName: "gi_x",
      languageCode: "pt_BR",
      components: [],
      clientReference: "wa_attempt:abc",
    });
    expect(r.messaging_product).toBe("whatsapp");
    expect(r.type).toBe("template");
    expect(r.biz_opaque_callback_data).toBe("wa_attempt:abc");
    expect(r.template.language.code).toBe("pt_BR");
  });
  it("client_reference embute attempt_token sem PII", () => {
    const ref = buildClientReference("uuid-1234");
    expect(ref).toBe("wa_attempt:uuid-1234");
    expect(ref).not.toMatch(/\d{10,}/); // sem telefone
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// prepareNotificationAttempt

describe("prepareNotificationAttempt", () => {
  const baseInput = {
    notificationId: "n1",
    claimToken: "claim-A",
    template: template(),
    payload: OK_PAYLOAD,
    recipient: "5511912345678",
  };

  it("cria attempt planned com sucesso", async () => {
    const { client, attempts } = fakeClient();
    let counter = 0;
    const res = await prepareNotificationAttempt(baseInput, {
      client,
      now,
      randomUUID: () => `att-token-${++counter}`,
    });
    expect(res.kind).toBe("prepared");
    if (res.kind !== "prepared") return;
    expect(attempts.length).toBe(1);
    expect(attempts[0].attempt_status).toBe("planned");
    expect(attempts[0].client_reference).toBe("wa_attempt:att-token-1");
    expect(attempts[0].claim_token).toBe("claim-A");
    expect(res.requestHash).toHaveLength(64);
  });

  it("rejeita quando notification não está em processing", async () => {
    const { client } = fakeClient({ notif: { status: "pending" } });
    const r = await prepareNotificationAttempt(baseInput, { client, now });
    expect(r.kind).toBe("state_changed");
  });

  it("rejeita claim_token errado", async () => {
    const { client } = fakeClient();
    const r = await prepareNotificationAttempt(
      { ...baseInput, claimToken: "wrong" },
      { client, now },
    );
    expect(r.kind).toBe("state_changed");
  });

  it("rejeita lease expirado", async () => {
    const { client } = fakeClient({
      notif: { lease_expires_at: "2026-07-12T19:00:00Z" },
    });
    const r = await prepareNotificationAttempt(baseInput, { client, now });
    expect(r.kind).toBe("state_changed");
  });

  it("rejeita recipient inválido", async () => {
    const { client } = fakeClient();
    const r = await prepareNotificationAttempt({ ...baseInput, recipient: "abc" }, { client, now });
    expect(r.kind).toBe("invalid_recipient");
  });

  it("rejeita template sem meta_template_name", async () => {
    const { client } = fakeClient();
    const r = await prepareNotificationAttempt(
      { ...baseInput, template: template({ meta_template_name: null }) },
      { client, now },
    );
    expect(r.kind).toBe("invalid_template");
    if (r.kind === "invalid_template") expect(r.reason).toBe("template_name_missing");
  });

  it("bloqueia com active_attempt_exists quando existe planned", async () => {
    const { client } = fakeClient({
      attempts: [
        {
          id: "att-existing",
          notification_id: "n1",
          attempt_token: "old",
          claim_token: "claim-A",
          attempt_status: "planned",
          client_reference: "wa_attempt:old",
          request_hash: "x",
          template_key: "k",
          template_name: "t",
          template_language: "pt_BR",
        },
      ],
    });
    const r = await prepareNotificationAttempt(baseInput, { client, now });
    expect(r.kind).toBe("active_attempt_exists");
  });

  it("quarentena com attempt ambiguous", async () => {
    const { client } = fakeClient({
      attempts: [
        {
          id: "att-amb",
          notification_id: "n1",
          attempt_token: "amb",
          claim_token: "claim-A",
          attempt_status: "ambiguous",
          client_reference: "wa_attempt:amb",
          request_hash: "x",
          template_key: "k",
          template_name: "t",
          template_language: "pt_BR",
        },
      ],
    });
    const r = await prepareNotificationAttempt(baseInput, { client, now });
    expect(r.kind).toBe("quarantined");
  });

  it("dois prepares concorrentes: no máximo um cria attempt ativa", async () => {
    // O select prévio verá ambos como 'sem ativo', mas o segundo insert
    // colide na unique parcial (23505) → active_attempt_exists.
    const { client, attempts } = fakeClient();
    let n = 0;
    const [r1, r2] = await Promise.all([
      prepareNotificationAttempt(baseInput, {
        client,
        now,
        randomUUID: () => `t-${++n}`,
      }),
      prepareNotificationAttempt(baseInput, {
        client,
        now,
        randomUUID: () => `t-${++n}`,
      }),
    ]);
    const results = [r1.kind, r2.kind].sort();
    // Um "prepared", outro "active_attempt_exists".
    expect(results).toEqual(["active_attempt_exists", "prepared"]);
    const active = attempts.filter((a) =>
      ["planned", "sending", "ambiguous"].includes(String(a.attempt_status)),
    );
    expect(active.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Transições

describe("markAttemptSending / accepted / rejected / ambiguous / cancel", () => {
  async function setup() {
    const { client, attempts } = fakeClient();
    const r = await prepareNotificationAttempt(
      {
        notificationId: "n1",
        claimToken: "claim-A",
        template: template(),
        payload: OK_PAYLOAD,
        recipient: "5511912345678",
      },
      { client, now, randomUUID: () => "att-token-1" },
    );
    if (r.kind !== "prepared") throw new Error("setup failed");
    return { client, attempts, attemptId: r.attemptId, attemptToken: r.attemptToken };
  }

  it("planned → sending com token correto", async () => {
    const s = await setup();
    expect(await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now })).toBe(
      true,
    );
    expect(s.attempts[0].attempt_status).toBe("sending");
  });

  it("mark sending com token errado falha", async () => {
    const s = await setup();
    expect(await markAttemptSending(s.attemptId, "wrong", { client: s.client, now })).toBe(false);
    expect(s.attempts[0].attempt_status).toBe("planned");
  });

  it("accepted grava PMID e é idempotente sob replay", async () => {
    const s = await setup();
    await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now });
    expect(
      await completeAttemptAccepted(s.attemptId, s.attemptToken, "wamid.X", 200, {
        client: s.client,
        now,
      }),
    ).toBe(true);
    expect(s.attempts[0].attempt_status).toBe("accepted");
    expect(s.attempts[0].provider_message_id).toBe("wamid.X");
    // Replay: já está accepted, não é mais sending → retorna false (no-op).
    expect(
      await completeAttemptAccepted(s.attemptId, s.attemptToken, "wamid.X", 200, {
        client: s.client,
        now,
      }),
    ).toBe(false);
    expect(s.attempts[0].provider_message_id).toBe("wamid.X");
  });

  it("accepted exige provider_message_id não vazio", async () => {
    const s = await setup();
    await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now });
    expect(
      await completeAttemptAccepted(s.attemptId, s.attemptToken, "", 200, {
        client: s.client,
        now,
      }),
    ).toBe(false);
    expect(s.attempts[0].attempt_status).toBe("sending");
  });

  it("rejected grava erro sanitizado + retryable", async () => {
    const s = await setup();
    await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now });
    expect(
      await completeAttemptRejected(
        s.attemptId,
        s.attemptToken,
        { errorCode: "131047", errorCategory: "template", retryable: false, httpStatus: 400 },
        { client: s.client, now },
      ),
    ).toBe(true);
    expect(s.attempts[0].attempt_status).toBe("rejected");
    expect(s.attempts[0].error_code).toBe("131047");
    expect(s.attempts[0].retryable).toBe(false);
  });

  it("rejected não vira accepted por chamada local", async () => {
    const s = await setup();
    await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now });
    await completeAttemptRejected(
      s.attemptId,
      s.attemptToken,
      { errorCode: "e", errorCategory: "c", retryable: false },
      { client: s.client, now },
    );
    expect(
      await completeAttemptAccepted(s.attemptId, s.attemptToken, "wamid.Y", 200, {
        client: s.client,
        now,
      }),
    ).toBe(false);
    expect(s.attempts[0].attempt_status).toBe("rejected");
  });

  it("ambiguous grava e bloqueia nova tentativa (retryable=null)", async () => {
    const s = await setup();
    await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now });
    expect(
      await completeAttemptAmbiguous(s.attemptId, s.attemptToken, "timeout", {
        client: s.client,
        now,
      }),
    ).toBe(true);
    expect(s.attempts[0].attempt_status).toBe("ambiguous");
    expect(s.attempts[0].retryable).toBeNull();

    // Nova prepare deve retornar quarantined.
    const r2 = await prepareNotificationAttempt(
      {
        notificationId: "n1",
        claimToken: "claim-A",
        template: template(),
        payload: OK_PAYLOAD,
        recipient: "5511912345678",
      },
      { client: s.client, now, randomUUID: () => "att-token-2" },
    );
    expect(r2.kind).toBe("quarantined");
  });

  it("ambiguous replay é idempotente", async () => {
    const s = await setup();
    await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now });
    await completeAttemptAmbiguous(s.attemptId, s.attemptToken, "t1", {
      client: s.client,
      now,
    });
    expect(
      await completeAttemptAmbiguous(s.attemptId, s.attemptToken, "t2", {
        client: s.client,
        now,
      }),
    ).toBe(false);
    expect(s.attempts[0].error_code).toBe("t1");
  });

  it("cancel funciona em planned; NÃO funciona em sending/accepted/ambiguous", async () => {
    const s1 = await setup();
    expect(
      await cancelPlannedAttempt(s1.attemptId, s1.attemptToken, "user_disabled", {
        client: s1.client,
        now,
      }),
    ).toBe(true);
    expect(s1.attempts[0].attempt_status).toBe("cancelled");

    const s2 = await setup();
    await markAttemptSending(s2.attemptId, s2.attemptToken, { client: s2.client, now });
    expect(
      await cancelPlannedAttempt(s2.attemptId, s2.attemptToken, "x", {
        client: s2.client,
        now,
      }),
    ).toBe(false);
    expect(s2.attempts[0].attempt_status).toBe("sending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FakeTransport + executeNotificationAttemptDryTechnical

describe("executeNotificationAttemptDryTechnical", () => {
  const baseInput = {
    notificationId: "n1",
    claimToken: "claim-A",
    phoneNumberId: "PHONE_ID_TEST",
    template: template(),
    payload: OK_PAYLOAD,
    recipient: "5511912345678",
  };

  it("FakeTransport accepted → attempt fica accepted, PMID gravado", async () => {
    const { client, attempts } = fakeClient();
    const transport = new FakeWhatsAppNotificationTransport({
      kind: "accepted",
      providerMessageId: "wamid.OK",
      httpStatus: 200,
    });
    const r = await executeNotificationAttemptDryTechnical(baseInput, { client, now }, transport);
    expect(r.kind).toBe("accepted");
    expect(attempts[0].attempt_status).toBe("accepted");
    expect(attempts[0].provider_message_id).toBe("wamid.OK");
    // Transport foi chamado com dados sem PII crua na referência.
    expect(transport.calls[0].clientReference.startsWith("wa_attempt:")).toBe(true);
    expect(transport.calls[0].recipient).toBe("5511912345678");
    // Nenhuma alteração em notification.
    // (fake não modifica notifs; asserção implícita: sem call de update em notifs).
  });

  it("FakeTransport rejected → attempt fica rejected", async () => {
    const { client, attempts } = fakeClient();
    const transport = new FakeWhatsAppNotificationTransport({
      kind: "rejected",
      errorCode: "131047",
      errorCategory: "template",
      retryable: false,
      httpStatus: 400,
    });
    const r = await executeNotificationAttemptDryTechnical(baseInput, { client, now }, transport);
    expect(r.kind).toBe("rejected");
    expect(attempts[0].attempt_status).toBe("rejected");
  });

  it("FakeTransport ambiguous → attempt fica ambiguous e bloqueia retry", async () => {
    const { client, attempts } = fakeClient();
    const transport = new FakeWhatsAppNotificationTransport({
      kind: "ambiguous",
      reason: "network_timeout",
    });
    const r = await executeNotificationAttemptDryTechnical(baseInput, { client, now }, transport);
    expect(r.kind).toBe("ambiguous");
    expect(attempts[0].attempt_status).toBe("ambiguous");
    // Retry automático: nova execute → quarantined.
    const r2 = await executeNotificationAttemptDryTechnical(baseInput, { client, now }, transport);
    expect(r2.kind).toBe("quarantined");
  });

  it("transport lança → ambiguous (nunca accepted, nunca retry silencioso)", async () => {
    const { client, attempts } = fakeClient();
    const transport: FakeWhatsAppNotificationTransport = new FakeWhatsAppNotificationTransport(
      () => {
        throw new Error("EPIPE");
      },
    );
    const r = await executeNotificationAttemptDryTechnical(baseInput, { client, now }, transport);
    expect(r.kind).toBe("ambiguous");
    expect(attempts[0].attempt_status).toBe("ambiguous");
  });

  it("recusa executar sem transport (argumento obrigatório)", async () => {
    const { client, attempts } = fakeClient();
    // @ts-expect-error — provoca compilação e runtime error controlado.
    const r = await executeNotificationAttemptDryTechnical(baseInput, { client, now }, undefined);
    expect(r.kind).toBe("database_error");
    expect(attempts.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hardening pós-auditoria: atomicidade e uma-tentativa-por-claim.

describe("prepareNotificationAttempt — atomic ownership (Pergunta A)", () => {
  const baseInput = {
    notificationId: "n1",
    claimToken: "claim-A",
    template: template(),
    payload: OK_PAYLOAD,
    recipient: "5511912345678",
  };

  it("claim_token rotacionado antes do INSERT → state_changed, nenhuma tentativa criada", async () => {
    const { client, notifs, attempts } = fakeClient();
    notifs[0].claim_token = "claim-ROTATED";
    const r = await prepareNotificationAttempt(baseInput, { client, now });
    expect(r.kind).toBe("state_changed");
    expect(attempts.length).toBe(0);
  });

  it("lease expirado antes do INSERT → state_changed, nenhuma tentativa criada", async () => {
    const { client, notifs, attempts } = fakeClient();
    notifs[0].lease_expires_at = new Date(NOW.getTime() - 60_000).toISOString();
    const r = await prepareNotificationAttempt(baseInput, { client, now });
    expect(r.kind).toBe("state_changed");
    expect(attempts.length).toBe(0);
  });

  it("status virou pending antes do INSERT → state_changed", async () => {
    const { client, notifs, attempts } = fakeClient();
    notifs[0].status = "pending";
    const r = await prepareNotificationAttempt(baseInput, { client, now });
    expect(r.kind).toBe("state_changed");
    expect(attempts.length).toBe(0);
  });
});

describe("prepareNotificationAttempt — uma tentativa por claim (Pergunta B)", () => {
  const baseInput = {
    notificationId: "n1",
    claimToken: "claim-A",
    phoneNumberId: "PHONE_ID_TEST",
    template: template(),
    payload: OK_PAYLOAD,
    recipient: "5511912345678",
  };

  it("após accepted, mesmo claim_token não gera segunda tentativa", async () => {
    const { client, attempts } = fakeClient();
    const transport = new FakeWhatsAppNotificationTransport({
      kind: "accepted",
      providerMessageId: "wamid.OK",
      httpStatus: 200,
    });
    const r1 = await executeNotificationAttemptDryTechnical(baseInput, { client, now }, transport);
    expect(r1.kind).toBe("accepted");
    expect(attempts.length).toBe(1);
    expect(attempts[0].attempt_status).toBe("accepted");

    const r2 = await prepareNotificationAttempt(baseInput, { client, now });
    expect(r2.kind).toBe("active_attempt_exists");
    expect(attempts.length).toBe(1);
  });

  it("após rejected, mesmo claim_token também não gera segunda tentativa", async () => {
    const { client, attempts } = fakeClient();
    const transport = new FakeWhatsAppNotificationTransport({
      kind: "rejected",
      errorCode: "131047",
      errorCategory: "template",
      retryable: false,
      httpStatus: 400,
    });
    await executeNotificationAttemptDryTechnical(baseInput, { client, now }, transport);
    expect(attempts.length).toBe(1);
    const r2 = await prepareNotificationAttempt(baseInput, { client, now });
    expect(r2.kind).toBe("active_attempt_exists");
    expect(attempts.length).toBe(1);
  });

  it("novo claim_token após reclaim autoriza exatamente uma nova tentativa", async () => {
    const { client, notifs, attempts } = fakeClient();
    const transport = new FakeWhatsAppNotificationTransport({
      kind: "accepted",
      providerMessageId: "wamid.OK",
      httpStatus: 200,
    });
    await executeNotificationAttemptDryTechnical(baseInput, { client, now }, transport);
    expect(attempts.length).toBe(1);
    notifs[0].claim_token = "claim-B";
    const r2 = await prepareNotificationAttempt(
      { ...baseInput, claimToken: "claim-B" },
      { client, now },
    );
    expect(r2.kind).toBe("prepared");
    expect(attempts.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WA-C9.2 D.1 Preflight — revalidação de ownership entre prepare e sending.
//
// Requisito 1.A: markAttemptSending revalida atomicamente (status/claim/lease
// da notificação) antes de mover planned → sending. Em qualquer cenário de
// ownership perdida, o transport NUNCA é chamado, a tentativa não entra em
// sending, e nenhuma nova tentativa é criada.

describe("markAttemptSending — revalidação atômica de ownership (Requisito 1.A)", () => {
  const baseInput = {
    notificationId: "n1",
    claimToken: "claim-A",
    phoneNumberId: "PHONE_ID_TEST",
    template: template(),
    payload: OK_PAYLOAD,
    recipient: "5511912345678",
  };

  async function prepared() {
    const { client, notifs, attempts } = fakeClient();
    const r = await prepareNotificationAttempt(baseInput, {
      client,
      now,
      randomUUID: () => "att-token-owner-A",
    });
    if (r.kind !== "prepared") throw new Error("prepare failed in setup");
    return { client, notifs, attempts, attemptId: r.attemptId, attemptToken: r.attemptToken };
  }

  it("Cenário 1: callback moveu notif para 'sent' entre prepare e sending → ownership_lost", async () => {
    const s = await prepared();
    // Simula o webhook de callback processando 'sent' entre prepare e sending.
    s.notifs[0].status = "sent";
    const transport = new FakeWhatsAppNotificationTransport({
      kind: "accepted",
      providerMessageId: "wamid.NOT_ALLOWED",
      httpStatus: 200,
    });
    const ok = await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now });
    expect(ok).toBe(false);
    expect(s.attempts[0].attempt_status).toBe("cancelled");
    expect(s.attempts[0].error_code).toBe("ownership_lost");
    expect(transport.calls.length).toBe(0);
    expect(s.attempts.length).toBe(1);
  });

  it("Cenário 2: recovery limpou claim_token depois do prepare → ownership_lost", async () => {
    const s = await prepared();
    s.notifs[0].claim_token = null;
    const ok = await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now });
    expect(ok).toBe(false);
    expect(s.attempts[0].attempt_status).toBe("cancelled");
    expect(s.attempts[0].error_code).toBe("ownership_lost");
    expect(s.attempts.length).toBe(1);
  });

  it("Cenário 3: lease venceu depois do prepare → ownership_lost", async () => {
    const s = await prepared();
    s.notifs[0].lease_expires_at = new Date(NOW.getTime() - 1000).toISOString();
    const ok = await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now });
    expect(ok).toBe(false);
    expect(s.attempts[0].attempt_status).toBe("cancelled");
    expect(s.attempts[0].error_code).toBe("ownership_lost");
  });

  it("Cenário 4: claim A foi substituído por claim B → ownership_lost", async () => {
    const s = await prepared();
    s.notifs[0].claim_token = "claim-B";
    const ok = await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now });
    expect(ok).toBe(false);
    expect(s.attempts[0].attempt_status).toBe("cancelled");
    expect(s.attempts[0].error_code).toBe("ownership_lost");
  });

  it("Cenário 5: notificação cancelada antes do sending → ownership_lost", async () => {
    const s = await prepared();
    s.notifs[0].status = "cancelled";
    const ok = await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now });
    expect(ok).toBe(false);
    expect(s.attempts[0].attempt_status).toBe("cancelled");
    expect(s.attempts[0].error_code).toBe("ownership_lost");
  });

  it("executeNotificationAttemptDryTechnical: ownership perdida entre prepare e sending NÃO chama transport", async () => {
    // Repete o cenário 1 pelo orquestrador de ponta-a-ponta.
    const { client, notifs, attempts } = fakeClient();
    let step = 0;
    // Transport que sabota o teste caso seja chamado.
    const transport = new FakeWhatsAppNotificationTransport(() => {
      throw new Error("transport MUST NOT be called when ownership is lost");
    });
    // Sobrescreve a RPC de mark_sending para simular perda de ownership
    // depois que a tentativa 'planned' já existe. O prepare passa; o
    // mark_sending encontra notif.status='sent' e cancela a tentativa.
    const origRpc = client.rpc.bind(client);
    (client as unknown as { rpc: typeof origRpc }).rpc = async (name, args) => {
      if (name === "whatsapp_attempt_mark_sending_atomic") {
        // simula que o callback já mudou o status
        notifs[0].status = "sent";
      }
      step += 1;
      return origRpc(name, args);
    };
    const r = await executeNotificationAttemptDryTechnical(baseInput, { client, now }, transport);
    expect(r.kind).toBe("state_changed");
    expect(transport.calls.length).toBe(0);
    expect(attempts.length).toBe(1);
    expect(attempts[0].attempt_status).toBe("cancelled");
    expect(attempts[0].error_code).toBe("ownership_lost");
    expect(step).toBeGreaterThan(0);
  });

  it("ownership válida no momento do sending → segue normalmente", async () => {
    const s = await prepared();
    // Notif intocada; markAttemptSending deve suceder.
    const ok = await markAttemptSending(s.attemptId, s.attemptToken, { client: s.client, now });
    expect(ok).toBe(true);
    expect(s.attempts[0].attempt_status).toBe("sending");
  });
});
