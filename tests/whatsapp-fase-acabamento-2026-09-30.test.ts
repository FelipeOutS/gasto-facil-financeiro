/**
 * Fase final de acabamento (30/09/2026): faturas futuras, menu por grupos,
 * aba Canceladas, copy ao rejeitar criação e orçamento não criado.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  detectFaturaIntent,
  detectFutureFaturaIntent,
} from "../src/server/whatsapp-faturas.server";
import {
  dispatchMenuOption,
  limitesOrcamentoReais,
  orcamentoNaoCriadoMsg,
} from "../src/server/whatsapp-consultas.server";
import { whatsappMessages as M } from "../src/server/whatsapp-messages";
import {
  acoesDisponiveisConta,
  filtrarContasAtivas,
  listaDaAba,
} from "../src/lib/contas-status";

const HOJE = new Date(2026, 8, 30);

describe("faturas futuras → consulta (nunca cadastro de gasto)", () => {
  for (const s of [
    "faturas futuras do Mercado Pago",
    "futuras faturas do Mercado Pago",
    "próximas faturas do Mercado Pago",
    "quais são as próximas faturas do Mercado Pago?",
  ]) {
    it(s, () => {
      expect(detectFaturaIntent(s)).toBeNull();
      expect(detectFutureFaturaIntent(s, HOJE)?.kind).toBe("future_invoice_card");
    });
  }
  it("regressão: próxima fatura e fatura do próximo mês", () => {
    expect(detectFutureFaturaIntent("próxima fatura do Mercado Pago", HOJE)?.kind).toBe(
      "future_invoice_card",
    );
    expect(detectFutureFaturaIntent("minha fatura do próximo mês", HOJE)?.kind).toBe(
      "future_invoice_total",
    );
  });
});

describe("menu / ajuda / comandos consistentes", () => {
  const grupos = ["Gastos", "Cartões", "Contas", "Receitas", "Planejamento", "Resumos"];
  it("menu lista os grupos atuais", () => {
    const menu = M.consulta.ajuda();
    for (const g of grupos) expect(menu).toContain(g);
    expect(menu).toContain("Comandos rápidos");
    expect(menu).not.toContain("Marcar conta como paga");
  });
  it("ajuda e comandos cobrem os mesmos grupos", () => {
    for (const g of grupos) {
      expect(M.consulta.ajudaExemplos()).toContain(g);
      expect(M.consulta.comandosLista()).toContain(g);
    }
  });
  it("opções 1-6 abrem o grupo; 7=ajuda; 8=comandos", () => {
    grupos.forEach((g, i) => {
      const r = dispatchMenuOption(i + 1);
      expect(r?.kind).toBe("guidance");
      if (r?.kind === "guidance") expect(r.resposta).toContain(g);
    });
    expect(dispatchMenuOption(7)).toEqual({ kind: "rewrite", texto: "ajuda" });
    expect(dispatchMenuOption(8)).toEqual({ kind: "rewrite", texto: "comandos" });
  });
  it("faturas futuras no menu de cartões", () => {
    const r = dispatchMenuOption(2);
    if (r?.kind === "guidance") expect(r.resposta).toMatch(/faturas futuras/i);
  });
});

describe("aba Canceladas em Contas a pagar", () => {
  type C = { id: string; status: string; valor: number; cancelada?: boolean };
  const rows: C[] = [
    { id: "p", status: "pendente", valor: 10 },
    { id: "x", status: "cancelado", valor: 99 },
    { id: "g", status: "pago", valor: 5 },
  ];
  const ativas = filtrarContasAtivas(rows);
  const canceladas = rows.filter((r) => r.status === "cancelado").map((r) => ({ ...r, cancelada: true }));
  const pendente = (c: C) => c.status === "pendente";

  it("cancelada não aparece em Pendentes", () => {
    expect(listaDaAba("pendentes", ativas, canceladas, pendente).map((c) => c.id)).toEqual(["p"]);
  });
  it("cancelada não entra no total pendente nem em próximos vencimentos", () => {
    const total = ativas.filter(pendente).reduce((s, c) => s + c.valor, 0);
    expect(total).toBe(10);
    expect(listaDaAba("proximas", ativas, canceladas, pendente).some((c) => c.id === "x")).toBe(false);
  });
  it("cancelada aparece em Canceladas", () => {
    expect(listaDaAba("canceladas", ativas, canceladas, () => true).map((c) => c.id)).toEqual(["x"]);
  });
  it("cancelada aparece em Todas marcada como cancelada", () => {
    const todas = listaDaAba("todas", ativas, canceladas, () => true);
    const x = todas.find((c) => c.id === "x");
    expect(x?.cancelada).toBe(true);
    expect(todas.length).toBe(3);
  });
  it("cancelada não oferece Marcar como pago", () => {
    expect(acoesDisponiveisConta({ cancelada: true }, false)).toEqual([]);
    expect(acoesDisponiveisConta({}, false)).toContain("pagar");
  });
  it("card da página esconde ações para cancelada", () => {
    const src = readFileSync("src/routes/contas-a-pagar.index.tsx", "utf8");
    expect(src).toContain("{!conta.cancelada && (");
    expect(src).toContain('t("status.cancelled")');
  });
});

describe("rejeitar criação não diz que uma conta existente foi cancelada", () => {
  it("copy de rejeição", () => {
    const src = readFileSync("src/server/whatsapp-contas-criar.server.ts", "utf8");
    expect(src).not.toContain("Conta cancelada. Quando quiser");
    expect(src).toContain("Tudo certo, não registrei essa conta.");
  });
});

describe("meu orçamento sem orçamento criado", () => {
  it("ignora sugestão legada e limites zerados", () => {
    expect(
      limitesOrcamentoReais([
        { tipo: "meta_gasto_mensal", valor: 3000 },
        { tipo: "total", valor: 0 },
      ]),
    ).toEqual([]);
    expect(limitesOrcamentoReais([{ tipo: "total", valor: 2000 }]).length).toBe(1);
  });
  it("mensagem clara", () => {
    const m = orcamentoNaoCriadoMsg("setembro");
    expect(m).toContain("Você ainda não criou um orçamento para setembro.");
    expect(m).toContain("https://gastointeligente.com.br");
  });
});
