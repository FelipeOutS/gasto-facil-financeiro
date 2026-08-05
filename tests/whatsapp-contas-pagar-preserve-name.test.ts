/**
 * WA-C3.2 — Preservar nome completo da conta ao extrair data de pagamento
 * e priorizar match exato sobre match parcial em findVencimentoByTerm.
 *
 * Cobre:
 *   - detector preserva nomes compostos ("conta de luz", "plano de saúde",
 *     "seguro do carro", "internet residencial", "aluguel do apartamento");
 *   - busca: exato > expressão completa > parcial;
 *   - termo curto ambíguo pede escolha;
 *   - frase com valor monetário continua sendo gasto comum;
 *   - conta de outro usuário nunca aparece;
 *   - regras de WA-C3 e WA-C3.1 preservadas (data futura, confirmação,
 *     update condicional, isolamento por user_id, recorrências).
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { detectMarkAsPaidIntent } = await import("../src/server/whatsapp-contas-pagar.server");
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { findVencimentoByTerm } = await import("../src/server/contas-vencimento.server");

function msg(texto: string, externalId = `ext-${Math.random().toString(36).slice(2, 10)}`) {
  return {
    external_id: externalId,
    telefone: "5511999998888",
    texto,
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
  } as const;
}

function makeConta(opts: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: opts.id ?? `c-${Math.random().toString(36).slice(2, 8)}`,
    user_id: opts.user_id ?? "u1",
    nome: opts.nome ?? "Internet",
    valor: opts.valor ?? 100,
    data_vencimento: opts.data_vencimento ?? "2026-07-05",
    status: opts.status ?? "pendente",
    data_pagamento: opts.data_pagamento ?? null,
    categoria_id: null,
    recorrente: false,
    frequencia_recorrencia: null,
    recorrencia_id: null,
    ...opts,
  };
}

describe("WA-C3.2 — detector preserva nome composto", () => {
  it("'a conta de luz foi paga ontem' → 'conta de luz'", () => {
    const r = detectMarkAsPaidIntent("a conta de luz foi paga ontem");
    expect(r?.termo).toBe("conta de luz");
    expect(r?.paymentDate).toBe("ontem");
  });

  it("'quitar plano de saude no dia 10' → 'plano de saude'", () => {
    const r = detectMarkAsPaidIntent("quitar plano de saude no dia 10");
    expect(r?.termo).toBe("plano de saude");
    expect(r?.paymentDate).toContain("dia 10");
  });

  it("'paguei seguro do carro ontem' → 'seguro do carro'", () => {
    const r = detectMarkAsPaidIntent("paguei seguro do carro ontem");
    expect(r?.termo).toBe("seguro do carro");
    expect(r?.paymentDate).toBe("ontem");
  });

  it("'paguei a internet residencial ontem' → 'internet residencial'", () => {
    const r = detectMarkAsPaidIntent("paguei a internet residencial ontem");
    expect(r?.termo).toBe("internet residencial");
    expect(r?.paymentDate).toBe("ontem");
  });

  it("'marcar aluguel do apartamento como pago dia 5' → 'aluguel do apartamento'", () => {
    const r = detectMarkAsPaidIntent("marcar aluguel do apartamento como pago dia 5");
    expect(r?.termo).toBe("aluguel do apartamento");
    expect(r?.paymentDate).toContain("dia 5");
  });

  it("'paguei a internet ontem' continua simples → 'internet'", () => {
    const r = detectMarkAsPaidIntent("paguei a internet ontem");
    expect(r?.termo).toBe("internet");
  });

  it("'marcar aluguel como pago' continua simples → 'aluguel'", () => {
    const r = detectMarkAsPaidIntent("marcar aluguel como pago");
    expect(r?.termo).toBe("aluguel");
  });
});

describe("WA-C3.2 — findVencimentoByTerm prioriza exato", () => {
  it("match exato vence parcial", async () => {
    resetState({
      contas: [
        makeConta({ id: "c-1", nome: "Conta de Luz" }),
        makeConta({ id: "c-2", nome: "Conta de Luz Casa Praia" }),
      ],
    });
    const rows = await findVencimentoByTerm("u1", "conta de luz");
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("c-1");
  });

  it("sem exato, casa por expressão (palavra inteira)", async () => {
    resetState({
      contas: [
        makeConta({ id: "c-1", nome: "Plano de Saúde Família" }),
        makeConta({ id: "c-2", nome: "Plano Funeral" }),
      ],
    });
    const rows = await findVencimentoByTerm("u1", "plano de saude");
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("c-1");
  });

  it("termo curto sem exato traz múltiplos (cabe ao chamador desambiguar)", async () => {
    resetState({
      contas: [
        makeConta({ id: "c-1", nome: "Plano de Saúde" }),
        makeConta({ id: "c-2", nome: "Plano Funeral" }),
      ],
    });
    const rows = await findVencimentoByTerm("u1", "plano");
    expect(rows.length).toBe(2);
  });
});

describe("WA-C3.2 — fluxo end-to-end com nome composto", () => {
  beforeEach(() =>
    resetState({
      contas: [
        makeConta({ id: "c-luz", nome: "Conta de Luz" }),
        makeConta({ id: "c-praia", nome: "Conta de Luz Casa Praia" }),
      ],
    }),
  );

  it("'a conta de luz foi paga ontem' baixa SÓ 'Conta de Luz' exata", async () => {
    const out1 = await processarMensagemWhatsApp(msg("a conta de luz foi paga ontem"));
    expect(out1.status).toBe("pendente");
    expect(out1.resposta).toContain("Encontrei esta conta pendente");
    expect(out1.resposta).toContain("Conta de Luz");
    expect(out1.resposta).not.toContain("Casa Praia");
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    const luz = state.contasData.find((c) => c.id === "c-luz");
    const praia = state.contasData.find((c) => c.id === "c-praia");
    expect(luz!.status).toBe("pago");
    expect(praia!.status).toBe("pendente");
  });

  it("'paguei a luz ontem' (termo curto, sem exato) pede escolha", async () => {
    const out = await processarMensagemWhatsApp(msg("paguei a luz ontem"));
    // Detector pode não casar com "luz" sozinho via pattern 1 (filler 'a'
    // removido, captura "luz" — válido). Há duas contas contendo "luz".
    expect(out.status).toBe("pendente");
    expect(out.resposta).toMatch(/Escolha uma|Encontrei esta conta pendente/);
    // Em nenhum caso pode ter dado baixa automática.
    const luz = state.contasData.find((c) => c.id === "c-luz");
    const praia = state.contasData.find((c) => c.id === "c-praia");
    expect(luz!.status).toBe("pendente");
    expect(praia!.status).toBe("pendente");
  });
});

describe("WA-C3.2 — segurança preservada", () => {
  it("conta de outro usuário nunca aparece, mesmo com nome composto", async () => {
    resetState({
      contas: [makeConta({ id: "c-z", user_id: "outro", nome: "Conta de Luz" })],
    });
    const out = await processarMensagemWhatsApp(msg("a conta de luz foi paga ontem"));
    expect(out.status).toBe("consulta");
    expect(state.contasData[0].status).toBe("pendente");
  });

  it("frase com valor monetário e nome composto continua sendo gasto comum", async () => {
    resetState({
      contas: [makeConta({ id: "c-luz", nome: "Conta de Luz" })],
    });
    const out = await processarMensagemWhatsApp(msg("paguei 89,90 na conta de luz ontem"));
    expect(out.resposta).not.toContain("Encontrei esta conta pendente");
    expect(state.contasData[0].status).toBe("pendente");
  });
});
