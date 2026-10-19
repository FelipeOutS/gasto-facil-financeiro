import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }),
  z.object({ action: z.literal("history"), batchId: z.string().uuid(), confirmed: z.literal(true) }),
  z.object({ action: z.literal("revert"), batchId: z.string().uuid(), confirmed: z.literal(true) }),
  z.object({ action: z.literal("link"), accountId: z.string().min(1).max(100), cardId: z.string().uuid(), confirmed: z.literal(true) }),
  z.object({ action: z.literal("review"), accountId: z.string().min(1).max(100), transactionId: z.string().min(1).max(100), decision: z.enum(["aprovado", "rejeitado"]).nullable() }),
]);

/** No userId, release flag, plan actions or financial values are accepted from the browser. */
export const pluggyImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { isPluggyAllowed } = await import("@/lib/pluggy/rules");
    const roles = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (roles.error || !isPluggyAllowed(context.userId, (roles.data ?? []).map((r) => r.role))) throw new Error("pluggy_nao_autorizado");
    const { runPluggyImport, revertPluggyImport, PLUGGY_IMPORT_RELEASE_AUTHORIZED } = await import("@/server/pluggy/pluggy-import.server");
    // Before any privileged import, financial write, or RPC call. Never supplied by client.
    if (data.action !== "preview" && !PLUGGY_IMPORT_RELEASE_AUTHORIZED) throw new Error("importacao_bloqueada");
    const { createImportDeps, importSchemaReady } = await import("@/server/pluggy/pluggy-import-store.server");
    const deps = createImportDeps(context.supabase);
    if (data.action === "preview") {
      const [plan, schemaReady, cards] = await Promise.all([
        runPluggyImport(deps, { userId: context.userId, batchId: crypto.randomUUID(), mode: "previa" }),
        importSchemaReady(context.supabase, context.userId),
        context.supabase.from("cartoes").select("id,nome,dia_fechamento,dia_vencimento").eq("user_id", context.userId).order("nome"),
      ]);
      if (cards.error || !plan.ok) throw new Error("pluggy_leitura_indisponivel");
      // Batches are read only when candidate schema exists; no seed/creation on page load.
      const batches = schemaReady ? await context.supabase.from("extratos_importados").select("id,status,data_importacao,qtd_movimentacoes").eq("user_id", context.userId).eq("tipo_origem", "pluggy").order("data_importacao", { ascending: false }).limit(30) : { data: [], error: null };
      if (batches.error) throw new Error("pluggy_leitura_indisponivel");
      return { ...plan, schemaReady, releaseAuthorized: PLUGGY_IMPORT_RELEASE_AUTHORIZED, cards: cards.data ?? [], batches: batches.data ?? [] };
    }
    if (!(await importSchemaReady(context.supabase, context.userId))) throw new Error("pluggy_import_rpc_indisponivel");
    if (data.action === "history") return runPluggyImport(deps, { userId: context.userId, batchId: data.batchId, mode: "historico_inicial", confirmed: true });
    if (data.action === "revert") return revertPluggyImport(deps, { userId: context.userId, batchId: data.batchId });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const result = data.action === "link"
      ? await db.rpc("pluggy_link_card", { p_user_id: context.userId, p_account_id: data.accountId, p_cartao_id: data.cardId })
      : await db.rpc("pluggy_review_decide", { p_user_id: context.userId, p_account_id: data.accountId, p_transaction_id: data.transactionId, p_decision: data.decision });
    if (result.error) throw new Error("pluggy_import_rpc_indisponivel");
    return { ok: true as const };
  });