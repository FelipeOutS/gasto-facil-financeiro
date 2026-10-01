/**
 * 01/10/2026 — Reproduz o teste real: "me lembra da fatura do Nubank 3 dias
 * antes" → tocar no ID REAL de "💳 Ver fatura" deve mostrar a FATURA (mesma
 * fonte de "minha fatura do Nubank": cartao-fatura.server), não o resumo do
 * lembrete. Usa as funções REAIS de cálculo de fatura sobre um banco em memória.
 */
import { describe, expect, test, mock, beforeEach, setSystemTime, afterAll } from "bun:test";

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
let queue: Row[];

function fakeClient() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "insert" | "update" = "select";
      let payload: Row | null = null;
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
        gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), q),
        lt: (k: string, v: string) => (filters.push((r) => String(r[k]) < v), q),
        order: () => q,
        limit: () => q,
        insert: (r: Row) => ((op = "insert"), (payload = r), q),
        update: (r: Row) => ((op = "update"), (payload = r), q),
        run() {
          const t = (db[table] ??= []);
          if (op === "insert") {
            const row = { id: crypto.randomUUID(), status: "ativo", updated_at: String(Math.random()), ...payload };
            t.push(row);
            return { data: [row], error: null };
          }
          const rows = t.filter((r) => filters.every((f) => f(r)));
          if (op === "update") rows.forEach((r) => Object.assign(r, payload, { updated_at: String(Math.random()) }));
          return { data: rows, error: null };
        },
        single: async () => {
          const r = q.run();
          return { data: r.data?.[0] ?? null, error: r.error };
        },
        maybeSingle: async () => {
          const r = q.run();
          return { data: r.data?.[0] ?? null, error: r.error };
        },
        then: (res: (v: unknown) => void) => res(q.run()),
      };
      return q;
    },
  };
}

const client = fakeClient();
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: client }));

const { detectAgendaIntent } = await import("../src/lib/agenda/intent");
const A = await import("../src/server/agenda.server");
const W = await import("../src/server/whatsapp-agenda.server");
const { replyIdToTexto } = await import("../src/server/whatsapp-interactive.server");
const { handleFaturaIntent } = await import("../src/server/whatsapp-faturas.server");

const U1 = "11111111-1111-1111-1111-111111111111";
// Quinta, 01/10/2026 10:00 em São Paulo.
const NOW = new Date("2026-10-01T13:00:00Z");
setSystemTime(NOW);
afterAll(() => setSystemTime());

const nb = (s: string) => s.replace(/\u00a0/g, " ");
const deps = () => ({
  client,
  now: () => NOW,
  enqueue: async (i: Row) => void queue.push({ ...i, status: "pending" }),
  cancelPending: async () => 0,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buttons = (r: any): Array<{ id: string; title: string }> =>
  (r.graphInteractive?.action?.buttons ?? []).map((b: { reply: { id: string; title: string } }) => b.reply);

beforeEach(() => {
  db = {
    agenda_items: [],
    cartoes: [{ id: "c-nu", user_id: U1, nome: "Nubank", dia_fechamento: 25, dia_vencimento: 5, limite_total: 5000 }],
    contas_a_pagar: [
      { id: "k-net", user_id: U1, nome: "Internet", valor: 120, data_vencimento: "2026-10-10", status: "pendente" },
    ],
    recorrencias: [],
    gastos: [
      { id: "g1", user_id: U1, cartao_id: "c-nu", descricao: "Mercado", valor: 56, data: "2026-10-01", forma_pagamento: "credito", confirmado: true, invoice_month: "2026-10", fatura_competencia: "2026-11", parcela_atual: null, total_parcelas: null },
    ],
  };
  queue = [];
});

async function criar() {
  return W.handleAgendaIntent(U1, detectAgendaIntent("me lembra da fatura do Nubank 3 dias antes")!, { now: NOW, deps: deps() });
}

describe("💳 Ver fatura abre a fatura real", () => {
  test("botão tem ID explícito agenda_view_invoice:<id>", async () => {
    const r = await criar();
    const b = buttons(r);
    expect(b.map((x) => x.title)).toEqual(["💳 Ver fatura", "✏️ Editar aviso", "❌ Cancelar aviso"]);
    expect(b[0].id).toBe(`agenda_view_invoice:${r.itemId}`);
    expect(b.some((x) => x.id.startsWith("agenda_done:"))).toBe(false);
  });

  test("clicar no ID real mostra competência, valor, vencimento, fechamento, limite e compras", async () => {
    const r = await criar();
    const id = buttons(r)[0].id;
    // Mesmo caminho do webhook: button_reply.id → replyIdToTexto → detectAgendaIntent.
    const texto = replyIdToTexto(id, "💳 Ver fatura");
    expect(texto).toBe(id);
    const v = await W.handleAgendaIntent(U1, detectAgendaIntent(texto)!, { now: NOW, deps: deps() });
    const t = nb(v.resposta);
    expect(t).toContain("💳 Fatura Nubank — Novembro/2026");
    expect(t).toContain("💰 Valor atual: R$ 56,00");
    expect(t).toContain("📅 Vencimento: 05/11");
    expect(t).toContain("🗓️ Fechamento: 25/10");
    expect(t).toContain("💳 Limite disponível: R$ 4.944,00");
    expect(t).toContain("Últimas compras:");
    expect(t).toContain("• Mercado — R$ 56,00");
    expect(t.match(/Mercado/g)).toHaveLength(1);
    // Não é o resumo do lembrete.
    expect(t).not.toContain("Aviso em");
    expect(t).not.toContain("Vence em");
    // Ações do lembrete continuam disponíveis depois.
    expect(buttons(v).map((x) => x.title)).toEqual(["✏️ Editar aviso", "❌ Cancelar aviso"]);
  });

  test("mesmos números de 'fatura do Nubank' (mesma fonte)", async () => {
    const r = await criar();
    const v = await W.handleAgendaIntent(U1, detectAgendaIntent(`agenda_view_invoice:${r.itemId}`)!, { now: NOW, deps: deps() });
    const ref = await handleFaturaIntent(U1, { kind: "invoice_card", termo: "nubank" });
    const refT = nb(ref.resposta);
    expect(refT).toContain("R$ 56,00");
    expect(refT).toContain("Vencimento: 05/11");
    expect(refT).toContain("Fechamento: 25/10");
    expect(refT).toContain("R$ 4.944,00");
    expect(nb(v.resposta)).toContain("R$ 56,00");
  });

  test("botão ANTIGO agenda_view:<id> (mensagens já enviadas) também abre a fatura", async () => {
    const r = await criar();
    const texto = replyIdToTexto(`agenda_view:${r.itemId}`, "💳 Ver fatura");
    const v = await W.handleAgendaIntent(U1, detectAgendaIntent(texto)!, { now: NOW, deps: deps() });
    expect(nb(v.resposta)).toContain("💳 Fatura Nubank — Novembro/2026");
    expect(v.resposta).not.toContain("Aviso em");
  });

  test("valor lido na hora do clique", async () => {
    const r = await criar();
    db.gastos.push({ id: "g3", user_id: U1, cartao_id: "c-nu", descricao: "Farmácia", valor: 30, data: "2026-10-01", forma_pagamento: "credito", confirmado: true, invoice_month: null, fatura_competencia: "2026-11", parcela_atual: null, total_parcelas: null });
    const v = await W.handleAgendaIntent(U1, detectAgendaIntent(`agenda_view_invoice:${r.itemId}`)!, { now: NOW, deps: deps() });
    expect(nb(v.resposta)).toContain("💰 Valor atual: R$ 86,00");
    expect(nb(v.resposta)).toContain("Farmácia");
  });
});

describe("sem dupla contagem (mesma compra nas duas consultas)", () => {
  test("1 compra: Cartões(função), 'fatura do Nubank' e Ver fatura = R$ 56 / R$ 4.944 / 1 item", async () => {
    const F = await import("../src/server/cartao-fatura.server");
    const cartao = db.cartoes[0] as never;
    const f = await F.getFaturaAtualPorCartao(U1, cartao);
    const itens = await F.getItensFaturaAtualPorCartao(U1, cartao);
    expect(f.competencia).toBe("2026-11");
    expect(f.total).toBe(56);
    expect(f.disponivel).toBe(4944);
    expect(f.qtd).toBe(1);
    expect(itens).toHaveLength(1);
    const ref = nb((await handleFaturaIntent(U1, { kind: "invoice_card", termo: "nubank" })).resposta);
    expect(ref).toContain("R$ 56,00");
    expect(ref).toContain("R$ 4.944,00");
    const r = await criar();
    const v = nb((await W.handleAgendaIntent(U1, detectAgendaIntent(`agenda_view_invoice:${r.itemId}`)!, { now: NOW, deps: deps() })).resposta);
    expect(v).toContain("💰 Valor atual: R$ 56,00");
    expect(v).toContain("R$ 4.944,00");
  });

  test("2 compras: Mercado 56 + Farmácia 20 = R$ 76, 2 itens, R$ 4.924", async () => {
    db.gastos.push({ id: "g4", user_id: U1, cartao_id: "c-nu", descricao: "Farmácia", valor: 20, data: "2026-10-01", forma_pagamento: "credito", confirmado: true, invoice_month: "2026-10", fatura_competencia: "2026-11", parcela_atual: null, total_parcelas: null });
    const F = await import("../src/server/cartao-fatura.server");
    const cartao = db.cartoes[0] as never;
    const f = await F.getFaturaAtualPorCartao(U1, cartao);
    expect(f.total).toBe(76);
    expect(f.qtd).toBe(2);
    expect(f.disponivel).toBe(4924);
    expect(await F.getItensFaturaAtualPorCartao(U1, cartao)).toHaveLength(2);
  });

  test("legado sem fatura_competencia conta uma vez", async () => {
    db.gastos[0].fatura_competencia = null;
    db.gastos[0].invoice_month = null;
    const F = await import("../src/server/cartao-fatura.server");
    const f = await F.getFaturaAtualPorCartao(U1, db.cartoes[0] as never);
    expect(f.total).toBe(56);
  });
});

describe("regressão: cada Ver abre a entidade certa", () => {
  test("🧾 Ver conta mostra a conta", async () => {
    const r = await W.handleAgendaIntent(U1, detectAgendaIntent("me lembra da conta Internet 3 dias antes")!, { now: NOW, deps: deps() });
    const b = buttons(r)[0];
    expect(b.title).toBe("🧾 Ver conta");
    expect(b.id).toBe(`agenda_view_bill:${r.itemId}`);
    const v = await W.handleAgendaIntent(U1, detectAgendaIntent(b.id)!, { now: NOW, deps: deps() });
    const t = nb(v.resposta);
    expect(t).toContain("🧾 Conta Internet");
    expect(t).toContain("💰 Valor: R$ 120,00");
    expect(t).toContain("📅 Vencimento: 10/10");
    expect(t).not.toContain("Aviso em");
  });

  test("👀 Ver de lembrete comum continua mostrando o lembrete com Concluir", async () => {
    const row = await A.createAgendaItem(U1, { titulo: "Dentista", starts_at: "2026-10-02T17:00:00.000Z" }, deps());
    const v = await W.handleAgendaIntent(U1, detectAgendaIntent(`agenda_view:${row.id}`)!, { now: NOW, deps: deps() });
    expect(v.resposta).toContain("Dentista");
    expect(v.resposta).not.toContain("Fatura");
    expect(buttons(v).map((x) => x.title)).toEqual(["✅ Concluir", "✏️ Editar", "❌ Cancelar"]);
  });
});
