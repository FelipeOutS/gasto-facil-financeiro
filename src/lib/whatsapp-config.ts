/**
 * Configuração do número oficial do WhatsApp do Gasto Inteligente.
 *
 * Escopo: este número é EXCLUSIVAMENTE para o usuário enviar mensagens
 * de gasto (ex.: "Mercado 45,90") que serão processadas pelo webhook
 * `/api/public/whatsapp/expense`.
 *
 * Não é canal de suporte, atendimento, vendas ou contato comercial.
 *
 * O número é público (qualquer usuário precisa conhecê-lo para enviar
 * mensagens) e pode ser exposto na UI. Não é segredo.
 */

// E.164 sem o "+" (padrão exigido pela Meta/WhatsApp Cloud API).
const OFFICIAL_NUMBER_E164 = "5511918539158";

/** Retorna o número oficial em formato E.164 sem o "+" (ex.: "5511918539158"). */
export function getOfficialWhatsAppNumber(): string {
  // Preferimos env público se definido, com fallback para a constante.
  const fromEnv = (import.meta.env.VITE_WHATSAPP_NUMERO_OFICIAL as string | undefined)?.trim();
  return fromEnv && /^\d{10,15}$/.test(fromEnv) ? fromEnv : OFFICIAL_NUMBER_E164;
}

/**
 * Retorna o número formatado para exibição BR.
 * Ex.: "5511918539158" -> "+55 (11) 91853-9158".
 */
export function formatWhatsAppNumber(e164: string = getOfficialWhatsAppNumber()): string {
  const d = e164.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) {
    const ddd = d.slice(2, 4);
    const p1 = d.slice(4, 9);
    const p2 = d.slice(9);
    return `+55 (${ddd}) ${p1}-${p2}`;
  }
  if (d.length === 12 && d.startsWith("55")) {
    const ddd = d.slice(2, 4);
    const p1 = d.slice(4, 8);
    const p2 = d.slice(8);
    return `+55 (${ddd}) ${p1}-${p2}`;
  }
  return e164;
}

/** Retorna o número formatado curto (sem "+55"), ex.: "(11) 91853-9158". */
export function formatWhatsAppNumberShort(e164: string = getOfficialWhatsAppNumber()): string {
  const f = formatWhatsAppNumber(e164);
  return f.replace(/^\+55\s*/, "");
}

/**
 * Gera link `wa.me` para abrir a conversa com o número oficial.
 *
 * IMPORTANTE: a mensagem pré-preenchida deve ser GENÉRICA. Nunca incluir
 * `user_id`, e-mail, dados financeiros ou qualquer dado do app.
 *
 * O link é apenas conveniência para o usuário iniciar a conversa — o
 * processamento real ocorre pelo webhook, e o usuário só consegue lançar
 * gastos se seu número estiver vinculado em `whatsapp_links`.
 */
export function getOfficialWhatsAppDeepLink(
  prefilledText: string = "Olá! Quero vincular meu WhatsApp ao Gasto Inteligente para enviar gastos.",
): string {
  const num = getOfficialWhatsAppNumber();
  return `https://wa.me/${num}?text=${encodeURIComponent(prefilledText)}`;
}
