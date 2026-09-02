import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ForecastData {
  ok: boolean;
  status: "positivo" | "negativo" | "atencao" | "neutro";
  label: string;
  hoje: string;
  temDados: boolean;
  resultadoPrevisto: number;
  resultadoAtual: number;
  entradasConfirmadas: number;
  entradasPrevistas: number;
  saidasConfirmadas: number;
  saidasPendentes: number;
  impactos: Array<{ nome: string; valor: number; detalhe?: string }>;
  receitas: Array<{ nome: string; valor: number; detalhe?: string }>;
  faturasDetalhe: Array<{
    cartao: string;
    total: number;
    pago: number;
    pendente: number;
    nome?: string;
    detalhe?: string;
    valor?: number;
  }>;
}

export const getMonthForecast = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) =>
    z.object({ mes: z.number().optional(), ano: z.number().optional() }).optional().parse(d),
  )
  .handler(async ({ data, context }): Promise<ForecastData> => {
    const { agregarMes, mesLabel } = await import("@/server/finance-ai.server");
    const agg = await agregarMes(context.supabase as never, data?.mes, data?.ano);
    return {
      ok: true,
      status: agg.status,
      label: mesLabel(agg.mes, agg.ano),
      hoje: agg.hoje,
      temDados: agg.temDados,
      resultadoPrevisto: agg.resultadoPrevisto,
      resultadoAtual: agg.resultadoAtual,
      entradasConfirmadas: agg.entradasConfirmadas,
      entradasPrevistas: agg.entradasPrevistas,
      saidasConfirmadas: agg.saidasConfirmadas,
      saidasPendentes: agg.saidasPendentes,
      impactos: agg.impactos,
      receitas: agg.receitas,
      faturasDetalhe: agg.faturasDetalhe,
    };
  });

export const getMonthlySmartSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) =>
    z
      .object({
        mes: z.number().optional(),
        ano: z.number().optional(),
        lang: z.string().optional(),
      })
      .optional()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { agregarMes, gerarResumoInteligente } = await import("@/server/finance-ai.server");
    const agg = await agregarMes(context.supabase as never, data?.mes, data?.ano);
    const lang = data?.lang?.toLowerCase().startsWith("en") ? "en" : "pt";
    const out = await gerarResumoInteligente(agg, lang);
    if (!out.ok) {
      return { ok: false, reply: "", error: out.error as { message: string } | null };
    }
    return { ok: true, reply: out.reply, error: null as { message: string } | null };
  });

export const aiChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { hasAdminMasterRole } = await import("@/server/admin-master.server");
    if (await hasAdminMasterRole(context.userId)) return { ok: true };
    return { ok: false, error: "not_admin" };
  });

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => z.object({ message: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    return {
      reply: "Simulado",
      assistantMessageId: "msg-" + Math.random().toString(36).slice(2, 7),
      createdAt: new Date().toISOString(),
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
