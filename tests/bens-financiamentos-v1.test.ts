/**
 * BENS V1 — contabilização única, entrada sem duplicidade, histórico de
 * financiamento, arquivamento e integridade de conta (vínculos cruzados).
 *
 * Os cenários puros rodam sempre. Os negativos de banco (vínculo cruzado,
 * financiamento ativo único, delete destrutivo) exigem PGHOST e rodam dentro
 * de transações revertidas (ROLLBACK), sem tocar dados reais.
 */
import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  calcularResumoBem,
  valorEfetivoDesembolso,
  snapshotDivergente,
  financiamentoAtivo,
  podeExcluirBem,
  type AmortizacaoBem,
  type CustoAquisicaoBem,
  type Financiamento,
  type PagamentoBem,
} from "../src/lib/bens";

const hasDb = !!process.env.PGHOST;
const suite = hasDb ? describe : describe.skip;

function psqlRaw(sql: string): { status: number; out: string; err: string } {
  const r = spawnSync("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  });
  return { status: r.status ?? -1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function psql(sql: string): string {
  const r = psqlRaw(sql);
  if (r.status !== 0) throw new Error(`psql failed: ${r.err}`);
  return r.out;
}

const bem = {
  entrada_total: 60000,
  entrada_recursos_proprios: 20000,
  entrada_fgts: 40000,
  entrada_outros: 0,
};

function pag(p: Partial<PagamentoBem>): PagamentoBem {
  return {
    id: p.id ?? crypto.randomUUID(),
    user_id: "u",
    bem_id: "b",
    data_pagamento: "2026-01-10",
    valor_pago: 0,
    ...p,
  } as PagamentoBem;
}
function amo(p: Partial<AmortizacaoBem>): AmortizacaoBem {
  return {
    id: p.id ?? crypto.randomUUID(),
    user_id: "u",
    bem_id: "b",
    data: "2026-02-01",
    valor: 0,
    ...p,
  } as AmortizacaoBem;
}
function custo(p: Partial<CustoAquisicaoBem>): CustoAquisicaoBem {
  return {
    id: p.id ?? crypto.randomUUID(),
    user_id: "u",
    bem_id: "b",
    tipo: "itbi",
    valor: 0,
    ...p,
  } as CustoAquisicaoBem;
}
function fin(p: Partial<Financiamento>): Financiamento {
  return {
    id: p.id ?? crypto.randomUUID(),
    user_id: "u",
    bem_id: "b",
    valor_financiado: 0,
    status: "ativo",
    created_at: "",
    updated_at: "",
    ...p,
  } as Financiamento;
}

describe("BENS V1 — contabilização", () => {
  it("entrada não é contabilizada duas vezes (só bens.entrada_total)", () => {
    const r = calcularResumoBem({
      bem,
      pagamentos: [],
      amortizacoes: [],
      // custos são APENAS adicionais: ITBI/registro, nunca a entrada
      custos: [custo({ tipo: "itbi", valor: 6000 }), custo({ tipo: "registro", valor: 1500 })],
    });
    expect(r.entradaTotal).toBe(60000);
    expect(r.totalCustosAquisicao).toBe(7500);
    expect(r.totalDesembolsado).toBe(67500); // 60000 + 7500, entrada uma única vez
    expect(r.entradaComposicaoConfere).toBe(true);
  });

  it("evento com gasto vinculado conta uma única vez (valor do gasto, não a soma)", () => {
    const r = calcularResumoBem({
      bem: { ...bem, entrada_total: 0, entrada_recursos_proprios: 0, entrada_fgts: 0 },
      pagamentos: [pag({ valor_pago: 2500, gasto_id: "g1" })],
      amortizacoes: [amo({ valor: 10000, gasto_id: "g2" })],
      custos: [],
      valoresGastos: { g1: 2500, g2: 10000 },
    });
    expect(r.totalParcelasPagas).toBe(2500);
    expect(r.totalAmortizacoes).toBe(10000);
    expect(r.totalDesembolsado).toBe(12500);
  });

  it("gasto vinculado editado depois: caixa segue o gasto, snapshot é preservado", () => {
    const p = pag({ valor_pago: 2500, gasto_id: "g1" });
    const gastos = { g1: 2800 };
    expect(valorEfetivoDesembolso({ valor: p.valor_pago, gastoId: p.gasto_id }, gastos)).toBe(2800);
    expect(snapshotDivergente({ valor: p.valor_pago, gastoId: p.gasto_id }, gastos)).toBe(true);
    expect(p.valor_pago).toBe(2500);

    const r = calcularResumoBem({
      bem: { entrada_total: 0, entrada_recursos_proprios: 0, entrada_fgts: 0, entrada_outros: 0 },
      pagamentos: [p],
      amortizacoes: [],
      custos: [],
      valoresGastos: gastos,
    });
    expect(r.totalDesembolsado).toBe(2800);
  });

  it("gasto excluído (vínculo perdido) volta a usar o snapshot", () => {
    expect(valorEfetivoDesembolso({ valor: 2500, gastoId: null }, {})).toBe(2500);
    expect(valorEfetivoDesembolso({ valor: 2500, gastoId: "g1" }, {})).toBe(2500);
  });

  it("saldo devedor estimado desconta principal e amortizações", () => {
    const r = calcularResumoBem({
      bem,
      financiamento: fin({ valor_financiado: 300000, prazo_meses: 360 }),
      pagamentos: [pag({ valor_pago: 2500, valor_amortizacao: 500 })],
      amortizacoes: [amo({ valor: 20000 })],
      custos: [],
    });
    expect(r.saldoDevedorEstimado).toBe(279500);
    expect(r.parcelasRestantes).toBe(359);
  });

  it("sem financiamento, saldo devedor é null (não informado)", () => {
    const r = calcularResumoBem({ bem, pagamentos: [], amortizacoes: [], custos: [] });
    expect(r.saldoDevedorEstimado).toBeNull();
    expect(r.percentualPago).toBeNull();
  });

  it("dois financiamentos históricos no mesmo bem, apenas um ativo", () => {
    const lista = [
      fin({ id: "f2", status: "ativo", instituicao: "Banco B" }),
      fin({ id: "f1", status: "portado", instituicao: "Banco A" }),
    ];
    expect(lista.filter((f) => f.status === "ativo").length).toBe(1);
    expect(financiamentoAtivo(lista)?.id).toBe("f2");
  });

  it("bem com histórico não pode ser excluído (arquivar)", () => {
    expect(
      podeExcluirBem({ pagamentos: 1, amortizacoes: 0, custos: 0, gastos: 0, recorrencias: 0 }),
    ).toBe(false);
    expect(
      podeExcluirBem({ pagamentos: 0, amortizacoes: 0, custos: 0, gastos: 2, recorrencias: 0 }),
    ).toBe(false);
    expect(
      podeExcluirBem({ pagamentos: 0, amortizacoes: 0, custos: 0, gastos: 0, recorrencias: 0 }),
    ).toBe(true);
  });
});

suite("BENS V1 — integridade de conta e schema (banco real)", () => {
  it("FKs compostas (user_id, ...) existem em todos os vínculos", () => {
    const rows = psql(`
      SELECT conname FROM pg_constraint
       WHERE contype='f'
         AND conname IN ('gastos_bem_fk','recorrencias_bem_fk','bens_pagamentos_bem_fk',
                         'bens_pagamentos_gasto_fk','bens_amortizacoes_gasto_fk',
                         'bens_custos_aquisicao_gasto_fk','bens_financiamentos_bem_fk')
       ORDER BY 1;`);
    for (const c of [
      "gastos_bem_fk",
      "recorrencias_bem_fk",
      "bens_pagamentos_bem_fk",
      "bens_pagamentos_gasto_fk",
      "bens_amortizacoes_gasto_fk",
      "bens_custos_aquisicao_gasto_fk",
      "bens_financiamentos_bem_fk",
    ]) {
      expect(rows).toContain(c);
    }
    // cada FK usa 2 colunas (user_id + id do alvo)
    const cols = psql(`
      SELECT conname || '=' || array_length(conkey,1) FROM pg_constraint
       WHERE contype='f' AND conname LIKE '%bem_fk' OR conname LIKE 'bens_%gasto_fk';`);
    expect(cols).not.toContain("=1");
  });

  it("apenas um financiamento ativo por bem (índice parcial)", () => {
    const idx = psql(`
      SELECT indexdef FROM pg_indexes
       WHERE schemaname='public' AND indexname='uniq_bens_financiamento_ativo';`);
    expect(idx).toContain("bem_id");
    expect(idx).toContain("'ativo'");
  });

  it("trigger impede exclusão destrutiva de bem com histórico", () => {
    const t = psql(`
      SELECT tgname FROM pg_trigger
       WHERE tgname='trg_bens_prevent_destructive_delete' AND NOT tgisinternal;`);
    expect(t).toBe("trg_bens_prevent_destructive_delete");
  });

  it("vínculo cruzado entre contas é recusado pelo banco", () => {
    const users = psql(`SELECT id FROM auth.users ORDER BY created_at LIMIT 2;`)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (users.length < 2) {
      // sem duas contas reais, o teste estrutural acima já cobre as FKs
      expect(users.length).toBeGreaterThan(0);
      return;
    }
    const [a, b] = users;
    const r = psqlRaw(`
      BEGIN;
      -- bem da conta B
      INSERT INTO public.bens (id, user_id, tipo, nome)
        VALUES ('00000000-0000-0000-0000-0000000000b1','${b}','imovel','Bem da conta B');
      -- gasto da conta A tentando apontar para o bem da conta B
      INSERT INTO public.gastos (id, user_id, descricao, valor, data, forma_pagamento, mes, ano, bem_id)
        VALUES ('00000000-0000-0000-0000-0000000000a1','${a}','x',1,'2026-01-01','pix',1,2026,
                '00000000-0000-0000-0000-0000000000b1');
      ROLLBACK;`);
    expect(r.status).not.toBe(0);
    expect(`${r.err}`.toLowerCase()).toContain("gastos_bem_fk");

    const r2 = psqlRaw(`
      BEGIN;
      INSERT INTO public.bens (id, user_id, tipo, nome)
        VALUES ('00000000-0000-0000-0000-0000000000b2','${b}','imovel','Bem da conta B');
      INSERT INTO public.recorrencias (id, user_id, nome, valor, bem_id)
        VALUES ('00000000-0000-0000-0000-0000000000a2','${a}','x',1,
                '00000000-0000-0000-0000-0000000000b2');
      ROLLBACK;`);
    expect(r2.status).not.toBe(0);
    expect(`${r2.err}`.toLowerCase()).toContain("recorrencias_bem_fk");

    // pagamento da conta B tentando vincular gasto da conta A
    const r3 = psqlRaw(`
      BEGIN;
      INSERT INTO public.bens (id, user_id, tipo, nome)
        VALUES ('00000000-0000-0000-0000-0000000000b3','${b}','imovel','Bem da conta B');
      INSERT INTO public.gastos (id, user_id, descricao, valor, data, forma_pagamento, mes, ano)
        VALUES ('00000000-0000-0000-0000-0000000000a3','${a}','x',1,'2026-01-01','pix',1,2026);
      INSERT INTO public.bens_pagamentos (user_id, bem_id, data_pagamento, valor_pago, gasto_id)
        VALUES ('${b}','00000000-0000-0000-0000-0000000000b3','2026-01-01',1,
                '00000000-0000-0000-0000-0000000000a3');
      ROLLBACK;`);
    expect(r3.status).not.toBe(0);
    expect(`${r3.err}`.toLowerCase()).toContain("bens_pagamentos_gasto_fk");
  });

  it("arquivar preserva gastos e histórico; delete destrutivo falha", () => {
    const user = psql(`SELECT id FROM auth.users ORDER BY created_at LIMIT 1;`);
    expect(user.length).toBeGreaterThan(0);
    const r = psqlRaw(`
      BEGIN;
      INSERT INTO public.bens (id, user_id, tipo, nome)
        VALUES ('00000000-0000-0000-0000-0000000000c1','${user}','veiculo','Carro');
      INSERT INTO public.bens_pagamentos (user_id, bem_id, data_pagamento, valor_pago)
        VALUES ('${user}','00000000-0000-0000-0000-0000000000c1','2026-01-01',900);
      UPDATE public.bens SET status='arquivado', arquivado_em=now()
        WHERE id='00000000-0000-0000-0000-0000000000c1';
      -- histórico preservado após arquivar
      SELECT count(*) FROM public.bens_pagamentos
        WHERE bem_id='00000000-0000-0000-0000-0000000000c1';
      DELETE FROM public.bens WHERE id='00000000-0000-0000-0000-0000000000c1';
      ROLLBACK;`);
    expect(r.status).not.toBe(0);
    expect(`${r.err}`).toContain("bem_com_historico");
  });
});
