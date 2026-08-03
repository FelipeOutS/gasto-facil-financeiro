import { describe, it, expect } from "bun:test";
import { createClient } from "@supabase/supabase-js";

describe("Security Bypass — has_role", () => {
  it("should not allow direct access to has_role from anon client", async () => {
    const url = process.env.VITE_SUPABASE_URL!;
    const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
    const sb = createClient(url, anon);
    
    // Attempting to call has_role via rpc
    const { error } = await sb.rpc('has_role', { 
      _user_id: '00000000-0000-0000-0000-000000000000', 
      _role: 'admin' 
    });
    
    // It should fail with permission denied (403/401)
    expect(error).not.toBeNull();
    console.log("RPC has_role error:", error?.message);
  });
});
