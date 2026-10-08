/** Confirm dates/timezone before creating an Agenda item. No financial writes. */
import { resolveWhen, formatWhen, localParts } from "@/lib/agenda/datetime";
import { tituloFromBody, type AgendaIntent } from "@/lib/agenda/intent";
import { syncAgendaNotification, type AgendaRow } from "./agenda.server";
import {resolveSourceByName,financialDetails} from "./whatsapp-agenda.server";

export interface ReminderConfirmationDeps {
  // Database boundary is injectable; no client or secret is read at import time.
  client: any;
  now?: () => Date;
  sync?: typeof syncAgendaNotification;
}
export async function handleReminderConfirmation(input: {
  userId: string; externalId: string | null; text: string; intent: AgendaIntent | null;
}, deps: ReminderConfirmationDeps): Promise<{resposta: string; graphInteractive?: Record<string, unknown>} | null> {
  const now = deps.now?.() ?? new Date();
  const action = /^reminder_(confirm|cancel):([0-9a-f-]{36})$/i.exec(input.text);
  if (action) {
    const {data, error} = await deps.client.rpc("whatsapp_reminder_resolve", {
      p_owner: input.userId, p_proposal: action[2], p_confirm: action[1] === "confirm",
    });
    if (error || !data) return {resposta:"Não consegui confirmar esse lembrete. Tente novamente."};
    const row = Array.isArray(data) ? data[0] : data;
    if (row.outcome === "cancelled") return {resposta:"Pedido de lembrete cancelado."};
    if (row.outcome !== "confirmed" || !row.item) return {resposta:"Esse pedido expirou ou não está mais disponível. Envie o lembrete novamente."};
    const at = await (deps.sync ?? syncAgendaNotification)(row.item as AgendaRow);
    const detail=row.item.source_type ? await financialDetails(row.item,{client:deps.client,now:()=>now}) :
      `${row.item.titulo}\n${formatWhen(row.item.starts_at, row.item.timezone, now)} (${row.item.timezone})`;
    return {resposta: `Lembrete salvo na Agenda.\n${detail}\n` +
      (at ? "Aviso agendado na fila. A entrega depende do serviço WhatsApp e do template aprovado." :
        "O aviso ainda não pôde ser agendado. Não há confirmação de envio pelo WhatsApp.")};
  }
  if (input.intent?.type !== "criar" && input.intent?.type !== "criar_financeiro") return null;
  if (!input.externalId) return {resposta:"Não consegui identificar essa mensagem. Envie o pedido novamente."};
  const {data: profile, error} = await deps.client.from("profiles").select("timezone").eq("id",input.userId).maybeSingle();
  if (error) return {resposta:"Não consegui consultar seu fuso horário. Tente novamente antes de agendar."};
  const tz = profile?.timezone;
  try { if (!tz) throw new Error(); new Intl.DateTimeFormat("pt-BR",{timeZone:tz}); }
  catch { return {resposta:"Configure seu fuso horário no aplicativo antes de agendar. Não vou presumir um horário para você."}; }
  let draft:Record<string,unknown>;let details:string;
  if(input.intent.type==="criar_financeiro") {
    const sources=await resolveSourceByName(input.userId,input.intent.sourceKind,input.intent.nome,{client:deps.client});
    if(sources.length!==1) return {resposta:sources.length ? "Encontrei mais de um item financeiro. Envie o nome completo para escolher o correto." : "Não encontrei esse item financeiro. Nenhum aviso foi criado."};
    draft={titulo:`${input.intent.sourceKind==="cartao"?"Fatura":input.intent.sourceKind==="recorrencia"?"Assinatura":"Conta"} ${sources[0].nome}`,
      timezone:tz,kind:"lembrete",source_type:input.intent.sourceKind,source_id:sources[0].id,
      aviso_dias_antes:input.intent.diasAntes,aviso_hora_local:9};
    details=await financialDetails({...draft,user_id:input.userId} as AgendaRow,{client:deps.client,now:()=>now});
    details+=`\nFuso: ${tz}. Horário do aviso: 09:00.`;
  } else {
    const {titulo, when} = tituloFromBody(input.intent.when.rest, now, tz);
    const at = resolveWhen(when, now, tz);
    if (!at || (!when.instant && (!when.date || !when.time)) || at.getTime() <= now.getTime())
      return {resposta:"Preciso de uma data futura e um horário explícito. Ex.: me lembra amanhã às 15h de levar o cachorro ao veterinário."};
    if(!when.instant && when.date && when.time) {
      const matches=(date:Date)=>{const lp=localParts(date,tz);return lp.y===when.date!.y && lp.m===when.date!.m && lp.d===when.date!.d && lp.h===when.time!.h && lp.mi===when.time!.mi;};
      // A DST gap or fold must not silently choose another wall-clock time.
      if(!matches(at) || [-120,-90,-60,-30,30,60,90,120].some(minutes=>matches(new Date(at.getTime()+minutes*60_000))))
        return {resposta:"Esse horário é inexistente ou ambíguo no seu fuso. Escolha outro horário para o lembrete."};
    }
    draft={titulo,starts_at:at.toISOString(),timezone:tz,kind:input.intent.kind,recurrence_freq:input.intent.recurrence};
    details=`${titulo}\n${formatWhen(at,tz,now)} (${tz})${input.intent.recurrence ? `\nRepetição: ${input.intent.recurrence}` : ""}`;
  }
  const {data: inserted, error: saveError} = await deps.client.from("whatsapp_reminder_proposals")
    .upsert({user_id:input.userId, source_external_id:input.externalId,
      draft, expires_at:new Date(now.getTime()+30*60_000).toISOString()},
      {onConflict:"user_id,source_external_id",ignoreDuplicates:true}).select("id").maybeSingle();
  const proposal = inserted ?? (!saveError ? (await deps.client.from("whatsapp_reminder_proposals")
    .select("id").eq("user_id",input.userId).eq("source_external_id",input.externalId).maybeSingle()).data : null);
  if (saveError || !proposal) return {resposta:"Não consegui preparar esse pedido. Tente novamente; nenhum lembrete foi criado."};
  const body=`Confirma este lembrete?\n${details}\nNão altera pagamentos ou contas.`;
  return {resposta:body, graphInteractive:{type:"button",body:{text:body},action:{buttons:[
    {type:"reply",reply:{id:`reminder_confirm:${proposal.id}`,title:"Confirmar"}},
    {type:"reply",reply:{id:`reminder_cancel:${proposal.id}`,title:"Cancelar"}},
  ]}}};
}
