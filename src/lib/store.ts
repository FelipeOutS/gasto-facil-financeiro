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
  type ContaAPagar,
  type FrequenciaRecorrencia,
  type StatusConta,
  type TransferenciaInterna,
  type ExtratoImportado,
  type StatusExtratoImportado,
  type TipoOrigemExtrato,
  type FaturaCartao,
  type StatusFatura,
} from "./types";
import { DEFAULT_CATEGORIES, suggestCategoryFromText } from "./categories";
import { parseDateLocal, toLocalISODate } from "./format";
import { addMonthsPreservingDay } from "./recurrence-date";
import { validateFinancialAmount, financialAmountMessage } from "./financial-limits";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { markContaAPagarPaid, unmarkContaAPagarPaid } from "@/lib/contas.functions";

/**
 * Flag de assinatura ativa publicada pelo SubscriptionGuardProvider.
 * Defaultamos para `false` — só liberamos escrita quando o provider confirmar
 * que o usuário tem assinatura ativa ou é Admin Master.
 */
let canWriteFinancial = false;
let canWriteBasicFinancial = false;
export function setStoreCanWrite(v: boolean) {
  canWriteFinancial = v;
}
/**
 * Escrita básica (free_ads + planos pagos). Habilitada apenas para fluxos
 * básicos explicitamente liberados (hoje: addGasto manual e addReceita manual).
 * Quota mensal é validada server-side pelas triggers `tg_free_ads_quota_*`.
 */
export function setStoreCanWriteBasic(v: boolean) {
  canWriteBasicFinancial = v;
}
function ensureCanWrite(action: string, opts?: { allowBasic?: boolean }): boolean {
  if (canWriteFinancial) return true;
  if (opts?.allowBasic && canWriteBasicFinancial) return true;
  if (typeof window !== "undefined") {
    // Aviso amigável caso uma chamada burle o front-end.
    void import("sonner").then(({ toast }) => {
      toast.error("Você precisa de uma assinatura ativa para usar este recurso.");
    });
    console.warn(`[store] Bloqueado: ${action} requer assinatura ativa.`);
  }
  return false;
}

/**
 * Detecta erros de quota free_ads vindos das triggers SQL
 * (ERRCODE check_violation + message `free_ads_quota_exceeded:<resource>`).
 * Mostra toast amigável e retorna true se tratou.
 */
export function handleFreeAdsQuotaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  const m = /free_ads_quota_exceeded:([a-z_]+)/i.exec(msg);
  if (!m) return false;
  const resource = m[1];
  if (typeof window === "undefined") return true;
  void Promise.all([import("sonner"), import("@/i18n")]).then(([{ toast }, i18nMod]) => {
    const i18n = i18nMod.default;
    const key = `common:subscription.freeAdsQuota.${resource}`;
    const fallbackKey = "common:subscription.freeAdsQuota.generic";
    const message = i18n.exists(key) ? i18n.t(key) : i18n.t(fallbackKey);
    toast.error(String(message));
  });
  return true;
}

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
const EMPTY_CARTOES: Cartao[] = [];
const EMPTY_CONTAS: ContaAPagar[] = [];
const EMPTY_TRANSFERENCIAS: TransferenciaInterna[] = [];
const EMPTY_EXTRATOS: ExtratoImportado[] = [];

let memGastos: Gasto[] = EMPTY_GASTOS;
let memCategorias: Categoria[] = EMPTY_CATEGORIAS;
let memLimites: Limite[] = EMPTY_LIMITES;
let memAprendizado: AprendizadoCategoria[] = EMPTY_APRENDIZADO;
let memReceitas: Receita[] = EMPTY_RECEITAS;
let memBancos: Banco[] = EMPTY_BANCOS;
let memGuardado: Guardado[] = EMPTY_GUARDADO;
let memMetas: Meta[] = EMPTY_METAS;
let memMov: MovimentacaoMeta[] = EMPTY_MOV;
let memCartoes: Cartao[] = EMPTY_CARTOES;
let memContas: ContaAPagar[] = EMPTY_CONTAS;
let memTransferencias: TransferenciaInterna[] = EMPTY_TRANSFERENCIAS;
let memExtratos: ExtratoImportado[] = EMPTY_EXTRATOS;
let memFaturas: FaturaCartao[] = [];

// Lookup uuid by client-side key (legacy_id or uuid) for FK writes / id mapping
const categoriaKeyToUuid = new Map<string, string>();
const bancoKeyToUuid = new Map<string, string>();
const metaKeyToUuid = new Map<string, string>();

// Supabase client typed loosely for the `cartoes` table — types may not be regenerated yet.
// RLS still protects all access; user_id is enforced server-side.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sbAny = supabase as unknown as any;

// ============================================================
// USER SESSION
// ============================================================
export function setActiveUserId(uid: string | null) {
  if (activeUserId === uid) return;
  activeUserId = uid;
  hydratedUserId = null;
  hydrationInFlightUserId = null;
  hydrationInFlightPromise = null;
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
  memCartoes = EMPTY_CARTOES;
  memContas = EMPTY_CONTAS;
  memTransferencias = EMPTY_TRANSFERENCIAS;
  memExtratos = EMPTY_EXTRATOS;
  memFaturas = [];
  categoriaKeyToUuid.clear();
  bancoKeyToUuid.clear();
  metaKeyToUuid.clear();
  setHydrationStatus("idle");
  emit();
}

// ============================================================
// HYDRATION (load all user data from Supabase)
// ============================================================
type HydrationStatus = "idle" | "loading" | "ready" | "error";
let hydrationStatus: HydrationStatus = "idle";
let localBootstrapReady = false;
let hydratedUserId: string | null = null;
let hydrationInFlightUserId: string | null = null;
let hydrationInFlightPromise: Promise<void> | null = null;

export function getHydrationStatus(): HydrationStatus {
  return hydrationStatus;
}

function setHydrationStatus(s: HydrationStatus) {
  if (hydrationStatus === s) return;
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
  cartao_id?: string | null;
  invoice_month?: string | null;
  horario?: string | null;
  origem?: string | null;
  import_batch_id?: string | null;
  id_operacao_banco?: string | null;
  fornecedor_id?: string | null;
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
    cartaoId: r.cartao_id ?? undefined,
    invoiceMonth: r.invoice_month ?? undefined,
    horario: r.horario ?? undefined,
    origem: r.origem ?? undefined,
    importBatchId: r.import_batch_id ?? undefined,
    idOperacaoBanco: r.id_operacao_banco ?? undefined,
    fornecedorId: r.fornecedor_id ?? undefined,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
  };
}

type LegacyGastoShape = Gasto & {
  cartao_id?: string | null;
  forma_pagamento?: string | null;
  importado?: boolean;
  faturaId?: string | null;
  createdAt?: string;
  created_at?: string;
};

const FORMAS_VALIDAS = new Set<FormaPagamento>([
  "pix",
  "dinheiro",
  "debito",
  "credito",
  "boleto",
  "transferencia",
  "vale_alimentacao",
  "vale_refeicao",
  "outro",
]);

function normalizeFormaPagamentoValue(value: unknown): FormaPagamento {
  const raw = String(value ?? "").trim();
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["credito", "cartao", "cartao_credito", "cartao_de_credito", "credit_card", "credit"].includes(normalized)) {
    return "credito";
  }
  if (normalized === "debito" || normalized === "cartao_de_debito") return "debito";
  if (normalized === "vale_alimentacao" || normalized === "vale_alimentacao_") return "vale_alimentacao";
  if (normalized === "vale_refeicao" || normalized === "vale_refeicao_") return "vale_refeicao";
  return FORMAS_VALIDAS.has(normalized as FormaPagamento) ? (normalized as FormaPagamento) : "outro";
}

function gastoCartaoId(g: Gasto): string | undefined {
  const legacy = g as LegacyGastoShape;
  return g.cartaoId ?? legacy.cartao_id ?? undefined;
}

function isImportadoOuFatura(g: Gasto): boolean {
  const legacy = g as LegacyGastoShape;
  const origem = String(g.origem ?? "").toLowerCase();
  return origem.includes("fatura") || origem.includes("import") || legacy.importado === true || !!legacy.faturaId;
}

function inferNearestInvoiceDate(date: Date, context: Date): Date {
  const candidates = [context.getFullYear() - 1, context.getFullYear(), context.getFullYear() + 1]
    .map((year) => new Date(year, date.getMonth(), date.getDate()))
    .filter((d) => d.getMonth() === date.getMonth() && d.getDate() === date.getDate());
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate.getTime() - context.getTime()) < Math.abs(best.getTime() - context.getTime())
      ? candidate
      : best,
  candidates[0] ?? date);
}

function normalizeInvoiceDateIfNeeded(dateISO: string, contextDate: Date, force = false): string {
  const parsed = parseDateLocal(dateISO);
  if (!parsed) return dateISO;
  const nearest = inferNearestInvoiceDate(parsed, contextDate);
  const dayMs = 24 * 60 * 60 * 1000;
  const originalDistance = Math.abs(parsed.getTime() - contextDate.getTime()) / dayMs;
  const nearestDistance = Math.abs(nearest.getTime() - contextDate.getTime()) / dayMs;
  if ((force || originalDistance > 120) && nearestDistance <= 75) {
    return toLocalISODate(nearest);
  }
  return toLocalISODate(parsed);
}

function normalizeGastoForCalculations(g: Gasto): { gasto: Gasto; row?: GastoUpdate } {
  const row: GastoUpdate = {};
  const normalized: Gasto = { ...g };
  const cartao = gastoCartaoId(g);
  if (cartao && normalized.cartaoId !== cartao) {
    normalized.cartaoId = cartao;
    row.cartao_id = cartao;
  }

  const formaNormalizada = normalizeFormaPagamentoValue((g as LegacyGastoShape).forma_pagamento ?? g.formaPagamento);
  if (cartao && normalized.formaPagamento !== "credito") {
    normalized.formaPagamento = "credito";
    row.forma_pagamento = "credito";
  } else if (!cartao && normalized.formaPagamento !== formaNormalizada) {
    normalized.formaPagamento = formaNormalizada;
    row.forma_pagamento = formaNormalizada;
  }

  const parsed = parseDateLocal(normalized.data);
  if (parsed) {
    const context = parseDateLocal((g as LegacyGastoShape).createdAt ?? (g as LegacyGastoShape).created_at ?? g.criadoEm) ?? new Date();
    const shouldFixInvoiceYear = (cartao && normalized.formaPagamento === "credito") || isImportadoOuFatura(g);
    const normalizedDate = shouldFixInvoiceYear
      ? normalizeInvoiceDateIfNeeded(normalized.data, context, isImportadoOuFatura(g))
      : toLocalISODate(parsed);
    const dateForYm = parseDateLocal(normalizedDate) ?? parsed;
    if (normalized.data !== normalizedDate) {
      normalized.data = normalizedDate;
      row.data = normalizedDate;
    }
    if (normalized.mes !== dateForYm.getMonth() + 1 || normalized.ano !== dateForYm.getFullYear()) {
      normalized.mes = dateForYm.getMonth() + 1;
      normalized.ano = dateForYm.getFullYear();
      row.mes = normalized.mes;
      row.ano = normalized.ano;
    }
    if (!normalized.invoiceMonth || !/^\d{4}-\d{2}$/.test(normalized.invoiceMonth)) {
      normalized.invoiceMonth = `${dateForYm.getFullYear()}-${String(dateForYm.getMonth() + 1).padStart(2, "0")}`;
      row.invoice_month = normalized.invoiceMonth;
    }
  }

  if ((normalized as Partial<Gasto>).confirmado == null) {
    normalized.confirmado = true;
    row.confirmado = true;
  }

  return Object.keys(row).length > 0 ? { gasto: normalized, row } : { gasto: normalized };
}

function normalizeGastosForCalculations(gastos: Gasto[], persist = false): Gasto[] {
  const updates: Array<{ id: string; row: GastoUpdate }> = [];
  const normalized = gastos.map((g) => {
    const result = normalizeGastoForCalculations(g);
    if (result.row) updates.push({ id: g.id, row: result.row });
    return result.gasto;
  });
  if (updates.length > 0 && typeof window !== "undefined" && window.localStorage.getItem("gf:debug-finance") === "1") {
    console.info("[financeiro:normalizacao] gastos ajustados", updates.map(({ id, row }) => ({ id, ...row })));
  }
  if (persist && activeUserId && updates.length > 0) {
    void Promise.all(
      updates.map(({ id, row }) => supabase.from("gastos").update(row).eq("id", id)),
    ).then((results) => {
      const failed = results.find((r) => r.error);
      if (failed?.error) console.error("[store] normalize gastos failed", failed.error);
    });
  }
  return normalized;
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
  horario?: string | null;
  origem?: string | null;
  import_batch_id?: string | null;
  id_operacao_banco?: string | null;
  cliente_id?: string | null;
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
    horario: r.horario ?? undefined,
    origem: r.origem ?? undefined,
    importBatchId: r.import_batch_id ?? undefined,
    idOperacaoBanco: r.id_operacao_banco ?? undefined,
    clienteId: r.cliente_id ?? null,
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
  import_batch_id?: string | null;
  meta_id?: string | null;
};
function rowToGuardado(
  r: GuardadoRow,
  bancoUuidToKey: Map<string, string>,
  metaUuidToKey: Map<string, string>,
): Guardado {
  return {
    id: r.legacy_id || r.id,
    bancoId: r.banco_id ? bancoUuidToKey.get(r.banco_id) ?? r.banco_id : "",
    valor: Number(r.valor),
    tipoReserva: r.tipo_reserva as TipoReserva,
    observacao: r.observacao ?? undefined,
    dataAtualizacao: r.data_atualizacao,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
    importBatchId: r.import_batch_id ?? undefined,
    metaId: r.meta_id ? metaUuidToKey.get(r.meta_id) ?? r.meta_id : undefined,
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
  // imagem_key é uma coluna opcional adicionada via migration; pode ainda
  // não estar refletida no tipo gerado, então acessamos com cast seguro.
  const imagemKey = (r as unknown as { imagem_key?: string | null }).imagem_key ?? undefined;
  return {
    id: r.legacy_id || r.id,
    nome: r.nome,
    valorObjetivo: Number(r.valor_objetivo),
    valorAtual: Number(r.valor_atual),
    prazo: r.prazo ?? undefined,
    descricao: r.descricao ?? undefined,
    colorHex: r.color_hex,
    bancoId: r.banco_id ? bancoUuidToKey.get(r.banco_id) ?? r.banco_id : undefined,
    imagemKey: imagemKey ?? undefined,
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
  import_batch_id?: string | null;
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
    importBatchId: r.import_batch_id ?? undefined,
  };
}

type CartaoRow = {
  id: string;
  nome: string;
  banco: string;
  limite_total: string | number;
  dia_fechamento: number;
  dia_vencimento: number;
  cor: string;
  observacao: string | null;
  created_at: string;
  updated_at: string;
};
function rowToCartao(r: CartaoRow): Cartao {
  return {
    id: r.id,
    nome: r.nome,
    banco: r.banco,
    limiteTotal: Number(r.limite_total),
    diaFechamento: r.dia_fechamento,
    diaVencimento: r.dia_vencimento,
    cor: r.cor,
    observacao: r.observacao ?? undefined,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
  };
}

type ContaAPagarRow = {
  id: string;
  nome: string;
  valor: string | number;
  data_vencimento: string;
  categoria_id: string | null;
  observacao: string | null;
  recorrente: boolean;
  recorrencia_id: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  status: string;
  data_pagamento: string | null;
  gasto_id: string | null;
  beneficiario?: string | null;
  forma_pagamento?: string | null;
  codigo_boleto?: string | null;
  codigo_pix?: string | null;
  chave_pix?: string | null;
  banco_emissor?: string | null;
  frequencia_recorrencia?: string | null;
  import_batch_id?: string | null;
  mes_referencia?: string | null;
  fornecedor_id?: string | null;
  mes: number;
  ano: number;
  created_at: string;
  updated_at: string;
};
function rowToContaAPagar(r: ContaAPagarRow, catUuidToKey: Map<string, string>): ContaAPagar {
  return {
    id: r.id,
    nome: r.nome,
    valor: Number(r.valor),
    dataVencimento: r.data_vencimento,
    categoriaId: r.categoria_id ? catUuidToKey.get(r.categoria_id) ?? r.categoria_id : undefined,
    observacao: r.observacao ?? undefined,
    recorrente: r.recorrente,
    recorrenciaId: r.recorrencia_id ?? undefined,
    frequenciaRecorrencia:
      (r.frequencia_recorrencia as ContaAPagar["frequenciaRecorrencia"]) ?? undefined,
    dataInicio: r.data_inicio ?? undefined,
    dataFim: r.data_fim ?? undefined,
    status: (r.status as StatusConta) ?? "pendente",
    dataPagamento: r.data_pagamento ?? undefined,
    gastoId: r.gasto_id ?? undefined,
    beneficiario: r.beneficiario ?? undefined,
    formaPagamento: (r.forma_pagamento as FormaPagamento | null) ?? undefined,
    codigoBoleto: r.codigo_boleto ?? undefined,
    codigoPix: r.codigo_pix ?? undefined,
    chavePix: r.chave_pix ?? undefined,
    bancoEmissor: r.banco_emissor ?? undefined,
    fornecedorId: r.fornecedor_id ?? null,
    importBatchId: r.import_batch_id ?? undefined,
    mes: r.mes,
    ano: r.ano,
    mesReferencia:
      r.mes_referencia && /^\d{4}-\d{2}$/.test(r.mes_referencia)
        ? r.mes_referencia
        : `${r.ano}-${String(r.mes).padStart(2, "0")}`,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
  };
}

type TransferenciaInternaRow = {
  id: string;
  descricao: string;
  valor: string | number;
  data: string;
  horario: string | null;
  origem: string | null;
  destino: string | null;
  observacao: string | null;
  origem_importacao: string | null;
  import_batch_id?: string | null;
  id_operacao_banco?: string | null;
  mes: number;
  ano: number;
  created_at: string;
  updated_at: string;
};
function rowToTransferenciaInterna(r: TransferenciaInternaRow): TransferenciaInterna {
  return {
    id: r.id,
    descricao: r.descricao ?? "",
    valor: Number(r.valor),
    data: r.data,
    horario: r.horario ?? undefined,
    origem: r.origem ?? undefined,
    destino: r.destino ?? undefined,
    observacao: r.observacao ?? undefined,
    origemImportacao: r.origem_importacao ?? undefined,
    importBatchId: r.import_batch_id ?? undefined,
    idOperacaoBanco: r.id_operacao_banco ?? undefined,
    mes: r.mes,
    ano: r.ano,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
  };
}

type ExtratoImportadoRow = {
  id: string;
  nome_arquivo: string | null;
  banco: string | null;
  tipo_origem: string;
  data_importacao: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  qtd_movimentacoes: number;
  qtd_duplicadas_ignoradas: number;
  total_receitas: string | number;
  total_despesas: string | number;
  total_guardado: string | number;
  total_transferencias: string | number;
  status: string;
  observacao: string | null;
  reverted_at: string | null;
  created_at: string;
  updated_at: string;
};
function rowToExtratoImportado(r: ExtratoImportadoRow): ExtratoImportado {
  const tipo: TipoOrigemExtrato = r.tipo_origem === "csv" || r.tipo_origem === "imagem" ? r.tipo_origem : "pdf";
  const status: StatusExtratoImportado =
    r.status === "parcial" || r.status === "revertido" || r.status === "erro" ? r.status : "importado";
  return {
    id: r.id,
    nomeArquivo: r.nome_arquivo ?? undefined,
    banco: r.banco ?? undefined,
    tipoOrigem: tipo,
    dataImportacao: r.data_importacao,
    periodoInicio: r.periodo_inicio ?? undefined,
    periodoFim: r.periodo_fim ?? undefined,
    qtdMovimentacoes: r.qtd_movimentacoes ?? 0,
    qtdDuplicadasIgnoradas: r.qtd_duplicadas_ignoradas ?? 0,
    totalReceitas: Number(r.total_receitas ?? 0),
    totalDespesas: Number(r.total_despesas ?? 0),
    totalGuardado: Number(r.total_guardado ?? 0),
    totalTransferencias: Number(r.total_transferencias ?? 0),
    status,
    observacao: r.observacao ?? undefined,
    revertedAt: r.reverted_at ?? undefined,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
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
  if (hydratedUserId === userId && hydrationStatus === "ready") return;
  if (hydrationInFlightPromise && hydrationInFlightUserId === userId) {
    return hydrationInFlightPromise;
  }

  hydrationInFlightUserId = userId;
  hydrationInFlightPromise = (async () => {
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
    const [gastosRes, receitasRes, limitesRes, aprendRes, guardadoRes, movRes, cartoesRes, contasRes, transferenciasRes, extratosRes, faturasRes] = await Promise.all([
      supabase.from("gastos").select("*").eq("user_id", userId),
      supabase.from("receitas").select("*").eq("user_id", userId).is("deleted_at", null),
      supabase.from("limites").select("*").eq("user_id", userId),
      supabase.from("aprendizado_categoria").select("*").eq("user_id", userId),
      supabase.from("dinheiro_guardado").select("*").eq("user_id", userId),
      supabase.from("movimentacoes_meta").select("*").eq("user_id", userId),
      sbAny.from("cartoes").select("*").eq("user_id", userId),
      sbAny.from("contas_a_pagar").select("*").eq("user_id", userId),
      sbAny.from("transferencias_internas").select("*").eq("user_id", userId),
      sbAny.from("extratos_importados").select("*").eq("user_id", userId).order("data_importacao", { ascending: false }),
      sbAny.from("faturas_cartao").select("*").eq("user_id", userId),
    ]);

    if (gastosRes.error) throw gastosRes.error;
    if (receitasRes.error) throw receitasRes.error;
    if (limitesRes.error) throw limitesRes.error;
    if (aprendRes.error) throw aprendRes.error;
    if (guardadoRes.error) throw guardadoRes.error;
    if (movRes.error) throw movRes.error;
    // Tables abaixo são opcionais — apenas avisa, não quebra hidratação.
    if (cartoesRes.error) console.warn("[store] cartoes load warning", cartoesRes.error);
    if (contasRes.error) console.warn("[store] contas_a_pagar load warning", contasRes.error);
    if (transferenciasRes.error) console.warn("[store] transferencias_internas load warning", transferenciasRes.error);
    if (extratosRes.error) console.warn("[store] extratos_importados load warning", extratosRes.error);

    memGastos = normalizeGastosForCalculations(
      (gastosRes.data ?? []).map((r: GastoRow) => rowToGasto(r, catUuidToKey)),
      true,
    );
    memGastos = memGastos.map(applyCategoriaInferida);
    memReceitas = (receitasRes.data ?? []).map((r: ReceitaRow) => rowToReceita(r));
    memLimites = (limitesRes.data ?? []).map((r: LimiteRow) => rowToLimite(r));
    memAprendizado = (aprendRes.data ?? []).map((r: AprendizadoRow) =>
      rowToAprendizado(r, catUuidToKey),
    );
    memGuardado = (guardadoRes.data ?? []).map((r: GuardadoRow) => rowToGuardado(r, bancoUuidToKey, metaUuidToKey));
    memMov = (movRes.data ?? []).map((r: MovMetaRow) => rowToMovMeta(r, metaUuidToKey, bancoUuidToKey));
    memCartoes = (cartoesRes.error ? [] : (cartoesRes.data ?? [])).map(
      (r: CartaoRow) => rowToCartao(r),
    );
    memContas = (contasRes.error ? [] : (contasRes.data ?? [])).map(
      (r: ContaAPagarRow) => rowToContaAPagar(r, catUuidToKey),
    );
    memTransferencias = (transferenciasRes.error ? [] : (transferenciasRes.data ?? [])).map(
      (r: TransferenciaInternaRow) => rowToTransferenciaInterna(r),
    );
    memExtratos = (extratosRes.error ? [] : (extratosRes.data ?? [])).map(
      (r: ExtratoImportadoRow) => rowToExtratoImportado(r),
    );
    if (faturasRes.error) {
      console.warn("[store] faturas_cartao load warning", faturasRes.error);
      memFaturas = [];
    } else {
      memFaturas = (faturasRes.data ?? []).map(rowToFatura);
    }

    hydratedUserId = userId;
    setHydrationStatus("ready");

    // Backfill em background: recupera lotes antigos que foram importados
    // antes do sistema de batch existir. Não bloqueia hidratação.
    void backfillExtratosImportados().catch((err) => {
      console.warn("[store] backfillExtratosImportados failed", err);
    });
    void reclassificarCategoriasExistentes().catch((err) => {
      console.warn("[store] reclassificarCategoriasExistentes failed", err);
    });
    } catch (e) {
      console.error("[store] hydrateUser failed", e);
      setHydrationStatus("error");
    } finally {
      if (hydrationInFlightUserId === userId) {
        hydrationInFlightUserId = null;
        hydrationInFlightPromise = null;
      }
    }
  })();

  return hydrationInFlightPromise;
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
/** Normaliza nome de categoria: lowercase, sem acentos, sem espaços extras. */
function normalizeCategoriaNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// Cache estável da lista deduplicada — invalida quando a referência de
// memCategorias muda (toda mutação reatribui o array). Sem cache, o array
// retornado seria novo a cada render e quebraria useSyncExternalStore com
// "Maximum update depth exceeded".
let _categoriasCacheSource: Categoria[] | null = null;
let _categoriasCacheResult: Categoria[] = [];
export function getCategorias(): Categoria[] {
  if (_categoriasCacheSource === memCategorias) return _categoriasCacheResult;
  const seen = new Map<string, Categoria>();
  for (const c of memCategorias) {
    const key = normalizeCategoriaNome(c.nome);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, c);
      continue;
    }
    if (existing.criadaPeloUsuario && !c.criadaPeloUsuario) {
      seen.set(key, c);
    }
  }
  _categoriasCacheSource = memCategorias;
  _categoriasCacheResult = Array.from(seen.values());
  return _categoriasCacheResult;
}

/** Verifica se já existe categoria com nome equivalente (ignorando case/acentos). */
export function findCategoriaByNomeNormalizado(nome: string): Categoria | undefined {
  const key = normalizeCategoriaNome(nome);
  return memCategorias.find((c) => normalizeCategoriaNome(c.nome) === key);
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
export function getTransferenciasInternas(): TransferenciaInterna[] {
  return memTransferencias;
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

// ---------- Cartões ----------
export function getCartoes(): Cartao[] {
  return memCartoes;
}
export function getCartaoById(id: string): Cartao | undefined {
  return memCartoes.find((c) => c.id === id);
}

export type NovoCartaoInput = {
  nome: string;
  banco: string;
  limiteTotal: number;
  diaFechamento: number;
  diaVencimento: number;
  cor: string;
  observacao?: string;
};

export function addCartao(input: NovoCartaoInput): Cartao | null {
  // Fase 1E-B2J-B — cartões básicos liberados para free_ads + planos pagos.
  // Quota (1 cartão para free_ads) é enforçada server-side pelo trigger
  // `tg_free_ads_quota_cartoes`.
  if (!ensureCanWrite("addCartao", { allowBasic: true })) return null;
  const now = new Date().toISOString();
  const id = activeUserId ? crypto.randomUUID() : uid();
  const novo: Cartao = {
    id,
    nome: input.nome.trim(),
    banco: input.banco.trim(),
    limiteTotal: input.limiteTotal,
    diaFechamento: input.diaFechamento,
    diaVencimento: input.diaVencimento,
    cor: input.cor,
    observacao: input.observacao?.trim() || undefined,
    criadoEm: now,
    atualizadoEm: now,
  };
  const prev = memCartoes;
  memCartoes = [...memCartoes, novo];
  emit();
  if (!activeUserId) return novo;
  void sbAny
    .from("cartoes")
    .insert({
      id,
      user_id: activeUserId,
      nome: novo.nome,
      banco: novo.banco,
      limite_total: novo.limiteTotal,
      dia_fechamento: novo.diaFechamento,
      dia_vencimento: novo.diaVencimento,
      cor: novo.cor,
      observacao: novo.observacao ?? null,
    })
    .then(({ error }: { error: { code?: string; message: string } | null }) => {
      if (error) {
        memCartoes = prev;
        emit();
        if (!handleFreeAdsQuotaError(error)) {
          console.error("[store] addCartao failed", error);
        }
      }
    });
  return novo;
}

export function updateCartao(id: string, patch: Partial<NovoCartaoInput>) {
  if (!ensureCanWrite("updateCartao", { allowBasic: true })) return;
  const now = new Date().toISOString();
  const prev = memCartoes;
  memCartoes = memCartoes.map((c) =>
    c.id === id ? { ...c, ...patch, atualizadoEm: now } : c,
  );
  emit();
  if (!activeUserId) return;
  const row: Record<string, unknown> = {};
  if (patch.nome !== undefined) row.nome = patch.nome;
  if (patch.banco !== undefined) row.banco = patch.banco;
  if (patch.limiteTotal !== undefined) row.limite_total = patch.limiteTotal;
  if (patch.diaFechamento !== undefined) row.dia_fechamento = patch.diaFechamento;
  if (patch.diaVencimento !== undefined) row.dia_vencimento = patch.diaVencimento;
  if (patch.cor !== undefined) row.cor = patch.cor;
  if (patch.observacao !== undefined) row.observacao = patch.observacao ?? null;
  void sbAny
    .from("cartoes")
    .update(row)
    .eq("id", id)
    .then(({ error }: { error: { code?: string; message: string } | null }) => {
      if (error) {
        memCartoes = prev;
        emit();
        if (!handleFreeAdsQuotaError(error)) {
          console.error("[store] updateCartao failed", error);
        }
      }
    });
}

export function deleteCartao(id: string) {
  if (!ensureCanWrite("deleteCartao", { allowBasic: true })) return;
  const prev = memCartoes;
  memCartoes = memCartoes.filter((c) => c.id !== id);
  emit();
  if (!activeUserId) return;
  void sbAny
    .from("cartoes")
    .delete()
    .eq("id", id)
    .then(({ error }: { error: { code?: string; message: string } | null }) => {
      if (error) {
        memCartoes = prev;
        emit();
        console.error("[store] deleteCartao failed", error);
      }
    });
}

/**
 * Calcula resumo de uso do cartão na fatura ABERTA (ciclo atual de faturamento).
 *
 * Considera todos os gastos no crédito vinculados ao cartão cuja data está
 * dentro do ciclo aberto: do dia seguinte ao último fechamento até o próximo
 * fechamento. Quando o cartão não tem `diaFechamento` definido, faz fallback
 * para o mês civil corrente.
 *
 * Isso garante que gastos importados de faturas (com datas no mês anterior
 * ao mês corrente, ainda dentro do ciclo aberto) entrem no "usado".
 */
export function resumoFaturaCartao(cartaoId: string, hoje: Date = new Date()) {
  const cartao = memCartoes.find((c) => c.id === cartaoId);
  const analisados = normalizeGastosForCalculations(memGastos);
  const gastosCartao = analisados.filter(
    (g) => gastoCartaoId(g) === cartaoId && g.formaPagamento === "credito" && g.confirmado !== false,
  );

  let inicio: Date;
  let fim: Date;
  const diaFech = cartao?.diaFechamento;
  if (diaFech && diaFech > 0) {
    // Ciclo aberto: (último fechamento, próximo fechamento]
    const hojeDia = hoje.getDate();
    const y = hoje.getFullYear();
    const m = hoje.getMonth();
    if (hojeDia > diaFech) {
      // Já fechou este mês → ciclo aberto vai até o fechamento do próximo mês.
      inicio = new Date(y, m, diaFech + 1);
      fim = new Date(y, m + 1, diaFech, 23, 59, 59, 999);
    } else {
      // Ainda não fechou este mês → ciclo aberto começou no mês passado.
      inicio = new Date(y, m - 1, diaFech + 1);
      fim = new Date(y, m, diaFech, 23, 59, 59, 999);
    }
  } else {
    // Fallback: mês civil corrente.
    inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  // Mês de referência (compras) da fatura ABERTA — identifica gastos com
  // invoice_month explícito. Se hoje já passou do dia de fechamento, o
  // ciclo aberto começou neste mês; senão, começou no mês anterior.
  const diaFechRef = diaFech && diaFech > 0 ? diaFech : 0;
  let refY = hoje.getFullYear();
  let refM0 = hoje.getMonth();
  if (diaFechRef && hoje.getDate() <= diaFechRef) {
    refM0 -= 1;
    if (refM0 < 0) { refM0 = 11; refY -= 1; }
  }
  const currentYm = `${refY}-${String(refM0 + 1).padStart(2, "0")}`;
  const considerados = gastosCartao.filter((g) => {
    if (g.invoiceMonth && /^\d{4}-\d{2}$/.test(g.invoiceMonth)) {
      // Fonte da verdade: o usuário decidiu o mês da fatura.
      return g.invoiceMonth === currentYm;
    }
    const d = parseDateLocal(g.data);
    return !!d && d >= inicio && d <= fim;
  });
  const usadoMes = considerados.reduce((s, g) => s + g.valor, 0);

  const limite = cartao?.limiteTotal ?? 0;
  if (typeof window !== "undefined" && window.localStorage.getItem("gf:debug-finance") === "1") {
    const ignorados = analisados
      .filter((g) => gastoCartaoId(g) === cartaoId || isImportadoOuFatura(g))
      .filter((g) => !considerados.some((c) => c.id === g.id))
      .map((g) => ({
        id: g.id,
        descricao: g.descricao,
        valor: g.valor,
        data: g.data,
        formaPagamento: g.formaPagamento,
        cartaoId: gastoCartaoId(g),
        origem: g.origem,
        confirmado: g.confirmado,
        motivo:
          gastoCartaoId(g) !== cartaoId
            ? "outro cartão/sem cartão"
            : g.formaPagamento !== "credito"
              ? "forma diferente de credito"
              : g.confirmado === false
                ? "não confirmado"
                : "fora do ciclo atual",
      }));
    console.info("[financeiro:cartao] resumo", {
      cartaoId,
      nome: cartao?.nome,
      totalAnalisados: analisados.length,
      inicio: toLocalISODate(inicio),
      fim: toLocalISODate(fim),
      considerados,
      ignorados,
      usadoMes,
      disponivel: Math.max(0, limite - usadoMes),
    });
  }

  return {
    usadoMes,
    limite,
    disponivel: Math.max(0, limite - usadoMes),
    pct: limite > 0 ? Math.min(100, (usadoMes / limite) * 100) : 0,
  };
}

// ============================================================
// MUTATIONS — Supabase entities
// Optimistic updates: change in-memory cache + emit + write to Supabase.
// On error, refresh from server.
// ============================================================

function categoriaUuidFor(key: string): string | null {
  return categoriaKeyToUuid.get(key) ?? null;
}

function categoriaKeyFromUuid(uuid: string | null | undefined): string {
  if (!uuid) return "outros";
  const categoria = memCategorias.find((c) => categoriaKeyToUuid.get(c.id) === uuid || c.id === uuid);
  return categoria?.id ?? uuid;
}

function inferCategoriaForGasto(g: Pick<Gasto, "descricao" | "estabelecimento" | "observacao">): string {
  return suggestCategoryFromText(`${g.estabelecimento ?? ""} ${g.descricao ?? ""} ${g.observacao ?? ""}`.trim());
}

function applyCategoriaInferida(g: Gasto): Gasto {
  const categoriaId = inferCategoriaForGasto(g);
  return categoriaId && categoriaId !== "outros" && categoriaId !== g.categoriaId ? { ...g, categoriaId } : g;
}

export async function reclassificarCategoriasExistentes(): Promise<number> {
  if (!activeUserId) return 0;
  const userId = activeUserId;
  const { data, error } = await supabase.from("gastos").select("*").eq("user_id", userId);
  if (error || !data) {
    if (error) console.error("[store] reclassificarCategoriasExistentes load failed", error);
    return 0;
  }

  const updates = (data as GastoRow[]).flatMap((row) => {
    const categoriaKey = suggestCategoryFromText(
      `${row.estabelecimento ?? ""} ${row.descricao ?? ""} ${row.observacao ?? ""}`.trim(),
    );
    if (!categoriaKey || categoriaKey === "outros") return [];
    const categoriaUuid = categoriaUuidFor(categoriaKey);
    if (!categoriaUuid || categoriaUuid === row.categoria_id) return [];
    return [{ id: row.id, categoriaKey, categoriaUuid }];
  });

  if (updates.length === 0) return 0;

  const results = await Promise.all(
    updates.map(({ id, categoriaUuid }) =>
      supabase.from("gastos").update({ categoria_id: categoriaUuid }).eq("id", id).eq("user_id", userId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) console.error("[store] reclassificarCategoriasExistentes update failed", failed.error);

  const successIds = new Set(updates.filter((_, idx) => !results[idx].error).map((u) => u.id));
  memGastos = memGastos.map((g) => {
    if (!successIds.has(g.id)) return g;
    const update = updates.find((u) => u.id === g.id);
    return update ? { ...g, categoriaId: update.categoriaKey, atualizadoEm: new Date().toISOString() } : g;
  });
  emit();
  void refreshGastos();
  return successIds.size;
}

export async function refreshGastos() {
  if (!activeUserId) return;
  const { data } = await supabase.from("gastos").select("*").eq("user_id", activeUserId);
  if (!data) return;
  const catUuidToKey = new Map<string, string>();
  for (const [key, uuid] of categoriaKeyToUuid.entries()) catUuidToKey.set(uuid, key);
  memGastos = normalizeGastosForCalculations(
    data.map((r: GastoRow) => rowToGasto(r, catUuidToKey)),
    true,
  );
  memGastos = memGastos.map(applyCategoriaInferida);
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
  parcelaAtual?: number;
  totalParcelas?: number;
  recorrenteMeses?: number;
  essencial?: boolean;
  gastoFixo?: boolean;
  cartaoId?: string;
  /**
   * Mês de referência (YYYY-MM). Define a competência financeira do gasto,
   * independente da data de lançamento, pagamento ou vencimento.
   */
  invoiceMonth?: string;
  /** Horário opcional (HH:mm). */
  horario?: string;
  /** Origem do registro: manual, fatura_imagem, fatura_csv. */
  origem?: string;
  /** Lote de importação ao qual esse gasto pertence (extrato bancário). */
  importBatchId?: string;
  /** ID da operação no banco. */
  idOperacaoBanco?: string;
  /** ID do fornecedor vinculado (opcional). */
  fornecedorId?: string | null;
};

function buildGastosFromInput(input: NovoGastoInput, userId: string): { row: GastoInsert; client: Gasto }[] {
  const now = new Date().toISOString();
  const isFaturaImport = !!input.origem?.toLowerCase().includes("fatura");
  const inputData = isFaturaImport
    ? normalizeInvoiceDateIfNeeded(input.data, new Date(), true)
    : toLocalISODate(parseDateLocal(input.data) ?? new Date(input.data + "T00:00:00"));
  const baseDate = parseDateLocal(inputData) ?? new Date();
  const tipo = input.tipoGasto ?? "unico";
  const fixoFlag = input.gastoFixo ?? tipo === "recorrente";
  // Auto-categorização: se vier "outros" ou vazio, tenta inferir pelo nome/estabelecimento.
  if (!input.categoriaId || input.categoriaId === "outros") {
    const guess = inferCategoriaForGasto({
      estabelecimento: input.estabelecimento ?? "",
      descricao: input.descricao ?? "",
      observacao: input.observacao,
    });
    if (guess && guess !== "outros") input = { ...input, categoriaId: guess };
  }
  const catUuid = categoriaUuidFor(input.categoriaId);
  const horarioVal = input.horario && input.horario.trim() ? input.horario.trim() : null;
  const origemVal = input.origem && input.origem.trim() ? input.origem.trim() : null;
  const out: { row: GastoInsert; client: Gasto }[] = [];

  if (tipo === "parcelado" && (input.totalParcelas ?? 0) > 1 && (input.parcelaAtual ?? 0) > 0) {
    const total = input.totalParcelas!;
    const parcelaAtual = Math.min(total, Math.max(1, Math.floor(input.parcelaAtual!)));
    const id = crypto.randomUUID();
    out.push({
      row: {
        id,
        user_id: userId,
        categoria_id: catUuid,
        descricao: input.descricao || input.estabelecimento || "Gasto",
        valor: input.valor,
        data: inputData,
        estabelecimento: input.estabelecimento || "",
        forma_pagamento: input.formaPagamento,
        observacao: input.observacao ?? null,
        imagem_url: input.imagemUrl ?? null,
        mes: baseDate.getMonth() + 1,
        ano: baseDate.getFullYear(),
        confirmado: true,
        tipo_gasto: "parcelado",
        parcela_atual: parcelaAtual,
        total_parcelas: total,
        grupo_parcelamento_id: null,
        essencial: input.essencial ?? null,
        gasto_fixo: input.gastoFixo ?? null,
        cartao_id: input.cartaoId ?? null,
      },
      client: {
        id,
        descricao: input.descricao || input.estabelecimento || "Gasto",
        valor: input.valor,
        data: inputData,
        estabelecimento: input.estabelecimento || "",
        categoriaId: input.categoriaId,
        formaPagamento: input.formaPagamento,
        observacao: input.observacao,
        imagemUrl: input.imagemUrl,
        mes: baseDate.getMonth() + 1,
        ano: baseDate.getFullYear(),
        confirmado: true,
        tipoGasto: "parcelado",
        parcelaAtual,
        totalParcelas: total,
        essencial: input.essencial,
        gastoFixo: input.gastoFixo,
        cartaoId: input.cartaoId,
        criadoEm: now,
        atualizadoEm: now,
      },
    });
  } else if (tipo === "parcelado" && (input.totalParcelas ?? 0) > 1) {
    const total = input.totalParcelas!;
    const valorParcela = Math.round((input.valor / total) * 100) / 100;
    const grupo = crypto.randomUUID();
    for (let i = 0; i < total; i++) {
      const d = addMonthsPreservingDay(baseDate, i);
      const iso = toLocalISODate(d);
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
          cartao_id: input.cartaoId ?? null,
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
          cartaoId: input.cartaoId,
          criadoEm: now,
          atualizadoEm: now,
        },
      });
    }
  } else if (tipo === "recorrente") {
    const meses = Math.max(1, input.recorrenteMeses ?? 12);
    const recId = crypto.randomUUID();
    for (let i = 0; i < meses; i++) {
      const d = addMonthsPreservingDay(baseDate, i);
      const iso = toLocalISODate(d);
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
          cartao_id: input.cartaoId ?? null,
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
          cartaoId: input.cartaoId,
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
        data: inputData,
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
        cartao_id: input.cartaoId ?? null,
      },
      client: {
        id,
        descricao: input.descricao || input.estabelecimento || "Gasto",
        valor: input.valor,
        data: inputData,
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
        cartaoId: input.cartaoId,
        criadoEm: now,
        atualizadoEm: now,
      },
    });
  }
  // Stamp horario/origem/importBatch/invoiceMonth on every produced row + client (fields are optional).
  const batchId = input.importBatchId && input.importBatchId.trim() ? input.importBatchId.trim() : null;
  const opId = input.idOperacaoBanco && input.idOperacaoBanco.trim() ? input.idOperacaoBanco.trim() : null;
  const invoiceMonthVal =
    input.invoiceMonth && /^\d{4}-\d{2}$/.test(input.invoiceMonth)
      ? input.invoiceMonth
      : null;
  const fornecedorVal =
    input.fornecedorId && input.fornecedorId.trim() ? input.fornecedorId.trim() : null;
  for (const o of out) {
    type ExtraCols = GastoInsert & {
      horario?: string | null;
      origem?: string | null;
      import_batch_id?: string | null;
      id_operacao_banco?: string | null;
      invoice_month?: string | null;
      fornecedor_id?: string | null;
    };
    (o.row as ExtraCols).horario = horarioVal;
    (o.row as ExtraCols).origem = origemVal;
    (o.row as ExtraCols).import_batch_id = batchId;
    (o.row as ExtraCols).id_operacao_banco = opId;
    const fallbackInvoiceMonth = `${o.client.ano}-${String(o.client.mes).padStart(2, "0")}`;
    const resolvedInvoiceMonth = invoiceMonthVal ?? fallbackInvoiceMonth;
    (o.row as ExtraCols).invoice_month = resolvedInvoiceMonth;
    (o.row as ExtraCols).fornecedor_id = fornecedorVal;
    if (horarioVal) o.client.horario = horarioVal;
    if (origemVal) o.client.origem = origemVal;
    if (batchId) o.client.importBatchId = batchId;
    if (opId) o.client.idOperacaoBanco = opId;
    o.client.invoiceMonth = resolvedInvoiceMonth;
    if (fornecedorVal) o.client.fornecedorId = fornecedorVal;
  }
  return out;
}

export function addGasto(input: NovoGastoInput): Gasto[] {
  if (!activeUserId) return [];
  // Gasto manual é feature básica (gastos_basico): aceita free_ads também.
  // Quota mensal de free_ads é validada server-side por trigger.
  if (!ensureCanWrite("addGasto", { allowBasic: true })) return [];
  return addGastoUnchecked(input);
}

/**
 * Versão que NÃO aplica `ensureCanWrite` — destinada a efeitos colaterais
 * automáticos de fluxos que já são liberados no plano free (ex.: criar
 * gasto a partir de uma compra finalizada pelo Mercado Inteligente).
 *
 * O guard de assinatura existe para bloquear criação MANUAL na aba Gastos.
 * Quando o usuário conclui uma ação de um módulo liberado, a escrita
 * derivada não deve ser silenciosamente engolida pelo guard.
 *
 * Continua exigindo `activeUserId` (RLS server-side é o limite real).
 */
export function addGastoAuto(input: NovoGastoInput): Gasto[] {
  if (!activeUserId) return [];
  return addGastoUnchecked(input);
}

function addGastoUnchecked(input: NovoGastoInput): Gasto[] {
  const built = buildGastosFromInput(input, activeUserId!);
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
        const quota = handleFreeAdsQuotaError(error);
        if (!quota) console.error("[store] addGasto failed", error);
        void refreshGastos();
      }
    });
  if (input.estabelecimento) {
    rememberCategoryFor(input.estabelecimento, input.categoriaId);
  }
  return created;
}


/**
 * Versão assíncrona usada pela fila offline: insere no Supabase e aguarda
 * confirmação. Só retorna `{ ok: true }` se o servidor aceitou — isso
 * permite remover o item da fila offline com segurança.
 *
 * Quando `offlineClientId` é informado, ele vai como `offline_client_id`
 * no insert. Há um índice único parcial em `(user_id, offline_client_id)`
 * — se já existir um gasto com esse par, o Postgres retorna 23505 e
 * tratamos como `ok: true, duplicate: true` (idempotente).
 */
export async function addGastoAwait(
  input: NovoGastoInput,
  userId: string,
  offlineClientId?: string,
): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  if (!userId) return { ok: false, error: "no_user" };
  const previousActive = activeUserId;
  if (activeUserId !== userId) activeUserId = userId;
  let built;
  try {
    built = buildGastosFromInput(input, userId);
  } finally {
    if (activeUserId !== previousActive) activeUserId = previousActive;
  }
  const rows = built.map((b) => {
    const row = b.row as GastoInsert & { offline_client_id?: string | null };
    if (offlineClientId) row.offline_client_id = offlineClientId;
    return row;
  });
  const { error } = await supabase.from("gastos").insert(rows);
  if (error) {
    // 23505 = unique_violation. Pelo índice parcial, isso só ocorre quando
    // o mesmo (user_id, offline_client_id) já foi gravado em uma tentativa
    // anterior. Idempotente: considera sucesso e deixa a fila remover.
    const code = (error as { code?: string }).code;
    const msg = error.message ?? "";
    if (code === "23505" || /duplicate key|unique/i.test(msg)) {
      return { ok: true, duplicate: true };
    }
    return { ok: false, error: error.message };
  }
  if (activeUserId === userId) {
    memGastos = [...memGastos, ...built.map((b) => b.client)];
    emit();
    if (input.estabelecimento) rememberCategoryFor(input.estabelecimento, input.categoriaId);
  }
  return { ok: true };
}

/**
 * Insere múltiplos gastos em uma única chamada (importação de fatura).
 * Faz update otimista e sincroniza com o Supabase em background.
 */
export function addGastosBulk(inputs: NovoGastoInput[]): Gasto[] {
  if (!activeUserId || inputs.length === 0) return [];
  if (!ensureCanWrite("addGastosBulk")) return [];
  const uniqueInputs = inputs.filter((inp, index, arr) => {
    const desc = inp.descricao || inp.estabelecimento || "";
    const key = `${inp.cartaoId ?? ""}|${inp.data}|${desc.trim().toLowerCase()}|${inp.valor.toFixed(2)}`;
    const firstIndex = arr.findIndex((other) => {
      const otherDesc = other.descricao || other.estabelecimento || "";
      const otherKey = `${other.cartaoId ?? ""}|${other.data}|${otherDesc.trim().toLowerCase()}|${other.valor.toFixed(2)}`;
      return otherKey === key;
    });
    if (firstIndex !== index) return false;
    // Dedup contra a base local só se NÃO vier de extrato (que já fez dedup avançado por idOperacao no Dialog).
    if (inp.importBatchId || inp.idOperacaoBanco) return true;
    return !findPossibleDuplicate(inp.valor, inp.data, desc, inp.cartaoId);
  });
  if (uniqueInputs.length === 0) return [];
  const allBuilt = uniqueInputs.flatMap((inp) => buildGastosFromInput(inp, activeUserId!));
  const created = allBuilt.map((b) => b.client);
  memGastos = [...memGastos, ...created];
  emit();
  void supabase
    .from("gastos")
    .insert(allBuilt.map((b) => b.row))
    .then(({ error }) => {
      if (error) {
        console.error("[store] addGastosBulk failed", error);
        void refreshGastos();
      }
    });
  for (const inp of inputs) {
    if (inp.estabelecimento) {
      rememberCategoryFor(inp.estabelecimento, inp.categoriaId);
    }
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
  if (patch.cartaoId !== undefined) row.cartao_id = patch.cartaoId ?? null;
  if (patch.invoiceMonth !== undefined)
    (row as GastoUpdate & { invoice_month?: string | null }).invoice_month =
      patch.invoiceMonth && /^\d{4}-\d{2}$/.test(patch.invoiceMonth) ? patch.invoiceMonth : null;
  if (patch.horario !== undefined)
    (row as GastoUpdate & { horario?: string | null }).horario = patch.horario ?? null;
  if (patch.origem !== undefined)
    (row as GastoUpdate & { origem?: string | null }).origem = patch.origem ?? null;
  if (patch.fornecedorId !== undefined)
    (row as GastoUpdate & { fornecedor_id?: string | null }).fornecedor_id =
      patch.fornecedorId ?? null;

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

  // Se este gasto estava vinculado a uma conta paga, limpa o vínculo e
  // devolve a conta para "pendente". Sem isso, a conta ficaria como paga
  // apontando para um gasto que não existe mais — divergência entre
  // Contas a pagar e Gastos / Dashboard / Relatórios.
  const contasVinculadas = memContas.filter((c) => c.gastoId === id);
  if (contasVinculadas.length > 0) {
    memContas = memContas.map((c) =>
      c.gastoId === id
        ? {
            ...c,
            status: "pendente",
            dataPagamento: undefined,
            gastoId: undefined,
            atualizadoEm: new Date().toISOString(),
          }
        : c,
    );
    void sbAny
      .from("contas_a_pagar")
      .update({ status: "pendente", data_pagamento: null, gasto_id: null })
      .in(
        "id",
        contasVinculadas.map((c) => c.id),
      )
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error("[store] deleteGasto: cleanup conta vinculada failed", error);
      });
  }

  emit();
  // Resolve alertas órfãos vinculados a este gasto (ex: duplicidade).
  void resolveAlertasDe("gasto", id);
  // Se este gasto representava a fatura/conta paga, resolve esses alertas
  // também — a pendência deixou de existir.
  for (const c of contasVinculadas) {
    void resolveAlertasDe("conta_a_pagar", c.id);
  }
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
  cartaoId?: string,
): Gasto | undefined {
  return memGastos.find(
    (g) =>
      Math.abs(g.valor - valor) < 0.01 &&
      g.data === data &&
      (cartaoId ? g.cartaoId === cartaoId : true) &&
      (estabelecimento
        ? [g.estabelecimento, g.descricao]
            .filter(Boolean)
            .some((text) => text.trim().toLowerCase() === estabelecimento.trim().toLowerCase())
        : true),
  );
}

/* ============================================================
 * DEDUP AVANÇADA — usado pelos importadores (imagem, PDF, CSV).
 *
 * Regra "equilibrada":
 *   - mesmo cartão (quando informado);
 *   - mesmo valor (tolerância ±R$ 0,01);
 *   - data dentro de janela de ±1 dia;
 *   - descrição/estabelecimento com similaridade alta após normalização;
 *   - se ambos tiverem horário, exige <= 5 minutos de diferença para
 *     reforçar match (mas a ausência de horário não bloqueia).
 *
 * Devolve o gasto existente que casou, ou undefined.
 * ============================================================ */

export function normalizeDescricao(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(ltda|me|sa|s\/a|eireli|brasil|br)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function descSimilarity(a: string, b: string): number {
  const na = normalizeDescricao(a);
  const nb = normalizeDescricao(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Jaccard sobre tokens
  const sa = new Set(na.split(" ").filter((t) => t.length >= 3));
  const sb = new Set(nb.split(" ").filter((t) => t.length >= 3));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function diffDays(a: string, b: string): number {
  const da = parseDateLocal(a);
  const db = parseDateLocal(b);
  if (!da || !db) return Number.POSITIVE_INFINITY;
  return Math.abs((da.getTime() - db.getTime()) / 86_400_000);
}

function diffMinutes(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const ma = a.match(/^(\d{1,2}):(\d{2})$/);
  const mb = b.match(/^(\d{1,2}):(\d{2})$/);
  if (!ma || !mb) return Number.POSITIVE_INFINITY;
  return Math.abs(
    parseInt(ma[1], 10) * 60 + parseInt(ma[2], 10) - (parseInt(mb[1], 10) * 60 + parseInt(mb[2], 10)),
  );
}

export type DedupCandidato = {
  valor: number;
  data: string;
  descricao?: string;
  estabelecimento?: string;
  cartaoId?: string;
  horario?: string;
};

/**
 * Versão avançada do `findPossibleDuplicate`. Procura na base local de gastos
 * uma entrada com forte indício de ser o mesmo lançamento. Aceita janela de
 * ±1 dia e usa horário como reforço quando disponível.
 */
export function findDuplicateGastoAdvanced(c: DedupCandidato): Gasto | undefined {
  const desc = c.descricao || c.estabelecimento || "";
  return memGastos.find((g) => {
    if (Math.abs(g.valor - c.valor) > 0.01) return false;
    if (c.cartaoId && g.cartaoId && g.cartaoId !== c.cartaoId) return false;
    const dDays = diffDays(g.data, c.data);
    if (dDays > 1) return false;

    const gDesc = g.estabelecimento || g.descricao || "";
    const sim = descSimilarity(desc, gDesc);
    // Sem descrição informada → exige data exata
    if (!desc) return dDays === 0;

    if (sim >= 0.7) return true;

    // Reforço por horário muito próximo no mesmo dia
    if (dDays === 0 && diffMinutes(g.horario, c.horario) <= 5 && sim >= 0.4) {
      return true;
    }
    return false;
  });
}

// ---------- Categorias ----------
export function addCategoria(c: Omit<Categoria, "id" | "criadaPeloUsuario">): Categoria {
  // Bloqueia duplicata por nome normalizado — devolve a existente
  const existente = findCategoriaByNomeNormalizado(c.nome);
  if (existente) return existente;

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
  // Fase 1E-B2I — orçamento básico liberado para free_ads + planos pagos.
  // Quota (1 orçamento para free_ads) é enforçada server-side pelo trigger
  // `tg_free_ads_quota_limites`.
  if (!ensureCanWrite("setLimite", { allowBasic: true })) return;
  const prev = memLimites;
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
      if (error) {
        // Rollback otimista em caso de quota/erro
        memLimites = prev;
        emit();
        if (!handleFreeAdsQuotaError(error)) {
          console.error("[store] setLimite failed", error);
        }
      }
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
  clienteId?: string | null;
};

export async function addReceita(input: NovaReceitaInput): Promise<Receita[]> {
  if (!activeUserId) return [];
  if (input.recorrente && !canWriteFinancial) {
    if (canWriteBasicFinancial && typeof window !== "undefined") {
      void import("sonner").then(({ toast }) => {
        toast.error("Receitas recorrentes estão disponíveis nos planos pagos.");
      });
    } else {
      ensureCanWrite("addReceita recorrente");
    }
    throw new Error("Receitas recorrentes estão disponíveis nos planos pagos.");
  }
  if (!ensureCanWrite("addReceita", { allowBasic: true })) {
    throw new Error("Você precisa de uma assinatura ativa para usar este recurso.");
  }
  const amount = validateFinancialAmount(input.valor);
  if (!amount.ok) {
    const msg = financialAmountMessage(amount.code);
    if (typeof window !== "undefined") {
      void import("sonner").then(({ toast }) => toast.error(msg));
    }
    throw new Error(msg);
  }
  input = { ...input, valor: amount.value };
  const now = new Date().toISOString();
  const baseDate = new Date(input.data + "T00:00:00");
  const created: Receita[] = [];
  const rows: ReceitaInsert[] = [];
  const clienteId = input.clienteId ?? null;

  if (input.recorrente) {
    const meses = Math.max(1, input.recorrenteMeses ?? 12);
    const recId = crypto.randomUUID();
    for (let i = 0; i < meses; i++) {
      const d = addMonthsPreservingDay(baseDate, i);
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
        clienteId,
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
        ...(clienteId ? { cliente_id: clienteId } : {}),
      } as ReceitaInsert);
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
      clienteId,
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
      ...(clienteId ? { cliente_id: clienteId } : {}),
    } as ReceitaInsert);
  }
  // Aplica otimisticamente para UI responsiva, mas aguarda o insert e
  // reverte se houver falha — evita toast de sucesso silencioso quando
  // RLS, quota ou trigger rejeita a operação.
  memReceitas = [...memReceitas, ...created];
  emit();
  const createdIds = new Set(created.map((c) => c.id));
  const { error } = await supabase.from("receitas").insert(rows);
  if (error) {
    memReceitas = memReceitas.filter((r) => !createdIds.has(r.id));
    emit();
    const quota = handleFreeAdsQuotaError(error);
    if (!quota) {
      console.error("[store] addReceita failed", error);
      if (typeof window !== "undefined") {
        void import("sonner").then(({ toast }) => {
          toast.error(error.message || "Não foi possível salvar a receita.");
        });
      }
    }
    throw new Error(error.message || "addReceita failed");
  }
  return created;
}

/**
 * Versão aguardável de `addReceita` para a fila offline.
 *
 * Quando `offlineClientId` é informado, ele vai como `offline_client_id`
 * no insert. Há um índice único parcial em `(user_id, offline_client_id)`
 * — se já existir, o Postgres retorna 23505 e tratamos como
 * `ok: true, duplicate: true` (idempotente).
 *
 * Não aplica recorrência: a fila offline cobre apenas receita única.
 */
export async function addReceitaAwait(
  input: NovaReceitaInput,
  userId: string,
  offlineClientId?: string,
): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  if (!userId) return { ok: false, error: "no_user" };
  const amountAwait = validateFinancialAmount(input.valor);
  if (!amountAwait.ok) {
    return { ok: false, error: financialAmountMessage(amountAwait.code) };
  }
  input = { ...input, valor: amountAwait.value };
  const baseDate = new Date(input.data + "T00:00:00");
  const id = crypto.randomUUID();
  const clienteId = input.clienteId ?? null;
  const row: ReceitaInsert & { offline_client_id?: string | null } = {
    id,
    user_id: userId,
    descricao: input.descricao,
    valor: input.valor,
    data: input.data,
    tipo: input.tipo,
    recorrente: false,
    mes: baseDate.getMonth() + 1,
    ano: baseDate.getFullYear(),
    ...(clienteId ? { cliente_id: clienteId } : {}),
  } as ReceitaInsert & { offline_client_id?: string | null };
  if (offlineClientId) row.offline_client_id = offlineClientId;

  const { error } = await supabase.from("receitas").insert(row);
  if (error) {
    const code = (error as { code?: string }).code;
    const msg = error.message ?? "";
    if (code === "23505" || /duplicate key|unique/i.test(msg)) {
      return { ok: true, duplicate: true };
    }
    return { ok: false, error: error.message };
  }
  if (activeUserId === userId) {
    const now = new Date().toISOString();
    memReceitas = [
      ...memReceitas,
      {
        id,
        descricao: input.descricao,
        valor: input.valor,
        data: input.data,
        tipo: input.tipo,
        recorrente: false,
        mes: baseDate.getMonth() + 1,
        ano: baseDate.getFullYear(),
        clienteId,
        criadoEm: now,
        atualizadoEm: now,
      },
    ];
    emit();
  }
  return { ok: true };
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

/* ============================================================
 * BULK / DEDUP — RECEITAS
 * Usado pela importação de extrato bancário.
 * ============================================================ */

export type NovaReceitaBulkInput = {
  descricao: string;
  valor: number;
  data: string; // YYYY-MM-DD
  tipo: TipoReceita;
  horario?: string;
  origem?: string;
  importBatchId?: string;
  idOperacaoBanco?: string;
};

/** Insere várias receitas de uma vez (sem recorrência). */
export function addReceitasBulk(inputs: NovaReceitaBulkInput[]): Receita[] {
  if (!activeUserId || inputs.length === 0) return [];
  const now = new Date().toISOString();
  const created: Receita[] = [];
  const rows: ReceitaInsert[] = [];

  for (const inp of inputs) {
    const dataIso =
      /^\d{4}-\d{2}-\d{2}$/.test(inp.data)
        ? inp.data
        : toLocalISODate(parseDateLocal(inp.data) ?? new Date());
    const baseDate = parseDateLocal(dataIso) ?? new Date();
    const id = crypto.randomUUID();
    created.push({
      id,
      descricao: inp.descricao || "Lançamento",
      valor: Math.abs(inp.valor),
      data: dataIso,
      tipo: inp.tipo,
      recorrente: false,
      mes: baseDate.getMonth() + 1,
      ano: baseDate.getFullYear(),
      horario: inp.horario,
      origem: inp.origem,
      importBatchId: inp.importBatchId,
      idOperacaoBanco: inp.idOperacaoBanco,
      criadoEm: now,
      atualizadoEm: now,
    });
    rows.push({
      id,
      user_id: activeUserId,
      descricao: inp.descricao || "Lançamento",
      valor: Math.abs(inp.valor),
      data: dataIso,
      tipo: inp.tipo,
      recorrente: false,
      mes: baseDate.getMonth() + 1,
      ano: baseDate.getFullYear(),
      // colunas opcionais
      ...(inp.horario ? { horario: inp.horario } : {}),
      ...(inp.origem ? { origem: inp.origem } : {}),
      ...(inp.importBatchId ? { import_batch_id: inp.importBatchId } : {}),
      ...(inp.idOperacaoBanco ? { id_operacao_banco: inp.idOperacaoBanco } : {}),
    } as ReceitaInsert);
  }

  memReceitas = [...memReceitas, ...created];
  emit();

  void supabase
    .from("receitas")
    .insert(rows)
    .then(({ error }) => {
      if (error) console.error("[store] addReceitasBulk failed", error);
    });

  return created;
}

export type DedupReceitaCandidato = {
  valor: number;
  data: string;
  descricao?: string;
  horario?: string;
};

/** Procura na base local de receitas uma entrada com forte indício de duplicidade. */
export function findDuplicateReceitaAdvanced(c: DedupReceitaCandidato): Receita | undefined {
  const desc = c.descricao || "";
  return memReceitas.find((r) => {
    if (Math.abs(r.valor - Math.abs(c.valor)) > 0.01) return false;
    const dDays = diffDays(r.data, c.data);
    if (dDays > 1) return false;
    if (!desc) return dDays === 0;
    const sim = descSimilarity(desc, r.descricao);
    if (sim >= 0.7) return true;
    if (dDays === 0 && diffMinutes(r.horario, c.horario) <= 5 && sim >= 0.4) return true;
    return false;
  });
}

/* ============================================================
 * TRANSFERÊNCIAS INTERNAS
 * Não contam como despesa nem receita; histórico separado.
 * ============================================================ */

export type NovaTransferenciaInternaInput = {
  descricao: string;
  valor: number;
  data: string; // YYYY-MM-DD
  horario?: string;
  origem?: string;
  destino?: string;
  observacao?: string;
  origemImportacao?: string;
  importBatchId?: string;
  idOperacaoBanco?: string;
};

export function addTransferenciasInternasBulk(
  inputs: NovaTransferenciaInternaInput[],
): TransferenciaInterna[] {
  if (!activeUserId || inputs.length === 0) return [];
  const now = new Date().toISOString();
  const created: TransferenciaInterna[] = [];
  const rows: Array<Record<string, unknown>> = [];

  for (const inp of inputs) {
    const dataIso =
      /^\d{4}-\d{2}-\d{2}$/.test(inp.data)
        ? inp.data
        : toLocalISODate(parseDateLocal(inp.data) ?? new Date());
    const baseDate = parseDateLocal(dataIso) ?? new Date();
    const id = crypto.randomUUID();
    const valor = Math.abs(inp.valor);
    created.push({
      id,
      descricao: inp.descricao || "Transferência interna",
      valor,
      data: dataIso,
      horario: inp.horario,
      origem: inp.origem,
      destino: inp.destino,
      observacao: inp.observacao,
      origemImportacao: inp.origemImportacao,
      importBatchId: inp.importBatchId,
      idOperacaoBanco: inp.idOperacaoBanco,
      mes: baseDate.getMonth() + 1,
      ano: baseDate.getFullYear(),
      criadoEm: now,
      atualizadoEm: now,
    });
    rows.push({
      id,
      user_id: activeUserId,
      descricao: inp.descricao || "Transferência interna",
      valor,
      data: dataIso,
      horario: inp.horario ?? null,
      origem: inp.origem ?? null,
      destino: inp.destino ?? null,
      observacao: inp.observacao ?? null,
      origem_importacao: inp.origemImportacao ?? null,
      import_batch_id: inp.importBatchId ?? null,
      id_operacao_banco: inp.idOperacaoBanco ?? null,
      mes: baseDate.getMonth() + 1,
      ano: baseDate.getFullYear(),
    });
  }

  memTransferencias = [...memTransferencias, ...created];
  emit();

  void sbAny
    .from("transferencias_internas")
    .insert(rows)
    .then(({ error }: { error: unknown }) => {
      if (error) console.error("[store] addTransferenciasInternasBulk failed", error);
    });

  return created;
}

export function deleteTransferenciaInterna(id: string) {
  memTransferencias = memTransferencias.filter((t) => t.id !== id);
  emit();
  if (!activeUserId) return;
  void sbAny
    .from("transferencias_internas")
    .delete()
    .eq("id", id)
    .then(({ error }: { error: unknown }) => {
      if (error) console.error("[store] deleteTransferenciaInterna failed", error);
    });
}

export type DedupTransferenciaCandidato = {
  valor: number;
  data: string;
  descricao?: string;
  horario?: string;
};

export function findDuplicateTransferenciaAdvanced(
  c: DedupTransferenciaCandidato,
): TransferenciaInterna | undefined {
  const desc = c.descricao || "";
  return memTransferencias.find((t) => {
    if (Math.abs(t.valor - Math.abs(c.valor)) > 0.01) return false;
    const dDays = diffDays(t.data, c.data);
    if (dDays > 1) return false;
    if (!desc) return dDays === 0;
    const sim = descSimilarity(desc, t.descricao);
    if (sim >= 0.7) return true;
    if (dDays === 0 && diffMinutes(t.horario, c.horario) <= 5 && sim >= 0.4) return true;
    return false;
  });
}

// Exclui todas as receitas de uma recorrencia (a partir de um mes opcional).
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
  clienteId?: string | null;
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
  if (fields.valor !== undefined) {
    const amount = validateFinancialAmount(fields.valor);
    if (!amount.ok) {
      const msg = financialAmountMessage(amount.code);
      if (typeof window !== "undefined") {
        void import("sonner").then(({ toast }) => toast.error(msg));
      }
      return;
    }
    fields = { ...fields, valor: amount.value };
  }
  const now = new Date().toISOString();

  const buildPatch = (r: Receita): Receita => {
    const next: Receita = { ...r, atualizadoEm: now };
    if (fields.descricao !== undefined) next.descricao = fields.descricao;
    if (fields.valor !== undefined) next.valor = fields.valor;
    if (fields.tipo !== undefined) next.tipo = fields.tipo;
    if (fields.clienteId !== undefined) next.clienteId = fields.clienteId ?? null;
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
  if (fields.clienteId !== undefined) basePatch.cliente_id = fields.clienteId ?? null;

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
  /** Meta opcionalmente vinculada (entra no progresso da meta sem duplicar valores). */
  metaId?: string;
};

/** Procura uma reserva existente similar (mesmo banco + mesmo tipo). */
export function findReservaSimilar(
  bancoId: string,
  tipoReserva: TipoReserva,
): Guardado | undefined {
  return memGuardado.find(
    (g) => g.bancoId === bancoId && g.tipoReserva === tipoReserva,
  );
}

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
    metaId: input.metaId || undefined,
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
      meta_id: input.metaId ? metaUuidFor(input.metaId) : null,
    } as GuardadoInsert)
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
  if (patch.metaId !== undefined) {
    row.meta_id = patch.metaId ? metaUuidFor(patch.metaId) : null;
  }
  void supabase
    .from("dinheiro_guardado")
    .update(row)
    .eq("id", id)
    .then(({ error }) => {
      if (error) console.error("[store] updateGuardado failed", error);
    });
}

/** Vincula ou desvincula uma reserva de Guardado a uma meta. */
export function setGuardadoMeta(guardadoId: string, metaId: string | null) {
  updateGuardado(guardadoId, { metaId: metaId ?? undefined });
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

/** Reservas de Guardado vinculadas a uma meta específica. */
export function getGuardadosDaMeta(metaId: string): Guardado[] {
  return memGuardado.filter((g) => g.metaId === metaId);
}

/**
 * Progresso efetivo da meta — fonte única de dados.
 *
 * = soma das reservas em Guardado vinculadas à meta
 * + soma de movimentações antigas (compatibilidade com dados anteriores)
 * + valor manual armazenado em metas_financeiras.valor_atual (legado)
 *
 * Quando o usuário começa a vincular reservas, o valor manual continua
 * existindo (não apagamos dados), mas o usuário pode zerá-lo via
 * "Atualizar valor" se quiser que o progresso reflita só as reservas.
 */
export function getMetaProgresso(metaId: string): number {
  return getMetaProgressoBreakdown(metaId).total;
}

/**
 * Decomposição do progresso da meta:
 *  - guardado: valor real reservado em Guardado vinculado a essa meta
 *  - direto:   valor adicionado diretamente na meta (valorAtual + movs legadas)
 *  - total:    soma dos dois (sem duplicar)
 *  - restante: quanto falta para o objetivo
 */
export function getMetaProgressoBreakdown(metaId: string): {
  total: number;
  guardado: number;
  direto: number;
  restante: number;
} {
  const meta = memMetas.find((m) => m.id === metaId);
  const baseline = meta ? Number(meta.valorAtual) || 0 : 0;
  const guardado = memGuardado
    .filter((g) => g.metaId === metaId)
    .reduce((s, g) => s + (Number(g.valor) || 0), 0);
  const movsLegado = memMov
    .filter((mv) => mv.metaId === metaId)
    .reduce((s, mv) => s + (Number(mv.valor) || 0), 0);
  const direto = baseline + movsLegado;
  const total = direto + guardado;
  const objetivo = meta ? Number(meta.valorObjetivo) || 0 : 0;
  const restante = Math.max(0, objetivo - total);
  return { total, guardado, direto, restante };
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
  imagemKey?: string;
};
export function addMeta(input: NovaMetaInput): Meta | null {
  // Meta básica é liberada para free_ads + planos pagos (quota via trigger
  // tg_free_ads_quota_metas, cap=2). Sem_assinatura é bloqueado aqui e
  // também pela RLS de metas_financeiras.
  if (!ensureCanWrite("addMeta", { allowBasic: true })) {
    return null;
  }
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
    imagemKey: input.imagemKey,
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
      ...(novo.imagemKey ? { imagem_key: novo.imagemKey } : {}),
    } as MetaInsert)
    .then(({ error }) => {
      if (error) {
        // Reverte a inserção otimista para refletir a falha (ex.: quota
        // free_ads excedida via trigger SQL).
        memMetas = memMetas.filter((m) => m.id !== newUuid);
        metaKeyToUuid.delete(newUuid);
        emit();
        if (!handleFreeAdsQuotaError(error)) {
          console.error("[store] addMeta failed", error);
        }
      }
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
  const row: MetaUpdate & { imagem_key?: string | null } = {};
  if (patch.nome !== undefined) row.nome = patch.nome;
  if (patch.valorObjetivo !== undefined) row.valor_objetivo = patch.valorObjetivo;
  if (patch.valorAtual !== undefined) row.valor_atual = patch.valorAtual;
  if (patch.prazo !== undefined) row.prazo = patch.prazo ?? null;
  if (patch.descricao !== undefined) row.descricao = patch.descricao ?? null;
  if (patch.colorHex !== undefined) row.color_hex = patch.colorHex;
  if (patch.bancoId !== undefined) row.banco_id = patch.bancoId ? bancoUuidFor(patch.bancoId) : null;
  if (patch.imagemKey !== undefined) row.imagem_key = patch.imagemKey ?? null;
  void supabase
    .from("metas_financeiras")
    .update(row as MetaUpdate)
    .eq("id", uuid)
    .then(({ error }) => {
      if (error) console.error("[store] updateMeta failed", error);
    });
}

/**
 * Exclui uma meta sem apagar o dinheiro guardado vinculado a ela.
 * Reservas em Guardado ficam como "sem meta vinculada".
 * Movimentações antigas (legado) também são preservadas, ficando órfãs até
 * serem manualmente limpas pelo usuário.
 */
export function deleteMeta(id: string) {
  // Desvincula reservas locais (preserva o dinheiro em Guardado).
  memGuardado = memGuardado.map((g) =>
    g.metaId === id ? { ...g, metaId: undefined } : g,
  );
  memMetas = memMetas.filter((m) => m.id !== id);
  emit();
  if (!activeUserId) return;
  const uuid = metaUuidFor(id);
  if (!uuid) return;
  metaKeyToUuid.delete(id);
  // Desvincula no banco em paralelo, sem bloquear a exclusão.
  void supabase
    .from("dinheiro_guardado")
    .update({ meta_id: null } as GuardadoUpdate)
    .eq("meta_id", uuid)
    .then(({ error }) => {
      if (error) console.error("[store] deleteMeta unlink guardados failed", error);
    });
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
// CONTAS A PAGAR
// ============================================================
export function getContasAPagar(): ContaAPagar[] {
  return memContas;
}

/**
 * Mês de competência efetivo da conta (1-12, ano).
 * Usa `mesReferencia` ("YYYY-MM") quando válido; cai pro mes/ano armazenado
 * (que é derivado do vencimento) como fallback para registros antigos.
 */
export function getMesRefConta(c: { mesReferencia?: string; mes: number; ano: number }): {
  mes: number;
  ano: number;
} {
  if (c.mesReferencia && /^(\d{4})-(\d{2})$/.test(c.mesReferencia)) {
    const [a, m] = c.mesReferencia.split("-").map(Number);
    return { mes: m, ano: a };
  }
  return { mes: c.mes, ano: c.ano };
}

export function contaPertenceAoMesRef(
  c: { mesReferencia?: string; mes: number; ano: number },
  mes: number,
  ano: number,
): boolean {
  const r = getMesRefConta(c);
  return r.mes === mes && r.ano === ano;
}

/**
 * Status efetivo: se a conta está pendente e a data de vencimento já passou,
 * retorna "atrasado" sem alterar o registro persistido.
 */
export function statusContaEfetivo(c: ContaAPagar, hojeISO?: string): StatusConta {
  if (c.status === "pago") return "pago";
  const hoje = hojeISO ?? new Date().toISOString().slice(0, 10);
  if (c.dataVencimento < hoje) return "atrasado";
  return "pendente";
}

export type NovaContaInput = {
  nome: string;
  valor: number;
  /** YYYY-MM-DD */
  dataVencimento: string;
  categoriaId?: string;
  observacao?: string;
  recorrente?: boolean;
  /** Frequência da recorrência (default: mensal) */
  frequenciaRecorrencia?: FrequenciaRecorrencia;
  /** Quantas ocorrências gerar (default 12 — interpretado conforme frequência) */
  recorrenteMeses?: number;
  dataFim?: string;
  beneficiario?: string;
  formaPagamento?: FormaPagamento;
  codigoBoleto?: string;
  codigoPix?: string;
  chavePix?: string;
  bancoEmissor?: string;
  importBatchId?: string;
  /** Mês de referência (competência) `YYYY-MM`. Default = mês do vencimento. */
  mesReferencia?: string;
  /** ID do fornecedor vinculado (opcional). */
  fornecedorId?: string | null;
};

export function addContaAPagar(input: NovaContaInput): ContaAPagar[] {
  if (!activeUserId) return [];
  const now = new Date().toISOString();
  const baseDate = new Date(input.dataVencimento + "T00:00:00");
  const created: ContaAPagar[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = [];
  const catUuid = input.categoriaId ? categoriaUuidFor(input.categoriaId) : null;

  const fornecedorVal =
    input.fornecedorId && input.fornecedorId.trim() ? input.fornecedorId.trim() : null;

  // Campos comuns que se repetem em cada ocorrência
  const extras = {
    beneficiario: input.beneficiario,
    formaPagamento: input.formaPagamento,
    codigoBoleto: input.codigoBoleto,
    codigoPix: input.codigoPix,
    chavePix: input.chavePix,
    bancoEmissor: input.bancoEmissor,
    importBatchId: input.importBatchId,
    fornecedorId: fornecedorVal,
  };
  const extrasRow = {
    beneficiario: input.beneficiario ?? null,
    forma_pagamento: input.formaPagamento ?? null,
    codigo_boleto: input.codigoBoleto ?? null,
    codigo_pix: input.codigoPix ?? null,
    chave_pix: input.chavePix ?? null,
    banco_emissor: input.bancoEmissor ?? null,
    import_batch_id: input.importBatchId ?? null,
    fornecedor_id: fornecedorVal,
  };

  const freq: FrequenciaRecorrencia = input.frequenciaRecorrencia ?? "mensal";

  function pushOne(iso: string, recurringId: string | null) {
    const d = new Date(iso + "T00:00:00");
    const id = crypto.randomUUID();
    // Mês de referência: usa o informado ou cai pro mês do vencimento desta
    // ocorrência. Para recorrências, cada ocorrência usa o próprio mês.
    const mesRef =
      input.mesReferencia && /^\d{4}-\d{2}$/.test(input.mesReferencia) && !recurringId
        ? input.mesReferencia
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    created.push({
      id,
      nome: input.nome,
      valor: input.valor,
      dataVencimento: iso,
      categoriaId: input.categoriaId,
      observacao: input.observacao,
      recorrente: !!recurringId,
      recorrenciaId: recurringId ?? undefined,
      frequenciaRecorrencia: recurringId ? freq : undefined,
      dataInicio: recurringId ? input.dataVencimento : undefined,
      dataFim: recurringId ? input.dataFim : undefined,
      status: "pendente",
      ...extras,
      mes: d.getMonth() + 1,
      ano: d.getFullYear(),
      mesReferencia: mesRef,
      criadoEm: now,
      atualizadoEm: now,
    });
    rows.push({
      id,
      user_id: activeUserId,
      nome: input.nome,
      valor: input.valor,
      data_vencimento: iso,
      categoria_id: catUuid,
      observacao: input.observacao ?? null,
      recorrente: !!recurringId,
      recorrencia_id: recurringId,
      frequencia_recorrencia: recurringId ? freq : null,
      data_inicio: recurringId ? input.dataVencimento : null,
      data_fim: recurringId && input.dataFim ? input.dataFim : null,
      status: "pendente",
      mes: d.getMonth() + 1,
      ano: d.getFullYear(),
      mes_referencia: mesRef,
      ...extrasRow,
    });
  }

  function addOccurrence(base: Date, i: number): Date {
    const d = new Date(base);
    if (freq === "semanal") d.setDate(d.getDate() + 7 * i);
    else if (freq === "quinzenal") d.setDate(d.getDate() + 14 * i);
    else if (freq === "anual") d.setFullYear(d.getFullYear() + i);
    else return addMonthsPreservingDay(base, i); // mensal (sem overflow)
    return d;
  }

  if (input.recorrente) {
    const total = Math.max(1, input.recorrenteMeses ?? 12);
    const recId = crypto.randomUUID();
    for (let i = 0; i < total; i++) {
      const d = addOccurrence(baseDate, i);
      const iso = toLocalISODate(d);
      if (input.dataFim && iso > input.dataFim) break;
      pushOne(iso, recId);
    }
  } else {
    pushOne(input.dataVencimento, null);
  }

  memContas = [...memContas, ...created];
  emit();
  void sbAny
    .from("contas_a_pagar")
    .insert(rows)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error("[store] addContaAPagar failed", error);
    });
  return created;
}

export type ContaEditableFields = {
  nome?: string;
  valor?: number;
  dataVencimento?: string;
  categoriaId?: string | null;
  observacao?: string;
  beneficiario?: string | null;
  formaPagamento?: FormaPagamento | null;
  codigoBoleto?: string | null;
  codigoPix?: string | null;
  chavePix?: string | null;
  bancoEmissor?: string | null;
  /** ID do fornecedor vinculado. Use null para remover. */
  fornecedorId?: string | null;
  /** Mês de referência (competência) `YYYY-MM`. */
  mesReferencia?: string | null;
  /** Quando atualizando uma conta paga, sincroniza o gasto vinculado */
  atualizarGastoVinculado?: boolean;
};

export function updateContaAPagar(id: string, fields: ContaEditableFields) {
  if (!activeUserId) return;
  const idx = memContas.findIndex((c) => c.id === id);
  if (idx < 0) return;
  const current = memContas[idx];
  const updated: ContaAPagar = {
    ...current,
    nome: fields.nome ?? current.nome,
    valor: fields.valor ?? current.valor,
    dataVencimento: fields.dataVencimento ?? current.dataVencimento,
    categoriaId:
      fields.categoriaId === null
        ? undefined
        : fields.categoriaId ?? current.categoriaId,
    observacao: fields.observacao ?? current.observacao,
    beneficiario:
      fields.beneficiario === null
        ? undefined
        : fields.beneficiario ?? current.beneficiario,
    formaPagamento:
      fields.formaPagamento === null
        ? undefined
        : fields.formaPagamento ?? current.formaPagamento,
    codigoBoleto:
      fields.codigoBoleto === null
        ? undefined
        : fields.codigoBoleto ?? current.codigoBoleto,
    codigoPix:
      fields.codigoPix === null ? undefined : fields.codigoPix ?? current.codigoPix,
    chavePix:
      fields.chavePix === null ? undefined : fields.chavePix ?? current.chavePix,
    bancoEmissor:
      fields.bancoEmissor === null
        ? undefined
        : fields.bancoEmissor ?? current.bancoEmissor,
    mesReferencia:
      fields.mesReferencia === null
        ? undefined
        : fields.mesReferencia ?? current.mesReferencia,
    fornecedorId:
      fields.fornecedorId === undefined
        ? current.fornecedorId ?? null
        : fields.fornecedorId && fields.fornecedorId !== ""
          ? fields.fornecedorId
          : null,
    atualizadoEm: new Date().toISOString(),
  };
  if (fields.dataVencimento) {
    const d = new Date(fields.dataVencimento + "T00:00:00");
    updated.mes = d.getMonth() + 1;
    updated.ano = d.getFullYear();
    // Se o usuário não está editando explicitamente o mês de referência e
    // este estava vazio ou apontando para o vencimento antigo, atualiza para
    // o novo vencimento.
    if (fields.mesReferencia === undefined && !current.mesReferencia) {
      updated.mesReferencia = `${updated.ano}-${String(updated.mes).padStart(2, "0")}`;
    }
  }
  memContas = [...memContas.slice(0, idx), updated, ...memContas.slice(idx + 1)];
  emit();

  // Se a conta está paga e o usuário pediu para sincronizar o gasto vinculado
  if (fields.atualizarGastoVinculado && current.gastoId && current.status === "pago") {
    updateGasto(current.gastoId, {
      descricao: updated.nome,
      estabelecimento: updated.nome,
      valor: updated.valor,
      categoriaId: updated.categoriaId || "outros",
      observacao: updated.observacao,
      ...(fields.fornecedorId !== undefined
        ? { fornecedorId: updated.fornecedorId ?? null }
        : {}),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = {};
  if (fields.nome !== undefined) row.nome = fields.nome;
  if (fields.valor !== undefined) row.valor = fields.valor;
  if (fields.dataVencimento !== undefined) {
    row.data_vencimento = fields.dataVencimento;
    row.mes = updated.mes;
    row.ano = updated.ano;
  }
  if (fields.categoriaId !== undefined) {
    row.categoria_id = fields.categoriaId
      ? categoriaUuidFor(fields.categoriaId)
      : null;
  }
  if (fields.observacao !== undefined) row.observacao = fields.observacao ?? null;
  if (fields.beneficiario !== undefined) row.beneficiario = fields.beneficiario ?? null;
  if (fields.formaPagamento !== undefined) row.forma_pagamento = fields.formaPagamento ?? null;
  if (fields.codigoBoleto !== undefined) row.codigo_boleto = fields.codigoBoleto ?? null;
  if (fields.codigoPix !== undefined) row.codigo_pix = fields.codigoPix ?? null;
  if (fields.chavePix !== undefined) row.chave_pix = fields.chavePix ?? null;
  if (fields.bancoEmissor !== undefined) row.banco_emissor = fields.bancoEmissor ?? null;
  if (fields.fornecedorId !== undefined)
    row.fornecedor_id = fields.fornecedorId && fields.fornecedorId !== "" ? fields.fornecedorId : null;
  if (fields.mesReferencia !== undefined) row.mes_referencia = fields.mesReferencia ?? null;
  else if (fields.dataVencimento !== undefined && updated.mesReferencia)
    row.mes_referencia = updated.mesReferencia;

  void sbAny
    .from("contas_a_pagar")
    .update(row)
    .eq("id", id)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error("[store] updateContaAPagar failed", error);
    });
}

/** Verifica se já existe conta com o mesmo código de boleto ou Pix. */
export function findContaByCodigo(
  codigo: string,
  tipo: "boleto" | "pix",
): ContaAPagar | undefined {
  const norm = codigo.replace(/\s+/g, "");
  return memContas.find((c) => {
    const v = tipo === "boleto" ? c.codigoBoleto : c.codigoPix;
    return v && v.replace(/\s+/g, "") === norm;
  });
}

/** Detecta possíveis duplicados por valor + vencimento + nome/beneficiário. */
export function findContaDuplicado(input: {
  valor: number;
  dataVencimento: string;
  nome?: string;
  beneficiario?: string;
}): ContaAPagar | undefined {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  return memContas.find(
    (c) =>
      Math.abs(c.valor - input.valor) < 0.01 &&
      c.dataVencimento === input.dataVencimento &&
      (norm(c.nome) === norm(input.nome) ||
        (input.beneficiario && norm(c.beneficiario) === norm(input.beneficiario))),
  );
}

export function deleteContaAPagar(id: string, options?: { excluirGastoVinculado?: boolean }) {
  if (!activeUserId) return;
  const conta = memContas.find((c) => c.id === id);
  memContas = memContas.filter((c) => c.id !== id);
  emit();
  if (options?.excluirGastoVinculado && conta?.gastoId) {
    deleteGasto(conta.gastoId);
  }
  // Alerta órfão: se a conta foi excluída, qualquer alerta apontando para
  // ela deixa de fazer sentido.
  void resolveAlertasDe("conta_a_pagar", id);
  void sbAny
    .from("contas_a_pagar")
    .delete()
    .eq("id", id)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error("[store] deleteContaAPagar failed", error);
    });
}

/** Exclui todas as ocorrências futuras de uma conta recorrente. */
export function deleteContaRecorrencia(
  recorrenciaId: string,
  fromMes?: number,
  fromAno?: number,
) {
  const shouldRemove = (c: ContaAPagar) => {
    if (c.recorrenciaId !== recorrenciaId) return false;
    if (fromMes == null || fromAno == null) return true;
    return c.ano > fromAno || (c.ano === fromAno && c.mes >= fromMes);
  };
  const removedIds = memContas.filter(shouldRemove).map((c) => c.id);
  memContas = memContas.filter((c) => !shouldRemove(c));
  emit();
  for (const cid of removedIds) {
    void resolveAlertasDe("conta_a_pagar", cid);
  }
  if (!activeUserId || removedIds.length === 0) return;
  void sbAny
    .from("contas_a_pagar")
    .delete()
    .in("id", removedIds)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error("[store] deleteContaRecorrencia failed", error);
    });
}

/**
 * Atualiza ocorrências de uma recorrência em escopo:
 *  - "single" → só esta (caller deve usar updateContaAPagar diretamente)
 *  - "future" → esta e as próximas (a partir de fromMes/fromAno)
 *  - "all"    → todas, incluindo passadas
 *
 * Não toca em ocorrências já pagas (preserva histórico do gasto vinculado).
 */
export function updateContaRecorrencia(
  recorrenciaId: string,
  fields: ContaEditableFields,
  scope: "future" | "all",
  fromMes: number,
  fromAno: number,
) {
  if (!activeUserId) return;
  const targets = memContas.filter((c) => {
    if (c.recorrenciaId !== recorrenciaId) return false;
    if (c.status === "pago") return false;
    if (scope === "all") return true;
    return c.ano > fromAno || (c.ano === fromAno && c.mes >= fromMes);
  });
  for (const t of targets) {
    // Não propaga dataVencimento (cada ocorrência tem a sua)
    const f: ContaEditableFields = { ...fields };
    delete f.dataVencimento;
    updateContaAPagar(t.id, f);
  }
}

const CONTA_A_PAGAR_GASTO_ORIGEM = "contas_a_pagar";

function contaGastoOperationId(contaId: string): string {
  return `conta_a_pagar:${contaId}`;
}

function normalizeContaText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function daysBetweenISO(a: string, b: string): number {
  const ta = new Date(`${a}T00:00:00`).getTime();
  const tb = new Date(`${b}T00:00:00`).getTime();
  return Math.abs(Math.round((ta - tb) / 86_400_000));
}

function findGastosVinculadosConta(
  conta: ContaAPagar,
  nome: string,
  valor: number,
  dataPagamento: string,
): Gasto[] {
  const opId = contaGastoOperationId(conta.id);
  const normalizedName = normalizeContaText(nome);
  const linkedByOtherConta = new Set(
    memContas
      .filter((c) => c.id !== conta.id && c.gastoId)
      .map((c) => c.gastoId as string),
  );

  const direct = memGastos.filter((g) => g.id === conta.gastoId || g.idOperacaoBanco === opId);
  const fallback = memGastos.filter((g) => {
    if (direct.some((d) => d.id === g.id)) return false;
    if (linkedByOtherConta.has(g.id)) return false;
    if (g.origem !== CONTA_A_PAGAR_GASTO_ORIGEM) return false;
    if (Math.abs((g.valor ?? 0) - valor) > 0.01) return false;
    if (normalizeContaText(g.descricao || g.estabelecimento) !== normalizedName) return false;
    return daysBetweenISO(g.data, dataPagamento) <= 3 || daysBetweenISO(g.data, conta.dataVencimento) <= 3;
  });

  return [...direct, ...fallback].filter((g, index, arr) => arr.findIndex((x) => x.id === g.id) === index);
}

async function deleteGastosPersistidos(ids: string[]): Promise<void> {
  if (!activeUserId || ids.length === 0) return;
  memGastos = memGastos.filter((g) => !ids.includes(g.id));
  emit();
  const { error } = await supabase.from("gastos").delete().eq("user_id", activeUserId).in("id", ids);
  if (error) throw error;
}

/**
 * Resolve (marca como `resolved`) todos os alertas no sininho que apontam
 * para uma entidade específica. Usado quando a entidade é paga, cancelada,
 * excluída ou deixa de ser uma pendência real.
 *
 * Tipos típicos: `conta_a_pagar`, `fatura`, `cartao`, `gasto`, `recorrencia`,
 * `categoria`, `conta_a_receber`.
 */
export async function resolveAlertasDe(
  entityType: string,
  entityId: string,
): Promise<void> {
  if (!activeUserId || !entityId) return;
  const now = new Date().toISOString();
  const { error } = await sbAny
    .from("user_alerts")
    .update({ status: "resolved", resolved_at: now, updated_at: now })
    .eq("user_id", activeUserId)
    .eq("related_entity_type", entityType)
    .eq("related_entity_id", entityId)
    .in("status", ["unread", "read"]);
  if (error) console.error("[store] resolveAlertasDe failed", entityType, entityId, error);
}

// Compat: nome antigo, mantido para não quebrar chamadas existentes.
async function resolveAlertasDaConta(contaId: string): Promise<void> {
  await resolveAlertasDe("conta_a_pagar", contaId);
}

/**
 * Resolve alertas cuja `dedupe_key` começa com um prefixo. Útil para alertas
 * que não usam `related_entity_id` (ex: `fatura_vencida:<cartaoId>:<YYYY-MM>`).
 */
export async function resolveAlertasPorDedupeKey(prefix: string): Promise<void> {
  if (!activeUserId || !prefix) return;
  const now = new Date().toISOString();
  const { error } = await sbAny
    .from("user_alerts")
    .update({ status: "resolved", resolved_at: now, updated_at: now })
    .eq("user_id", activeUserId)
    .like("dedupe_key", `${prefix}%`)
    .in("status", ["unread", "read"]);
  if (error) console.error("[store] resolveAlertasPorDedupeKey failed", prefix, error);
}

async function upsertGastoVinculadoConta(
  conta: ContaAPagar,
  input: {
    nome: string;
    valor: number;
    dataPagamento: string;
    categoriaId?: string;
    formaPagamento: FormaPagamento;
    observacao?: string;
  },
): Promise<{ gastoId: string; created: boolean }> {
  if (!activeUserId) throw new Error("Usuário não autenticado.");
  const now = new Date().toISOString();
  const d = parseDateLocal(input.dataPagamento) ?? new Date(`${input.dataPagamento}T00:00:00`);
  const categoriaId = input.categoriaId || "outros";
  const categoriaUuid = categoriaUuidFor(categoriaId);
  const candidates = findGastosVinculadosConta(conta, input.nome, input.valor, input.dataPagamento);
  const existing = candidates[0];
  const duplicates = candidates.slice(1).map((g) => g.id);
  // Mês de referência (competência) — se a conta tem, propaga para o gasto.
  // Senão, usa o mês do pagamento (comportamento legado).
  const invoiceMonth =
    conta.mesReferencia && /^\d{4}-\d{2}$/.test(conta.mesReferencia)
      ? conta.mesReferencia
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const fornecedorIdConta = conta.fornecedorId ?? null;
  const row = {
    descricao: input.nome,
    valor: input.valor,
    data: input.dataPagamento,
    estabelecimento: input.nome,
    categoria_id: categoriaUuid,
    forma_pagamento: input.formaPagamento,
    observacao: input.observacao ?? conta.observacao ?? null,
    mes: d.getMonth() + 1,
    ano: d.getFullYear(),
    confirmado: true,
    tipo_gasto: "unico",
    origem: CONTA_A_PAGAR_GASTO_ORIGEM,
    id_operacao_banco: contaGastoOperationId(conta.id),
    invoice_month: invoiceMonth,
    fornecedor_id: fornecedorIdConta,
    updated_at: now,
  };

  if (existing) {
    const { error } = await sbAny.from("gastos").update(row).eq("id", existing.id).eq("user_id", activeUserId);
    if (error) throw error;
    memGastos = memGastos.map((g) =>
      g.id === existing.id
        ? {
            ...g,
            descricao: input.nome,
            valor: input.valor,
            data: input.dataPagamento,
            estabelecimento: input.nome,
            categoriaId,
            formaPagamento: input.formaPagamento,
            observacao: input.observacao ?? conta.observacao,
            mes: d.getMonth() + 1,
            ano: d.getFullYear(),
            confirmado: true,
            tipoGasto: "unico",
            origem: CONTA_A_PAGAR_GASTO_ORIGEM,
            idOperacaoBanco: contaGastoOperationId(conta.id),
            invoiceMonth,
            fornecedorId: fornecedorIdConta,
            atualizadoEm: now,
          }
        : g,
    );
    if (duplicates.length > 0) await deleteGastosPersistidos(duplicates);
    emit();
    return { gastoId: existing.id, created: false };
  }

  const id = crypto.randomUUID();
  const { error } = await sbAny.from("gastos").insert({ id, user_id: activeUserId, ...row, created_at: now });
  if (error) throw error;
  memGastos = [
    ...memGastos,
    {
      id,
      descricao: input.nome,
      valor: input.valor,
      data: input.dataPagamento,
      estabelecimento: input.nome,
      categoriaId,
      formaPagamento: input.formaPagamento,
      observacao: input.observacao ?? conta.observacao,
      mes: d.getMonth() + 1,
      ano: d.getFullYear(),
      confirmado: true,
      tipoGasto: "unico",
      origem: CONTA_A_PAGAR_GASTO_ORIGEM,
      idOperacaoBanco: contaGastoOperationId(conta.id),
      invoiceMonth,
      fornecedorId: fornecedorIdConta,
      criadoEm: now,
      atualizadoEm: now,
    },
  ];
  emit();
  return { gastoId: id, created: true };
}

/**
 * Marca conta como paga. Opcionalmente cria um gasto correspondente no mês
 * do pagamento (categoria + valor da conta).
 */
export async function marcarContaComoPago(
  id: string,
  options?: {
    criarGasto?: boolean;
    formaPagamento?: FormaPagamento;
    dataPagamento?: string;
    observacao?: string;
    /** Overrides aplicados à conta e ao gasto gerado */
    nome?: string;
    valor?: number;
    categoriaId?: string;
  },
): Promise<{ gastoId?: string }> {
  if (!activeUserId) return {};
  const idx = memContas.findIndex((c) => c.id === id);
  if (idx < 0) return {};
  const conta = memContas[idx];
  const dataPag = options?.dataPagamento ?? new Date().toISOString().slice(0, 10);

  // Valores efetivos (override do modal de pagamento, ou fallback para a conta)
  const nomeEf = (options?.nome ?? conta.nome).trim() || conta.nome;
  const valorEf = typeof options?.valor === "number" && options.valor > 0 ? options.valor : conta.valor;
  const categoriaEf = options?.categoriaId ?? conta.categoriaId;

  const saved = await markContaAPagarPaid({
    data: {
      id,
      criarGasto: options?.criarGasto,
      formaPagamento: options?.formaPagamento,
      dataPagamento: dataPag,
      observacao: options?.observacao,
      nome: nomeEf,
      valor: valorEf,
      categoriaId: categoriaEf,
      mesReferencia:
        conta.mesReferencia && /^\d{4}-\d{2}$/.test(conta.mesReferencia)
          ? conta.mesReferencia
          : undefined,
    },
  });
  const now = new Date().toISOString();
  const gastoId = saved.gastoId;

  const updated: ContaAPagar = {
    ...conta,
    nome: nomeEf,
    valor: valorEf,
    categoriaId: categoriaEf,
    status: "pago",
    dataPagamento: dataPag,
    formaPagamento: options?.formaPagamento ?? conta.formaPagamento,
    gastoId: gastoId,
    atualizadoEm: now,
  };
  memContas = [...memContas.slice(0, idx), updated, ...memContas.slice(idx + 1)];
  emit();
  void resolveAlertasDaConta(id);
  void refreshGastos();

  return { gastoId };
}

/**
 * Reverte conta paga para pendente. Por padrão remove o gasto vinculado
 * que foi criado automaticamente, atualizando Dashboard/Gastos.
 */
export async function desmarcarContaComoPago(
  id: string,
  options?: { removerGastoVinculado?: boolean },
) {
  if (!activeUserId) return;
  const idx = memContas.findIndex((c) => c.id === id);
  if (idx < 0) return;
  const conta = memContas[idx];
  const removerGasto = options?.removerGastoVinculado ?? true;

  const now = new Date().toISOString();
  await unmarkContaAPagarPaid({ data: { id, removerGastoVinculado: removerGasto } });

  const updated: ContaAPagar = {
    ...conta,
    status: "pendente",
    dataPagamento: undefined,
    gastoId: undefined,
    atualizadoEm: now,
  };
  memContas = [...memContas.slice(0, idx), updated, ...memContas.slice(idx + 1)];
  emit();
  void refreshGastos();
}

// ============================================================
// EXTRATOS IMPORTADOS — histórico e reversão
// ============================================================
export function getExtratosImportados(): ExtratoImportado[] {
  return memExtratos;
}

export type CriarExtratoImportadoInput = {
  id: string; // batchId — gerado antes pelo dialog para vincular aos itens
  nomeArquivo?: string;
  banco?: string;
  tipoOrigem: TipoOrigemExtrato;
  periodoInicio?: string;
  periodoFim?: string;
  qtdMovimentacoes: number;
  qtdDuplicadasIgnoradas: number;
  totalReceitas: number;
  totalDespesas: number;
  totalGuardado: number;
  totalTransferencias: number;
  observacao?: string;
};

export async function createExtratoImportado(
  input: CriarExtratoImportadoInput,
): Promise<ExtratoImportado | null> {
  if (!activeUserId) return null;
  const now = new Date().toISOString();
  const novo: ExtratoImportado = {
    id: input.id,
    nomeArquivo: input.nomeArquivo,
    banco: input.banco,
    tipoOrigem: input.tipoOrigem,
    dataImportacao: now,
    periodoInicio: input.periodoInicio,
    periodoFim: input.periodoFim,
    qtdMovimentacoes: input.qtdMovimentacoes,
    qtdDuplicadasIgnoradas: input.qtdDuplicadasIgnoradas,
    totalReceitas: input.totalReceitas,
    totalDespesas: input.totalDespesas,
    totalGuardado: input.totalGuardado,
    totalTransferencias: input.totalTransferencias,
    status: "importado",
    observacao: input.observacao,
    criadoEm: now,
    atualizadoEm: now,
  };
  memExtratos = [novo, ...memExtratos];
  emit();
  const { error } = await sbAny.from("extratos_importados").insert({
    id: input.id,
    user_id: activeUserId,
    nome_arquivo: input.nomeArquivo ?? null,
    banco: input.banco ?? null,
    tipo_origem: input.tipoOrigem,
    data_importacao: now,
    periodo_inicio: input.periodoInicio ?? null,
    periodo_fim: input.periodoFim ?? null,
    qtd_movimentacoes: input.qtdMovimentacoes,
    qtd_duplicadas_ignoradas: input.qtdDuplicadasIgnoradas,
    total_receitas: input.totalReceitas,
    total_despesas: input.totalDespesas,
    total_guardado: input.totalGuardado,
    total_transferencias: input.totalTransferencias,
    status: "importado",
    observacao: input.observacao ?? null,
  });
  if (error) {
    console.error("[store] createExtratoImportado failed", error);
    // rollback in-memory
    memExtratos = memExtratos.filter((e) => e.id !== input.id);
    emit();
    return null;
  }
  return novo;
}

export type ItensDoBatch = {
  gastos: Gasto[];
  receitas: Receita[];
  transferencias: TransferenciaInterna[];
  guardado: Guardado[];
  movimentacoesMeta: MovimentacaoMeta[];
};

export function getItensDoBatch(batchId: string): ItensDoBatch {
  return {
    gastos: memGastos.filter((g) => g.importBatchId === batchId),
    receitas: memReceitas.filter((r) => r.importBatchId === batchId),
    transferencias: memTransferencias.filter((t) => t.importBatchId === batchId),
    guardado: memGuardado.filter((g) => g.importBatchId === batchId),
    movimentacoesMeta: memMov.filter((m) => m.importBatchId === batchId),
  };
}

/**
 * Detecta itens do lote que foram editados depois da importação.
 * Compara updated_at vs created_at; tolerância de 5s pra evitar falsos positivos.
 */
export function getItensEditadosDoBatch(batchId: string): {
  total: number;
  gastos: number;
  receitas: number;
  transferencias: number;
} {
  const TOLERANCIA_MS = 5000;
  const isEdited = (criadoEm?: string, atualizadoEm?: string) => {
    if (!criadoEm || !atualizadoEm) return false;
    const a = new Date(criadoEm).getTime();
    const b = new Date(atualizadoEm).getTime();
    return b - a > TOLERANCIA_MS;
  };
  const itens = getItensDoBatch(batchId);
  const g = itens.gastos.filter((x) => isEdited(x.criadoEm, x.atualizadoEm)).length;
  const r = itens.receitas.filter((x) => isEdited(x.criadoEm, x.atualizadoEm)).length;
  const t = itens.transferencias.filter((x) => isEdited(x.criadoEm, x.atualizadoEm)).length;
  return { total: g + r + t, gastos: g, receitas: r, transferencias: t };
}

export async function revertExtratoImportado(batchId: string): Promise<boolean> {
  if (!activeUserId) return false;
  const extrato = memExtratos.find((e) => e.id === batchId);
  if (!extrato) return false;
  if (extrato.status === "revertido") return true;

  // Hard delete em todas as tabelas com import_batch_id = batchId
  const tables = [
    "gastos",
    "receitas",
    "transferencias_internas",
    "dinheiro_guardado",
    "movimentacoes_meta",
  ];
  for (const tbl of tables) {
    const { error } = await sbAny
      .from(tbl)
      .delete()
      .eq("user_id", activeUserId)
      .eq("import_batch_id", batchId);
    if (error) {
      console.error(`[store] revertExtratoImportado: falha ao apagar de ${tbl}`, error);
      return false;
    }
  }

  // Marca o lote como revertido
  const now = new Date().toISOString();
  const { error: upErr } = await sbAny
    .from("extratos_importados")
    .update({ status: "revertido", reverted_at: now, updated_at: now })
    .eq("id", batchId)
    .eq("user_id", activeUserId);
  if (upErr) {
    console.error("[store] revertExtratoImportado: falha ao atualizar status", upErr);
    return false;
  }

  // Atualiza memória local
  memGastos = memGastos.filter((g) => g.importBatchId !== batchId);
  memReceitas = memReceitas.filter((r) => r.importBatchId !== batchId);
  memTransferencias = memTransferencias.filter((t) => t.importBatchId !== batchId);
  memGuardado = memGuardado.filter((g) => g.importBatchId !== batchId);
  memMov = memMov.filter((m) => m.importBatchId !== batchId);
  memExtratos = memExtratos.map((e) =>
    e.id === batchId
      ? { ...e, status: "revertido" as StatusExtratoImportado, revertedAt: now, atualizadoEm: now }
      : e,
  );
  emit();
  return true;
}

export async function deleteExtratoImportado(batchId: string): Promise<boolean> {
  if (!activeUserId) return false;
  // Só permite remover o registro do histórico se já estiver revertido (ou nunca tiver tido itens)
  const { error } = await sbAny
    .from("extratos_importados")
    .delete()
    .eq("id", batchId)
    .eq("user_id", activeUserId);
  if (error) {
    console.error("[store] deleteExtratoImportado failed", error);
    return false;
  }
  memExtratos = memExtratos.filter((e) => e.id !== batchId);
  emit();
  return true;
}

/**
 * Backfill: encontra lançamentos antigos importados de extrato (origem
 * começa com "extrato_pdf|", "extrato_csv|" ou "extrato_imagem|") que
 * NÃO possuem import_batch_id e os agrupa em lotes recuperados.
 *
 * Critério de agrupamento: mesmo banco + janela de 30 min do created_at.
 *
 * Para cada grupo, gera um batchId, atualiza os itens com import_batch_id
 * e cria um registro em extratos_importados marcado como recuperado.
 *
 * Idempotente: se nada para processar, retorna 0.
 */
export async function backfillExtratosImportados(): Promise<number> {
  if (!activeUserId) return 0;

  type ItemBackfill = {
    table: "gastos" | "receitas" | "transferencias_internas";
    id: string;
    valor: number;
    data: string;
    origem: string;
    createdAt: string;
    tipo: "gasto" | "receita" | "transferencia";
  };

  const isExtratoOrigem = (o?: string | null): o is string =>
    !!o && /^extrato_(pdf|csv|imagem)\|/i.test(o);

  const parseBancoFromOrigem = (origem: string): { tipoOrigem: TipoOrigemExtrato; banco: string } => {
    // Formato: "extrato_pdf|Mercado Pago" ou "extrato_pdf|Mercado Pago|op:..."
    const parts = origem.split("|");
    const head = (parts[0] || "").toLowerCase();
    const banco = (parts[1] || "Banco").trim() || "Banco";
    const tipoOrigem: TipoOrigemExtrato = head.includes("csv")
      ? "csv"
      : head.includes("imagem")
      ? "imagem"
      : "pdf";
    return { tipoOrigem, banco };
  };

  // Coleta candidatos sem import_batch_id
  const candidatos: ItemBackfill[] = [];
  for (const g of memGastos) {
    if (!g.importBatchId && isExtratoOrigem(g.origem)) {
      candidatos.push({
        table: "gastos",
        id: g.id,
        valor: g.valor,
        data: g.data,
        origem: g.origem!,
        createdAt: g.criadoEm,
        tipo: "gasto",
      });
    }
  }
  for (const r of memReceitas) {
    if (!r.importBatchId && isExtratoOrigem(r.origem)) {
      candidatos.push({
        table: "receitas",
        id: r.id,
        valor: r.valor,
        data: r.data,
        origem: r.origem!,
        createdAt: r.criadoEm,
        tipo: "receita",
      });
    }
  }
  for (const t of memTransferencias) {
    if (!t.importBatchId && isExtratoOrigem(t.origemImportacao)) {
      candidatos.push({
        table: "transferencias_internas",
        id: t.id,
        valor: t.valor,
        data: t.data,
        origem: t.origemImportacao!,
        createdAt: t.criadoEm,
        tipo: "transferencia",
      });
    }
  }

  if (candidatos.length === 0) return 0;

  // Agrupa por banco + janela de 30 min de created_at
  const WINDOW_MS = 30 * 60 * 1000;
  candidatos.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  type Grupo = {
    banco: string;
    tipoOrigem: TipoOrigemExtrato;
    itens: ItemBackfill[];
    minTs: number;
    maxTs: number;
  };
  const grupos: Grupo[] = [];

  for (const c of candidatos) {
    const { banco, tipoOrigem } = parseBancoFromOrigem(c.origem);
    const ts = new Date(c.createdAt).getTime();
    const grupo = grupos.find(
      (g) =>
        g.banco === banco &&
        g.tipoOrigem === tipoOrigem &&
        ts - g.maxTs <= WINDOW_MS,
    );
    if (grupo) {
      grupo.itens.push(c);
      grupo.maxTs = Math.max(grupo.maxTs, ts);
      grupo.minTs = Math.min(grupo.minTs, ts);
    } else {
      grupos.push({ banco, tipoOrigem, itens: [c], minTs: ts, maxTs: ts });
    }
  }

  let totalLotesCriados = 0;

  for (const g of grupos) {
    const batchId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Calcula totais e período
    let totalReceitas = 0;
    let totalDespesas = 0;
    let totalTransferencias = 0;
    let dMin: string | null = null;
    let dMax: string | null = null;

    for (const it of g.itens) {
      if (it.tipo === "receita") totalReceitas += Math.abs(it.valor);
      else if (it.tipo === "gasto") totalDespesas += Math.abs(it.valor);
      else totalTransferencias += Math.abs(it.valor);
      if (!dMin || it.data < dMin) dMin = it.data;
      if (!dMax || it.data > dMax) dMax = it.data;
    }

    // Atualiza import_batch_id por tabela em batches
    const idsPorTabela: Record<string, string[]> = {
      gastos: [],
      receitas: [],
      transferencias_internas: [],
    };
    for (const it of g.itens) idsPorTabela[it.table].push(it.id);

    let updateOk = true;
    for (const tbl of ["gastos", "receitas", "transferencias_internas"] as const) {
      const ids = idsPorTabela[tbl];
      if (ids.length === 0) continue;
      const { error } = await sbAny
        .from(tbl)
        .update({ import_batch_id: batchId })
        .eq("user_id", activeUserId)
        .in("id", ids);
      if (error) {
        console.error(`[store] backfill: falha ao atualizar ${tbl}`, error);
        updateOk = false;
        break;
      }
    }
    if (!updateOk) continue;

    const dataImportacao = new Date(g.maxTs).toISOString();
    const { error: insErr } = await sbAny.from("extratos_importados").insert({
      id: batchId,
      user_id: activeUserId,
      nome_arquivo: null,
      banco: g.banco,
      tipo_origem: g.tipoOrigem,
      data_importacao: dataImportacao,
      periodo_inicio: dMin,
      periodo_fim: dMax,
      qtd_movimentacoes: g.itens.length,
      qtd_duplicadas_ignoradas: 0,
      total_receitas: totalReceitas,
      total_despesas: totalDespesas,
      total_guardado: 0,
      total_transferencias: totalTransferencias,
      status: "importado",
      observacao: "Lote recuperado automaticamente",
    });
    if (insErr) {
      console.error("[store] backfill: falha ao criar registro de extrato", insErr);
      continue;
    }

    // Atualiza memória
    for (const it of g.itens) {
      if (it.table === "gastos") {
        memGastos = memGastos.map((x) => (x.id === it.id ? { ...x, importBatchId: batchId } : x));
      } else if (it.table === "receitas") {
        memReceitas = memReceitas.map((x) => (x.id === it.id ? { ...x, importBatchId: batchId } : x));
      } else {
        memTransferencias = memTransferencias.map((x) =>
          x.id === it.id ? { ...x, importBatchId: batchId } : x,
        );
      }
    }

    const novo: ExtratoImportado = {
      id: batchId,
      nomeArquivo: undefined,
      banco: g.banco,
      tipoOrigem: g.tipoOrigem,
      dataImportacao,
      periodoInicio: dMin ?? undefined,
      periodoFim: dMax ?? undefined,
      qtdMovimentacoes: g.itens.length,
      qtdDuplicadasIgnoradas: 0,
      totalReceitas,
      totalDespesas,
      totalGuardado: 0,
      totalTransferencias,
      status: "importado",
      observacao: "Lote recuperado automaticamente",
      criadoEm: dataImportacao,
      atualizadoEm: dataImportacao,
    };
    memExtratos = [novo, ...memExtratos];
    totalLotesCriados += 1;
  }

  if (totalLotesCriados > 0) emit();
  return totalLotesCriados;
}


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
  const [localReady, setLocalReady] = useState(localBootstrapReady);
  useEffect(() => {
    if (!localBootstrapReady) {
      bootstrapLocalDefaults();
      localBootstrapReady = true;
    }
    setLocalReady(true);
  }, []);
  // If no user is active, don't block on cloud hydration.
  if (!activeUserId) return localReady;
  return localReady && (status === "ready" || status === "error");
}

// ============================================================
// FATURAS CARTAO — status pago/aberta/fechada/vencida por mês/ano
// ============================================================
type FaturaRow = {
  id: string;
  user_id: string;
  cartao_id: string;
  mes: number;
  ano: number;
  status: string;
  data_pagamento: string | null;
  valor_pago: number | string;
  observacao: string | null;
};

function rowToFatura(r: FaturaRow): FaturaCartao {
  const allowed: StatusFatura[] = ["aberta", "fechada", "paga", "vencida"];
  const status = (allowed.includes(r.status as StatusFatura) ? r.status : "aberta") as StatusFatura;
  return {
    id: r.id,
    cartaoId: r.cartao_id,
    mes: Number(r.mes),
    ano: Number(r.ano),
    status,
    dataPagamento: r.data_pagamento ?? undefined,
    valorPago: Number(r.valor_pago) || 0,
    observacao: r.observacao ?? undefined,
  };
}

export function getFaturas(): FaturaCartao[] {
  return memFaturas;
}

export function getFatura(cartaoId: string, mes: number, ano: number): FaturaCartao | undefined {
  return memFaturas.find((f) => f.cartaoId === cartaoId && f.mes === mes && f.ano === ano);
}

/**
 * Calcula o ciclo da fatura. Convenção: `mes/ano` = MÊS DE REFERÊNCIA (mês
 * das compras). Para um cartão com diaFechamento=5, a fatura "Maio" abrange
 * compras feitas de 06/05 até 05/06 (fecha no início do mês seguinte).
 */
export function cicloFatura(cartao: Cartao, mes: number, ano: number): { inicio: Date; fim: Date } {
  const diaFech = cartao.diaFechamento && cartao.diaFechamento > 0 ? cartao.diaFechamento : 1;
  // inicio = dia seguinte ao fechamento do mês anterior (= dia seguinte ao
  // fechamento que ocorre no início do próprio mês de referência).
  const inicio = new Date(ano, mes - 1, diaFech + 1, 0, 0, 0, 0);
  // fim = fechamento do mês seguinte ao mês de referência.
  const fim = new Date(ano, mes, diaFech, 23, 59, 59, 999);
  return { inicio, fim };
}

/**
 * Retorna o "mês efetivo" do gasto para fins de Dashboard/Relatórios/Calendário.
 * - Crédito com invoice_month definido: usa invoice_month (fonte da verdade).
 * - Crédito SEM invoice_month: calcula pelo dia de fechamento do cartão.
 * - Outras formas de pagamento: usa a data da compra.
 *
 * Retorna { mes, ano } no formato 1-12 / yyyy.
 */
export function mesEfetivoGasto(g: Gasto): { mes: number; ano: number } {
  // Mês de referência manual SEMPRE prevalece (qualquer forma de pagamento).
  if (g.invoiceMonth && /^\d{4}-\d{2}$/.test(g.invoiceMonth)) {
    const [a, m] = g.invoiceMonth.split("-").map(Number);
    return { mes: m, ano: a };
  }
  if (g.formaPagamento === "credito") {
    // Convenção: mês de referência da fatura = mês das compras.
    // Se a compra foi feita ATÉ o dia de fechamento, ainda pertence à fatura
    // do mês anterior (ciclo que está prestes a fechar). Caso contrário,
    // pertence à fatura do próprio mês da compra.
    const cartao = g.cartaoId ? memCartoes.find((c) => c.id === g.cartaoId) : undefined;
    const d = parseDateLocal(g.data);
    if (d && cartao?.diaFechamento && cartao.diaFechamento > 0) {
      const ref = d.getDate() > cartao.diaFechamento
        ? d
        : new Date(d.getFullYear(), d.getMonth() - 1, 1);
      return { mes: ref.getMonth() + 1, ano: ref.getFullYear() };
    }
  }
  // Demais formas de pagamento ou crédito sem cartão: data da compra
  const d = parseDateLocal(g.data);
  if (d) return { mes: d.getMonth() + 1, ano: d.getFullYear() };
  return { mes: g.mes, ano: g.ano };
}

/** Filtra gastos pertencentes ao mês/ano efetivo (considera invoice_month no crédito). */
export function gastosNoMesEfetivo(gastos: Gasto[], mes: number, ano: number): Gasto[] {
  return gastos.filter((g) => {
    const eff = mesEfetivoGasto(g);
    return eff.mes === mes && eff.ano === ano;
  });
}

/**
 * Lista os lotes de importação (import_batch_id) de gastos no crédito
 * pertencentes a uma fatura específica. Útil para "excluir importação".
 */
export function lotesImportacaoFatura(
  cartaoId: string,
  mes: number,
  ano: number,
): Array<{ batchId: string; qtd: number; total: number; primeira: string; origem?: string }> {
  const compras = gastosDaFatura(cartaoId, mes, ano).filter((g) => g.importBatchId);
  const map = new Map<string, { batchId: string; qtd: number; total: number; primeira: string; origem?: string }>();
  for (const g of compras) {
    const k = g.importBatchId!;
    const cur = map.get(k) ?? { batchId: k, qtd: 0, total: 0, primeira: g.criadoEm ?? "", origem: g.origem };
    cur.qtd += 1;
    cur.total += g.valor;
    if (g.criadoEm && (!cur.primeira || g.criadoEm < cur.primeira)) cur.primeira = g.criadoEm;
    map.set(k, cur);
  }
  return Array.from(map.values()).sort((a, b) => (a.primeira < b.primeira ? 1 : -1));
}

/**
 * Apaga apenas os GASTOS (não toca em receitas/transferências) de um lote
 * de importação. Usado para desfazer uma importação de fatura sem afetar
 * gastos manuais da mesma fatura.
 */
export async function deleteGastosDoLote(batchId: string): Promise<number> {
  if (!activeUserId) return 0;
  const alvo = memGastos.filter((g) => g.importBatchId === batchId);
  if (alvo.length === 0) return 0;
  memGastos = memGastos.filter((g) => g.importBatchId !== batchId);
  emit();
  const { error } = await sbAny
    .from("gastos")
    .delete()
    .eq("user_id", activeUserId)
    .eq("import_batch_id", batchId);
  if (error) {
    console.error("[store] deleteGastosDoLote failed", error);
    void refreshGastos();
    return 0;
  }
  return alvo.length;
}

/**
 * Lista TODOS os lotes de importação de gastos de cartão (qualquer fatura).
 * Usado pelo histórico do diálogo "Importar fatura".
 */
type LoteImportInfo = {
  batchId: string;
  cartaoId?: string;
  invoiceMonth?: string;
  qtd: number;
  total: number;
  primeira: string;
  origem?: string;
};
let _lotesCacheSource: Gasto[] | null = null;
let _lotesCacheResult: LoteImportInfo[] = [];
export function lotesImportacaoTodos(): LoteImportInfo[] {
  if (_lotesCacheSource === memGastos) return _lotesCacheResult;
  const map = new Map<string, LoteImportInfo>();
  for (const g of memGastos) {
    if (g.formaPagamento !== "credito") continue;
    if (!g.importBatchId) continue;
    const k = g.importBatchId;
    const cur = map.get(k) ?? {
      batchId: k,
      cartaoId: g.cartaoId,
      invoiceMonth: g.invoiceMonth,
      qtd: 0,
      total: 0,
      primeira: g.criadoEm ?? "",
      origem: g.origem,
    };
    cur.qtd += 1;
    cur.total += g.valor;
    if (g.criadoEm && (!cur.primeira || g.criadoEm < cur.primeira)) cur.primeira = g.criadoEm;
    map.set(k, cur);
  }
  _lotesCacheSource = memGastos;
  _lotesCacheResult = Array.from(map.values()).sort((a, b) => (a.primeira < b.primeira ? 1 : -1));
  return _lotesCacheResult;
}

/**
 * Retorna os gastos pertencentes a um lote de importação.
 */
export function gastosDoLote(batchId: string): Gasto[] {
  return memGastos.filter((g) => g.importBatchId === batchId);
}

/**
 * Exclui em massa uma lista de gastos por id. Limpa também vínculos com
 * contas a pagar (mesma lógica do deleteGasto individual).
 */
export async function bulkDeleteGastos(ids: string[]): Promise<number> {
  if (!activeUserId || ids.length === 0) return 0;
  const setIds = new Set(ids);
  const alvo = memGastos.filter((g) => setIds.has(g.id));
  if (alvo.length === 0) return 0;
  memGastos = memGastos.filter((g) => !setIds.has(g.id));

  // Limpa vínculos de contas pagas que apontavam para esses gastos
  const contasVinculadas = memContas.filter((c) => c.gastoId && setIds.has(c.gastoId));
  if (contasVinculadas.length > 0) {
    memContas = memContas.map((c) =>
      c.gastoId && setIds.has(c.gastoId)
        ? {
            ...c,
            status: "pendente",
            dataPagamento: undefined,
            gastoId: undefined,
            atualizadoEm: new Date().toISOString(),
          }
        : c,
    );
    void sbAny
      .from("contas_a_pagar")
      .update({ status: "pendente", data_pagamento: null, gasto_id: null })
      .in("id", contasVinculadas.map((c) => c.id))
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error("[store] bulkDeleteGastos: cleanup contas failed", error);
      });
  }

  emit();
  const { error } = await sbAny
    .from("gastos")
    .delete()
    .eq("user_id", activeUserId)
    .in("id", alvo.map((g) => g.id));
  if (error) {
    console.error("[store] bulkDeleteGastos failed", error);
    void refreshGastos();
    return 0;
  }
  return alvo.length;
}

/**
 * Atualiza em massa o "Mês de referência" (invoice_month) de vários gastos.
 * Aceita YYYY-MM. Se vazio, limpa o campo.
 */
export async function bulkSetMesReferencia(ids: string[], ym: string | null): Promise<number> {
  if (!activeUserId || ids.length === 0) return 0;
  const valid = ym && /^\d{4}-\d{2}$/.test(ym) ? ym : null;
  const setIds = new Set(ids);
  const now = new Date().toISOString();
  memGastos = memGastos.map((g) =>
    setIds.has(g.id) ? { ...g, invoiceMonth: valid ?? undefined, atualizadoEm: now } : g,
  );
  emit();
  const { error } = await sbAny
    .from("gastos")
    .update({ invoice_month: valid })
    .eq("user_id", activeUserId)
    .in("id", Array.from(setIds));
  if (error) {
    console.error("[store] bulkSetMesReferencia failed", error);
    void refreshGastos();
    return 0;
  }
  return setIds.size;
}

export function gastosDaFatura(cartaoId: string, mes: number, ano: number): Gasto[] {
  const cartao = memCartoes.find((c) => c.id === cartaoId);
  if (!cartao) return [];
  const targetYm = `${ano}-${String(mes).padStart(2, "0")}`;
  const { inicio, fim } = cicloFatura(cartao, mes, ano);
  const analisados = normalizeGastosForCalculations(memGastos);
  return analisados
    .filter(
      (g) =>
        gastoCartaoId(g) === cartaoId &&
        g.formaPagamento === "credito" &&
        g.confirmado !== false,
    )
    .filter((g) => {
      // Fonte da verdade: invoice_month (mês da fatura escolhido pelo usuário).
      if (g.invoiceMonth && /^\d{4}-\d{2}$/.test(g.invoiceMonth)) {
        return g.invoiceMonth === targetYm;
      }
      // Fallback (gastos antigos sem invoice_month): usa o ciclo de fechamento.
      const d = parseDateLocal(g.data);
      return !!d && d >= inicio && d <= fim;
    })
    .sort((a, b) => (a.data < b.data ? 1 : -1));
}

export function resumoFaturaPorMes(cartaoId: string, mes: number, ano: number) {
  const cartao = memCartoes.find((c) => c.id === cartaoId);
  const limite = cartao?.limiteTotal ?? 0;
  const gastos = gastosDaFatura(cartaoId, mes, ano);
  const total = gastos.reduce((s, g) => s + g.valor, 0);
  return {
    total,
    limite,
    disponivel: Math.max(0, limite - total),
    pct: limite > 0 ? Math.min(100, (total / limite) * 100) : 0,
    qtd: gastos.length,
  };
}

/**
 * Calcula status efetivo da fatura: 'paga' (se marcada), 'vencida', 'fechada' ou 'aberta'.
 * Convenção: `mes/ano` = MÊS DE REFERÊNCIA das compras. O fechamento ocorre
 * normalmente no mês seguinte (ex.: fatura "Maio" fech=5 fecha em 05/06).
 */
export function statusEfetivoFatura(cartao: Cartao, mes: number, ano: number, hoje: Date = new Date()): StatusFatura {
  const registro = getFatura(cartao.id, mes, ano);
  if (registro?.status === "paga") return "paga";
  const diaFech = cartao.diaFechamento ?? 1;
  const diaVenc = cartao.diaVencimento ?? 10;
  // Fechamento da fatura "mes" ocorre em (ano, mes, diaFech) — mês seguinte.
  const dataFechamento = new Date(ano, mes, diaFech, 23, 59, 59, 999);
  // Vencimento: primeira ocorrência de diaVenc em ou após o fechamento.
  let dataVencimento = new Date(ano, mes, diaVenc, 23, 59, 59, 999);
  if (dataVencimento.getTime() < dataFechamento.getTime()) {
    dataVencimento = new Date(ano, mes + 1, diaVenc, 23, 59, 59, 999);
  }
  if (hoje > dataVencimento) return "vencida";
  if (hoje > dataFechamento) return "fechada";
  return "aberta";
}

/**
 * Retorna a "fatura corrente" do cartão como {mes, ano} = MÊS DE REFERÊNCIA
 * (mês das compras) do ciclo atualmente aberto, considerando o dia de
 * fechamento do cartão.
 *
 * - Se hoje > diaFechamento: o ciclo aberto começou neste mês → mes_ref = hoje.mes.
 * - Caso contrário: o ciclo aberto começou no mês anterior → mes_ref = hoje.mes - 1.
 */
export function faturaCorrente(
  cartao: Cartao,
  hoje: Date = new Date(),
): { mes: number; ano: number } {
  const diaFech = cartao.diaFechamento ?? 1;
  const baseDay = hoje.getDate();
  let y = hoje.getFullYear();
  let m0 = hoje.getMonth(); // 0-indexed
  if (baseDay <= diaFech) {
    // ciclo aberto começou no mês anterior
    m0 -= 1;
    if (m0 < 0) {
      m0 = 11;
      y -= 1;
    }
  }
  return { mes: m0 + 1, ano: y };
}

/* ====================================================================== *
 * HELPERS DE EXIBIÇÃO DA FATURA — convenção "mês de referência"           *
 * ---------------------------------------------------------------------- *
 * Convenção atual: faturas_cartao.{mes,ano} e gastos.invoice_month        *
 * representam o MÊS DE REFERÊNCIA (mês das compras). O fechamento e o     *
 * vencimento ocorrem normalmente no mês seguinte.                         *
 * ====================================================================== */

/** Próximo fechamento (futuro mais próximo) considerando hoje. */
export function proximoFechamentoData(cartao: Cartao, hoje: Date = new Date()): Date | null {
  if (!cartao.diaFechamento) return null;
  const ref = new Date(hoje.getFullYear(), hoje.getMonth(), cartao.diaFechamento, 23, 59, 59, 999);
  if (ref.getTime() < new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()) {
    return new Date(hoje.getFullYear(), hoje.getMonth() + 1, cartao.diaFechamento, 23, 59, 59, 999);
  }
  return ref;
}

/** Vencimento da fatura aberta (vence depois do próximo fechamento). */
export function proximoVencimentoFaturaAberta(
  cartao: Cartao,
  hoje: Date = new Date(),
): Date | null {
  if (!cartao.diaVencimento) return null;
  const fech = proximoFechamentoData(cartao, hoje);
  if (!fech) return null;
  let venc = new Date(fech.getFullYear(), fech.getMonth(), cartao.diaVencimento);
  if (venc.getTime() <= fech.getTime()) {
    venc = new Date(fech.getFullYear(), fech.getMonth() + 1, cartao.diaVencimento);
  }
  return venc;
}

/**
 * Mês de referência da fatura (identidade — `mes/ano` já são o mês das compras).
 */
export function mesReferenciaFatura(
  _cartao: Cartao,
  mes: number,
  ano: number,
): { mes: number; ano: number } {
  return { mes, ano };
}

/** Label "Maio de 2026" do mês de referência da fatura. */
export function mesReferenciaFaturaLabel(
  _cartao: Cartao,
  mes: number,
  ano: number,
): string {
  const nomes = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  return `${nomes[mes - 1]} de ${ano}`;
}

export async function marcarFaturaPaga(
  cartaoId: string,
  mes: number,
  ano: number,
  opts?: { dataPagamento?: string; valorPago?: number; observacao?: string },
): Promise<void> {
  if (!activeUserId) return;
  if (!ensureCanWrite("marcarFaturaPaga")) return;
  const existente = getFatura(cartaoId, mes, ano);
  const valorPago = opts?.valorPago ?? resumoFaturaPorMes(cartaoId, mes, ano).total;
  const dataPagamento = opts?.dataPagamento ?? toLocalISODate(new Date());
  const observacao = opts?.observacao;

  if (existente) {
    const updated: FaturaCartao = {
      ...existente,
      status: "paga",
      dataPagamento,
      valorPago,
      observacao: observacao ?? existente.observacao,
    };
    memFaturas = memFaturas.map((f) => (f.id === existente.id ? updated : f));
    emit();
    const { error } = await sbAny
      .from("faturas_cartao")
      .update({
        status: "paga",
        data_pagamento: dataPagamento,
        valor_pago: valorPago,
        observacao: observacao ?? existente.observacao ?? null,
      })
      .eq("id", existente.id);
    if (error) {
      console.error("[store] marcarFaturaPaga update failed", error);
    }
  } else {
    const tempId = `temp-${Math.random().toString(36).slice(2)}`;
    const novo: FaturaCartao = {
      id: tempId,
      cartaoId,
      mes,
      ano,
      status: "paga",
      dataPagamento,
      valorPago,
      observacao,
    };
    memFaturas = [...memFaturas, novo];
    emit();
    const { data, error } = await sbAny
      .from("faturas_cartao")
      .insert({
        user_id: activeUserId,
        cartao_id: cartaoId,
        mes,
        ano,
        status: "paga",
        data_pagamento: dataPagamento,
        valor_pago: valorPago,
        observacao: observacao ?? null,
      })
      .select()
      .single();
    if (error) {
      console.error("[store] marcarFaturaPaga insert failed", error);
      memFaturas = memFaturas.filter((f) => f.id !== tempId);
      emit();
    } else if (data) {
      const persisted = rowToFatura(data as FaturaRow);
      memFaturas = memFaturas.map((f) => (f.id === tempId ? persisted : f));
      emit();
    }
  }
  // Resolve alertas de fatura vencida/vencendo deste cartão+mês — a pendência
  // foi paga, o sininho não deve mais sinalizar.
  const ymKey = `${ano}-${String(mes).padStart(2, "0")}`;
  void resolveAlertasPorDedupeKey(`fatura_vencida:${cartaoId}:${ymKey}`);
  void resolveAlertasPorDedupeKey(`fatura_vencendo:${cartaoId}:${ymKey}`);
}

export async function desmarcarFaturaPaga(cartaoId: string, mes: number, ano: number): Promise<void> {
  if (!activeUserId) return;
  if (!ensureCanWrite("desmarcarFaturaPaga")) return;
  const existente = getFatura(cartaoId, mes, ano);
  if (!existente) return;
  memFaturas = memFaturas.filter((f) => f.id !== existente.id);
  emit();
  const { error } = await sbAny.from("faturas_cartao").delete().eq("id", existente.id);
  if (error) {
    console.error("[store] desmarcarFaturaPaga failed", error);
  }
}
