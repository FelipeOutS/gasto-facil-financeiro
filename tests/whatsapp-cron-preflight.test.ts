import {test,expect,mock} from "bun:test";
mock.module("@/integrations/supabase/client.server",()=>({supabaseAdmin:{}}));
const {cronPreflight,readCronBody}=await import("../src/server/whatsapp-cron-preflight.server");
test("fresh signed-body metadata, atomic replay guard, outage fail-closed",async()=>{
  const seen=new Set<string>();
  const hit=async(o:any)=>{const blocked=seen.has(o.key); seen.add(o.key);return {blocked,count:1,limit:1,retryAfterSeconds:300};};
  const raw=JSON.stringify({timestamp:1000,nonce:"unique_nonce_test_123"});
  expect(await cronPreflight(raw,"proactive",{now:()=>1000000,hit})).toBe("ok");
  expect(await cronPreflight(raw,"proactive",{now:()=>1000000,hit})).toBe("replay");
  expect(await cronPreflight(raw,"proactive",{now:()=>2000000,hit})).toBe("invalid");
  expect(await cronPreflight(raw,"proactive",{now:()=>1000000,hit:async()=>({blocked:false,count:0,limit:1,retryAfterSeconds:300,dbError:true})})).toBe("unavailable");
});
test("bounded body",async()=>{
  expect(await readCronBody(new Request("http://localhost",{method:"POST",body:"x".repeat(4097)}))).toBeNull();
});
