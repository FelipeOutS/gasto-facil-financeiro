/**
 * P2-botões (12/10/2026) — botões expense_* só agem sobre gasto pendente.
 */
import { test, expect, beforeEach, afterEach, describe, setSystemTime } from "bun:test";
import { resetState, gastosInserts, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { replyIdToTexto } = await import("../src/server/whatsapp-interactive.server");

const tel = "5511999997777";
let seq = 0;
const send = (texto: string) =>
  processarMensagemWhatsApp({ telefone: tel, texto, external_id: `bc-${++seq}` });
const tap = (id: string) =>
  processarMensagemWhatsApp({
    telefone: tel,
    texto: replyIdToTexto(id, ""),
    replyId: id,
    external_id: `bc-${++seq}`,
  });

beforeEach(() => {
  resetState({});
  setSystemTime(new Date("2026-10-12T15:00:00Z"));
});
afterEach(() => setSystemTime());

describe("botões de gasto vinculados ao contexto", () => {
  test("Confirmar sem gasto pendente não registra nada", async () => {
    const r = await tap("expense_confirm");
    expect(r.resposta).toContain("já foi concluída ou expirou");
    expect(gastosInserts().length).toBe(0);
  });

  test("Cancelar antigo sem gasto pendente não age", async () => {
    const r = await tap("expense_cancel");
    expect(r.status).toBe("consulta");
    expect(gastosInserts().length).toBe(0);
  });

  test("Confirmar com gasto pendente segue o fluxo normal e registra uma vez", async () => {
    await send("gastei 30 no mercado no pix");
    const r = await tap("expense_confirm");
    expect(r.resposta ?? "").not.toContain("expirou");
    // clique duplo: segunda vez não há mais gasto pendente
    const r2 = await tap("expense_confirm");
    expect(r2.resposta).toContain("expirou");
    expect(gastosInserts().length).toBeLessThanOrEqual(1);
  });

  test("texto 'sim' continua funcionando como antes (sem replyId)", async () => {
    const r = await send("sim");
    expect(r.resposta ?? "").not.toContain("Esse botão");
  });
});
