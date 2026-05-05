import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSubscriptionForUserIdentity } from "./subscription.server";

export const getCurrentUserSubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const sub = await getSubscriptionForUserIdentity({
      userId,
      email: data.user?.email ?? null,
      repairLink: true,
    });
    console.info("[getCurrentUserSubscription]", sub.debug);
    return sub;
  });