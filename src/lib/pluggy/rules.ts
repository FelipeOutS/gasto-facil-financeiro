/**
 * Regras puras da integração Pluggy Open Finance (sem rede, sem banco).
 * Tudo aqui é determinístico e coberto por tests/pluggy-open-finance.test.ts.
 */

/** As duas únicas contas autorizadas (exigem também o papel `owner`). */
export const PLUGGY_ALLOWED_USER_IDS: readonly string[] = Object.freeze([
  "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1", // Felipe
  "47df50ce-df1e-4c54-8fae-0ffb5105478d", // Michael
]);

/** Fase 2: apenas Sandbox. Live exige autorização explícita e mudança de código. */
export const PLUGGY_MODE: "sandbox" | "live" = "sandbox";

export function isPluggyAllowed(userId: string | null | undefined, roles: readonly string[]): boolean {
  if (!userId) return false;
  return PLUGGY_ALLOWED_USER_IDS.includes(userId) && roles.includes("owner");
}

export type PluggyTx = {
  id: string;
  accountId: string;
  description: string | null;
  descriptionRaw?: string | null;
  amount: number;
  date: string;
  type: "DEBIT" | "CREDIT";
  status?: "POSTED" | "PENDING" | null;
  category?: string | null;
  operationType?: string | null;
  creditCardMetadata?: { installmentNumber?: number | null; totalInstallments?: number | null } | null;
  paymentData?: {
    payer?: { documentNumber?: { value?: string | null } | null } | null;
    receiver?: { documentNumber?: { value?: string | null } | null } | null;
  } | null;
};

export type AccountKind = "BANK" | "CREDIT";

export type Classification =
  | { kind: "gasto"; reason: string }
  | { kind: "receita"; reason: string }
  | { kind: "ignorado"; reason: string }
  | { kind: "revisao"; reason: string };

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const BILL_PAYMENT = /(pagamento\s+(de\s+)?fatura|pgto\s+fatura|pag\s+fatura|credit card payment|pagamento recebido)/;
const SAME_OWNER = /(same person transfer|transfer.*same ownership|mesma titularidade|transferencia entre contas)/;
const REFUND = /(estorno|refund|reembolso|chargeback|devolucao)/;

const GENERIC_BOLETO = /(pagamento de boleto|pagto boleto|pag boleto|bank slip|boleto)/;
/** Categorias da Pluggy que NÃO indicam compra (pagamento, ajuste, juros, tarifa, transferência). */
const NON_PURCHASE = /(transfer|payment|pagamento|adjust|ajuste|interest|juros|fee|tarifa|iof|encargo|credito|cashback|bonus|rotativo|saque|withdraw)/;

function hasMerchantEvidence(tx: PluggyTx): boolean {
  const desc = norm(tx.description).replace(/pagamento de boleto|boleto/g, "").trim();
  return desc.length >= 3;
}

/**
 * Cartão de crédito: a Pluggy pode devolver compras como `type: CREDIT` com
 * valor NEGATIVO (visto no Pluggy Bank). Compra só é reconhecida com evidência:
 * confirmada + categoria de comerciante (não pagamento/ajuste/juros/tarifa/
 * transferência). Positivos, divergências sem evidência e ajustes vão para revisão.
 */
function classifyCardTransaction(tx: PluggyTx, text: string): Classification {
  const cat = norm(tx.category);
  const merchantCategory = !!cat && !NON_PURCHASE.test(cat);
  const confirmed = (tx.status ?? "POSTED") === "POSTED";
  if (tx.amount < 0) {
    if (confirmed && merchantCategory && !NON_PURCHASE.test(norm(tx.operationType))) {
      return { kind: "gasto", reason: tx.type === "CREDIT" ? "compra_cartao_valor_negativo" : "compra_cartao" };
    }
    return { kind: "revisao", reason: "cartao_valor_negativo_sem_evidencia" };
  }
  // valor positivo
  if (tx.type === "DEBIT" && !/(ajuste|adjust)/.test(text)) return { kind: "gasto", reason: "compra_cartao" };
  return { kind: "revisao", reason: "credito_em_cartao" };
}

/**
 * Classifica uma transação. Regras conservadoras: tudo que não é claramente
 * gasto ou receita vai para revisão; nada é descartado sem motivo explícito.
 */
export function classifyTransaction(tx: PluggyTx, account: AccountKind, ownDocument?: string | null): Classification {
  if (tx.status === "PENDING") return { kind: "ignorado", reason: "pendente_aguardando_confirmacao" };
  if (!Number.isFinite(tx.amount) || tx.amount === 0) return { kind: "ignorado", reason: "valor_zero_ou_invalido" };

  const text = `${norm(tx.description)} ${norm(tx.descriptionRaw)} ${norm(tx.category)}`;

  if (BILL_PAYMENT.test(text)) return { kind: "ignorado", reason: "pagamento_de_fatura" };
  if (SAME_OWNER.test(text)) return { kind: "ignorado", reason: "transferencia_mesma_titularidade" };
  // Reservas/cofrinhos movem dinheiro do próprio titular dentro da mesma instituição.
  if (norm(tx.operationType) === "transferencia_saldo_reservado" || /^(dinheiro (reservado|retirado)|reserva por gastos)\b/.test(norm(tx.description))) {
    return { kind: "ignorado", reason: "movimentacao_reserva_propria" };
  }
  // Empréstimo: depósito não é receita e parcela mistura principal e juros; decisão é do usuário.
  if (/emprestimo/.test(text)) return { kind: "revisao", reason: "emprestimo" };

  const doc = (ownDocument ?? "").replace(/\D/g, "");
  if (doc) {
    const payer = (tx.paymentData?.payer?.documentNumber?.value ?? "").replace(/\D/g, "");
    const recv = (tx.paymentData?.receiver?.documentNumber?.value ?? "").replace(/\D/g, "");
    if (payer === doc && recv === doc) return { kind: "ignorado", reason: "transferencia_mesma_titularidade" };
  }

  if (REFUND.test(text)) return { kind: "revisao", reason: "estorno" };

  if (account === "CREDIT") return classifyCardTransaction(tx, text);
  if (tx.type === "DEBIT" && GENERIC_BOLETO.test(text) && !hasMerchantEvidence(tx)) {
    return { kind: "revisao", reason: "boleto_sem_identificacao" };
  }
  return tx.type === "DEBIT"
    ? { kind: "gasto", reason: "debito_conta" }
    : { kind: "receita", reason: "credito_conta" };
}

/** Chave de idempotência: o id da Pluggy é único; item+conta reforçam a auditoria. */
export function pluggyDedupeKey(itemId: string, accountId: string, txId: string): string {
  if (!itemId || !accountId || !txId) throw new Error("pluggy_dedupe_key_incompleta");
  return `pluggy:${itemId}:${accountId}:${txId}`;
}

export const GI_CATEGORIAS = [
  "Alimentação",
  "Supermercado",
  "Transporte",
  "Moradia",
  "Contas",
  "Compras",
  "Saúde",
  "Lazer",
  "Assinaturas",
  "Salário",
  "Outros recebimentos",
  "Outras despesas",
] as const;
export type GiCategoria = (typeof GI_CATEGORIAS)[number];

const CATEGORY_RULES: Array<[RegExp, GiCategoria]> = [
  [/(salary|salario|payroll|folha)/, "Salário"],
  [/(supermarket|groceries|supermercado|mercado|atacad|assai|carrefour|pao de acucar)/, "Supermercado"],
  [/(restaurant|food|eating out|delivery|ifood|lanchonete|padaria|alimenta)/, "Alimentação"],
  [/(transport|taxi|ride|uber|99app|gas station|fuel|combustivel|posto|parking|estacionamento|pedagio)/, "Transporte"],
  [/(electricity|energia|eletrobras|light sa|enel|cemig|copel|water|agua|sabesp|gas natural|comgas|telecommunications|telecom|internet|telefon|celular|vivo|claro|tim |oi fibra)/, "Contas"],
  [/(housing|rent|aluguel|condominio|utilities)/, "Moradia"],
  [/(health|pharmacy|farmacia|drogaria|hospital|clinic|medic|dentist|gym|fitness|academia|smart ?fit)/, "Saúde"],
  [/(subscription|streaming|digital services|netflix|spotify|youtube|prime video|disney|apple\.com|google)/, "Assinaturas"],
  [/(leisure|entertainment|cinema|travel|viagem|hotel|lazer|show|ingresso)/, "Lazer"],
  [/(shopping|clothing|electronics|compras|loja|mercado livre|amazon|shopee|magalu)/, "Compras"],
];

export function categorize(tx: Pick<PluggyTx, "category" | "description">, kind: "gasto" | "receita"): GiCategoria {
  const text = `${norm(tx.category)} ${norm(tx.description)}`;
  for (const [re, cat] of CATEGORY_RULES) {
    if (!re.test(text)) continue;
    if (kind === "receita" && cat !== "Salário") continue;
    if (kind === "gasto" && cat === "Salário") continue;
    return cat;
  }
  return kind === "receita" ? "Outros recebimentos" : "Outras despesas";
}

/** Correção manual sempre vence a categoria automática, em qualquer sincronização. */
export function resolveCategoria(manual: string | null | undefined, auto: GiCategoria | null, autoEnabled: boolean): string | null {
  if (manual && manual.trim()) return manual;
  return autoEnabled ? auto : null;
}

export type MpCandidate = { id: string; amount: number; occurredAt: string; status: string };

/**
 * Conciliação Pluggy × Mercado Pago. Nunca descarta: qualquer coincidência de
 * valor exato (centavos) em até 1 dia vira revisão manual.
 */
export function reconcileWithMercadoPago(
  tx: Pick<PluggyTx, "amount" | "date">,
  candidates: readonly MpCandidate[],
): { status: "sem_coincidencia" } | { status: "revisao"; matchIds: string[] } {
  const cents = Math.round(Math.abs(tx.amount) * 100);
  const t = Date.parse(tx.date.slice(0, 10) + "T12:00:00Z");
  const matches = candidates.filter((c) => {
    if (c.status !== "approved") return false;
    if (Math.round(Math.abs(c.amount) * 100) !== cents) return false;
    const d = Date.parse(c.occurredAt.slice(0, 10) + "T12:00:00Z");
    return Math.abs(d - t) <= 86_400_000;
  });
  return matches.length ? { status: "revisao", matchIds: matches.map((m) => m.id) } : { status: "sem_coincidencia" };
}

/**
 * Conexão real SOMENTE LEITURA (staging pluggy_*). Fica false até a aprovação
 * do SQL `docs/migrations-candidate/pluggy-live-readonly.sql`: hoje o banco
 * rejeita is_sandbox=false por CHECK. Gravação financeira continua travada
 * no SQL (pluggy_import_apply exige Sandbox + pluggy_assert_financial_release).
 */
export const PLUGGY_LIVE_READONLY_AUTHORIZED: boolean = true; // Autorizado 19/10/2026 (Preview, só leitura)

/** Únicas instituições reais aceitas nesta etapa (nome normalizado do conector). */
export const PLUGGY_LIVE_CONNECTOR_NAMES: readonly string[] = Object.freeze(["mercado pago"]) // Etapa 1; Nubank entra na etapa 2;

/** Etapa 1: só o conector Open Finance oficial "Mercado Pago" pessoa física (id 606 na Pluggy). */
export const PLUGGY_LIVE_CONNECTOR_IDS: readonly number[] = Object.freeze([606]);

export function isLiveConnectorAllowedName(name: string | null | undefined): boolean {
  const n = norm(name);
  return PLUGGY_LIVE_CONNECTOR_NAMES.some((a) => n === a || n.startsWith(a + " "));
}

/** Valida no servidor o conector: Sandbox sempre; real só com trava liberada e instituição permitida. */
export function assertConnectorAllowed(
  connector: { id: number; name?: string | null; isSandbox?: boolean | null } | null,
  mode = PLUGGY_MODE,
  liveReadonly = PLUGGY_LIVE_READONLY_AUTHORIZED,
): void {
  if (!connector) throw new Error("pluggy_conector_desconhecido");
  if (mode === "live") throw new Error("pluggy_live_nao_autorizado");
  if (connector.isSandbox === true) return;
  if (!liveReadonly) throw new Error("pluggy_conector_nao_sandbox");
  if (connector.isSandbox !== false) throw new Error("pluggy_conector_ambiente_indefinido");
  if (!PLUGGY_LIVE_CONNECTOR_IDS.includes(connector.id) || !isLiveConnectorAllowedName(connector.name))
    throw new Error("pluggy_instituicao_nao_permitida");
}

export type AccessState = "ok" | "pausado_acesso" | "pausado_erro";

/** 401/403 da Pluggy = acesso suspenso (ex.: fim do trial): pausa e não insiste. */
export function accessStateFromHttp(status: number): AccessState {
  if (status === 401 || status === 403) return "pausado_acesso";
  return "ok";
}

export const HISTORY_DAYS_OPTIONS = [30, 90, 180, 365] as const;
export function clampHistoryDays(n: unknown): number {
  const v = Number(n);
  return (HISTORY_DAYS_OPTIONS as readonly number[]).includes(v) ? v : 90;
}

/** Webhook: só aceita token correto (comparação em tempo constante). */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const PLUGGY_WEBHOOK_EVENTS = [
  "item/created",
  "item/updated",
  "item/error",
  "item/deleted",
  "item/waiting_user_action",
  "transactions/created",
  "transactions/updated",
  "transactions/deleted",
] as const;
