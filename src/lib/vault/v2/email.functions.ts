import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const vaultEmailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        action: z.enum(["begin", "verify", "notify"]),
        vault: z.string().uuid(),
        nonce: z.string().uuid().optional(),
        code: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { vaultEmail } = await import("@/server/vault-v2-email.server");
    return vaultEmail(data.action, context.supabase, context.userId, data);
  });
