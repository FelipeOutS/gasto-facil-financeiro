type CountResult = { count: number | null; error: { message: string } | null };

export interface SentAuditDatabase {
  from(table: "whatsapp_outbound_queue" | "whatsapp_usage_events"): {
    select(
      columns: string,
      options: { count: "exact"; head: true },
    ): {
      eq(column: string, value: string): PromiseLike<CountResult>;
    };
  };
}

/** Read-only audit. A failed query must never be reported as zero messages. */
export async function auditWhatsAppSentMessages(db: SentAuditDatabase) {
  const [queue, events] = await Promise.all([
    db
      .from("whatsapp_outbound_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent"),
    db
      .from("whatsapp_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("usage_type", "outbound"),
  ]);
  if (queue.error || events.error || queue.count === null || events.count === null) {
    throw new Error("Não foi possível concluir a auditoria de mensagens enviadas.");
  }
  return { queueSent: queue.count, usageOutbound: events.count };
}
