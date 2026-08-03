import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const aiChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { hasAdminMasterRole } = await import("@/server/admin-master.server");
    if (await hasAdminMasterRole(context.userId)) return { ok: true };
    // ... restante da lógica mantida via mock para o exemplo
    return { ok: false, error: "not_admin" };
  });
