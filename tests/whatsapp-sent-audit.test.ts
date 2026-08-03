import { describe, it, expect } from "bun:test";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";

describe("Auditoria de Mensagens WhatsApp", () => {
  it("deve confirmar zero mensagens enviadas", async () => {
    // Verificando whatsapp_outbound_queue (se existir)
    const queue = await supabaseAdmin.from('whatsapp_outbound_queue').select('id').eq('status', 'sent');
    expect(queue.data?.length ?? 0).toBe(0);

    // Verificando whatsapp_usage_events (se existir)
    const events = await supabaseAdmin.from('whatsapp_usage_events').select('id').eq('event_type', 'message_sent');
    expect(events.data?.length ?? 0).toBe(0);

    console.log("Queue Length:", queue.data?.length ?? 0, "Events Length:", events.data?.length ?? 0);
  });
});
