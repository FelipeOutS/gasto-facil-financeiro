import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const aiChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { hasAdminMasterRole } = await import("@/server/admin-master.server");
    if (await hasAdminMasterRole(context.userId)) return { ok: true };
    return { ok: false, error: "not_admin" };
  });

export const getMonthForecast = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { hasAdminMasterRole } = await import("@/server/admin-master.server");
    await hasAdminMasterRole(context.userId);
    return { ok: true };
  });

export const getMonthlySmartSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { ok: true };
  });

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ message: z.string() }).parse(d))
  .handler(async ({ context }) => {
    return { ok: true };
  });

export const getChatHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { history: [] };
  });

export const clearChatHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { ok: true };
  });
