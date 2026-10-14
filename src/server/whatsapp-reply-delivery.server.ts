/**
 * Pacote 2 / A — entrega da RESPOSTA ao usuário, separada do efeito financeiro.
 *
 * Só reenvia a MESMA resposta (nunca reprocessa a mensagem → nunca grava outro
 * gasto). Classificação do resultado do envio à Meta:
 *  - accepted : HTTP 2xx (Meta aceitou; entrega real só por callback de status)
 *  - transient: 429/5xx com resposta HTTP → Meta recusou, seguro tentar de novo
 *  - permanent: demais 4xx / configuração → não tenta de novo
 *  - ambiguous: timeout/erro de rede sem resposta → a Meta PODE ter aceitado;
 *               NÃO reenviar (evita confirmação duplicada), só registrar
 * Sem tabela nova: recuperação durável depois da janela do webhook depende do
 * SQL candidato docs/migrations-candidate/whatsapp-reply-outbox.sql (inativo).
 */

export type SendResult = { sent: boolean; reason?: string; status?: number };
export type DeliveryClass = "accepted" | "transient" | "permanent" | "ambiguous";

export function classifySendResult(r: SendResult): DeliveryClass {
  if (r.sent) return "accepted";
  if (typeof r.status === "number") {
    if (r.status === 429 || (r.status >= 500 && r.status <= 599)) return "transient";
    return "permanent";
  }
  if (r.reason === "not_configured" || r.reason === "configuration_error") return "permanent";
  return "ambiguous";
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
    let r: SendResult;
    try {
      r = await send();
    } catch (e) {
      r = { sent: false, reason: e instanceof Error ? e.name : "unknown" };
    }
    last = classifySendResult(r);
    if (last !== "transient") break;
    if (attempts < max) await sleep(opts.delayMs ?? REPLY_RETRY_DELAY_MS);
  }
  return { outcome: last, attempts };
}
