import { describe, it, expect, mock, beforeEach } from "bun:test";

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
mock.module("@/server/whatsapp-meta-template-management.server", () => ({
  prepareSubmissionPayload: () => ({ ok: true, payload: { name: "x" } }),
  buildMessageTemplatesUrl: () => ({ ok: true, url: "https://example.invalid/t" }),
}));
const { submitTemplateToMeta } = await import("@/server/whatsapp-meta-template-submission.server");
const { updatePlanQuota } = await import("@/server/whatsapp-quota-admin.server");

const local = { id: "t1", status: "draft", provider_template_id: null } as never;
const okFetch = (async () => new Response(JSON.stringify({ id: "meta-1", status: "PENDING" }), { status: 200 })) as unknown as typeof fetch;
const dbClient = (error: unknown) => ({ from: () => ({ update: () => ({ eq: async () => ({ error }) }) }) });

describe("C1 submissão de template Meta", () => {
  beforeEach(() => {
    process.env.WHATSAPP_META_SUBMISSION_ENABLED = "true";
    process.env.WHATSAPP_ACCESS_TOKEN = "fake";
  });
  it("falha de gravação local não é sucesso e devolve o id da Meta", async () => {
    const r = await submitTemplateToMeta(local, { fetchFn: okFetch, client: dbClient({ message: "x" }) });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe("persist_failed"); expect(r.provider_template_id).toBe("meta-1"); }
  });
  it("gravação ok → sucesso", async () => {
    const r = await submitTemplateToMeta(local, { fetchFn: okFetch, client: dbClient(null) });
    expect(r.ok).toBe(true);
  });
  it("Meta lenta → timeout", async () => {
    const slow = ((_u: string, init: RequestInit) => new Promise((_, rej) => {
      init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" })));
    })) as unknown as typeof fetch;
    const r = await submitTemplateToMeta(local, { fetchFn: slow, timeoutMs: 20, client: dbClient(null) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timeout");
  });
  it("erro da Meta com corpo não-JSON não lança", async () => {
    const bad = (async () => new Response("<html>", { status: 500 })) as unknown as typeof fetch;
    const r = await submitTemplateToMeta(local, { fetchFn: bad, client: dbClient(null) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("meta_error");
  });
});

describe("C2 concorrência em cotas", () => {
  function client(rowAfterUpdate: unknown) {
    const eqs: Array<[string, unknown]> = [];
    const current = { plan_code: "pessoal_premium", inbound_monthly_limit: 100, outbound_monthly_limit: 100,
      daily_inbound_limit: 10, daily_outbound_limit: 10, financial_actions_monthly_limit: 50, per_minute_limit: 5,
      enabled: true, updated_at: "2026-10-14T10:00:00Z" };
    const upd: any = { eq: (k: string, v: unknown) => { eqs.push([k, v]); return upd; },
      select: () => ({ maybeSingle: async () => ({ data: rowAfterUpdate, error: null }) }) };
    return { eqs, c: { from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: current, error: null }) }) }),
      update: () => upd,
      insert: async () => ({ error: null }),
    }) } };
  }
  it("edição concorrente (nenhuma linha com o updated_at lido) → conflict", async () => {
    const { c, eqs } = client(null);
    const r = await updatePlanQuota("pessoal_premium", { per_minute_limit: 6 }, { adminUserId: "a", reason: "ajuste teste" }, c);
    expect(r).toEqual({ ok: false, error: "conflict" });
    expect(eqs).toContainEqual(["updated_at", "2026-10-14T10:00:00Z"]);
  });
});
