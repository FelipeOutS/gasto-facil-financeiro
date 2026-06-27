/**
 * WA-C7.2.b — Cobertura da state machine completa de pagamento para pessoa.
 *
 * Cenários cobertos:
 *  1. Race condition de external_id (M-1) — dois webhooks paralelos com
 *     mesmo external_id criam apenas UM gasto. O segundo recebe resposta
 *     idempotente sem novo insert.
 *  2. M-2 (uma conta, valor bate) — sistema oferece sim/não/cancelar.
 *  3. M-2 (várias contas) — sistema lista numeradamente, "registrar novo"
 *     também é opção.
 *  4. M-2 (sim) — reusa baixa de conta (sem novo gasto).
 *  5. M-2 (não) — cria gasto avulso normalmente.
 *  6. Cancelar em qualquer passo encerra a sessão.
 *  7. Conversa gradual: "Paguei João" → "Quanto foi?" → "Motivo?" → ✅
 */
import "./_whatsapp-fake";
import { describe, it, expect, beforeEach } from "bun:test";
import { resetState, state } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);
const { _resetShortContext } = await import(
  "../src/server/whatsapp-short-context.server"
);

const telefone = "5511999998888";
const userId = "u1";

function gastoInserts() {
  return state.inserts.filter((i) => i.table === "gastos");
}

beforeEach(() => {
  resetState({});
  _resetShortContext();
});

describe("WA-C7.2.b :: M-1 race condition", () => {
  it("dois webhooks paralelos com mesmo external_id criam APENAS UM gasto", async () => {
    const [a, b] = await Promise.all([
      processarMensagemWhatsApp({
        telefone, texto: "paguei R$ 50 ao Carlos", external_id: "race-1",
      }),
      processarMensagemWhatsApp({
        telefone, texto: "paguei R$ 50 ao Carlos", external_id: "race-1",
      }),
    ]);
    // Exatamente um gasto criado, o outro recebe resposta neutra.
    expect(gastoInserts()).toHaveLength(1);
    const salvos = [a, b].filter((r) => r.status === "salva");
    const duplicadas = [a, b].filter((r) => r.status === "duplicada");
    expect(salvos.length).toBeGreaterThanOrEqual(1);
    expect(salvos.length + duplicadas.length).toBe(2);
  });

  it("retry sequencial com mesmo external_id devolve resposta idempotente", async () => {
    const a = await processarMensagemWhatsApp({
      telefone, texto: "paguei R$ 30 ao Pedro", external_id: "retry-1",
    });
    const b = await processarMensagemWhatsApp({
      telefone, texto: "paguei R$ 30 ao Pedro", external_id: "retry-1",
    });
    expect(a.status).toBe("salva");
    expect(b.status).toBe("duplicada");
    expect(gastoInserts()).toHaveLength(1);
  });
});

describe("WA-C7.2.b :: M-2 fluxo guiado", () => {
  it("uma conta + valor bate → pergunta sim/não/cancelar, NÃO cria gasto", async () => {
    resetState({
      contas: [{
        id: "c1", user_id: userId, nome: "Maria",
        valor: 12000, data_vencimento: "2026-07-10", status: "pendente",
      }],
    });
    state.linkData = {
      user_id: userId, telefone, ativo: true,
      opt_in_em: new Date().toISOString(), revogado_em: null,
    };

    const r = await processarMensagemWhatsApp({
      telefone, texto: "paguei R$ 120 ao Maria", external_id: "m2-a",
    });
    expect(r.status).toBe("pendente");
    expect(r.resposta).toMatch(/mesmo valor|conta\s+pendente/i);
    expect(r.resposta).toMatch(/1\.\s*Sim/i);
    expect(gastoInserts()).toHaveLength(0);
  });

  it("M-2: usuário responde '1' → reusa baixa (sem gasto novo)", async () => {
    resetState({
      contas: [{
        id: "c1", user_id: userId, nome: "Maria",
        valor: 12000, data_vencimento: "2026-07-10", status: "pendente",
      }],
    });
    state.linkData = {
      user_id: userId, telefone, ativo: true,
      opt_in_em: new Date().toISOString(), revogado_em: null,
    };
    await processarMensagemWhatsApp({
      telefone, texto: "paguei R$ 120 ao Maria", external_id: "m2-b1",
    });
    const r = await processarMensagemWhatsApp({
      telefone, texto: "1", external_id: "m2-b2",
    });
    // Não cria gasto avulso — a baixa de conta atualiza contas_a_pagar.
    expect(gastoInserts()).toHaveLength(0);
    expect(r.status === "salva" || r.status === "pendente").toBe(true);
  });

  it("M-2: usuário responde '2' → cria gasto avulso", async () => {
    resetState({
      contas: [{
        id: "c1", user_id: userId, nome: "Maria",
        valor: 12000, data_vencimento: "2026-07-10", status: "pendente",
      }],
    });
    state.linkData = {
      user_id: userId, telefone, ativo: true,
      opt_in_em: new Date().toISOString(), revogado_em: null,
    };
    await processarMensagemWhatsApp({
      telefone, texto: "paguei R$ 120 ao Maria", external_id: "m2-c1",
    });
    const r = await processarMensagemWhatsApp({
      telefone, texto: "2", external_id: "m2-c2",
    });
    expect(r.status).toBe("salva");
    expect(gastoInserts()).toHaveLength(1);
  });

  it("M-2: várias contas → lista numerada com opção 'novo gasto'", async () => {
    resetState({
      contas: [
        { id: "c1", user_id: userId, nome: "Maria Aluguel", valor: 50000, data_vencimento: "2026-07-10", status: "pendente" },
        { id: "c2", user_id: userId, nome: "Maria Internet", valor: 8900, data_vencimento: "2026-07-15", status: "pendente" },
      ],
    });
    state.linkData = {
      user_id: userId, telefone, ativo: true,
      opt_in_em: new Date().toISOString(), revogado_em: null,
    };
    const r = await processarMensagemWhatsApp({
      telefone, texto: "paguei R$ 500 ao Maria", external_id: "m2-d",
    });
    expect(r.status).toBe("pendente");
    expect(r.resposta).toMatch(/Qual delas/i);
    expect(r.resposta).toMatch(/1\.\s*Maria Aluguel/i);
    expect(r.resposta).toMatch(/2\.\s*Maria Internet/i);
    expect(r.resposta).toMatch(/3\.\s*Registrar novo gasto/i);
    expect(r.resposta).toMatch(/4\.\s*Cancelar/i);
    expect(gastoInserts()).toHaveLength(0);
  });

  it("M-2: 'cancelar' encerra sessão sem criar nada", async () => {
    resetState({
      contas: [{
        id: "c1", user_id: userId, nome: "Maria",
        valor: 12000, data_vencimento: "2026-07-10", status: "pendente",
      }],
    });
    state.linkData = {
      user_id: userId, telefone, ativo: true,
      opt_in_em: new Date().toISOString(), revogado_em: null,
    };
    await processarMensagemWhatsApp({
      telefone, texto: "paguei R$ 120 ao Maria", external_id: "m2-e1",
    });
    const r = await processarMensagemWhatsApp({
      telefone, texto: "cancelar", external_id: "m2-e2",
    });
    expect(r.status).toBe("cancelada");
    expect(gastoInserts()).toHaveLength(0);
  });
});

describe("WA-C7.2.b :: conversa gradual", () => {
  it("'Paguei João' → 'Quanto foi?' → '50' → 'lanche' → registra", async () => {
    const a = await processarMensagemWhatsApp({
      telefone, texto: "Paguei João", external_id: "g-1",
    });
    expect(a.status).toBe("pendente");
    expect(a.resposta).toMatch(/Quanto foi/i);

    const b = await processarMensagemWhatsApp({
      telefone, texto: "50", external_id: "g-2",
    });
    expect(b.status).toBe("pendente");
    expect(b.resposta).toMatch(/motivo|pular/i);

    const c = await processarMensagemWhatsApp({
      telefone, texto: "lanche", external_id: "g-3",
    });
    expect(c.status).toBe("salva");
    expect(gastoInserts()).toHaveLength(1);
    const row = gastoInserts()[0].row as Record<string, unknown>;
    expect(row.valor).toBe(5000);
    expect(row.estabelecimento).toBe("João");
  });

  it("'pular' na descrição registra sem motivo", async () => {
    await processarMensagemWhatsApp({
      telefone, texto: "Paguei Pedro", external_id: "g2-1",
    });
    await processarMensagemWhatsApp({
      telefone, texto: "80", external_id: "g2-2",
    });
    const r = await processarMensagemWhatsApp({
      telefone, texto: "pular", external_id: "g2-3",
    });
    expect(r.status).toBe("salva");
    expect(gastoInserts()).toHaveLength(1);
  });

  it("valor inválido pede de novo sem encerrar a sessão", async () => {
    await processarMensagemWhatsApp({
      telefone, texto: "Paguei Carlos", external_id: "g3-1",
    });
    const r = await processarMensagemWhatsApp({
      telefone, texto: "qualquer coisa", external_id: "g3-2",
    });
    expect(r.status).toBe("pendente");
    expect(r.resposta).toMatch(/Não entendi o valor/i);
    expect(gastoInserts()).toHaveLength(0);
  });
});
