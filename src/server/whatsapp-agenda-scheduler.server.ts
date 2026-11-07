/** Repair missing Agenda queue entries. One durable notification queue;
 * no browser timer, no Meta transport, no activation at import time.
 * Called by the dispatcher tick only when explicitly enabled.
 */
import { computeNextAviso, type AgendaDeps, type AgendaRow } from "./agenda.server";
import { enqueueNotification } from "./whatsapp-notifications.server";

export async function reconcileAgendaQueue(deps: AgendaDeps = {}, limit = 100, offset = 0) {
  const client = deps.client ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const pageSize=Math.min(500,Math.max(1,Math.floor(limit)));
  const { data, error } = await client.from("agenda_items").select("*")
    .eq("status", "ativo").order("id").range(offset,offset+pageSize-1);
  if (error) throw new Error("agenda_lookup_unavailable");
  const result = { scanned: 0, repaired: 0, errors: 0, nextOffset: (data ?? []).length === pageSize ? offset+pageSize : null };
  for (const item of (data ?? []) as AgendaRow[]) {
    result.scanned++;
    try {
      const now=deps.now?.() ?? new Date();
      const due = item.starts_at ? new Date(item.starts_at).getTime()-(item.aviso_minutos_antes??0)*60_000 : NaN;
      // Recover a missing one-off entry for up to 24h. Never replay an existing
      // terminal attempt. Older reminders need operator review, not a surprise.
      const reference = !item.recurrence_freq && due <= now.getTime() && due > now.getTime()-86_400_000
        ? new Date(due-1) : now;
      const next = await computeNextAviso(item, {...deps,now:()=>reference});
      if (!next) continue;
      const key = `agenda:${item.id}:${next.at.toISOString()}:${item.updated_at}`;
      const existing = await client.from("whatsapp_notifications").select("id,status")
        .eq("user_id", item.user_id).eq("dedupe_key", key).maybeSingle();
      if (existing.error) throw new Error("queue_lookup_unavailable");
      // Never resurrect cancelled/sent/ambiguous attempts or disturb a lease.
      if (existing.data) continue;
      const enqueue = deps.enqueue ?? enqueueNotification;
      const row = await enqueue({ userId: item.user_id,
        type: item.source_type ? "gi_agenda_financeiro" : "gi_agenda_lembrete",
        category: "agenda", scheduledAt: next.at, dedupeKey: key,
        entityType: "agenda_item", entityId: item.id,
        priority: item.source_type ? "alta" : "media",
        payload: {agenda_item_id: item.id, aviso_at: next.at.toISOString(),
          occurrence_at: next.occurrence?.toISOString() ?? null} });
      if (row === null) throw new Error("queue_enqueue_unavailable");
      result.repaired++;
    } catch { result.errors++; }
  }
  return result;
}
