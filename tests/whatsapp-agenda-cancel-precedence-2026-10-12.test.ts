/**
 * Pipeline completo (mocks): "cancelar lembrete" NÃO passa na frente de uma
 * confirmação pendente de gasto/cartão e não descarta o contexto.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const tel = "5511999998888";
const send = (texto: string, external_id: string) => processarMensagemWhatsApp({ telefone: tel, texto, external_id });

beforeEach(() => resetState());

for (const [nome, abre] of [
  ["gasto genérico aguardando valor", "registrar gasto"],
  ["gasto aguardando forma de pagamento", "gastei 50 no mercado"],
  ["gasto no crédito aguardando cartão", "gastei 80 no credito"],
] as const) {
  for (const cmd of ["cancelar lembrete", "concluir", "adiar para amanhã"]) {
    test(`${nome}: "${cmd}" não desvia para a agenda e mantém a sessão`, async () => {
      state.cartoesData = [
        { id: "c-nu", nome: "Nubank", user_id: "u1", ultimos_digitos: "1234" },
        { id: "c-it", nome: "Itau", user_id: "u1", ultimos_digitos: "9876" },
      ] as typeof state.cartoesData;
      await send(abre, "a1");
      const antes = state.pendingRow ? { status: state.pendingRow.status, parsed: JSON.stringify(state.pendingRow.parsed) } : null;
      expect(antes).not.toBeNull();
      const r = await send(cmd, "a2");
      expect(r.resposta).not.toMatch(/Qual item você quer|Qual lembrete quer adiar|lembretes ativos/);
      expect(state.pendingRow?.status).toBe(antes!.status);
      expect(JSON.stringify(state.pendingRow?.parsed)).toBe(antes!.parsed);
    });
  }
}

test("após o aviso, a sessão retoma normalmente com a resposta esperada", async () => {
  await send("registrar gasto", "b1");
  const r = await send("cancelar lembrete", "b2");
  expect(r.resposta).toContain("lançamento em andamento");
  const r3 = await send("Uber 30", "b3");
  expect(r3.resposta).not.toContain("lançamento em andamento");
  expect(state.pendingRow?.status).not.toBe("aguardando_descricao_e_valor_gasto");
});
