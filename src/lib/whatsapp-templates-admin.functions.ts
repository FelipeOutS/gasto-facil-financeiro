import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * WA-C11 FASE 4B.2.a — Funções administrativas para gestão de templates Meta.
 * EXCLUSIVO para Admin Master (owner).
 */

async function assertAdminMaster(userId: string): Promise<void> {
  const { hasAdminMasterRole } = await import("@/server/admin-master.server");
  if (!(await hasAdminMasterRole(userId))) {
    throw new Response(
      JSON.stringify({ error: "forbidden", message: "Acesso restrito ao Admin Master." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
}

export const whatsappAdminSyncTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMaster(context.userId);
    const { syncRemoteTemplates } = await import("@/server/whatsapp-meta-template-sync.server");
    const { buildServiceRoleCatalogLoader } = await import("@/server/whatsapp-meta-templates-catalog.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const loader = await buildServiceRoleCatalogLoader();
    
    // Patch applier que persiste no banco
    const applyPatch = async (patch: any) => {
      const { error } = await supabaseAdmin
        .from("whatsapp_meta_templates")
        .update({
          status: patch.status,
          provider_template_id: patch.provider_template_id,
          quality_score: patch.quality_score,
          rejection_reason: patch.rejection_reason,
          last_synced_at: patch.last_synced_at
        })
        .eq("id", patch.id);
      
      if (error) throw new Error(`patch_failed:${error.code}`);
    };

    return await syncRemoteTemplates(loader, { applyPatch });
  });

export const whatsappAdminListLocalTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMaster(context.userId);
    const { buildServiceRoleCatalogLoader } = await import("@/server/whatsapp-meta-templates-catalog.server");
    const loader = await buildServiceRoleCatalogLoader();
    return await loader.listAll();
  });

