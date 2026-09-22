import { supabaseAdmin } from "../src/integrations/supabase/client.server";
import { auditWhatsAppSentMessages } from "../src/server/whatsapp-sent-audit.server";

// Explicit operational audit, outside the unit suite. Does not send messages.
const counts = await auditWhatsAppSentMessages(supabaseAdmin);
console.log(JSON.stringify(counts));
if (process.argv.includes("--expect-zero") && (counts.queueSent > 0 || counts.usageOutbound > 0)) {
  process.exitCode = 1;
}
