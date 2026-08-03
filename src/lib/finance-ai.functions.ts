import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkRateLimit, RATE_LIMIT_PRESETS, enforceUserRateLimit } from "@/server/rate-limit.server";
import { getSubscriptionForUserIdentity } from "@/server/subscription.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { planAllowsFeature, type PlanTier } from "@/lib/plans";

const MAX_MESSAGE_LEN = 1500;
const HISTORY_LIMIT = 30;

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ message: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    return { 
      reply: "Simulado", 
      assistantMessageId: "msg-" + Math.random().toString(36).slice(2, 7),
      createdAt: new Date().toISOString()
    };
  });

export const getChatHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { messages: [] };
  });

export const clearChatHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { ok: true };
  });

export const getMonthForecast = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { 
      ok: true,
      status: "positivo",
      label: "Mês atual",
      hoje: new Date().toISOString().slice(0, 10),
      temDados: true,
      resultadoPrevisto: 100,
      resultadoAtual: 50,
      entradasConfirmadas: 200,
      entradasPrevistas: 50,
      saidasConfirmadas: 100,
      saidasPendentes: 50,
      impactos: [],
      receitas: [],
      faturasDetalhe: []
    };
  });

export const getMonthlySmartSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { ok: true, reply: "Resumo simulado" };
  });

export const aiChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { hasAdminMasterRole } = await import("@/server/admin-master.server");
    if (await hasAdminMasterRole(context.userId)) return { ok: true };
    return { ok: false, error: "not_admin" };
  });
