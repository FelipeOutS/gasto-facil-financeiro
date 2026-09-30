/**
 * Fase de correção WhatsApp (testes reais de 30/09/2026).
 * Cobre apenas funções puras: detectores, regras de status e progresso.
 */
import { describe, expect, it } from "bun:test";
import { isStatusContaCancelado, filtrarContasAtivas } from "../src/lib/contas-status";
import { calcMetaProgresso } from "../src/lib/metas-progresso";
import {
  detectConsultaIntent,
  extractMetaTermo,
  groupContasRecorrentes,
} from "../src/server/whatsapp-consultas.server";
import { detectConsultaEspecifica } from "../src/server/whatsapp-consultas-especificas.server";
import { hasFaturaPeriodCue, detectFaturaIntent } from "../src/server/whatsapp-faturas.server";
import { detectPayableAccountIntent } from "../src/server/whatsapp-contas-criar.server";
import { detectDueIntent } from "../src/server/whatsapp-contas.server";
import { upcomingRangeInAppTz } from "../src/server/contas-vencimento.server";
import { detectLimiteIntent } from "../src/server/whatsapp-limites.server";
import { M } from "../src/server/whatsapp-messages";

describe("P0 — contas canceladas não aparecem como pendentes", () => {
  it("reconhece variações de cancelado", () => {
    for (const s of ["cancelado", "Cancelada", "cancelled", " canceled "])
      expect(isStatusContaCancelado(s)).toBe(true);
    for (const s of ["pendente", "pago", null, undefined, ""])
      expect(isStatusContaCancelado(s)).toBe(false);
  });
  it("filtra só as canceladas", () => {
    const r = filtrarContasAtivas([{ status: "pendente" }, { status: "cancelado" }, { status: "pago" }]);
    expect(r.map((x) => x.status)).toEqual(["pendente", "pago"]);
  });
});

describe("P0 — progresso de meta igual no site e no WhatsApp", () => {
  it("soma valor_atual + movimentações + guardado", () => {
    const p = calcMetaProgresso({
      valorAtual: 100,
      valorObjetivo: 1000,
      guardados: [{ valor: 200 }, { valor: "50" }],
      movimentacoes: [{ valor: 150 }],
    });
    expect(p.total).toBe(500);
    expect(p.restante).toBe(500);
    expect(p.percentual).toBe(50);
  });
  it("detecta pergunta sobre meta específica e extrai o nome", () => {
    expect(detectConsultaIntent("quanto tenho guardado na meta Viagem?")).toBe("listar_metas" as never);
    expect(extractMetaTermo("quanto tenho guardado na meta Viagem?")).toContain("viagem");
  });
});

describe("P1 — roteamento de consultas", () => {
  it("quanto gastei hoje → consulta do dia", () => {
    expect(detectConsultaEspecifica("quanto gastei hoje")?.kind ?? detectConsultaEspecifica("quanto gastei hoje")).toBeTruthy();
  });
  it("pergunta não vira cadastro de conta", () => {
    expect(detectPayableAccountIntent("quais são minhas contas recorrentes?")).toBe(false);
    expect(detectPayableAccountIntent("quando vence a internet?")).toBe(false);
  });
  it("próximas contas → modo upcoming", () => {
    expect(detectDueIntent("próximas contas")).toBeTruthy();
  });
  it("janela de próximos vencimentos é de 30 dias", () => {
    const r = upcomingRangeInAppTz(new Date(2026, 8, 30));
    expect(r.startISO).toBe("2026-09-30");
    expect(r.endISO).toBe("2026-10-30");
  });
  it("fatura com mês não cai na fatura atual", () => {
    expect(hasFaturaPeriodCue("fatura do mercado pago de novembro")).toBe(true);
    expect(detectFaturaIntent("fatura do mercado pago de novembro")).toBeNull();
  });
  it("limite do meu cartão é reconhecido", () => {
    expect(detectLimiteIntent("qual o limite do meu cartão")).toBeTruthy();
  });
  it("agrupa série recorrente pendente numa linha só", () => {
    const g = groupContasRecorrentes([
      { id: "1", nome: "Spotify", valor: 21.9, data_vencimento: "2026-11-03", status: "pendente", recorrencia_id: "r" },
      { id: "2", nome: "Spotify", valor: 21.9, data_vencimento: "2026-10-03", status: "pendente", recorrencia_id: "r" },
      { id: "3", nome: "Spotify", valor: 21.9, data_vencimento: "2026-12-03", status: "cancelado", recorrencia_id: "r" },
    ] as never);
    expect(g.length).toBe(1);
  });
});

describe("Ajuda/comandos listam só recursos existentes, agrupados", () => {
  it("ajuda tem grupos", () => {
    const a = M.consulta.ajudaExemplos();
    for (const g of ["Gastos", "Cartões", "Contas", "Receitas", "Planejamento", "Resumos"])
      expect(a).toContain(g);
  });
});
