import { describe, expect, test, mock, beforeEach } from "bun:test";

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const { parseWhen, resolveWhen, localParts, localToUtc } = await import("../src/lib/agenda/datetime");
const { nextOccurrence } = await import("../src/lib/agenda/recurrence");
const { detectAgendaIntent } = await import("../src/lib/agenda/intent");
const A = await import("../src/server/agenda.server");
const W = await import("../src/server/whatsapp-agenda.server");

const TZ = "America/Sao_Paulo";
// Quinta, 01/10/2026 10:00 em São Paulo (13:00 UTC).
const NOW = new Date("2026-10-01T13:00:00Z");
const local = (d: Date | null) => {
  const p = localParts(d!, TZ);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")} ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
};
const at = (t: string, now = NOW) => local(resolveWhen(parseWhen(t, now, TZ), now, TZ));

// ---------- banco em memória (mesma "tabela" para site e WhatsApp) ----------
type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
let queue: Row[];
let failDb = false;
function fakeClient() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "insert" | "update" = "select";
      let payload: Row | null = null;
      let rng: [number, number] | null = null;
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
        order: () => q,
        range: (a: number, b: number) => ((rng = [a, b]), q),
        limit: () => q,
        insert: (r: Row) => ((op = "insert"), (payload = r), q),
        update: (r: Row) => ((op = "update"), (payload = r), q),
        run() {
          const t = (db[table] ??= []);
          if (op === "insert") {
            if (table === "agenda_items" && payload!.source_id) {
              const src = payload!.source_type === "cartao" ? "cartoes" : payload!.source_type === "conta_a_pagar" ? "contas_a_pagar" : "recorrencias";
              if (!(db[src] ?? []).some((x) => x.id === payload!.source_id && x.user_id === payload!.user_id))
                return { data: null, error: { message: "agenda_source_not_owned" } };
            }
            const row = { id: crypto.randomUUID(), status: "ativo", updated_at: String(Math.random()), ...payload };
            t.push(row);
            return { data: [row], error: null };
          }
          if (failDb) return { data: null, error: { message: "db down" } };
          let rows = t.filter((r) => filters.every((f) => f(r)));
          if (rng) rows = rows.slice(rng[0], rng[1] + 1);
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
const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
let fatura = { total: 56, venc: new Date(2026, 10, 5) };
const nb = (s: unknown) => JSON.parse(JSON.stringify(s).replace(/\\u00a0|\u00a0/g, " "));
const deps = () => ({
  client: fakeClient(),
  now: () => NOW,
  faturaAtual: async () => ({ total: fatura.total, vencimento: fatura.venc }),
  faturaDetalhe: async () => ({
    fatura: { competencia: "2026-11", total: fatura.total, limite: 5000, disponivel: 5000 - fatura.total, fechamento: new Date(2026, 9, 25), vencimento: fatura.venc },
    itens: [],
  }),
  enqueue: async (i: Row) => void queue.push({ ...i, status: "pending" }),
  cancelPending: async (_u: string, _t: string, id: string) => {
    let n = 0;
    for (const r of queue) if (r.entityId === id && r.status === "pending") (r.status = "cancelled"), n++;
    return n;
  },
});
const pending = (id: string) => queue.filter((q) => q.entityId === id && q.status === "pending");

beforeEach(() => {
  db = {
    agenda_items: [],
    cartoes: [{ id: "c-nu", user_id: U1, nome: "Nubank", dia_fechamento: 25, dia_vencimento: 5, limite_total: 5000 }],
    contas_a_pagar: [
      { id: "k-net", user_id: U1, nome: "Internet", valor: 120, data_vencimento: "2026-10-10", status: "pendente" },
      { id: "k-u2", user_id: U2, nome: "Aluguel", valor: 900, data_vencimento: "2026-10-10", status: "pendente" },
    ],
    recorrencias: [],
  };
  queue = [];
  failDb = false;
  fatura = { total: 56, venc: new Date(2026, 10, 5) };
});

describe("datas e horários (São Paulo)", () => {
  test.each([
    ["hoje às 15h", "2026-10-01 15:00"],
    ["amanhã às 9", "2026-10-02 09:00"],
    ["depois de amanhã 09:00", "2026-10-03 09:00"],
    ["próxima sexta às 14h", "2026-10-02 14:00"],
    ["dia 10 às 2 da tarde", "2026-10-10 14:00"],
    ["10/10 9h", "2026-10-10 09:00"],
    ["10/10/2026 às 08:30", "2026-10-10 08:30"],
    ["daqui 2 horas", "2026-10-01 12:00"],
    ["9h", "2026-10-02 09:00"], // já passou hoje → amanhã
    ["meio-dia", "2026-10-01 12:00"],
  ])("%s", (t, exp) => expect(at(t)).toBe(exp));

  test("virada do mês e do ano", () => {
    const fimMes = new Date("2026-10-31T13:00:00Z");
    expect(at("amanhã às 9", fimMes)).toBe("2026-11-01 09:00");
    const fimAno = new Date("2026-12-31T13:00:00Z");
    expect(at("amanhã às 9", fimAno)).toBe("2027-01-01 09:00");
    expect(at("dia 5 às 10h", fimAno)).toBe("2027-01-05 10:00");
  });

  test("guarda UTC e mostra 09:00 local", () => {
    const d = localToUtc({ y: 2026, m: 10, d: 2 }, { h: 9, mi: 0 }, TZ);
    expect(d.toISOString()).toBe("2026-10-02T12:00:00.000Z");
    expect(local(d)).toBe("2026-10-02 09:00");
    // Outro fuso não supõe São Paulo.
    expect(localToUtc({ y: 2026, m: 10, d: 2 }, { h: 9, mi: 0 }, "Europe/Lisbon").toISOString()).toBe("2026-10-02T08:00:00.000Z");
  });

  test("valor não vira horário", () => {
    expect(parseWhen("pagar 50 amanhã", NOW, TZ).time).toBeNull();
  });
});

describe("recorrência", () => {
  const start = localToUtc({ y: 2026, m: 1, d: 31 }, { h: 9, mi: 0 }, TZ);
  test("mensal no dia 31 usa último dia do mês", () => {
    expect(local(nextOccurrence(start, { freq: "mensal" }, start, TZ))).toBe("2026-02-28 09:00");
  });
  test("semanal/diária/anual e until", () => {
    expect(local(nextOccurrence(start, { freq: "semanal" }, start, TZ))).toBe("2026-02-07 09:00");
    expect(local(nextOccurrence(start, { freq: "diaria", interval: 2 }, start, TZ))).toBe("2026-02-02 09:00");
    expect(local(nextOccurrence(start, { freq: "anual" }, start, TZ))).toBe("2027-01-31 09:00");
    expect(nextOccurrence(start, { freq: "diaria", until: "2026-01-31" }, start, TZ)).toBeNull();
  });
});

describe("intenção: agenda × financeiro", () => {
  test("gastei/paguei continuam financeiros", () => {
    expect(detectAgendaIntent("gastei 50")).toBeNull();
    expect(detectAgendaIntent("paguei 50")).toBeNull();
    expect(detectAgendaIntent("Gastei 89,90 na farmácia no cartão Nubank")).toBeNull();
    expect(detectAgendaIntent("tenho 50 reais disponível?")).toBeNull();
    expect(detectAgendaIntent("cancelar")).toBeNull();
    expect(detectAgendaIntent("qual a fatura do Nubank?")).toBeNull();
  });
  test("me lembra de pagar 50 amanhã → lembrete", () => {
    const i = detectAgendaIntent("me lembra de pagar 50 amanhã");
    expect(i?.type).toBe("criar");
    expect(i && i.type === "criar" && i.titulo).toBe("pagar 50");
  });
  test("frases do escopo", () => {
    expect(detectAgendaIntent("me lembra amanhã às 9 de pagar a internet")?.type).toBe("criar");
    expect(detectAgendaIntent("tenho dentista sexta às 14h")).toMatchObject({ type: "criar", kind: "compromisso", titulo: "dentista" });
    expect(detectAgendaIntent("o que tenho amanhã?")).toEqual({ type: "consultar", periodo: "amanha" });
    expect(detectAgendaIntent("meus lembretes")).toEqual({ type: "consultar", periodo: "proximos" });
    expect(detectAgendaIntent("mude o dentista para 15h")).toMatchObject({ type: "editar", alvo: "dentista" });
    expect(detectAgendaIntent("cancele o lembrete da internet")).toEqual({ type: "cancelar", alvo: "internet" });
    expect(detectAgendaIntent("me lembra da fatura do Nubank 3 dias antes")).toEqual({
      type: "criar_financeiro",
      sourceKind: "cartao",
      nome: "nubank",
      diasAntes: 3,
    });
  });
});

describe("site + WhatsApp na mesma agenda", () => {
  test("A/D/E: cria no WhatsApp → site vê; edita e cancela no WhatsApp → site vê", async () => {
    const d = deps();
    const r = await W.handleAgendaIntent(U1, detectAgendaIntent("me lembra amanhã às 9 de pagar a internet")!, { now: NOW, deps: d });
    expect(r.resposta).toContain("🕘 09:00");
    const site = await A.listAgenda(U1, { status: "ativo" }, d);
    expect(site).toHaveLength(1);
    expect(site[0].origem).toBe("whatsapp");
    expect(site[0].starts_at).toBe("2026-10-02T12:00:00.000Z");
    await W.handleAgendaIntent(U1, detectAgendaIntent("mude a internet para 15h")!, { now: NOW, deps: d });
    expect((await A.getAgendaItem(U1, site[0].id, d))!.starts_at).toBe("2026-10-02T18:00:00.000Z");
    await W.handleAgendaIntent(U1, detectAgendaIntent("cancele o lembrete da internet")!, { now: NOW, deps: d });
    expect((await A.getAgendaItem(U1, site[0].id, d))!.status).toBe("cancelado");
    expect(pending(site[0].id)).toHaveLength(0);
  });

  test("B/C: cria e edita no site → WhatsApp vê atualizado", async () => {
    const d = deps();
    const row = await A.createAgendaItem(U1, { kind: "compromisso", titulo: "Dentista", starts_at: "2026-10-02T17:00:00.000Z" }, d);
    let r = await W.handleAgendaIntent(U1, detectAgendaIntent("o que tenho amanhã?")!, { now: NOW, deps: d });
    expect(r.resposta).toContain("Dentista — Amanhã às 14:00");
    await A.updateAgendaItem(U1, row.id, { starts_at: "2026-10-02T18:00:00.000Z" }, d);
    r = await W.handleAgendaIntent(U1, detectAgendaIntent("o que tenho amanhã?")!, { now: NOW, deps: d });
    expect(r.resposta).toContain("Dentista — Amanhã às 15:00");
    await A.setAgendaStatus(U1, row.id, "cancelar", d);
    r = await W.handleAgendaIntent(U1, detectAgendaIntent("o que tenho amanhã?")!, { now: NOW, deps: d });
    expect(r.resposta).toContain("Nada na sua agenda");
  });

  test("usuário B não vê nem altera a agenda de A", async () => {
    const d = deps();
    const row = await A.createAgendaItem(U1, { titulo: "Dentista", starts_at: "2026-10-02T17:00:00.000Z" }, d);
    expect(await A.listAgenda(U2, {}, d)).toHaveLength(0);
    const r = await W.handleAgendaIntent(U2, { type: "acao_id", acao: "cancelar", id: row.id }, { now: NOW, deps: d });
    expect(r.resposta).toContain("não está mais");
    expect((await A.getAgendaItem(U1, row.id, d))!.status).toBe("ativo");
  });

  test("botão Concluir; recorrente avança", async () => {
    const d = deps();
    const row = await A.createAgendaItem(U1, { titulo: "Remédio", starts_at: "2026-10-02T12:00:00.000Z", recurrence_freq: "diaria" }, d);
    const r = await W.handleAgendaIntent(U1, detectAgendaIntent(`agenda_done:${row.id}`)!, { now: NOW, deps: d });
    expect(r.resposta).toContain("Próxima vez");
    const cur = (await A.getAgendaItem(U1, row.id, d))!;
    expect(cur.status).toBe("ativo");
    expect(cur.starts_at).toBe("2026-10-03T12:00:00.000Z");
  });
});

describe("lembretes financeiros (sem snapshot)", () => {
  test("1/9/10: conta — source_id certo e dono validado", async () => {
    const d = deps();
    const it = await A.createAgendaItem(U1, { titulo: "Conta Internet", source_type: "conta_a_pagar", source_id: "k-net", aviso_dias_antes: 3 }, d);
    expect(it.source_id).toBe("k-net");
    expect(it.starts_at).toBeNull();
    expect(pending(it.id)[0].scheduledAt).toEqual(localToUtc({ y: 2026, m: 10, d: 7 }, { h: 9, mi: 0 }, TZ));
    await expect(
      A.createAgendaItem(U1, { titulo: "x", source_type: "conta_a_pagar", source_id: "k-u2" }, d),
    ).rejects.toMatchObject({ code: "source_not_owned" });
  });

  test("2/7: fatura pelo WhatsApp usa cartão como origem e valor atual", async () => {
    const d = deps();
    const r = await W.handleAgendaIntent(U1, detectAgendaIntent("me lembra da fatura do Nubank 3 dias antes")!, { now: NOW, deps: d });
    expect(nb(r.resposta)).toContain("R$ 56,00");
    const it = (await A.listAgenda(U1, {}, d))[0];
    expect(it).toMatchObject({ source_type: "cartao", source_id: "c-nu", aviso_dias_antes: 3 });
    const n = pending(it.id)[0];
    fatura.total = 356; // fatura subiu depois
    const ok = await A.revalidateAgendaForDispatch(
      { user_id: U1, category: "agenda", entity_type: "agenda_item", entity_id: it.id, payload: n.payload as Row },
      { ...d, now: () => new Date("2026-11-02T12:00:00Z") },
    );
    expect(nb(ok.ok && ok.vars?.params[2])).toBe("R$ 356,00");
  });

  test("3/4/8: valor e vencimento mudam → aviso acompanha", async () => {
    const d = deps();
    const it = await A.createAgendaItem(U1, { titulo: "Conta Internet", source_type: "conta_a_pagar", source_id: "k-net", aviso_dias_antes: 3 }, d);
    const old = pending(it.id)[0];
    const conta = db.contas_a_pagar[0];
    conta.data_vencimento = "2026-10-15";
    conta.valor = 150;
    const r = await A.revalidateAgendaForDispatch(
      { user_id: U1, category: "agenda", entity_type: "agenda_item", entity_id: it.id, payload: old.payload as Row },
      d,
    );
    expect(r).toEqual({ ok: false, reason: "agenda_changed" });
    const novo = pending(it.id).at(-1)!;
    expect(novo.scheduledAt).toEqual(localToUtc({ y: 2026, m: 10, d: 12 }, { h: 9, mi: 0 }, TZ));
    const ok = await A.revalidateAgendaForDispatch(
      { user_id: U1, category: "agenda", entity_type: "agenda_item", entity_id: it.id, payload: novo.payload as Row },
      d,
    );
    expect(nb(ok.ok && ok.vars?.params)).toEqual(["Conta Internet", "14 dias", "R$ 150,00", "15/10/2026"]);
  });

  test("5/6: conta paga ou cancelada não envia", async () => {
    const d = deps();
    const it = await A.createAgendaItem(U1, { titulo: "Conta Internet", source_type: "conta_a_pagar", source_id: "k-net", aviso_dias_antes: 3 }, d);
    const n = { user_id: U1, category: "agenda", entity_type: "agenda_item", entity_id: it.id, payload: pending(it.id)[0].payload as Row };
    db.contas_a_pagar[0].status = "pago";
    expect(await A.revalidateAgendaForDispatch(n, d)).toEqual({ ok: false, reason: "payable_paid" });
    db.contas_a_pagar[0].status = "cancelado";
    expect(await A.revalidateAgendaForDispatch(n, d)).toEqual({ ok: false, reason: "payable_cancelled" });
  });

  test("item cancelado não envia", async () => {
    const d = deps();
    const it = await A.createAgendaItem(U1, { titulo: "Dentista", starts_at: "2026-10-02T17:00:00.000Z" }, d);
    const payload = pending(it.id)[0].payload as Row;
    await A.setAgendaStatus(U1, it.id, "cancelar", d);
    expect(
      await A.revalidateAgendaForDispatch({ user_id: U1, category: "agenda", entity_type: "agenda_item", entity_id: it.id, payload }, d),
    ).toEqual({ ok: false, reason: "agenda_inactive" });
  });
});

describe("UX pós-criação (sem Concluir imediato)", () => {
  const ids = (r: { graphInteractive?: Record<string, unknown> }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((r.graphInteractive as any)?.action?.buttons ?? []).map((b: any) => b.reply as { id: string; title: string });

  test("1/2: lembrete comum recém-criado mostra Editar e Cancelar, sem Concluir", async () => {
    const d = deps();
    const r = await W.handleAgendaIntent(U1, detectAgendaIntent("me lembra amanhã às 9 de pagar a internet")!, { now: NOW, deps: d });
    const b = ids(r);
    expect(b.map((x: { title: string }) => x.title)).toEqual(["✏️ Editar", "❌ Cancelar"]);
    expect(b.some((x: { id: string }) => x.id.startsWith("agenda_done:"))).toBe(false);
    expect(r.resposta).toContain("🔔 Pagar a internet");
    expect(r.resposta).toContain("📅 Amanhã");
    expect(r.resposta).toContain("🕘 09:00");
  });

  test("3/4/6/7/8: fatura mostra Ver fatura, aviso 02/11 e valor atual só informativo", async () => {
    const d = deps();
    const r = await W.handleAgendaIntent(U1, detectAgendaIntent("me lembra da fatura do Nubank 3 dias antes")!, { now: NOW, deps: d });
    expect(ids(r).map((x: { title: string }) => x.title)).toEqual(["💳 Ver fatura", "✏️ Editar aviso", "❌ Cancelar aviso"]);
    expect(r.resposta).toContain("📅 Vence em 05/11");
    expect(r.resposta).toContain("🔔 Aviso em 02/11 (3 dias antes)");
    expect(nb(r.resposta)).toContain("💰 Valor atual: R$ 56,00");
    expect(r.resposta).toContain("conferidos novamente no momento do aviso");
    const it = (await A.listAgenda(U1, {}, d))[0] as Row;
    expect(it.source_type).toBe("cartao");
    expect(it.source_id).toBe("c-nu");
    expect(it.descricao).toBeNull();
    expect(it).not.toHaveProperty("valor");
  });

  test("5: conta mostra Ver conta", async () => {
    const d = deps();
    const r = await W.handleAgendaIntent(U1, detectAgendaIntent("me lembra da conta Internet 3 dias antes")!, { now: NOW, deps: d });
    expect(ids(r)[0]?.title).toBe("🧾 Ver conta");
    expect(r.resposta).toContain("🔔 Aviso em 07/10 (3 dias antes)");
  });

  test("9: Ver lê a fonte financeira de novo", async () => {
    const d = deps();
    const c = await W.handleAgendaIntent(U1, detectAgendaIntent("me lembra da fatura do Nubank 3 dias antes")!, { now: NOW, deps: d });
    fatura.total = 200;
    const v = await W.handleAgendaIntent(U1, detectAgendaIntent(`agenda_view:${c.itemId}`)!, { now: NOW, deps: d });
    expect(nb(v.resposta)).toContain("R$ 200,00");
  });

  test("editar aviso: muda dias antes e recalcula a data", async () => {
    const d = deps();
    await W.handleAgendaIntent(U1, detectAgendaIntent("me lembra da fatura do Nubank 3 dias antes")!, { now: NOW, deps: d });
    const r = await W.handleAgendaIntent(U1, detectAgendaIntent("mude o aviso da fatura nubank para 5 dias antes")!, { now: NOW, deps: d });
    expect(r.resposta).toContain("🔔 Aviso em 31/10 (5 dias antes)");
    const e = await W.handleAgendaIntent(U1, detectAgendaIntent(`agenda_edit:${r.itemId}`)!, { now: NOW, deps: d });
    expect(e.resposta).toContain("dias antes");
  });

  test("10: Concluir continua disponível ao abrir um item existente", async () => {
    const d = deps();
    const row = await A.createAgendaItem(U1, { titulo: "Dentista", starts_at: "2026-10-02T17:00:00.000Z" }, d);
    const v = await W.handleAgendaIntent(U1, detectAgendaIntent(`agenda_view:${row.id}`)!, { now: NOW, deps: d });
    expect(ids(v).map((x: { title: string }) => x.title)).toEqual(["✅ Concluir", "✏️ Editar", "❌ Cancelar"]);
    const done = await W.handleAgendaIntent(U1, detectAgendaIntent(`agenda_done:${row.id}`)!, { now: NOW, deps: d });
    expect(done.resposta).toContain("concluído");
  });
});

describe("comandos sem alvo (2026-10-12)", () => {
  const run = (u: string, t: string, d: ReturnType<typeof deps>) =>
    W.handleAgendaIntent(u, detectAgendaIntent(t)!, { now: NOW, tz: TZ, deps: d });

  test("frases sem nome viram 'escolher', nunca cancelar/concluir direto", () => {
    expect(detectAgendaIntent("cancelar lembrete")).toEqual({ type: "escolher", acao: "cancelar" });
    expect(detectAgendaIntent("marcar como concluído")).toEqual({ type: "escolher", acao: "concluir" });
    expect(detectAgendaIntent("concluir")).toEqual({ type: "escolher", acao: "concluir" });
    expect(detectAgendaIntent("adiar para amanhã")?.type).toBe("escolher");
    expect(detectAgendaIntent("cancelar")).toBeNull(); // pertence às sessões pendentes
  });

  test("cancelar lembrete lista só itens do próprio usuário e não altera nada", async () => {
    const d = deps();
    await run(U1, "me lembra amanhã às 9 de pagar a internet", d);
    await run(U2, "me lembra amanhã às 10 de ligar pro banco", d);
    const r = await run(U1, "cancelar lembrete", d);
    expect(r.resposta).toContain("Pagar a internet");
    expect(r.resposta).not.toContain("igar pro banco");
    const rows = (r.graphInteractive as any).action.sections[0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].id.startsWith("agenda_cancel:")).toBe(true);
    expect(db.agenda_items.every((x) => x.status === "ativo")).toBe(true);
  });

  test("outro usuário não consegue cancelar pelo id", async () => {
    const d = deps();
    await run(U1, "me lembra amanhã às 9 de pagar a internet", d);
    const id = db.agenda_items[0].id as string;
    await run(U2, `agenda_cancel:${id}`, d);
    expect(db.agenda_items[0].status).toBe("ativo");
  });

  test("sem itens: resposta útil", async () => {
    expect((await run(U1, "concluir", deps())).resposta).toContain("não tem lembretes ativos");
  });

  test("adiar sem nome lista só lembretes únicos e pede o nome", async () => {
    const d = deps();
    await run(U1, "me lembra amanhã às 9 de pagar a internet", d);
    await run(U1, "me lembra todo dia às 8h de tomar remedio", d);
    const r = await run(U1, "adiar para amanhã", d);
    expect(r.resposta).toContain("Pagar a internet");
    expect(r.resposta).not.toContain("omar remedio");
  });

  test("adiar lembrete recorrente explica o limite e não altera a série", async () => {
    const d = deps();
    await run(U1, "me lembra todo dia às 8h de tomar remedio", d);
    const before = db.agenda_items[0].starts_at;
    const r = await run(U1, "adie o lembrete tomar remedio para amanhã", d);
    expect(r.resposta).toContain("se repete");
    expect(db.agenda_items[0].starts_at).toBe(before);
  });

  test("adiar lembrete único move no fuso do item, mantendo a hora", async () => {
    const d = deps();
    await run(U1, "me lembra amanhã às 9 de pagar a internet", d);
    await run(U1, "adie o lembrete pagar a internet para depois de amanhã", d);
    expect(local(new Date(db.agenda_items[0].starts_at as string))).toBe("2026-10-03 09:00");
  });
});

describe("cancelar lembrete com páginas e confirmação (2026-10-12)", () => {
  const run = (u: string, t: string, d: ReturnType<typeof deps>, now = NOW) =>
    W.handleAgendaIntent(u, detectAgendaIntent(t)!, { now, tz: TZ, deps: d });
  const rowsOf = (r: { graphInteractive?: unknown }) => (r.graphInteractive as any).action.sections[0].rows as Array<{ id: string; title: string }>;
  const btnsOf = (r: { graphInteractive?: unknown }) => (r.graphInteractive as any).action.buttons.map((b: any) => b.reply.id) as string[];
  const seed = (n: number, u = U1, extra: Row = {}) => {
    for (let i = 0; i < n; i++)
      db.agenda_items.push({ id: crypto.randomUUID(), user_id: u, status: "ativo", kind: "lembrete", titulo: `Item ${i + 1}`,
        starts_at: new Date(NOW.getTime() + (i + 1) * 3600_000).toISOString(), timezone: TZ, origem: i % 2 ? "site" : "whatsapp", ...extra });
  };

  test("lista inclui itens do site, do WhatsApp, recorrentes e avisos financeiros; nunca de outro usuário", async () => {
    const d = deps();
    await run(U1, "me lembra todo dia às 8h de tomar remedio", d);
    await run(U1, "me lembra da conta internet 2 dias antes", d);
    seed(1, U1, { titulo: "Dentista", origem: "site" });
    seed(3, U2, { titulo: "Segredo do outro" });
    const r = await run(U1, "cancelar lembrete", d);
    expect(r.resposta).toContain("omar remedio");
    expect(r.resposta).toContain("todo dia");
    expect(r.resposta).toContain("Dentista");
    expect(r.resposta).toContain("Site");
    expect(r.resposta).toContain("não apaga a conta");
    expect(r.resposta).not.toContain("Segredo do outro");
    expect(rowsOf(r).filter((x) => x.id.startsWith("agenda_cancel:"))).toHaveLength(db.agenda_items.filter((x) => x.user_id === U1).length);
  });

  test(">10 itens: páginas de 8 + navegação, todos acessíveis sem repetir", async () => {
    seed(25);
    const d = deps();
    const seen = new Set<string>();
    let r = await run(U1, "cancelar lembrete", d);
    for (let p = 0; p < 10; p++) {
      const rows = rowsOf(r);
      expect(rows.length).toBeLessThanOrEqual(10);
      for (const x of rows.filter((x) => x.id.startsWith("agenda_cancel:"))) {
        expect(seen.has(x.id)).toBe(false);
        seen.add(x.id);
      }
      const next = rows.find((x) => x.id.startsWith("agenda_cpage:") && x.title.includes("Próximos"));
      if (!next) break;
      r = await run(U1, next.id, d);
    }
    expect(seen.size).toBe(25);
    const back = rowsOf(r).find((x) => x.title.includes("Anteriores"));
    expect(back).toBeTruthy();
  });

  test(">200 itens: a última página continua alcançável (sem limite de 200)", async () => {
    seed(205);
    const r = await run(U1, "agenda_cpage:25", deps());
    expect(r.resposta).toContain("Item 201");
    expect(r.resposta).toContain("Item 205");
  });

  test("tocar no item NÃO cancela: mostra resumo com Confirmar/Voltar", async () => {
    const d = deps();
    await run(U1, "me lembra amanhã às 9 de pagar a internet", d);
    const id = db.agenda_items[0].id as string;
    const r = await run(U1, `agenda_cancel:${id}`, d);
    expect(db.agenda_items[0].status).toBe("ativo");
    const ids = btnsOf(r);
    expect(ids[0].startsWith(`agenda_cancel_ok:${id}:`)).toBe(true);
    expect(ids[1]).toBe("agenda_cancel_back");
  });

  test("confirmar cancela (soft), retry não repete, histórico preservado", async () => {
    const d = deps();
    await run(U1, "me lembra amanhã às 9 de pagar a internet", d);
    const id = db.agenda_items[0].id as string;
    const ok = btnsOf(await run(U1, `agenda_cancel:${id}`, d))[0];
    const r1 = await run(U1, ok, d);
    expect(r1.resposta).toContain("histórico fica preservado");
    expect(db.agenda_items).toHaveLength(1);
    expect(db.agenda_items[0].status).toBe("cancelado");
    const cancelledAt = db.agenda_items[0].cancelled_at;
    const r2 = await run(U1, ok, d);
    expect(r2.resposta).toContain("já está cancelado");
    expect(db.agenda_items[0].cancelled_at).toBe(cancelledAt);
  });

  test("Voltar não altera nada e reabre a lista", async () => {
    const d = deps();
    await run(U1, "me lembra amanhã às 9 de pagar a internet", d);
    const r = await run(U1, "agenda_cancel_back", d);
    expect(r.resposta).toContain("Qual item você quer cancelar");
    expect(db.agenda_items[0].status).toBe("ativo");
  });

  test("confirmação expirada (>30 min) não cancela", async () => {
    const d = deps();
    await run(U1, "me lembra amanhã às 9 de pagar a internet", d);
    const id = db.agenda_items[0].id as string;
    const ok = btnsOf(await run(U1, `agenda_cancel:${id}`, d))[0];
    const later = new Date(NOW.getTime() + 31 * 60_000);
    const r = await run(U1, ok, deps(), later);
    expect(r.resposta).toContain("expirou");
    expect(db.agenda_items[0].status).toBe("ativo");
  });

  test("confirmação de A usada por B não cancela o item de A", async () => {
    const d = deps();
    await run(U1, "me lembra amanhã às 9 de pagar a internet", d);
    const id = db.agenda_items[0].id as string;
    const ok = btnsOf(await run(U1, `agenda_cancel:${id}`, d))[0];
    const r = await run(U2, ok, d);
    expect(r.resposta).toContain("não está mais na sua agenda");
    expect(db.agenda_items[0].status).toBe("ativo");
  });

  test("aviso financeiro: cancelar só o aviso, a conta continua pendente", async () => {
    const d = deps();
    await run(U1, "me lembra da conta internet 2 dias antes", d);
    const id = db.agenda_items[0].id as string;
    const ask = await run(U1, `agenda_cancel:${id}`, d);
    expect(ask.resposta).toContain("cancela só o aviso");
    await run(U1, btnsOf(ask)[0], d);
    expect(db.agenda_items[0].status).toBe("cancelado");
    expect(db.contas_a_pagar.find((x) => x.id === "k-net")!.status).toBe("pendente");
  });

  test("'sim' ou 'não' soltos não confirmam cancelamento", () => {
    expect(detectAgendaIntent("sim")).toBeNull();
    expect(detectAgendaIntent("não")).toBeNull();
    expect(detectAgendaIntent("confirmar cancelamento")).toEqual({ type: "escolher", acao: "cancelar" });
  });

  test("0 itens ativos: mensagem clara", async () => {
    expect((await run(U1, "cancelar lembrete", deps())).resposta).toContain("não tem lembretes ativos");
  });

  test("falha do banco: mensagem amigável, nada alterado", async () => {
    seed(2);
    failDb = true;
    const r = await run(U1, "cancelar lembrete", deps());
    expect(r.resposta).toContain("Não consegui abrir sua agenda");
  });

  test("histórico mostra cancelados quando pedido", async () => {
    seed(1, U1, { status: "cancelado", titulo: "Velho" });
    expect((await run(U1, "historico de lembretes", deps())).resposta).toContain("Velho");
  });

  test("IDs de página/confirmação passam pelo conversor de botões", async () => {
    const { replyIdToTexto } = await import("../src/server/whatsapp-interactive.server");
    expect(replyIdToTexto("agenda_cpage:3", "➡️ Próximos")).toBe("agenda_cpage:3");
    expect(replyIdToTexto("agenda_cancel_back", "Voltar")).toBe("agenda_cancel_back");
    const ok = `agenda_cancel_ok:${crypto.randomUUID()}:abc`;
    expect(replyIdToTexto(ok, "Confirmar")).toBe(ok);
  });
});
