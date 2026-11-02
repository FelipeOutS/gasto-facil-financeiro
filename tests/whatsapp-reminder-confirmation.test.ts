import {test,expect,mock} from "bun:test";
mock.module("@/integrations/supabase/client.server",()=>({supabaseAdmin:{}}));
const {handleReminderConfirmation}=await import("../src/server/whatsapp-reminder-confirmation.server");
const {detectAgendaIntent}=await import("../src/lib/agenda/intent");
const now=()=>new Date("2026-10-07T13:00:00Z");
function fake(timezone: string|null="America/Sao_Paulo") {
  const drafts:any[]=[];
  return {drafts,from(table:string){const q={select:()=>q,eq:()=>q,
    upsert:(row:any)=>{drafts.push(row);return q;},
    maybeSingle:async()=>({data:table==="profiles"?{timezone}:{id:"11111111-1111-4111-8111-111111111111"},error:null})};return q;}};
}
test("text and audio transcript share confirmation; no financial write",async()=>{
  const client=fake();
  const text="me lembra amanhã às 15 horas de levar o cachorro ao veterinário";
  const result=await handleReminderConfirmation({userId:"u",externalId:"wamid.test",text,intent:detectAgendaIntent(text)}, {client,now});
  expect(result?.resposta).toContain("Confirma");
  expect(client.drafts[0].draft.starts_at).toBe("2026-10-08T18:00:00.000Z");
  expect(client.drafts[0].draft.timezone).toBe("America/Sao_Paulo");
  expect(client.drafts).toHaveLength(1);
});
test("no timezone, date, time or future instant means no proposal",async()=>{
  for(const [timezone,text] of [[null,"me lembra amanhã às 15h de pagar energia"],
    ["America/Sao_Paulo","me lembra amanhã de pagar energia"],
    ["America/Sao_Paulo","me lembra hoje às 9h de pagar energia"]] as const){
    const client=fake(timezone);
    await handleReminderConfirmation({userId:"u",externalId:"id",text,intent:detectAgendaIntent(text)}, {client,now});
    expect(client.drafts).toHaveLength(0);
  }
});
test("acceptance is agenda registration, not WhatsApp delivery",async()=>{
  const result=await handleReminderConfirmation({userId:"u",externalId:"id",text:"reminder_confirm:11111111-1111-4111-8111-111111111111",intent:null},
    {client:{rpc:async()=>({data:{outcome:"confirmed",item:{titulo:"Energia",starts_at:"2026-10-08T18:00:00Z",timezone:"America/Sao_Paulo"}},error:null})},
      now,sync:async()=>null});
  expect(result?.resposta).toContain("Não há confirmação de envio");
});
test("DST fold and gap ask clarification, not an arbitrary instant",async()=>{
  for(const text of ["me lembra 01/11/2026 às 01:30 de ligar", "me lembra 14/03/2027 às 02:30 de ligar"]){
    const client=fake("America/New_York");
    const result=await handleReminderConfirmation({userId:"u",externalId:"id",text,intent:detectAgendaIntent(text)}, {client,now});
    expect(client.drafts).toHaveLength(0);
    expect(result?.resposta).toContain("ambíguo");
  }
});
