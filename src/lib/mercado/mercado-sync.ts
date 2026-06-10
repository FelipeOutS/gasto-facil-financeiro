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
import {
  __setMercadoCestaActiveUser,
  __setMercadoCestaSyncHooks,
  __replaceCestaCache,
  __getMercadoCestaActiveUserId,
  MERCADO_CESTA_LEGACY_ANON_KEY,
  MERCADO_CESTA_STORAGE_KEY,
  getCestasPadrao,
  normalizeCesta,
  type MercadoCestaPadrao,
} from "./cesta-store";
import {
  __setMercadoOrcamentoActiveUser,
  __setMercadoOrcamentoSyncHooks,
  __getMercadoOrcamentoActiveUserId,
  __replaceOrcamentoCache,
  getOrcamentoMercado,
  normalizeOrcamento,
  MERCADO_ORCAMENTO_LEGACY_ANON_KEY,
  MERCADO_ORCAMENTO_STORAGE_KEY,
  type MercadoOrcamento,
} from "./orcamento-store";
import {
  __setMercadoMercadosActiveUser,
  __setMercadoMercadosSyncHooks,
  __getMercadoMercadosActiveUserId,
  __replaceMercadosCache,
  getMercadosLocais,
  normalizeMercadoLocal,
  MERCADO_MERCADOS_LEGACY_ANON_KEY,
  MERCADOS_LOCAIS_STORAGE_KEY,
  type MercadoLocal,
} from "./mercados-store";

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

// ----- Dirty upserts (alterações locais pendentes de push) ------
// Diferencia "lista local nova/alterada offline" de "cache antigo já apagado
// em outro dispositivo". Sem isso, o merge ressuscita listas excluídas.
// v2 ignora o dirty:v1, que podia ter sido populado automaticamente por
// seed antigo. A partir daqui, dirty nasce apenas de mutação local real.
const LISTAS_DIRTY_KEY_BASE = "gi:mercado:listas:dirty:v2";
function dirtyKey(uid: string) { return `${LISTAS_DIRTY_KEY_BASE}:${uid}`; }
function readDirty(uid: string | null): Set<string> {
  if (!uid) return new Set();
  try {
    const raw = localStorage.getItem(dirtyKey(uid));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === "string"));
    if (parsed && typeof parsed === "object") return new Set(Object.keys(parsed));
    return new Set();
  } catch { return new Set(); }
}
function writeDirty(uid: string | null, ids: Set<string>) {
  if (!uid) return;
  try { localStorage.setItem(dirtyKey(uid), JSON.stringify(Array.from(ids))); } catch { /* ignore */ }
}
function markDirtyUpsert(uid: string | null, id: string) {
  if (!uid || !id) return;
  const cur = readDirty(uid);
  if (cur.has(id)) return;
  cur.add(id); writeDirty(uid, cur);
}
function clearDirtyUpsert(uid: string | null, id: string) {
  if (!uid || !id) return;
  const cur = readDirty(uid);
  if (!cur.delete(id)) return;
  writeDirty(uid, cur);
}

// ----- Quarentena de listas locais antigas (safety check único) ------
// Risco coberto: listas criadas localmente ANTES de dirty:v2 que nunca
// chegaram ao Supabase. Sem proteção, o pull as removeria do cache
// (regra "ausente no server + sem dirty + sem tombstone" = excluída em
// outro dispositivo). Para não apagar silenciosamente, no PRIMEIRO pull
// pós-deploy por usuário, essas listas vão para uma quarentena local.
// NÃO são re-upsertadas (isso reintroduziria o bug de ressurreição).
// Após o flag ser setado, o comportamento volta ao padrão (drop silencioso),
// pois daí em diante toda mutação local nova já marca dirty:v2.
const LISTAS_SAFETY_FLAG_BASE = "gi:mercado:listas:dirty-v2-safety-checked:v1";
const LISTAS_QUARANTINE_KEY_BASE = "gi:mercado:listas:pending-review:v1";
function safetyFlagKey(uid: string) { return `${LISTAS_SAFETY_FLAG_BASE}:${uid}`; }
function quarantineKey(uid: string) { return `${LISTAS_QUARANTINE_KEY_BASE}:${uid}`; }
function readQuarantine(uid: string): MercadoLista[] {
  try {
    const raw = localStorage.getItem(quarantineKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MercadoLista[]) : [];
  } catch { return []; }
}
function addToQuarantine(uid: string, items: MercadoLista[]) {
  if (!uid || items.length === 0) return;
  try {
    const cur = readQuarantine(uid);
    const map = new Map(cur.map((l) => [l.id, l]));
    for (const it of items) map.set(it.id, it);
    localStorage.setItem(quarantineKey(uid), JSON.stringify(Array.from(map.values())));
  } catch { /* ignore */ }
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
  const dirtySet = readDirty(userId);
  const safetyDone = (() => {
    try { return localStorage.getItem(safetyFlagKey(userId)) === "1"; } catch { return true; }
  })();
  const merged: MercadoLista[] = [];
  const orphans: MercadoLista[] = [];
  const deleteRetries: string[] = [];
  const toQuarantine: MercadoLista[] = [];
  // Server + conflict resolution; respeita tombstones locais.
  for (const s of server) {
    if (tombSet.has(s.id)) {
      // Usuário deletou neste dispositivo; servidor ainda tem -> reenvia delete.
      deleteRetries.push(s.id);
      continue;
    }
    const l = localById.get(s.id);
    if (l && dirtySet.has(l.id) && l.updatedAt && s.updatedAt && l.updatedAt > s.updatedAt) {
      merged.push(l);
      orphans.push(l); // re-push newer local
    } else {
      merged.push(s);
    }
  }
  // Local-only items not on server:
  // - tombstone local -> não preservar; tentar delete novamente.
  // - dirty.upsert local -> preservar e re-push (offline/falha de rede).
  // - nem dirty nem tombstone:
  //     * primeiro pull pós-deploy (safety): vai para quarentena (não apaga
  //       silenciosamente, mas também não re-upserta para não ressuscitar).
  //     * pulls subsequentes: excluído em outro dispositivo -> remove do cache.
  for (const l of local) {
    if (serverById.has(l.id)) continue;
    if (tombSet.has(l.id)) { deleteRetries.push(l.id); continue; }
    if (dirtySet.has(l.id)) { merged.push(l); orphans.push(l); continue; }
    if (!safetyDone) { toQuarantine.push(l); continue; }
    // implicit delete: outro dispositivo removeu. Não adiciona ao merged.
  }
  merged.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  __replaceListasCache(merged);
  if (!safetyDone) {
    if (toQuarantine.length > 0) addToQuarantine(userId, toQuarantine);
    try { localStorage.setItem(safetyFlagKey(userId), "1"); } catch { /* ignore */ }
  }
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
  if (error) {
    // Toast amigável para quotas free_ads (mercado_listas / mercado_itens_lista).
    const { handleFreeAdsQuotaError } = await import("@/lib/store");
    handleFreeAdsQuotaError(error);
    console.warn("[mercado-sync] upsert lista failed:", error.message);
    return;
  }
  clearDirtyUpsert(uid, l.id);
}

async function pushDeleteLista(id: string) {
  const uid = __getMercadoActiveUserId();
  if (!uid) return;
  const { error } = await supabase.from("mercado_listas").delete().eq("id", id).eq("user_id", uid);
  if (error) {
    console.warn("[mercado-sync] delete lista failed:", error.message);
    return;
  }
  clearDirtyUpsert(uid, id);
  removeTombstones(uid, [id]);
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
// Cestas padrão (E35 / Parte 1)
// ============================================================

type CestaRow = {
  id: string;
  user_id: string;
  nome: string;
  tipo: string;
  descricao: string | null;
  itens: unknown;
  created_at: string;
  updated_at: string;
};

function cestaRowToCesta(r: CestaRow): MercadoCestaPadrao {
  const normalized = normalizeCesta({
    id: r.id,
    nome: r.nome ?? "",
    tipo: r.tipo ?? "outros",
    descricao: r.descricao ?? undefined,
    itens: Array.isArray(r.itens) ? r.itens : [],
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
  });
  // normalizeCesta retorna null apenas se id estiver ausente; aqui sempre existe.
  return normalized as MercadoCestaPadrao;
}

function cestaToRow(c: MercadoCestaPadrao, userId: string) {
  return {
    id: c.id,
    user_id: userId,
    nome: c.nome,
    tipo: c.tipo,
    descricao: c.descricao ?? null,
    itens: c.itens,
    created_at: c.criadoEm,
    updated_at: c.atualizadoEm,
  };
}

// ----- Tombstones de exclusão de cestas (mesmo padrão das listas) -----
const CESTAS_TOMBSTONE_KEY_BASE = "gi:mercado:cestas:deleted:v1";
function cestasTombstoneKey(uid: string) {
  return `${CESTAS_TOMBSTONE_KEY_BASE}:${uid}`;
}
function readCestasTombstones(uid: string | null): Set<string> {
  if (!uid) return new Set();
  try {
    const raw = localStorage.getItem(cestasTombstoneKey(uid));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(
        parsed
          .filter((t): t is { id: string } => !!t && typeof (t as { id?: unknown }).id === "string")
          .map((t) => t.id),
      );
    }
    return new Set();
  } catch { return new Set(); }
}
function addCestaTombstone(uid: string | null, id: string) {
  if (!uid || !id) return;
  const cur = readCestasTombstones(uid);
  if (cur.has(id)) return;
  cur.add(id);
  try {
    localStorage.setItem(
      cestasTombstoneKey(uid),
      JSON.stringify(Array.from(cur).map((tid) => ({ id: tid, deletedAt: new Date().toISOString() }))),
    );
  } catch { /* ignore */ }
}



// ----- Dirty upserts de cestas (mesmo princípio de listas dirty:v2) -----
// Sem isso, pullCestas re-upserta toda cesta local-only — inclusive cestas
// que foram excluídas em outro dispositivo — causando "ressurreição".
const CESTAS_DIRTY_KEY_BASE = "gi:mercado:cestas:dirty:v1";
const CESTAS_SAFETY_FLAG_BASE = "gi:mercado:cestas:dirty-safety-checked:v1";
function cestasDirtyKey(uid: string) { return `${CESTAS_DIRTY_KEY_BASE}:${uid}`; }
function cestasSafetyFlagKey(uid: string) { return `${CESTAS_SAFETY_FLAG_BASE}:${uid}`; }
function readCestasDirty(uid: string | null): Set<string> {
  if (!uid) return new Set();
  try {
    const raw = localStorage.getItem(cestasDirtyKey(uid));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === "string"));
    return new Set();
  } catch { return new Set(); }
}
function writeCestasDirty(uid: string | null, ids: Set<string>) {
  if (!uid) return;
  try { localStorage.setItem(cestasDirtyKey(uid), JSON.stringify(Array.from(ids))); } catch { /* ignore */ }
}
function markCestaDirty(uid: string | null, id: string) {
  if (!uid || !id) return;
  const cur = readCestasDirty(uid);
  if (cur.has(id)) return;
  cur.add(id); writeCestasDirty(uid, cur);
}
function clearCestaDirty(uid: string | null, id: string) {
  if (!uid || !id) return;
  const cur = readCestasDirty(uid);
  if (!cur.delete(id)) return;
  writeCestasDirty(uid, cur);
}



async function pushUpsertCesta(c: MercadoCestaPadrao) {
  const uid = __getMercadoCestaActiveUserId();
  if (!uid) return;
  try {
    const { error } = await supabase
      .from("mercado_cestas_padrao")
      .upsert(cestaToRow(c, uid), { onConflict: "id" });
    if (error) {
      console.warn("[mercado-sync] cesta upsert failed:", error.message);
      return;
    }
    clearCestaDirty(uid, c.id);
  } catch (e) {
    console.warn("[mercado-sync] cesta upsert threw:", e);
  }
}

async function pushDeleteCesta(id: string) {
  const uid = __getMercadoCestaActiveUserId();
  if (!uid) return;
  try {
    const { error } = await supabase
      .from("mercado_cestas_padrao")
      .delete()
      .eq("id", id)
      .eq("user_id", uid);
    if (error) {
      console.warn("[mercado-sync] cesta delete failed:", error.message);
      return;
    }
    clearCestaDirty(uid, id);
  } catch (e) {
    console.warn("[mercado-sync] cesta delete threw:", e);
  }
}


async function pullCestas(userId: string) {
  const { data, error } = await supabase
    .from("mercado_cestas_padrao")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const server = (data as CestaRow[] | null)?.map(cestaRowToCesta) ?? [];
  const local = getCestasPadrao();
  const tombs = readCestasTombstones(userId);
  const serverById = new Map(server.map((c) => [c.id, c]));
  const localById = new Map(local.map((c) => [c.id, c]));
  const merged: MercadoCestaPadrao[] = [];
  const toRetryDelete: string[] = [];
  const toRePushUpsert: MercadoCestaPadrao[] = [];

  const dirty = readCestasDirty(userId);
  const safetyDone = (() => {
    try { return localStorage.getItem(cestasSafetyFlagKey(userId)) === "1"; } catch { return true; }
  })();

  // Server + conflict resolution (last-write-wins por atualizadoEm).
  for (const s of server) {
    if (tombs.has(s.id)) { toRetryDelete.push(s.id); continue; }
    const l = localById.get(s.id);
    if (l && dirty.has(l.id) && l.atualizadoEm && s.atualizadoEm && l.atualizadoEm > s.atualizadoEm) {
      merged.push(l);
      toRePushUpsert.push(l);
    } else {
      merged.push(s);
    }
  }
  // Cestas locais ausentes no servidor:
  // - tombstone local -> nada a fazer.
  // - dirty (mutada localmente, push pendente) -> preserva e re-push.
  // - primeiro pull pós-deploy (safety): preserva e marca dirty para não
  //   apagar cestas legítimas pré-sync; subsequentes pulls aplicam drop.
  // - sem dirty + safety já feito -> excluída em outro device, drop silencioso.
  for (const l of local) {
    if (serverById.has(l.id)) continue;
    if (tombs.has(l.id)) continue;
    if (dirty.has(l.id)) { merged.push(l); toRePushUpsert.push(l); continue; }
    if (!safetyDone) {
      markCestaDirty(userId, l.id);
      merged.push(l);
      toRePushUpsert.push(l);
      continue;
    }
    // implicit delete: outro dispositivo removeu.
  }
  merged.sort((a, b) => (b.atualizadoEm ?? "").localeCompare(a.atualizadoEm ?? ""));
  __replaceCestaCache(merged);
  if (!safetyDone) {
    try { localStorage.setItem(cestasSafetyFlagKey(userId), "1"); } catch { /* ignore */ }
  }

  // Best-effort: re-push pendências e retentativas de delete.
  for (const id of toRetryDelete) { void pushDeleteCesta(id); }
  if (toRePushUpsert.length > 0) {
    const rows = toRePushUpsert.map((c) => cestaToRow(c, userId));
    try {
      const { error } = await supabase
        .from("mercado_cestas_padrao")
        .upsert(rows, { onConflict: "id" });
      if (error) {
        console.warn("[mercado-sync] cestas re-push failed:", error.message);
      } else {
        for (const c of toRePushUpsert) clearCestaDirty(userId, c.id);
      }
    } catch (e) {
      console.warn("[mercado-sync] cestas re-push threw:", e);
    }

  }
}

// Migração one-shot da chave anônima legada para a chave por usuário.
async function migrateLegacyCestasOnce(userId: string) {
  const flag = `gi:mercado:cestas:migrated:v1:${userId}`;
  if (localStorage.getItem(flag) === "1") return;
  let legacy: MercadoCestaPadrao[] = [];
  try {
    const raw = localStorage.getItem(MERCADO_CESTA_LEGACY_ANON_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        legacy = parsed
          .map((x) => normalizeCesta(x))
          .filter((c): c is MercadoCestaPadrao => c !== null);
      }
    }
  } catch { /* ignore */ }

  // Combina com o que já está na chave por usuário, sem duplicar por id.
  const userKey = `${MERCADO_CESTA_STORAGE_KEY}:${userId}`;
  let current: MercadoCestaPadrao[] = [];
  try {
    const raw = localStorage.getItem(userKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        current = parsed
          .map((x) => normalizeCesta(x))
          .filter((c): c is MercadoCestaPadrao => c !== null);
      }
    }
  } catch { /* ignore */ }
  const map = new Map<string, MercadoCestaPadrao>();
  for (const c of [...current, ...legacy]) map.set(c.id, c);
  const all = Array.from(map.values());
  if (all.length > 0) {
    try {
      localStorage.setItem(userKey, JSON.stringify(all));
      const rows = all.map((c) => cestaToRow(c, userId));
      const { error } = await supabase
        .from("mercado_cestas_padrao")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (error) {
        console.warn("[mercado-sync] legacy cestas migration failed:", error.message);
        return;
      }
    } catch (e) {
      console.warn("[mercado-sync] legacy cestas migration threw:", e);
      return;
    }
  }
  try { localStorage.setItem(flag, "1"); } catch { /* ignore */ }
  try { localStorage.removeItem(MERCADO_CESTA_LEGACY_ANON_KEY); } catch { /* ignore */ }
}

// ============================================================
// Orçamento mensal (E35 / Parte 2)
// ============================================================
// Modelo simples: um registro por (user_id, mes_referencia).
// Estratégia: last-write-wins por atualizado_em. Sem tombstones — "limpar"
// o orçamento é apenas um upsert com valor_mensal = 0.

type OrcamentoRow = {
  id: string;
  user_id: string;
  mes_referencia: string;
  valor_mensal: number;
  atualizado_em: string;
  created_at: string;
  updated_at: string;
};

function orcamentoRowToLocal(r: OrcamentoRow): MercadoOrcamento {
  return {
    valorMensal: Number(r.valor_mensal) || 0,
    mesReferencia: r.mes_referencia,
    atualizadoEm: r.atualizado_em,
  };
}

async function pushUpsertOrcamento(o: MercadoOrcamento) {
  const uid = __getMercadoOrcamentoActiveUserId();
  if (!uid) return;
  try {
    const { error } = await supabase
      .from("mercado_orcamentos")
      .upsert(
        {
          user_id: uid,
          mes_referencia: o.mesReferencia,
          valor_mensal: o.valorMensal,
          atualizado_em: o.atualizadoEm,
        },
        { onConflict: "user_id,mes_referencia" },
      );
    if (error) console.warn("[mercado-sync] upsert orcamento failed:", error.message);
  } catch (e) {
    console.warn("[mercado-sync] upsert orcamento threw:", e);
  }
}

async function pullOrcamento(userId: string) {
  const { data, error } = await supabase
    .from("mercado_orcamentos")
    .select("*")
    .eq("user_id", userId)
    .order("atualizado_em", { ascending: false })
    .limit(1);
  if (error) throw error;
  const rows = (data as OrcamentoRow[] | null) ?? [];
  const server = rows[0] ? orcamentoRowToLocal(rows[0]) : null;
  const local = getOrcamentoMercado();
  const localHasData = local.valorMensal > 0 || local.atualizadoEm !== new Date(0).toISOString();

  // Sem dado no servidor: se temos algo local, faz push best-effort.
  if (!server) {
    if (localHasData) void pushUpsertOrcamento(local);
    return;
  }

  // Last-write-wins por atualizadoEm. Se local é mais novo, re-push.
  if (localHasData && local.atualizadoEm > server.atualizadoEm) {
    void pushUpsertOrcamento(local);
    return;
  }

  // Servidor vence: atualiza cache local (se diferente).
  if (
    !localHasData ||
    server.atualizadoEm !== local.atualizadoEm ||
    server.valorMensal !== local.valorMensal ||
    server.mesReferencia !== local.mesReferencia
  ) {
    __replaceOrcamentoCache(server);
  }
}

async function migrateLegacyOrcamentoOnce(userId: string) {
  const flag = `gi:mercado:orcamento:migrated:v1:${userId}`;
  try {
    if (localStorage.getItem(flag) === "1") return;
  } catch { return; }

  const userKey = `${MERCADO_ORCAMENTO_STORAGE_KEY}:${userId}`;
  // Se a chave por usuário ainda não existe, tenta promover a chave legada anônima.
  try {
    const userRaw = localStorage.getItem(userKey);
    if (!userRaw) {
      const legacyRaw = localStorage.getItem(MERCADO_ORCAMENTO_LEGACY_ANON_KEY);
      if (legacyRaw) {
        const parsed = normalizeOrcamento(JSON.parse(legacyRaw));
        if (parsed) {
          localStorage.setItem(userKey, JSON.stringify(parsed));
        }
      }
    }
  } catch { /* ignore */ }

  try { localStorage.setItem(flag, "1"); } catch { /* ignore */ }
  // Não removemos a chave anônima legada para não afetar outras abas/usuários
  // sem login. A migração é one-shot por usuário via flag.
}


// ============================================================
// Mercados salvos (E35 / Parte 3)
// ============================================================
// Mesmo padrão das listas/cestas: dirty + tombstone por usuário + safety
// flag de primeira execução para não apagar mercados locais legítimos
// criados antes do sync.

type MercadoSalvoRow = {
  id: string;
  user_id: string;
  nome: string;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  observacao: string | null;
  favorito: boolean;
  created_at: string;
  updated_at: string;
};

function mercadoRowToLocal(r: MercadoSalvoRow): MercadoLocal {
  const normalized = normalizeMercadoLocal({
    id: r.id,
    nome: r.nome,
    cep: r.cep ?? undefined,
    endereco: r.endereco ?? undefined,
    bairro: r.bairro ?? undefined,
    cidade: r.cidade ?? undefined,
    uf: r.uf ?? undefined,
    observacao: r.observacao ?? undefined,
    favorito: r.favorito,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
  });
  // r.nome é NOT NULL no banco; normalize só retorna null se faltar nome.
  return normalized as MercadoLocal;
}

function mercadoLocalToRow(m: MercadoLocal, userId: string) {
  return {
    id: m.id,
    user_id: userId,
    nome: m.nome,
    endereco: m.endereco ?? null,
    bairro: m.bairro ?? null,
    cidade: m.cidade ?? null,
    uf: m.uf ?? null,
    cep: m.cep ?? null,
    observacao: m.observacao ?? null,
    favorito: Boolean(m.favorito),
    created_at: m.criadoEm,
    updated_at: m.atualizadoEm,
  };
}

const MERCADOS_DIRTY_KEY_BASE = "gi:mercado:mercados:dirty:v1";
const MERCADOS_TOMBSTONE_KEY_BASE = "gi:mercado:mercados:deleted:v1";
const MERCADOS_SAFETY_FLAG_BASE = "gi:mercado:mercados:dirty-safety-checked:v1";

function mercadosDirtyKey(uid: string) { return `${MERCADOS_DIRTY_KEY_BASE}:${uid}`; }
function mercadosTombKey(uid: string) { return `${MERCADOS_TOMBSTONE_KEY_BASE}:${uid}`; }
function mercadosSafetyKey(uid: string) { return `${MERCADOS_SAFETY_FLAG_BASE}:${uid}`; }

function readMercadosDirty(uid: string | null): Set<string> {
  if (!uid) return new Set();
  try {
    const raw = localStorage.getItem(mercadosDirtyKey(uid));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === "string"));
    return new Set();
  } catch { return new Set(); }
}
function writeMercadosDirty(uid: string | null, ids: Set<string>) {
  if (!uid) return;
  try { localStorage.setItem(mercadosDirtyKey(uid), JSON.stringify(Array.from(ids))); } catch { /* ignore */ }
}
function markMercadoDirty(uid: string | null, id: string) {
  if (!uid || !id) return;
  const cur = readMercadosDirty(uid);
  if (cur.has(id)) return;
  cur.add(id); writeMercadosDirty(uid, cur);
}
function clearMercadoDirty(uid: string | null, id: string) {
  if (!uid || !id) return;
  const cur = readMercadosDirty(uid);
  if (!cur.delete(id)) return;
  writeMercadosDirty(uid, cur);
}

function readMercadosTombstones(uid: string | null): Set<string> {
  if (!uid) return new Set();
  try {
    const raw = localStorage.getItem(mercadosTombKey(uid));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(
        parsed
          .filter((t): t is { id: string } => !!t && typeof (t as { id?: unknown }).id === "string")
          .map((t) => t.id),
      );
    }
    return new Set();
  } catch { return new Set(); }
}
function addMercadoTombstone(uid: string | null, id: string) {
  if (!uid || !id) return;
  const cur = readMercadosTombstones(uid);
  if (cur.has(id)) return;
  cur.add(id);
  try {
    localStorage.setItem(
      mercadosTombKey(uid),
      JSON.stringify(Array.from(cur).map((tid) => ({ id: tid, deletedAt: new Date().toISOString() }))),
    );
  } catch { /* ignore */ }
}
function removeMercadoTombstones(uid: string | null, ids: Iterable<string>) {
  if (!uid) return;
  const drop = new Set(ids);
  if (drop.size === 0) return;
  const cur = readMercadosTombstones(uid);
  let changed = false;
  for (const id of drop) { if (cur.delete(id)) changed = true; }
  if (!changed) return;
  try {
    localStorage.setItem(
      mercadosTombKey(uid),
      JSON.stringify(Array.from(cur).map((tid) => ({ id: tid, deletedAt: new Date().toISOString() }))),
    );
  } catch { /* ignore */ }
}

async function pushUpsertMercado(m: MercadoLocal) {
  const uid = __getMercadoMercadosActiveUserId();
  if (!uid) return;
  try {
    const { error } = await supabase
      .from("mercado_mercados_salvos")
      .upsert(mercadoLocalToRow(m, uid), { onConflict: "id" });
    if (error) {
      console.warn("[mercado-sync] mercado upsert failed:", error.message);
      return;
    }
    clearMercadoDirty(uid, m.id);
  } catch (e) {
    console.warn("[mercado-sync] mercado upsert threw:", e);
  }
}

async function pushDeleteMercado(id: string) {
  const uid = __getMercadoMercadosActiveUserId();
  if (!uid) return;
  try {
    const { error } = await supabase
      .from("mercado_mercados_salvos")
      .delete()
      .eq("id", id)
      .eq("user_id", uid);
    if (error) {
      console.warn("[mercado-sync] mercado delete failed:", error.message);
      return;
    }
    clearMercadoDirty(uid, id);
    removeMercadoTombstones(uid, [id]);
  } catch (e) {
    console.warn("[mercado-sync] mercado delete threw:", e);
  }
}

async function pullMercados(userId: string) {
  const { data, error } = await supabase
    .from("mercado_mercados_salvos")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const server = (data as MercadoSalvoRow[] | null)?.map(mercadoRowToLocal) ?? [];
  const local = getMercadosLocais();
  const tombs = readMercadosTombstones(userId);
  const dirty = readMercadosDirty(userId);
  const serverById = new Map(server.map((m) => [m.id, m]));
  const localById = new Map(local.map((m) => [m.id, m]));
  const safetyDone = (() => {
    try { return localStorage.getItem(mercadosSafetyKey(userId)) === "1"; } catch { return true; }
  })();

  const merged: MercadoLocal[] = [];
  const toRetryDelete: string[] = [];
  const toRePushUpsert: MercadoLocal[] = [];

  // Server + conflict resolution (last-write-wins por atualizadoEm).
  for (const s of server) {
    if (tombs.has(s.id)) { toRetryDelete.push(s.id); continue; }
    const l = localById.get(s.id);
    if (l && dirty.has(l.id) && l.atualizadoEm && s.atualizadoEm && l.atualizadoEm > s.atualizadoEm) {
      merged.push(l);
      toRePushUpsert.push(l);
    } else {
      merged.push(s);
    }
  }
  // Local-only:
  // - tombstone -> nada a fazer (já marcado para delete).
  // - dirty -> preserva e re-push (mutação offline).
  // - primeiro pull pós-deploy (safety): marca dirty + preserva (não apagar
  //   mercados pré-sync); pulls subsequentes aplicam drop silencioso.
  // - sem dirty + safety feito -> excluído em outro dispositivo, drop.
  for (const l of local) {
    if (serverById.has(l.id)) continue;
    if (tombs.has(l.id)) continue;
    if (dirty.has(l.id)) { merged.push(l); toRePushUpsert.push(l); continue; }
    if (!safetyDone) {
      markMercadoDirty(userId, l.id);
      merged.push(l);
      toRePushUpsert.push(l);
      continue;
    }
    // implicit delete
  }

  __replaceMercadosCache(merged);
  if (!safetyDone) {
    try { localStorage.setItem(mercadosSafetyKey(userId), "1"); } catch { /* ignore */ }
  }

  for (const id of toRetryDelete) void pushDeleteMercado(id);
  if (toRePushUpsert.length > 0) {
    const rows = toRePushUpsert.map((m) => mercadoLocalToRow(m, userId));
    try {
      const { error } = await supabase
        .from("mercado_mercados_salvos")
        .upsert(rows, { onConflict: "id" });
      if (error) {
        console.warn("[mercado-sync] mercados re-push failed:", error.message);
      } else {
        for (const m of toRePushUpsert) clearMercadoDirty(userId, m.id);
      }
    } catch (e) {
      console.warn("[mercado-sync] mercados re-push threw:", e);
    }
  }

  // Limpa tombstones confirmados (servidor não retornou e local não tem).
  const localIds = new Set(local.map((l) => l.id));
  const serverIds = new Set(server.map((s) => s.id));
  const confirmed: string[] = [];
  for (const id of tombs) {
    if (!serverIds.has(id) && !localIds.has(id)) confirmed.push(id);
  }
  if (confirmed.length > 0) removeMercadoTombstones(userId, confirmed);
}

async function migrateLegacyMercadosOnce(userId: string) {
  const flag = `gi:mercado:mercados:migrated:v1:${userId}`;
  try {
    if (localStorage.getItem(flag) === "1") return;
  } catch { return; }

  const userKey = `${MERCADOS_LOCAIS_STORAGE_KEY}:${userId}`;
  let legacy: MercadoLocal[] = [];
  try {
    const raw = localStorage.getItem(MERCADO_MERCADOS_LEGACY_ANON_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        legacy = parsed
          .map((x) => normalizeMercadoLocal(x))
          .filter((m): m is MercadoLocal => m !== null);
      }
    }
  } catch { /* ignore */ }

  // Combina com o que já estiver na chave por usuário, sem duplicar.
  let current: MercadoLocal[] = [];
  try {
    const raw = localStorage.getItem(userKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        current = parsed
          .map((x) => normalizeMercadoLocal(x))
          .filter((m): m is MercadoLocal => m !== null);
      }
    }
  } catch { /* ignore */ }

  const map = new Map<string, MercadoLocal>();
  for (const m of [...current, ...legacy]) map.set(m.id, m);
  const all = Array.from(map.values());
  if (all.length > 0) {
    try {
      localStorage.setItem(userKey, JSON.stringify(all));
      const rows = all.map((m) => mercadoLocalToRow(m, userId));
      const { error } = await supabase
        .from("mercado_mercados_salvos")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (error) {
        console.warn("[mercado-sync] legacy mercados migration failed:", error.message);
        return;
      }
    } catch (e) {
      console.warn("[mercado-sync] legacy mercados migration threw:", e);
      return;
    }
  }
  try { localStorage.setItem(flag, "1"); } catch { /* ignore */ }
  // Não removemos a chave anônima legada: pode estar em uso por outras abas
  // sem login; a migração é one-shot via flag por usuário.
}

// ============================================================
// Wiring
// ============================================================


let hooksRegistered = false;
function ensureHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  __setMercadoSyncHooks({
    onUpsertLista: (l) => {
      // marca dirty ANTES do push para sobreviver offline/falha de rede
      markDirtyUpsert(__getMercadoActiveUserId(), l.id);
      void pushUpsertLista(l);
    },
    onDeleteLista: (id) => {
      const uid = __getMercadoActiveUserId();
      addTombstone(uid, id);
      // garante que não fique pendente de upsert depois de excluir
      clearDirtyUpsert(uid, id);
      void pushDeleteLista(id);
    },
  });
  __setMercadoHistoricoSyncHooks({
    onUpsertHistorico: (h) => { void pushUpsertHistoricoCompra(h); },
    onDeleteHistorico: (id) => { void pushDeleteHistoricoCompra(id); },
  });
  __setMercadoPrecosSyncHooks({
    onUpsertRegistros: (regs) => { void pushUpsertRegistrosPreco(regs); },
  });
  __setMercadoCestaSyncHooks({
    onUpsertCesta: (c) => {
      markCestaDirty(__getMercadoCestaActiveUserId(), c.id);
      void pushUpsertCesta(c);
    },
    onDeleteCesta: (id) => {
      addCestaTombstone(__getMercadoCestaActiveUserId(), id);
      void pushDeleteCesta(id);
    },
  });
  __setMercadoOrcamentoSyncHooks({
    onUpsertOrcamento: (o) => { void pushUpsertOrcamento(o); },
  });
  __setMercadoMercadosSyncHooks({
    onUpsertMercado: (m) => {
      const uid = __getMercadoMercadosActiveUserId();
      markMercadoDirty(uid, m.id);
      void pushUpsertMercado(m);
    },
    onDeleteMercado: (id) => {
      const uid = __getMercadoMercadosActiveUserId();
      addMercadoTombstone(uid, id);
      clearMercadoDirty(uid, id);
      void pushDeleteMercado(id);
    },
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
    __setMercadoCestaActiveUser(uid);
    __setMercadoOrcamentoActiveUser(uid);
    __setMercadoMercadosActiveUser(uid);
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
        if (cancelled) return;
        // Cestas padrão (E35 / Parte 1)
        await migrateLegacyCestasOnce(uid);
        if (cancelled) return;
        await pullCestas(uid);
        if (cancelled) return;
        // Orçamento de mercado (E35 / Parte 2)
        await migrateLegacyOrcamentoOnce(uid);
        if (cancelled) return;
        await pullOrcamento(uid);
        if (cancelled) return;
        // Mercados salvos (E35 / Parte 3)
        await migrateLegacyMercadosOnce(uid);
        if (cancelled) return;
        await pullMercados(uid);
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

