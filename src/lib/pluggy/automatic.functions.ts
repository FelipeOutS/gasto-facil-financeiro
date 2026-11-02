import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("set"), enabled: z.boolean(), confirmed: z.literal(true) }),
]);
export const pluggyAutomatic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: z.input<typeof Input>) => Input.parse(v))
  .handler(async ({ data, context }) => {
    const { canUseRealPreview, PLUGGY_REAL_BATCH_IMPORT_AUTHORIZED } = await import("./real-preview");
    const roles = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (roles.error || !canUseRealPreview(context.userId, (roles.data ?? []).map(r => r.role))) throw new Error("pluggy_nao_autorizado");
    const { PLUGGY_REAL_AUTOMATIC_AUTHORIZED } = await import("@/server/pluggy/pluggy-real-automatic.server");
    const released = PLUGGY_REAL_AUTOMATIC_AUTHORIZED && PLUGGY_REAL_BATCH_IMPORT_AUTHORIZED;
    // Read-only, RLS. Missing candidate never becomes implicit consent.
    const r = await context.supabase.from("pluggy_settings").select("*").eq("user_id", context.userId).maybeSingle();
    if (r.error) throw new Error("pluggy_preferencia_indisponivel");
    const settings = r.data as unknown as { real_auto_import?: boolean } | null;
    const schemaReady = typeof settings?.real_auto_import === "boolean";
    if (data.action === "status") return { enabled: settings?.real_auto_import === true, released, schemaReady };
    // Turning off remains available even after release is revoked.
    if (!schemaReady || (data.enabled && !released)) throw new Error("importacao_bloqueada");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = await (supabaseAdmin as any).rpc("pluggy_set_real_automatic", { p_user_id: context.userId, p_enabled: data.enabled });
    if (saved.error || saved.data !== data.enabled) throw new Error("pluggy_preferencia_nao_confirmada");
    return { enabled: data.enabled, released, schemaReady };
  });
