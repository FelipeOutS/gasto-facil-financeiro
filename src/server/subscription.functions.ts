import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSubscriptionForUserIdentity } from "./subscription.server";
import { reconcilePendingCardPaymentsForUser } from "./mercadopago.server";

export const getCurrentUserSubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    // Reconcilia pagamentos por cartão pendentes antes de avaliar o estado.
    // Garante que pagamentos aprovados no Mercado Pago ativem o plano mesmo
    // quando o webhook não chega (caso real da usuária Andrea).
    try {
      await reconcilePendingCardPaymentsForUser(userId);
    } catch (err) {
      console.warn("[getCurrentUserSubscription] reconcile falhou", err);
    }
    const sub = await getSubscriptionForUserIdentity({
      userId,
      email: data.user?.email ?? null,
      repairLink: true,
    });
    console.info("[getCurrentUserSubscription]", sub.debug);
    return sub;
  });