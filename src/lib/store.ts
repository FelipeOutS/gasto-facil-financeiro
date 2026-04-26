import { useEffect, useState, useSyncExternalStore } from "react";
import {
  type Gasto,
  type Categoria,
  type Limite,
  type AprendizadoCategoria,
  type FormaPagamento,
  type TipoGasto,
  type Receita,
  type TipoReceita,
  type Banco,
  type Guardado,
  type TipoReserva,
  type Meta,
  type MovimentacaoMeta,
  type StatusMeta,
  type Cartao,
} from "./types";
import { DEFAULT_CATEGORIES, suggestCategoryFromText } from "./categories";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

type GastoInsert = TablesInsert<"gastos">;
type GastoUpdate = TablesUpdate<"gastos">;
type ReceitaInsert = TablesInsert<"receitas">;
type CategoriaUpdate = TablesUpdate<"categorias">;
type BancoInsert = TablesInsert<"bancos">;
type BancoUpdate = TablesUpdate<"bancos">;
type GuardadoInsert = TablesInsert<"dinheiro_guardado">;
type GuardadoUpdate = TablesUpdate<"dinheiro_guardado">;
type MetaInsert = TablesInsert<"metas_financeiras">;
type MetaUpdate = TablesUpdate<"metas_financeiras">;
type MovMetaInsert = TablesInsert<"movimentacoes_meta">;

// ============================================================
// HYBRID STORE
// - Phase 1 (Supabase): gastos, categorias, receitas, limites, aprendizado
// - Phase 2 (localStorage by user): bancos, guardado, metas, movMetas
// Cache in memory keeps a synchronous API for existing components.
// ============================================================

let activeUserId: string | null = null;

const SUFFIXES = {
  // bookkeeping
  bootstrappedLocal: "bootstrappedLocal:v3",
  hydratedFromCloud: "hydratedFromCloud:v1",
  legacyMigrated: "legacyMigrated:v3",
} as const;

function ns(suffix: string): string {
  const uid = activeUserId ?? "anon";
  return `gf:u:${uid}:${suffix}`;
}

const K = new Proxy({} as Record<keyof typeof SUFFIXES, string>, {
  get(_t, prop: string) {
    const s = (SUFFIXES as Record<string, string>)[prop];
    if (!s) return undefined;
    return ns(s);
  },
});

// ---------- low-level helpers ----------
function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------- pub/sub ----------
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// ---------- IN-MEMORY CACHE (all entities) ----------
const EMPTY_GASTOS: Gasto[] = [];
const EMPTY_CATEGORIAS: Categoria[] = [];
const EMPTY_LIMITES: Limite[] = [];
const EMPTY_APRENDIZADO: AprendizadoCategoria[] = [];
const EMPTY_RECEITAS: Receita[] = [];
const EMPTY_BANCOS: Banco[] = [];
const EMPTY_GUARDADO: Guardado[] = [];
const EMPTY_METAS: Meta[] = [];
const EMPTY_MOV: MovimentacaoMeta[] = [];

let memGastos: Gasto[] = EMPTY_GASTOS;
let memCategorias: Categoria[] = EMPTY_CATEGORIAS;
let memLimites: Limite[] = EMPTY_LIMITES;
let memAprendizado: AprendizadoCategoria[] = EMPTY_APRENDIZADO;
let memReceitas: Receita[] = EMPTY_RECEITAS;
let memBancos: Banco[] = EMPTY_BANCOS;
let memGuardado: Guardado[] = EMPTY_GUARDADO;
let memMetas: Meta[] = EMPTY_METAS;
let memMov: MovimentacaoMeta[] = EMPTY_MOV;

// Lookup uuid by client-side key (legacy_id or uuid) for FK writes / id mapping
const categoriaKeyToUuid = new Map<string, string>();
const bancoKeyToUuid = new Map<string, string>();
const metaKeyToUuid = new Map<string, string>();

// ============================================================
// USER SESSION
// ============================================================
export function setActiveUserId(uid: string | null) {
  if (activeUserId === uid) return;
  activeUserId = uid;
  // Clear in-memory caches on user change
  memGastos = EMPTY_GASTOS;
  memCategorias = EMPTY_CATEGORIAS;
  memLimites = EMPTY_LIMITES;
  memAprendizado = EMPTY_APRENDIZADO;
  memReceitas = EMPTY_RECEITAS;
  memBancos = EMPTY_BANCOS;
  memGuardado = EMPTY_GUARDADO;
  memMetas = EMPTY_METAS;
  memMov = EMPTY_MOV;
  categoriaKeyToUuid.clear();
  bancoKeyToUuid.clear();
  metaKeyToUuid.clear();
  hydrationStatus = "idle";
  emit();
}

// ============================================================
// HYDRATION (load all user data from Supabase)
// ============================================================
type HydrationStatus = "idle" | "loading" | "ready" | "error";
let hydrationStatus: HydrationStatus = "idle";

export function getHydrationStatus(): HydrationStatus {
  return hydrationStatus;
}

function setHydrationStatus(s: HydrationStatus) {
  hydrationStatus = s;
  emit();
}

// ---------- Row mappers ----------
type CategoriaRow = {
  id: string;
  nome: string;
  icon_name: string;
  color_var: string;
  criada_pelo_usuario: boolean;
  legacy_id: string | null;
};
function rowToCategoria(r: CategoriaRow): Categoria {
  // Use legacy_id (e.g. "mercado") when available so old gastos referencing
  // "mercado" still work, otherwise use uuid.
  return {
    id: r.legacy_id || r.id,
    nome: r.nome,
    iconName: r.icon_name,
    colorVar: r.color_var,
    criadaPeloUsuario: r.criada_pelo_usuario,
  };
}

// (categoriaKeyToUuid declared earlier)

type GastoRow = {
  id: string;
  categoria_id: string | null;
  descricao: string;
  valor: string | number;
  data: string;
  estabelecimento: string;
  forma_pagamento: string;
  observacao: string | null;
  imagem_url: string | null;
  mes: number;
  ano: number;
  confirmado: boolean;
  tipo_gasto: string;
  parcela_atual: number | null;
  total_parcelas: number | null;
  grupo_parcelamento_id: string | null;
  recorrencia_id: string | null;
  essencial: boolean | null;
  gasto_fixo: boolean | null;
  created_at: string;
  updated_at: string;
};
function rowToGasto(r: GastoRow, catUuidToKey: Map<string, string>): Gasto {
  return {
    id: r.id,
    descricao: r.descricao,
    valor: Number(r.valor),
    data: r.data,
    estabelecimento: r.estabelecimento,
    categoriaId: r.categoria_id ? catUuidToKey.get(r.categoria_id) ?? r.categoria_id : "outros",
    formaPagamento: r.forma_pagamento as FormaPagamento,
    observacao: r.observacao ?? undefined,
    imagemUrl: r.imagem_url ?? undefined,
    mes: r.mes,
    ano: r.ano,
    confirmado: r.confirmado,
    tipoGasto: r.tipo_gasto as TipoGasto,
    parcelaAtual: r.parcela_atual ?? undefined,
    totalParcelas: r.total_parcelas ?? undefined,
    grupoParcelamentoId: r.grupo_parcelamento_id ?? undefined,
    recorrenciaId: r.recorrencia_id ?? undefined,
    essencial: r.essencial ?? undefined,
    gastoFixo: r.gasto_fixo ?? undefined,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
  };
}

type ReceitaRow = {
  id: string;
  descricao: string;
  valor: string | number;
  data: string;
  tipo: string;
  recorrente: boolean;
  recorrencia_id: string | null;
  mes: number;
  ano: number;
  created_at: string;
  updated_at: string;
};
function rowToReceita(r: ReceitaRow): Receita {
  return {
    id: r.id,
    descricao: r.descricao,
    valor: Number(r.valor),
    data: r.data,
    tipo: r.tipo as TipoReceita,
    recorrente: r.recorrente,
    recorrenciaId: r.recorrencia_id ?? undefined,
    mes: r.mes,
    ano: r.ano,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
  };
}

type LimiteRow = {
  id: string;
  tipo: string;
  valor: string | number;
  mes: number;
  ano: number;
};
function rowToLimite(r: LimiteRow): Limite {
  return {
    id: r.id,
    tipo: r.tipo,
    valor: Number(r.valor),
    mes: r.mes,
    ano: r.ano,
  };
}

type AprendizadoRow = {
  id: string;
  estabelecimento: string;
  categoria_id: string;
  created_at: string;
};
function rowToAprendizado(r: AprendizadoRow, catUuidToKey: Map<string, string>): AprendizadoCategoria {
  return {
    id: r.id,
    estabelecimento: r.estabelecimento,
    categoriaId: catUuidToKey.get(r.categoria_id) ?? r.categoria_id,
    criadoEm: r.created_at,
  };
}

// ---------- Phase 2 row mappers ----------
type BancoRow = {
  id: string;
  nome: string;
  color_hex: string;
  criado_pelo_usuario: boolean;
  legacy_id: string | null;
  created_at: string;
};
function rowToBanco(r: BancoRow): Banco {
  return {
    id: r.legacy_id || r.id,
    nome: r.nome,
    colorHex: r.color_hex,
    criadoPeloUsuario: r.criado_pelo_usuario,
    criadoEm: r.created_at,
  };
}

type GuardadoRow = {
  id: string;
  banco_id: string | null;
  valor: string | number;
  tipo_reserva: string;
  observacao: string | null;
  data_atualizacao: string;
  legacy_id: string | null;
  created_at: string;
  updated_at: string;
};
function rowToGuardado(r: GuardadoRow, bancoUuidToKey: Map<string, string>): Guardado {
  return {
    id: r.legacy_id || r.id,
    bancoId: r.banco_id ? bancoUuidToKey.get(r.banco_id) ?? r.banco_id : "",
    valor: Number(r.valor),
    tipoReserva: r.tipo_reserva as TipoReserva,
    observacao: r.observacao ?? undefined,
    dataAtualizacao: r.data_atualizacao,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
  };
}

type MetaRow = {
  id: string;
  nome: string;
  valor_objetivo: string | number;
  valor_atual: string | number;
  prazo: string | null;
  descricao: string | null;
  color_hex: string;
  banco_id: string | null;
  legacy_id: string | null;
  created_at: string;
  updated_at: string;
};
function rowToMeta(r: MetaRow, bancoUuidToKey: Map<string, string>): Meta {
  return {
    id: r.legacy_id || r.id,
    nome: r.nome,
    valorObjetivo: Number(r.valor_objetivo),
    valorAtual: Number(r.valor_atual),
    prazo: r.prazo ?? undefined,
    descricao: r.descricao ?? undefined,
    colorHex: r.color_hex,
    bancoId: r.banco_id ? bancoUuidToKey.get(r.banco_id) ?? r.banco_id : undefined,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
  };
}

type MovMetaRow = {
  id: string;
  meta_id: string;
  valor: string | number;
  data: string;
  banco_id: string | null;
  observacao: string | null;
  legacy_id: string | null;
  created_at: string;
};
function rowToMovMeta(
  r: MovMetaRow,
  metaUuidToKey: Map<string, string>,
  bancoUuidToKey: Map<string, string>,
): MovimentacaoMeta {
  return {
    id: r.legacy_id || r.id,
    metaId: metaUuidToKey.get(r.meta_id) ?? r.meta_id,
    valor: Number(r.valor),
    data: r.data,
    bancoId: r.banco_id ? bancoUuidToKey.get(r.banco_id) ?? r.banco_id : undefined,
    observacao: r.observacao ?? undefined,
    criadoEm: r.created_at,
  };
}

// ---------- Default seed data ----------
const BANCOS_PADRAO: Array<{ nome: string; colorHex: string }> = [
  { nome: "Nubank", colorHex: "#820ad1" },
  { nome: "Mercado Pago", colorHex: "#00b1ea" },
  { nome: "Itaú", colorHex: "#ec7000" },
  { nome: "Bradesco", colorHex: "#cc092f" },
  { nome: "Santander", colorHex: "#ec0000" },
  { nome: "Banco do Brasil", colorHex: "#fae128" },
  { nome: "Caixa", colorHex: "#1c5aa8" },
  { nome: "Inter", colorHex: "#ff7a00" },
  { nome: "C6 Bank", colorHex: "#3a3a3a" },
  { nome: "PicPay", colorHex: "#21c25e" },
  { nome: "PagBank", colorHex: "#048b3a" },
  { nome: "BTG Pactual", colorHex: "#0f2a4a" },
  { nome: "XP", colorHex: "#000000" },
  { nome: "Neon", colorHex: "#00d8c0" },
  { nome: "Will Bank", colorHex: "#0f9b5e" },
  { nome: "Original", colorHex: "#1d8b4e" },
  { nome: "Sicredi", colorHex: "#3aaa35" },
  { nome: "Sicoob", colorHex: "#003d2b" },
];

function bancoLegacyKey(nome: string): string {
  return nome.toLowerCase().replace(/\s+/g, "-");
}

// ---------- Ensure default categories exist for the user ----------
async function ensureDefaultCategorias(userId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("categorias")
    .select("legacy_id")
    .eq("user_id", userId)
    .not("legacy_id", "is", null);

  const existingKeys = new Set((existing ?? []).map((r: { legacy_id: string | null }) => r.legacy_id));
  const toInsert = DEFAULT_CATEGORIES.filter((c) => !existingKeys.has(c.id)).map((c) => ({
    user_id: userId,
    nome: c.nome,
    icon_name: c.iconName,
    color_var: c.colorVar,
    criada_pelo_usuario: false,
    legacy_id: c.id,
  }));
  if (toInsert.length > 0) {
    await supabase.from("categorias").insert(toInsert);
  }
}

// ---------- Ensure default bancos exist for the user ----------
async function ensureDefaultBancos(userId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("bancos")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if ((existing ?? []).length > 0) return;
  const toInsert: BancoInsert[] = BANCOS_PADRAO.map((b) => ({
    user_id: userId,
    nome: b.nome,
    color_hex: b.colorHex,
    criado_pelo_usuario: false,
    legacy_id: bancoLegacyKey(b.nome),
  }));
  if (toInsert.length > 0) {
    await supabase.from("bancos").insert(toInsert);
  }
}

// ---------- Hydrate everything ----------
export async function hydrateUser(userId: string): Promise<void> {
  if (hydrationStatus === "loading") return;
  setHydrationStatus("loading");
  try {
    await Promise.all([
      ensureDefaultCategorias(userId),
      ensureDefaultBancos(userId),
    ]);

    // Load categorias + bancos first (needed for FK mapping)
    const [catRes, bancoRes] = await Promise.all([
      supabase.from("categorias").select("*").eq("user_id", userId),
      supabase.from("bancos").select("*").eq("user_id", userId),
    ]);
    if (catRes.error) throw catRes.error;
    if (bancoRes.error) throw bancoRes.error;

    categoriaKeyToUuid.clear();
    bancoKeyToUuid.clear();
    const catUuidToKey = new Map<string, string>();
    const bancoUuidToKey = new Map<string, string>();

    memCategorias = (catRes.data ?? []).map((r: CategoriaRow) => {
      categoriaKeyToUuid.set(r.legacy_id || r.id, r.id);
      catUuidToKey.set(r.id, r.legacy_id || r.id);
      return rowToCategoria(r);
    });
    memBancos = (bancoRes.data ?? []).map((r: BancoRow) => {
      const key = r.legacy_id || r.id;
      bancoKeyToUuid.set(key, r.id);
      bancoUuidToKey.set(r.id, key);
      return rowToBanco(r);
    });

    // Load metas (needed before mov FK mapping)
    const metasRes = await supabase
      .from("metas_financeiras")
      .select("*")
      .eq("user_id", userId);
    if (metasRes.error) throw metasRes.error;
    metaKeyToUuid.clear();
    const metaUuidToKey = new Map<string, string>();
    memMetas = (metasRes.data ?? []).map((r: MetaRow) => {
      const key = r.legacy_id || r.id;
      metaKeyToUuid.set(key, r.id);
      metaUuidToKey.set(r.id, key);
      return rowToMeta(r, bancoUuidToKey);
    });

    // Load the rest in parallel
    const [gastosRes, receitasRes, limitesRes, aprendRes, guardadoRes, movRes] = await Promise.all([
      supabase.from("gastos").select("*").eq("user_id", userId),
      supabase.from("receitas").select("*").eq("user_id", userId),
      supabase.from("limites").select("*").eq("user_id", userId),
      supabase.from("aprendizado_categoria").select("*").eq("user_id", userId),
      supabase.from("dinheiro_guardado").select("*").eq("user_id", userId),
      supabase.from("movimentacoes_meta").select("*").eq("user_id", userId),
    ]);

    if (gastosRes.error) throw gastosRes.error;
    if (receitasRes.error) throw receitasRes.error;
    if (limitesRes.error) throw limitesRes.error;
    if (aprendRes.error) throw aprendRes.error;
    if (guardadoRes.error) throw guardadoRes.error;
    if (movRes.error) throw movRes.error;

    memGastos = (gastosRes.data ?? []).map((r: GastoRow) => rowToGasto(r, catUuidToKey));
    memReceitas = (receitasRes.data ?? []).map((r: ReceitaRow) => rowToReceita(r));
    memLimites = (limitesRes.data ?? []).map((r: LimiteRow) => rowToLimite(r));
    memAprendizado = (aprendRes.data ?? []).map((r: AprendizadoRow) =>
      rowToAprendizado(r, catUuidToKey),
    );
    memGuardado = (guardadoRes.data ?? []).map((r: GuardadoRow) => rowToGuardado(r, bancoUuidToKey));
    memMov = (movRes.data ?? []).map((r: MovMetaRow) => rowToMovMeta(r, metaUuidToKey, bancoUuidToKey));

    setHydrationStatus("ready");
  } catch (e) {
    console.error("[store] hydrateUser failed", e);
    setHydrationStatus("error");
  }
}

// ============================================================
// LEGACY MIGRATION (one-time per user, on first login)
// localStorage wins on conflict (the user's old anonymous data is moved up)
// ============================================================
type LegacyGasto = Gasto;
type LegacyReceita = Receita;
type LegacyLimite = Limite;
type LegacyAprendizado = AprendizadoCategoria;

export async function migrateLegacyDataToUser(userId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const flagKey = `gf:u:${userId}:${SUFFIXES.legacyMigrated}`;
  if (localStorage.getItem(flagKey)) return;

  try {
    // Pull from anonymous + legacy global keys
    const sources = [
      { gastos: "gf:gastos", receitas: "gf:receitas", limites: "gf:limites", apr: "gf:aprendizado" },
      {
        gastos: "gf:u:anon:gastos",
        receitas: "gf:u:anon:receitas",
        limites: "gf:u:anon:limites",
        apr: "gf:u:anon:aprendizado",
      },
    ];

    const allGastos: LegacyGasto[] = [];
    const allReceitas: LegacyReceita[] = [];
    const allLimites: LegacyLimite[] = [];
    const allApr: LegacyAprendizado[] = [];

    for (const s of sources) {
      const g = readJSON<LegacyGasto[]>(s.gastos, []);
      const r = readJSON<LegacyReceita[]>(s.receitas, []);
      const l = readJSON<LegacyLimite[]>(s.limites, []);
      const a = readJSON<LegacyAprendizado[]>(s.apr, []);
      allGastos.push(...g);
      allReceitas.push(...r);
      allLimites.push(...l);
      allApr.push(...a);
    }

    // Pull legacy local-only entities (bancos/guardado/metas/movMetas)
    const legacyBancos: Banco[] = [];
    const legacyGuardado: Guardado[] = [];
    const legacyMetas: Meta[] = [];
    const legacyMov: MovimentacaoMeta[] = [];
    for (const src of [
      "gf:bancos",
      "gf:u:anon:bancos",
      `gf:u:${userId}:bancos`,
    ]) {
      legacyBancos.push(...readJSON<Banco[]>(src, []));
    }
    for (const src of [
      "gf:guardado",
      "gf:u:anon:guardado",
      `gf:u:${userId}:guardado`,
    ]) {
      legacyGuardado.push(...readJSON<Guardado[]>(src, []));
    }
    for (const src of [
      "gf:metas",
      "gf:u:anon:metas",
      `gf:u:${userId}:metas`,
    ]) {
      legacyMetas.push(...readJSON<Meta[]>(src, []));
    }
    for (const src of [
      "gf:movMetas",
      "gf:u:anon:movMetas",
      `gf:u:${userId}:movMetas`,
    ]) {
      legacyMov.push(...readJSON<MovimentacaoMeta[]>(src, []));
    }

    // Need categorias mapping — make sure they exist
    await ensureDefaultCategorias(userId);
    const { data: catRows } = await supabase
      .from("categorias")
      .select("id, legacy_id")
      .eq("user_id", userId);
    const keyToUuid = new Map<string, string>();
    (catRows ?? []).forEach((r: { id: string; legacy_id: string | null }) => {
      if (r.legacy_id) keyToUuid.set(r.legacy_id, r.id);
      keyToUuid.set(r.id, r.id);
    });
    const fallbackUuid = keyToUuid.get("outros");

    // Insert gastos
    if (allGastos.length > 0) {
      const rows = allGastos.map((g) => ({
        user_id: userId,
        categoria_id: keyToUuid.get(g.categoriaId) ?? fallbackUuid ?? null,
        descricao: g.descricao,
        valor: g.valor,
        data: g.data,
        estabelecimento: g.estabelecimento || "",
        forma_pagamento: g.formaPagamento,
        observacao: g.observacao ?? null,
        imagem_url: g.imagemUrl ?? null,
        mes: g.mes,
        ano: g.ano,
        confirmado: g.confirmado ?? true,
        tipo_gasto: g.tipoGasto ?? "unico",
        parcela_atual: g.parcelaAtual ?? null,
        total_parcelas: g.totalParcelas ?? null,
        grupo_parcelamento_id: null, // legacy strings can't safely become uuids
        recorrencia_id: null,
        essencial: g.essencial ?? null,
        gasto_fixo: g.gastoFixo ?? null,
      }));
      // Insert in batches to avoid payload limits
      for (let i = 0; i < rows.length; i += 200) {
        await supabase.from("gastos").insert(rows.slice(i, i + 200));
      }
    }

    if (allReceitas.length > 0) {
      const rows = allReceitas.map((r) => ({
        user_id: userId,
        descricao: r.descricao,
        valor: r.valor,
        data: r.data,
        tipo: r.tipo,
        recorrente: r.recorrente ?? false,
        recorrencia_id: null,
        mes: r.mes,
        ano: r.ano,
      }));
      for (let i = 0; i < rows.length; i += 200) {
        await supabase.from("receitas").insert(rows.slice(i, i + 200));
      }
    }

    if (allLimites.length > 0) {
      // Dedupe by (tipo, mes, ano)
      const seen = new Set<string>();
      const rows = allLimites
        .filter((l) => {
          const k = `${l.tipo}-${l.mes}-${l.ano}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((l) => ({
          user_id: userId,
          tipo: l.tipo,
          valor: l.valor,
          mes: l.mes,
          ano: l.ano,
        }));
      if (rows.length > 0) {
        await supabase.from("limites").upsert(rows, { onConflict: "user_id,tipo,mes,ano" });
      }
    }

    if (allApr.length > 0) {
      const seen = new Set<string>();
      const rows = allApr
        .filter((a) => {
          if (seen.has(a.estabelecimento)) return false;
          seen.add(a.estabelecimento);
          return true;
        })
        .map((a) => ({
          user_id: userId,
          estabelecimento: a.estabelecimento,
          categoria_id: keyToUuid.get(a.categoriaId) ?? fallbackUuid,
        }))
        .filter((r) => !!r.categoria_id);
      const validRows = rows.filter(
        (r): r is { user_id: string; estabelecimento: string; categoria_id: string } =>
          typeof r.categoria_id === "string",
      );
      if (validRows.length > 0) {
        await supabase
          .from("aprendizado_categoria")
          .upsert(validRows, { onConflict: "user_id,estabelecimento" });
      }
    }

    // ----- Phase 2: Bancos / Guardado / Metas / Movimentações -----
    // Build banco key→uuid map (legacy bancos use slug like "nubank")
    await ensureDefaultBancos(userId);
    const { data: bancoRowsForMig } = await supabase
      .from("bancos")
      .select("id, legacy_id")
      .eq("user_id", userId);
    const bancoKeyToUuidMig = new Map<string, string>();
    (bancoRowsForMig ?? []).forEach((r: { id: string; legacy_id: string | null }) => {
      if (r.legacy_id) bancoKeyToUuidMig.set(r.legacy_id, r.id);
      bancoKeyToUuidMig.set(r.id, r.id);
    });

    // Insert custom legacy bancos that don't exist yet (matched by legacy_id slug)
    if (legacyBancos.length > 0) {
      const seen = new Set<string>();
      const customBancoRows: BancoInsert[] = [];
      for (const b of legacyBancos) {
        const key = b.id || bancoLegacyKey(b.nome);
        if (!key || seen.has(key) || bancoKeyToUuidMig.has(key)) continue;
        seen.add(key);
        if (!b.criadoPeloUsuario) continue; // defaults already inserted
        customBancoRows.push({
          user_id: userId,
          nome: b.nome,
          color_hex: b.colorHex,
          criado_pelo_usuario: true,
          legacy_id: key,
        });
      }
      if (customBancoRows.length > 0) {
        const { data: inserted } = await supabase
          .from("bancos")
          .insert(customBancoRows)
          .select("id, legacy_id");
        (inserted ?? []).forEach((r: { id: string; legacy_id: string | null }) => {
          if (r.legacy_id) bancoKeyToUuidMig.set(r.legacy_id, r.id);
        });
      }
    }

    // Insert dinheiro_guardado
    if (legacyGuardado.length > 0) {
      const rows: GuardadoInsert[] = legacyGuardado.map((g) => ({
        user_id: userId,
        banco_id: g.bancoId ? bancoKeyToUuidMig.get(g.bancoId) ?? null : null,
        valor: g.valor,
        tipo_reserva: g.tipoReserva,
        observacao: g.observacao ?? null,
        data_atualizacao: g.dataAtualizacao || new Date().toISOString().slice(0, 10),
        legacy_id: g.id,
      }));
      for (let i = 0; i < rows.length; i += 200) {
        await supabase.from("dinheiro_guardado").insert(rows.slice(i, i + 200));
      }
    }

    // Insert metas + build meta key→uuid map for movimentações
    const metaKeyToUuidMig = new Map<string, string>();
    if (legacyMetas.length > 0) {
      const rows: MetaInsert[] = legacyMetas.map((m) => ({
        user_id: userId,
        nome: m.nome,
        valor_objetivo: m.valorObjetivo,
        valor_atual: m.valorAtual ?? 0,
        prazo: m.prazo ?? null,
        descricao: m.descricao ?? null,
        color_hex: m.colorHex || "#10b981",
        banco_id: m.bancoId ? bancoKeyToUuidMig.get(m.bancoId) ?? null : null,
        legacy_id: m.id,
      }));
      const { data: insertedMetas } = await supabase
        .from("metas_financeiras")
        .insert(rows)
        .select("id, legacy_id");
      (insertedMetas ?? []).forEach((r: { id: string; legacy_id: string | null }) => {
        if (r.legacy_id) metaKeyToUuidMig.set(r.legacy_id, r.id);
      });
    }

    // Insert movimentações de meta (only those whose meta exists)
    if (legacyMov.length > 0) {
      const rows: MovMetaInsert[] = legacyMov
        .map((mv) => {
          const metaUuid = metaKeyToUuidMig.get(mv.metaId);
          if (!metaUuid) return null;
          return {
            user_id: userId,
            meta_id: metaUuid,
            valor: mv.valor,
            data: mv.data || new Date().toISOString().slice(0, 10),
            banco_id: mv.bancoId ? bancoKeyToUuidMig.get(mv.bancoId) ?? null : null,
            observacao: mv.observacao ?? null,
            legacy_id: mv.id,
          } as MovMetaInsert;
        })
        .filter((r): r is MovMetaInsert => r !== null);
      for (let i = 0; i < rows.length; i += 200) {
        await supabase.from("movimentacoes_meta").insert(rows.slice(i, i + 200));
      }
    }

    localStorage.setItem(flagKey, "1");
  } catch (e) {
    console.error("[store] migrateLegacyDataToUser failed", e);
  }
}

// ============================================================
// SELECTORS (synchronous; backed by in-memory cache)
// ============================================================
export function getGastos(): Gasto[] {
  return memGastos;
}
export function getCategorias(): Categoria[] {
  return memCategorias;
}
export function getLimites(): Limite[] {
  return memLimites;
}
export function getAprendizado(): AprendizadoCategoria[] {
  return memAprendizado;
}
export function getReceitas(): Receita[] {
  return memReceitas;
}
export function getCategoriaById(id: string): Categoria | undefined {
  return memCategorias.find((c) => c.id === id);
}

// Phase 2 selectors — backed by in-memory cache (Supabase-hydrated)
function bootstrapLocalDefaults() {
  // Kept as a no-op for compatibility; defaults are seeded server-side
  // via ensureDefaultBancos during hydration.
}

export function getBancos(): Banco[] {
  return memBancos;
}
export function getGuardado(): Guardado[] {
  return memGuardado;
}
export function getMetas(): Meta[] {
  return memMetas;
}
export function getMovimentacoesMeta(): MovimentacaoMeta[] {
  return memMov;
}
export function getBancoById(id: string): Banco | undefined {
  return memBancos.find((b) => b.id === id);
}

// ============================================================
// MUTATIONS — Supabase entities
// Optimistic updates: change in-memory cache + emit + write to Supabase.
// On error, refresh from server.
// ============================================================

function categoriaUuidFor(key: string): string | null {
  return categoriaKeyToUuid.get(key) ?? null;
}

async function refreshGastos() {
  if (!activeUserId) return;
  const { data } = await supabase.from("gastos").select("*").eq("user_id", activeUserId);
  if (!data) return;
  const catUuidToKey = new Map<string, string>();
  for (const [key, uuid] of categoriaKeyToUuid.entries()) catUuidToKey.set(uuid, key);
  memGastos = data.map((r: GastoRow) => rowToGasto(r, catUuidToKey));
  emit();
}

// ---------- Gastos ----------
export type NovoGastoInput = {
  descricao?: string;
  valor: number;
  data: string;
  estabelecimento?: string;
  categoriaId: string;
  formaPagamento: FormaPagamento;
  observacao?: string;
  imagemUrl?: string;
  tipoGasto?: TipoGasto;
  totalParcelas?: number;
  recorrenteMeses?: number;
  essencial?: boolean;
  gastoFixo?: boolean;
};

function buildGastosFromInput(input: NovoGastoInput, userId: string): { row: GastoInsert; client: Gasto }[] {
  const now = new Date().toISOString();
  const baseDate = new Date(input.data + "T00:00:00");
  const tipo = input.tipoGasto ?? "unico";
  const fixoFlag = input.gastoFixo ?? tipo === "recorrente";
  const catUuid = categoriaUuidFor(input.categoriaId);
  const out: { row: GastoInsert; client: Gasto }[] = [];

  if (tipo === "parcelado" && (input.totalParcelas ?? 0) > 1) {
    const total = input.totalParcelas!;
    const valorParcela = Math.round((input.valor / total) * 100) / 100;
    const grupo = crypto.randomUUID();
    for (let i = 0; i < total; i++) {
      const d = new Date(baseDate);
      d.setMonth(d.getMonth() + i);
      const iso = d.toISOString().slice(0, 10);
      const id = crypto.randomUUID();
      out.push({
        row: {
          id,
          user_id: userId,
          categoria_id: catUuid,
          descricao: input.descricao || input.estabelecimento || "Gasto",
          valor: valorParcela,
          data: iso,
          estabelecimento: input.estabelecimento || "",
          forma_pagamento: input.formaPagamento,
          observacao: input.observacao ?? null,
          imagem_url: input.imagemUrl ?? null,
          mes: d.getMonth() + 1,
          ano: d.getFullYear(),
          confirmado: true,
          tipo_gasto: "parcelado",
          parcela_atual: i + 1,
          total_parcelas: total,
          grupo_parcelamento_id: grupo,
          essencial: input.essencial ?? null,
          gasto_fixo: input.gastoFixo ?? null,
        },
        client: {
          id,
          descricao: input.descricao || input.estabelecimento || "Gasto",
          valor: valorParcela,
          data: iso,
          estabelecimento: input.estabelecimento || "",
          categoriaId: input.categoriaId,
          formaPagamento: input.formaPagamento,
          observacao: input.observacao,
          imagemUrl: input.imagemUrl,
          mes: d.getMonth() + 1,
          ano: d.getFullYear(),
          confirmado: true,
          tipoGasto: "parcelado",
          parcelaAtual: i + 1,
          totalParcelas: total,
          grupoParcelamentoId: grupo,
          essencial: input.essencial,
          gastoFixo: input.gastoFixo,
          criadoEm: now,
          atualizadoEm: now,
        },
      });
    }
  } else if (tipo === "recorrente") {
    const meses = Math.max(1, input.recorrenteMeses ?? 12);
    const recId = crypto.randomUUID();
    for (let i = 0; i < meses; i++) {
      const d = new Date(baseDate);
      d.setMonth(d.getMonth() + i);
      const iso = d.toISOString().slice(0, 10);
      const id = crypto.randomUUID();
      out.push({
        row: {
          id,
          user_id: userId,
          categoria_id: catUuid,
          descricao: input.descricao || input.estabelecimento || "Gasto",
          valor: input.valor,
          data: iso,
          estabelecimento: input.estabelecimento || "",
          forma_pagamento: input.formaPagamento,
          observacao: input.observacao ?? null,
          imagem_url: input.imagemUrl ?? null,
          mes: d.getMonth() + 1,
          ano: d.getFullYear(),
          confirmado: true,
          tipo_gasto: "recorrente",
          recorrencia_id: recId,
          essencial: input.essencial ?? null,
          gasto_fixo: fixoFlag,
        },
        client: {
          id,
          descricao: input.descricao || input.estabelecimento || "Gasto",
          valor: input.valor,
          data: iso,
          estabelecimento: input.estabelecimento || "",
          categoriaId: input.categoriaId,
          formaPagamento: input.formaPagamento,
          observacao: input.observacao,
          imagemUrl: input.imagemUrl,
          mes: d.getMonth() + 1,
          ano: d.getFullYear(),
          confirmado: true,
          tipoGasto: "recorrente",
          recorrenciaId: recId,
          essencial: input.essencial,
          gastoFixo: fixoFlag,
          criadoEm: now,
          atualizadoEm: now,
        },
      });
    }
  } else {
    const id = crypto.randomUUID();
    out.push({
      row: {
        id,
        user_id: userId,
        categoria_id: catUuid,
        descricao: input.descricao || input.estabelecimento || "Gasto",
        valor: input.valor,
        data: input.data,
        estabelecimento: input.estabelecimento || "",
        forma_pagamento: input.formaPagamento,
        observacao: input.observacao ?? null,
        imagem_url: input.imagemUrl ?? null,
        mes: baseDate.getMonth() + 1,
        ano: baseDate.getFullYear(),
        confirmado: true,
        tipo_gasto: "unico",
        essencial: input.essencial ?? null,
        gasto_fixo: input.gastoFixo ?? null,
      },
      client: {
        id,
        descricao: input.descricao || input.estabelecimento || "Gasto",
        valor: input.valor,
        data: input.data,
        estabelecimento: input.estabelecimento || "",
        categoriaId: input.categoriaId,
        formaPagamento: input.formaPagamento,
        observacao: input.observacao,
        imagemUrl: input.imagemUrl,
        mes: baseDate.getMonth() + 1,
        ano: baseDate.getFullYear(),
        confirmado: true,
        tipoGasto: "unico",
        essencial: input.essencial,
        gastoFixo: input.gastoFixo,
        criadoEm: now,
        atualizadoEm: now,
      },
    });
  }
  return out;
}

export function addGasto(input: NovoGastoInput): Gasto[] {
  if (!activeUserId) return [];
  const built = buildGastosFromInput(input, activeUserId);
  const created = built.map((b) => b.client);
  // Optimistic update
  memGastos = [...memGastos, ...created];
  emit();
  // Background sync
  void supabase
    .from("gastos")
    .insert(built.map((b) => b.row))
    .then(({ error }) => {
      if (error) {
        console.error("[store] addGasto failed", error);
        void refreshGastos();
      }
    });
  if (input.estabelecimento) {
    rememberCategoryFor(input.estabelecimento, input.categoriaId);
  }
  return created;
}

export function updateGasto(id: string, patch: Partial<Gasto>) {
  if (!activeUserId) return;
  const idx = memGastos.findIndex((g) => g.id === id);
  if (idx < 0) return;
  const updated = { ...memGastos[idx], ...patch, atualizadoEm: new Date().toISOString() };
  if (patch.data) {
    const d = new Date(patch.data + "T00:00:00");
    updated.mes = d.getMonth() + 1;
    updated.ano = d.getFullYear();
  }
  memGastos = [...memGastos.slice(0, idx), updated, ...memGastos.slice(idx + 1)];
  emit();

  const row: GastoUpdate = {};
  if (patch.descricao !== undefined) row.descricao = patch.descricao;
  if (patch.valor !== undefined) row.valor = patch.valor;
  if (patch.data !== undefined) {
    row.data = patch.data;
    row.mes = updated.mes;
    row.ano = updated.ano;
  }
  if (patch.estabelecimento !== undefined) row.estabelecimento = patch.estabelecimento;
  if (patch.categoriaId !== undefined) row.categoria_id = categoriaUuidFor(patch.categoriaId);
  if (patch.formaPagamento !== undefined) row.forma_pagamento = patch.formaPagamento;
  if (patch.observacao !== undefined) row.observacao = patch.observacao ?? null;
  if (patch.imagemUrl !== undefined) row.imagem_url = patch.imagemUrl ?? null;
  if (patch.essencial !== undefined) row.essencial = patch.essencial ?? null;
  if (patch.gastoFixo !== undefined) row.gasto_fixo = patch.gastoFixo ?? null;
  if (patch.confirmado !== undefined) row.confirmado = patch.confirmado;

  void supabase
    .from("gastos")
    .update(row)
    .eq("id", id)
    .then(({ error }) => {
      if (error) {
        console.error("[store] updateGasto failed", error);
        void refreshGastos();
      }
    });
}

export function deleteGasto(id: string) {
  if (!activeUserId) return;
  memGastos = memGastos.filter((g) => g.id !== id);
  emit();
  void supabase
    .from("gastos")
    .delete()
    .eq("id", id)
    .then(({ error }) => {
      if (error) {
        console.error("[store] deleteGasto failed", error);
        void refreshGastos();
      }
    });
}

export function findPossibleDuplicate(
  valor: number,
  data: string,
  estabelecimento?: string,
): Gasto | undefined {
  return memGastos.find(
    (g) =>
      Math.abs(g.valor - valor) < 0.01 &&
      g.data === data &&
      (estabelecimento
        ? g.estabelecimento.trim().toLowerCase() === estabelecimento.trim().toLowerCase()
        : true),
  );
}

// ---------- Categorias ----------
export function addCategoria(c: Omit<Categoria, "id" | "criadaPeloUsuario">): Categoria {
  if (!activeUserId) {
    const local: Categoria = { ...c, id: uid(), criadaPeloUsuario: true };
    memCategorias = [...memCategorias, local];
    emit();
    return local;
  }
  const newId = crypto.randomUUID();
  const novo: Categoria = { ...c, id: newId, criadaPeloUsuario: true };
  memCategorias = [...memCategorias, novo];
  categoriaKeyToUuid.set(newId, newId);
  emit();
  void supabase
    .from("categorias")
    .insert({
      id: newId,
      user_id: activeUserId,
      nome: c.nome,
      icon_name: c.iconName,
      color_var: c.colorVar ?? c.colorHex ?? "--cat-outros",
      criada_pelo_usuario: true,
    })
    .then(({ error }) => {
      if (error) console.error("[store] addCategoria failed", error);
    });
  return novo;
}

export function updateCategoria(id: string, patch: Partial<Categoria>) {
  memCategorias = memCategorias.map((c) => (c.id === id ? { ...c, ...patch } : c));
  emit();
  if (!activeUserId) return;
  const uuid = categoriaUuidFor(id);
  if (!uuid) return;
  const row: CategoriaUpdate = {};
  if (patch.nome !== undefined) row.nome = patch.nome;
  if (patch.iconName !== undefined) row.icon_name = patch.iconName;
  if (patch.colorVar !== undefined) row.color_var = patch.colorVar;
  if (patch.colorHex !== undefined) row.color_var = patch.colorHex;
  void supabase
    .from("categorias")
    .update(row)
    .eq("id", uuid)
    .then(({ error }) => {
      if (error) console.error("[store] updateCategoria failed", error);
    });
}

export function deleteCategoria(id: string) {
  memCategorias = memCategorias.filter((c) => c.id !== id);
  emit();
  if (!activeUserId) return;
  const uuid = categoriaUuidFor(id);
  if (!uuid) return;
  categoriaKeyToUuid.delete(id);
  void supabase
    .from("categorias")
    .delete()
    .eq("id", uuid)
    .then(({ error }) => {
      if (error) console.error("[store] deleteCategoria failed", error);
    });
}

// ---------- Limites ----------
export function setLimite(tipo: "total" | string, valor: number, mes: number, ano: number) {
  const idx = memLimites.findIndex((l) => l.tipo === tipo && l.mes === mes && l.ano === ano);
  if (idx >= 0) {
    memLimites = memLimites.map((l, i) => (i === idx ? { ...l, valor } : l));
  } else {
    memLimites = [...memLimites, { id: crypto.randomUUID(), tipo, valor, mes, ano }];
  }
  emit();
  if (!activeUserId) return;
  void supabase
    .from("limites")
    .upsert(
      { user_id: activeUserId, tipo, valor, mes, ano },
      { onConflict: "user_id,tipo,mes,ano" },
    )
    .then(({ error }) => {
      if (error) console.error("[store] setLimite failed", error);
    });
}

export function getLimite(tipo: "total" | string, mes: number, ano: number): number | undefined {
  return memLimites.find((l) => l.tipo === tipo && l.mes === mes && l.ano === ano)?.valor;
}

// ---------- Aprendizado ----------
export function rememberCategoryFor(estabelecimento: string, categoriaId: string) {
  const key = estabelecimento.trim().toLowerCase();
  if (!key) return;
  const idx = memAprendizado.findIndex((a) => a.estabelecimento === key);
  const now = new Date().toISOString();
  if (idx >= 0) {
    memAprendizado = memAprendizado.map((a, i) =>
      i === idx ? { ...a, categoriaId, criadoEm: now } : a,
    );
  } else {
    memAprendizado = [
      ...memAprendizado,
      { id: crypto.randomUUID(), estabelecimento: key, categoriaId, criadoEm: now },
    ];
  }
  if (!activeUserId) return;
  const catUuid = categoriaUuidFor(categoriaId);
  if (!catUuid) return;
  void supabase
    .from("aprendizado_categoria")
    .upsert(
      { user_id: activeUserId, estabelecimento: key, categoria_id: catUuid },
      { onConflict: "user_id,estabelecimento" },
    )
    .then(({ error }) => {
      if (error) console.error("[store] rememberCategoryFor failed", error);
    });
}

export function suggestCategory(text: string): string {
  const key = text.trim().toLowerCase();
  if (key) {
    const learned = memAprendizado.find((a) => key.includes(a.estabelecimento));
    if (learned) return learned.categoriaId;
  }
  return suggestCategoryFromText(text);
}

// ---------- Receitas ----------
export type NovaReceitaInput = {
  descricao: string;
  valor: number;
  data: string;
  tipo: TipoReceita;
  recorrente?: boolean;
  recorrenteMeses?: number;
};

export function addReceita(input: NovaReceitaInput): Receita[] {
  if (!activeUserId) return [];
  const now = new Date().toISOString();
  const baseDate = new Date(input.data + "T00:00:00");
  const created: Receita[] = [];
  const rows: ReceitaInsert[] = [];

  if (input.recorrente) {
    const meses = Math.max(1, input.recorrenteMeses ?? 12);
    const recId = crypto.randomUUID();
    for (let i = 0; i < meses; i++) {
      const d = new Date(baseDate);
      d.setMonth(d.getMonth() + i);
      const iso = d.toISOString().slice(0, 10);
      const id = crypto.randomUUID();
      created.push({
        id,
        descricao: input.descricao,
        valor: input.valor,
        data: iso,
        tipo: input.tipo,
        recorrente: true,
        recorrenciaId: recId,
        mes: d.getMonth() + 1,
        ano: d.getFullYear(),
        criadoEm: now,
        atualizadoEm: now,
      });
      rows.push({
        id,
        user_id: activeUserId,
        descricao: input.descricao,
        valor: input.valor,
        data: iso,
        tipo: input.tipo,
        recorrente: true,
        recorrencia_id: recId,
        mes: d.getMonth() + 1,
        ano: d.getFullYear(),
      });
    }
  } else {
    const id = crypto.randomUUID();
    created.push({
      id,
      descricao: input.descricao,
      valor: input.valor,
      data: input.data,
      tipo: input.tipo,
      recorrente: false,
      mes: baseDate.getMonth() + 1,
      ano: baseDate.getFullYear(),
      criadoEm: now,
      atualizadoEm: now,
    });
    rows.push({
      id,
      user_id: activeUserId,
      descricao: input.descricao,
      valor: input.valor,
      data: input.data,
      tipo: input.tipo,
      recorrente: false,
      mes: baseDate.getMonth() + 1,
      ano: baseDate.getFullYear(),
    });
  }
  memReceitas = [...memReceitas, ...created];
  emit();
  void supabase
    .from("receitas")
    .insert(rows)
    .then(({ error }) => {
      if (error) {
        console.error("[store] addReceita failed", error);
      }
    });
  return created;
}

export function deleteReceita(id: string) {
  memReceitas = memReceitas.filter((r) => r.id !== id);
  emit();
  if (!activeUserId) return;
  void supabase
    .from("receitas")
    .delete()
    .eq("id", id)
    .then(({ error }) => {
      if (error) console.error("[store] deleteReceita failed", error);
    });
}

/** Exclui todas as receitas de uma recorrência (a partir de um mês opcional). */
export function deleteReceitaRecorrencia(
  recorrenciaId: string,
  fromMes?: number,
  fromAno?: number,
) {
  const shouldRemove = (r: Receita) => {
    if (r.recorrenciaId !== recorrenciaId) return false;
    if (fromMes == null || fromAno == null) return true;
    return r.ano > fromAno || (r.ano === fromAno && r.mes >= fromMes);
  };
  const removedIds = memReceitas.filter(shouldRemove).map((r) => r.id);
  memReceitas = memReceitas.filter((r) => !shouldRemove(r));
  emit();
  if (!activeUserId || removedIds.length === 0) return;
  void supabase
    .from("receitas")
    .delete()
    .in("id", removedIds)
    .then(({ error }) => {
      if (error) console.error("[store] deleteReceitaRecorrencia failed", error);
    });
}

export type ReceitaEditableFields = {
  descricao?: string;
  valor?: number;
  data?: string;
  tipo?: TipoReceita;
};

export type UpdateReceitaScope = "single" | "forward" | "all";

/**
 * Atualiza uma receita.
 * - "single": apenas a receita selecionada
 * - "forward": esta e todas as próximas da mesma recorrência
 * - "all": todas as receitas da mesma recorrência
 *
 * Se a receita não for recorrente, apenas o escopo "single" é aplicado.
 */
export function updateReceita(
  id: string,
  fields: ReceitaEditableFields,
  scope: UpdateReceitaScope = "single",
) {
  const target = memReceitas.find((r) => r.id === id);
  if (!target) return;
  const now = new Date().toISOString();

  const buildPatch = (r: Receita): Receita => {
    const next: Receita = { ...r, atualizadoEm: now };
    if (fields.descricao !== undefined) next.descricao = fields.descricao;
    if (fields.valor !== undefined) next.valor = fields.valor;
    if (fields.tipo !== undefined) next.tipo = fields.tipo;
    if (fields.data !== undefined) {
      // Para escopo "single" trocamos data/mes/ano da própria receita.
      // Para escopos "forward"/"all" só atualizamos a data quando for o item alvo;
      // os demais mantêm seu mês/ano originais (preservando histórico).
      if (r.id === target.id) {
        const d = new Date(fields.data + "T00:00:00");
        next.data = fields.data;
        next.mes = d.getMonth() + 1;
        next.ano = d.getFullYear();
      }
    }
    return next;
  };

  let affected: Receita[] = [];
  if (scope === "single" || !target.recorrenciaId) {
    affected = [buildPatch(target)];
  } else if (scope === "forward") {
    affected = memReceitas
      .filter(
        (r) =>
          r.recorrenciaId === target.recorrenciaId &&
          (r.ano > target.ano || (r.ano === target.ano && r.mes >= target.mes)),
      )
      .map(buildPatch);
  } else {
    affected = memReceitas
      .filter((r) => r.recorrenciaId === target.recorrenciaId)
      .map(buildPatch);
  }

  const affectedMap = new Map(affected.map((r) => [r.id, r]));
  memReceitas = memReceitas.map((r) => affectedMap.get(r.id) ?? r);
  emit();

  if (!activeUserId) return;

  // Constrói payload por linha (apenas campos a alterar)
  const basePatch: TablesUpdate<"receitas"> = {};
  if (fields.descricao !== undefined) basePatch.descricao = fields.descricao;
  if (fields.valor !== undefined) basePatch.valor = fields.valor;
  if (fields.tipo !== undefined) basePatch.tipo = fields.tipo;

  // Para descrição/valor/tipo aplicamos em lote
  const ids = affected.map((r) => r.id);
  if (Object.keys(basePatch).length > 0 && ids.length > 0) {
    void supabase
      .from("receitas")
      .update(basePatch)
      .in("id", ids)
      .then(({ error }) => {
        if (error) console.error("[store] updateReceita batch failed", error);
      });
  }

  // Data só se aplica ao próprio item alvo
  if (fields.data !== undefined) {
    const updated = affectedMap.get(target.id);
    if (updated) {
      void supabase
        .from("receitas")
        .update({ data: updated.data, mes: updated.mes, ano: updated.ano })
        .eq("id", target.id)
        .then(({ error }) => {
          if (error) console.error("[store] updateReceita data failed", error);
        });
    }
  }
}

// ============================================================
// PHASE 2: Bancos / Guardado / Metas (still localStorage)
// ============================================================
// ---------- Bancos ----------
function bancoUuidFor(key: string): string | null {
  return bancoKeyToUuid.get(key) ?? null;
}
function metaUuidFor(key: string): string | null {
  return metaKeyToUuid.get(key) ?? null;
}

export function addBanco(input: { nome: string; colorHex: string }): Banco {
  const now = new Date().toISOString();
  const novo: Banco = {
    id: uid(),
    nome: input.nome.trim(),
    colorHex: input.colorHex,
    criadoPeloUsuario: true,
    criadoEm: now,
  };
  if (!activeUserId) {
    memBancos = [...memBancos, novo];
    emit();
    return novo;
  }
  const newUuid = crypto.randomUUID();
  novo.id = newUuid;
  memBancos = [...memBancos, novo];
  bancoKeyToUuid.set(newUuid, newUuid);
  emit();
  void supabase
    .from("bancos")
    .insert({
      id: newUuid,
      user_id: activeUserId,
      nome: novo.nome,
      color_hex: novo.colorHex,
      criado_pelo_usuario: true,
    })
    .then(({ error }) => {
      if (error) console.error("[store] addBanco failed", error);
    });
  return novo;
}

export function updateBanco(id: string, patch: Partial<Banco>) {
  memBancos = memBancos.map((b) => (b.id === id ? { ...b, ...patch } : b));
  emit();
  if (!activeUserId) return;
  const uuid = bancoUuidFor(id);
  if (!uuid) return;
  const row: BancoUpdate = {};
  if (patch.nome !== undefined) row.nome = patch.nome;
  if (patch.colorHex !== undefined) row.color_hex = patch.colorHex;
  void supabase
    .from("bancos")
    .update(row)
    .eq("id", uuid)
    .then(({ error }) => {
      if (error) console.error("[store] updateBanco failed", error);
    });
}

export function deleteBanco(id: string) {
  memBancos = memBancos.filter((b) => b.id !== id);
  memGuardado = memGuardado.filter((g) => g.bancoId !== id);
  emit();
  if (!activeUserId) return;
  const uuid = bancoUuidFor(id);
  if (!uuid) return;
  bancoKeyToUuid.delete(id);
  void supabase
    .from("bancos")
    .delete()
    .eq("id", uuid)
    .then(({ error }) => {
      if (error) console.error("[store] deleteBanco failed", error);
    });
}

// ---------- Dinheiro guardado ----------
export type NovoGuardadoInput = {
  bancoId: string;
  valor: number;
  tipoReserva: TipoReserva;
  observacao?: string;
};
export function addGuardado(input: NovoGuardadoInput): Guardado {
  const now = new Date().toISOString();
  const novo: Guardado = {
    id: uid(),
    bancoId: input.bancoId,
    valor: input.valor,
    tipoReserva: input.tipoReserva,
    observacao: input.observacao,
    dataAtualizacao: now.slice(0, 10),
    criadoEm: now,
    atualizadoEm: now,
  };
  if (!activeUserId) {
    memGuardado = [...memGuardado, novo];
    emit();
    return novo;
  }
  const newUuid = crypto.randomUUID();
  novo.id = newUuid;
  memGuardado = [...memGuardado, novo];
  emit();
  void supabase
    .from("dinheiro_guardado")
    .insert({
      id: newUuid,
      user_id: activeUserId,
      banco_id: bancoUuidFor(input.bancoId),
      valor: input.valor,
      tipo_reserva: input.tipoReserva,
      observacao: input.observacao ?? null,
      data_atualizacao: now.slice(0, 10),
    })
    .then(({ error }) => {
      if (error) console.error("[store] addGuardado failed", error);
    });
  return novo;
}

export function updateGuardado(id: string, patch: Partial<Guardado>) {
  const now = new Date().toISOString();
  memGuardado = memGuardado.map((g) =>
    g.id === id
      ? { ...g, ...patch, atualizadoEm: now, dataAtualizacao: now.slice(0, 10) }
      : g,
  );
  emit();
  if (!activeUserId) return;
  const row: GuardadoUpdate = { data_atualizacao: now.slice(0, 10) };
  if (patch.valor !== undefined) row.valor = patch.valor;
  if (patch.bancoId !== undefined) row.banco_id = bancoUuidFor(patch.bancoId);
  if (patch.tipoReserva !== undefined) row.tipo_reserva = patch.tipoReserva;
  if (patch.observacao !== undefined) row.observacao = patch.observacao ?? null;
  void supabase
    .from("dinheiro_guardado")
    .update(row)
    .eq("id", id)
    .then(({ error }) => {
      if (error) console.error("[store] updateGuardado failed", error);
    });
}

export function deleteGuardado(id: string) {
  memGuardado = memGuardado.filter((g) => g.id !== id);
  emit();
  if (!activeUserId) return;
  void supabase
    .from("dinheiro_guardado")
    .delete()
    .eq("id", id)
    .then(({ error }) => {
      if (error) console.error("[store] deleteGuardado failed", error);
    });
}

// ---------- Metas ----------
export type NovaMetaInput = {
  nome: string;
  valorObjetivo: number;
  valorAtual?: number;
  prazo?: string;
  descricao?: string;
  colorHex: string;
  bancoId?: string;
};
export function addMeta(input: NovaMetaInput): Meta {
  const now = new Date().toISOString();
  const novo: Meta = {
    id: uid(),
    nome: input.nome.trim(),
    valorObjetivo: input.valorObjetivo,
    valorAtual: input.valorAtual ?? 0,
    prazo: input.prazo,
    descricao: input.descricao,
    colorHex: input.colorHex,
    bancoId: input.bancoId,
    criadoEm: now,
    atualizadoEm: now,
  };
  if (!activeUserId) {
    memMetas = [...memMetas, novo];
    emit();
    return novo;
  }
  const newUuid = crypto.randomUUID();
  novo.id = newUuid;
  memMetas = [...memMetas, novo];
  metaKeyToUuid.set(newUuid, newUuid);
  emit();
  void supabase
    .from("metas_financeiras")
    .insert({
      id: newUuid,
      user_id: activeUserId,
      nome: novo.nome,
      valor_objetivo: novo.valorObjetivo,
      valor_atual: novo.valorAtual,
      prazo: novo.prazo ?? null,
      descricao: novo.descricao ?? null,
      color_hex: novo.colorHex,
      banco_id: input.bancoId ? bancoUuidFor(input.bancoId) : null,
    })
    .then(({ error }) => {
      if (error) console.error("[store] addMeta failed", error);
    });
  return novo;
}

export function updateMeta(id: string, patch: Partial<Meta>) {
  const now = new Date().toISOString();
  memMetas = memMetas.map((m) => (m.id === id ? { ...m, ...patch, atualizadoEm: now } : m));
  emit();
  if (!activeUserId) return;
  const uuid = metaUuidFor(id);
  if (!uuid) return;
  const row: MetaUpdate = {};
  if (patch.nome !== undefined) row.nome = patch.nome;
  if (patch.valorObjetivo !== undefined) row.valor_objetivo = patch.valorObjetivo;
  if (patch.valorAtual !== undefined) row.valor_atual = patch.valorAtual;
  if (patch.prazo !== undefined) row.prazo = patch.prazo ?? null;
  if (patch.descricao !== undefined) row.descricao = patch.descricao ?? null;
  if (patch.colorHex !== undefined) row.color_hex = patch.colorHex;
  if (patch.bancoId !== undefined) row.banco_id = patch.bancoId ? bancoUuidFor(patch.bancoId) : null;
  void supabase
    .from("metas_financeiras")
    .update(row)
    .eq("id", uuid)
    .then(({ error }) => {
      if (error) console.error("[store] updateMeta failed", error);
    });
}

export function deleteMeta(id: string) {
  memMetas = memMetas.filter((m) => m.id !== id);
  memMov = memMov.filter((mv) => mv.metaId !== id);
  emit();
  if (!activeUserId) return;
  const uuid = metaUuidFor(id);
  if (!uuid) return;
  metaKeyToUuid.delete(id);
  void supabase
    .from("metas_financeiras")
    .delete()
    .eq("id", uuid)
    .then(({ error }) => {
      if (error) console.error("[store] deleteMeta failed", error);
    });
}

export function addMovimentacaoMeta(input: {
  metaId: string;
  valor: number;
  bancoId?: string;
  observacao?: string;
}) {
  const meta = memMetas.find((m) => m.id === input.metaId);
  if (!meta) return;
  const now = new Date().toISOString();
  const movId = activeUserId ? crypto.randomUUID() : uid();
  const mov: MovimentacaoMeta = {
    id: movId,
    metaId: input.metaId,
    valor: input.valor,
    data: now.slice(0, 10),
    bancoId: input.bancoId,
    observacao: input.observacao,
    criadoEm: now,
  };
  memMov = [...memMov, mov];
  emit();
  // Update meta value (optimistic + server)
  updateMeta(input.metaId, { valorAtual: meta.valorAtual + input.valor });

  if (!activeUserId) return;
  const metaUuid = metaUuidFor(input.metaId);
  if (!metaUuid) return;
  void supabase
    .from("movimentacoes_meta")
    .insert({
      id: movId,
      user_id: activeUserId,
      meta_id: metaUuid,
      valor: input.valor,
      data: now.slice(0, 10),
      banco_id: input.bancoId ? bancoUuidFor(input.bancoId) : null,
      observacao: input.observacao ?? null,
    })
    .then(({ error }) => {
      if (error) console.error("[store] addMovimentacaoMeta failed", error);
    });
}

export function deleteMovimentacaoMeta(id: string) {
  const mov = memMov.find((mv) => mv.id === id);
  memMov = memMov.filter((mv) => mv.id !== id);
  if (mov) {
    const meta = memMetas.find((m) => m.id === mov.metaId);
    if (meta) updateMeta(meta.id, { valorAtual: Math.max(0, meta.valorAtual - mov.valor) });
  }
  emit();
  if (!activeUserId) return;
  void supabase
    .from("movimentacoes_meta")
    .delete()
    .eq("id", id)
    .then(({ error }) => {
      if (error) console.error("[store] deleteMovimentacaoMeta failed", error);
    });
}

// ---------- Helpers para metas ----------
export function statusMeta(meta: Meta): StatusMeta {
  const pct = meta.valorObjetivo > 0 ? (meta.valorAtual / meta.valorObjetivo) * 100 : 0;
  if (pct >= 100) return "concluida";
  if (pct >= 80) return "quase";
  if (pct > 0) return "em_andamento";
  return "nao_iniciada";
}

// ============================================================
// React hooks
// ============================================================
export function useStore<T>(selector: () => T): T {
  return useSyncExternalStore(subscribe, selector, selector);
}

export function useHydrationStatus(): HydrationStatus {
  return useSyncExternalStore(subscribe, getHydrationStatus, getHydrationStatus);
}

/**
 * Bootstrap helper.
 * - For phase-2 (local) data, ensures defaults are seeded for the active user.
 * - For phase-1 (cloud) data, returns true once hydration finished.
 * Returns true when ready to render.
 */
export function useBootstrap() {
  const status = useHydrationStatus();
  const [localReady, setLocalReady] = useState(false);
  useEffect(() => {
    bootstrapLocalDefaults();
    setLocalReady(true);
  }, []);
  // If no user is active, don't block on cloud hydration.
  if (!activeUserId) return localReady;
  return localReady && (status === "ready" || status === "error");
}
