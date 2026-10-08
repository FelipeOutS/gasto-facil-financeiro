import {test,expect} from "bun:test";
import {handleAudioBatchInput,prepareAudioBatch} from "../src/server/whatsapp-audio-batch.server";
import {replyIdToTexto} from "../src/server/whatsapp-interactive.server";
const id="11111111-1111-4111-8111-111111111111";
test("interactive IDs retain identity, not generic title",()=>{
  expect(replyIdToTexto(`reminder_confirm:${id}`,"Confirmar")).toBe(`reminder_confirm:${id}`);
  expect(replyIdToTexto(`audio_pick:${id}:1`,"Item 2")).toBe(`audio_pick:${id}:1`);
});
test("selection reuses existing handler; an active confirmation blocks another item",async()=>{
  let calls=0;
  const deps={client:{rpc:async(_name:string,args:any)=>({data:args.p_action==="pick"?{outcome:"picked",text:"recebi 2300 do salário"}:{outcome:"routed"},error:null})},
    hasPending:async()=>false,process:async(text:string,externalId:string)=>{
      calls++;expect(text).toBe("recebi 2300 do salário");expect(externalId).toBe(`audio-batch:${id}:1`);
      return {resposta:"Confirma esta receita?"};}};
  expect((await handleAudioBatchInput({userId:"u",phone:"5511999999999",text:`audio_pick:${id}:1`},deps))?.resposta).toContain("Confirma");
  await handleAudioBatchInput({userId:"u",phone:"5511999999999",text:`audio_pick:${id}:2`},{...deps,hasPending:async()=>true});
  expect(calls).toBe(1);
});
test("duplicate Meta delivery does not overwrite batch or repeat menu",async()=>{
  const q:any={upsert:()=>q,select:()=>q,maybeSingle:async()=>({data:null,error:null})};
  const result=await prepareAudioBatch("u","5511999999999","wamid.same",["gastei 85 mercado","recebi 2300 salario"],{client:{from:()=>q}});
  expect(result.resposta).toBe("");expect(result.duplicate).toBe(true);
});
