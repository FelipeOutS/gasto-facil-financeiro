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
        order: () => q,
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
const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
let fatura = { total: 56, venc: new Date(2026, 10, 5) };
const nb = (s: unknown) => JSON.parse(JSON.stringify(s).replace(/\\u00a0|\u00a0/g, " "));
const deps = () => ({
  client: fakeClient(),
  now: () => NOW,
  faturaAtual: async () => ({ total: fatura.total, vencimento: fatura.venc }),
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
    expect(JSON.stringify(it)).not.toContain("56");
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
