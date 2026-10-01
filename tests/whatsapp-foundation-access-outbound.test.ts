import { test, expect, describe } from "bun:test";
import { planAllowsFeature, plansAllowingFeature, type PlanTier } from "../src/lib/plans";
import {
  recordOutboundSend,
  reconcileOutboundStatus,
  parseMetaSendResponse,
  reduceOutboundStatus,
} from "../src/server/whatsapp-outbound-log.server";

describe("acesso ao WhatsApp coerente com has_feature_access", () => {
  for (const p of ["pessoal_premium", "mei_essencial", "mei_inteligente", "empresa"] as PlanTier[]) {
    test(`${p} tem WhatsApp`, () => expect(planAllowsFeature(p, "whatsapp")).toBe(true));
  }
  for (const p of ["free", "free_ads", "sem_assinatura", "pessoal_manual"] as PlanTier[]) {
    test(`${p} continua sem WhatsApp`, () => expect(planAllowsFeature(p, "whatsapp")).toBe(false));
  }
  test("admin_master continua com bypass", () =>
    expect(planAllowsFeature("admin_master", "whatsapp")).toBe(true));
  test("lista comercial = planos pagos", () =>
    expect(plansAllowingFeature("whatsapp").sort()).toEqual(
      ["empresa", "mei_essencial", "mei_inteligente", "pessoal_premium"].sort(),
    ));
});

// ---- banco fake mínimo ----
type Row = Record<string, any>;
function fakeDb() {
  const tables: Record<string, Row[]> = {
    whatsapp_outbound_messages: [],
    whatsapp_notification_status_events: [],
    whatsapp_links: [{ telefone: "5511934600504", user_id: "user-1" }],
  };
  const from = (t: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let pendingUpdate: Row | null = null;
    const b: any = {
      select: () => b,
      limit: () => b,
      eq: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
        if (pendingUpdate) {
          const u = pendingUpdate;
          tables[t].filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, u));
          return Promise.resolve({ error: null });
        }
        return b;
      },
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      maybeSingle: async () => ({
        data: tables[t].find((r) => filters.every((f) => f(r))) ?? null,
        error: null,
      }),
      then: (res: any) =>
        res({ data: tables[t].filter((r) => filters.every((f) => f(r))), error: null }),
      insert: async (row: Row) => (tables[t].push({ id: crypto.randomUUID(), ...row }), { error: null }),
      upsert: async (row: Row, o: { onConflict: string }) => {
        if (!tables[t].some((r) => r[o.onConflict] === row[o.onConflict]))
          tables[t].push({ id: crypto.randomUUID(), sent_at: null, delivered_at: null, read_at: null, ...row });
        return { error: null };
      },
      update: (u: Row) => ((pendingUpdate = u), b),
    };
    return b;
  };
  return { tables, client: { from } };
}

const OK_BODY = JSON.stringify({ messages: [{ id: "wamid.ABC" }] });
const send = (db: ReturnType<typeof fakeDb>, over: Partial<Parameters<typeof recordOutboundSend>[0]> = {}) =>
  recordOutboundSend(
    { to: "5511934600504", messageType: "text", content: "Gasto salvo", ok: true, httpStatus: 200, responseBody: OK_BODY, ...over },
    db.client,
  );
const ev = (status: string, at: string, extra: Row = {}) => ({
  provider_message_id: "wamid.ABC", event_status: status, event_at: at, error_code: null, error_message: null, ...extra,
});

describe("rastreabilidade outbound", () => {
  test("envio OK captura meta_message_id e persiste sem texto/telefone em claro", async () => {
    const db = fakeDb();
    const r = await send(db);
    expect(r).toEqual({ recorded: true, metaMessageId: "wamid.ABC", status: "accepted" });
    const row = db.tables.whatsapp_outbound_messages[0];
    expect(row.user_id).toBe("user-1");
    expect(row.status).toBe("accepted");
    expect(row.recipient_last4).toBe("0504");
    expect(JSON.stringify(row)).not.toContain("Gasto salvo");
    expect(JSON.stringify(row)).not.toContain("5511934600504");
  });

  test("callbacks sent → delivered → read atualizam sem regredir", async () => {
    const db = fakeDb();
    await send(db);
    const E = db.tables.whatsapp_notification_status_events;
    const row = () => db.tables.whatsapp_outbound_messages[0];
    E.push(ev("sent", "2026-09-30T10:00:00Z"));
    await reconcileOutboundStatus("wamid.ABC", db.client);
    expect(row().status).toBe("sent");
    E.push(ev("delivered", "2026-09-30T10:00:05Z"));
    await reconcileOutboundStatus("wamid.ABC", db.client);
    expect(row().status).toBe("delivered");
    E.push(ev("read", "2026-09-30T10:01:00Z"));
    await reconcileOutboundStatus("wamid.ABC", db.client);
    expect(row().status).toBe("read");
    // sent atrasado/duplicado não regride nem troca o horário
    E.push(ev("sent", "2026-09-30T10:05:00Z"));
    await reconcileOutboundStatus("wamid.ABC", db.client);
    expect(row().status).toBe("read");
    expect(row().sent_at).toBe("2026-09-30T10:00:00Z");
  });

  test("callback failed registra código e mensagem sanitizada", async () => {
    const db = fakeDb();
    await send(db);
    db.tables.whatsapp_notification_status_events.push(
      ev("failed", "2026-09-30T10:00:00Z", { error_code: "131026", error_message: "Undeliverable to 5511934600504" }),
    );
    await reconcileOutboundStatus("wamid.ABC", db.client);
    const row = db.tables.whatsapp_outbound_messages[0];
    expect(row.status).toBe("failed");
    expect(row.error_code).toBe("131026");
    expect(row.error_message).not.toContain("5511934600504");
    expect(row.failed_at).toBe("2026-09-30T10:00:00Z");
  });

  test("callback duplicado é idempotente", async () => {
    const db = fakeDb();
    await send(db);
    db.tables.whatsapp_notification_status_events.push(ev("delivered", "2026-09-30T10:00:05Z"));
    const a = await reconcileOutboundStatus("wamid.ABC", db.client);
    const b = await reconcileOutboundStatus("wamid.ABC", db.client);
    expect(a.changed).toBe(true);
    expect(b.changed).toBe(false);
  });

  test("callback antes do registro é aplicado ao salvar o envio", async () => {
    const db = fakeDb();
    db.tables.whatsapp_notification_status_events.push(ev("delivered", "2026-09-30T10:00:05Z"));
    await send(db);
    expect(db.tables.whatsapp_outbound_messages[0].status).toBe("delivered");
  });

  test("erro HTTP da Meta vira send_failed com código", async () => {
    const db = fakeDb();
    const r = await send(db, {
      ok: false, httpStatus: 400,
      responseBody: JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }),
    });
    expect(r.status).toBe("send_failed");
    const row = db.tables.whatsapp_outbound_messages[0];
    expect(row.error_code).toBe("131047");
    expect(row.meta_message_id).toBeNull();
    expect(row.http_status).toBe(400);
  });

  test("mesmo meta_message_id não duplica registro", async () => {
    const db = fakeDb();
    await send(db);
    await send(db);
    expect(db.tables.whatsapp_outbound_messages.length).toBe(1);
  });

  test("falha de banco não lança (envio nunca é afetado)", async () => {
    const r = await recordOutboundSend(
      { to: "5511934600504", messageType: "text", content: "x", ok: true, httpStatus: 200, responseBody: OK_BODY },
      { from: () => { throw new Error("db down"); } },
    );
    expect(r.recorded).toBe(false);
  });

  test("parser e redutor puros", () => {
    expect(parseMetaSendResponse("not json").metaMessageId).toBeNull();
    const base = { status: "accepted" as const, sent_at: null, delivered_at: null, read_at: null, failed_at: null, error_code: null, error_message: null };
    expect(reduceOutboundStatus(base, [
      { event_status: "failed", event_at: "2026-01-01T00:00:00Z", error_code: "1", error_message: null },
      { event_status: "delivered", event_at: "2026-01-01T00:00:01Z", error_code: null, error_message: null },
    ]).status).toBe("delivered");
  });
});

// ---- 01/10/2026: mensagens interativas usam o MESMO rastreio ----
describe("rastreio de botões e listas (mesmo recordOutboundSend)", async () => {
  const { buildInteractiveFromReply, toGraphInteractive } = await import(
    "../src/server/whatsapp-interactive.server"
  );
  const corpoConfirmacao =
    "Confere pra mim? 👀\n\n• Descrição: Uber\n• Valor: R$ 12,60\n\nPosso registrar?\n\nEscolha uma opção:\n1. ✅ Confirmar\n2. ✏️ Ajustar\n3. ❌ Cancelar";
  const casos: Array<[string, string, string]> = [
    ["A. reply buttons", corpoConfirmacao, "button"],
    ["B. list message", "📌 O que deseja fazer?\n1. Gastos\n2. Cartões", "list"],
  ];
  for (const [nome, corpo, tipo] of casos) {
    test(nome, async () => {
      const ir = buildInteractiveFromReply(corpo)!;
      expect(ir.type).toBe(tipo);
      const interactive = toGraphInteractive(ir);
      const db = fakeDb();
      const r = await send(db, {
        messageType: "interactive",
        source: "reply_interactive",
        content: JSON.stringify(interactive),
        responseBody: JSON.stringify({ messages: [{ id: `wamid.${tipo}` }] }),
      } as any);
      expect(r).toEqual({ recorded: true, metaMessageId: `wamid.${tipo}`, status: "accepted" });
      const row = db.tables.whatsapp_outbound_messages[0];
      expect(row.message_type).toBe("interactive");
      expect(row.source).toBe("reply_interactive");
      expect(row.meta_message_id).toBe(`wamid.${tipo}`);
      expect(row.status).toBe("accepted");
      expect(row.http_status).toBe(200);
      expect(row.user_id).toBe("user-1");
      const dump = JSON.stringify(row);
      expect(dump).not.toContain("Uber");
      expect(dump).not.toContain("Gastos");
      expect(dump).not.toContain("5511934600504");
    });
  }
  test("falha HTTP de interativa fica registrada sem id da Meta", async () => {
    const db = fakeDb();
    await send(db, {
      messageType: "interactive",
      source: "reply_interactive",
      content: "{}",
      ok: false,
      httpStatus: 400,
      responseBody: JSON.stringify({ error: { code: 131009 } }),
    } as any);
    const row = db.tables.whatsapp_outbound_messages[0];
    expect(row?.http_status).toBe(400);
    expect(row?.meta_message_id ?? null).toBe(null);
  });
});
