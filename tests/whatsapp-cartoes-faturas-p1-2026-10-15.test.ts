/**
 * P1 15/10/2026 — revisão de cartões e faturas pelo WhatsApp (fakes, sem Meta, sem banco real).
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { handleFaturaIntent } = await import("../src/server/whatsapp-faturas.server");
const { selecionarCartoesPorTermo, faturaCorrenteRef, cicloFatura } = await import("../src/server/cartao-fatura.server");
const { matchCartao } = await import("../src/server/whatsapp.server");
const { parcelasEmCentavos } = await import("../src/lib/parcelamento");
const { deliverReplyPlan } = await import("../src/server/whatsapp-reply-delivery.server");

const card = (id: string, nome: string, user_id = "u1", banco = "") => ({
  id, user_id, nome, banco, limite_total: 1000, dia_fechamento: 25, dia_vencimento: 5, cor: "#000",
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
});
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

describe("seleção de cartão por nome", () => {
  it("nome exato vence inclusão (Itaú x Itaú Visa)", () => {
    const cs = [card("a", "Itaú"), card("b", "Itaú Visa")];
    expect(selecionarCartoesPorTermo(cs, "itau visa").map((c) => c.id)).toEqual(["b"]);
    // "Itaú" também está contido em "Itaú Visa" → continua ambíguo (conservador).
    expect(selecionarCartoesPorTermo(cs, "Itaú").length).toBe(2);
  });
  it("sem exato, inclusão continua (Visa → Itaú Visa)", () => {
    expect(selecionarCartoesPorTermo([card("a", "Itaú"), card("b", "Itaú Visa")], "visa").map((c) => c.id)).toEqual(["b"]);
  });
  it("homônimos exatos continuam ambíguos (nunca escolhe sozinho)", () => {
    expect(selecionarCartoesPorTermo([card("a", "Nubank"), card("b", "nubank")], "Nubank").length).toBe(2);
  });
  it("lançamento: resposta igual ao nome escolhe esse cartão; homônimos ficam ambíguos", () => {
    const cs = [card("a", "Itaú"), card("b", "Itaú Visa")] as never[];
    expect((matchCartao("Itaú Visa", cs).match as { id: string } | null)?.id).toBe("b");
    const r = matchCartao("Nubank", [card("a", "Nubank"), card("b", "Nubank")] as never[]);
    expect(r.match).toBeNull();
    expect(r.ambiguous?.length).toBe(2);
  });
});

describe("consulta de fatura (pipeline simulado, só leitura)", () => {
  beforeEach(() => resetState({ cartoes: [card("a", "Nubank"), card("b", "Nubank"), card("x", "Nubank", "u2")] }));
  it("homônimos: ambíguo, sem número inventado e com orientação para sair do laço", async () => {
    const out = await handleFaturaIntent("u1", { kind: "invoice_card", termo: "Nubank" });
    expect(out.status).toBe("ambiguous_card");
    expect(out.resposta).toContain("mesmo nome");
    expect(out.resposta).not.toMatch(/R\$/);
  });
  it("cartão de outro usuário nunca entra na conta", async () => {
    resetState({ cartoes: [card("a", "Inter"), card("x", "Inter", "u2")] });
    state.gastosData = [
      { user_id: "u1", cartao_id: "a", valor: 10, data: hoje(), forma_pagamento: "credito", confirmado: true, invoice_month: null },
      { user_id: "u2", cartao_id: "x", valor: 999, data: hoje(), forma_pagamento: "credito", confirmado: true, invoice_month: null },
    ];
    const out = await handleFaturaIntent("u1", { kind: "invoice_card", termo: "Inter" });
    expect(out.status).toBe("answered");
    expect(out.resposta).not.toContain("999");
  });
  it("nome distinto (Itaú Visa) responde direto em vez de ambíguo", async () => {
    resetState({ cartoes: [card("a", "Itaú"), card("b", "Itaú Visa")] });
    state.gastosData = [{ user_id: "u1", cartao_id: "b", valor: 40, data: hoje(), forma_pagamento: "credito", confirmado: true, invoice_month: null }];
    const out = await handleFaturaIntent("u1", { kind: "invoice_card", termo: "Itaú Visa" });
    expect(out.status).toBe("answered");
    expect(out.resposta).toContain("Itaú Visa");
  });
});

describe("ciclo e parcelas (regras existentes)", () => {
  it("compra no dia do fechamento fica na fatura do mês; dia seguinte vai para a próxima", () => {
    expect(faturaCorrenteRef(25, new Date(2026, 8, 25))).toEqual({ mes: 8, ano: 2026 });
    expect(faturaCorrenteRef(25, new Date(2026, 8, 26))).toEqual({ mes: 9, ano: 2026 });
  });
  it("virada de ano: 10/01/2027 com fechamento 25 → fatura de 12/2026", () => {
    expect(faturaCorrenteRef(25, new Date(2027, 0, 10))).toEqual({ mes: 12, ano: 2026 });
    const c = cicloFatura(25, 12, 2026);
    expect(c.inicio.getFullYear()).toBe(2026);
    expect(c.fim.getFullYear()).toBe(2027);
  });
  it("100,00 em 3 → 33,34 + 33,33 + 33,33 (soma exata)", () => {
    const p = parcelasEmCentavos(100, 3);
    expect(p).toEqual([3334, 3333, 3333]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(10000);
  });
});

describe("envio do formulário de cartão (Meta simulada)", () => {
  const ok = async () => ({ sent: true, status: 200 });
  for (const status of [429, 500, 503]) {
    it(`${status} no interativo: ambíguo, nada de texto por cima`, async () => {
      let texto = 0;
      const r = await deliverReplyPlan(async () => ({ sent: false, status }), async () => { texto++; return ok(); });
      expect(r.outcome).toBe("ambiguous");
      expect(texto).toBe(0);
    });
  }
  it("exceção de rede no interativo: ambíguo, sem texto", async () => {
    let texto = 0;
    const r = await deliverReplyPlan(async () => { throw new Error("net"); }, async () => { texto++; return ok(); });
    expect(r.outcome).toBe("ambiguous");
    expect(texto).toBe(0);
  });
  it("400 (recusa explícita) → texto da conversa, uma vez", async () => {
    let texto = 0;
    const r = await deliverReplyPlan(async () => ({ sent: false, status: 400 }), async () => { texto++; return ok(); });
    expect(r.channel).toBe("text");
    expect(texto).toBe(1);
  });
  it("200 = aceito (não 'entregue')", async () => {
    const r = await deliverReplyPlan(ok, ok);
    expect(r.outcome).toBe("accepted");
  });
});
