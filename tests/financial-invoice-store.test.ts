import {beforeEach,expect,mock,test} from "bun:test";
type Row=Record<string,any>;
let rows:Row[]=[];let writes=0;let failure=false;let lost=false;let actor="owner";
mock.module("@/integrations/supabase/client",()=>({supabase:{
 auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},
 rpc:(name:string,args:Row)=>{const result=Promise.resolve({data:name==="can_create_in_account"&&args._owner===actor,error:null});return Object.assign(result,{abortSignal:()=>result});},
 from(table:string){
  let op="read";let payload:Row[]=[];const filters:Row={};let ids:string[]|null=null;
  const q:any={select:()=>q,eq:(k:string,v:unknown)=>{filters[k]=v;return q;},in:(_k:string,v:string[])=>{ids=v;return q;},is:(k:string,v:unknown)=>{filters[k]=v;return q;},abortSignal:()=>q,insert:(r:Row[])=>{op="insert";payload=r;return q;},
   then:(resolve:any,reject:any)=>(async()=>{
    if(table!=="gastos") throw Error("unexpected table "+table);
    if(op==="insert"){writes++;if(failure)return{data:null,error:{message:"insert rejected"}};rows.push(...payload.map(row=>({...row,created_at:"2026-11-03",updated_at:"2026-11-03",deleted_at:null})));if(lost){lost=false;throw Error("response lost");}return{data:null,error:null};}
    return{data:rows.filter(row=>Object.entries(filters).every(([k,v])=>(row[k]??null)===v)&&(!ids||ids.includes(row.id))),error:null};
   })().then(resolve,reject)};return q;
 }
}}));
const store=await import("../src/lib/store");
const input={valor:35,data:"2026-11-03",categoriaId:"outros",descricao:"Teste",formaPagamento:"credito" as const,origem:"fatura_csv",importBatchId:"batch",invoiceMonth:"2026-11"};
beforeEach(()=>{store.setActiveUserId(null);store.setActiveUserId("owner");store.setStoreCanWrite(true);rows=[];writes=0;failure=false;lost=false;actor="owner";});
test("invoice store publishes only confirmed rows",async()=>{const result=await store.addGastosBulkAwait([input],"op-one");expect(writes).toBe(1);expect(result.gastos).toHaveLength(1);expect(result.gastos[0].valor).toBe(35);});
test("failed atomic insert creates no memory success",async()=>{failure=true;await expect(store.addGastosBulkAwait([input],"op-failure")).rejects.toThrow("insert rejected");expect(rows).toHaveLength(0);expect(store.getGastos()).toHaveLength(0);});
test("lost response followed by retry never generates new IDs",async()=>{lost=true;const first=await store.addGastosBulkAwait([input],"op-lost");const id=first.gastos[0].id;const again=await store.addGastosBulkAwait([input],"op-lost");expect(writes).toBe(1);expect(rows).toHaveLength(1);expect(again.gastos[0].id).toBe(id);});
test("tombstoned invoice replay remains absent in active store",async()=>{await store.addGastosBulkAwait([input],"op-hidden");rows[0].deleted_at="2026-11-04";expect((await store.addGastosBulkAwait([input],"op-hidden")).gastos).toHaveLength(0);expect(writes).toBe(1);expect(rows[0].deleted_at).toBe("2026-11-04");});
test("same operation different reviewed amount fails closed",async()=>{await store.addGastosBulkAwait([input],"op-edit");await expect(store.addGastosBulkAwait([{...input,valor:36}],"op-edit")).rejects.toThrow("prévia mudou");expect(writes).toBe(1);});
test("wrong session denied before insert",async()=>{actor="other";await expect(store.addGastosBulkAwait([input],"op-owner")).rejects.toThrow();expect(writes).toBe(0);});