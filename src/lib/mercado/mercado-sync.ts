// Sync layer: Supabase <-> listas-store cache local.
// Mantém a API síncrona dos consumidores intacta.

import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  __setMercadoActiveUser,
  __setMercadoSyncHooks,
  __replaceListasCache,
  __getMercadoActiveUserId,
  MERCADO_LEGACY_ANON_KEY,
  getListas,
  type MercadoLista,
} from "./listas-store";

type Row = {
  id: string;
  user_id: string;
  name: string;
  tipo: string;
  observation: string | null;
  estimate: number | null;
  status: string;
  progress: number;
  items_count: number;
  entries: unknown;
  created_at: string;
  updated_at: string;
};

function rowToLista(r: Row): MercadoLista {
  return {
    id: r.id,
    name: r.name ?? "",
    tipo: (r.tipo as MercadoLista["tipo"]) ?? "outros",
    observation: r.observation ?? undefined,
    estimate: r.estimate ?? undefined,
    status: (r.status as MercadoLista["status"]) ?? "planning",
    items: r.items_count ?? 0,
    progress: r.progress ?? 0,
    entries: Array.isArray(r.entries) ? (r.entries as MercadoLista["entries"]) : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function listaToRow(l: MercadoLista, userId: string) {
  return {
    id: l.id,
    user_id: userId,
    name: l.name,
    tipo: l.tipo,
    observation: l.observation ?? null,
    estimate: l.estimate ?? null,
    status: l.status,
    progress: l.progress,
    items_count: l.items,
    entries: l.entries,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
  };
}

async function pullAll(userId: string) {
  const { data, error } = await supabase
    .from("mercado_listas")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const listas = (data as Row[] | null)?.map(rowToLista) ?? [];
  __replaceListasCache(listas);
}

async function pushUpsert(l: MercadoLista) {
  const uid = __getMercadoActiveUserId();
  if (!uid) return;
  const { error } = await supabase
    .from("mercado_listas")
    .upsert(listaToRow(l, uid), { onConflict: "id" });
  if (error) console.warn("[mercado-sync] upsert failed:", error.message);
}

async function pushDelete(id: string) {
  const uid = __getMercadoActiveUserId();
  if (!uid) return;
  const { error } = await supabase.from("mercado_listas").delete().eq("id", id).eq("user_id", uid);
  if (error) console.warn("[mercado-sync] delete failed:", error.message);
}

function readLegacyAnon(): MercadoLista[] {
  try {
    const raw = localStorage.getItem(MERCADO_LEGACY_ANON_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MercadoLista[]) : [];
  } catch {
    return [];
  }
}

async function migrateLegacyOnce(userId: string) {
  const flag = `gi:mercado:migrated:v1:${userId}`;
  if (localStorage.getItem(flag) === "1") return;
  const legacy = readLegacyAnon();
  if (legacy.length > 0) {
    const rows = legacy.map((l) => listaToRow(l, userId));
    const { error } = await supabase
      .from("mercado_listas")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      console.warn("[mercado-sync] legacy migration failed:", error.message);
      return; // tenta de novo na próxima sessão
    }
  }
  localStorage.setItem(flag, "1");
  // Limpa a chave anônima após migração bem-sucedida para evitar que
  // dados de um usuário sejam migrados novamente para outro usuário
  // que faça login no mesmo dispositivo.
  try { localStorage.removeItem(MERCADO_LEGACY_ANON_KEY); } catch { /* ignore */ }
}

// Registra hooks de mutação uma única vez (módulo-singleton).
let hooksRegistered = false;
function ensureHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  __setMercadoSyncHooks({
    onUpsertLista: (l) => { void pushUpsert(l); },
    onDeleteLista: (id) => { void pushDelete(id); },
  });
}

/** Hook montado no root para sincronizar Mercado com o usuário atual. */
export function useMercadoSync() {
  const { user, loading } = useAuth();
  useEffect(() => {
    ensureHooks();
    if (loading) return;
    const uid = user?.id ?? null;
    __setMercadoActiveUser(uid);
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        await migrateLegacyOnce(uid);
        if (cancelled) return;
        await pullAll(uid);
      } catch (e) {
        console.warn("[mercado-sync] initial sync failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, loading]);
}
