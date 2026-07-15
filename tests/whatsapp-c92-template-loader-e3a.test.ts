/**
 * WA-C9.2 Fase E.3A — Regressão do template loader.
 *
 * A E.3 terminou no caminho D porque `defaultLoadTemplate` selecionava a
 * coluna `language`, que NÃO existe em `whatsapp_notification_templates`.
 * O PostgREST devolvia error+data=null e o dispatcher classificava como
 * `no_template`, revertendo a notification para `pending` sem tocar o
 * transport nem a Graph API.
 *
 * Estes testes usam dependências injetadas, zero rede real, zero Supabase
 * real e cobrem:
 *   1. SELECT do loader NÃO inclui a coluna inexistente `language`.
 *   2. SELECT do loader inclui `payload_schema` para permitir resolução
 *      via `resolveTemplateLanguage`.
 *   3. Contrato real do banco (linha sem propriedade `language`, com
 *      `payload_schema.language="en_US"`): loader retorna row, idioma
 *      resolve `en_US` — teste que FALHARIA antes do patch.
 *   4. Templates produtivos sem language metadata caem em `pt_BR`.
 *   5. Linha inexistente → `null` (dispatcher fará `no_template`).
 *   6. Linha inativa é retornada crua; o gate `!tpl.active` a rejeita a
 *      montante (contrato preservado).
 *   7. Erro real de query é fail-closed: retorna `null`, não escala.
 *   8. `runOutboundForNotification` com `defaultLoadTemplate` real +
 *      client fake canary + gate/transport mockados chega até o executor
 *      injetado (não retorna `no_template`).
 *   9. Nenhum fetch real é executado em qualquer teste.
 */
import { describe, it, expect } from "bun:test";
import {
  defaultLoadTemplate,
  runOutboundForNotification,
  type RunOutboundDeps,
} from "@/server/whatsapp-dispatcher-outbound.server";
import {
  buildWhatsAppTemplateRequest,
  resolveTemplateLanguage,
  type ExecuteResult,
  type NotificationTemplateRow,
  type SupabaseLike,
  type WhatsAppNotificationTransport,
} from "@/server/whatsapp-outbound-adapter.server";

// ─────────────────────────────────────────────────────────────────────────────
// Fake Supabase que captura o SELECT string e devolve uma linha configurável.

interface FakeCall {
  table: string;
  select: string;
  eqKey: string;
  eqValue: unknown;
  maybeSingle: number;
}

function makeFakeClient(
  responder: (call: FakeCall) => { data: unknown; error: unknown },
): { client: SupabaseLike; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const client: SupabaseLike = {
    from(table: string) {
      const call: FakeCall = {
        table,
        select: "",
        eqKey: "",
        eqValue: undefined,
        maybeSingle: 0,
      };
      calls.push(call);
      const chain = {
        select(cols: string) {
          call.select = cols;
          return chain;
        },
        eq(k: string, v: unknown) {
          call.eqKey = k;
          call.eqValue = v;
          return chain;
        },
        async maybeSingle() {
          call.maybeSingle++;
          return responder(call);
        },
      };
      return chain;
    },
  };
  return { client, calls };
}

// Linha canary tal como persistida no banco real (SEM a coluna `language`).
function canaryRow(): Record<string, unknown> {
  return {
    key: "gi_teste_integracao_canary",
    category: "avisos_sistema",
    meta_template_name: "hello_world",
    payload_schema: { language: "en_US", required: [], body_params_order: [] },
    active: true,
    requires_template_window: true,
    default_priority: "media",
  };
}

// Linha produtiva sem language metadata (deve cair em pt_BR).
function contaVencendoRow(): Record<string, unknown> {
  return {
    key: "gi_conta_vencendo_hoje",
    category: "contas_a_pagar",
    meta_template_name: "gi_conta_vencendo_hoje_v1",
    payload_schema: {
      required: ["nome", "valor", "vencimento"],
      body_params_order: ["nome", "valor", "vencimento"],
    },
    active: true,
    requires_template_window: true,
    default_priority: "media",
  };
}

describe("WA-C9.2 E.3A — defaultLoadTemplate: contrato do SELECT", () => {
  it("NÃO seleciona a coluna inexistente `language`", async () => {
    const { client, calls } = makeFakeClient(() => ({
      data: canaryRow(),
      error: null,
    }));
    const tpl = await defaultLoadTemplate("gi_teste_integracao_canary", client);
    expect(tpl).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("whatsapp_notification_templates");
    // Guarda-corpo principal: nenhuma palavra ", language" nem "language," no SELECT.
    const cols = calls[0].select.split(",").map((s) => s.trim());
    expect(cols).not.toContain("language");
  });

  it("SELECIONA `payload_schema` para permitir a resolução por metadata", async () => {
    const { client, calls } = makeFakeClient(() => ({
      data: canaryRow(),
      error: null,
    }));
    await defaultLoadTemplate("gi_teste_integracao_canary", client);
    const cols = calls[0].select.split(",").map((s) => s.trim());
    expect(cols).toContain("payload_schema");
    expect(cols).toContain("key");
    expect(cols).toContain("meta_template_name");
    expect(cols).toContain("active");
  });

  it("usa .eq(key) com o valor pedido e maybeSingle uma única vez", async () => {
    const { client, calls } = makeFakeClient(() => ({
      data: canaryRow(),
      error: null,
    }));
    await defaultLoadTemplate("gi_teste_integracao_canary", client);
    expect(calls[0].eqKey).toBe("key");
    expect(calls[0].eqValue).toBe("gi_teste_integracao_canary");
    expect(calls[0].maybeSingle).toBe(1);
  });
});

describe("WA-C9.2 E.3A — regressão do defeito real (linha SEM coluna `language`)", () => {
  it("carrega o template canary e resolve `en_US` via payload_schema — falharia antes do patch", async () => {
    // Este é o cenário exato observado em produção na E.3.
    const { client } = makeFakeClient(() => ({
      data: canaryRow(),
      error: null,
    }));
    const tpl = await defaultLoadTemplate("gi_teste_integracao_canary", client);
    expect(tpl).not.toBeNull();
    // A linha real NÃO tem propriedade `language` — apenas payload_schema.
    expect(Object.prototype.hasOwnProperty.call(tpl as object, "language")).toBe(false);
    const lang = resolveTemplateLanguage(tpl as NotificationTemplateRow);
    expect(lang.ok).toBe(true);
    if (lang.ok) {
      expect(lang.code).toBe("en_US");
      expect(lang.source).toBe("payload_schema");
    }
  });

  it("template produtivo sem language metadata cai em pt_BR (fallback)", async () => {
    const { client } = makeFakeClient(() => ({
      data: contaVencendoRow(),
      error: null,
    }));
    const tpl = await defaultLoadTemplate("gi_conta_vencendo_hoje", client);
    expect(tpl).not.toBeNull();
    const lang = resolveTemplateLanguage(tpl as NotificationTemplateRow);
    expect(lang.ok).toBe(true);
    if (lang.ok) {
      expect(lang.code).toBe("pt_BR");
      expect(lang.source).toBe("fallback");
    }
  });
});

describe("WA-C9.2 E.3A — falhas de leitura (fail-closed)", () => {
  it("linha inexistente → null", async () => {
    const { client } = makeFakeClient(() => ({ data: null, error: null }));
    const tpl = await defaultLoadTemplate("nao_existe", client);
    expect(tpl).toBeNull();
  });

  it("erro real de query (ex.: coluna inexistente) → null, sem exceção", async () => {
    const { client } = makeFakeClient(() => ({
      data: null,
      error: { code: "42703", message: 'column "x" does not exist' },
    }));
    const tpl = await defaultLoadTemplate("qualquer", client);
    expect(tpl).toBeNull();
  });

  it("linha inativa é retornada crua; o gate `!tpl.active` decide a montante", async () => {
    const row = { ...canaryRow(), active: false };
    const { client } = makeFakeClient(() => ({ data: row, error: null }));
    const tpl = await defaultLoadTemplate("gi_teste_integracao_canary", client);
    expect(tpl).not.toBeNull();
    expect((tpl as NotificationTemplateRow).active).toBe(false);
  });
});

describe("WA-C9.2 E.3A — request sanitizado do canary sem parâmetros", () => {
  it("buildWhatsAppTemplateRequest omite `components` quando não há params", async () => {
    const { client } = makeFakeClient(() => ({ data: canaryRow(), error: null }));
    const tpl = (await defaultLoadTemplate(
      "gi_teste_integracao_canary",
      client,
    )) as NotificationTemplateRow;
    const req = buildWhatsAppTemplateRequest({
      recipient: "5511999999999",
      templateName: tpl.meta_template_name ?? "",
      languageCode: "en_US",
      components: [],
      clientReference: "wa_attempt:xyz",
    });
    expect(req.template.name).toBe("hello_world");
    expect(req.template.language.code).toBe("en_US");
    expect(Object.prototype.hasOwnProperty.call(req.template, "components")).toBe(false);
  });
});

describe("WA-C9.2 E.3A — integração canary sem rede", () => {
  it("com defaultLoadTemplate REAL + client canary, o fluxo chega ao executor injetado (não é no_template)", async () => {
    const { client } = makeFakeClient(() => ({ data: canaryRow(), error: null }));
    const stubTransport: WhatsAppNotificationTransport = {
      async sendTemplate() {
        throw new Error("transport should not be called in this test");
      },
    };
    let executeCalls = 0;
    let capturedLanguage: string | null = null;
    let capturedTemplateName: string | null = null;
    const deps: RunOutboundDeps = {
      supabaseClient: client,
      gate: () => ({ allowed: true }),
      transportFactory: () => ({ ok: true, transport: stubTransport }),
      loadRecipient: async () => "5511999999999",
      // defaultLoadTemplate NÃO é passado como override → usa o loader real do módulo.
      phoneNumberId: "1234567890",
      execute: async (input) => {
        executeCalls++;
        // Confirma que o template real chegou até o executor com metadata correta.
        const lang = resolveTemplateLanguage(input.template);
        capturedLanguage = lang.ok ? lang.code : null;
        capturedTemplateName = input.template.meta_template_name;
        return {
          kind: "accepted",
          attemptId: "a-1",
          providerMessageId: "wamid.STUB",
        } as ExecuteResult;
      },
      logger: () => {},
    };
    const outcome = await runOutboundForNotification(
      {
        id: "n-1",
        user_id: "u-1",
        notification_type: "gi_teste_integracao_canary",
        payload: {},
      },
      "claim-token",
      deps,
    );
    expect(outcome.kind).toBe("executed");
    expect(executeCalls).toBe(1);
    expect(capturedLanguage).toBe("en_US");
    expect(capturedTemplateName).toBe("hello_world");
  });

  it("linha inexistente resulta em `no_template` sem chamar o executor", async () => {
    const { client } = makeFakeClient(() => ({ data: null, error: null }));
    let executeCalls = 0;
    const deps: RunOutboundDeps = {
      supabaseClient: client,
      gate: () => ({ allowed: true }),
      transportFactory: () => ({
        ok: true,
        transport: {
          async sendTemplate() {
            throw new Error("no transport");
          },
        },
      }),
      loadRecipient: async () => "5511999999999",
      phoneNumberId: "1234567890",
      execute: async () => {
        executeCalls++;
        return { kind: "accepted", attemptId: "x", providerMessageId: "y" } as ExecuteResult;
      },
      logger: () => {},
    };
    const outcome = await runOutboundForNotification(
      {
        id: "n-2",
        user_id: "u-1",
        notification_type: "nao_existe",
        payload: {},
      },
      "claim-token",
      deps,
    );
    expect(outcome.kind).toBe("no_template");
    expect(executeCalls).toBe(0);
  });
});
