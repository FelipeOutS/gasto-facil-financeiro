import { supabase } from "@/integrations/supabase/client";
import { rememberFinancialGeneration } from "./financial-generation";

/** Own account only. Read before reconnect; never re-label already queued operations. */
export async function refreshFinancialGeneration(ownerId: string): Promise<number | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== ownerId) return null;
  const db = supabase as unknown as { from(name:string): {select(columns:string):{eq(column:string,value:string):{maybeSingle():PromiseLike<{data:{generation:unknown}|null;error:unknown}>}}}};
  const {data,error}=await db.from("financial_write_generations").select("generation").eq("user_id",ownerId).maybeSingle();
  if(error) return null; // Missing candidate schema is not authoritative generation zero.
  const value=data ? Number(data.generation) : 0;
  if(!Number.isSafeInteger(value)||value<0) return null;
  rememberFinancialGeneration(ownerId,value);
  return value;
}