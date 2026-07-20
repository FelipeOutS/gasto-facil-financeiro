/**
 * WA-C11 4B.2.a — Suíte crítica: cliente Meta server-only.
 *
 * Cobre allowlist de URL, flags OFF (zero fetch), token em Bearer,
 * fingerprint estável, duplicidade local, dry-run explícito, timeout,
 * JSON inválido, erro sanitizado.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

const ENV_KEYS = [
  "WHATSAPP_META_MGMT_ENABLED",
  "WHATSAPP_META_SUBMISSION_ENABLED",
  "WHATSAPP_GRAPH_VERSION",
  "WHATSAPP_WABA_ID",
  "WHATSAPP_ACCESS_TOKEN",
] as const;
const backup: Record<string, string | undefined> = {};

function saveEnv() {
  for (const k of ENV_KEYS) backup[k] = process.env[k];
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (backup[k] === undefined) delete process.env[k];
    else process.env[k] = backup[k];
  }
}

function setBaselineOff() {
  process.env.WHATSAPP_META_MGMT_ENABLED = "false";
  process.env.WHATSAPP_META_SUBMISSION_ENABLED = "false";
  process.env.WHATSAPP_GRAPH_VERSION = "v20.0";
  process.env.WHATSAPP_WABA_ID = "1234567890";
  process.env.WHATSAPP_ACCESS_TOKEN = "test-token-xyz";
}

async function loadMgmt() {
  return await import("../src/server/whatsapp-meta-template-management.server");
}

beforeEach(() => {
  saveEnv();
  setBaselineOff();
});
afterEach(() => {
  restoreEnv();
});

const baseLocal = {
  id: "row-1",
  internal_key: "gi_conta_atrasada",
  meta_name: "gi_conta_atrasada_v1",
  language: "pt_BR",
  category: "UTILITY",
  version: 1,
  status: "draft",
  active: false,
  provider_template_id: null,
  notification_key: "gi_conta_atrasada",
  body: "Sua conta {{2}} venceu em {{1}}. Abra o app para regularizar.",
  footer: "Gasto Inteligente",
  placeholder_schema: {
    "1": { type: "date", format: "dd/mm/yyyy", required: true },
    "2": { type: "label", min: 1, max: 40, required: true, sanitize: true },
  },
  examples: {},
  components: null,
  last_synced_at: null,
  quality_score: null,
  rejection_reason: null,
  submitted_at: null,
  approved_at: null,
  rejected_at: null,
};

describe("WA-C11 4B.2.a — cliente Meta (URL builder)", () => {
  test("host fixo graph.facebook.com + versão v20.0 + WABA da env + path message_templates", async () => {
    const { buildMessageTemplatesUrl } = await loadMgmt();
    const r = buildMessageTemplatesUrl();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.url.startsWith("https://graph.facebook.com/v20.0/1234567890/message_templates")).toBe(true);
    }
  });

  test("WABA ausente → waba_missing (zero URL emitida)", async () => {
    delete process.env.WHATSAPP_WABA_ID;
    const { buildMessageTemplatesUrl } = await loadMgmt();
    const r = buildMessageTemplatesUrl();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("waba_missing");
  });

  test("WABA inválido (letras/símbolos) → waba_invalid", async () => {
    process.env.WHATSAPP_WABA_ID = "abc-not-numeric";
    const { buildMessageTemplatesUrl } = await loadMgmt();
    const r = buildMessageTemplatesUrl();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("waba_invalid");
  });

  test("versão Graph inválida → graph_config_error", async () => {
    process.env.WHATSAPP_GRAPH_VERSION = "latest";
    const { buildMessageTemplatesUrl } = await loadMgmt();
    const r = buildMessageTemplatesUrl();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("graph_config_error");
  });

  test("delete e send são NÃO IMPLEMENTADOS (throw) — superfície bloqueada", async () => {
    const mod = await loadMgmt();
    expect(() => mod.deleteRemoteTemplate()).toThrow(/not_implemented/);
    expect(() => mod.sendRemoteMessage()).toThrow(/not_implemented/);
  });
});

describe("WA-C11 4B.2.a — cliente Meta (flags OFF)", () => {
  test("MGMT OFF → listRemoteTemplates retorna disabled sem chamar fetchFn", async () => {
    const { listRemoteTemplates } = await loadMgmt();
    let called = 0;
    const fetchFn = ((..._args: unknown[]) => {
      called++;
      throw new Error("fetch must not be called");
    }) as unknown as typeof fetch;
    const r = await listRemoteTemplates({ fetchFn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
    expect(called).toBe(0);
  });

  test("MGMT OFF + prepareDryRun → disabled", async () => {
    const { prepareDryRun } = await loadMgmt();
    const r = prepareDryRun(baseLocal);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
  });

  test("SUBMISSION OFF → dry-run explícito com submission_enabled=false e remote_call_performed=false", async () => {
    process.env.WHATSAPP_META_MGMT_ENABLED = "true";
    process.env.WHATSAPP_META_SUBMISSION_ENABLED = "false";
    const { prepareDryRun } = await loadMgmt();
    const r = prepareDryRun(baseLocal);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dry_run).toBe(true);
      expect(r.submission_enabled).toBe(false);
      expect(r.remote_call_performed).toBe(false);
      expect(typeof r.fingerprint).toBe("string");
      expect(r.fingerprint.length).toBe(64);
    }
  });
});

describe("WA-C11 4B.2.a — cliente Meta (fetch com mock, flag ON)", () => {
  beforeEach(() => {
    process.env.WHATSAPP_META_MGMT_ENABLED = "true";
  });

  test("GET usa Authorization: Bearer <token> e nunca coloca token em URL", async () => {
    const { listRemoteTemplates } = await loadMgmt();
    let capturedUrl = "";
    let capturedAuth = "";
    const fetchFn = ((url: string, init: RequestInit) => {
      capturedUrl = url;
      const headers = init.headers as Record<string, string>;
      capturedAuth = headers.Authorization ?? "";
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    }) as unknown as typeof fetch;
    const r = await listRemoteTemplates({ fetchFn });
    expect(r.ok).toBe(true);
    expect(capturedAuth).toBe("Bearer test-token-xyz");
    expect(capturedUrl.includes("test-token-xyz")).toBe(false);
    expect(capturedUrl.startsWith("https://graph.facebook.com/v20.0/1234567890/message_templates")).toBe(true);
  });

  test("HTTP 400 → http_error com status; nenhum body persistido", async () => {
    const { listRemoteTemplates } = await loadMgmt();
    const fetchFn = ((..._args: unknown[]) =>
      Promise.resolve(new Response("boom", { status: 400 }))) as unknown as typeof fetch;
    const r = await listRemoteTemplates({ fetchFn });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("http_error");
      expect(r.status).toBe(400);
    }
  });

  test("JSON inválido → invalid_json", async () => {
    const { listRemoteTemplates } = await loadMgmt();
    const fetchFn = ((..._args: unknown[]) =>
      Promise.resolve(new Response("not json", { status: 200 }))) as unknown as typeof fetch;
    const r = await listRemoteTemplates({ fetchFn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_json");
  });

  test("AbortError → timeout", async () => {
    const { listRemoteTemplates } = await loadMgmt();
    const fetchFn = ((..._args: unknown[]) => {
      const e = new Error("aborted") as Error & { name: string };
      e.name = "AbortError";
      return Promise.reject(e);
    }) as unknown as typeof fetch;
    const r = await listRemoteTemplates({ fetchFn, timeoutMs: 1_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timeout");
  });

  test("fetchRemoteTemplateByName correlaciona por (name, language) e retorna template ou not_found", async () => {
    const { fetchRemoteTemplateByName } = await loadMgmt();
    const body = {
      data: [
        { name: "gi_conta_atrasada_v1", language: "pt_BR", status: "APPROVED", category: "UTILITY", id: "111" },
        { name: "hello_world", language: "en_US", status: "APPROVED", category: "UTILITY", id: "222" },
      ],
    };
    const fetchFn = ((..._args: unknown[]) =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))) as unknown as typeof fetch;
    const ok = await fetchRemoteTemplateByName("gi_conta_atrasada_v1", "pt_BR", { fetchFn });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.template.id).toBe("111");
    const miss = await fetchRemoteTemplateByName("gi_conta_atrasada_v1", "en_US", { fetchFn });
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.reason).toBe("not_found");
  });
});

describe("WA-C11 4B.2.a — fingerprint + duplicidade local + dry-run", () => {
  beforeEach(() => {
    process.env.WHATSAPP_META_MGMT_ENABLED = "true";
  });

  test("fingerprint é estável entre chamadas para o mesmo template", async () => {
    const { computeTemplateFingerprint } = await loadMgmt();
    const a = computeTemplateFingerprint({
      metaName: baseLocal.meta_name,
      language: baseLocal.language,
      category: baseLocal.category,
      body: baseLocal.body,
      footer: baseLocal.footer,
      components: baseLocal.components,
      placeholderSchema: baseLocal.placeholder_schema,
    });
    const b = computeTemplateFingerprint({
      metaName: baseLocal.meta_name,
      language: baseLocal.language,
      category: baseLocal.category,
      body: baseLocal.body,
      footer: baseLocal.footer,
      components: baseLocal.components,
      placeholderSchema: baseLocal.placeholder_schema,
    });
    expect(a).toBe(b);
    expect(a.length).toBe(64);
  });

  test("fingerprint muda quando o body muda", async () => {
    const { computeTemplateFingerprint } = await loadMgmt();
    const a = computeTemplateFingerprint({
      metaName: baseLocal.meta_name, language: baseLocal.language, category: baseLocal.category,
      body: "A", footer: null, components: null, placeholderSchema: null,
    });
    const b = computeTemplateFingerprint({
      metaName: baseLocal.meta_name, language: baseLocal.language, category: baseLocal.category,
      body: "B", footer: null, components: null, placeholderSchema: null,
    });
    expect(a).not.toBe(b);
  });

  test("duplicidade local detectada por (meta_name, language) → dry-run reprova", async () => {
    const { prepareDryRun } = await loadMgmt();
    const other = { ...baseLocal, id: "row-other" };
    const r = prepareDryRun(baseLocal, other);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate_local");
  });

  test("template não-draft ou já ativo → dry-run reprova", async () => {
    const { prepareDryRun } = await loadMgmt();
    expect(prepareDryRun({ ...baseLocal, status: "approved" }).ok).toBe(false);
    expect(prepareDryRun({ ...baseLocal, active: true }).ok).toBe(false);
  });

  test("evento fora da allowlist → dry-run reprova com not_allowed", async () => {
    const { prepareDryRun } = await loadMgmt();
    const r = prepareDryRun({ ...baseLocal, internal_key: "gi_teste_integracao_canary" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_allowed");
  });
});
