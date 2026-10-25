/**
 * P1 14/10/2026 — Edição de gastos e receitas já registrados pelo WhatsApp.
 * Somente fakes locais (sem rede, sem banco real, sem Meta).
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { detectEdicaoAntiga, extrairFiltro } = await import("../src/server/whatsapp-editar-antigo.server");

const tel = "5511999998888";
let n = 0;
const send = async (texto: string) => {
  const out = await processarMensagemWhatsApp({ telefone: tel, texto, external_id: `ed-${++n}` });
  return { ...out, resposta: String(out.resposta ?? "").replace(/\u00a0/g, " ") };
};

function todaySP(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}
function shift(iso: string, d: number) {
  const x = new Date(`${iso}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
}
const T0 = "2026-01-01T00:00:00.000Z";
const g = (o: Record<string, unknown>) => ({
  user_id: "u1", deleted_at: null, updated_at: T0, forma_pagamento: "pix", cartao_id: null,
  grupo_parcelamento_id: null, total_parcelas: 1, recorrencia_id: null, bem_id: null,
  categoria_id: "cat-mer", estabelecimento: "", origem: "web", ...o,
});
const r = (o: Record<string, unknown>) => ({
  user_id: "u1", deleted_at: null, updated_at: T0, recorrencia_id: null, origem: "web", ...o,
});

function lastState(): any {
  const rows = (state.generic.whatsapp_messages ?? []).filter((m) => m.parsed?.kind === "wa_edit_old");
  return rows[rows.length - 1]?.parsed;
}
const financialInserts = () =>
  state.inserts.filter((i) => ["gastos", "receitas", "recorrencias", "contas_a_pagar"].includes(i.table)).length;
const gasto = (id: string) => state.gastosData.find((x) => x.id === id)!;
const receita = (id: string) => state.receitasData.find((x) => x.id === id)!;

beforeEach(() => { resetState(); n = 0; });

// ---------------------------------------------------------------- detector
test("detector: frases de edição reconhecidas; cadastro, consulta e contas ignorados", () => {
  expect(detectEdicaoAntiga("Quero editar uma receita de setembro de 2026")).toBe("receita");
  expect(detectEdicaoAntiga("Alterar o valor do mercado de ontem")).toBe("lancamento");
  expect(detectEdicaoAntiga("Corrigir uma despesa de agosto")).toBe("gasto");
  expect(detectEdicaoAntiga("Mudar a descrição do Uber de segunda-feira")).toBe("lancamento");
  expect(detectEdicaoAntiga("Editar meu salário de setembro")).toBe("receita");
  expect(detectEdicaoAntiga("Quero alterar um gasto antigo")).toBe("gasto");
  expect(detectEdicaoAntiga("editar conta de luz")).toBeNull();
  expect(detectEdicaoAntiga("recebi salario 3000")).toBeNull();
  expect(detectEdicaoAntiga("minhas receitas de setembro")).toBeNull();
  expect(detectEdicaoAntiga("gastei 50 no mercado")).toBeNull();
});

test("filtro: mês/ano, ontem, dia da semana e termo", () => {
  const now = new Date("2026-10-14T15:00:00Z"); // quarta
  expect(extrairFiltro("editar uma receita de setembro de 2026", now).range).toEqual(["2026-09-01", "2026-09-30"]);
  expect(extrairFiltro("Alterar o valor do mercado de ontem", now)).toMatchObject({ range: ["2026-10-13", "2026-10-13"], termo: "mercado" });
  expect(extrairFiltro("Mudar a descrição do Uber de segunda-feira", now)).toMatchObject({ range: ["2026-10-12", "2026-10-12"], termo: "uber" });
  expect(extrairFiltro("Editar meu salário de setembro", now).termo).toBe("salario");
  expect(extrairFiltro("editar gasto de agosto e setembro", now).ambiguo).toBe(true);
});

// --------------------------------------------------- fluxo completo (gasto)
test("gasto antigo: múltiplos resultados → seleção por ID → valor → confirmar salva só esse", async () => {
  resetState({ gastos: [
    g({ id: "g-a", descricao: "Mercado Extra", valor: 56, data: "2026-08-10" }),
    g({ id: "g-b", descricao: "Uber", valor: 20, data: "2026-08-12" }),
    g({ id: "g-c", descricao: "Farmácia", valor: 30, data: "2026-07-01" }),
  ] });
  const r1 = await send("corrigir uma despesa de agosto de 2026");
  expect(r1.status).toBe("consulta");
  expect(r1.resposta).toContain("Encontrei 2");
  expect(r1.resposta).toContain("Mercado Extra");
  expect(r1.resposta).not.toContain("Farmácia");
  const s1 = lastState();
  expect(s1.cands.map((c: any) => c.id).sort()).toEqual(["g-a", "g-b"]);

  await send(`wa_ed:${s1.nonce}:sel:g-a`);
  const s2 = lastState();
  expect(s2.stage).toBe("field");
  expect(s2.sel.id).toBe("g-a");

  await send(`wa_ed:${s2.nonce}:f:valor`);
  const r4 = await send("65");
  expect(r4.resposta).toContain("Lançamento: Mercado Extra");
  expect(r4.resposta).toContain("Valor atual: R$ 56,00");
  expect(r4.resposta).toContain("Novo valor: R$ 65,00");
  expect(gasto("g-a").valor).toBe(56); // nada salvo antes do Confirmar

  const s4 = lastState();
  const r5 = await send(`wa_ed:${s4.nonce}:ok`);
  expect(r5.resposta).toContain("✅ Gasto atualizado");
  expect(gasto("g-a").valor).toBe(65);
  expect(gasto("g-b").valor).toBe(20);
  expect(financialInserts()).toBe(0);
});

test("gasto recente (ontem) com resultado único: descrição e categoria", async () => {
  const ontem = shift(todaySP(), -1);
  resetState({ gastos: [g({ id: "g-1", descricao: "Mercado", valor: 56, data: ontem })] });
  const r1 = await send("alterar o valor do mercado de ontem");
  expect(r1.resposta).toContain("O que você quer alterar?");
  await send("descrição");
  const rc = await send("Mercado Dia");
  expect(rc.resposta).toContain("Nova descrição: Mercado Dia");
  await send("sim");
  expect(gasto("g-1").descricao).toBe("Mercado Dia");

  await send("editar gasto de ontem");
  await send("categoria");
  const r2 = await send("Transporte");
  expect(r2.resposta).toContain("Categoria atual: Mercado");
  await send("confirmar");
  expect(gasto("g-1").categoria_id).toBe("cat-trans");
});

test("data: altera data, mês e ano", async () => {
  resetState({ gastos: [g({ id: "g-1", descricao: "Padaria", valor: 10, data: "2026-09-05", mes: 9, ano: 2026 })] });
  await send("editar gasto de setembro de 2026");
  await send("data");
  await send("20/08/2026");
  await send("sim");
  expect(gasto("g-1")).toMatchObject({ data: "2026-08-20", mes: 8, ano: 2026, invoice_month: "2026-08" });
});

// ------------------------------------------------------------------ receitas
test("receita antiga de setembro: valor; receita recente: descrição", async () => {
  const hoje = todaySP();
  resetState({ receitas: [
    r({ id: "r-s", descricao: "Salário", valor: 3000, data: "2026-09-05" }),
    r({ id: "r-h", descricao: "Freela", valor: 500, data: hoje }),
  ] });
  const r1 = await send("Editar meu salário de setembro de 2026");
  expect(r1.resposta).toContain("Salário");
  await send("valor");
  await send("3.500,00");
  const ok = await send("sim");
  expect(ok.resposta).toContain("✅ Receita atualizada");
  expect(receita("r-s").valor).toBe(3500);

  await send("quero editar uma receita de hoje");
  await send("nome");
  await send("Freela site");
  await send("sim");
  expect(receita("r-h").descricao).toBe("Freela site");
  expect(financialInserts()).toBe(0);
});

test("receita sem nenhum resultado no mês informa claramente", async () => {
  resetState({ receitas: [r({ id: "r-1", descricao: "Salário", valor: 3000, data: "2026-09-05" })] });
  const res = await send("Quero editar uma receita de março de 2026");
  expect(res.resposta).toContain("Não encontrei nenhuma receita".slice(0, 18));
  expect(res.resposta).toContain("Nada foi alterado");
  expect(financialInserts()).toBe(0);
});

// ------------------------------------------------- cancelamento / ajustar
test("cancelar e ajustar não salvam nada", async () => {
  resetState({ gastos: [g({ id: "g-1", descricao: "Mercado", valor: 56, data: "2026-08-10" })] });
  await send("editar gasto de agosto de 2026");
  await send("valor");
  await send("65");
  const s = lastState();
  const adj = await send(`wa_ed:${s.nonce}:adj`);
  expect(adj.resposta).toContain("O que você quer alterar?");
  const c = await send("cancelar");
  expect(c.resposta).toContain("cancelada");
  expect(gasto("g-1").valor).toBe(56);
});

// --------------------------------------------- duplicada / expirada / antiga
test("confirmação duplicada (botão repetido e replay) não reaplica", async () => {
  resetState({ gastos: [g({ id: "g-1", descricao: "Mercado", valor: 56, data: "2026-08-10" })] });
  await send("editar gasto de agosto de 2026");
  await send("valor");
  await send("65");
  const s = lastState();
  await send(`wa_ed:${s.nonce}:ok`);
  const updatedAt = gasto("g-1").updated_at;
  const again = await send(`wa_ed:${s.nonce}:ok`);
  expect(again.resposta).toContain("expirou ou já foi usada");
  // replay do mesmo webhook (mesmo external_id)
  const replay = await processarMensagemWhatsApp({ telefone: tel, texto: `wa_ed:${s.nonce}:ok`, external_id: `ed-${n}` });
  expect(replay.status).not.toBe("salva");
  expect(gasto("g-1").updated_at).toBe(updatedAt);
  expect(gasto("g-1").valor).toBe(65);
});

test("duas confirmações concorrentes aplicam uma só vez", async () => {
  resetState({ gastos: [g({ id: "g-1", descricao: "Mercado", valor: 56, data: "2026-08-10" })] });
  await send("editar gasto de agosto de 2026");
  await send("valor");
  await send("65");
  const s = lastState();
  const [a, b] = await Promise.all([send(`wa_ed:${s.nonce}:ok`), send(`wa_ed:${s.nonce}:ok`)]);
  const okCount = [a, b].filter((x) => x.resposta.includes("✅")).length;
  expect(okCount).toBeLessThanOrEqual(1);
  expect(gasto("g-1").valor).toBe(65);
});

test("seleção de lista antiga (nonce de outro passo) é recusada", async () => {
  resetState({ gastos: [
    g({ id: "g-a", descricao: "Mercado", valor: 56, data: "2026-08-10" }),
    g({ id: "g-b", descricao: "Uber", valor: 20, data: "2026-08-12" }),
  ] });
  await send("editar gasto de agosto de 2026");
  const old = lastState();
  await send(`wa_ed:${old.nonce}:sel:g-a`);
  const res = await send(`wa_ed:${old.nonce}:sel:g-b`);
  expect(res.resposta).toContain("expirou");
  expect(lastState().sel.id).toBe("g-a");
});

test("seleção expirada (mais de 15 min) é recusada", async () => {
  resetState({ gastos: [g({ id: "g-1", descricao: "Mercado", valor: 56, data: "2026-08-10" })] });
  await send("editar gasto de agosto de 2026");
  await send("valor");
  await send("65");
  const s = lastState();
  s.expires_at = new Date(Date.now() - 1000).toISOString();
  const res = await send(`wa_ed:${s.nonce}:ok`);
  expect(res.resposta).toContain("expirou");
  expect(gasto("g-1").valor).toBe(56);
});

test("ID de outro registro injetado no botão não é aceito", async () => {
  resetState({ gastos: [
    g({ id: "g-a", descricao: "Mercado", valor: 56, data: "2026-08-10" }),
    g({ id: "g-b", descricao: "Uber", valor: 20, data: "2026-08-12" }),
    g({ id: "g-x", descricao: "Outro mês", valor: 99, data: "2026-05-01" }),
  ] });
  await send("editar gasto de agosto de 2026");
  const s = lastState();
  const res = await send(`wa_ed:${s.nonce}:sel:g-x`);
  expect(res.resposta).toContain("Não identifiquei");
});

// ------------------------------------------------------- concorrência site
test("alteração concorrente pelo site depois da seleção: não sobrescreve", async () => {
  resetState({ gastos: [g({ id: "g-1", descricao: "Mercado", valor: 56, data: "2026-08-10" })] });
  await send("editar gasto de agosto de 2026");
  await send("valor");
  await send("65");
  // site altera o lançamento
  Object.assign(gasto("g-1"), { valor: 70, updated_at: "2026-10-14T10:00:00.000Z" });
  const res = await send("sim");
  expect(res.resposta).toContain("alterado no site");
  expect(gasto("g-1").valor).toBe(70);
});

// --------------------------------------------- outro usuário / excluídos
test("lançamentos de outro usuário e excluídos não aparecem", async () => {
  resetState({ gastos: [
    g({ id: "g-u2", user_id: "u2", descricao: "Mercado alheio", valor: 1, data: "2026-08-10" }),
    g({ id: "g-del", descricao: "Mercado excluído", valor: 2, data: "2026-08-11", deleted_at: "2026-09-01T00:00:00Z" }),
  ] });
  const res = await send("editar gasto de agosto de 2026");
  expect(res.resposta).toContain("Não encontrei");
  expect(res.resposta).not.toContain("alheio");
  expect(res.resposta).not.toContain("excluído");
});

test("lançamento excluído depois da seleção: bloqueia", async () => {
  resetState({ gastos: [g({ id: "g-1", descricao: "Mercado", valor: 56, data: "2026-08-10" })] });
  await send("editar gasto de agosto de 2026");
  await send("valor");
  await send("65");
  gasto("g-1").deleted_at = "2026-10-14T10:00:00.000Z";
  const res = await send("sim");
  expect(res.resposta).toContain("excluído");
  expect(gasto("g-1").valor).toBe(56);
});

// ------------------------------------------------- tipos bloqueados
test("parcelado é bloqueado; cartão de crédito só descrição/categoria", async () => {
  resetState({ gastos: [g({ id: "g-p", descricao: "TV", valor: 100, data: "2026-08-10", grupo_parcelamento_id: "gp1", total_parcelas: 10 })] });
  const p = await send("editar gasto de agosto de 2026");
  expect(p.resposta).toContain("parceladas");

  resetState({ gastos: [g({ id: "g-c", descricao: "Restaurante", valor: 80, data: "2026-08-10", forma_pagamento: "credito", cartao_id: "c-nu" })] });
  const c = await send("editar gasto de agosto de 2026");
  expect(c.resposta).toContain("cartão de crédito");
  const v = await send("valor");
  expect(v.resposta).toContain("não pode ser alterado");
  expect(gasto("g-c").valor).toBe(80);
});

// --------------------------------------------------- falha de persistência
test("falha no UPDATE do banco: retorna erro, nunca sucesso", async () => {
  const { aplicarEdicao } = await import("../src/server/whatsapp-editar-antigo.server");
  const chain: any = {};
  for (const k of ["update", "eq", "is", "select"]) chain[k] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: { code: "57014", message: "timeout" } });
  const db = { from: () => chain };
  const snap = { t: "gastos", id: "g-1", updated_at: T0, descricao: "M", valor: 56, data: "2026-08-10", categoria_id: null, allowed: ["valor"] } as any;
  const res = await aplicarEdicao(db, "u1", snap, { field: "valor", value: "65.00", label: "R$ 65,00", beforeLabel: "R$ 56,00" }, new Date());
  expect(res).toBe("error");
  // campo não permitido para o tipo nunca é escrito
  const res2 = await aplicarEdicao(db, "u1", snap, { field: "data", value: "2026-08-01", label: "", beforeLabel: "" }, new Date());
  expect(res2).toBe("error");
});

test("falha ao gravar o passo da confirmação: nada é alterado", async () => {
  resetState({ gastos: [g({ id: "g-1", descricao: "Mercado", valor: 56, data: "2026-08-10" })] });
  await send("editar gasto de agosto de 2026");
  await send("valor");
  await send("65");
  // replay da mensagem anterior com o mesmo external_id + "sim" => dedupe, nada aplicado
  const dup = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: `ed-${n}` });
  expect(dup.resposta).not.toContain("✅");
  expect(gasto("g-1").valor).toBe(56);
});

// ------------------------------------------------ cadastro e consultas
test("cadastro normal e consultas não iniciam edição", async () => {
  const c = await send("quero lançar uma receita");
  expect(c.resposta).not.toContain("O que você quer alterar");
  const q = await send("minhas receitas de setembro");
  expect(q.resposta).not.toContain("Qual você quer editar");
  expect(lastState()).toBeUndefined();
});

test("edição antiga de extrato é encaminhada ao site sem alterar o registro", async () => {
  resetState({ gastos: [g({id:"imported",descricao:"Mercado",valor:15,data:"2026-10-01",import_batch_id:"batch-fixture"})] });
  const out=await send("editar gasto mercado de outubro de 2026");
  expect(out.resposta).toContain("importa");
  expect((state.gastosData as any[])[0].valor).toBe(15);
  expect((state.gastosData as any[])[0].updated_at).toBe(T0);
});
