/**
 * Server functions da beta fechada do WhatsApp.
 *
 * Regras invariáveis:
 *  - Conceder / revogar / listar são restritas ao Admin Master.
 *  - Usuário comum só consulta o próprio status (`getMyWhatsAppBetaStatus`).
 *  - NUNCA expõe telefone, e-mail, conteúdo de mensagens, tokens
 *    ou IDs internos para o frontend.
 *  - Toda escrita acontece via service_role (supabaseAdmin) após
 *    checagem de Admin Master.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function forbidden(): Response {
  return new Response(
    JSON.stringify({ error: "forbidden", message: "Acesso restrito ao Admin Master." }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

async function assertAdminMaster(userId: string): Promise<void> {
  const { hasAdminMasterRole } = await import("@/server/admin-master.server");
  if (!(await hasAdminMasterRole(userId))) throw forbidden();
}

/** Próprio usuário consulta o status da sua participação na beta. */
export const getMyWhatsAppBetaStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getWhatsAppBetaStatus } = await import("@/server/whatsapp-beta.server");
    const status = await getWhatsAppBetaStatus(context.userId);
    return { status };
  });

/** Admin Master: contagem agregada (sem PII). */
export const whatsappBetaAdminCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMaster(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const nowIso = new Date().toISOString();
    const { count: ativos } = await sb
      .from("whatsapp_beta_access")
      .select("id", { count: "exact", head: true })
      .eq("ativo", true)
      .is("revoked_at", null);
    const { count: revogados } = await sb
      .from("whatsapp_beta_access")
      .select("id", { count: "exact", head: true })
      .not("revoked_at", "is", null);
    const { count: expirados } = await sb
      .from("whatsapp_beta_access")
      .select("id", { count: "exact", head: true })
      .eq("ativo", true)
      .is("revoked_at", null)
      .lte("expires_at", nowIso);
    return {
      ativos: ativos ?? 0,
      revogados: revogados ?? 0,
      expirados: expirados ?? 0,
    };
  });

/** Admin Master: lista somente status seguro (sem PII). */
export const whatsappBetaAdminList = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMaster(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { data } = await sb
      .from("whatsapp_beta_access")
      .select("id, ativo, granted_at, revoked_at, expires_at, observacao")
      .order("granted_at", { ascending: false })
      .limit(200);
    const now = Date.now();
    const itens = (data ?? []).map((r: Record<string, unknown>) => {
      let status: "ativo" | "expirado" | "revogado" | "sem_acesso" = "sem_acesso";
      if (r.revoked_at) status = "revogado";
      else if (!r.ativo) status = "revogado";
      else if (r.expires_at && new Date(r.expires_at as string).getTime() <= now) {
        status = "expirado";
      } else status = "ativo";
      return {
        id: r.id,
        status,
        granted_at: r.granted_at,
        expires_at: r.expires_at,
        observacao: r.observacao ?? null,
      };
    });
    return { itens };
  });

/** Admin Master: concede acesso à beta para um usuário pelo e-mail. */
export const whatsappBetaAdminGrant = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        email: z.string().email().max(200),
        expires_at: z.string().datetime().optional(),
        observacao: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminMaster(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const email = data.email.trim().toLowerCase();

    // Resolve user_id pelo e-mail (Auth Admin API).
    let targetId: string | null = null;
    try {
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = (list?.users ?? []).find(
        (u: { email?: string | null }) => (u.email ?? "").trim().toLowerCase() === email,
      );
      if (found) targetId = found.id;
    } catch {
      targetId = null;
    }
    if (!targetId) {
      return { ok: false as const, motivo: "usuario_nao_encontrado" as const };
    }

    const payload = {
      user_id: targetId,
      ativo: true,
      granted_at: new Date().toISOString(),
      granted_by: context.userId,
      revoked_at: null,
      expires_at: data.expires_at ?? null,
      observacao: data.observacao ?? null,
    };

    const { error } = await sb
      .from("whatsapp_beta_access")
      .upsert(payload, { onConflict: "user_id" });
    if (error) return { ok: false as const, motivo: "erro_persistencia" as const };
    return { ok: true as const };
  });

/** Admin Master: revoga acesso de um participante. */
export const whatsappBetaAdminRevoke = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminMaster(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { error } = await sb
      .from("whatsapp_beta_access")
      .update({ ativo: false, revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) return { ok: false as const };
    return { ok: true as const };
  });
