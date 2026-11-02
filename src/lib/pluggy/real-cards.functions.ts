import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const PLUGGY_REAL_CARD_LINKS_AUTHORIZED = false as const;
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }),
  z.object({ action: z.literal("link"), accountId: z.string().min(1).max(100), cardId: z.string().uuid().nullable(), confirmed: z.literal(true) }),
]);
export const pluggyRealCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: z.input<typeof Input>) => Input.parse(v))
  .handler(async ({ data, context }) => {
    const { isPluggyAllowed } = await import("./rules");
    const { rows, createImportDeps } = await import("@/server/pluggy/pluggy-import-store.server");
    const deps = createImportDeps(context.supabase);
    if (!isPluggyAllowed(context.userId, await deps.roles(context.userId))) throw new Error("pluggy_nao_autorizado");
    if (data.action === "link") {
      if (!PLUGGY_REAL_CARD_LINKS_AUTHORIZED) throw new Error("pluggy_vinculo_bloqueado");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Candidate RPC, independently owner-validated in SQL. No financial writer.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (supabaseAdmin as any).rpc("pluggy_link_real_card", { p_user_id: context.userId, p_account_id: data.accountId, p_cartao_id: data.cardId });
      if (r.error) throw new Error("pluggy_vinculo_indisponivel");
      return { ok: true as const };
    }
    const db = context.supabase;
    const [items, accounts, cards, links] = await Promise.all([
      rows(() => db.from("pluggy_items").select("item_id").eq("user_id", context.userId).eq("is_sandbox", false).eq("connector_id", 606).is("deleted_at", null).order("id")),
      rows(() => db.from("pluggy_accounts").select("account_id,item_id,name,number_last4").eq("user_id", context.userId).eq("type", "CREDIT").eq("is_sandbox", false).order("id")),
      rows(() => db.from("cartoes").select("id,nome,dia_fechamento,dia_vencimento").eq("user_id", context.userId).order("id")),
      deps.cardLinks(context.userId),
    ]);
    return { preview: true as const, released: PLUGGY_REAL_CARD_LINKS_AUTHORIZED,
      accounts: accounts.filter(a => items.some(i => i.item_id === a.item_id)).map(a => ({ id: String(a.account_id), name: String(a.name), last4: a.number_last4 ? String(a.number_last4) : null })),
      cards: cards.map(c => ({ id: String(c.id), name: String(c.nome) })), links };
  });
