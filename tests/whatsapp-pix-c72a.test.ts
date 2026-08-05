/**
 * WA-C7.2.a — Consolidação de pagamento para pessoa.
 *
 * Cobre os três entregáveis desta fatia:
 *  - M-1 (idempotência): retry do webhook com mesmo external_id não cria
 *    um segundo gasto.
 *  - Atalho "Paguei.": após consultar Pix de alguém, "paguei 50" resolve
 *    o destinatário automaticamente via memória curta.
 *  - Integração mínima com Contas a Pagar: se existir conta pendente
 *    compatível com o nome, o sistema NÃO cria gasto solto e orienta o
 *    usuário a usar o fluxo de baixa.
 */
import "./_whatsapp-fake";
import { describe, it, expect, beforeEach } from "bun:test";
import { resetState, state, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { _resetShortContext } = await import("../src/server/whatsapp-short-context.server");

const telefone = "5511999998888";
const userId = "u1";

function gastoInserts() {
  return state.inserts.filter((i) => i.table === "gastos");
}

beforeEach(() => {
  resetState({});
  _resetShortContext();
});

describe("WA-C7.2.a :: M-1 idempotência", () => {
  it("retry do webhook com mesmo external_id NÃO duplica gasto", async () => {
    const msg = {
      telefone,
      texto: "paguei R$ 50 ao João",
      external_id: "ext-pp-1",
    };
    const r1 = await processarMensagemWhatsApp(msg);
    expect(r1.status).toBe("salva");
    expect(gastoInserts()).toHaveLength(1);

    const r2 = await processarMensagemWhatsApp(msg);
    expect(r2.status).toBe("duplicada");
    expect(gastoInserts()).toHaveLength(1);
  });

  it("pagamentos distintos com external_ids diferentes criam dois gastos", async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: "paguei R$ 50 ao João",
      external_id: "ext-a",
    });
    await processarMensagemWhatsApp({
      telefone,
      texto: "paguei R$ 30 ao Pedro",
      external_id: "ext-b",
    });
    expect(gastoInserts()).toHaveLength(2);
  });
});

describe("WA-C7.2.a :: atalho 'Paguei.' via memória curta", () => {
  it("'paguei 50' após consultar Pix do João vincula ao favorecido", async () => {
    resetState({
      favorecidos: [
        {
          id: "f1",
          user_id: userId,
          nome: "João",
          apelido: null,
          ativo: true,
          pix_key: "joao@example.com",
          pix_key_type: "email",
        },
      ],
    });

    // 1) Usuário consulta o Pix do João → memória curta registra "João".
    const consulta = await processarMensagemWhatsApp({
      telefone,
      texto: "qual o pix do João?",
      external_id: "ext-q",
    });
    expect(consulta.status).toBe("consulta");

    // 2) "paguei 50" sem repetir o nome → router reescreve para
    //    "paguei 50 João" e cria gasto vinculado.
    const pag = await processarMensagemWhatsApp({
      telefone,
      texto: "paguei 50",
      external_id: "ext-pp-2",
    });
    expect(pag.status).toBe("salva");
    const g = gastoInserts()[0].row as {
      valor: number;
      fornecedor_id: string | null;
    };
    expect(g.valor).toBe(50); // WA-Q-PixInline-Valor-Fix: reais, não centavos
    expect(g.fornecedor_id).toBe("f1");
  });

  it("'paguei 30 no mercado' NÃO usa memória curta (é gasto comum)", async () => {
    resetState({
      favorecidos: [
        {
          id: "f1",
          user_id: userId,
          nome: "João",
          apelido: null,
          ativo: true,
          pix_key: "x",
          pix_key_type: "email",
        },
      ],
    });
    await processarMensagemWhatsApp({
      telefone,
      texto: "qual o pix do João?",
      external_id: "ext-q",
    });
    // "no mercado" é sinal de estabelecimento → atalho não dispara,
    // segue para o parser de gasto comum (que vai pedir confirmação).
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "paguei 30 no mercado hoje no pix",
      external_id: "ext-mer",
    });
    expect(r.status).not.toBe("salva");
    expect(gastoInserts()).toHaveLength(0);
  });
});

describe("WA-C7.2.a :: M-2 aviso de colisão com Contas a Pagar", () => {
  it("'paguei R$ 120 ao Maria' com conta pendente para Maria NÃO cria gasto (fluxo guiado WA-C7.2.b)", async () => {
    resetState({
      contas: [
        {
          id: "c1",
          user_id: userId,
          nome: "Maria",
          valor: 12000,
          data_vencimento: "2026-07-10",
          status: "pendente",
        },
      ],
    });

    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "paguei R$ 120 ao Maria",
      external_id: "ext-col",
    });

    // WA-C7.2.b: agora o sistema entra em pp_aguardando_confirmar_conta
    // e pergunta sim/não/cancelar. Não cria gasto enquanto não houver
    // decisão explícita.
    expect(r.status).toBe("pendente");
    expect(r.resposta).toMatch(/conta\s+pendente|Maria/i);
    expect(r.resposta).toMatch(/1\.\s*Sim/i);
    expect(r.resposta).toMatch(/2\.\s*N[aã]o/i);
    expect(r.resposta).toMatch(/3\.\s*Cancelar/i);
    expect(gastoInserts()).toHaveLength(0);
  });

  it("sem conta pendente, o pagamento para pessoa segue normalmente", async () => {
    resetState({});
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "paguei R$ 80 ao Carlos",
      external_id: "ext-ok",
    });
    expect(r.status).toBe("salva");
    expect(gastoInserts()).toHaveLength(1);
  });
});
