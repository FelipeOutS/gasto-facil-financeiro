import {test,expect} from "bun:test";
import {agendaTemplateApproved} from "../src/server/whatsapp-agenda-template.server";
test("template approval is fail-closed; name alone does not suffice",()=>{
  const row={internal_key:"gi_agenda_lembrete",meta_name:"gi_agenda_lembrete_v1",language:"pt_BR",category:"UTILITY",version:1,status:"approved",active:true,provider_template_id:"test-id",last_synced_at:"2026-10-07T00:00:00Z"};
  expect(agendaTemplateApproved(row.internal_key,row.meta_name,row)).toBe(true);
  for(const changed of [{status:"pending"},{status:"rejected"},{active:false},{provider_template_id:null},{last_synced_at:null},{category:"MARKETING"},{language:"en_US"}])
    expect(agendaTemplateApproved(row.internal_key,row.meta_name,{...row,...changed})).toBe(false);
  expect(agendaTemplateApproved(row.internal_key,"hello_world",row)).toBe(false);
  expect(agendaTemplateApproved(row.internal_key,row.meta_name,null)).toBe(false);
});
