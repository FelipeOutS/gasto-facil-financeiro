import { confirmationCode, spokenConfirmationCode, restoreCodeOnly, operationConfirmation, interpretReorganization, randomConfirmationCode, type FinancialScope, type NewIncome } from "@/lib/whatsapp-reorganizacao";
import type { OpeningBalanceRequest } from "@/lib/account-opening-balance";

/** Preparation only. This gate cannot be enabled through caller input. */
export const WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED = false;
export type ReorganizationInput = { userId: string; phone: string; externalId: string; text: string; localDate: string; pendingSession: boolean };
export type ReorganizationResult = { status: string; expenses?: number; incomes?: number; kept?: number; incomeId?: string | null; operationId?: string; code?: string; expiresAt?: string; totalExpenses?: number; totalIncomes?: number; scope?: FinancialScope; income?: NewIncome | null; openingBalance?: OpeningBalanceRequest | null; balanceId?: string | null; cashBeforeCents?: number|null; cashAdjustmentCents?: number|null; leftOut?: LeftOut[]; mode?: "full"; complete?: boolean; card?: number; installments?: number; futureInstallments?: number; recurringEntries?: number; imported?: number; invoices?: number; payables?: number; receivables?: number; transfers?: number; recurrenceRules?: number };
export type LeftOut = { table: "gastos" | "receitas"; motivo: string; n: number; total: number };
export interface ReorganizationStore {
  authorize(userId: string, phone: string): Promise<boolean>;
  prepare(input: ReorganizationInput, scope: FinancialScope, income: NewIncome | null, code: string, balance?: OpeningBalanceRequest): Promise<ReorganizationResult>;
  confirm(input: ReorganizationInput, code: string, operationId?: string): Promise<ReorganizationResult>;
  cancel(input: ReorganizationInput): Promise<ReorganizationResult>;
  status(input: ReorganizationInput): Promise<ReorganizationResult>;
  restore(input: ReorganizationInput): Promise<ReorganizationResult>;
  prepareRestore?(input: ReorganizationInput, operationId: string, code: string): Promise<ReorganizationResult>;
  confirmRestore?(input: ReorganizationInput, operationId: string, code: string): Promise<ReorganizationResult>;
  /** Resolve a limpeza aplicada mais recente do titular (restauração por voz).
   *  Só devolve o identificador; a restauração segue o fluxo normal de
   *  prévia + código exclusivo. Falha fechada (null) quando não suportado. */
  resolveLastApplied?(input: ReorganizationInput): Promise<string | null>;
}
const unavailable = "A reorganização financeira em massa ainda está bloqueada. Não executei limpeza nem cadastrei valores deste pedido.";
const MOTIVO: Record<string, string> = { parcelado: "parcelados", recorrente: "recorrentes", bem: "ligados a bens/financiamentos", importado: "importados (extrato/Open Finance)", cartao: "de cartão/fatura", vinculado: "ligados a contas a pagar/receber" };
/** Lists what stays out with count and value; a partial cleanup is never reported as complete. */
export function leftOutText(items: LeftOut[] | undefined, applied: boolean): string {
  if (!items?.length) return applied ? "" : "\nNenhum lançamento do período fica de fora.";
  const lines = items.map((i) => `• ${i.n} ${i.table === "gastos" ? "gasto(s)" : "receita(s)"} ${MOTIVO[i.motivo] ?? i.motivo}: ${money(Number(i.total))}`);
  const n = items.reduce((a, i) => a + i.n, 0);
  return `\n${applied ? "Limpeza PARCIAL" : "Atenção: limpeza parcial"}. ${n} lançamento(s) do período ${applied ? "continuam" : "vão continuar"} ativos e nos totais, sem alteração:\n${lines.join("\n")}`;
}
const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Blocos vinculados incluídos no "zerar tudo" (somente modo full). */
export function fullBlocksText(r: ReorganizationResult): string {
  if (r.mode !== "full") return "";
  const n = (v?: number) => v ?? 0;
  return `\nInclui: ${n(r.card)} compra(s) de cartão, ${n(r.installments)} parcela(s) (${n(r.futureInstallments)} futura(s)), ${n(r.recurringEntries)} lançamento(s) recorrente(s), ${n(r.imported)} importado(s), ${n(r.invoices)} fatura(s), ${n(r.payables)} conta(s) a pagar, ${n(r.receivables)} conta(s) a receber, ${n(r.transfers)} transferência(s). ${n(r.recurrenceRules)} regra(s) de recorrência serão pausadas para não recriar lançamentos. Importações não serão trazidas de novo enquanto a limpeza valer.\nPreservados: bancos, cartões, metas, investimentos e sua conta.`;
}
function response(result: ReorganizationResult): string {
  if (result.status === "restore_preview" && result.operationId && result.code) return `Prévia de restauração do lote ${result.operationId}: ${result.expenses ?? 0} gastos e ${result.incomes ?? 0} receitas. Registros alterados ou com novos vínculos serão preservados. A receita criada pela limpeza será desfeita somente se permanecer intacta.\nConfirme com RESTAURAR ${result.operationId} ${result.code}${result.mode === "full" ? ` — por áudio, diga "restaurar" e os seis números do código` : ""}. Válido até ${result.expiresAt}. Nada foi restaurado.`;
  if (result.status === "preview" && result.code && result.expiresAt) {
    const scope = result.scope;
    // Escopo total (sem datas) significa histórico completo, INCLUINDO o mês
    // atual — a prévia precisa dizer isso explicitamente. Escopo com fim
    // exclusivo preserva o mês atual. Só se aplica a limpezas (tables>0);
    // operações só de saldo não falam em período de exclusão.
    const periodoTxt = scope?.tables?.length
      ? scope.start == null && scope.end == null
        ? "todo o histórico, incluindo o mês atual"
        : `${scope.start ?? "início do histórico"} até ${scope.end ? `${scope.end} (não incluído)` : "fim do histórico"}`
      : "nenhuma exclusão (somente saldo)";
    const totalPedido = !!scope?.tables?.length && scope.start == null && scope.end == null;
    const cabecalho = totalPedido ? (result.complete === false || result.leftOut?.length ? "ATENÇÃO: isto NÃO zera todo o histórico — há lançamentos vinculados que ficam de fora (lista abaixo).\n" : "Limpeza total do histórico: nenhum lançamento fica de fora.\n") : "";
    return `${cabecalho}Prévia de exclusão reversível: ${result.expenses ?? 0} gastos (${money(result.totalExpenses ?? 0)}) e ${result.incomes ?? 0} receitas (${money(result.totalIncomes ?? 0)}).${fullBlocksText(result)}\nPeríodo: ${periodoTxt}.${result.income ? `\nDepois da limpeza: ${result.income.descricao}, ${money(result.income.valor)}, ${result.income.data}.` : ""}${result.openingBalance ? `\nSaldo informado: ${result.openingBalance.accountName}, ${money(result.openingBalance.amountCents / 100)}, em ${result.openingBalance.effectiveDate}. ${result.openingBalance.kind === "current_adjustment" ? `Conciliação atual: saldo contábil ${money((result.cashBeforeCents ?? 0)/100)}, ajuste ${money((result.cashAdjustmentCents ?? 0)/100)}.` : "Saldo inicial histórico."} Não é receita. Limpeza e saldo serão gravados juntos ou não serão gravados.` : ""}${result.scope?.tables?.length ? `\nEfeito nos relatórios do período: despesas −${money(result.totalExpenses ?? 0)}, receitas −${money(result.totalIncomes ?? 0)}. A limpeza não altera saldo de conta; só o ajuste de saldo informado altera.${leftOutText(result.leftOut, false)}` : ""}\nOs registros serão preservados para restauração, sem apagamento físico.\nTitular validado pelo número vinculado. Lote: ${result.operationId ?? "não informado"}.\nPara confirmar, envie APAGAR ${result.operationId ? `${result.operationId} ` : ""}${result.code} — por áudio, diga "apagar" e os seis números do código. Validade: cinco minutos, até ${result.expiresAt}. Ou envie cancelar a limpeza. Nada foi alterado.`;
  }
  if (result.status === "nothing_eligible") return `Nenhum lançamento do período pode ser excluído com segurança agora. Nada foi alterado.${leftOutText(result.leftOut, false)}`;
  if (result.status === "applied") return `${result.leftOut?.length ? "Reorganização aplicada parcialmente" : "Reorganização concluída"}: ${result.expenses ?? 0} gastos e ${result.incomes ?? 0} receitas excluídos reversivelmente.${leftOutText(result.leftOut, true)}\n${result.incomeId ? " A nova receita foi cadastrada na mesma operação." : ""}${result.balanceId ? " O saldo informado foi registrado na mesma operação, sem criar receita." : ""}\nPara solicitar restauração, envie restaurar limpeza ${result.operationId ?? "e o identificador do lote"}. As telas refletirão os dados ao atualizar ou reconectar.`;
  if (result.status === "replay") return "Essa operação já foi concluída. Nenhum lançamento foi excluído ou cadastrado novamente.";
  if (result.status === "restored" || result.status === "partial") return `Restauração ${result.status === "partial" ? "parcial" : "concluída"}: ${result.expenses ?? 0} gastos e ${result.incomes ?? 0} receitas restaurados; ${result.kept ?? 0} registros com alterações posteriores foram preservados.`;
  if (result.status === "cancelled") return "Solicitação cancelada. A limpeza não foi executada.";
  if (result.status === "changed") return "Os registros mudaram desde a prévia. A operação não foi executada; solicite uma nova prévia e confirmação.";
  if (result.status === "expired") return "O código expirou. A operação não foi executada; solicite uma nova prévia.";
  if (result.status === "wrong_code") return "Código inválido. A operação não foi executada; envie APAGAR e o código exato da prévia.";
  if (result.status === "blocked") return "Este escopo contém vínculos ou permissões que impedem a limpeza segura. A operação não foi executada.";
  return "Não consegui confirmar o resultado. Não repita a operação: envie consultar limpeza para conferir o resultado registrado.";
}

/** Isolated orchestration contract. Production wrapper below never injects a writer. */
export async function runReorganization(input: ReorganizationInput, store: ReorganizationStore): Promise<string | null> {
  try {
    if (!await store.authorize(input.userId, input.phone)) return "Não foi possível validar seu vínculo e sua autorização. A operação não foi executada.";
    if (input.pendingSession) return "Há outra solicitação pendente. Conclua ou cancele essa solicitação antes de iniciar uma limpeza; nenhum valor deste pedido foi cadastrado.";
    const code = confirmationCode(input.text) ?? spokenConfirmationCode(input.text);
    if (code) return response(await store.confirm(input, code, operationConfirmation(input.text, "APAGAR")?.operationId));
    const restoreConfirmation = operationConfirmation(input.text, "RESTAURAR");
    if (restoreConfirmation) return store.confirmRestore ? response(await store.confirmRestore(input, restoreConfirmation.operationId, restoreConfirmation.code)) : unavailable;
    // Restauração por voz sem identificador: o código da prévia de restauração basta.
    const restoreCode = restoreCodeOnly(input.text);
    if (restoreCode) return store.confirmRestore ? response(await store.confirmRestore(input, "", restoreCode)) : unavailable;
    const restoreRequest = /^restaurar(?: a)? limpeza\s+([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.exec(input.text.trim());
    if (restoreRequest) return store.prepareRestore ? response(await store.prepareRestore(input, restoreRequest[1], randomConfirmationCode())) : unavailable;
    // Restauração por voz: "restaurar última limpeza" resolve o lote aplicado
    // mais recente do titular e segue o MESMO fluxo de prévia + código novo.
    // Nunca restaura direto; sem suporte do store, falha fechada.
    if (/^restaurar\s+(?:a\s+)?(?:minha\s+)?(?:ultima|última)\s+limpeza[.!]?$/i.test(input.text.trim())) {
      if (!store.prepareRestore || !store.resolveLastApplied) return unavailable;
      const lastOp = await store.resolveLastApplied(input);
      if (!lastOp) return "Não encontrei uma limpeza concluída para restaurar. Se tiver o identificador do lote, envie restaurar limpeza e o identificador. Nada foi restaurado.";
      return response(await store.prepareRestore(input, lastOp, randomConfirmationCode()));
    }
    if (/^(cancelar|cancela)( a)? limpeza[.!]?$/i.test(input.text.trim())) return response(await store.cancel(input));
    if (/^consultar limpeza[.!]?$/i.test(input.text.trim())) return response(await store.status(input));
    if (/^restaurar( a)? limpeza[.!]?$/i.test(input.text.trim())) return "Informe restaurar limpeza e o identificador exato do lote. Vou preparar uma prévia e um código exclusivo; nenhum registro foi restaurado.";
    const intent = interpretReorganization(input.text, input.localDate);
    if (intent.kind === "ignore") return null;
    if (intent.kind === "clarify") return intent.question;
    if (intent.kind === "unsupported_balance") return "Saldo inicial de conta ainda não tem suporte contábil neste fluxo. Não vou transformar esse saldo em receita. Nenhum valor foi cadastrado.";
    if (intent.kind === "balance") return response(await store.prepare(input, { tables: [], start: null, end: null }, null, randomConfirmationCode(), intent.balance));
    return response(await store.prepare(input, intent.scope, intent.income, randomConfirmationCode(), intent.openingBalance));
  } catch {
    return "Não consegui confirmar o resultado. Não repita a operação: envie consultar limpeza para conferir o resultado registrado.";
  }
}

/** Intercepts destructive/compound requests, without database calls while locked. */
export function blockedReorganizationReply(text: string, pendingSession: boolean): string | null {
  const intent = interpretReorganization(text, "2000-01-01");
  const control =
    /^(apagar\s+(?:[\da-f-]+\s+)?\d+|restaurar\s+[\da-f-]+\s+\d+|consultar limpeza|restaurar( a)? limpeza(?:\s+[\da-f-]+)?|restaurar\s+(?:a\s+)?(?:minha\s+)?(?:ultima|última)\s+limpeza|cancel(?:ar|a)( a)? limpeza)[.!]?$/i.test(text.trim()) ||
    spokenConfirmationCode(text) !== null || restoreCodeOnly(text) !== null;
  if (intent.kind === "ignore" && !control) return null;
  if (pendingSession) return "Há outra solicitação pendente. Conclua ou cancele essa solicitação antes da limpeza. Nenhum valor deste pedido foi cadastrado.";
  if (intent.kind === "unsupported_balance" || intent.kind === "balance") return "Saldo de conta não é receita. A atualização por este fluxo ainda está bloqueada; nenhum valor foi cadastrado.";
  return unavailable;
}