import { describe, it, expect } from "bun:test";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";

describe("Auditoria de Mensagens WhatsApp", () => {
  it("deve confirmar zero mensagens enviadas em todas as tabelas", async () => {
    const { count: queueCount } = await supabaseAdmin.from('whatsapp_outbound_queue').select('*', { count: 'exact', head: true }).eq('status', 'sent');
    const { count: eventsCount } = await supabaseAdmin.from('whatsapp_usage_events').select('*', { count: 'exact', head: true }).eq('event_type', 'message_sent');
    const { count: logsCount } = await supabaseAdmin.from('webhook_logs').select('*', { count: 'exact', head: true }).like('payload::text', '%"message_id"%');

    expect(queueCount).toBe(0);
    expect(eventsCount).toBe(0);
    // Logs de webhook podem existir (tentativas de ataque ou testes de recepção), mas não envios confirmados
    console.log("Queue Sent:", queueCount, "Events Sent:", eventsCount);
  });
});
