import {test,expect,mock} from "bun:test";
let admin=false;let recovered:unknown[]=[];
mock.module("@tanstack/react-start",()=>({createServerFn:()=>{
 let validate=(x:unknown)=>x;
 const b={middleware:()=>b,inputValidator:(f:typeof validate)=>{validate=f;return b;},handler:(fn:(x:unknown)=>unknown)=>(input:{data?:unknown;context:{userId:string}})=>fn({...input,data:validate(input.data)})};return b;
}}));
mock.module("@/integrations/supabase/auth-middleware",()=>({requireSupabaseAuth:{}}));
mock.module("@/integrations/supabase/client.server",()=>({supabaseAdmin:{auth:{admin:{getUserById:async()=>({data:{user:{email:"fixture@example.test"}}})}}}}));
mock.module("@/server/admin-master.server",()=>({assertAdminMaster:async()=>{if(!admin)throw Error("forbidden");}}));
mock.module("@/server/whatsapp-reply-outbox-runtime.server",()=>({recoverOwnDurableReply:async(...args:unknown[])=>{recovered=args;return "not_retryable";}}));
const {whatsappAdminRecoverOwnReply}=await import("../src/lib/whatsapp-runtime-admin.functions");
const call=whatsappAdminRecoverOwnReply as unknown as (x:unknown)=>Promise<unknown>;
const id="11111111-1111-4111-8111-111111111111";
test("non-admin cannot invoke recovery",async()=>{
 admin=false;recovered=[];
 await expect(call({context:{userId:"owner-fixture"},data:{id,confirm:true}})).rejects.toBeDefined();
 expect(recovered).toEqual([]);
});
test("admin recovery identity comes only from server context",async()=>{
 admin=true;recovered=[];
 expect(await call({context:{userId:"owner-fixture"},data:{id,confirm:true}})).toEqual({state:"not_retryable"});
 expect(recovered).toEqual([id,"owner-fixture"]);
});
test("another user supplied by caller and missing confirmation are rejected",async()=>{
 admin=true;recovered=[];
 for(const data of [{id,confirm:true,userId:"victim"},{id,confirm:false}]) {
  await expect(Promise.resolve().then(()=>call({context:{userId:"owner-fixture"},data}))).rejects.toBeDefined();
 }
 expect(recovered).toEqual([]);
});
