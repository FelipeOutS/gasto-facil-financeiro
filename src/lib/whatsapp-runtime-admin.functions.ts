/**
 * WA-C11 FASE 3B.3 — Runtime + Quotas Admin (Server Functions).
 *
 * Todas as ações exigem Admin Master real (checagem server-side via
 * `admin-master.server` + Supabase auth). NÃO confia em email/role/plan
 * enviados no body — apenas `context.userId` do middleware.
 *
 * Nenhuma dessas funções envia mensagens, chama Graph API, roda
 * dispatcher ou altera dados reais de usuários. Elas apenas modificam
 * o singleton de runtime e a tabela de quotas.
 *
 * Precedência de segurança:
 *  - Env `WHATSAPP_DISPATCH_ENABLED=false` e
 *    `WHATSAPP_OUTBOUND_HTTP_ENABLED=false` PREVALECEM sobre o runtime.
 *  - `whatsappAdminReadRuntimeSnapshot` inclui o estado efetivo
 *    calculado (env AND runtime) para o painel exibir sem ambiguidade.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdminMasterOrThrow(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { isAdminMasterEmail } = await import("@/server/admin-master.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = supabaseAdmin as any;
  const { data } = await adm.auth.admin.getUserById(userId);
  const email: string | null = data?.user?.email ?? null;
  if (!isAdminMasterEmail(email)) {
    throw new Response(
      JSON.stringify({ error: "forbidden", message: "Acesso restrito ao Admin Master." }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
}

function envFlag(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

export const whatsappAdminReadRuntimeSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMasterOrThrow(context.userId);
    const { readRuntimeConfig } = await import("@/server/whatsapp-runtime-config.server");
    const runtime = await readRuntimeConfig();
    const envDispatch = envFlag("WHATSAPP_DISPATCH_ENABLED");
    const envOutboundHttp = envFlag("WHATSAPP_OUTBOUND_HTTP_ENABLED");
    const effective = {
      inbound_effective: runtime.global_enabled && runtime.inbound_enabled,
      outbound_effective:
        envDispatch &&
        envOutboundHttp &&
        runtime.global_enabled &&
        runtime.outbound_enabled,
      dispatcher_effective: envDispatch && runtime.global_enabled,
      notification_creation_effective:
        runtime.global_enabled && runtime.notification_creation_enabled,
      new_links_effective: runtime.global_enabled && runtime.new_links_enabled,
      rollout_effective: runtime.rollout_enabled ? runtime.rollout_percentage : 0,
    };
    return {
      env: {
        dispatch_enabled: envDispatch,
        outbound_http_enabled: envOutboundHttp,
      },
      runtime,
      effective,
    };
  });

const runtimePatchSchema = z.object({
  patch: z
    .object({
      global_enabled: z.boolean().optional(),
      inbound_enabled: z.boolean().optional(),
      outbound_enabled: z.boolean().optional(),
      notification_creation_enabled: z.boolean().optional(),
      new_links_enabled: z.boolean().optional(),
      rollout_enabled: z.boolean().optional(),
      rollout_percentage: z.number().int().min(0).max(100).optional(),
      global_daily_outbound_limit: z.number().int().min(0).max(1_000_000).optional(),
      maintenance_message_enabled: z.boolean().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: "empty_patch" }),
  reason: z.string().max(500).nullable().optional(),
});

export const whatsappAdminUpdateRuntime = createServerFn({ method: "POST" })
  .inputValidator((d) => runtimePatchSchema.parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminMasterOrThrow(context.userId);
    const { updateRuntimeConfig } = await import("@/server/whatsapp-runtime-config.server");
    const { sanitizeReason } = await import("@/server/whatsapp-quota-admin.server");
    const reason = sanitizeReason(data.reason ?? null);
    return updateRuntimeConfig(data.patch, { adminUserId: context.userId, reason });
  });

export const whatsappAdminListPlanQuotas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMasterOrThrow(context.userId);
    const { listPlanQuotas } = await import("@/server/whatsapp-quota-admin.server");
    return listPlanQuotas();
  });

const quotaPatchSchema = z.object({
  plan_code: z.string().min(1).max(64),
  patch: z
    .object({
      inbound_monthly_limit: z.number().optional(),
      outbound_monthly_limit: z.number().optional(),
      financial_actions_monthly_limit: z.number().optional(),
      daily_inbound_limit: z.number().optional(),
      daily_outbound_limit: z.number().optional(),
      per_minute_limit: z.number().optional(),
      enabled: z.boolean().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: "empty_patch" }),
  reason: z.string().max(500),
});

export const whatsappAdminUpdatePlanQuota = createServerFn({ method: "POST" })
  .inputValidator((d) => quotaPatchSchema.parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminMasterOrThrow(context.userId);
    const { updatePlanQuota } = await import("@/server/whatsapp-quota-admin.server");
    return updatePlanQuota(
      data.plan_code,
      data.patch,
      { adminUserId: context.userId, reason: data.reason },
    );
  });

export const whatsappAdminGetUsageSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminMasterOrThrow(context.userId);
    const { getUsageSnapshot } = await import("@/server/whatsapp-quota-admin.server");
    return getUsageSnapshot();
  });
