import {test,expect,mock} from "bun:test";
mock.module("@/integrations/supabase/client.server",()=>({supabaseAdmin:{}}));
const {reconcileAgendaQueue}=await import("../src/server/whatsapp-agenda-scheduler.server");
const {revalidateAgendaForDispatch}=await import("../src/server/agenda.server");
const {MetaWhatsAppNotificationTransport}=await import("../src/server/whatsapp-meta-transport.server");
test("app closed, failed enqueue, restart, persistent queue and mocked Meta acceptance",async()=>{
  const item:any={id:"11111111-1111-4111-8111-111111111111",user_id:"user-test",status:"ativo",kind:"lembrete",titulo:"Veterinário",
    starts_at:"2026-10-08T18:00:00Z",timezone:"America/Sao_Paulo",updated_at:"2026-10-07T13:00:00Z",aviso_minutos_antes:0,recurrence_freq:null};
  const queue:any[]=[];
  const client={from(table:string){const filters:Array<(r:any)=>boolean>=[];
    const run=()=>({data:(table==="agenda_items"?[item]:queue).filter(r=>filters.every(f=>f(r))),error:null});
    const q:any={select:()=>q,eq:(k:string,v:any)=>{filters.push(r=>r[k]===v);return q;},order:()=>q,range:()=>q,
      maybeSingle:async()=>({...run(),data:run().data[0]??null}),then:(resolve:any)=>resolve(run())};return q;}};
  const now=()=>new Date("2026-10-07T13:00:00Z");
  expect((await reconcileAgendaQueue({client,now,enqueue:async()=>null})).errors).toBe(1);
  const deps={client,now,enqueue:async(row:any)=>{const q={...row,user_id:row.userId,dedupe_key:row.dedupeKey,status:"pending"};queue.push(q);return q;}};
  expect((await reconcileAgendaQueue(deps)).repaired).toBe(1);
  // A new worker process needs only the durable item and queue, no browser/session.
  expect((await reconcileAgendaQueue({...deps})).repaired).toBe(0);
  expect(queue).toHaveLength(1);
  expect(queue[0].scheduledAt.toISOString()).toBe("2026-10-08T18:00:00.000Z");
  const vars=await revalidateAgendaForDispatch({user_id:item.user_id,category:"agenda",entity_type:"agenda_item",entity_id:item.id,payload:queue[0].payload},
    {client,now:()=>new Date("2026-10-08T18:30:00Z")});
  expect(vars.ok).toBe(true);
  let sends=0;
  const transport=new MetaWhatsAppNotificationTransport({graphApiVersion:"v20.0",phoneNumberId:"1234567890",accessToken:"test-only",timeoutMs:1000,
    logger:()=>{},fetchFn:async()=>{sends++;return {status:200,headers:{get:()=>null},text:async()=>JSON.stringify({messages:[{id:"wamid.mocked"}]})};}});
  const result=await transport.sendTemplate({phoneNumberId:"1234567890",recipient:"5511999999999",templateName:"test_reminder",languageCode:"pt_BR",components:[],clientReference:"test-reference",attemptToken:"test-attempt"});
  expect(result.kind).toBe("accepted");expect(sends).toBe(1);
  // Acceptance is NOT a delivery receipt. No fake delivered status is invented.
  expect(queue[0].status).toBe("pending");
  item.status="cancelado";
  expect((await revalidateAgendaForDispatch({user_id:item.user_id,category:"agenda",entity_type:"agenda_item",entity_id:item.id,payload:queue[0].payload},{client})).ok).toBe(false);
});
