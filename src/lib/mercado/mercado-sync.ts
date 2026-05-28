// Sync layer: Supabase <-> stores locais do Mercado Inteligente.
// Mantém a API síncrona dos consumidores intacta. Local-first: erros de
// rede apenas geram console.warn, nunca quebram a UI.

import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  __setMercadoActiveUser,
  __setMercadoSyncHooks,
  __setMercadoHistoricoSyncHooks,
  __replaceListasCache,
  __replaceHistoricoCache,
  __getMercadoActiveUserId,
  MERCADO_LEGACY_ANON_KEY,
  MERCADO_HISTORICO_LEGACY_ANON_KEY,
  getListas,
  getHistoricoCompras,
  normalizeHistorico,
  type MercadoLista,
  type MercadoCompraHistorico,
} from "./listas-store";
import {
  __setMercadoPrecosActiveUser,
  __setMercadoPrecosSyncHooks,
  __replacePrecosCache,
  getHistoricoPrecos,
  MERCADO_PRECOS_LEGACY_ANON_KEY,
  MERCADO_PRECOS_STORAGE_KEY,
  buildProdutoKey,
  type MercadoPrecoLocal,
} from "./precos-history";

// ============================================================
// Listas
// ============================================================

type ListaRow = {
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

function listaRowToLista(r: ListaRow): MercadoLista {
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

// ----- Tombstones de exclusão de listas (local-first) ------
// Evita que listas excluídas em um dispositivo sejam "ressuscitadas" pelo
// merge ao puxar do Supabase em outro dispositivo (ou no mesmo offline).
const LISTAS_TOMBSTONE_KEY_BASE = "gi:mercado:listas:deleted:v1";
type Tombstone = { id: string; deletedAt: string };

function tombstoneKey(uid: string) {
  return `${LISTAS_TOMBSTONE_KEY_BASE}:${uid}`;
}
function readTombstones(uid: string | null): Tombstone[] {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(tombstoneKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is Tombstone =>
        !!t &&
        typeof (t as Tombstone).id === "string" &&
        typeof (t as Tombstone).deletedAt === "string",
    );
  } catch { return []; }
}
function writeTombstones(uid: string | null, ts: Tombstone[]) {
  if (!uid) return;
  try { localStorage.setItem(tombstoneKey(uid), JSON.stringify(ts)); } catch { /* ignore */ }
}
function addTombstone(uid: string | null, id: string) {
  if (!uid || !id) return;
  const current = readTombstones(uid);
  if (current.some((t) => t.id === id)) return;
  current.push({ id, deletedAt: new Date().toISOString() });
  writeTombstones(uid, current);
}
function removeTombstones(uid: string | null, ids: Iterable<string>) {
  if (!uid) return;
  const drop = new Set(ids);
  if (drop.size === 0) return;
  const current = readTombstones(uid);
  const next = current.filter((t) => !drop.has(t.id));
  if (next.length !== current.length) writeTombstones(uid, next);
}

async function pullListas(userId: string) {
  const { data, error } = await supabase
    .from("mercado_listas")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const server = (data as ListaRow[] | null)?.map(listaRowToLista) ?? [];
  const local = getListas();
  const tombstones = readTombstones(userId);
  const tombSet = new Set(tombstones.map((t) => t.id));
  const serverById = new Map(server.map((l) => [l.id, l]));
  const localById = new Map(local.map((l) => [l.id, l]));
  const merged: MercadoLista[] = [];
  const orphans: MercadoLista[] = [];
  const deleteRetries: string[] = [];
  // Server + conflict resolution; respeita tombstones locais.
  for (const s of server) {
    if (tombSet.has(s.id)) {
      // Usuário deletou neste dispositivo; servidor ainda tem -> reenvia delete.
      deleteRetries.push(s.id);
      continue;
    }
    const l = localById.get(s.id);
    if (l && l.updatedAt && s.updatedAt && l.updatedAt > s.updatedAt) {
      merged.push(l);
      orphans.push(l); // re-push newer local
    } else {
      merged.push(s);
    }
  }
  // Local-only items not on server (não reenviar se está em tombstone).
  for (const l of local) {
    if (!serverById.has(l.id) && !tombSet.has(l.id)) {
      merged.push(l);
      orphans.push(l);
    }
  }
  merged.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  __replaceListasCache(merged);
  for (const o of orphans) void pushUpsertLista(o);
  for (const id of deleteRetries) void pushDeleteLista(id);
  // Limpa tombstones já confirmados: servidor não retornou e o local não tem.
  const localIds = new Set(local.map((l) => l.id));
  const serverIds = new Set(server.map((l) => l.id));
  const confirmed = tombstones
    .filter((t) => !serverIds.has(t.id) && !localIds.has(t.id))
    .map((t) => t.id);
  if (confirmed.length > 0) removeTombstones(userId, confirmed);
}


async function pushUpsertLista(l: MercadoLista) {
  const uid = __getMercadoActiveUserId();
  if (!uid) return;
  const { error } = await supabase
    .from("mercado_listas")
    .upsert(listaToRow(l, uid), { onConflict: "id" });
  if (error) console.warn("[mercado-sync] upsert lista failed:", error.message);
}

async function pushDeleteLista(id: string) {
  const uid = __getMercadoActiveUserId();
  if (!uid) return;
  const { error } = await supabase.from("mercado_listas").delete().eq("id", id).eq("user_id", uid);
  if (error) console.warn("[mercado-sync] delete lista failed:", error.message);
}

function readLegacyAnonListas(): MercadoLista[] {
  try {
    const raw = localStorage.getItem(MERCADO_LEGACY_ANON_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MercadoLista[]) : [];
  } catch {
    return [];
  }
}

async function migrateLegacyListasOnce(userId: string) {
  const flag = `gi:mercado:migrated:v1:${userId}`;
  if (localStorage.getItem(flag) === "1") return;
  const legacy = readLegacyAnonListas();
  if (legacy.length > 0) {
    const rows = legacy.map((l) => listaToRow(l, userId));
    const { error } = await supabase
      .from("mercado_listas")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      console.warn("[mercado-sync] legacy listas migration failed:", error.message);
      return;
    }
  }
  localStorage.setItem(flag, "1");
  try { localStorage.removeItem(MERCADO_LEGACY_ANON_KEY); } catch { /* ignore */ }
}

// ============================================================
// Histórico de compras
// ============================================================

type HistoricoRow = {
  id: string;
  user_id: string;
  lista_id: string | null;
  nome: string;
  tipo: string;
  mercado_nome: string | null;
  total_estimado: number | null;
  total_comprado_estimado: number | null;
  total_itens: number | null;
  itens_comprados: number | null;
  itens_pendentes: number | null;
  percentual_concluido: number | null;
  economia_ou_estouro: number | null;
  budget: number | null;
  itens_snapshot: unknown;
  concluida_em: string;
};

function historicoRowToEntry(r: HistoricoRow): MercadoCompraHistorico | null {
  const raw = {
    id: r.id,
    listaId: r.lista_id ?? "",
    nome: r.nome,
    tipo: r.tipo,
    concluidaEm: r.concluida_em,
    totalItens: r.total_itens ?? 0,
    itensComprados: r.itens_comprados ?? 0,
    itensPendentes: r.itens_pendentes ?? 0,
    totalEstimado: Number(r.total_estimado ?? 0),
    totalCompradoEstimado: Number(r.total_comprado_estimado ?? 0),
    orcamento: r.budget != null ? Number(r.budget) : undefined,
    percentualConcluido: r.percentual_concluido ?? 0,
    economiaOuEstouro: Number(r.economia_ou_estouro ?? 0),
    itensSnapshot: Array.isArray(r.itens_snapshot) ? r.itens_snapshot : [],
    mercadoNome: r.mercado_nome ?? undefined,
  };
  return normalizeHistorico(raw);
}

function historicoToRow(h: MercadoCompraHistorico, userId: string) {
  return {
    id: h.id,
    user_id: userId,
    lista_id: h.listaId || null,
    nome: h.nome,
    tipo: h.tipo,
    mercado_nome: h.mercadoNome ?? null,
    total_estimado: h.totalEstimado ?? 0,
    total_comprado_estimado: h.totalCompradoEstimado ?? 0,
    total_itens: h.totalItens ?? 0,
    itens_comprados: h.itensComprados ?? 0,
    itens_pendentes: h.itensPendentes ?? 0,
    percentual_concluido: h.percentualConcluido ?? 0,
    economia_ou_estouro: h.economiaOuEstouro ?? null,
    budget: h.orcamento ?? null,
    itens_snapshot: h.itensSnapshot ?? [],
    concluida_em: h.concluidaEm,
  };
}

async function pullHistoricoCompras(userId: string) {
  const { data, error } = await supabase
    .from("mercado_historico_compras")
    .select("*")
    .eq("user_id", userId)
    .order("concluida_em", { ascending: false });
  if (error) throw error;
  const server = (data as HistoricoRow[] | null)
    ?.map(historicoRowToEntry)
    .filter((x): x is MercadoCompraHistorico => x !== null) ?? [];
  const local = getHistoricoCompras();
  const serverIds = new Set(server.map((h) => h.id));
  const orphans = local.filter((h) => !serverIds.has(h.id));
  const merged = [...server, ...orphans].sort((a, b) =>
    (b.concluidaEm ?? "").localeCompare(a.concluidaEm ?? "")
  );
  __replaceHistoricoCache(merged);
  for (const o of orphans) void pushUpsertHistoricoCompra(o);
}


async function pushUpsertHistoricoCompra(h: MercadoCompraHistorico) {
  const uid = __getMercadoActiveUserId();
  if (!uid) return;
  const { error } = await supabase
    .from("mercado_historico_compras")
    .upsert(historicoToRow(h, uid), { onConflict: "id" });
  if (error) console.warn("[mercado-sync] upsert historico failed:", error.message);
}

async function pushDeleteHistoricoCompra(id: string) {
  const uid = __getMercadoActiveUserId();
  if (!uid) return;
  const { error } = await supabase
    .from("mercado_historico_compras")
    .delete()
    .eq("id", id)
    .eq("user_id", uid);
  if (error) console.warn("[mercado-sync] delete historico failed:", error.message);
}

function readLegacyAnonHistorico(): MercadoCompraHistorico[] {
  try {
    const raw = localStorage.getItem(MERCADO_HISTORICO_LEGACY_ANON_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeHistorico)
      .filter((x): x is MercadoCompraHistorico => x !== null);
  } catch {
    return [];
  }
}

async function migrateLegacyHistoricoOnce(userId: string) {
  const flag = `gi:mercado:historico:migrated:v1:${userId}`;
  if (localStorage.getItem(flag) === "1") return;
  // Combina dados anônimos antigos + qualquer dado já gravado na chave por usuário
  const legacy = readLegacyAnonHistorico();
  const current = getHistoricoCompras();
  const map = new Map<string, MercadoCompraHistorico>();
  for (const h of [...legacy, ...current]) map.set(h.id, h);
  const all = Array.from(map.values());
  if (all.length > 0) {
    const rows = all.map((h) => historicoToRow(h, userId));
    const { error } = await supabase
      .from("mercado_historico_compras")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      console.warn("[mercado-sync] legacy historico migration failed:", error.message);
      return;
    }
  }
  localStorage.setItem(flag, "1");
  try { localStorage.removeItem(MERCADO_HISTORICO_LEGACY_ANON_KEY); } catch { /* ignore */ }
}

// ============================================================
// Histórico local de preços
// ============================================================

type PrecoRow = {
  id: string;
  user_id: string;
  historico_id: string;
  produto_key: string;
  codigo_barras: string | null;
  nome_produto: string;
  marca: string | null;
  categoria: string | null;
  unidade: string | null;
  quantidade: number | null;
  preco_unitario: number;
  preco_total: number | null;
  from_paid_price: boolean | null;
  origem: string | null;
  estabelecimento: string | null;
  cidade: string | null;
  uf: string | null;
  item_id: string | null;
  lista_id: string | null;
  comprado_em: string;
};

function precoRowToLocal(r: PrecoRow): MercadoPrecoLocal {
  const origens = ["manual", "lista", "barcode", "cupom", "qrcode"] as const;
  const origem = (origens as readonly string[]).includes(r.origem ?? "")
    ? (r.origem as MercadoPrecoLocal["origem"])
    : "manual";
  const qtd = Number(r.quantidade ?? 1) || 1;
  const preco = Number(r.preco_unitario);
  return {
    id: r.id,
    itemId: r.item_id ?? "",
    listaId: r.lista_id ?? undefined,
    historicoId: r.historico_id,
    produtoNome: r.nome_produto,
    categoria: r.categoria ?? undefined,
    codigoBarras: r.codigo_barras ?? undefined,
    unidade: r.unidade ?? undefined,
    quantidade: qtd,
    precoUnitario: preco,
    precoTotal: Number(r.preco_total ?? preco * qtd),
    fromPaidPrice: Boolean(r.from_paid_price),
    compradoEm: r.comprado_em,
    origem,
    cidade: r.cidade ?? undefined,
    uf: r.uf ?? undefined,
    estabelecimento: r.estabelecimento ?? undefined,
    visibility: "private",
    contribuirAnonimamente: false,
  };
}

function precoLocalToRow(p: MercadoPrecoLocal, userId: string) {
  const produtoKey =
    buildProdutoKey({ nome: p.produtoNome, codigoBarras: p.codigoBarras }) ||
    `nome:${p.produtoNome.toLowerCase()}`;
  return {
    id: p.id,
    user_id: userId,
    historico_id: p.historicoId ?? "",
    produto_key: produtoKey,
    codigo_barras: p.codigoBarras ?? null,
    nome_produto: p.produtoNome,
    marca: null,
    categoria: p.categoria ?? null,
    unidade: p.unidade ?? null,
    quantidade: p.quantidade,
    preco_unitario: p.precoUnitario,
    preco_total: p.precoTotal,
    from_paid_price: p.fromPaidPrice,
    origem: p.origem,
    estabelecimento: p.estabelecimento ?? null,
    cidade: p.cidade ?? null,
    uf: p.uf ?? null,
    item_id: p.itemId || null,
    lista_id: p.listaId ?? null,
    comprado_em: p.compradoEm,
  };
}

async function pullPrecosUsuario(userId: string) {
  const { data, error } = await supabase
    .from("mercado_precos_usuario")
    .select("*")
    .eq("user_id", userId)
    .order("comprado_em", { ascending: false });
  if (error) throw error;
  const server = (data as PrecoRow[] | null)?.map(precoRowToLocal) ?? [];
  const local = getHistoricoPrecos();
  const serverIds = new Set(server.map((p) => p.id));
  const orphans = local.filter((p) => !serverIds.has(p.id));
  const merged = [...server, ...orphans].sort((a, b) =>
    (b.compradoEm ?? "").localeCompare(a.compradoEm ?? "")
  );
  __replacePrecosCache(merged);
  if (orphans.length > 0) void pushUpsertRegistrosPreco(orphans);
}


async function pushUpsertRegistrosPreco(regs: MercadoPrecoLocal[]) {
  const uid = __getMercadoActiveUserId();
  if (!uid || regs.length === 0) return;
  const rows = regs.map((r) => precoLocalToRow(r, uid));
  const { error } = await supabase
    .from("mercado_precos_usuario")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (error) console.warn("[mercado-sync] upsert precos failed:", error.message);
}

function readLegacyAnonPrecos(): MercadoPrecoLocal[] {
  // Lê tanto da chave anônima quanto da chave já-por-usuário (caso usuário
  // tivesse dados gravados localmente antes do sync). Combina sem duplicar.
  const out: MercadoPrecoLocal[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
          const id = (item as { id: string }).id;
          if (!seen.has(id)) {
            seen.add(id);
            out.push(item as MercadoPrecoLocal);
          }
        }
      }
    } catch { /* ignore */ }
  };
  try { push(localStorage.getItem(MERCADO_PRECOS_LEGACY_ANON_KEY)); } catch { /* ignore */ }
  return out;
}

async function migrateLegacyPrecosOnce(userId: string) {
  const flag = `gi:mercado:precos:migrated:v1:${userId}`;
  if (localStorage.getItem(flag) === "1") return;
  const legacy = readLegacyAnonPrecos();
  // Combina com o que já está na chave por usuário, sem duplicar por id.
  const userKey = `${MERCADO_PRECOS_STORAGE_KEY}:${userId}`;
  let current: MercadoPrecoLocal[] = [];
  try {
    const raw = localStorage.getItem(userKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) current = parsed as MercadoPrecoLocal[];
    }
  } catch { /* ignore */ }
  const map = new Map<string, MercadoPrecoLocal>();
  for (const r of [...legacy, ...current]) if (r && r.id) map.set(r.id, r);
  const all = Array.from(map.values());
  if (all.length > 0) {
    const rows = all.map((p) => precoLocalToRow(p, userId));
    const { error } = await supabase
      .from("mercado_precos_usuario")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      console.warn("[mercado-sync] legacy precos migration failed:", error.message);
      return;
    }
  }
  localStorage.setItem(flag, "1");
  try { localStorage.removeItem(MERCADO_PRECOS_LEGACY_ANON_KEY); } catch { /* ignore */ }
}

// ============================================================
// Wiring
// ============================================================

let hooksRegistered = false;
function ensureHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  __setMercadoSyncHooks({
    onUpsertLista: (l) => { void pushUpsertLista(l); },
    onDeleteLista: (id) => { void pushDeleteLista(id); },
  });
  __setMercadoHistoricoSyncHooks({
    onUpsertHistorico: (h) => { void pushUpsertHistoricoCompra(h); },
    onDeleteHistorico: (id) => { void pushDeleteHistoricoCompra(id); },
  });
  __setMercadoPrecosSyncHooks({
    onUpsertRegistros: (regs) => { void pushUpsertRegistrosPreco(regs); },
  });
}

// ============================================================
// Estado visível de sincronização das LISTAS
// ============================================================

export type MercadoListasSyncStatus = "idle" | "syncing" | "synced" | "error";
type ListasSyncState = {
  status: MercadoListasSyncStatus;
  lastSyncedAt: string | null;
  errorMessage: string | null;
};
let listasSyncState: ListasSyncState = { status: "idle", lastSyncedAt: null, errorMessage: null };
const listasSyncListeners = new Set<() => void>();
function emitListasSync() { for (const l of listasSyncListeners) { try { l(); } catch { /* ignore */ } } }
function setListasSyncState(next: Partial<ListasSyncState>) {
  listasSyncState = { ...listasSyncState, ...next };
  emitListasSync();
}

export function useMercadoListasSyncState(): ListasSyncState {
  return useSyncExternalStore(
    (cb) => { listasSyncListeners.add(cb); return () => { listasSyncListeners.delete(cb); }; },
    () => listasSyncState,
    () => listasSyncState,
  );
}

/**
 * Pull manual disparado pelo botão "Atualizar listas". Faz merge seguro com
 * o cache local (preserva listas locais ainda não sincronizadas). Se não
 * houver usuário logado, marca como "synced" no estado local (sem rede).
 */
export async function refreshMercadoListas(): Promise<{ ok: boolean; error?: string }> {
  const uid = __getMercadoActiveUserId();
  setListasSyncState({ status: "syncing", errorMessage: null });
  if (!uid) {
    setListasSyncState({ status: "synced", lastSyncedAt: new Date().toISOString() });
    return { ok: true };
  }
  try {
    await pullListas(uid);
    setListasSyncState({ status: "synced", lastSyncedAt: new Date().toISOString(), errorMessage: null });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[mercado-sync] manual refresh failed:", msg);
    setListasSyncState({ status: "error", errorMessage: msg });
    return { ok: false, error: msg };
  }
}

/** Hook montado no root para sincronizar Mercado com o usuário atual. */
export function useMercadoSync() {
  const { user, loading } = useAuth();
  useEffect(() => {
    ensureHooks();
    if (loading) return;
    const uid = user?.id ?? null;
    __setMercadoActiveUser(uid);
    __setMercadoPrecosActiveUser(uid);
    if (!uid) {
      setListasSyncState({ status: "idle", errorMessage: null });
      return;
    }
    let cancelled = false;
    setListasSyncState({ status: "syncing", errorMessage: null });
    (async () => {
      let listasOk = false;
      try {
        // Listas
        await migrateLegacyListasOnce(uid);
        if (cancelled) return;
        await pullListas(uid);
        listasOk = true;
        if (cancelled) return;
        // Histórico de compras
        await migrateLegacyHistoricoOnce(uid);
        if (cancelled) return;
        await pullHistoricoCompras(uid);
        if (cancelled) return;
        // Histórico local de preços
        await migrateLegacyPrecosOnce(uid);
        if (cancelled) return;
        await pullPrecosUsuario(uid);
      } catch (e) {
        console.warn("[mercado-sync] initial sync failed:", e);
        if (!listasOk && !cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setListasSyncState({ status: "error", errorMessage: msg });
        }
      } finally {
        if (!cancelled && listasOk) {
          setListasSyncState({ status: "synced", lastSyncedAt: new Date().toISOString(), errorMessage: null });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, loading]);
}

