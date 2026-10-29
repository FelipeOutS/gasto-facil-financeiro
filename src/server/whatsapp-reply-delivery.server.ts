/**
 * Pacote 2 / A (revisão corretiva) — entrega da RESPOSTA ao usuário, separada
 * do efeito financeiro. Nunca reprocessa a mensagem → nunca grava outro gasto.
 *
 * Classificação CONSERVADORA do resultado do envio à Meta:
 *  - accepted : HTTP 2xx. Significa só "aceito pela API"; NÃO prova entrega ao
 *               usuário (isso só vem do callback de status), e pode vir sem id.
 *  - permanent: 4xx exceto 429, ou configuração ausente → a Meta recusou
 *               explicitamente; não reenvia, mas permite fallback de interativo→texto.
 *  - ambiguous: 5xx, 429, timeout, erro de rede ou exceção → a mensagem PODE ter
 *               saído; NUNCA reenvia nem manda texto por cima.
 *  - transient: reservado; nenhum resultado é classificado assim hoje. O status
 *               HTTP sozinho não garante não-aceitação, então o reenvio automático
 *               está BLOQUEADO por segurança.
 */

export type SendResult = { sent: boolean; reason?: string; status?: number; providerMessageId?: string | null };
export type DeliveryClass = "accepted" | "transient" | "permanent" | "ambiguous";

export function classifySendResult(r: SendResult): DeliveryClass {
  if (r.sent) return "accepted";
  if (typeof r.status === "number") {
    if (r.status >= 200 && r.status <= 299) return "accepted";
    if (r.status === 429 || r.status >= 500) return "ambiguous";
    if (r.status >= 400) return "permanent";
    return "ambiguous";
  }
  if (r.reason === "not_configured" || r.reason === "configuration_error") return "permanent";
  return "ambiguous";
}

/** Executa um envio; qualquer exceção vira resultado ambíguo (sem relançar). */
export async function safeSend(send: () => Promise<SendResult>): Promise<SendResult> {
  try {
    return await send();
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.name : "unknown" };
  }
}

export type ReplyPlanOutcome = {
  outcome: DeliveryClass;
  channel: "interactive" | "text" | "none";
  textAttempted: boolean;
};

/**
 * Interativo (opcional) e, só se ele foi RECUSADO explicitamente (permanent) ou
 * não existe, o texto. Interativo ambíguo → nada por cima.
 */
export async function deliverReplyPlan(
  interactive: (() => Promise<SendResult>) | null,
  text: () => Promise<SendResult>,
): Promise<ReplyPlanOutcome> {
  if (interactive) {
    const c = classifySendResult(await safeSend(interactive));
    if (c === "accepted" || c === "ambiguous") return { outcome: c, channel: "interactive", textAttempted: false };
  }
  const d = await deliverReplyWithRetry(text);
  return { outcome: d.outcome, channel: "text", textAttempted: true };
}

export const REPLY_RETRY_MAX_ATTEMPTS = 2;
export const REPLY_RETRY_DELAY_MS = 700;

export type DeliveryOutcome = { outcome: DeliveryClass; attempts: number };

/**
 * Até `maxAttempts` envios da MESMA resposta, somente enquanto o resultado for
 * `transient`. Pequeno e limitado para caber no tempo do webhook.
 */
export async function deliverReplyWithRetry(
  send: () => Promise<SendResult>,
  opts: { maxAttempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<DeliveryOutcome> {
  const max = Math.max(1, Math.min(opts.maxAttempts ?? REPLY_RETRY_MAX_ATTEMPTS, 3));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempts = 0;
  let last: DeliveryClass = "ambiguous";
  while (attempts < max) {
    attempts++;
    const r = await safeSend(send);
    last = classifySendResult(r);
    if (last !== "transient") break;
    if (attempts < max) await sleep(opts.delayMs ?? REPLY_RETRY_DELAY_MS);
  }
  return { outcome: last, attempts };
}
