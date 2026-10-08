import {createHash} from "node:crypto";

/** Durable, short-lived instruction inbox. It never parses or writes finances.
 * A selected item goes to the SAME handler and its normal confirmation flow.
 * In-flight ambiguous items cannot be automatically retried.
 */
export interface AudioBatchDeps {
  client:any;
  now?:()=>Date;
  hasPending:()=>Promise<boolean>;
  process:(text:string,externalId:string)=>Promise<{resposta:string;graphInteractive?:unknown}>;
}
function buttons(id:string,items:Array<{index:number;text:string}>) {
  return {type:"list",body:{text:"Escolha um item para revisar. Cada lançamento terá sua confirmação habitual."},action:{button:"Revisar item",sections:[{title:"Instruções",rows:items.slice(0,10).map(item=>({id:`audio_pick:${id}:${item.index}`,title:`Item ${item.index+1}`,description:item.text.slice(0,72)}))}]}};
}
export async function prepareAudioBatch(userId:string,phone:string,externalId:string,items:string[],deps:Pick<AudioBatchDeps,"client"|"now">) {
  if(items.length>10 || items.some(t=>t.length>1000)) return {resposta:"Esse áudio contém muitas informações. Envie cada instrução separadamente; nenhum lançamento foi criado."};
  const phoneHash=createHash("sha256").update(phone.replace(/\D/g,"")).digest("hex");
  const now=deps.now?.()??new Date();
  const saved=await deps.client.from("whatsapp_audio_batches").upsert({user_id:userId,phone_hash:phoneHash,
    source_external_id:externalId,items:items.map((text,index)=>({index,text,state:"pending"})),
    expires_at:new Date(now.getTime()+30*60_000).toISOString()},
    {onConflict:"user_id,source_external_id",ignoreDuplicates:true}).select("id").maybeSingle();
  if(saved.error) return {resposta:"Não consegui preparar os itens. Nenhum lançamento foi criado. Tente novamente."};
  // A redelivery must not overwrite decisions or send another batch menu.
  if(!saved.data) return {resposta:"",duplicate:true};
  const listed=items.map((text,index)=>({index,text}));
  return {resposta:`Identifiquei ${items.length} itens. Nada foi lançado.\n`+items.map((t,i)=>`${i+1}. ${t}`).join("\n")+
    "\nEscolha um item para revisar. Para cancelar ou corrigir: “cancela item 2” ou “corrige item 2 para ...”.",graphInteractive:buttons(saved.data.id,listed)};
}

export async function handleAudioBatchInput(input:{userId:string;phone:string;text:string},deps:AudioBatchDeps) {
  const phoneHash=createHash("sha256").update(input.phone.replace(/\D/g,"")).digest("hex");
  if (/^(?:meus |ver |revisar )?itens (?:do |de )?audio$/i.test(input.text.normalize("NFD").replace(/[\u0300-\u036f]/g,""))) {
    const rows=await deps.client.from("whatsapp_audio_batches").select("id,items")
      .eq("user_id",input.userId).eq("phone_hash",phoneHash).gt("expires_at",(deps.now?.()??new Date()).toISOString())
      .order("created_at",{ascending:false}).limit(1);
    if(rows.error) return {resposta:"Não consegui consultar os itens de áudio agora."};
    const batch=rows.data?.[0];
    const pending=(batch?.items??[]).filter((item:any)=>item.state==="pending");
    if(!pending.length) return {resposta:"Não há itens pendentes nesse áudio. Consulte as confirmações já enviadas; itens interrompidos não são repetidos automaticamente."};
    return {resposta:"Estes são os itens ainda não encaminhados do seu áudio mais recente.",graphInteractive:buttons(batch.id,pending)};
  }
  const pick=/^audio_pick:([0-9a-f-]{36}):(\d{1,2})$/i.exec(input.text);
  const natural=/^(cancela|cancele|corrige|corrija) (?:o )?item (\d{1,2})(?: para (.+))?$/i.exec(input.text);
  if(!pick && !natural) return null;
  let id=pick?.[1];let index=pick?Number(pick[2]):Number(natural![2])-1;
  if(!id) {
    const found=await deps.client.from("whatsapp_audio_batches").select("id")
      .eq("user_id",input.userId).eq("phone_hash",phoneHash).gt("expires_at",(deps.now?.()??new Date()).toISOString())
      .order("created_at",{ascending:false}).limit(2);
    if(found.error || (found.data??[]).length!==1) return {resposta:"Não consegui identificar um único áudio ativo. Escolha o item pelo menu do áudio correto."};
    id=found.data[0].id;
  }
  const action=pick?"pick":natural![1].toLowerCase().startsWith("cancel")?"cancel":"edit";
  if(action==="pick" && await deps.hasPending()) return {resposta:"Conclua ou cancele a confirmação atual antes de revisar outro item do áudio."};
  const edited=natural?.[3];
  if(action==="edit" && !edited?.trim()) return {resposta:"Envie: corrige item 2 para [a instrução completa corrigida]."};
  const resolved=await deps.client.rpc("whatsapp_audio_batch_item",{p_owner:input.userId,p_phone_hash:phoneHash,
    p_batch:id,p_index:index,p_action:action,p_text:edited??null});
  if(resolved.error) return {resposta:"Não consegui alterar esse item. Nenhuma nova operação foi iniciada."};
  const row=resolved.data;
  if(row?.outcome!=="picked") return {resposta: row?.outcome==="edited"?"Item corrigido. Escolha-o no menu para revisar.":
    row?.outcome==="cancelled"?"Item cancelado; nenhuma operação financeira foi executada.":
    row?.outcome==="already_routed"?"Esse item já foi encaminhado. Para corrigir ou cancelar, use os botões da própria confirmação. Não vou alterar um lançamento já salvo por este menu.":
      "Esse item expirou, já foi revisado ou está em processamento. Não vou repetir uma operação incerta."};
  try {
    const result=await deps.process(row.text,`audio-batch:${id}:${index}`);
    await deps.client.rpc("whatsapp_audio_batch_item",{p_owner:input.userId,p_phone_hash:phoneHash,
      p_batch:id,p_index:index,p_action:"finish",p_text:null});
    // Do not erase the handler's confirmation if finalization is unavailable.
    return result;
  } catch {
    return {resposta:"O processamento desse item foi interrompido. Verifique as confirmações pendentes antes de reenviar; não repetirei automaticamente uma ação incerta."};
  }
}
