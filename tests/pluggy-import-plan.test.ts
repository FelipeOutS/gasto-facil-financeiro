import { describe, expect, it } from "bun:test";
import fixture from "./fixtures/pluggy-sandbox-40.json";
import { planImport, summarizePlan, type PlanTx, type CardLink, type ImportedEntry } from "@/lib/pluggy/import-plan";
import { runPluggyImport, revertPluggyImport, PLUGGY_IMPORT_RELEASE_AUTHORIZED, type ImportDeps } from "@/server/pluggy/pluggy-import.server";

const F = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";
const M = "47df50ce-df1e-4c54-8fae-0ffb5105478d";
const CARD_ACC = "1df8e595-a756-4c47-b2ad-20fc8c4d8da8";
type Fx = (typeof fixture)[number];
const toTx = (x: Fx): PlanTx => ({
  transaction_id: x.id, account_id: x.accountId, account_type: x.acct as "BANK" | "CREDIT", description: x.description,
  amount: Math.abs(x.amount), amount_original: x.amount, date: x.date, status: x.status, type: x.type as "DEBIT" | "CREDIT",
  operation_type: x.operationType, installment_number: x.inst, total_installments: x.total,
  classification: x.cls as PlanTx["classification"], classification_reason: x.reason, categoria_sugerida: x.cat,
  categoria_manual: null, review_status: null, mp_match_ids: null, deleted_at: null,
});
const TXS = fixture.map(toTx);
const CATS = ["Contas", "Moradia", "Saúde", "Assinaturas", "Alimentação", "Transporte", "Mercado", "Outros", "Lazer", "Compras online"].map((n, i) => ({ id: `c${String(i).padStart(2, "0")}`, nome: n }));
const LINK: CardLink = { account_id: CARD_ACC, cartao_id: "cartao-gi-1", dia_fechamento: 25, dia_vencimento: 5 };
const base = { userId: F, categorias: CATS, imported: [], existing: [] };

describe("Fase 3 — plano de importação com as 40 movimentações Sandbox", () => {
  it("com cartão vinculado: 31 gastos, 5 receitas, 3 faturas ignoradas, 1 revisão", () => {
    const s = summarizePlan(planImport({ ...base, txs: TXS, cardLinks: [LINK] }));
    expect([s.gastos, s.receitas, s.ignorados, s.revisao]).toEqual([31, 5, 3, 1]);
    expect(s.motivos).toEqual({ pagamento_de_fatura: 3, boleto_sem_identificacao: 1 });
  });
  it("sem vínculo de cartão: compras de cartão vão para revisão, nenhum cartão é criado", () => {
    const acts = planImport({ ...base, txs: TXS, cardLinks: [] });
    const card = TXS.filter((t) => t.account_type === "CREDIT").length;
    const s = summarizePlan(acts);
    expect(s.motivos.cartao_sem_vinculo_confirmado).toBe(card);
    expect(s.gastos).toBe(31 - card);
    expect(acts.some((a) => a.op === "insert" && a.table === "gastos" && a.row.cartao_id)).toBe(false);
  });
  it("pagamento de fatura nunca vira gasto (sem dupla contagem)", () => {
    const acts = planImport({ ...base, txs: TXS, cardLinks: [LINK] });
    expect(acts.filter((a) => a.op === "insert" && /fatura/i.test(a.row.descricao))).toHaveLength(0);
  });
  it("categorias oficiais: Eletrobras/Vivo→Contas, Smart Fit→Saúde, Spotify/Netflix→Assinaturas, Condomínio→Moradia, Salário→salario", () => {
    const acts = planImport({ ...base, txs: TXS, cardLinks: [LINK] });
    const cat = (d: RegExp) => new Set(acts.flatMap((a) => (a.op === "insert" && a.table === "gastos" && d.test(a.row.descricao) ? [CATS.find((c) => c.id === a.row.categoria_id)!.nome] : [])));
    expect([...cat(/ELETROBRAS|VIVO/)]).toEqual(["Contas"]);
    expect([...cat(/SMART FIT/)]).toEqual(["Saúde"]);
    expect([...cat(/SPOTIFY|NETFLIX/)]).toEqual(["Assinaturas"]);
    expect([...cat(/CONDOMINIO/)]).toEqual(["Moradia"]);
    const rec = acts.filter((a) => a.op === "insert" && a.table === "receitas");
    expect(rec.every((a) => a.op === "insert" && a.table === "receitas" && a.row.tipo === "salario")).toBe(true);
  });
  it("categoria sem correspondência vai para revisão (nunca a primeira da lista)", () => {
    const acts = planImport({ ...base, categorias: [{ id: "c0", nome: "Alimentação" }], txs: TXS.filter((t) => /ELETROBRAS/.test(t.description!)), cardLinks: [] });
    expect(acts.every((a) => a.op === "review" && a.reason === "categoria_sem_correspondencia")).toBe(true);
  });
  it("correção manual de categoria vence a sugestão", () => {
    const t = { ...TXS.find((x) => /VIVO/.test(x.description!))!, categoria_manual: "Lazer" };
    const [a] = planImport({ ...base, txs: [t], cardLinks: [] });
    expect(a.op === "insert" && a.table === "gastos" && a.row.categoria_id).toBe(CATS.find((c) => c.nome === "Lazer")!.id);
  });
  it("cartão: competência calculada pelo cartão vinculado; parcela informada sem criar parcelas futuras", () => {
    const acts = planImport({ ...base, txs: TXS.filter((t) => t.account_type === "CREDIT"), cardLinks: [LINK] });
    const nf = acts.find((a) => a.transaction_id === "28614f20-52f1-484c-9dcc-3d6a024998c4")!;
    expect(nf.op === "insert" && nf.table === "gastos" && [nf.row.forma_pagamento, nf.row.cartao_id, nf.row.fatura_competencia]).toEqual(["credito", "cartao-gi-1", "2026-06"]);
    expect(nf.op === "insert" && nf.table === "gastos" && nf.row.observacao).toContain("Parcela 2/6");
    expect(acts.filter((a) => a.op === "insert")).toHaveLength(acts.length - acts.filter((a) => a.op !== "insert").length);
    expect(acts.length).toBe(TXS.filter((t) => t.account_type === "CREDIT").length);
  });
  it("compra exatamente no dia do fechamento vai para revisão (não presume fatura)", () => {
    const t = TXS.find((x) => x.account_type === "CREDIT")!;
    const [a] = planImport({ ...base, txs: [{ ...t, date: "2026-05-25" }], cardLinks: [LINK] });
    expect(a).toMatchObject({ op: "review", reason: "compra_no_dia_do_fechamento" });
  });
  it("assinaturas recorrentes de meses diferentes são lançamentos independentes", () => {
    const acts = planImport({ ...base, txs: TXS, cardLinks: [LINK] }).filter((a) => a.op === "insert" && /NETFLIX/.test(a.row.descricao));
    expect(new Set(acts.map((a) => a.op === "insert" && a.row.data)).size).toBe(acts.length);
    expect(new Set(acts.map((a) => a.op === "insert" && a.row.id_operacao_banco)).size).toBe(acts.length);
  });
  it("boleto em revisão: só entra depois de 'É válida'; 'É duplicada' nunca entra", () => {
    const b = TXS.find((t) => t.classification === "revisao")!;
    expect(planImport({ ...base, txs: [b], cardLinks: [] })[0]).toMatchObject({ op: "review" });
    expect(planImport({ ...base, txs: [{ ...b, review_status: "rejeitado" }], cardLinks: [] })[0]).toMatchObject({ op: "skip", reason: "revisao_marcada_duplicada" });
    const ok = planImport({ ...base, txs: [{ ...b, review_status: "aprovado" }], cardLinks: [] })[0];
    expect(ok.op === "insert" && ok.table === "gastos" && ok.row.forma_pagamento).toBe("boleto");
  });
  it("Mercado Pago: coincidência vai para revisão; nunca é descartada; aprovação manual libera", () => {
    const t = { ...TXS.find((x) => /CONDOMINIO/.test(x.description!))!, mp_match_ids: ["mp1"] };
    expect(planImport({ ...base, txs: [t], cardLinks: [] })[0]).toMatchObject({ op: "review", reason: "possivel_duplicata_mercado_pago" });
    expect(planImport({ ...base, txs: [{ ...t, review_status: "aprovado" }], cardLinks: [] })[0].op).toBe("insert");
  });
  it("lançamento manual/extrato de mesmo valor ±1 dia: revisão, não duplica", () => {
    const t = TXS.find((x) => /CONDOMINIO/.test(x.description!))!;
    const existing = [{ table: "gastos" as const, id: "g1", valor: t.amount, data: "2026-05-06", descricao: "Condomínio", origem: "manual" }];
    expect(planImport({ ...base, existing, txs: [t], cardLinks: [] })[0]).toMatchObject({ op: "review", reason: "possivel_duplicata_lancamento_existente" });
  });
  it("estorno/crédito em cartão nunca vira receita automaticamente", () => {
    const t = { ...TXS.find((x) => x.account_type === "CREDIT")!, amount_original: 55.9, classification: "revisao" as const, classification_reason: "credito_em_cartao", review_status: "aprovado" as const };
    expect(planImport({ ...base, txs: [t], cardLinks: [LINK] })[0].op).toBe("review");
  });
  it("pendente nunca entra", () => {
    const t = { ...TXS[0], status: "PENDING" };
    expect(planImport({ ...base, txs: [t], cardLinks: [] })[0]).toMatchObject({ op: "skip" });
  });

  const importedFrom = (txs: PlanTx[]): ImportedEntry[] =>
    planImport({ ...base, txs, cardLinks: [LINK] }).flatMap((a, i) => {
      if (a.op !== "insert") return [];
      const snap = { valor: a.row.valor, data: a.row.data, descricao: a.row.descricao, categoria_id: a.table === "gastos" ? a.row.categoria_id : null };
      return [{ transaction_id: a.transaction_id, account_id: a.account_id, entry_table: a.table, entry_id: `e${i}`, snapshot: snap, current: { ...snap }, state: "ativo" as const }];
    });
  it("edição manual sem mudança no banco é preservada (sem revisão)", () => {
    const imported = importedFrom(TXS).map((e) => ({ ...e, current: { ...e.current!, descricao: "meu nome" } }));
    const s = summarizePlan(planImport({ ...base, imported, txs: TXS, cardLinks: [LINK] }));
    expect(s.motivos.sem_alteracao).toBe(36);
  });
  it("reimportação não duplica (tudo 'sem_alteracao')", () => {
    const imported = importedFrom(TXS);
    const s = summarizePlan(planImport({ ...base, imported, txs: TXS, cardLinks: [LINK] }));
    expect([s.gastos, s.receitas, s.atualizacoes, s.remocoes]).toEqual([0, 0, 0, 0]);
    expect(s.motivos.sem_alteracao).toBe(36);
  });
  it("atualização do banco: ajusta se não editado; se editado pelo usuário, revisão", () => {
    const imported = importedFrom(TXS);
    const changed = TXS.map((t) => (/SMART FIT/.test(t.description!) ? { ...t, amount: 99.9 } : t));
    const ups = planImport({ ...base, imported, txs: changed, cardLinks: [LINK] }).filter((a) => a.op === "update");
    expect(ups.length).toBeGreaterThan(0);
    const edited = imported.map((e) => ({ ...e, current: { ...e.current!, descricao: e.current!.descricao + " (editado)" } }));
    const s = summarizePlan(planImport({ ...base, imported: edited, txs: changed, cardLinks: [LINK] }));
    expect(s.atualizacoes).toBe(0);
    expect(s.motivos.atualizacao_conflita_com_edicao_manual).toBe(ups.length);
  });
  it("removida na Pluggy: exclusão reversível só se não editada", () => {
    const imported = importedFrom(TXS);
    const del = TXS.map((t, i) => (i === 0 ? { ...t, deleted_at: "2026-10-19T00:00:00Z" } : t));
    const rm = planImport({ ...base, imported, txs: del, cardLinks: [LINK] }).filter((a) => a.op === "remove");
    expect(rm).toHaveLength(1);
  });
  it("'É duplicada' depois de importada: remoção reversível da própria entrada", () => {
    const imported = importedFrom(TXS);
    const t = TXS.map((x, i) => (i === 0 ? { ...x, review_status: "rejeitado" as const } : x));
    expect(planImport({ ...base, imported, txs: t, cardLinks: [LINK] })[0]).toMatchObject({ op: "remove", reason: "revisao_marcada_duplicada" });
  });
});

describe("Fase 3 — executor travado e isolamento", () => {
  const writes: string[] = [];
  const deps = (owner = F): ImportDeps => ({
    roles: async (u) => (u === F || u === M ? ["owner"] : ["user"]),
    settings: async () => ({ auto_import: false }),
    txs: async (u) => (u === owner ? TXS : []),
    cardLinks: async () => [LINK],
    categorias: async () => CATS,
    imported: async () => [],
    existing: async () => [],
    apply: async (u) => { writes.push(u); return { gastos: 31 }; },
    revert: async (u) => { writes.push("revert:" + u); return {}; },
  });
  it("flag de liberação permanece falsa", () => expect(PLUGGY_IMPORT_RELEASE_AUTHORIZED).toBe(false));
  it("prévia funciona e não grava", async () => {
    const r = await runPluggyImport(deps(), { userId: F, batchId: "b1", mode: "previa" });
    expect(r.ok && r.resumo.gastos).toBe(31);
    expect(writes).toHaveLength(0);
  });
  it("histórico e incremental bloqueados enquanto a flag for falsa", async () => {
    for (const mode of ["historico_inicial", "incremental"] as const) {
      expect(await runPluggyImport(deps(), { userId: F, batchId: "b1", mode, confirmed: true })).toMatchObject({ ok: false, error: "importacao_bloqueada" });
    }
    expect(await revertPluggyImport(deps(), { userId: F, batchId: "b1" })).toMatchObject({ ok: false, error: "importacao_bloqueada" });
    expect(writes).toHaveLength(0);
  });
  it("liberado em teste: histórico exige confirmação; incremental exige ativação individual", async () => {
    expect(await runPluggyImport(deps(), { userId: F, batchId: "b1", mode: "historico_inicial", releaseAuthorized: true })).toMatchObject({ error: "confirmacao_obrigatoria" });
    expect(await runPluggyImport(deps(), { userId: F, batchId: "b1", mode: "incremental", releaseAuthorized: true })).toMatchObject({ error: "importacao_automatica_desativada" });
    const r = await runPluggyImport(deps(), { userId: F, batchId: "b1", mode: "historico_inicial", confirmed: true, releaseAuthorized: true });
    expect(r.ok).toBe(true);
    expect(writes).toEqual([F]);
  });
  it("usuário comum é recusado; Michael só vê os próprios dados", async () => {
    expect(await runPluggyImport(deps(), { userId: "99999999-0000-0000-0000-000000000009", batchId: "b", mode: "previa" })).toMatchObject({ ok: false, error: "pluggy_nao_autorizado" });
    const r = await runPluggyImport(deps(F), { userId: M, batchId: "b", mode: "previa" });
    expect(r.ok && r.actions).toHaveLength(0);
  });
});
