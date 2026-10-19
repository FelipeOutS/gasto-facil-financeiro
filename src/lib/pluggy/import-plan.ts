/**
 * Fase 3 — Planejador PURO da importação Pluggy → Gastos/Receitas existentes.
 * Sem rede e sem banco: recebe o estado e devolve as ações. Quem grava é a RPC
 * transacional candidata `pluggy_import_apply` (docs/migrations-candidate/pluggy-import-gi.sql).
 *
 * Princípios: nunca inventa (parcela, fechamento, vencimento, cartão, categoria);
 * em dúvida → revisão; nunca sobrescreve correção manual; nunca apaga fisicamente.
 */
import { competenciaPorData } from "@/lib/fatura-competencia";

export type PlanTx = {
  transaction_id: string;
  account_id: string;
  account_type: "BANK" | "CREDIT";
  description: string | null;
  amount: number; // absoluto
  amount_original: number | null; // com sinal
  date: string; // YYYY-MM-DD
  status: string | null;
  type: "DEBIT" | "CREDIT";
  operation_type: string | null;
  installment_number: number | null;
  total_installments: number | null;
  classification: "gasto" | "receita" | "ignorado" | "revisao";
  classification_reason: string;
  categoria_sugerida: string | null;
  categoria_manual: string | null;
  review_status: "aprovado" | "rejeitado" | null;
  mp_match_ids: string[] | null;
  deleted_at: string | null;
};

/** Vínculo confirmado pelo titular entre a conta-cartão Pluggy e um cartão do GI. */
export type CardLink = { account_id: string; cartao_id: string; dia_fechamento: number; dia_vencimento: number };
export type UserCategoria = { id: string; nome: string };
/** Lançamento já importado (registro de pluggy_import_entries + estado atual da linha). */
export type ImportedEntry = {
  transaction_id: string;
  account_id: string;
  entry_table: "gastos" | "receitas";
  entry_id: string;
  snapshot: EntrySnapshot;
  current: EntrySnapshot | null; // null = linha removida (deleted_at) ou inexistente
  state: "ativo" | "revertido" | "removido";
};
export type EntrySnapshot = { valor: number; data: string; descricao: string; categoria_id?: string | null; updated_at?: string; cartao_id?: string | null };
/** Lançamentos de OUTRAS origens (manual, extrato, WhatsApp, Mercado Pago) para conciliação. */
export type ExistingEntry = { table: "gastos" | "receitas"; id: string; valor: number; data: string; descricao: string; origem: string | null };

export type PlanInput = {
  userId: string;
  txs: readonly PlanTx[];
  cardLinks: readonly CardLink[];
  categorias: readonly UserCategoria[];
  imported: readonly ImportedEntry[];
  existing: readonly ExistingEntry[];
};

export type GastoRow = {
  descricao: string; valor: number; data: string; estabelecimento: string; forma_pagamento: string;
  categoria_id: string; cartao_id: string | null; fatura_competencia: string | null; invoice_month: string | null;
  origem: "pluggy"; id_operacao_banco: string; observacao: string | null;
};
export type ReceitaRow = { descricao: string; valor: number; data: string; tipo: string; origem: "pluggy"; id_operacao_banco: string };

export type PlanAction =
  | { op: "insert"; table: "gastos"; transaction_id: string; account_id: string; row: GastoRow }
  | { op: "insert"; table: "receitas"; transaction_id: string; account_id: string; row: ReceitaRow }
  | { op: "update"; table: "gastos" | "receitas"; transaction_id: string; account_id: string; entry_id: string; expected: EntrySnapshot; next: EntrySnapshot }
  | { op: "remove"; table: "gastos" | "receitas"; transaction_id: string; account_id: string; entry_id: string; expected: EntrySnapshot; reason: string }
  | { op: "review"; transaction_id: string; account_id: string; reason: string }
  | { op: "skip"; transaction_id: string; account_id: string; reason: string };

/** Nome GI → nomes aceitos na tabela `categorias` do usuário (sem "primeira da lista"). */
const CATEGORIA_ALIASES: Record<string, string[]> = {
  "Alimentação": ["Alimentação"],
  "Supermercado": ["Supermercado", "Mercado"],
  "Transporte": ["Transporte"],
  "Moradia": ["Moradia"],
  "Contas": ["Contas"],
  "Compras": ["Compras", "Compras online"],
  "Saúde": ["Saúde"],
  "Lazer": ["Lazer"],
  "Assinaturas": ["Assinaturas"],
  "Outras despesas": ["Outras despesas", "Outros"],
};

function normName(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Resolve a categoria do usuário. Correção manual vence. Sem correspondência → null (revisão). */
export function resolveUserCategoriaId(tx: Pick<PlanTx, "categoria_manual" | "categoria_sugerida">, cats: readonly UserCategoria[]): string | null {
  const wanted = (tx.categoria_manual ?? "").trim() || (tx.categoria_sugerida ?? "").trim();
  if (!wanted) return null;
  const names = CATEGORIA_ALIASES[wanted] ?? [wanted];
  for (const n of names) {
    // várias linhas com o mesmo nome (ex.: categorias padrão duplicadas): escolhe a de menor id, determinístico
    const hit = cats.filter((c) => normName(c.nome) === normName(n)).sort((a, b) => a.id.localeCompare(b.id))[0];
    if (hit) return hit.id;
  }
  return null;
}

export function receitaTipo(tx: Pick<PlanTx, "categoria_manual" | "categoria_sugerida" | "operation_type">): string {
  const c = tx.categoria_manual ?? tx.categoria_sugerida;
  if (c === "Salário") return "salario";
  if ((tx.operation_type ?? "").toUpperCase() === "PIX") return "pix";
  return "outros";
}

export function opId(tx: Pick<PlanTx, "account_id" | "transaction_id">): string {
  return `pluggy:${tx.account_id}:${tx.transaction_id}`;
}

const key = (a: string, t: string) => `${a}|${t}`;
const cents = (n: number) => Math.round(Math.abs(n) * 100);
const sameSnap = (a: EntrySnapshot, b: EntrySnapshot) =>
  cents(a.valor) === cents(b.valor) && a.data === b.data && a.descricao === b.descricao && (a.categoria_id ?? null) === (b.categoria_id ?? null);

/** Decide a natureza efetiva considerando a revisão do titular. */
function effectiveKind(tx: PlanTx): { kind: "gasto" | "receita" } | { skip: string } | { review: string } {
  if (tx.review_status === "rejeitado") return { skip: "revisao_marcada_duplicada" };
  if (tx.classification === "ignorado") return { skip: tx.classification_reason };
  if (tx.classification === "revisao") {
    if (tx.review_status !== "aprovado") return { review: tx.classification_reason };
    // Aprovado: direção pelo sinal/tipo; estorno e crédito em cartão nunca viram gasto/receita automaticamente.
    if (tx.classification_reason === "estorno" || tx.classification_reason === "credito_em_cartao") return { review: "estorno_requer_tratamento_manual" };
    if (tx.account_type === "CREDIT") return (tx.amount_original ?? 0) < 0 ? { kind: "gasto" } : { review: "credito_em_cartao" };
    return { kind: tx.type === "DEBIT" ? "gasto" : "receita" };
  }
  return { kind: tx.classification };
}

/** Coincidência com lançamento de outra origem (centavos iguais, ±1 dia). Nunca descarta: revisão. */
function hasLooseDuplicate(tx: PlanTx, table: "gastos" | "receitas", existing: readonly ExistingEntry[]): boolean {
  const t = Date.parse(tx.date + "T12:00:00Z");
  return existing.some((e) => e.table === table && e.origem !== "pluggy" && cents(e.valor) === cents(tx.amount)
    && Math.abs(Date.parse(e.data + "T12:00:00Z") - t) <= 86_400_000);
}

export function planImport(input: PlanInput): PlanAction[] {
  const links = new Map(input.cardLinks.map((l) => [l.account_id, l]));
  const imported = new Map(input.imported.map((e) => [key(e.account_id, e.transaction_id), e]));
  const out: PlanAction[] = [];
  const seen = new Set<string>();

  for (const tx of input.txs) {
    const k = key(tx.account_id, tx.transaction_id);
    if (seen.has(k)) continue; // nunca duas ações para a mesma transação
    seen.add(k);
    const base = { transaction_id: tx.transaction_id, account_id: tx.account_id };
    const prev = imported.get(k);

    // ---------- Já importada: só atualização/remoção segura ----------
    if (prev) {
      if (prev.state !== "ativo" || !prev.current) { out.push({ op: "skip", ...base, reason: "ja_importada_" + prev.state }); continue; }
      const edited = !sameSnap(prev.snapshot, prev.current) || (!!prev.snapshot.updated_at && Date.parse(prev.snapshot.updated_at) !== Date.parse(prev.current.updated_at ?? ""));
      if (tx.account_type === "CREDIT" && (!links.has(tx.account_id) || (prev.current.cartao_id !== undefined && links.get(tx.account_id)?.cartao_id !== prev.current.cartao_id))) {
        out.push({ op: "review", ...base, reason: "vinculo_alterado_preservar_lancamento_anterior" }); continue;
      }
      const eff = effectiveKind(tx);
      if (tx.deleted_at || "skip" in eff) {
        if (edited) { out.push({ op: "review", ...base, reason: "remocao_conflita_com_edicao_manual" }); continue; }
        out.push({ op: "remove", table: prev.entry_table, ...base, entry_id: prev.entry_id, expected: prev.current, reason: tx.deleted_at ? "removida_na_pluggy" : (eff as { skip: string }).skip });
        continue;
      }
      if ("review" in eff) { out.push({ op: "review", ...base, reason: "importada_voltou_para_revisao" }); continue; }
      if (tx.status !== "POSTED") { out.push({ op: "review", ...base, reason: "importada_voltou_para_pendente" }); continue; }
      if ((eff.kind === "gasto") !== (prev.entry_table === "gastos")) { out.push({ op: "review", ...base, reason: "natureza_mudou_apos_importacao" }); continue; }
      if (tx.account_type === "CREDIT" && tx.date !== prev.snapshot.data) { out.push({ op: "review", ...base, reason: "data_cartao_alterada_requer_revisao_fatura" }); continue; }
      // Compara o dado do banco com o que o importador gravou (snapshot), não com a edição do usuário.
      const next: EntrySnapshot = { valor: tx.amount, data: tx.date, descricao: (tx.description ?? "").trim() || prev.snapshot.descricao, categoria_id: prev.snapshot.categoria_id ?? null };
      if (sameSnap(next, prev.snapshot)) { out.push({ op: "skip", ...base, reason: "sem_alteracao" }); continue; }
      if (edited) { out.push({ op: "review", ...base, reason: "atualizacao_conflita_com_edicao_manual" }); continue; }
      out.push({ op: "update", table: prev.entry_table, ...base, entry_id: prev.entry_id, expected: prev.current, next });
      continue;
    }

    // ---------- Nova ----------
    if (tx.deleted_at) { out.push({ op: "skip", ...base, reason: "removida_na_pluggy" }); continue; }
    if (tx.status !== "POSTED") { out.push({ op: "skip", ...base, reason: "pendente_aguardando_confirmacao" }); continue; }
    const eff = effectiveKind(tx);
    if ("skip" in eff) { out.push({ op: "skip", ...base, reason: eff.skip }); continue; }
    if ("review" in eff) { out.push({ op: "review", ...base, reason: eff.review }); continue; }
    if (!(tx.amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(tx.date)) { out.push({ op: "review", ...base, reason: "dados_invalidos" }); continue; }
    if (tx.mp_match_ids?.length && tx.review_status !== "aprovado") { out.push({ op: "review", ...base, reason: "possivel_duplicata_mercado_pago" }); continue; }
    const table = eff.kind === "gasto" ? "gastos" : "receitas";
    if (tx.review_status !== "aprovado" && hasLooseDuplicate(tx, table, input.existing)) {
      out.push({ op: "review", ...base, reason: "possivel_duplicata_lancamento_existente" }); continue;
    }
    const descricao = (tx.description ?? "").trim();
    if (!descricao) { out.push({ op: "review", ...base, reason: "sem_descricao" }); continue; }

    if (eff.kind === "receita") {
      if (tx.account_type === "CREDIT") { out.push({ op: "review", ...base, reason: "credito_em_cartao" }); continue; }
      out.push({ op: "insert", table: "receitas", ...base, row: { descricao, valor: tx.amount, data: tx.date, tipo: receitaTipo(tx), origem: "pluggy", id_operacao_banco: opId(tx) } });
      continue;
    }

    const categoria_id = resolveUserCategoriaId(tx, input.categorias);
    if (!categoria_id) { out.push({ op: "review", ...base, reason: "categoria_sem_correspondencia" }); continue; }

    let cartao_id: string | null = null;
    let fatura: string | null = null;
    let observacao: string | null = null;
    let forma = (tx.operation_type ?? "").toUpperCase() === "PIX" ? "pix" : /boleto/i.test(descricao) ? "boleto" : "debito";
    if (tx.account_type === "CREDIT") {
      const link = links.get(tx.account_id);
      if (!link) { out.push({ op: "review", ...base, reason: "cartao_sem_vinculo_confirmado" }); continue; }
      const comp = competenciaPorData(tx.date, link.dia_fechamento, link.dia_vencimento);
      if (!comp) { out.push({ op: "review", ...base, reason: "competencia_indefinida" }); continue; }
      if (comp.diaDoFechamento) { out.push({ op: "review", ...base, reason: "compra_no_dia_do_fechamento" }); continue; }
      cartao_id = link.cartao_id;
      fatura = comp.competencia;
      forma = "credito";
      // Parcela informada pela Pluggy é registrada como informação; nenhuma parcela futura é criada.
      if (tx.installment_number && tx.total_installments && tx.total_installments > 1) {
        observacao = `Parcela ${tx.installment_number}/${tx.total_installments} informada pelo banco (Open Finance)`;
      }
    }
    out.push({
      op: "insert", table: "gastos", ...base,
      row: { descricao, valor: tx.amount, data: tx.date, estabelecimento: descricao, forma_pagamento: forma, categoria_id, cartao_id, fatura_competencia: fatura, invoice_month: null, origem: "pluggy", id_operacao_banco: opId(tx), observacao },
    });
  }
  return out;
}

export function summarizePlan(actions: readonly PlanAction[]) {
  const s = { gastos: 0, receitas: 0, atualizacoes: 0, remocoes: 0, revisao: 0, ignorados: 0, motivos: {} as Record<string, number> };
  for (const a of actions) {
    if (a.op === "insert") a.table === "gastos" ? s.gastos++ : s.receitas++;
    else if (a.op === "update") s.atualizacoes++;
    else if (a.op === "remove") s.remocoes++;
    else {
      a.op === "review" ? s.revisao++ : s.ignorados++;
      s.motivos[a.reason] = (s.motivos[a.reason] ?? 0) + 1;
    }
  }
  return s;
}
