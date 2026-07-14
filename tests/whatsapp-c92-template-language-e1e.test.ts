/**
 * WA-C9.2 Fase E.1E — Testes do resolvedor de idioma e do request sanitizado
 * do template Meta `hello_world`.
 *
 * Sem rede. Sem banco. Testa APENAS as funções puras do adapter D.1 depois
 * das alterações E.1E:
 *   - resolveTemplateLanguage: precedência override → payload_schema →
 *     template.language → fallback pt_BR.
 *   - fail-closed em locales inválidos.
 *   - buildWhatsAppTemplateRequest: omite `components` quando vazio.
 *   - forma canônica do request `hello_world` (en_US, sem components).
 */
import { describe, it, expect } from "bun:test";
import {
  SUPPORTED_TEMPLATE_LANGUAGES,
  buildWhatsAppTemplateRequest,
  resolveTemplateLanguage,
  type NotificationTemplateRow,
} from "@/server/whatsapp-outbound-adapter.server";

function tpl(overrides: Partial<NotificationTemplateRow> = {}): NotificationTemplateRow {
  return {
    key: "gi_teste_integracao_canary",
    category: "avisos_sistema",
    meta_template_name: "hello_world",
    payload_schema: { required: [], body_params_order: [], language: "en_US" },
    active: true,
    ...overrides,
  };
}

describe("resolveTemplateLanguage — precedência", () => {
  it("override válido vence tudo", () => {
    const r = resolveTemplateLanguage(tpl({ payload_schema: { language: "pt_BR" } }), "en_US");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.code).toBe("en_US");
      expect(r.source).toBe("override");
    }
  });

  it("payload_schema.language quando não há override", () => {
    const r = resolveTemplateLanguage(tpl());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.code).toBe("en_US");
      expect(r.source).toBe("payload_schema");
    }
  });

  it("template.language legado quando payload_schema ausente", () => {
    const r = resolveTemplateLanguage(
      tpl({ payload_schema: { required: [], body_params_order: [] }, language: "pt_BR" }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toBe("template_field");
  });

  it("fallback pt_BR quando nada é declarado", () => {
    const r = resolveTemplateLanguage(
      tpl({ payload_schema: { required: [], body_params_order: [] }, language: null }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.code).toBe("pt_BR");
      expect(r.source).toBe("fallback");
    }
  });

  it("legacy inválido cai em fallback pt_BR (não quebra produtivos)", () => {
    const r = resolveTemplateLanguage(
      tpl({ payload_schema: { required: [], body_params_order: [] }, language: "fr_FR" }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.code).toBe("pt_BR");
      expect(r.source).toBe("fallback");
    }
  });
});

describe("resolveTemplateLanguage — fail-closed", () => {
  it("string vazia → override_invalid", () => {
    const r = resolveTemplateLanguage(tpl(), "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("override_invalid");
  });

  it("locale desconhecido no override → override_invalid", () => {
    const r = resolveTemplateLanguage(tpl(), "es_ES");
    expect(r.ok).toBe(false);
  });

  it("controle chars no override → override_invalid", () => {
    const r = resolveTemplateLanguage(tpl(), "pt_BR\u0001");
    expect(r.ok).toBe(false);
  });

  it("valor não-string no override → override_invalid", () => {
    const r = resolveTemplateLanguage(tpl(), 123 as unknown as string);
    expect(r.ok).toBe(false);
  });

  it("locale inválido em payload_schema → payload_schema_invalid", () => {
    const r = resolveTemplateLanguage(tpl({ payload_schema: { language: "xx_YY" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("payload_schema_invalid");
  });

  it("payload_schema.language não-string → payload_schema_invalid", () => {
    const r = resolveTemplateLanguage(tpl({ payload_schema: { language: 42 as unknown as string } }));
    expect(r.ok).toBe(false);
  });

  it("locale com espaços/quebras → rejeitado", () => {
    const r = resolveTemplateLanguage(tpl({ payload_schema: { language: " pt_BR " } }));
    expect(r.ok).toBe(false);
  });
});

describe("SUPPORTED_TEMPLATE_LANGUAGES — invariantes", () => {
  it("expõe apenas pt_BR e en_US", () => {
    expect(SUPPORTED_TEMPLATE_LANGUAGES).toEqual(["pt_BR", "en_US"] as const);
  });
});

describe("buildWhatsAppTemplateRequest — components", () => {
  const base = {
    recipientDigits: "5511999999999",
    templateName: "hello_world",
    languageCode: "en_US",
    clientReference: "wa_attempt:abc",
  };

  it("omite components quando array vazio", () => {
    const req = buildWhatsAppTemplateRequest({ ...base, components: [] });
    expect("components" in req.template).toBe(false);
  });

  it("mantém components quando há parâmetros", () => {
    const req = buildWhatsAppTemplateRequest({
      ...base,
      components: [{ type: "body", parameters: [{ type: "text", text: "x" }] }],
    });
    expect(req.template.components?.length).toBe(1);
  });

  it("request hello_world é sanitizado (sem components, sem PII, callback data preservado)", () => {
    const req = buildWhatsAppTemplateRequest({ ...base, components: [] });
    expect(req).toEqual({
      messaging_product: "whatsapp",
      to: "5511999999999",
      type: "template",
      template: { name: "hello_world", language: { code: "en_US" } },
      biz_opaque_callback_data: "wa_attempt:abc",
    });
    const json = JSON.stringify(req);
    expect(json).not.toContain("Authorization");
    expect(json).not.toContain("Bearer");
    expect(json).not.toContain("access_token");
  });
});
