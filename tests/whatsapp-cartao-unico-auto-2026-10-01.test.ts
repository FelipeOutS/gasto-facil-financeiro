/**
 * 01/10/2026 — Seleção automática quando o usuário tem exatamente 1 cartão.
 * 0 cartões → fluxo atual; 1 → automático; 2-3 → botões; 4+ → lista.
 */
import { test, expect, beforeEach, describe } from "bun:test";
import { resetState, gastosInserts, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { replyIdToTexto, buildInteractiveFromReply } = await import(
  "../src/server/whatsapp-interactive.server"
);

const tel = "5511999995555";
let seq = 0;
const send = (texto: string) =>
  processarMensagemWhatsApp({ telefone: tel, texto, external_id: `cu-${++seq}` });
const tap = (id: string) => send(replyIdToTexto(id, ""));

const card = (id: string, nome: string, d: string) => ({
  id, nome, user_id: "u1", ultimos_digitos: d, dia_fechamento: 25, dia_vencimento: 5,
});
const mp = card("c-mp", "Mercado Pago", "4321");
const nu = card("c-nu", "Nubank", "1234");
const it = card("c-it", "Itaú", "5555");
const c6 = card("c-c6", "C6", "6666");

async function escolherCredito() {
  await send("Gastei 15 no mercado");
  return tap("payment_credit");
}

describe("cartão único automático", () => {
  beforeEach(() => resetState({}));

  test("1. 0 cartões: mantém fluxo atual (pergunta, sem 'opção acima')", async () => {
    resetState({ cartoes: [] });
    const r = await escolherCredito();
    expect(r.status).toBe("aguardando_cartao");
    expect(r.resposta).not.toContain("escolha uma opção acima");
    expect(gastosInserts()).toHaveLength(0);
  });

  test("2/6/7/8/10. 1 cartão: seleciona sozinho e confirma mostrando o cartão", async () => {
    resetState({ cartoes: [mp] });
    const r = await escolherCredito();
    expect(r.status).toBe("aguardando_confirmacao");
    expect(r.resposta.startsWith("Certo! Vou usar seu cartão Mercado Pago. 💳")).toBe(true);
    expect(r.resposta).not.toContain("Qual cartão você usou");
    expect(r.resposta).not.toContain("escolha uma opção acima");
    expect(r.resposta).toContain("Mercado Pago");
    expect(buildInteractiveFromReply(r.resposta)?.type).toBe("button");
    expect(gastosInserts()).toHaveLength(0);
    const s = await tap("expense_confirm");
    expect(s.status).toBe("salva");
    expect(gastosInserts()).toHaveLength(1);
    expect(gastosInserts()[0].row.cartao_id).toBe("c-mp");
  });

  test("1 cartão também no texto direto 'no crédito'", async () => {
    resetState({ cartoes: [mp] });
    const r = await send("Mercado 50 no crédito");
    expect(r.status).toBe("aguardando_confirmacao");
    expect(r.resposta).toContain("Vou usar seu cartão Mercado Pago");
    expect(gastosInserts()).toHaveLength(0);
  });

  test("3. 2 cartões → botões", async () => {
    resetState({ cartoes: [mp, nu] });
    const r = await escolherCredito();
    expect(r.status).toBe("aguardando_cartao");
    expect(buildInteractiveFromReply(r.resposta)?.type).toBe("button");
  });

  test("4. 3 cartões → botões", async () => {
    resetState({ cartoes: [mp, nu, it] });
    const r = await escolherCredito();
    const ir = buildInteractiveFromReply(r.resposta);
    expect(ir?.type).toBe("button");
    if (ir?.type === "button") expect(ir.buttons).toHaveLength(3);
  });

  test("5. 4 cartões → lista", async () => {
    resetState({ cartoes: [mp, nu, it, c6] });
    const r = await escolherCredito();
    expect(buildInteractiveFromReply(r.resposta)?.type).toBe("list");
    expect(gastosInserts()).toHaveLength(0);
  });

  test("9. Ajustar → Pagamento → Cartão de crédito com 1 cartão: automático", async () => {
    resetState({ cartoes: [mp] });
    await send("Gastei 12,60 no Uber em dinheiro");
    await tap("expense_adjust");
    await tap("expense_edit_payment");
    const r = await tap("payment_credit");
    expect(r.status).toBe("aguardando_confirmacao");
    expect(r.resposta).toContain("Vou usar seu cartão Mercado Pago");
    expect(gastosInserts()).toHaveLength(0);
    expect((await tap("expense_confirm")).status).toBe("salva");
    expect(gastosInserts()).toHaveLength(1);
    expect(gastosInserts()[0].row.cartao_id).toBe("c-mp");
  });
});
