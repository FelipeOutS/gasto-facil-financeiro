import { describe, expect, it } from "vitest";
import {
  addMonthsYm,
  cicloParaCompetencia,
  competenciaDoGasto,
  competenciaParaCiclo,
  competenciaPorData,
  competenciasParcelas,
} from "@/lib/fatura-competencia";
import { criarPlanoParcelamento } from "@/server/cartao-parcelamento.server";
import {
  parseEscolhaFatura,
  perguntaEscolhaFatura,
  resolverCompetenciaEscolhida,
} from "@/server/whatsapp-fatura-escolha.server";
import {
  buildInteractiveFromReply,
  extractNumberedOptions,
  replyIdToTexto,
} from "@/server/whatsapp-interactive.server";

// Cartão do exemplo: fecha dia 25, vence dia 5.
const FECH = 25;
const VENC = 5;

type G = {
  id: string;
  data: string;
  invoice_month?: string | null;
  fatura_competencia?: string | null;
  valor: number;
};
/** Mesma regra usada em Gastos/Dashboard (mês de referência). */
const mesReferencia = (g: G) => g.invoice_month ?? g.data.slice(0, 7);
/** Mesma regra usada em Cartões/WhatsApp (competência da fatura). */
const naFatura = (gs: G[], comp: string) =>
  gs.filter((g) => competenciaDoGasto(g, FECH, VENC) === comp);

const cacau: G = {
  id: "cacau",
  data: "2026-09-30",
  invoice_month: "2026-09",
  fatura_competencia: competenciaPorData("2026-09-30", FECH, VENC)!.competencia,
  valor: 24.9,
};

describe("compra 30/09 com cartão que fecha 25 e vence 5", () => {
  it("1-3. mês de referência Setembro, competência Novembro", () => {
    expect(mesReferencia(cacau)).toBe("2026-09");
    expect(cacau.fatura_competencia).toBe("2026-11");
  });
  it("4-5. Gastos Setembro encontra; Novembro não move a compra", () => {
    expect([cacau].filter((g) => mesReferencia(g) === "2026-09")).toHaveLength(1);
    expect([cacau].filter((g) => mesReferencia(g) === "2026-11")).toHaveLength(0);
  });
  it("6-7. Fatura Novembro encontra; Fatura Outubro não", () => {
    expect(naFatura([cacau], "2026-11").map((g) => g.id)).toEqual(["cacau"]);
    expect(naFatura([cacau], "2026-10")).toHaveLength(0);
  });
  it("8. Dashboard Setembro soma pelo mês de referência", () => {
    const outro: G = { id: "x", data: "2026-09-10", invoice_month: "2026-09", valor: 10 };
    const total = [cacau, outro]
      .filter((g) => mesReferencia(g) === "2026-09")
      .reduce((s, g) => s + g.valor, 0);
    expect(total).toBeCloseTo(34.9);
  });
  it("compra 20/09 (antes do fechamento) vai para Outubro", () => {
    expect(competenciaPorData("2026-09-20", FECH, VENC)!.competencia).toBe("2026-10");
  });
});

describe("9. parcelamento 3x comprado em setembro (fechamento já passou)", () => {
  const plano = criarPlanoParcelamento({
    totalReais: 300,
    totalParcelas: 3,
    diaFechamentoCartao: FECH,
    diaVencimentoCartao: VENC,
    dataCompra: new Date(2026, 8, 30),
  });
  it("todas preservam o mês de referência da compra", () => {
    expect(plano.mesReferenciaCompra).toBe("2026-09");
    expect(plano.dataCompra).toBe("2026-09-30");
  });
  it("competências Novembro / Dezembro / Janeiro", () => {
    expect(plano.parcelas.map((p) => p.competencia)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(plano.parcelas.map((p) => p.valor)).toEqual([100, 100, 100]);
  });
  it("cada parcela aparece só na sua fatura e Setembro soma R$ 300", () => {
    const rows: G[] = plano.parcelas.map((p) => ({
      id: `p${p.numero}`,
      data: plano.dataCompra,
      invoice_month: plano.mesReferenciaCompra,
      fatura_competencia: p.competencia,
      valor: p.valor,
    }));
    expect(naFatura(rows, "2026-11").map((r) => r.id)).toEqual(["p1"]);
    expect(naFatura(rows, "2026-12").map((r) => r.id)).toEqual(["p2"]);
    expect(naFatura(rows, "2027-01").map((r) => r.id)).toEqual(["p3"]);
    expect(rows.filter((r) => mesReferencia(r) === "2026-09").reduce((s, r) => s + r.valor, 0)).toBe(300);
  });
});

describe("10. virada Dezembro → Janeiro", () => {
  it("compra 28/12 entra na fatura que vence em fevereiro", () => {
    expect(competenciaPorData("2026-12-28", FECH, VENC)!.competencia).toBe("2027-02");
  });
  it("compra 10/12 vence em janeiro", () => {
    expect(competenciaPorData("2026-12-10", FECH, VENC)!.competencia).toBe("2027-01");
  });
  it("aritmética de meses atravessa o ano", () => {
    expect(addMonthsYm("2026-12", 1)).toBe("2027-01");
    expect(competenciasParcelas("2026-11", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("11. compra no dia do fechamento", () => {
  it("sugere a fatura atual mas sinaliza incerteza", () => {
    const r = competenciaPorData("2026-09-25", FECH, VENC)!;
    expect(r.competencia).toBe("2026-10");
    expect(r.diaDoFechamento).toBe(true);
    expect(competenciaPorData("2026-09-24", FECH, VENC)!.diaDoFechamento).toBe(false);
  });
});

describe("12. correção manual da competência", () => {
  it("fatura_competencia manual prevalece sobre o cálculo", () => {
    const g: G = { ...cacau, fatura_competencia: "2026-12" };
    expect(naFatura([g], "2026-12")).toHaveLength(1);
    expect(naFatura([g], "2026-11")).toHaveLength(0);
    expect(mesReferencia(g)).toBe("2026-09");
  });
});

describe("dados antigos (fatura_competencia NULL) continuam na mesma fatura", () => {
  it("invoice_month legado é ciclo e vira mês do vencimento", () => {
    const legado: G = { id: "old", data: "2026-09-30", invoice_month: "2026-09", valor: 1 };
    // ciclo Setembro (legado) = vence em novembro
    expect(competenciaDoGasto(legado, FECH, VENC)).toBe("2026-11");
    expect(competenciaParaCiclo("2026-11", FECH, VENC)).toBe("2026-09");
  });
  it("sem invoice_month usa a data (ciclo antigo)", () => {
    expect(competenciaDoGasto({ data: "2026-09-20" }, FECH, VENC)).toBe("2026-10");
  });
  it("cartão que vence depois do fechamento no mesmo mês (fecha 5, vence 15)", () => {
    expect(cicloParaCompetencia("2026-09", 5, 15)).toBe("2026-10");
    expect(competenciaPorData("2026-09-30", 5, 15)!.competencia).toBe("2026-10");
  });
});

describe("13. cartão sem cadastro + escolha Novembro", () => {
  it("pergunta oferece Outubro e Novembro e grava Novembro", () => {
    const q = perguntaEscolhaFatura("2026-09-30");
    expect(q).toContain("Em qual fatura essa compra vai cair?");
    expect(q).toContain("fatura de outubro de 2026");
    expect(q).toContain("fatura de novembro de 2026");
    const p = parseEscolhaFatura("fatura de novembro")!;
    expect(resolverCompetenciaEscolhida(p, "2026-09-30")).toBe("2026-11");
  });
  it("mês anterior à compra vai para o ano seguinte", () => {
    const p = parseEscolhaFatura("janeiro")!;
    expect(resolverCompetenciaEscolhida(p, "2026-09-30")).toBe("2027-01");
  });
  it("vira botões Outubro / Novembro / Outro mês", () => {
    const ir = buildInteractiveFromReply("Gasto salvo.\n\n" + perguntaEscolhaFatura("2026-09-30"));
    expect(ir?.type).toBe("button");
    if (ir?.type !== "button") return;
    expect(ir.buttons.map((b) => b.id)).toEqual([
      "fatura_comp:2026-10",
      "fatura_comp:2026-11",
      "fatura_comp:outro",
    ]);
  });
});

describe("14. texto e botão produzem o mesmo resultado", () => {
  it("botão de fatura e texto resolvem a mesma competência", () => {
    const viaBotao = resolverCompetenciaEscolhida(
      parseEscolhaFatura(replyIdToTexto("fatura_comp:2026-11", "Novembro"))!,
      "2026-09-30",
    );
    const viaTexto = resolverCompetenciaEscolhida(
      parseEscolhaFatura("fatura de novembro de 2026")!,
      "2026-09-30",
    );
    expect(viaBotao).toBe("2026-11");
    expect(viaTexto).toBe(viaBotao);
  });
  it("botões de confirmação e pagamento viram o mesmo texto digitado", () => {
    expect(replyIdToTexto("confirm_yes", "Sim")).toBe("sim");
    expect(replyIdToTexto("confirm_no", "Não")).toBe("não");
    expect(replyIdToTexto("payment_credit", "Cartão de crédito")).toBe("cartão");
    expect(replyIdToTexto("payment_pix", "Pix")).toBe("pix");
    expect(replyIdToTexto("opt_3", "Contas")).toBe("3");
  });
  it("perguntas conhecidas ganham botões/listas; o texto original é mantido", () => {
    const conf = buildInteractiveFromReply("Posso registrar? Responda sim ou não.");
    expect(conf?.type).toBe("button");
    expect(conf?.body).toBe("Posso registrar? Responda sim ou não.");
    const pag = buildInteractiveFromReply(
      "Como você pagou esse gasto? Responda com: Pix, dinheiro, débito ou cartão.",
    );
    expect(pag?.type).toBe("list");
    const menu = buildInteractiveFromReply("Escolha:\n1. Gastos\n2. Cartões\n3. Contas\nResponda com o número.");
    expect(menu?.type).toBe("list");
    expect(buildInteractiveFromReply("Gasto de R$ 10 salvo.")).toBeNull();
  });
  it("lista numerada exige sequência a partir de 1", () => {
    expect(extractNumberedOptions("3. a\n4. b")).toEqual([]);
    expect(extractNumberedOptions("1) a\n2) b").map((o) => o.num)).toEqual([1, 2]);
  });
});
