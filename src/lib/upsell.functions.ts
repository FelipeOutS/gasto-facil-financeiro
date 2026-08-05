import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { checkUpsellEligibility } from "@/server/upsell-eligibility.server";
import { supabaseAdmin as sb } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getUpsellStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = (context as any).userId;
    if (!userId) return { eligible: false };
    return checkUpsellEligibility(userId);
  });

export const dismissUpsell = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => 
    z.object({ type: z.enum(['banner', 'modal']), trigger: z.string().optional() }).parse(data)
  )
  .handler(async ({ data, context }) => {
    const userId = (context as any).userId;
    if (!userId) return;

    const { data: configRows } = await sb.from('upsell_runtime_config').select('key, value');
    const config = (configRows || []).reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {} as any);

    const snoozeDays = config.dismiss_snooze_days || 14;
    const snoozeUntil = new Date();
    snoozeUntil.setDate(snoozeUntil.getDate() + snoozeDays);

    const { data: current } = await sb.from('user_communication_preferences').select('dismiss_count').eq('user_id', userId).maybeSingle();
    const newCount = (current?.dismiss_count || 0) + 1;
    
    if (newCount >= 3) {
      const maxSnooze = config.max_dismiss_snooze_days || 30;
      snoozeUntil.setDate(new Date().getDate() + maxSnooze);
    }

    const update: any = {
      user_id: userId,
      dismiss_count: newCount,
      snooze_until: snoozeUntil.toISOString(),
      updated_at: new Date().toISOString()
    };
    
    if (data.type === 'banner') update.last_banner_at = new Date().toISOString();
    if (data.type === 'modal') update.last_modal_at = new Date().toISOString();
    if (data.trigger) update.last_trigger = data.trigger;

    await sb.from('user_communication_preferences').upsert(update);
    return { success: true };
  });
