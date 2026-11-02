/** P1 2026-10-14 — "minhas receitas de <mês> [de <ano>]" consulta e exibe o mês pedido. */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { detectMesNoTexto } = await import("../src/server/whatsapp-mes-nomeado");

const tel = "5511999998888";
const ano = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(new Date()));
const rec = (id: string, data: string, descricao: string, extra: Record<string, unknown> = {}) =>
  ({ id, user_id: "u1", descricao, tipo: "salario", valor: 1000, data, deleted_at: null, ...extra });
let n = 0;
const ask = async (texto: string) => (await processarMensagemWhatsApp({ telefone: tel, texto, external_id: `rp-${n++}` })).resposta;

beforeEach(() =>
  resetState({
    receitas: [
      rec("a", "2026-08-10", "Salario Agosto"),
      rec("s", "2026-09-05", "Freela Setembro"),
      rec("d", "2026-09-06", "Removida Setembro", { deleted_at: "2026-09-07T00:00:00Z" }),
      rec("j", "2025-01-15", "Bonus Janeiro 2025"),
      rec("x", "2026-08-11", "Outro Usuario", { user_id: "u2" }),
    ],
  }),
);

test("detector: mês/ano explícitos, sem ano, ambíguo, nenhum", () => {
  expect(detectMesNoTexto("Minhas receitas de agosto de 2026")).toEqual({ kind: "ok", month: 8, year: 2026, hadExplicitYear: true });
  expect(detectMesNoTexto("minhas receitas de dezembro")).toEqual({ kind: "ok", month: 12, year: ano, hadExplicitYear: false });
  expect(detectMesNoTexto("receitas de março 2025")).toEqual({ kind: "ok", month: 3, year: 2025, hadExplicitYear: true });
  expect(detectMesNoTexto("receitas de agosto e setembro").kind).toBe("ambiguo");
  expect(detectMesNoTexto("receitas de agosto de 1800").kind).toBe("ambiguo");
  expect(detectMesNoTexto("minhas receitas do mês").kind).toBe("nenhum");
});

test("sequência outubro → agosto → setembro usa o mês pedido (consulta e texto)", async () => {
  const out = await ask("Minhas receitas de outubro de 2026");
  expect(out).toContain("outubro de 2026");
  const ago = await ask("Minhas receitas de agosto de 2026");
  expect(ago).toContain("agosto de 2026");
  expect(ago).toContain("Salario Agosto");
  expect(ago).not.toContain("outubro");
  expect(ago).not.toContain("Outro Usuario");
  expect(ago).not.toContain("Freela");
  const set = await ask("Minhas receitas de setembro de 2026");
  expect(set).toContain("setembro de 2026");
  expect(set).toContain("Freela Setembro");
  expect(set).not.toContain("Removida");
  expect(set).not.toContain("Salario Agosto");
});

test("outro ano e mês sem receitas", async () => {
  expect(await ask("minhas receitas de janeiro de 2025")).toContain("Bonus Janeiro 2025");
  const jan26 = await ask("minhas receitas de janeiro de 2026");
  expect(jan26).toBe("Ainda não encontrei receitas registradas em janeiro de 2026.");
  expect(await ask("minhas receitas de dezembro de 2026")).toBe("Ainda não encontrei receitas registradas em dezembro de 2026.");
});

test("período ambíguo pede esclarecimento e não grava nada", async () => {
  const r = await ask("minhas receitas de agosto e setembro");
  expect(r).toContain("Não consegui identificar");
  expect(state.inserts.some((i) => i.table === "receitas" || i.table === "gastos")).toBe(false);
});
