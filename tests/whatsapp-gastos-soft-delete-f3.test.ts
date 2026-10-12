/**
 * F3 (Opção A) — leitores de `gastos` ignoram linhas com deleted_at.
 * Dados 100% fictícios, banco simulado em memória (tests/_whatsapp-fake.ts).
 * Nenhuma conexão com banco real.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fakeAdmin, resetState, state } from "./_whatsapp-fake";

mock.module("@/integrations/supabase/client", () => ({ supabase: fakeAdmin }));
const store = await import("../src/lib/store");
const fatura = await import("../src/server/cartao-fatura.server");

const card = {
  id: "card-1", user_id: "u1", nome: "Cartão teste", banco: "Teste", limite_total: 1000,
  dia_fechamento: 1, dia_vencimento: 10, cor: "#000000", observacao: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};
const DEL = { deleted_at: "2026-10-05T10:00:00Z", deleted_by: "u1", deletion_batch_id: "b-1", deletion_source: "whatsapp_periodo" };

function expense(id: string, date: string, valor: number, o: Record<string, unknown> = {}) {
  return {
    id, user_id: "u1", cartao_id: "card-1", descricao: id, estabelecimento: id, valor, data: date,
    mes: Number(date.slice(5, 7)), ano: Number(date.slice(0, 4)), categoria_id: null,
    forma_pagamento: "credito", tipo_gasto: "unico", confirmado: true, invoice_month: null,
    fatura_competencia: null, parcela_atual: null, total_parcelas: null, grupo_parcelamento_id: null,
    created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z`, ...o,
  };
}

async function load(rows: Record<string, unknown>[]) {
  resetState({ cartoes: [card], gastos: rows });
  store.setActiveUserId(null);
  store.setActiveUserId("u1");
  await store.hydrateUser("u1");
  expect(store.getHydrationStatus()).toBe("ready");
}

beforeEach(() => store.setActiveUserId(null));

describe("F3 — gastos excluídos (deleted_at) não aparecem nem somam", () => {
  it("site (store) e WhatsApp (fatura) ignoram excluídos; totais e isolamento A/B", async () => {
    await load([
      expense("ativo", "2026-10-02", 50),
      expense("excluido", "2026-10-02", 70, DEL),
      expense("excluido-outro-mes", "2026-10-03", 9, { ...DEL, invoice_month: "2026-10" }),
      expense("de-B", "2026-10-02", 500, { user_id: "u2" }),
      expense("de-B-excluido", "2026-10-02", 1, { user_id: "u2", ...DEL, deleted_by: "u2" }),
    ]);
    const ids = store.getGastos().map((g) => g.id);
    expect(ids).toEqual(["ativo"]);
    const now = new Date(2026, 9, 2, 12);
    const ref = store.faturaCorrente(store.getCartoes()[0], now);
    expect(store.resumoFaturaPorMes(card.id, ref.mes, ref.ano).total).toBe(50);
    const wa = await fatura.getFaturaAtualPorCartao("u1", card, now);
    expect(wa.total).toBe(50);
    expect(wa.qtd).toBe(1);
    const itens = await fatura.getItensFaturaAtualPorCartao("u1", card, now);
    expect(itens.map((i) => i.id)).toEqual(["ativo"]);
  });

  it("série de parcelas excluída inteira some; ativa permanece completa", async () => {
    const p = (id: string, d: string, n: number, g: string, extra = {}) =>
      expense(id, d, 100, { grupo_parcelamento_id: g, parcela_atual: n, total_parcelas: 2, tipo_gasto: "parcelado", ...extra });
    await load([
      p("A1", "2026-10-02", 1, "GA"), p("A2", "2026-11-02", 2, "GA"),
      p("X1", "2026-10-02", 1, "GX", DEL), p("X2", "2026-11-02", 2, "GX", DEL),
    ]);
    expect(store.getGastos().map((g) => g.id).sort()).toEqual(["A1", "A2"]);
    const wa = await fatura.getFaturaAtualPorCartao("u1", card, new Date(2026, 9, 2, 12));
    expect(wa.total).toBe(100);
  });

  it("excluídos continuam fisicamente no banco (nada apagado pelo leitor)", async () => {
    await load([expense("ativo", "2026-10-02", 50), expense("excluido", "2026-10-02", 70, DEL)]);
    expect(((state as unknown as { gastosData: Array<{ id: string }> }).gastosData).map((g) => g.id).sort()).toEqual(["ativo", "excluido"]);
  });
});

/**
 * Guarda de regressão: toda leitura `.from("gastos")` em src/ precisa filtrar
 * `.is("deleted_at", null)` OU ter comentário `soft-delete-exceção:` revisado
 * nas 3 linhas anteriores. Escritores (insert/update/delete/upsert) não são
 * avaliados aqui.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!p.includes("integrations")) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

describe("F3 — guarda: novas leituras de gastos sem filtro", () => {
  it("nenhuma leitura sem filtro ou exceção documentada", () => {
    const sem: string[] = [];
    const excecoes: string[] = [];
    for (const file of walk("src")) {
      const src = readFileSync(file, "utf8");
      const re = /\.from\(\s*["']gastos["']\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const rest = src.slice(m.index + m[0].length);
        const end = Math.min(...[rest.indexOf(";"), rest.search(/\.from\(/)].filter((i) => i >= 0), rest.length);
        const chain = rest.slice(0, end);
        if (/\.(insert|update|delete|upsert)\(/.test(chain)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        const before = src.split("\n").slice(Math.max(0, line - 4), line).join("\n");
        if (before.includes("soft-delete-exceção")) { excecoes.push(`${file}:${line}`); continue; }
        if (!/\.is\(\s*["']deleted_at["']\s*,\s*null\s*\)/.test(chain)) sem.push(`${file}:${line}`);
      }
    }
    expect(sem).toEqual([]);
    // Exceções revisadas (mudança aqui exige revisão consciente).
    expect(excecoes.length).toBe(7);
  });

  it("leitores dinâmicos (gastos|receitas) filtram as duas tabelas", () => {
    for (const f of [
      "src/server/whatsapp-proactive-alerts.server.ts",
      "src/server/whatsapp-finance-brief.server.ts",
      "src/server/whatsapp-postlaunch.server.ts",
    ]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/if\s*\(\s*table\s*===\s*["']receitas["']\s*\)\s*q\s*=\s*q\.is\(/);
      expect(s).toMatch(/q\s*=\s*q\.is\(\s*["']deleted_at["']/);
    }
  });
});
