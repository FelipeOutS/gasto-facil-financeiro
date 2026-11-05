import {blockedReorganizationReply,runReorganization,WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED,WHATSAPP_REORGANIZACAO_PREVIEW_ONLY,type ReorganizationInput,type ReorganizationStore} from './whatsapp-reorganizacao.server';
/** Production flag is never overridden by request data; isolated harness injects store into runReorganization directly. */
export async function dispatchReorganization(input:ReorganizationInput,loadStore:()=>Promise<ReorganizationStore>):Promise<string|null> {
  if(!WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED)return blockedReorganizationReply(input.text,input.pendingSession);
  if(!input.externalId) return "Não consegui validar a referência desta mensagem. Nenhuma operação foi executada.";
  return runReorganization(input,await loadStore(),{previewOnly:WHATSAPP_REORGANIZACAO_PREVIEW_ONLY});
}