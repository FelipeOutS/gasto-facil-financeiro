import {test,expect,mock} from "bun:test";
let checks=0;
mock.module("../src/server/whatsapp-authz.server",()=>({normalizePhone:(p:string)=>p.replace(/\D/g,""),canUseWhatsAppForSender:async()=>({allowed:++checks===1,userId:"owner"})}));
const {runOutboundForNotification}=await import("../src/server/whatsapp-dispatcher-outbound.server");
const {approvedCatalog}=await import("./_whatsapp-approved-catalog");
test("assinatura revogada durante resolução do template impede transporte",async()=>{
 let transports=0;
 const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:{telefone:"5511900000000",ativo:true,opt_in_em:"2026-01-01",revogado_em:null}})};
 const result=await runOutboundForNotification({id:"fixture",user_id:"owner",notification_type:"gi_conta_vencendo_hoje",payload:{due_date:"2026-10-25"}} as never,"claim",{
  supabaseClient:{from:()=>q} as never,gate:()=>({allowed:true}),catalogLoader:approvedCatalog(),
  loadTemplate:async()=>({key:"gi_conta_vencendo_hoje",active:true,meta_template_name:"gi_conta_vencendo_hoje_v1",payload_schema:{}} as never),
  transportFactory:()=>{transports++;throw Error("must not send");},logger:()=>{}
 });
 expect(result.kind).toBe("no_recipient");expect(checks).toBe(2);expect(transports).toBe(0);
});
