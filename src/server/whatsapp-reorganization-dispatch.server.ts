import {blockedReorganizationReply,runReorganization,WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED,type ReorganizationInput,type ReorganizationStore} from './whatsapp-reorganizacao.server';
/** Production flag is never overridden by request data; isolated harness injects store into runReorganization directly. */
export async function dispatchReorganization(input:ReorganizationInput,loadStore:()=>Promise<ReorganizationStore>):Promise<string|null> {
  if(!WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED)return blockedReorganizationReply(input.text,input.pendingSession);
  return runReorganization(input,await loadStore());
}