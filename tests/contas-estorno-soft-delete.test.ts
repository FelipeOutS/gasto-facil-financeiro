/**
 * P0 nº1 — estorno de conta paga com gasto vinculado soft-excluído.
 * Banco simulado em memória, dados fictícios, sem rede.
 */
import { describe, expect, it } from "bun:test";
import {
  MSG_ESTORNO_CONCORRENTE,
  MSG_ESTORNO_GASTO_EXCLUIDO,
  estornarPagamentoConta,
  findLinkedGastos,
  hasDeletedLinkedGasto,
  opId,
} from "../src/lib/contas-estorno";

type Row = Record<string, any>;
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const CONTA = "c0000000-0000-4000-8000-000000000001";

function makeDb(init: { gastos: Row[]; contas: Row[]; faturas?: Row[] }, opts: {
  failOn?: string; beforeDelete?: (db: any) => void;
} = {}) {
  const db = { gastos: init.gastos.map((r) => ({ ...r })), contas_a_pagar: init.contas.map((r) => ({ ...r })),
    faturas_cartao: (init.faturas ?? []).map((r) => ({ ...r })), ops: [] as string[] } as any;
  const sb = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let mode: "select" | "delete" | "update" = "select";
      let patch: Row = {};
      let returning = false;
      const exec = () => {
        if (opts.failOn === `${table}:${mode}`) return { data: null, error: { message: "falha simulada" } };
        if (mode === "delete") opts.beforeDelete?.(db);
        const rows = db[table].filter((r: Row) => filters.every((f) => f(r)));
        if (mode === "delete") {
          db[table] = db[table].filter((r: Row) => !rows.includes(r));
          db.ops.push(`delete:${table}:${rows.map((r: Row) => r.id).join(",")}`);
          return { data: returning ? rows.map((r: Row) => ({ id: r.id })) : null, error: null };
        }
        if (mode === "update") {
          rows.forEach((r: Row) => Object.assign(r, patch));
          db.ops.push(`update:${table}`);
          return { data: null, error: null };
        }
        return { data: rows.map((r: Row) => ({ ...r })), error: null };
      };
      const q: any = {
        select: () => { if (mode !== "select") returning = true; return q; },
        delete: () => { mode = "delete"; return q; },
        update: (p: Row) => { mode = "update"; patch = p; return q; },
        eq: (k: string, v: any) => (filters.push((r) => r[k] === v), q),
        in: (k: string, v: any[]) => (filters.push((r) => v.includes(r[k])), q),
        is: (k: string, v: any) => (filters.push((r) => (r[k] ?? null) === v), q),
        or: (expr: string) => {
          const parts = expr.split(",").map((p) => { const [k, , ...v] = p.split("."); return [k, v.join(".")]; });
          filters.push((r) => parts.some(([k, v]) => String(r[k]) === v));
          return q;
        },
        maybeSingle: async () => { const r = exec(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej),
      };
      return q;
    },
  };
  return { db, sb };
}

const conta = (o: Row = {}) => ({ id: CONTA, user_id: A, nome: "Luz", valor: 120, status: "pago",
  data_pagamento: "2026-09-10", data_vencimento: "2026-09-10", gasto_id: "g1", ...o });
const gasto = (id: string, o: Row = {}) => ({ id, user_id: A, descricao: "Luz", estabelecimento: "Luz", valor: 120,
  data: "2026-09-10", origem: "contas_a_pagar", id_operacao_banco: opId(CONTA), deleted_at: null, ...o });
const DEL = { deleted_at: "2026-10-01T00:00:00Z" };

describe("reprodução do bug (lógica antiga: buscar vínculo + DELETE sem checar deleted_at)", () => {
  it("antes da correção o estorno apagava de vez o gasto soft-excluído e reabria a conta", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("g1", DEL)], contas: [conta()] });
    const c = db.contas_a_pagar[0];
    const linked = await findLinkedGastos(sb, A, c, c.nome, 120, c.data_pagamento);
    await sb.from("gastos").delete().eq("user_id", A).in("id", linked.map((g: Row) => g.id));
    await sb.from("contas_a_pagar").update({ status: "pendente", gasto_id: null, data_pagamento: null }).eq("id", CONTA);
    expect(db.gastos).toHaveLength(0); // perda definitiva
    expect(db.contas_a_pagar[0].status).toBe("pendente");
  });
});

describe("estornarPagamentoConta — corrigido", () => {
  it("legado ativo: apaga o gasto e volta a conta para pendente", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("g1")], contas: [conta()] });
    expect(await estornarPagamentoConta(sb, A, { id: CONTA })).toEqual({ ok: true });
    expect(db.gastos).toHaveLength(0);
    expect(db.contas_a_pagar[0]).toMatchObject({ status: "pendente", gasto_id: null, data_pagamento: null });
  });

  it("estorno sem remover gasto ativo: mantém gasto e reabre conta (comportamento atual)", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("g1")], contas: [conta()] });
    await estornarPagamentoConta(sb, A, { id: CONTA, removerGastoVinculado: false });
    expect(db.gastos).toHaveLength(1);
    expect(db.contas_a_pagar[0].status).toBe("pendente");
  });

  for (const remover of [true, false]) {
    it(`gasto vinculado soft-excluído bloqueia tudo (removerGastoVinculado=${remover})`, async () => {
      const { db, sb } = makeDb({ gastos: [gasto("g1", DEL)], contas: [conta()] });
      await expect(estornarPagamentoConta(sb, A, { id: CONTA, removerGastoVinculado: remover }))
        .rejects.toThrow(MSG_ESTORNO_GASTO_EXCLUIDO);
      expect(db.gastos).toHaveLength(1);
      expect(db.contas_a_pagar[0]).toMatchObject({ status: "pago", gasto_id: "g1", data_pagamento: "2026-09-10" });
      expect(db.ops).toEqual([]);
    });
  }

  it("mistura ativo + excluído: bloqueia o ato inteiro, nem o ativo é apagado", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("g1"), gasto("g2", DEL)], contas: [conta()] });
    await expect(estornarPagamentoConta(sb, A, { id: CONTA })).rejects.toThrow(MSG_ESTORNO_GASTO_EXCLUIDO);
    expect(db.gastos.map((g: Row) => g.id).sort()).toEqual(["g1", "g2"]);
    expect(db.ops).toEqual([]);
  });

  it("gasto_id direto de outra origem (ex. WhatsApp) excluído também bloqueia, sem entrar no DELETE", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("gw", { origem: "whatsapp", id_operacao_banco: null, ...DEL })],
      contas: [conta({ gasto_id: "gw" })] });
    await expect(estornarPagamentoConta(sb, A, { id: CONTA })).rejects.toThrow(MSG_ESTORNO_GASTO_EXCLUIDO);
    expect(db.gastos).toHaveLength(1);
    expect(db.contas_a_pagar[0].status).toBe("pago");
  });

  it("restaurado (deleted_at null) volta ao fluxo normal", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("g1", { deleted_at: null })], contas: [conta()] });
    await estornarPagamentoConta(sb, A, { id: CONTA });
    expect(db.gastos).toHaveLength(0);
  });

  it("gasto de outro usuário não entra no vínculo nem é apagado", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("gB", { user_id: B, ...DEL })], contas: [conta({ gasto_id: "gB" })] });
    await estornarPagamentoConta(sb, A, { id: CONTA });
    expect(db.gastos).toHaveLength(1);
    expect(db.contas_a_pagar[0].status).toBe("pendente");
  });

  it("conta inexistente ou de outro usuário: 'Conta não encontrada', nada muda", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("g1")], contas: [conta({ user_id: B })] });
    await expect(estornarPagamentoConta(sb, A, { id: CONTA })).rejects.toThrow("Conta não encontrada.");
    expect(db.ops).toEqual([]);
  });

  it("erro do banco ao ler gastos NÃO vira 'sem vínculo' (F2 ausente → falha fechada)", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("g1")], contas: [conta()] }, { failOn: "gastos:select" });
    await expect(estornarPagamentoConta(sb, A, { id: CONTA })).rejects.toThrow("falha simulada");
    expect(db.ops).toEqual([]);
    expect(db.contas_a_pagar[0].status).toBe("pago");
  });

  it("erro no DELETE: conta não é reaberta", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("g1")], contas: [conta()] }, { failOn: "gastos:delete" });
    await expect(estornarPagamentoConta(sb, A, { id: CONTA })).rejects.toThrow("falha simulada");
    expect(db.contas_a_pagar[0].status).toBe("pago");
  });

  it("corrida: gasto marcado entre leitura e DELETE nunca é apagado; conta não muda (resíduo documentado)", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("g1"), gasto("g2")], contas: [conta()] }, {
      beforeDelete: (d) => { d.gastos.find((g: Row) => g.id === "g2").deleted_at = "2026-10-12T00:00:00Z"; },
    });
    await expect(estornarPagamentoConta(sb, A, { id: CONTA })).rejects.toThrow(MSG_ESTORNO_CONCORRENTE);
    expect(db.gastos.map((g: Row) => g.id)).toEqual(["g2"]); // excluído preservado
    expect(db.contas_a_pagar[0]).toMatchObject({ status: "pago", gasto_id: "g1" });
    // Resíduo: o ativo g1 foi apagado sem transação — pendência F4 (RPC transacional).
  });

  it("duas requisições seguidas: a segunda não apaga nada a mais", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("g1"), gasto("outro", { descricao: "Água", id_operacao_banco: null })], contas: [conta()] });
    await estornarPagamentoConta(sb, A, { id: CONTA });
    await estornarPagamentoConta(sb, A, { id: CONTA });
    expect(db.gastos.map((g: Row) => g.id)).toEqual(["outro"]);
  });

  it("faturas e parcelas não são tocadas", async () => {
    const parcela = gasto("p1", { origem: "whatsapp", id_operacao_banco: null, grupo_parcelamento_id: "G", descricao: "TV" });
    const { db, sb } = makeDb({ gastos: [gasto("g1", DEL), parcela], contas: [conta()],
      faturas: [{ id: "f1", user_id: A, valor_pago: 300, status: "paga" }] });
    await expect(estornarPagamentoConta(sb, A, { id: CONTA })).rejects.toThrow();
    expect(db.faturas_cartao[0]).toMatchObject({ valor_pago: 300, status: "paga" });
    expect(db.gastos.find((g: Row) => g.id === "p1")).toBeTruthy();
  });
});

describe("pagar novamente com gasto excluído (guarda usada por markContaAPagarPaid)", () => {
  it("detecta excluído → handler lança antes de UPDATE/INSERT (sem duplicata)", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("g1", DEL)], contas: [conta()] });
    const c = db.contas_a_pagar[0];
    const linked = await findLinkedGastos(sb, A, c, c.nome, 120, "2026-09-10");
    expect(await hasDeletedLinkedGasto(sb, A, c, linked)).toBe(true);
    expect(db.gastos).toHaveLength(1);
  });
  it("sem excluído → false (fluxo normal preservado)", async () => {
    const { db, sb } = makeDb({ gastos: [gasto("g1")], contas: [conta()] });
    const c = db.contas_a_pagar[0];
    expect(await hasDeletedLinkedGasto(sb, A, c, await findLinkedGastos(sb, A, c, c.nome, 120, "2026-09-10"))).toBe(false);
  });
});
