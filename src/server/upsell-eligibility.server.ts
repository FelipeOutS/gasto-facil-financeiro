import { supabaseAdmin as sb } from "@/integrations/supabase/client.server";
import { getWhatsAppEntitlement } from "./whatsapp-entitlement.server";
import { getSubscriptionForUserIdentity } from "./subscription.server";

export interface UpsellEligibility {
  eligible: boolean;
  reason?: string;
  config: Record<string, any>;
}

export async function checkUpsellEligibility(userId: string): Promise<UpsellEligibility> {
  const { data: configRows } = await sb.from('upsell_runtime_config').select('key, value');
  const config = (configRows || []).reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {} as any);

  if (config.enabled === false) return { eligible: false, reason: 'upsell_disabled', config };

  // 1. Validar Role
  const { data: roleData } = await sb.from('user_roles').select('role').eq('user_id', userId);
  const roles = (roleData || []).map(r => r.role);
  if (roles.includes('owner') || roles.includes('admin')) {
    return { eligible: false, reason: 'admin_user', config };
  }

  // 2. Validar Plano e Entitlement
  const { data: authUser } = await sb.auth.admin.getUserById(userId);
  const email = authUser?.user?.email ?? null;
  const sub = await getSubscriptionForUserIdentity({ userId, email, repairLink: false });
  
  if (sub.plan !== 'free_ads') return { eligible: false, reason: 'not_free_ads_plan', config };
  if (sub.active && sub.status === 'ativo') return { eligible: false, reason: 'already_active_paid', config };
  
  // 3. Validar Histórico de Uso (Mínimo 48h, 2 dias distintos e volume)
  const createdAt = new Date(authUser?.user?.created_at || '');
  const now = new Date();
  const diffHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  if (diffHours < 48) return { eligible: false, reason: 'new_user_grace_period', config };

  // Validar volume de lançamentos (mínimo 5)
  const { count: expenseCount } = await sb
    .from('expenses')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  
  const { count: incomeCount } = await sb
    .from('incomes')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const totalTransactions = (expenseCount || 0) + (incomeCount || 0);
  if (totalTransactions < 5) return { eligible: false, reason: 'low_usage_volume', config };

  // 4. Verificar Preferências e Snooze
  const { data: prefs } = await sb
    .from('user_communication_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (prefs?.snooze_until && new Date(prefs.snooze_until) > new Date()) {
    return { eligible: false, reason: 'snoozed', config };
  }

  return { eligible: true, config };
}
