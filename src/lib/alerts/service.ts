// CRUD da tabela user_alerts e sincronização com os drafts gerados.
import { supabase } from "@/integrations/supabase/client";
import type { AlertCategory, AlertPriority, AlertStatus, DraftAlert, UserAlert } from "./types";
import { categoryOf, PRIORITY_RANK } from "./types";

type DbRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  action_label: string | null;
  action_url: string | null;
  metadata: unknown;
  dedupe_key: string;
  period_key: string;
  read_at: string | null;
  resolved_at: string | null;
  ignored_at: string | null;
  created_at: string;
  updated_at: string;
};

function toAlert(r: DbRow): UserAlert {
  return {
    id: r.id,
    user_id: r.user_id,
    type: r.type,
    title: r.title,
    description: r.description,
    priority: (r.priority as AlertPriority) ?? "media",
    status: (r.status as AlertStatus) ?? "unread",
    related_entity_type: r.related_entity_type,
    related_entity_id: r.related_entity_id,
    action_label: r.action_label,
    action_url: r.action_url,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    dedupe_key: r.dedupe_key,
    period_key: r.period_key,
    read_at: r.read_at,
    resolved_at: r.resolved_at,
    ignored_at: r.ignored_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function listAlerts(userId: string): Promise<UserAlert[]> {
  const { data, error } = await supabase
    .from("user_alerts" as never)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return ((data as unknown as DbRow[]) ?? []).map(toAlert);
}

export async function markAlertStatus(id: string, status: AlertStatus): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "read") patch.read_at = new Date().toISOString();
  if (status === "resolved") patch.resolved_at = new Date().toISOString();
  if (status === "ignored") patch.ignored_at = new Date().toISOString();
  const { error } = await supabase
    .from("user_alerts" as never)
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

export async function markAllAsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("user_alerts" as never)
    .update({ status: "read", read_at: new Date().toISOString() } as never)
    .eq("user_id", userId)
    .eq("status", "unread");
  if (error) throw error;
}

export async function deleteAlert(id: string): Promise<void> {
  const { error } = await supabase
    .from("user_alerts" as never)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/**
 * Insere drafts respeitando deduplicação. Se já existe um alerta com mesmo
 * (user_id, dedupe_key, period_key) o INSERT é ignorado — não criamos duplicado
 * nem sobrescrevemos status já tratado pelo usuário.
 */
export async function syncDrafts(userId: string, drafts: DraftAlert[]): Promise<UserAlert[]> {
  if (drafts.length === 0) {
    return listAlerts(userId);
  }
  const payload = drafts.map((d) => ({
    user_id: userId,
    type: d.type,
    title: d.title,
    description: d.description ?? null,
    priority: d.priority,
    related_entity_type: d.related_entity_type ?? null,
    related_entity_id: d.related_entity_id ?? null,
    action_label: d.action_label ?? null,
    action_url: d.action_url ?? null,
    metadata: d.metadata ?? {},
    dedupe_key: d.dedupe_key,
    period_key: d.period_key ?? "",
  }));

  // upsert com ignoreDuplicates = true respeita o índice único (user_id, dedupe_key, period_key)
  const { error } = await supabase.from("user_alerts" as never).upsert(payload as never, {
    onConflict: "user_id,dedupe_key,period_key",
    ignoreDuplicates: true,
  });
  if (error) {
    // não bloqueia a UI se a sync falhar
    console.warn("[alerts] sync error", error);
  }
  return listAlerts(userId);
}

export function filterByCategory(
  alerts: UserAlert[],
  cat: AlertCategory | "todos" | "nao_lidos" | "importantes",
): UserAlert[] {
  if (cat === "todos") return alerts;
  if (cat === "nao_lidos") return alerts.filter((a) => a.status === "unread");
  if (cat === "importantes")
    return alerts.filter((a) => a.priority === "critica" || a.priority === "alta");
  return alerts.filter((a) => categoryOf(a.type) === cat);
}

/** Ordena por prioridade desc, depois por created_at desc. */
export function sortAlerts(alerts: UserAlert[]): UserAlert[] {
  return [...alerts].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 9;
    const pb = PRIORITY_RANK[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return b.created_at.localeCompare(a.created_at);
  });
}
