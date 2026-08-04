/**
 * Módulo: Assinaturas e Recorrências
 *
 * - Detecta recorrências a partir dos gastos existentes (sem alterar o store de gastos).
 * - Persiste apenas recorrências confirmadas/manuais em `public.recorrencias`.
 * - Não cria gastos automaticamente. Botão "Gerar gasto deste mês" é opcional.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getGastos, getCartoes, useStore, addGasto, type NovoGastoInput } from "@/lib/store";
import type { Gasto, FormaPagamento } from "@/lib/types";
import { suggestCategoryFromText } from "@/lib/categories";
import { hasMerchantLogo } from "@/lib/logos";
import { parseDateLocal, toLocalISODate } from "@/lib/format";

export type FrequenciaRecorrencia = "mensal" | "semanal" | "quinzenal" | "anual" | "personalizada";

export type StatusRecorrencia = "ativa" | "pausada" | "cancelada" | "suspeita" | "aguardando";

export type TipoRecorrencia = "assinatura" | "recorrencia_fixa";

export type MoedaRecorrencia = "BRL" | "USD" | "EUR";

export type Recorrencia = {
  id: string;
  nome: string;
  valor: number;
  categoriaId?: string | null;
  frequencia: FrequenciaRecorrencia;
  proximaCobranca?: string | null; // YYYY-MM-DD
  formaPagamento?: FormaPagamento | null;
  cartaoId?: string | null;
  status: StatusRecorrencia;
  tipoRecorrencia: TipoRecorrencia;
  origem: "manual" | "detectada";
  observacao?: string | null;
  ultimoValor?: number | null;
  detectionKey?: string | null;
  moeda?: MoedaRecorrencia;
  valorOriginal?: number | null;
  criadoEm: string;
  atualizadoEm: string;
};

export type RecorrenciaSugerida = {
  detectionKey: string;
  nome: string;
  valor: number;
  ultimoValor?: number;
  categoriaId?: string;
  formaPagamento?: FormaPagamento;
  cartaoId?: string;
  frequencia: FrequenciaRecorrencia;
  proximaCobranca?: string;
  ocorrencias: number;
  ultimaData: string;
  variacaoValor?: number; // diferença entre último e penúltimo
  gastoIds: string[];
  tipoRecorrencia: TipoRecorrencia;
};

const FREQ_VALUES: FrequenciaRecorrencia[] = [
  "mensal",
  "semanal",
  "quinzenal",
  "anual",
  "personalizada",
];
const STATUS_VALUES: StatusRecorrencia[] = [
  "ativa",
  "pausada",
  "cancelada",
  "suspeita",
  "aguardando",
];

// ============================================================
// CACHE EM MEMÓRIA + EVENT EMITTER (estilo store.ts)
// ============================================================
let memRec: Recorrencia[] = [];
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let hydratedUserId: string | null = null;
let hydrating = false;
let categoriaKeyToUuidRec = new Map<string, string>();
let categoriaUuidToKeyRec = new Map<string, string>();

function isUuid(v: string | null | undefined): boolean {
  return (
    !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

async function syncCategoriaMaps(userId: string): Promise<void> {
  const { data, error } = await (supabase as any)
    .from("categorias")
    .select("id, legacy_id, nome")
    .eq("user_id", userId);
  if (error) {
    console.warn("[recorrencias] categorias map warning", error);
    return;
  }
  categoriaKeyToUuidRec = new Map();
  categoriaUuidToKeyRec = new Map();
  for (const c of data ?? []) {
    const key = c.legacy_id || c.id;
    categoriaKeyToUuidRec.set(key, c.id);
    categoriaUuidToKeyRec.set(c.id, key);
  }
}

function categoriaKeyFromDb(id: string | null | undefined): string | null {
  if (!id) return null;
  return categoriaUuidToKeyRec.get(id) ?? id;
}

async function categoriaDbId(
  userId: string | null,
  id: string | null | undefined,
): Promise<string | null> {
  if (!id || id === "outros") return null;
  if (isUuid(id)) return id;
  if (userId && categoriaKeyToUuidRec.size === 0) await syncCategoriaMaps(userId);
  return categoriaKeyToUuidRec.get(id) ?? null;
}

function rowToRec(r: any): Recorrencia {
  const freq = FREQ_VALUES.includes(r.frequencia) ? r.frequencia : "mensal";
  const status = STATUS_VALUES.includes(r.status) ? r.status : "ativa";
  const tipo: TipoRecorrencia =
    r.tipo_recorrencia === "recorrencia_fixa" ? "recorrencia_fixa" : "assinatura";
  return {
    id: r.id,
    nome: r.nome,
    valor: Number(r.valor) || 0,
    categoriaId: categoriaKeyFromDb(r.categoria_id),
    frequencia: freq,
    proximaCobranca: r.proxima_cobranca ?? null,
    formaPagamento: (r.forma_pagamento ?? null) as FormaPagamento | null,
    cartaoId: r.cartao_id ?? null,
    status,
    tipoRecorrencia: tipo,
    origem: r.origem === "detectada" ? "detectada" : "manual",
    observacao: r.observacao ?? null,
    ultimoValor: r.ultimo_valor != null ? Number(r.ultimo_valor) : null,
    detectionKey: r.detection_key ?? null,
    moeda: (r.moeda === "USD" || r.moeda === "EUR" ? r.moeda : "BRL") as MoedaRecorrencia,
    valorOriginal: r.valor_original != null ? Number(r.valor_original) : null,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
  };
}

export async function hydrateRecorrencias(userId: string | null): Promise<void> {
  if (!userId) {
    memRec = [];
    hydratedUserId = null;
    emit();
    return;
  }
  if (hydratedUserId === userId || hydrating) return;
  hydrating = true;
  try {
    await syncCategoriaMaps(userId);
    const { data, error } = await (supabase as any)
      .from("recorrencias")
      .select("*")
      .eq("user_id", userId)
      .neq("status", "excluida")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[recorrencias] hydrate failed", error);
      return;
    }
    memRec = (data ?? []).map(rowToRec);
    hydratedUserId = userId;
    emit();
  } finally {
    hydrating = false;
  }
}

export function getRecorrencias(): Recorrencia[] {
  return memRec;
}

export function useRecorrencias(): Recorrencia[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return () => {
      unsub;
    };
  }, []);
  return memRec;
}

// ============================================================
// DETECÇÃO AUTOMÁTICA
// ============================================================

/** Normaliza o nome para chave de agrupamento. */
function normName(n: string): string {
  return (n || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(assinatura|mensalidade|plano|subscription)\b/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Diferença em dias entre duas datas ISO. */
function diasEntre(a: string, b: string): number {
  const da = parseDateLocal(a);
  const db = parseDateLocal(b);
  if (!da || !db) return 0;
  return Math.abs(Math.round((db.getTime() - da.getTime()) / 86400000));
}

/** Detecta a frequência a partir dos intervalos médios entre ocorrências. */
function inferFrequencia(datasOrdenadas: string[]): FrequenciaRecorrencia {
  if (datasOrdenadas.length < 2) return "mensal";
  const intervalos: number[] = [];
  for (let i = 1; i < datasOrdenadas.length; i++) {
    intervalos.push(diasEntre(datasOrdenadas[i - 1], datasOrdenadas[i]));
  }
  const media = intervalos.reduce((s, x) => s + x, 0) / intervalos.length;
  if (media <= 10) return "semanal";
  if (media <= 20) return "quinzenal";
  if (media <= 45) return "mensal";
  if (media <= 200) return "mensal";
  return "anual";
}

/** Adiciona o intervalo da frequência a uma data ISO. */
export function proximaDataApartirDe(iso: string, freq: FrequenciaRecorrencia): string {
  const d = parseDateLocal(iso) ?? new Date();
  switch (freq) {
    case "semanal":
      d.setDate(d.getDate() + 7);
      break;
    case "quinzenal":
      d.setDate(d.getDate() + 15);
      break;
    case "anual":
      d.setFullYear(d.getFullYear() + 1);
      break;
    case "personalizada":
    case "mensal":
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return toLocalISODate(d);
}

/**
 * Palavras-chave fortes que indicam alta probabilidade de recorrência mesmo
 * com apenas 1 ocorrência.
 */
const RECURRENCE_KEYWORDS = [
  "spotify",
  "netflix",
  "totalpass",
  "meli+",
  "meli +",
  "melimais",
  "apple music",
  "apple tv",
  "disney",
  "amazon prime",
  "prime video",
  "assinatura",
  "mensalidade",
  "plano",
  "academia",
  "internet",
  "aluguel",
  "condominio",
  "seguro",
  "celular",
  "telefone",
  "streaming",
  "curso",
  "faculdade",
  "escola",
  "software",
  "armazenamento",
  "cloud",
  "icloud",
  "google one",
  "microsoft",
  "adobe",
  "youtube premium",
  "hbo",
  "max",
  "deezer",
  "tidal",
  "dropbox",
];

const ASSINATURA_KEYWORDS = [
  "spotify",
  "netflix",
  "totalpass",
  "total pass",
  "gympass",
  "meli+",
  "meli +",
  "melimais",
  "apple",
  "disney",
  "amazon prime",
  "prime video",
  "assinatura",
  "streaming",
  "software",
  "adobe",
  "microsoft",
  "google one",
  "icloud",
  "youtube premium",
  "hbo",
  "max",
  "deezer",
  "tidal",
  "dropbox",
];

const RECORRENCIA_FIXA_KEYWORDS = [
  "aluguel",
  "condominio",
  "internet",
  "seguro",
  "celular",
  "telefone",
  "mensalidade",
  "plano",
  "academia",
  "curso",
  "faculdade",
  "escola",
];

/** Categorias cujos gastos têm forte indício de serem recorrentes. */
const RECURRENCE_CATEGORY_KEYS = [
  "assinatura",
  "assinaturas",
  "aluguel",
  "moradia",
  "internet",
  "educacao",
  "academia",
  "plano",
  "mensalidade",
  "streaming",
];

function textoSugereRecorrencia(
  estabelecimento: string,
  descricao: string,
  categoriaNome: string | null | undefined,
): boolean {
  const haystack = `${estabelecimento} ${descricao} ${categoriaNome ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (RECURRENCE_KEYWORDS.some((k) => haystack.includes(k))) return true;
  const catNorm = (categoriaNome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (catNorm && RECURRENCE_CATEGORY_KEYS.some((k) => catNorm.includes(k))) return true;
  return false;
}

function normalizeText(text: string): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function classificarTipoRecorrencia(
  estabelecimento: string,
  descricao: string,
  categoriaNome: string | null | undefined,
): TipoRecorrencia {
  const haystack = normalizeText(`${estabelecimento} ${descricao} ${categoriaNome ?? ""}`);
  const assinatura = ASSINATURA_KEYWORDS.some((k) => haystack.includes(normalizeText(k)));
  const fixa = RECORRENCIA_FIXA_KEYWORDS.some((k) => haystack.includes(normalizeText(k)));
  if (fixa && !assinatura) return "recorrencia_fixa";
  return "assinatura";
}

function categoriaSugeridaParaRecorrencia(
  tipo: TipoRecorrencia,
  nome: string,
  categoriaId?: string | null,
): string | null | undefined {
  const t = normalizeText(nome);
  if (tipo === "assinatura") return "assinaturas";
  if (t.includes("aluguel")) return "aluguel";
  if (categoriaId && categoriaId !== "outros" && categoriaId !== "assinaturas") return categoriaId;
  const sugerida = suggestCategoryFromText(nome);
  if (sugerida && sugerida !== "outros" && sugerida !== "assinaturas") return sugerida;
  return "moradia";
}

/** Agrupa gastos e identifica candidatos a recorrência. */
export function detectarRecorrencias(
  gastos: Gasto[],
  opts?: { categoriaNomePorId?: (id: string | null | undefined) => string | null },
): RecorrenciaSugerida[] {
  const getCatNome = opts?.categoriaNomePorId ?? (() => null);
  // Agrupa por nome normalizado + valor próximo (tolerância 5%).
  const grupos = new Map<string, Gasto[]>();
  for (const g of gastos) {
    const nomeBase = g.estabelecimento || g.descricao;
    if (!g.confirmado || !nomeBase) continue;
    const key = normName(nomeBase);
    if (!key) continue;
    grupos.set(key, [...(grupos.get(key) ?? []), g]);
  }

  const sugeridas: RecorrenciaSugerida[] = [];
  for (const [nameKey, lista] of grupos) {
    // Caso especial: 1 ocorrência com palavra-chave forte → vira "suspeita".
    if (lista.length === 1) {
      const g = lista[0];
      const catNome = getCatNome(g.categoriaId);
      if (!textoSugereRecorrencia(g.estabelecimento || "", g.descricao || "", catNome)) {
        continue;
      }
      const nome = g.estabelecimento || g.descricao || nameKey;
      const tipoRecorrencia = classificarTipoRecorrencia(nome, g.descricao || "", catNome);
      const proxCob = proximaDataApartirDe(g.data, "mensal");
      const detectionKey = `${nameKey}__${g.valor.toFixed(2)}__mensal`;
      sugeridas.push({
        detectionKey,
        nome,
        valor: g.valor,
        ultimoValor: undefined,
        categoriaId:
          categoriaSugeridaParaRecorrencia(tipoRecorrencia, nome, g.categoriaId) ?? undefined,
        formaPagamento: g.formaPagamento,
        cartaoId: g.cartaoId,
        frequencia: "mensal",
        proximaCobranca: proxCob,
        ocorrencias: 1,
        ultimaData: g.data,
        variacaoValor: undefined,
        gastoIds: [g.id],
        tipoRecorrencia,
      });
      continue;
    }
    if (lista.length < 2) continue;

    // Subgrupos por valor (tolerância: 5% ou ±R$1, o maior).
    const buckets: Gasto[][] = [];
    const ordenados = [...lista].sort((a, b) => a.valor - b.valor);
    for (const g of ordenados) {
      let placed = false;
      for (const b of buckets) {
        const ref = b[b.length - 1].valor;
        const tol = Math.max(1, ref * 0.05);
        if (Math.abs(g.valor - ref) <= tol) {
          b.push(g);
          placed = true;
          break;
        }
      }
      if (!placed) buckets.push([g]);
    }

    for (const bucket of buckets) {
      const porData = [...bucket].sort((a, b) => (a.data < b.data ? -1 : 1));
      const datas = porData.map((g) => g.data);
      const ultimo = porData[porData.length - 1];
      const catNome = getCatNome(ultimo.categoriaId);
      const temIndicio = textoSugereRecorrencia(
        ultimo.estabelecimento || "",
        ultimo.descricao || "",
        catNome,
      );

      // Bucket de 1 só com indício forte → suspeita
      if (bucket.length < 2) {
        if (!temIndicio) continue;
        const nome = ultimo.estabelecimento || ultimo.descricao || nameKey;
        const tipoRecorrencia = classificarTipoRecorrencia(nome, ultimo.descricao || "", catNome);
        const proxCob = proximaDataApartirDe(ultimo.data, "mensal");
        const detectionKey = `${nameKey}__${ultimo.valor.toFixed(2)}__mensal`;
        sugeridas.push({
          detectionKey,
          nome,
          valor: ultimo.valor,
          categoriaId:
            categoriaSugeridaParaRecorrencia(tipoRecorrencia, nome, ultimo.categoriaId) ??
            undefined,
          formaPagamento: ultimo.formaPagamento,
          cartaoId: ultimo.cartaoId,
          frequencia: "mensal",
          proximaCobranca: proxCob,
          ocorrencias: 1,
          ultimaData: ultimo.data,
          gastoIds: [ultimo.id],
          tipoRecorrencia,
        });
        continue;
      }

      const intervalos: number[] = [];
      for (let i = 1; i < datas.length; i++) {
        intervalos.push(diasEntre(datas[i - 1], datas[i]));
      }
      const media = intervalos.reduce((s, x) => s + x, 0) / intervalos.length;
      // Filtros de regularidade: relaxados quando há indício de recorrência
      if (!temIndicio) {
        if (media < 5 || media > 400) continue;
        const desvio = Math.max(...intervalos.map((x) => Math.abs(x - media)));
        if (desvio > Math.max(7, media * 0.4)) continue;
      } else {
        if (media < 3 || media > 400) continue;
      }

      const freq = inferFrequencia(datas);
      const penultimo = porData[porData.length - 2];
      const proxCob = proximaDataApartirDe(ultimo.data, freq);
      const detectionKey = `${nameKey}__${ultimo.valor.toFixed(2)}__${freq}`;
      const variacao = ultimo.valor - penultimo.valor;
      const nome = ultimo.estabelecimento || ultimo.descricao || nameKey;
      const tipoRecorrencia = classificarTipoRecorrencia(nome, ultimo.descricao || "", catNome);

      sugeridas.push({
        detectionKey,
        nome,
        valor: ultimo.valor,
        ultimoValor: penultimo.valor,
        categoriaId:
          categoriaSugeridaParaRecorrencia(tipoRecorrencia, nome, ultimo.categoriaId) ?? undefined,
        formaPagamento: ultimo.formaPagamento,
        cartaoId: ultimo.cartaoId,
        frequencia: freq,
        proximaCobranca: proxCob,
        ocorrencias: porData.length,
        ultimaData: ultimo.data,
        variacaoValor: Math.abs(variacao) > 0.01 ? variacao : undefined,
        gastoIds: porData.map((g) => g.id),
        tipoRecorrencia,
      });
    }
  }

  return sugeridas.sort((a, b) => b.ocorrencias - a.ocorrencias);
}

// ============================================================
// CRUD
// ============================================================

export type NovaRecorrenciaInput = {
  nome: string;
  valor: number;
  categoriaId?: string | null;
  frequencia: FrequenciaRecorrencia;
  proximaCobranca?: string | null;
  formaPagamento?: FormaPagamento | null;
  cartaoId?: string | null;
  status?: StatusRecorrencia;
  tipoRecorrencia?: TipoRecorrencia;
  origem?: "manual" | "detectada";
  observacao?: string | null;
  ultimoValor?: number | null;
  detectionKey?: string | null;
  moeda?: MoedaRecorrencia;
  valorOriginal?: number | null;
};

export async function criarRecorrencia(
  userId: string,
  input: NovaRecorrenciaInput,
): Promise<Recorrencia | null> {
  // Evitar duplicidade por detection_key
  if (input.detectionKey) {
    const existente = memRec.find((r) => r.detectionKey === input.detectionKey);
    if (existente) return existente;
  }
  // Evitar duplicidade por nome+valor+frequencia (manual)
  const dupManual = memRec.find(
    (r) =>
      r.nome.trim().toLowerCase() === input.nome.trim().toLowerCase() &&
      Math.abs(r.valor - input.valor) < 0.01 &&
      r.frequencia === input.frequencia &&
      r.status !== "cancelada",
  );
  if (dupManual) return dupManual;

  const payload: any = {
    user_id: userId,
    nome: input.nome.trim(),
    valor: input.valor,
    categoria_id: await categoriaDbId(userId, input.categoriaId),
    frequencia: input.frequencia,
    proxima_cobranca: input.proximaCobranca ?? null,
    forma_pagamento: input.formaPagamento ?? null,
    cartao_id: input.cartaoId ?? null,
    status: input.status ?? "ativa",
    tipo_recorrencia: input.tipoRecorrencia ?? "assinatura",
    origem: input.origem ?? "manual",
    observacao: input.observacao ?? null,
    ultimo_valor: input.ultimoValor ?? null,
    detection_key: input.detectionKey ?? null,
    moeda: input.moeda ?? "BRL",
    valor_original: input.valorOriginal ?? null,
  };

  const { data, error } = await (supabase as any)
    .from("recorrencias")
    .insert(payload)
    .select()
    .single();
  if (error) {
    console.error("[recorrencias] criar failed", error);
    return null;
  }
  const rec = rowToRec(data);
  memRec = [rec, ...memRec];
  emit();
  return rec;
}

export async function atualizarRecorrencia(
  id: string,
  patch: Partial<NovaRecorrenciaInput> & { status?: StatusRecorrencia },
): Promise<void> {
  const update: any = {};
  if (patch.nome !== undefined) update.nome = patch.nome;
  if (patch.valor !== undefined) update.valor = patch.valor;
  if (patch.categoriaId !== undefined)
    update.categoria_id = await categoriaDbId(hydratedUserId, patch.categoriaId);
  if (patch.frequencia !== undefined) update.frequencia = patch.frequencia;
  if (patch.proximaCobranca !== undefined) update.proxima_cobranca = patch.proximaCobranca;
  if (patch.formaPagamento !== undefined) update.forma_pagamento = patch.formaPagamento;
  if (patch.cartaoId !== undefined) update.cartao_id = patch.cartaoId;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.tipoRecorrencia !== undefined) update.tipo_recorrencia = patch.tipoRecorrencia;
  if (patch.observacao !== undefined) update.observacao = patch.observacao;
  if (patch.ultimoValor !== undefined) update.ultimo_valor = patch.ultimoValor;
  if (patch.moeda !== undefined) update.moeda = patch.moeda;
  if (patch.valorOriginal !== undefined) update.valor_original = patch.valorOriginal;

  const { data, error } = await (supabase as any)
    .from("recorrencias")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    console.error("[recorrencias] atualizar failed", error);
    return;
  }
  const rec = rowToRec(data);
  memRec = memRec.map((r) => (r.id === id ? rec : r));
  emit();
  // Se a recorrência foi cancelada, resolver alertas órfãos.
  if (patch.status === "cancelada") {
    try {
      const { resolveAlertasDe } = await import("@/lib/store");
      await resolveAlertasDe("recorrencia", id);
    } catch (e) {
      console.error("[recorrencias] resolveAlertasDe failed", e);
    }
  }
}

export async function excluirRecorrencia(id: string): Promise<void> {
  // Soft-delete: mantém o registro (preservando detection_key) para que a
  // detecção automática NÃO recrie a mesma recorrência depois do F5.
  // A UI filtra registros com status "excluida".
  const now = new Date().toISOString();
  const { error } = await (supabase as any)
    .from("recorrencias")
    .update({ status: "excluida", updated_at: now })
    .eq("id", id);
  if (error) {
    console.error("[recorrencias] excluir failed", error);
    return;
  }
  memRec = memRec.filter((r) => r.id !== id);
  emit();
  // Resolve alertas órfãos vinculados à recorrência (assinatura em alta,
  // novo serviço detectado etc.) — após F5 não devem reaparecer.
  try {
    const { resolveAlertasDe } = await import("@/lib/store");
    await resolveAlertasDe("recorrencia", id);
  } catch (e) {
    console.error("[recorrencias] resolveAlertasDe failed", e);
  }
}

/**
 * Ao abrir a página, faz a sincronização inicial com base nos gastos:
 * - 3+ ocorrências → cria automaticamente como ATIVA (origem detectada).
 * - 2 ocorrências  → cria como SUSPEITA aguardando confirmação.
 * Sempre respeita detection_key para evitar duplicidade.
 */
export async function sincronizarDeteccoes(
  userId: string,
  gastos: Gasto[],
  opts?: { categoriaNomePorId?: (id: string | null | undefined) => string | null },
): Promise<{
  criadas: number;
  suspeitas: number;
  analisados: number;
  encontradas: number;
  assinaturas: number;
  fixas: number;
}> {
  await hydrateRecorrencias(userId);
  await syncCategoriaMaps(userId);
  // Busca TODAS as detection_keys (incluindo soft-deleted) para evitar recriar
  // recorrências que o usuário excluiu manualmente.
  const { data: existentesAll } = await (supabase as any)
    .from("recorrencias")
    .select("id, detection_key, status")
    .eq("user_id", userId);
  const detectionKeysExistentes = new Set<string>(
    ((existentesAll ?? []) as Array<{ detection_key: string | null }>)
      .map((r) => r.detection_key)
      .filter((k): k is string => !!k),
  );
  const sugeridas = detectarRecorrencias(gastos, opts);
  let criadas = 0;
  let suspeitas = 0;
  let assinaturas = 0;
  let fixas = 0;
  for (const s of sugeridas) {
    if (s.tipoRecorrencia === "recorrencia_fixa") fixas++;
    else assinaturas++;
    // Se já existe (mesmo soft-deleted), não recriar.
    if (detectionKeysExistentes.has(s.detectionKey)) {
      const existente = memRec.find((r) => r.detectionKey === s.detectionKey);
      if (existente) {
        // Atualiza valor/próxima cobrança se houver mudança
        await atualizarRecorrencia(existente.id, {
          valor: s.valor,
          ultimoValor:
            Math.abs(existente.valor - s.valor) > 0.01 ? existente.valor : existente.ultimoValor,
          categoriaId: s.categoriaId,
          tipoRecorrencia: s.tipoRecorrencia,
          proximaCobranca: s.proximaCobranca,
        });
      }
      continue;
    }
    const status: StatusRecorrencia = s.ocorrencias >= 3 ? "ativa" : "suspeita";
    const categoriaId = s.categoriaId || suggestCategoryFromText(s.nome) || undefined;
    const created = await criarRecorrencia(userId, {
      nome: s.nome,
      valor: s.valor,
      categoriaId: categoriaId === "outros" ? null : categoriaId,
      frequencia: s.frequencia,
      proximaCobranca: s.proximaCobranca,
      formaPagamento: s.formaPagamento,
      cartaoId: s.cartaoId,
      status,
      tipoRecorrencia: s.tipoRecorrencia,
      origem: "detectada",
      ultimoValor: s.ultimoValor,
      detectionKey: s.detectionKey,
    });
    if (created) {
      if (status === "ativa") criadas++;
      else suspeitas++;
    }
  }
  return {
    criadas,
    suspeitas,
    analisados: gastos.filter((g) => g.confirmado && (g.estabelecimento || g.descricao)).length,
    encontradas: sugeridas.length,
    assinaturas,
    fixas,
  };
}

// ============================================================
// DERIVED
// ============================================================

/** Converte para "valor mensal equivalente" para somar no card de total. */
export function valorMensalEquivalente(r: Recorrencia): number {
  switch (r.frequencia) {
    case "semanal":
      return r.valor * 4.345;
    case "quinzenal":
      return r.valor * 2.1725;
    case "anual":
      return r.valor / 12;
    case "personalizada":
    case "mensal":
    default:
      return r.valor;
  }
}

export function totaisRecorrencias(recs: Recorrencia[]): {
  mensal: number;
  anual: number;
  ativas: number;
} {
  const ativas = recs.filter((r) => r.status === "ativa");
  const mensal = ativas.reduce((s, r) => s + valorMensalEquivalente(r), 0);
  return { mensal, anual: mensal * 12, ativas: ativas.length };
}

/** Gera um gasto real a partir da recorrência (sem automatismo recorrente). */
export async function gerarGastoDoMes(
  rec: Recorrencia,
): Promise<{ ok: boolean; gastoId?: string }> {
  const hoje = new Date();
  const data = rec.proximaCobranca ?? toLocalISODate(hoje);
  const input: NovoGastoInput = {
    descricao: rec.nome,
    estabelecimento: rec.nome,
    valor: rec.valor,
    data,
    categoriaId: rec.categoriaId ?? "outros",
    formaPagamento: (rec.formaPagamento ?? "pix") as FormaPagamento,
    cartaoId: rec.cartaoId ?? undefined,
    tipoGasto: "unico",
    observacao: `Gerado a partir da recorrência: ${rec.nome}`,
    origem: "recorrencia",
  };

  const created = addGasto(input);
  const novo = Array.isArray(created) ? created[0] : null;
  if (!novo) return { ok: false };

  // Avança a próxima cobrança
  await atualizarRecorrencia(rec.id, {
    proximaCobranca: proximaDataApartirDe(data, rec.frequencia),
  });

  return { ok: true, gastoId: novo.id };
}

/** Histórico de gastos vinculados (por nome+valor próximo). */
export function historicoDaRecorrencia(rec: Recorrencia, gastos: Gasto[]): Gasto[] {
  const key = normName(rec.nome);
  const tol = Math.max(1, rec.valor * 0.1);
  return gastos
    .filter((g) => {
      if (!g.estabelecimento) return false;
      if (normName(g.estabelecimento) !== key) return false;
      return Math.abs(g.valor - rec.valor) <= tol;
    })
    .sort((a, b) => (a.data < b.data ? 1 : -1));
}

export function temLogo(nome: string): boolean {
  return hasMerchantLogo(nome);
}

// Helper hook combinado (gastos + recorrências)
export function useRecorrenciasComGastos() {
  const recs = useRecorrencias();
  const gastos = useStore(getGastos);
  const cartoes = useStore(getCartoes);
  return { recs, gastos, cartoes };
}
