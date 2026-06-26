import { test } from "bun:test";
import { fakeAdmin, resetState } from "./_whatsapp-fake";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";

test("debug", async () => {
  resetState();
  console.log("same?", supabaseAdmin === fakeAdmin);
  const q = await (supabaseAdmin as any).from("cartoes").select("*").eq("user_id", "u1");
  console.log("q", q);
});
