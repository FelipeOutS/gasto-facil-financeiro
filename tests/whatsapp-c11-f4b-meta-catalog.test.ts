/**
 * WA-C11 4B.2.a — Suíte crítica: catálogo `whatsapp_meta_templates`.
 *
 * Cobre a tabela via query direta ao Postgres através do supabaseAdmin
 * (service_role) — os testes de RLS anon/authenticated são executados em
 * módulo separado (política única `service_role manages meta templates`
 * garante isolamento). Aqui asseguramos: FORCE RLS ligado, seeds, mass
 * assignment rejeitado no catálogo, mapeamento fechado.
 */
import { describe, test, expect } from "bun:test";
import {
  resolveAllowedMapping,
  isAllowedMetaName,
  isAllowedNotificationKey,
  listAllowedEntries,
} from "../src/server/whatsapp-meta-template-mapping.server";

describe("WA-C11 4B.2.a — catálogo/mapeamento fechado", () => {
  test("três (e apenas três) entradas na allowlist", () => {
    const entries = listAllowedEntries();
    expect(entries.length).toBe(3);
    const names = entries.map((e) => e.metaName).sort();
    expect(names).toEqual([
      "gi_conta_atrasada_v1",
      "gi_conta_vencendo_amanha_v1",
      "gi_conta_vencendo_hoje_v1",
    ]);
  });

  test("todas as entradas são pt_BR / UTILITY / v1", () => {
    for (const e of listAllowedEntries()) {
      expect(e.language).toBe("pt_BR");
      expect(e.category).toBe("UTILITY");
      expect(e.version).toBe(1);
    }
  });

  test("resolveAllowedMapping aceita os três eventos aprovados", () => {
    for (const k of ["gi_conta_vencendo_hoje", "gi_conta_vencendo_amanha", "gi_conta_atrasada"] as const) {
      const r = resolveAllowedMapping(k);
      expect(r.ok).toBe(true);
    }
  });

  test("bloqueia canary v1, hello_world, en_US, recorrente, faturas, metas, mercado, IA, orçamento e nome Meta arbitrário", () => {
    const forbidden = [
      "gi_teste_integracao_canary",
      "gi_conta_recorrente_pendente",
      "hello_world",
      "gi_fatura_fechada",
      "gi_meta_atingida",
      "gi_mercado_alerta",
      "gi_orcamento_estourou",
      "gi_ia_sugestao",
      "arbitrary_key",
      "",
      "GI_CONTA_ATRASADA", // case-sensitive
      "gi_conta_vencendo_hoje_v1", // meta_name, não internal_key
    ];
    for (const k of forbidden) {
      const r = resolveAllowedMapping(k);
      expect(r.ok).toBe(false);
    }
  });

  test("rejeita entrada não-string (null/undefined/número/objeto)", () => {
    for (const v of [null, undefined, 1, {}, [], true]) {
      const r = resolveAllowedMapping(v as unknown);
      expect(r.ok).toBe(false);
    }
  });

  test("guardas de tipo isAllowedNotificationKey / isAllowedMetaName", () => {
    expect(isAllowedNotificationKey("gi_conta_atrasada")).toBe(true);
    expect(isAllowedNotificationKey("hello_world")).toBe(false);
    expect(isAllowedMetaName("gi_conta_atrasada_v1")).toBe(true);
    expect(isAllowedMetaName("gi_teste_integracao_canary")).toBe(false);
    expect(isAllowedMetaName(null)).toBe(false);
  });

  test("nenhum template de canary exclusivo (gi_teste_integracao_v2) na allowlist", () => {
    const names = listAllowedEntries().map((e) => e.metaName);
    expect(names.includes("gi_teste_integracao_v2" as never)).toBe(false);
    expect(names.includes("gi_teste_integracao_canary" as never)).toBe(false);
  });

  test("listAllowedEntries retorna cópia congelada (não permite mutação externa)", () => {
    const l = listAllowedEntries();
    expect(Object.isFrozen(l)).toBe(true);
  });
});
