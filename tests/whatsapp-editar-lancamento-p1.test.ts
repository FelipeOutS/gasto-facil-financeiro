import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { detectEditarLancamentoExistente } = await import(
  "../src/server/whatsapp-editar-lancamento.server"
);

const tel = "5511999998888";
beforeEach(() => resetState());

function writes() {
  return state.inserts.filter((i) =>
    ["gastos", "receitas", "recorrencias", "contas_a_pagar"].includes(i.table),
  ).length;
}

test("detector reconhece edição de receita/gasto e ignora contas e criação", () => {
  expect(detectEditarLancamentoExistente("Quero editar uma receita de setembro de 2026")).toBe("receita");
  expect(detectEditarLancamentoExistente("alterar a despesa do mercado")).toBe("gasto");
  expect(detectEditarLancamentoExistente("corrigir gasto de agosto")).toBe("gasto");
  expect(detectEditarLancamentoExistente("editar conta de luz")).toBeNull();
  expect(detectEditarLancamentoExistente("recebi salario 3000")).toBeNull();
  expect(detectEditarLancamentoExistente("minhas receitas de setembro")).toBeNull();
  expect(detectEditarLancamentoExistente("gastei 50 no mercado")).toBeNull();
});

test("'Quero editar uma receita de setembro de 2026' não abre cadastro nem grava", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Quero editar uma receita de setembro de 2026",
    external_id: "edit-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("ainda não está disponível");
  expect(r.resposta.toLowerCase()).not.toContain("que tipo de renda");
  expect(writes()).toBe(0);
});

test("editar despesa antiga não cria gasto", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "quero alterar uma despesa de julho",
    external_id: "edit-2",
  });
  expect(r.status).toBe("consulta");
  expect(writes()).toBe(0);
});

test("cadastro de receita continua funcionando", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "quero lançar uma receita",
    external_id: "edit-3",
  });
  expect(r.resposta.toLowerCase()).not.toContain("ainda não está disponível");
});
