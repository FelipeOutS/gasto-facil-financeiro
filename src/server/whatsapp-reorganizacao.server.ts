import { confirmationCode, interpretReorganization, randomConfirmationCode, type FinancialScope, type NewIncome } from "@/lib/whatsapp-reorganizacao";

/** Preparation only. This gate cannot be enabled through caller input. */
export const WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED = false;
export type ReorganizationInput = { userId: string; phone: string; externalId: string; text: string; localDate: string; pendingSession: boolean };
export type ReorganizationResult = { status: string; expenses?: number; incomes?: number; kept?: number; incomeId?: string | null; operationId?: string; code?: string; expiresAt?: string; totalExpenses?: number; totalIncomes?: number; scope?: FinancialScope; income?: NewIncome | null };
export interface ReorganizationStore {
  authorize(userId: string, phone: string): Promise<boolean>;
  prepare(input: ReorganizationInput, scope: FinancialScope, income: NewIncome | null, code: string): Promise<ReorganizationResult>;
  confirm(input: ReorganizationInput, code: string): Promise<ReorganizationResult>;
  cancel(input: ReorganizationInput): Promise<ReorganizationResult>;
  status(input: ReorganizationInput): Promise<ReorganizationResult>;
  restore(input: ReorganizationInput): Promise<ReorganizationResult>;
}
const unavailable = "A reorganização financeira em massa ainda está bloqueada. Não executei limpeza nem cadastrei valores deste pedido.";
const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function response(result: ReorganizationResult): string {
  if (result.status === "preview" && result.code && result.expiresAt) {
    const scope = result.scope;
    return `Prévia de exclusão reversível: ${result.expenses ?? 0} gastos (${money(result.totalExpenses ?? 0)}) e ${result.incomes ?? 0} receitas (${money(result.totalIncomes ?? 0)}).\nPeríodo: ${scope?.start ?? "início do histórico"} até ${scope?.end ? `${scope.end} (não incluído)` : "fim do histórico"}.${result.income ? `\nDepois da limpeza: ${result.income.descricao}, ${money(result.income.valor)}, ${result.income.data}.` : ""}\nOs registros serão preservados para restauração, sem apagamento físico.\nPara confirmar, envie APAGAR ${result.code}. Validade: cinco minutos, até ${result.expiresAt}. Ou envie cancelar a limpeza. Nada foi alterado.`;
  }
  if (result.status === "applied") return `Reorganização concluída: ${result.expenses ?? 0} gastos e ${result.incomes ?? 0} receitas excluídos reversivelmente.${result.incomeId ? " A nova receita foi cadastrada na mesma operação." : ""}\nPara solicitar restauração, envie restaurar a limpeza. As telas refletirão os dados ao atualizar ou reconectar.`;
  if (result.status === "replay") return "Essa operação já foi concluída. Nenhum lançamento foi excluído ou cadastrado novamente.";
  if (result.status === "restored") return `Restauração concluída: ${result.expenses ?? 0} gastos e ${result.incomes ?? 0} receitas restaurados; ${result.kept ?? 0} registros com alterações posteriores foram preservados.`;
  if (result.status === "cancelled") return "Solicitação cancelada. A limpeza não foi executada.";
  if (result.status === "changed") return "Os registros mudaram desde a prévia. A operação não foi executada; solicite uma nova prévia e confirmação.";
  if (result.status === "expired") return "O código expirou. A operação não foi executada; solicite uma nova prévia.";
  if (result.status === "wrong_code") return "Código inválido. A operação não foi executada; envie APAGAR e o código exato da prévia.";
  if (result.status === "blocked") return "Este escopo contém vínculos ou permissões que impedem a limpeza segura. A operação não foi executada.";
  return "Não consegui confirmar o resultado. Não repita a operação: envie consultar limpeza para conferir o resultado registrado.";
}

/** Isolated orchestration contract. Production wrapper below never injects a writer. */
export async function runReorganization(input: ReorganizationInput, store: ReorganizationStore): Promise<string | null> {
  if (!await store.authorize(input.userId, input.phone)) return "Não foi possível validar seu vínculo e sua autorização. A operação não foi executada.";
  if (input.pendingSession) return "Há outra solicitação pendente. Conclua ou cancele essa solicitação antes de iniciar uma limpeza; nenhum valor deste pedido foi cadastrado.";
  const code = confirmationCode(input.text);
  try {
    if (code) return response(await store.confirm(input, code));
    if (/^(cancelar|cancela)( a)? limpeza[.!]?$/i.test(input.text.trim())) return response(await store.cancel(input));
    if (/^consultar limpeza[.!]?$/i.test(input.text.trim())) return response(await store.status(input));
    if (/^restaurar( a)? limpeza[.!]?$/i.test(input.text.trim())) return response(await store.restore(input));
    const intent = interpretReorganization(input.text, input.localDate);
    if (intent.kind === "ignore") return null;
    if (intent.kind === "clarify") return intent.question;
    if (intent.kind === "unsupported_balance") return "Saldo inicial de conta ainda não tem suporte contábil neste fluxo. Não vou transformar esse saldo em receita. Nenhum valor foi cadastrado.";
    return response(await store.prepare(input, intent.scope, intent.income, randomConfirmationCode()));
  } catch {
    return "Não consegui confirmar o resultado. Não repita a operação: envie consultar limpeza para conferir o resultado registrado.";
  }
}

/** Intercepts destructive/compound requests, without database calls while locked. */
export function blockedReorganizationReply(text: string, pendingSession: boolean): string | null {
  const intent = interpretReorganization(text, "2000-01-01");
  const control = /^(apagar\s+\d+|consultar limpeza|restaurar( a)? limpeza|cancel(?:ar|a)( a)? limpeza)[.!]?$/i.test(text.trim());
  if (intent.kind === "ignore" && !control) return null;
  if (pendingSession) return "Há outra solicitação pendente. Conclua ou cancele essa solicitação antes da limpeza. Nenhum valor deste pedido foi cadastrado.";
  if (intent.kind === "unsupported_balance") return "Saldo inicial não é receita e ainda não é suportado neste fluxo. Nenhum valor foi cadastrado.";
  return unavailable;
}