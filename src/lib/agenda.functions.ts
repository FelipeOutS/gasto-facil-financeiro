/**
 * GI Agenda — funções do site. Mesmo núcleo do WhatsApp (agenda.server.ts),
 * agindo como o usuário logado (RLS). user_id vem do token, nunca do cliente.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FREQ = z.enum(["diaria", "semanal", "mensal", "anual"]).nullable();

const createSchema = z.object({
  kind: z.enum(["lembrete", "compromisso"]),
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().max(1000).nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  timezone: z.string().max(64).optional(),
  recurrence_freq: FREQ.optional(),
  aviso_minutos_antes: z.number().int().min(0).max(43200).optional(),
  source_type: z.enum(["conta_a_pagar", "cartao", "recorrencia"]).nullable().optional(),
  source_id: z.string().uuid().nullable().optional(),
  aviso_dias_antes: z.number().int().min(0).max(60).nullable().optional(),
});

async function core() {
  return await import("@/server/agenda.server");
}

function toError(err: unknown): never {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  if (e?.code && e?.message) throw new Error(e.message);
  throw err;
}

export const listAgendaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const m = await core();
    const deps = { client: context.supabase };
    const rows = await m.listAgenda(context.userId, { status: "todos", limit: 500 }, deps);
    const items = [] as Array<(typeof rows)[number] & { when_label: string; due_iso: string | null; financeiro_ok: boolean }>;
    for (const r of rows) {
      let due: string | null = null;
      let ok = true;
      if (r.source_type) {
        const snap = await m.resolveFinancialSource(r, deps);
        ok = snap.ok;
        due = snap.ok ? snap.dueIso : null;
      }
      items.push({ ...r, when_label: await m.itemWhenLabel(r, deps), due_iso: due, financeiro_ok: ok });
    }
    return { items };
  });

export const createAgendaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const m = await core();
    try {
      const row = await m.createAgendaItem(context.userId, { ...data, origem: "site" }, { client: context.supabase });
      return { id: row.id };
    } catch (err) {
      toError(err);
    }
  });

export const updateAgendaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        patch: createSchema
          .pick({ kind: true, titulo: true, descricao: true, starts_at: true, recurrence_freq: true, aviso_minutos_antes: true, aviso_dias_antes: true })
          .partial(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const m = await core();
    try {
      const row = await m.updateAgendaItem(context.userId, data.id, data.patch, { client: context.supabase });
      return { id: row.id };
    } catch (err) {
      toError(err);
    }
  });

export const setAgendaStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), action: z.enum(["concluir", "cancelar", "reativar"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const m = await core();
    try {
      const r = await m.setAgendaStatus(context.userId, data.id, data.action, { client: context.supabase });
      return { id: r.row.id, advanced: r.advanced };
    } catch (err) {
      toError(err);
    }
  });

/** Itens financeiros do próprio usuário para vincular (só id + nome). */
export const listAgendaSourcesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [contas, cartoes, recs] = await Promise.all([
      sb.from("contas_a_pagar").select("id, nome, data_vencimento").eq("user_id", context.userId).eq("status", "pendente").order("data_vencimento").limit(100),
      sb.from("cartoes").select("id, nome").eq("user_id", context.userId).limit(50),
      sb.from("recorrencias").select("id, nome").eq("user_id", context.userId).limit(100),
    ]);
    return {
      contas: (contas.data ?? []).map((c) => ({ id: c.id, nome: `${c.nome} (${c.data_vencimento?.split("-").reverse().join("/")})` })),
      cartoes: (cartoes.data ?? []).map((c) => ({ id: c.id, nome: c.nome })),
      recorrencias: (recs.data ?? []).map((c) => ({ id: c.id, nome: c.nome })),
    };
  });
