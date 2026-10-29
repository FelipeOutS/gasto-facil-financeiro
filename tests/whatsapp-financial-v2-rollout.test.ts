import { test, expect } from "bun:test";
import { aplicarExclusao, aplicarRestauracao } from "../src/server/whatsapp-editar-antigo.server";
const snap = { t:"gastos" as const,id:"g",updated_at:"2026-01-01T00:00:00.000Z",descricao:"Fixture",valor:1,data:"2026-01-01",categoria_id:null,allowed:[] };
function client(deleted=false, error:unknown=null) {
 let calls=0; const row={id:"g",updated_at:snap.updated_at,deleted_at:deleted?snap.updated_at:null,forma_pagamento:"pix"};
 const q:any={select:()=>q,eq:()=>q,is:()=>q,not:()=>q,limit:async()=>({data:[],error:null}),maybeSingle:async()=>({data:row,error:null})};
 return {from:()=>q,rpc:async()=>{calls++;return {data:null,error};},calls:()=>calls};
}
test("rollout disabled never calls missing financial RPCs",async()=>{
 const previous=process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION;
 delete process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION;
 try {const d=client(),r=client(true);
 expect(await aplicarExclusao(d,"u",snap,new Date(),"5511","delete:nonce")).toBe("blocked");
 expect(await aplicarRestauracao(r,"u",snap,new Date(),"5511","restore:nonce")).toBe("blocked");
 expect(d.calls()+r.calls()).toBe(0);
 } finally {if(previous===undefined)delete process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION;else process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION=previous;}
});
test("missing RPC fails closed without direct financial writes",async()=>{
 const previous=process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION;
 process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION="2";
 try {const d=client(false,{code:"PGRST202"});expect(await aplicarExclusao(d,"u",snap,new Date(),"5511","delete:nonce")).toBe("error");expect(d.calls()).toBe(1);}
 finally {if(previous===undefined)delete process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION;else process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION=previous;}
});
