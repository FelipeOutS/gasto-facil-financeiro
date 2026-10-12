/**
 * P2-botões (12/10/2026) — botões de gasto assinados e presos à sessão exata.
 * Só mocks; telefone e usuário fictícios.
 */
import { test, expect, beforeEach, afterEach, describe, setSystemTime } from "bun:test";
import { resetState, gastosInserts, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();
process.env.WHATSAPP_BOLETO_FINGERPRINT_SECRET = "test-secret-ficticio-0123456789abcdef";

const { processarMensagemWhatsApp, buscarVinculoBotaoGasto, EXPENSE_BUTTON_STALE } = await import(
  "../src/server/whatsapp.server"
);
const { replyIdToTexto, buildInteractiveFromReply } = await import(
  "../src/server/whatsapp-interactive.server"
);
const { signExpenseButton, verifyExpenseButton } = await import(
  "../src/server/expense-button-token.server"
);

const tel = "5511999998888";
const U = "u1";
let seq = 0;
const send = async (texto: string) => {
  const external_id = `bc-${++seq}`;
  const out = await processarMensagemWhatsApp({ telefone: tel, texto, external_id });
  return { out, external_id };
};
/** Simula o webhook: assina os botões com a sessão criada pela própria mensagem. */
async function abrirGasto(texto: string) {
  const { out, external_id } = await send(texto);
  const rowId = await buscarVinculoBotaoGasto(U, tel, external_id, out.resposta ?? "");
  const ir = buildInteractiveFromReply(out.resposta ?? "", rowId ? { userId: U, telefone: tel, rowId } : null);
  const ids = ir && ir.type === "button" ? ir.buttons.map((b) => b.id) : [];
  return { out, rowId, ids };
}
const tap = (id: string, telefone = tel) =>
  processarMensagemWhatsApp({
    telefone,
    texto: replyIdToTexto(id, ""),
    replyId: id,
    external_id: `bc-${++seq}`,
  });

beforeEach(() => {
  resetState({});
  setSystemTime(new Date("2026-10-12T15:00:00Z"));
});
afterEach(() => setSystemTime());

describe("token do botão de gasto", () => {
  test("cabe no limite da Graph e é verificável só pelo mesmo usuário/telefone", () => {
    const id = signExpenseButton("confirm", U, tel, "11111111-1111-1111-1111-111111111111")!;
    expect(id.length).toBeLessThanOrEqual(256);
    expect(verifyExpenseButton(id, U, tel).ok).toBe(true);
    expect(verifyExpenseButton(id, "u2", tel).ok).toBe(false);
    expect(verifyExpenseButton(id, U, "5511000000000").ok).toBe(false);
    const forjado = id.replace(/:[^:]+$/, ":AAAAAAAAAAAAAAAAAAAAAA");
    expect(verifyExpenseButton(forjado, U, tel).ok).toBe(false);
    const trocaAcao = id.replace("exp1:c:", "exp1:x:");
    expect(verifyExpenseButton(trocaAcao, U, tel).ok).toBe(false);
  });

  test("sem vínculo de sessão, nenhum botão genérico é emitido (só texto)", () => {
    const body = "Posso registrar?\n\nEscolha uma opção:\n1. ✅ Confirmar\n2. ✏️ Ajustar\n3. ❌ Cancelar";
    expect(buildInteractiveFromReply(body, null)).toBeNull();
  });
});

describe("botões vinculados à sessão exata", () => {
  test("botões recentes de A funcionam e geram uma única gravação", async () => {
    const a = await abrirGasto("gastei 30 no mercado no pix");
    expect(a.rowId).not.toBeNull();
    expect(a.ids.every((i) => i.startsWith("exp1:"))).toBe(true);
    const r = await tap(a.ids[0]);
    expect(r.resposta).not.toBe(EXPENSE_BUTTON_STALE);
    expect(gastosInserts().length).toBe(1);
    const r2 = await tap(a.ids[0]); // clique duplo
    expect(r2.resposta).toBe(EXPENSE_BUTTON_STALE);
    expect(gastosInserts().length).toBe(1);
  });

  test("A→B: botões antigos de A não afetam o gasto B pendente", async () => {
    const a = await abrirGasto("gastei 30 no mercado no pix");
    await send("não"); // cancela A por texto
    const b = await abrirGasto("gastei 45 na farmácia no pix");
    expect(b.rowId).not.toBe(a.rowId);
    for (const id of a.ids) {
      const r = await tap(id);
      expect(r.resposta).toBe(EXPENSE_BUTTON_STALE);
    }
    expect(gastosInserts().length).toBe(0);
    // B continua pendente e confirma pelo próprio botão.
    await tap(b.ids[0]);
    expect(gastosInserts().length).toBe(1);
  });

  test("Cancelar/Ajustar de A também não agem em B", async () => {
    const a = await abrirGasto("gastei 30 no mercado no pix");
    await send("não");
    const b = await abrirGasto("gastei 45 na farmácia no pix");
    await tap(a.ids[2]);
    await tap(a.ids[1]);
    const r = await send("sim");
    expect(r.out.resposta).not.toBe(EXPENSE_BUTTON_STALE);
    expect(gastosInserts().length).toBe(1);
    expect(b.ids.length).toBe(3);
  });

  test("botão genérico legado é recusado mesmo com gasto pendente", async () => {
    await abrirGasto("gastei 30 no mercado no pix");
    for (const id of ["expense_confirm", "expense_adjust", "expense_cancel"]) {
      expect((await tap(id)).resposta).toBe(EXPENSE_BUTTON_STALE);
    }
    expect(gastosInserts().length).toBe(0);
  });

  test("sem sessão: botão recusado sem gravar", async () => {
    const id = signExpenseButton("confirm", U, tel, "22222222-2222-2222-2222-222222222222")!;
    expect((await tap(id)).resposta).toBe(EXPENSE_BUTTON_STALE);
    expect(gastosInserts().length).toBe(0);
  });

  test("texto 'sim' digitado continua confirmando", async () => {
    await abrirGasto("gastei 30 no mercado no pix");
    const r = await send("sim");
    expect(r.out.resposta).not.toBe(EXPENSE_BUTTON_STALE);
    expect(gastosInserts().length).toBe(1);
  });

  test("botão de A não age em receita pendente nem vindo de outro telefone", async () => {
    const a = await abrirGasto("gastei 30 no mercado no pix");
    await send("não");
    await send("recebi 500 de salário");
    for (const id of a.ids) expect((await tap(id)).resposta).toBe(EXPENSE_BUTTON_STALE);
    const b = await abrirGasto("gastei 45 na farmácia no pix");
    const r = await tap(b.ids[0], "5511000000000");
    expect(r.resposta).not.toContain("registrado");
    expect(gastosInserts().length).toBe(0);
  });

  test("após Ajustar, a nova confirmação tem botões próprios e os de antes param", async () => {
    const a = await abrirGasto("gastei 30 no mercado no pix");
    await send("ajustar");
    await send("valor");
    const b = await abrirGasto("35");
    expect(b.ids.length).toBe(3);
    // Mesmo gasto (mesma sessão): os botões apontam para a mesma operação.
    expect(b.rowId).toBe(a.rowId);
    await tap(b.ids[0]);
    expect(gastosInserts().length).toBe(1);
  });
});
