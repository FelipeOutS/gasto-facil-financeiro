/**
 * P1 (14/10/2026) — exclusão/restauração de um mês inteiro pelo WhatsApp.
 * Somente fakes locais (sem rede, sem banco real, sem Meta). A RPC é
 * simulada aqui com a MESMA semântica da candidata SQL (tudo-ou-nada,
 * snapshot de IDs+updated_at, replay por batch); a atomicidade real é
 * testada em PostgreSQL descartável por scripts/test-whatsapp-lote-mes-sql.sh.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks, fakeAdmin } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { handleLoteMes, detectLoteMes, extrairPeriodo, frasePara, LOTE_MES_RELEASE_AUTHORIZED } = await import("../src/server/whatsapp-lote-mes.server");
const { replyIdToTexto } = await import("../src/server/whatsapp-interactive.server");

const T0 = "2026-01-01T00:00:00.000Z";
const g = (o: Record<string, unknown>) => ({ user_id: "u1", deleted_at: null, updated_at: T0, forma_pagamento: "pix", cartao_id: null,
  grupo_parcelamento_id: null, total_parcelas: 1, recorrencia_id: null, bem_id: null, import_batch_id: null, descricao: "", ...o });
const rc = (o: Record<string, unknown>) => ({ user_id: "u1", deleted_at: null, updated_at: T0, recorrencia_id: null, import_batch_id: null, ...o });
const G = () => state.gastosData as any[];
const R = () => state.receitasData as any[];

let lotes: any[] = []; let rpcCalls: string[] = []; let rpcMode: "ok" | "missing" | "fail" | "throw" = "ok"; let tick = 0;
const stamp = () => new Date(Date.parse("2026-10-14T12:00:00Z") + ++tick * 1000).toISOString();
function rpc(name: string, a: any) {
  rpcCalls.push(name);
  if (rpcMode === "missing") return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
  if (rpcMode === "throw") throw new Error("timeout");
  if (name === "wa_lote_mes_excluir") {
    const prev = lotes.find((l) => l.id === a.p_batch_id);
    if (prev) return { data: { status: "replay", count: prev.item_ids.length }, error: null };
    const rows = (a.p_tipo === "gastos" ? G() : R()).filter((r) => r.user_id === a.p_user_id && r.deleted_at === null &&
      r.data.startsWith(`${a.p_ano}-${String(a.p_mes).padStart(2, "0")}`) && !r.recorrencia_id && !r.import_batch_id &&
      (a.p_tipo === "receitas" || (!r.grupo_parcelamento_id && Number(r.total_parcelas ?? 1) <= 1 && !r.bem_id && !r.cartao_id && r.forma_pagamento !== "credito" &&
        !(state.generic.contas_a_pagar ?? []).some((c) => c.gasto_id === r.id)))).sort((x, y) => x.id.localeCompare(y.id));
    const ids = a.p_ids.map((id: string, i: number) => [id, a.p_versions[i]]).sort((x: any, y: any) => x[0].localeCompare(y[0]));
    if (rows.length !== ids.length || rows.some((r, i) => r.id !== ids[i][0] || r.updated_at !== ids[i][1])) return { data: { status: "changed", count: rows.length }, error: null };
    if (rpcMode === "fail") return { data: null, error: { code: "40001", message: "contagem_divergente" } }; // rollback: nada mudou
    const s = stamp();
    for (const r of rows) { r.deleted_at = s; r.updated_at = s; }
    lotes.push({ id: a.p_batch_id, user_id: a.p_user_id, tipo: a.p_tipo, ano: a.p_ano, mes: a.p_mes, item_ids: rows.map((r) => r.id), deleted_stamp: s, status: "excluido", created_at: s });
    return { data: { status: "deleted", count: rows.length }, error: null };
  }
  if (name === "wa_lote_mes_restaurar") {
    const l = lotes.find((x) => x.id === a.p_batch_id);
    if (!l || l.user_id !== a.p_user_id) return { data: null, error: { code: "42501", message: "lote" } };
    if (l.status === "restaurado") return { data: { status: "replay", count: 0 }, error: null };
    const rows = (l.tipo === "gastos" ? G() : R()).filter((r) => l.item_ids.includes(r.id) && r.deleted_at === l.deleted_stamp);
    if (rows.length !== a.p_expected) return { data: { status: "changed", count: rows.length }, error: null };
    for (const r of rows) { r.deleted_at = null; r.updated_at = stamp(); }
    l.status = "restaurado";
    return { data: { status: "restored", count: rows.length }, error: null };
  }
  return fakeAdmin.rpc(name, a);
}
const db = { from: (t: string) => {
  if (t === "whatsapp_lote_mes_acoes") {
    state.generic.whatsapp_lote_mes_acoes = lotes;
  }
  return fakeAdmin.from(t);
}, rpc };

let n = 0; let nonceN = 0;
const deps = () => ({ db, releaseAuthorized: true, nonce: () => (++nonceN).toString(16).padStart(12, "0"), now: () => new Date("2026-10-14T15:00:00Z") });
const send = async (texto: string, user = "u1", ext?: string) => {
  const r = await handleLoteMes({ userId: user, phone: user === "u1" ? "5511999998888" : "5511777776666", externalId: ext ?? `lm-${++n}`, text: texto, podeIniciar: detectLoteMes(texto) !== null }, deps());
  return r ? { ...r, resposta: r.resposta.replace(/\u00a0/g, " ") } : null;
};
const last = (): any => {
  const rows = (state.generic.whatsapp_messages ?? []).filter((m) => m.parsed?.kind === "wa_lote_mes");
  return rows.sort((a, b) => (b.parsed.seq ?? 0) - (a.parsed.seq ?? 0))[0]?.parsed;
};
const tap = (cmd: string) => send(replyIdToTexto(`wa_lm:${last().nonce}:${cmd}`, cmd));
const ativos = (user = "u1") => G().filter((x) => x.user_id === user && x.deleted_at === null);
const somaAtivosSet = () => ativos().filter((x) => x.data.startsWith("2026-09")).reduce((s, x) => s + x.valor, 0);

const setembro = () => resetState({ gastos: [
  g({ id: "s1", descricao: "Mercado", valor: 10, data: "2026-09-01" }),
  g({ id: "s2", descricao: "Mercado", valor: 20, data: "2026-09-15" }),
  g({ id: "s3", descricao: "Uber", valor: 30.5, data: "2026-09-30", forma_pagamento: "debito" }),
  g({ id: "p1", descricao: "TV", valor: 100, data: "2026-09-10", grupo_parcelamento_id: "gp", total_parcelas: 10, forma_pagamento: "credito" }),
  g({ id: "c1", descricao: "Loja", valor: 50, data: "2026-09-11", cartao_id: "c", forma_pagamento: "credito" }),
  g({ id: "old", descricao: "Antigo", valor: 5, data: "2026-09-13", deleted_at: "2026-09-20T00:00:00Z" }),
  g({ id: "out", descricao: "Outubro", valor: 7, data: "2026-10-01" }),
  g({ id: "b1", user_id: "u2", descricao: "Mercado", valor: 99, data: "2026-09-01" }),
], receitas: [rc({ id: "r1", descricao: "Salário", valor: 3000, data: "2026-08-05" }), rc({ id: "r2", descricao: "Freela", valor: 500, data: "2026-08-20" }),
  rc({ id: "r3", descricao: "Aluguel", valor: 900, data: "2026-08-10", recorrencia_id: "rec" })] });

beforeEach(() => { resetState(); lotes = []; rpcCalls = []; rpcMode = "ok"; n = 0; tick = 0; });

test("trava de liberação: desligada no código", () => { expect(LOTE_MES_RELEASE_AUTHORIZED).toBe(false); });

test("parser: mês/ano explícitos, ausência e ambiguidade", () => {
  expect(extrairPeriodo("excluir todos os gastos de setembro de 2026")).toEqual({ kind: "ok", ano: 2026, mes: 9 });
  expect(extrairPeriodo("apagar receitas 08/2026")).toEqual({ kind: "ok", ano: 2026, mes: 8 });
  expect(extrairPeriodo("março 2026")).toEqual({ kind: "ok", ano: 2026, mes: 3 });
  expect(extrairPeriodo("excluir todos os gastos de setembro").kind).toBe("ausente");
  expect(extrairPeriodo("excluir todos os gastos deste mês").kind).toBe("ausente");
  expect(extrairPeriodo("gastos de agosto de 2026 e setembro de 2026").kind).toBe("ambiguo");
});

test("intenção: lote vs individual; gastos vs receitas; ambos", () => {
  expect(detectLoteMes("Excluir todos os gastos de setembro de 2026")).toMatchObject({ acao: "excluir", tipo: "gastos" });
  expect(detectLoteMes("Apagar minhas receitas de agosto de 2026")).toMatchObject({ acao: "excluir", tipo: "receitas" });
  expect(detectLoteMes("Restaurar os gastos que excluí de setembro de 2026")).toMatchObject({ acao: "restaurar", tipo: "gastos" });
  expect(detectLoteMes("excluir todas as movimentações de setembro de 2026")?.tipo).toBe("ambos");
  expect(detectLoteMes("Quero excluir o gasto TESTE EDICAO WHATSAPP")).toBeNull();
  expect(detectLoteMes("excluir um gasto de outubro de 2026")).toBeNull();
  expect(detectLoteMes("restaurar o gasto mercado")).toBeNull();
  expect(detectLoteMes("excluir todas as contas de setembro de 2026")).toBeNull();
  expect(detectLoteMes("gastei 50 no mercado")).toBeNull();
});

test("pipeline (trava desligada): pedido em lote não cai no individual nem no cadastro; nada alterado", async () => {
  setembro();
  const antes = JSON.stringify(G());
  const r = await processarMensagemWhatsApp({ telefone: "5511999998888", texto: "Excluir todos os gastos de setembro de 2026", external_id: "pl-1" });
  expect(String(r.resposta)).toContain("ainda não está disponível");
  expect(String(r.resposta)).toContain("Nada foi alterado");
  expect(state.pendingRow).toBeNull();
  expect(JSON.stringify(G())).toBe(antes);
  expect((state.generic.whatsapp_messages ?? []).some((m) => m.parsed?.kind === "wa_edit_old")).toBe(false);
});

test("sem mês/ano: pede esclarecimento, sem assumir mês atual", async () => {
  setembro();
  const r = await send("Excluir todos os gastos de setembro");
  expect(r!.resposta).toContain("De qual mês e ano");
  expect(last().stage).toBe("periodo");
  const r2 = await send("setembro de 2026");
  expect(r2!.resposta).toContain("Prévia");
  expect(rpcCalls).toHaveLength(0);
});

test("movimentações: exige escolher o tipo", async () => {
  setembro();
  const r = await send("excluir todas as movimentações de setembro de 2026");
  expect(r!.resposta).toContain("separadamente");
  await tap("tr");
  expect(last().tipo).toBe("receitas");
  expect(last().stage).toBe("preview");
});

test("prévia: contagem, soma, bloqueados por motivo, sem alterar nada", async () => {
  setembro();
  const r = await send("Excluir todos os gastos de setembro de 2026");
  expect(r!.resposta).toContain("3 gastos serão excluídos — total R$ 60,50");
  expect(r!.resposta).toContain("1 gasto bloqueado(s) — parcelados — total R$ 100,00 (NÃO serão alterados");
  expect(r!.resposta).toContain("1 gasto bloqueado(s) — no cartão de crédito — total R$ 50,00");
  expect(last().items.map((i: any) => i.id).sort()).toEqual(["s1", "s2", "s3"]);
  expect(ativos()).toHaveLength(6);
  expect(rpcCalls).toHaveLength(0);
});

test("fluxo completo: Continuar + frase exata; totais antes/depois; outro usuário intacto; descrição repetida", async () => {
  setembro();
  expect(somaAtivosSet()).toBe(210.5);
  await send("Excluir todos os gastos de setembro de 2026");
  const f = await tap("go");
  expect(f!.resposta).toContain("EXCLUIR GASTOS 09/2026");
  expect(rpcCalls).toHaveLength(0);
  const errada = await send("excluir gastos setembro");
  expect(errada!.resposta).toContain("Frase diferente");
  expect(rpcCalls).toHaveLength(0);
  const ok = await send("excluir gastos 09/2026");
  expect(ok!.resposta).toContain("Pronto: excluí 3 gastos");
  expect(somaAtivosSet()).toBe(150);
  expect(ativos("u2")).toHaveLength(1);
  expect(G().find((x) => x.id === "out").deleted_at).toBeNull();
  expect(G().length).toBe(8); // sem DELETE físico
});

test("Confirmar só com botão não executa (exige frase)", async () => {
  setembro();
  await send("Excluir todos os gastos de setembro de 2026");
  await tap("go");
  const r = await tap("go");
  expect(r!.resposta).toContain("expirou");
  expect(rpcCalls).toHaveLength(0);
});

test("conjunto mudou após a prévia (site): recalcula, nada gravado", async () => {
  setembro();
  await send("Excluir todos os gastos de setembro de 2026");
  await tap("go");
  G().find((x) => x.id === "s2").updated_at = "2026-10-14T14:00:00.000Z"; // edição no site
  G().push(g({ id: "s4", descricao: "Padaria", valor: 8, data: "2026-09-20" }));
  const r = await send("EXCLUIR GASTOS 09/2026");
  expect(r!.resposta).toContain("mudaram desde a prévia");
  expect(r!.resposta).toContain("4 gastos serão excluídos");
  expect(rpcCalls).toHaveLength(0);
  expect(ativos()).toHaveLength(7);
});

test("mudança entre a conferência e a RPC: RPC devolve changed, nada gravado", async () => {
  setembro();
  await send("Excluir todos os gastos de setembro de 2026");
  await tap("go");
  const orig = db.rpc;
  (db as any).rpc = (nm: string, a: any) => { G().find((x) => x.id === "s1").updated_at = "2026-10-14T14:59:00.000Z"; return orig(nm, a); };
  const r = await send("EXCLUIR GASTOS 09/2026");
  (db as any).rpc = orig;
  expect(r!.resposta).toContain("mudaram desde a prévia");
  expect(ativos()).toHaveLength(6);
});

test("frase repetida / webhook duplicado: não reaplica", async () => {
  setembro();
  await send("Excluir todos os gastos de setembro de 2026");
  await tap("go");
  await send("EXCLUIR GASTOS 09/2026", "u1", "dup-1");
  const again = await send("EXCLUIR GASTOS 09/2026", "u1", "dup-1");
  expect(again!.resposta).toContain("já processada");
  const novo = await send("EXCLUIR GASTOS 09/2026");
  expect(novo).toBeNull(); // estado consumido; sem fluxo ativo, texto não é pedido em lote
  expect(rpcCalls.filter((x) => x === "wa_lote_mes_excluir")).toHaveLength(1);
  expect(lotes).toHaveLength(1);
});

test("botão antigo, cancelar e voltar", async () => {
  setembro();
  await send("Excluir todos os gastos de setembro de 2026");
  const velho = last().nonce;
  await tap("go");
  const r = await send(`wa_lm:${velho}:go`);
  expect(r!.resposta).toContain("expirou");
  const v = await tap("bk");
  expect(v!.resposta).toContain("Prévia");
  const c = await tap("x");
  expect(c!.resposta).toContain("cancelado");
  expect(ativos()).toHaveLength(6);
  expect(rpcCalls).toHaveLength(0);
});

test("dois usuários: estado e lançamentos isolados", async () => {
  setembro();
  await send("Excluir todos os gastos de setembro de 2026", "u2");
  const st = last();
  expect(st.items.map((i: any) => i.id)).toEqual(["b1"]);
  const r = await send(`wa_lm:${st.nonce}:go`, "u1");
  expect(r).toBeNull();
});

test("RPC ausente (migração não aplicada): indisponível, nada alterado", async () => {
  setembro(); rpcMode = "missing";
  await send("Excluir todos os gastos de setembro de 2026");
  await tap("go");
  const r = await send("EXCLUIR GASTOS 09/2026");
  expect(r!.resposta).toContain("ainda não está disponível");
  expect(ativos()).toHaveLength(6);
});

test("falha no meio (erro da transação): mensagem honesta, nada alterado", async () => {
  setembro(); rpcMode = "fail";
  await send("Excluir todos os gastos de setembro de 2026");
  await tap("go");
  const r = await send("EXCLUIR GASTOS 09/2026");
  expect(r!.resposta).toContain("nada foi alterado");
  expect(r!.resposta).not.toContain("Pronto");
  expect(ativos()).toHaveLength(6);
});

test("timeout: não reporta sucesso", async () => {
  setembro(); rpcMode = "throw";
  await send("Excluir todos os gastos de setembro de 2026");
  await tap("go");
  const r = await send("EXCLUIR GASTOS 09/2026");
  expect(r!.resposta).toContain("Não considere como feito");
});

test("receitas: recorrente bloqueada; restauração só dos IDs do lote", async () => {
  setembro();
  const p = await send("Apagar minhas receitas de agosto de 2026");
  expect(p!.resposta).toContain("2 receitas serão excluídas");
  expect(p!.resposta).toContain("1 receita bloqueado(s) — recorrentes");
  await tap("go");
  await send("EXCLUIR RECEITAS 08/2026");
  expect(R().filter((x) => x.deleted_at === null).map((x) => x.id)).toEqual(["r3"]);
  // Excluída por outra operação antes da restauração em lote:
  R().find((x) => x.id === "r3").deleted_at = "2026-10-14T13:00:00.000Z";
  const rp = await send("Restaurar as receitas que excluí de agosto de 2026");
  expect(rp!.resposta).toContain("2 receitas serão restauradas");
  await tap("go");
  const ok = await send("RESTAURAR RECEITAS 08/2026");
  expect(ok!.resposta).toContain("restaurei 2 receitas");
  expect(R().find((x) => x.id === "r3").deleted_at).not.toBeNull();
});

test("restauração não traz excluídos anteriores nem itens já restaurados individualmente", async () => {
  setembro();
  await send("Excluir todos os gastos de setembro de 2026");
  await tap("go");
  await send("EXCLUIR GASTOS 09/2026");
  G().find((x) => x.id === "s3").deleted_at = null; // restaurado individualmente
  const rp = await send("Restaurar os gastos que excluí de setembro de 2026");
  expect(rp!.resposta).toContain("2 gastos serão restaurados");
  expect(rp!.resposta).toContain("já tinham sido restaurados");
  await tap("go");
  await send("RESTAURAR GASTOS 09/2026");
  expect(G().find((x) => x.id === "old").deleted_at).not.toBeNull();
  expect(ativos().map((x) => x.id).sort()).toEqual(["c1", "out", "p1", "s1", "s2", "s3"]);
  const de_novo = await send("Restaurar os gastos que excluí de setembro de 2026");
  expect(de_novo!.resposta).toContain("Não encontrei uma exclusão em lote");
});

test("restaurar sem lote: não restaura excluídos avulsos do mês", async () => {
  setembro();
  const r = await send("Restaurar os gastos que excluí de setembro de 2026");
  expect(r!.resposta).toContain("Não encontrei uma exclusão em lote");
  expect(G().find((x) => x.id === "old").deleted_at).not.toBeNull();
});

test("frase de confirmação é a do tipo/mês/ano da prévia", () => {
  expect(frasePara({ acao: "excluir", tipo: "gastos", ano: 2026, mes: 9 })).toBe("EXCLUIR GASTOS 09/2026");
  expect(frasePara({ acao: "restaurar", tipo: "receitas", ano: 2026, mes: 8 })).toBe("RESTAURAR RECEITAS 08/2026");
});
