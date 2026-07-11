/**
 * WA-B6 — helper compartilhado para stubar `@/server/whatsapp.server`
 * em testes do webhook HTTP.
 *
 * Um único lugar declara os símbolos exportados pelo módulo real. Se um
 * novo símbolo passar a ser importado por `src/routes/api/public.whatsapp.expense.ts`,
 * basta adicioná-lo aqui e as três suítes HTTP continuam verdes.
 *
 * Não substitui `mock.module(...)`: cada suíte ainda faz o mock e pode
 * sobrescrever qualquer campo (`processarMensagemWhatsApp`, etc). Ver
 * uso em `whatsapp-audio*.test.ts` e `whatsapp-webhook-http.test.ts`.
 */

type Send = (telefone: string, texto: string) => Promise<void>;
type SendCta = (
  telefone: string,
  bodyText: string,
  buttonText: string,
  url: string,
) => Promise<{ ok: boolean; status?: number }>;

export interface WhatsAppServerMockOverrides {
  processarMensagemWhatsApp?: (msg: unknown) => Promise<unknown>;
  sendWhatsAppReply?: Send;
  sendWhatsAppInteractiveCtaUrl?: SendCta;
  logWhatsAppInboundReceived?: (...args: unknown[]) => void;
  handlerVersion?: string;
}

export function buildWhatsAppServerMock(
  overrides: WhatsAppServerMockOverrides = {},
): Record<string, unknown> {
  return {
    WHATSAPP_HANDLER_VERSION:
      overrides.handlerVersion ?? "receipt-session-durable-v5",
    logWhatsAppInboundReceived: overrides.logWhatsAppInboundReceived ?? (() => {}),
    processarMensagemWhatsApp:
      overrides.processarMensagemWhatsApp ??
      (async () => ({ status: "sem_pendencia", resposta: "" })),
    sendWhatsAppReply: overrides.sendWhatsAppReply ?? (async () => {}),
    // WA-B6/C10.3 — fake seguro: não envia rede, apenas devolve ok.
    sendWhatsAppInteractiveCtaUrl:
      overrides.sendWhatsAppInteractiveCtaUrl ??
      (async () => ({ ok: true, status: 200 })),
  };
}
