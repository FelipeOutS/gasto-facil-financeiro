import { supabaseAdmin as sb } from "@/integrations/supabase/client.server";
import { getWhatsAppEntitlement } from "@/server/whatsapp-entitlement.server";
import { consumeInboundQuota, getUsageSnapshot } from "@/server/whatsapp-quota.server";

async function main() {
  console.log("--- WHATSAPP STATE AUDIT ---");
  
  // 1. WhatsApp Enabled?
  const { data: config } = await sb.from("whatsapp_runtime_config").select("*").single();
  console.log("Global Enabled:", config?.global_enabled);
  console.log("Inbound Enabled:", config?.inbound_enabled);
  console.log("Outbound Enabled:", config?.outbound_enabled);
  
  // 2. Counts
  const { data: logs } = await sb.from("webhook_logs").select("status, count").select("*");
  const logCounts = logs?.reduce((acc: any, curr: any) => {
    acc[curr.status] = (acc[curr.status] || 0) + 1;
    return acc;
  }, {});
  console.log("Logs Status Summary:", logCounts);
  
  const { count: usersLinked } = await sb.from("whatsapp_links").select("*", { count: 'exact', head: true });
  const { count: confirmedUsers } = await sb.from("whatsapp_links").select("*", { count: 'exact', head: true }).eq("ativo", true);
  console.log("Users Linked:", usersLinked);
  console.log("Confirmed (Active):", confirmedUsers);
  
  const { count: betaUsers } = await sb.from("whatsapp_beta_access").select("*", { count: 'exact', head: true });
  console.log("Beta Approved Users:", betaUsers);

  // 3. Quota check for a dummy or real user if possible
  // Let's check the plans quotas table content
  const { data: quotas } = await sb.from("whatsapp_plan_quotas").select("*");
  console.log("Plan Quotas Matrix:", quotas);

  console.log("--- AUDIT COMPLETE ---");
}

main().catch(console.error);
