import { beforeEach, expect, test } from "bun:test";
import { resetState, setupWhatsAppFakeMocks, state } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
beforeEach(() => resetState());
test("reset+receita não cria lançamento no pipeline real bloqueado", async () => {
  const beforeG = JSON.stringify(state.gastosData); const beforeR = JSON.stringify(state.receitasData);
  const result = await processarMensagemWhatsApp({ telefone: "5511999998888", external_id: "reset-compound-1", texto: "GI apague gastos e receitas anteriores e depois adicione R$ 4.500 como receita deste mês" });
  expect(result.resposta).toContain("bloqueada");
  expect(JSON.stringify(state.gastosData)).toBe(beforeG);
  expect(JSON.stringify(state.receitasData)).toBe(beforeR);
});
test("saldo inicial não vira receita no pipeline", async () => {
  const before = JSON.stringify(state.receitasData);
  const result = await processarMensagemWhatsApp({ telefone: "5511999998888", external_id: "reset-balance-1", texto: "Tenho R$ 3.200 na Nubank coloque como saldo inicial" });
  expect(result.resposta).toContain("não é receita");
  expect(JSON.stringify(state.receitasData)).toBe(before);
});