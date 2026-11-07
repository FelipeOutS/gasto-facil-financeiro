/** Conservative utterance boundaries only; financial extraction stays in the
 * existing handlers. Never split currency, installments or arbitrary bytes. */
const START = /^(?:(?:ontem|hoje)\s+)?(?:eu\s+)?(?:gastei|recebi|paguei|comprei|me lembr[ae]|a conta\b|o boleto\b)/i;
export function splitAudioInstructions(text: string): string[] {
  const candidates = text.split(/(?:[.;!?]\s+|\s+(?:e tamb[eé]m|tamb[eé]m|al[eé]m disso|ah,?)\s+|,?\s+e\s+(?=me lembr[ae]))/i)
    .map(s=>s.trim().replace(/^(?:tamb[eé]m|ah,?|al[eé]m disso)\s+/i,"" )).filter(Boolean);
  // Unrecognized continuation must stay attached to its preceding instruction.
  const items: string[]=[];
  for(const candidate of candidates) {
    if(items.length && !START.test(candidate)) items[items.length-1]+=`. ${candidate}`;
    else items.push(candidate);
  }
  return items;
}
export function multiAudioReply(items: string[]): string {
  return `Identifiquei ${items.length} instruções. Para não misturar valores, datas ou confirmações, envie cada item separadamente:\n\n`+
    items.map((text,i)=>`${i+1}. ${text}`).join("\n")+
    "\n\nNenhum lançamento ou lembrete deste áudio foi criado. Você pode corrigir ou omitir cada item antes de enviar.";
}
