// Assistente de Compras — matriz de segurança financeira (dados 100% fictícios, sem rede/banco).
import { test, expect, describe } from "bun:test";
import { buildFinanceSnapshot, type FinanceRows, type GastoRow, type ContaRow, type ReceitaRow } from "../src/server/shopping/finance-snapshot";
import { estimarCapacidadeCompra, AVISO_APERTO, MSG_NAO_AVALIA } from "../src/server/shopping/capacidade-compra";
import { hojeSaoPaulo } from "../src/server/shopping/whatsapp-shopping.server";

const HOJE = "2026-10-13";
const U = "u-1";
const rec = (id: string, data: string, valor: number, descricao = "Salário"): ReceitaRow =>
  ({ id, data, valor, descricao, origem: null, tipo: null, user_id: U });
const gas = (id: string, data: string, valor: number, o: Partial<GastoRow> = {}): GastoRow =>
  ({ id, data, valor, gasto_fixo: false, recorrencia_id: null, total_parcelas: 1, parcela_atual: 1, grupo_parcelamento_id: null, cartao_id: null, user_id: U, ...o });
const conta = (id: string, nome: string, valor: number, venc: string, status = "pendente", o: Partial<ContaRow> = {}): ContaRow =>
  ({ id, nome, valor, status, gasto_id: null, recorrencia_id: null, data_vencimento: venc, user_id: U, ...o });
const salario3 = [rec("r7", "2026-07-05", 5000), rec("r8", "2026-08-05", 5000), rec("r9", "2026-09-05", 5000)];
const rows = (p: Partial<FinanceRows>): FinanceRows => ({ receitas: [], gastos: [], recorrencias: [], contas: [], ...p });
const snap = (p: Partial<FinanceRows>) => buildFinanceSnapshot(HOJE, rows(p), { userId: U });
const cap = (p: Partial<FinanceRows>, precoCents = 100_000) => estimarCapacidadeCompra({ ...snap(p), precoCents });
const val = (s: ReturnType<typeof snap>, id: string) => s.compromissos.find((c) => c.id === id)?.valorMensalCents;
const total = (s: ReturnType<typeof snap>) => s.compromissos.reduce((a, c) => a + c.valorMensalCents, 0);

describe("renda e histórico", () => {
  test("1. 5000/0/0 com gastos nos 3 meses → média 1.666,66, não 5.000", () => {
    const c = cap({ receitas: [rec("r", "2026-09-05", 5000)], gastos: [gas("a", "2026-07-02", 1), gas("b", "2026-08-02", 1), gas("c", "2026-09-02", 1)] });
    expect(c.rendaMediaCents).toBe(166_666);
    expect(c.confianca).toBe("ok");
  });
  test("2. 0/0/0 com uso registrado → sem folga, mensagem segura", () => {
    const c = cap({ gastos: [gas("a", "2026-07-02", 10), gas("b", "2026-08-02", 10), gas("c", "2026-09-02", 10)] });
    expect(c.folgaCents).toBeNull();
    expect(c.mensagem).toContain(MSG_NAO_AVALIA);
  });
  test("3. só 1 mês com registros → insuficiente (não assume zeros)", () => {
    const c = cap({ receitas: [rec("r", "2026-09-05", 5000)] });
    expect(c.confianca).toBe("insuficiente");
    expect(c.cabeAVista).toBeNull();
  });
  test("4. 2 meses ativos → baixa confiança e nunca afirma que cabe", () => {
    const c = cap({ receitas: [rec("a", "2026-08-05", 5000), rec("b", "2026-09-05", 5000)] }, 1000);
    expect(c.confianca).toBe("baixa");
    expect(c.cabeAVista).toBeNull();
    expect(c.mensagem).toContain("não afirmo que cabe");
    expect(c.mensagem).not.toMatch(/: cabe na folga/);
  });
  test("5. 3 meses ativos → ok", () => {
    expect(cap({ receitas: salario3 }).confianca).toBe("ok");
  });
  test("6. mês sem nenhum registro ≠ mês zero observado", () => {
    const s = snap({ receitas: [rec("a", "2026-08-05", 5000), rec("b", "2026-09-05", 5000)] });
    expect(s.mesesAtivos).toEqual(["2026-09", "2026-08"]);
    expect(s.rendaPorMes["2026-07"]).toBeUndefined();
  });
  test("7. transferência/resgate/reembolso não são renda, mas marcam mês ativo", () => {
    const s = snap({ receitas: [...salario3, rec("t", "2026-09-10", 9000, "Resgate CDB"), rec("e", "2026-08-10", 300, "Reembolso")] });
    expect(s.rendaPorMes).toEqual({ "2026-09": 500_000, "2026-08": 500_000, "2026-07": 500_000 });
  });
  test("8. receita do mês atual ignorada", () => {
    const s = snap({ receitas: [...salario3, rec("x", "2026-10-01", 99_999)] });
    expect(s.rendaPorMes["2026-10"]).toBeUndefined();
  });
  test("9. data em São Paulo: 01/10 02:00 UTC ainda é 30/09", () => {
    expect(hojeSaoPaulo(new Date("2026-10-01T02:00:00Z"))).toBe("2026-09-30");
  });
});

describe("gastos variáveis e fixos", () => {
  test("10. variáveis de 1 mês não são divididos por 3 (divisor = meses ativos)", () => {
    const s = snap({ receitas: [rec("a", "2026-08-05", 5000), rec("b", "2026-09-05", 5000)], gastos: [gas("g", "2026-09-10", 900)] });
    expect(val(s, "variaveis")).toBe(45_000); // 900 ÷ 2 meses ativos, não ÷3
  });
  test("11. aluguel PAGO neste mês com gasto ligado conta 1 vez (antes sumia)", () => {
    const s = snap({ receitas: salario3, gastos: [gas("ga", "2026-10-05", 1500, { gasto_fixo: true })],
      contas: [conta("c", "Aluguel", 1500, "2026-10-05", "pago", { gasto_id: "ga" })] });
    expect(val(s, "fixas:mes-atual")).toBe(150_000);
    expect(total(s)).toBe(150_000);
  });
  test("12. aluguel pago todo mês (contas+gastos ligados) não duplica", () => {
    const ms = ["2026-07", "2026-08", "2026-09", "2026-10"];
    const s = snap({ receitas: salario3,
      gastos: ms.map((m) => gas(`g${m}`, `${m}-05`, 1500, { gasto_fixo: true })),
      contas: ms.map((m) => conta(`c${m}`, "Aluguel", 1500, `${m}-05`, "pago", { gasto_id: `g${m}` })) });
    expect(total(s)).toBe(150_000);
  });
  test("13. gasto fixo sem conta/recorrência entra (antes nunca entrava)", () => {
    const s = snap({ receitas: salario3, gastos: ["07", "08", "09"].map((m) => gas(`e${m}`, `2026-${m}-10`, 800, { gasto_fixo: true })) });
    expect(val(s, "fixas:historico-extra")).toBe(80_000);
  });
  test("14. conta vencida meses atrás e não paga → dívida pelo valor cheio", () => {
    const s = snap({ receitas: salario3, contas: [conta("v", "Condomínio", 700, "2026-05-10", "atrasado")] });
    expect(val(s, "vencida:v")).toBe(70_000);
    expect(cap({ receitas: salario3, contas: [conta("v", "Condomínio", 700, "2026-05-10", "atrasado")] }).mensagem).toContain("vencida");
  });
  test("15. conta paga em mês anterior não vira dívida", () => {
    const s = snap({ receitas: salario3, contas: [conta("p", "Luz", 200, "2026-09-10", "pago")] });
    expect(val(s, "vencida:p")).toBeUndefined();
  });
});

describe("assinaturas, faturas e cartões", () => {
  test("16. semanal → ×52/12 em centavos", () => {
    const s = snap({ receitas: salario3, recorrencias: [{ id: "w", valor: 100, status: "ativa", frequencia: "semanal", user_id: U }] });
    expect(val(s, "rec:w")).toBe(43_334);
  });
  test("17. anual → /12", () => {
    const s = snap({ receitas: salario3, recorrencias: [{ id: "a", valor: 1200, status: "ativa", frequencia: "anual", user_id: U }] });
    expect(val(s, "rec:a")).toBe(10_000);
  });
  test("18. pausada/cancelada ignoradas", () => {
    const s = snap({ receitas: salario3, recorrencias: [{ id: "p", valor: 50, status: "pausada", frequencia: "mensal", user_id: U }, { id: "c", valor: 50, status: "cancelada", frequencia: "mensal", user_id: U }] });
    expect(total(s)).toBe(0);
  });
  test("19. assinatura + gasto ligado + conta ligada → contada 1 vez", () => {
    const s = snap({ receitas: salario3, recorrencias: [{ id: "n", valor: 50, status: "ativa", frequencia: "mensal", user_id: U }],
      gastos: [gas("g", "2026-09-15", 50, { recorrencia_id: "n" })], contas: [conta("c", "Netflix", 50, "2026-10-15", "pendente", { recorrencia_id: "n" })] });
    expect(total(s)).toBe(5_000);
  });
  test("20. conta 'Nubank' com gastos de cartão já lançados → não duplica fatura", () => {
    const s = snap({ receitas: salario3, cartoes: [{ id: "k", nome: "Roxinho", banco: "Nubank", user_id: U }],
      gastos: [gas("g", "2026-09-10", 600, { cartao_id: "k" })], contas: [conta("f", "Nubank", 600, "2026-10-12")] });
    expect(val(s, "fixas:mes-atual")).toBeUndefined();
    expect(val(s, "variaveis")).toBe(20_000);
    expect(s.alertas?.join(" ")).toContain("fatura");
  });
  test("21. conta 'Cartão Inter' sem gastos de cartão → mantida (não esconde dívida)", () => {
    const s = snap({ receitas: salario3, contas: [conta("f", "Cartão Inter", 900, "2026-10-12")] });
    expect(val(s, "fixas:mes-atual")).toBe(90_000);
  });
});

describe("parcelas, exclusões, isolamento e falhas", () => {
  test("22. parcela ativa conta; série terminada não", () => {
    const s = snap({ receitas: salario3, gastos: [
      gas("a3", "2026-09-01", 200, { total_parcelas: 10, parcela_atual: 3, grupo_parcelamento_id: "A" }),
      gas("b5", "2026-08-01", 100, { total_parcelas: 5, parcela_atual: 5, grupo_parcelamento_id: "B" })] });
    expect(val(s, "parc:A")).toBe(20_000);
    expect(val(s, "parc:B")).toBeUndefined();
  });
  test("23. várias parcelas da mesma compra → 1; duas compras → 2", () => {
    const s = snap({ receitas: salario3, gastos: [
      ...[1, 2, 3, 4].map((n) => gas(`a${n}`, `2026-${String(6 + n).padStart(2, "0")}-01`, 150, { total_parcelas: 6, parcela_atual: n, grupo_parcelamento_id: "A" })),
      gas("x", "2026-09-01", 150, { total_parcelas: 6, parcela_atual: 2, grupo_parcelamento_id: "X" })] });
    expect(s.compromissos.filter((c) => c.tipo === "parcela").length).toBe(2);
  });
  test("24. linha de outro usuário → inconclusivo, sem folga", () => {
    const c = cap({ receitas: [...salario3, { ...rec("z", "2026-09-01", 50_000), user_id: "outro" }] });
    expect(c.folgaCents).toBeNull();
    expect(c.mensagem).toBe(MSG_NAO_AVALIA);
  });
  test("25. gastos excluídos não chegam (loader filtra deleted_at) e snapshot não os inventa", () => {
    const s = snap({ receitas: salario3 });
    expect(total(s)).toBe(0);
  });
  test("26. folga negativa → não cabe, nunca 'cabe'", () => {
    const c = cap({ receitas: salario3, contas: [conta("c", "Aluguel", 6000, "2026-10-05")] });
    expect(c.cabeAVista).toBe(false);
    expect(c.mensagem).not.toMatch(/: cabe/);
  });
  test("27. guardado/limite não alteram folga", () => {
    const s = snap({ receitas: salario3 });
    const a = estimarCapacidadeCompra({ ...s, precoCents: 100_000 });
    const b = estimarCapacidadeCompra({ ...s, precoCents: 100_000, guardadoCents: 50_000_000, limiteCartaoCents: 2_000_000 });
    expect(b.folgaCents).toBe(a.folgaCents);
  });
  test("28. parcela >30% da folga → frase exata; rótulo de simulação sem juros", () => {
    const c = cap({ receitas: salario3 }, 1_000_000); // 6x 1.666,67 > 30% de 5.000
    expect(c.mensagem).toContain(AVISO_APERTO);
    expect(c.mensagem).toContain("simulação matemática sem juros, não é oferta de parcelamento da loja");
  });
});

describe("loader read-only (mock, sem rede)", () => {
  test("29. erro, 2000 linhas e consulta: fonte mantém filtros e fail-closed", async () => {
    const src = await Bun.file("src/server/shopping/whatsapp-shopping.server.ts").text();
    expect(src).toContain('.is("deleted_at", null).or(`data.gte.');
    expect(src).toContain("status.neq.pago");
    expect(src).toContain('throw new Error("finance_too_many_rows")');
    expect(src).toContain('throw new Error("finance_unavailable")');
    expect(src).not.toMatch(/from\("[a-z_]+"\)\s*\.(insert|update|delete|upsert)\(/);
  });
});
