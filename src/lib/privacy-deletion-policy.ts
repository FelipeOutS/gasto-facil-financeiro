/**
 * Regras puras da exclusão seletiva (LGPD) em /app/privacidade.
 * Sem I/O: o servidor coleta os fatos e estas funções decidem.
 * A exclusão do RPC atual é definitiva; por isso qualquer vínculo com
 * faturas, bens, importações bancárias (Pluggy) ou recorrências bloqueia a
 * categoria em vez de quebrar o vínculo ou apagar parcialmente.
 */

export const DELETION_CATEGORIES = {
  expenses: ["all"],
  income: ["all"],
  payables: ["all", "paid", "pending", "overdue"],
  receivables: ["all", "received", "pending", "overdue"],
  subscriptions: ["all"],
  budgets: ["all"],
  goals: ["all"],
  savings: ["all"],
  investments: ["all"],
  cards: ["all"],
  market: ["all"],
  imports: ["all"],
} as const;

export type DeletionCategory = keyof typeof DELETION_CATEGORIES;
export interface ValidSelection {
  category: DeletionCategory;
  scope: string;
}

export type SelectionValidation =
  | { ok: true; selections: ValidSelection[] }
  | { ok: false; code: "invalid_selection" };

/** Aceita somente categorias/escopos conhecidos, sem repetição, 1..12 itens. */
export function validateSelections(input: unknown): SelectionValidation {
  if (!Array.isArray(input) || input.length === 0 || input.length > 12) {
    return { ok: false, code: "invalid_selection" };
  }
  const seen = new Set<string>();
  const out: ValidSelection[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, code: "invalid_selection" };
    const { category, scope } = raw as { category?: unknown; scope?: unknown };
    if (typeof category !== "string" || !Object.hasOwn(DELETION_CATEGORIES, category)) {
      return { ok: false, code: "invalid_selection" };
    }
    const scopes = DELETION_CATEGORIES[category as DeletionCategory] as readonly string[];
    if (typeof scope !== "string" || !scopes.includes(scope) || seen.has(category)) {
      return { ok: false, code: "invalid_selection" };
    }
    seen.add(category);
    out.push({ category: category as DeletionCategory, scope });
  }
  return { ok: true, selections: out };
}

/** Contagens de vínculos do próprio usuário (todas as linhas, inclusive ocultas). */
export interface DependencyFacts {
  pluggyEntriesOnBatches: number; // pluggy_import_entries apontando para extratos_importados (FK RESTRICT)
  pluggyEntriesOnGastos: number;
  pluggyEntriesOnReceitas: number;
  gastosComBem: number; // gastos.bem_id ou bens_* referenciando gastos
  gastosComCartao: number;
  faturas: number;
  lancamentosComRecorrencia: number; // gastos/receitas com recorrencia_id
}

export type BlockerCode =
  | "imports_pluggy_linked"
  | "expenses_pluggy_linked"
  | "income_pluggy_linked"
  | "expenses_bens_linked"
  | "expenses_card_linked"
  | "cards_invoice_linked"
  | "subscriptions_entries_linked";

export interface Blocker {
  category: DeletionCategory;
  code: BlockerCode;
  count: number;
  message: string;
}

const MSG: Record<BlockerCode, string> = {
  imports_pluggy_linked:
    "Há importações bancárias (Open Finance) ligadas a estes extratos. Desfaça a importação pela tela de importações antes de excluir.",
  expenses_pluggy_linked:
    "Há gastos vindos de importação bancária (Open Finance). Desfaça a importação antes de excluir os gastos.",
  income_pluggy_linked:
    "Há receitas vindas de importação bancária (Open Finance). Desfaça a importação antes de excluir as receitas.",
  expenses_bens_linked:
    "Há gastos ligados a bens ou financiamentos. Remova o vínculo no módulo Bens antes de excluir.",
  expenses_card_linked:
    "Há gastos que compõem faturas de cartão. A exclusão definitiva alteraria o histórico das faturas.",
  cards_invoice_linked:
    "Há faturas ou compras ligadas aos cartões. Excluir os cartões quebraria o histórico das faturas.",
  subscriptions_entries_linked:
    "Há lançamentos gerados por estas recorrências. Excluí-las deixaria lançamentos sem origem.",
};

export function computeBlockers(selections: ValidSelection[], f: DependencyFacts): Blocker[] {
  const out: Blocker[] = [];
  const add = (category: DeletionCategory, code: BlockerCode, count: number) => {
    if (count > 0) out.push({ category, code, count, message: MSG[code] });
  };
  for (const s of selections) {
    switch (s.category) {
      case "imports":
        add("imports", "imports_pluggy_linked", f.pluggyEntriesOnBatches);
        break;
      case "expenses":
        add("expenses", "expenses_pluggy_linked", f.pluggyEntriesOnGastos);
        add("expenses", "expenses_bens_linked", f.gastosComBem);
        add("expenses", "expenses_card_linked", f.gastosComCartao);
        break;
      case "income":
        add("income", "income_pluggy_linked", f.pluggyEntriesOnReceitas);
        break;
      case "cards":
        add("cards", "cards_invoice_linked", f.faturas + f.gastosComCartao);
        break;
      case "subscriptions":
        add("subscriptions", "subscriptions_entries_linked", f.lancamentosComRecorrencia);
        break;
      default:
        break;
    }
  }
  return out;
}

export type DeletionErrorCode =
  | "invalid_selection"
  | "invalid_confirmation"
  | "blocked_by_dependencies"
  | "preview_unavailable"
  | "dependency_conflict"
  | "not_authorized"
  | "unconfirmed_result"
  | "unknown";

const USER_MSG: Record<DeletionErrorCode, string> = {
  invalid_selection: "Seleção inválida. Volte e escolha as categorias novamente.",
  invalid_confirmation: "Confirmação inválida. Nada foi excluído.",
  blocked_by_dependencies:
    "Algumas categorias têm vínculos que impedem a exclusão. Nada foi excluído.",
  preview_unavailable: "Não foi possível conferir seus dados agora. Nada foi excluído.",
  dependency_conflict:
    "Há registros vinculados que impedem a exclusão. Nada foi excluído.",
  not_authorized: "Sua sessão não foi confirmada. Entre novamente. Nada foi excluído.",
  unconfirmed_result:
    "Não conseguimos confirmar o resultado. Atualize a página e confira seus dados antes de tentar de novo.",
  unknown: "Não foi possível excluir os dados. Nada foi excluído.",
};

export function userMessage(code: DeletionErrorCode, ref: string): string {
  return `${USER_MSG[code]} (código ${code}, ref ${ref})`;
}

/** Classifica erro do banco sem expor texto/SQL. Rollback total é garantido pela função plpgsql. */
export function classifyRpcError(err: { code?: string | null; message?: string | null }): DeletionErrorCode {
  const code = err.code ?? "";
  if (code === "23503" || code === "23502" || code === "23514") return "dependency_conflict";
  if (code === "42501" || /unauthorized/i.test(err.message ?? "")) return "not_authorized";
  return "unknown";
}

/** Sucesso só quando o banco devolve um número para cada categoria pedida. */
export function isConfirmedResult(result: unknown, selections: ValidSelection[]): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const r = result as Record<string, unknown>;
  return selections.every((s) => typeof r[s.category] === "number" && Number.isFinite(r[s.category]));
}

export function newErrorRef(): string {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
}
