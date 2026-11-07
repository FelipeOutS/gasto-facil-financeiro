import {blockedReorganizationReply,runReorganization,WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED,WHATSAPP_REORGANIZACAO_PREVIEW_ONLY,type ReorganizationInput,type ReorganizationStore} from './whatsapp-reorganizacao.server';
/** Production flag is never overridden by request data; isolated harness injects store into runReorganization directly. */
import {interpretReorganization,spokenConfirmationCode,restoreCodeOnly} from '@/lib/whatsapp-reorganizacao';
/** Read-only diagnostic only for a plain scope request; controls (apagar/restaurar/código) stay blocked. */
export function isDiagnosticRequest(text:string):boolean{
  const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/\b(apagar|restaur\w*|cancel\w*|consultar)\b/.test(t)||/\d/.test(t)||spokenConfirmationCode(text)!==null||restoreCodeOnly(text)!==null)return false;
  if(interpretReorganization(text,'2000-01-01').kind==='request')return true;
  return /\b(excluir|exclua|excluam|exclui|zer\w*|limp\w*|delet\w*)\b/.test(t)&&/\b(tudo|historico|gastos|despesas|receitas|contas)\b/.test(t);
}
export async function dispatchReorganization(input:ReorganizationInput,loadStore:()=>Promise<ReorganizationStore>,loadDiagnostic?:()=>Promise<string>):Promise<string|null> {
  if(!WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED){
    const blocked=blockedReorganizationReply(input.text,input.pendingSession);
    if(loadDiagnostic&&!input.pendingSession&&isDiagnosticRequest(input.text)){try{return await loadDiagnostic();}catch{return blocked??"Não foi possível consultar seus registros agora. Nada foi alterado.";}}
    return blocked;
  }
  if(!input.externalId) return "Não consegui validar a referência desta mensagem. Nenhuma operação foi executada.";
  return runReorganization(input,await loadStore(),{previewOnly:WHATSAPP_REORGANIZACAO_PREVIEW_ONLY});
}