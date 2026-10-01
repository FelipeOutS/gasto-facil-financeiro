/**
 * 01/10/2026 — Confirmação de gasto com Confirmar / Ajustar / Cancelar.
 * Botão e texto passam pelo mesmo texto (replyIdToTexto) e pelo mesmo fluxo.
 */
import { test, expect, beforeEach, describe } from "bun:test";
import { resetState, gastosInserts, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { replyIdToTexto, buildInteractiveFromReply } = await import(
  "../src/server/whatsapp-interactive.server"
);

const tel = "5511999997777";
let seq = 0;
const send = (texto: string) =>
  processarMensagemWhatsApp({ telefone: tel, texto, external_id: `cac-${++seq}` });
const tap = (id: string, title = "") => send(replyIdToTexto(id, title));

beforeEach(() => {
  resetState({});
});

async function iniciar() {
  const r = await send("Gastei 12,60 no Uber em dinheiro");
  expect(r.status).toBe("aguardando_confirmacao");
  return r;
}

describe("confirmação", () => {
  test("mensagem mostra botões Confirmar/Ajustar/Cancelar e remove o fallback do corpo", async () => {
    const r = await iniciar();
    expect(r.resposta).toContain("Confere pra mim? 👀");
    expect(r.resposta).toContain("Posso registrar?");
    expect(r.resposta).not.toContain("Responda sim ou não");
    const ir = buildInteractiveFromReply(r.resposta);
    expect(ir?.type).toBe("button");
    if (ir?.type !== "button") return;
    expect(ir.buttons.map((b) => b.id)).toEqual(["expense_confirm", "expense_adjust", "expense_cancel"]);
    expect(ir.buttons.map((b) => b.title)).toEqual(["Confirmar", "Ajustar", "Cancelar"]);
    expect(ir.body).not.toContain("1. Confirmar");
    expect(ir.body.endsWith("Posso registrar?")).toBe(true);
  });

  test("16. fallback textual traz 1/2/3 quando não há botão", async () => {
    const r = await iniciar();
    expect(r.resposta).toContain("Responda:\n1. Confirmar\n2. Ajustar\n3. Cancelar");
  });

  test("1. Confirmar por botão salva uma vez", async () => {
    await iniciar();
    expect(gastosInserts()).toHaveLength(0); // 14
    const r = await tap("expense_confirm", "Confirmar");
    expect(r.status).toBe("salva");
    expect(r.resposta).toContain("Pronto! Seu gasto foi registrado ✅");
    expect(gastosInserts()).toHaveLength(1);
  });

  test("2. Confirmar por texto (confirmar / sim / pode registrar / 1)", async () => {
    for (const t of ["confirmar", "sim", "pode registrar", "1"]) {
      resetState({});
      await iniciar();
      const r = await send(t);
      expect(r.status).toBe("salva");
      expect(gastosInserts()).toHaveLength(1);
    }
  });

  test("15. toque repetido em Confirmar não duplica", async () => {
    await iniciar();
    await tap("expense_confirm");
    const r2 = await tap("expense_confirm");
    expect(r2.status).toBe("sem_pendencia");
    expect(gastosInserts()).toHaveLength(1);
  });

  test("15b. mesma mensagem reentregue (retry do webhook) não duplica", async () => {
    await iniciar();
    await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "retry-1" });
    const r = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "retry-1" });
    expect(["duplicada", "sem_pendencia"]).toContain(r.status);
    expect(gastosInserts()).toHaveLength(1);
  });

  test("3. Cancelar por botão não salva", async () => {
    await iniciar();
    const r = await tap("expense_cancel", "Cancelar");
    expect(r.status).toBe("cancelada");
    expect(r.resposta).toBe("Tudo certo, não registrei esse gasto.");
    expect(gastosInserts()).toHaveLength(0);
  });

  test("4. Cancelar por texto (não / deixa pra lá / 3)", async () => {
    for (const t of ["não", "deixa pra lá", "3"]) {
      resetState({});
      await iniciar();
      const r = await send(t);
      expect(r.status).toBe("cancelada");
      expect(gastosInserts()).toHaveLength(0);
    }
  });
});

describe("ajustar", () => {
  test("5. Ajustar por botão abre lista de campos e não salva", async () => {
    await iniciar();
    const r = await tap("expense_adjust", "Ajustar");
    expect(r.status).toBe("aguardando_ajuste_campo");
    expect(r.resposta).toContain("O que você quer ajustar?");
    const ir = buildInteractiveFromReply(r.resposta);
    expect(ir?.type).toBe("list");
    if (ir?.type !== "list") return;
    expect(ir.rows.map((x) => x.id)).toEqual([
      "expense_edit_description",
      "expense_edit_category",
      "expense_edit_value",
      "expense_edit_date",
      "expense_edit_payment",
    ]);
    expect(gastosInserts()).toHaveLength(0);
  });

  test("ajustar por texto também abre", async () => {
    await iniciar();
    expect((await send("ajustar")).status).toBe("aguardando_ajuste_campo");
  });

  test("6/11/12. descrição → volta à confirmação → confirmar salva com a nova descrição", async () => {
    await iniciar();
    await tap("expense_adjust");
    const q = await tap("expense_edit_description", "Descrição");
    expect(q.resposta).toBe("Qual deve ser a descrição?");
    const r = await send("Uber ida ao trabalho");
    expect(r.status).toBe("aguardando_confirmacao");
    expect(r.resposta).toContain("Confere pra mim? 👀");
    expect(r.resposta).toContain("Uber ida ao trabalho");
    expect(r.resposta).toMatch(/R\$\s12,60/);
    expect(r.resposta).toContain("Dinheiro");
    expect(gastosInserts()).toHaveLength(0);
    await tap("expense_confirm");
    const g = gastosInserts();
    expect(g).toHaveLength(1);
    expect(String(g[0].row.descricao)).toContain("Uber ida ao trabalho");
    expect(Number(g[0].row.valor)).toBe(12.6);
  });

  test("8. valor 13,20 preserva descrição, data e pagamento", async () => {
    await iniciar();
    await tap("expense_adjust");
    expect((await tap("expense_edit_value")).resposta).toContain("Qual é o valor correto?");
    const r = await send("13,20");
    expect(r.resposta).toMatch(/R\$\s13,20/);
    expect(r.resposta).toContain("Uber");
    expect(r.resposta).toContain("Dinheiro");
    await send("sim");
    expect(Number(gastosInserts()[0].row.valor)).toBe(13.2);
    expect(gastosInserts()[0].row.forma_pagamento).toBe("dinheiro");
  });

  test("valor inválido pergunta de novo sem perder a sessão", async () => {
    await iniciar();
    await send("2");
    await send("valor");
    const r = await send("não sei");
    // "não" cancela; texto sem número pede de novo
    expect(["cancelada", "aguardando_ajuste_valor"]).toContain(r.status);
    const r2 = await (async () => {
      resetState({});
      await iniciar();
      await send("2");
      await send("3");
      return send("abc");
    })();
    expect(r2.status).toBe("aguardando_ajuste_valor");
    expect(gastosInserts()).toHaveLength(0);
  });

  test("9. data aceita 15/08/2026 e ontem", async () => {
    await iniciar();
    await tap("expense_adjust");
    expect((await tap("expense_edit_date")).status).toBe("aguardando_ajuste_data");
    const r = await send("15/08/2026");
    expect(r.status).toBe("aguardando_confirmacao");
    expect(r.resposta).toContain("15/08/2026");
    await send("confirmar");
    expect(gastosInserts()[0].row.data).toBe("2026-08-15");

    resetState({});
    await iniciar();
    await send("ajustar");
    await send("data");
    expect((await send("ontem")).status).toBe("aguardando_confirmacao");
  });

  test("7. categoria abre o seletor atual e volta à confirmação", async () => {
    await iniciar();
    await tap("expense_adjust");
    const r = await tap("expense_edit_category", "Categoria");
    expect(r.status).toBe("aguardando_categoria_gasto");
    expect(r.resposta).toContain("Qual categoria devo usar?");
    const back = await send("1");
    expect(back.status).toBe("aguardando_confirmacao");
    expect(back.resposta).toContain("Categoria atualizada");
    expect(gastosInserts()).toHaveLength(0);
  });

  test("10. pagamento reusa a pergunta atual e volta à confirmação", async () => {
    await iniciar();
    await tap("expense_adjust");
    const r = await tap("expense_edit_payment", "Pagamento");
    expect(r.status).toBe("aguardando_forma_pagamento");
    expect(buildInteractiveFromReply(r.resposta)?.type).toBe("list");
    const back = await tap("payment_pix", "Pix");
    expect(back.status).toBe("aguardando_confirmacao");
    expect(back.resposta).toContain("Pix");
    await tap("expense_confirm");
    expect(gastosInserts()[0].row.forma_pagamento).toBe("pix");
  });

  test("13. cancelar depois de ajustar não salva", async () => {
    await iniciar();
    await tap("expense_adjust");
    await tap("expense_edit_value");
    await send("20");
    const r = await tap("expense_cancel");
    expect(r.status).toBe("cancelada");
    expect(gastosInserts()).toHaveLength(0);
  });

  test("cancelar no meio do ajuste não salva", async () => {
    await iniciar();
    await tap("expense_adjust");
    const r = await send("não");
    expect(r.status).toBe("cancelada");
    expect(gastosInserts()).toHaveLength(0);
  });
});
