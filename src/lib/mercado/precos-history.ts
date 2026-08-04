/**
 * Mercado Inteligente — Preparação da arquitetura de histórico de preços.
 *
 * STATUS ATUAL: este módulo é apenas a **camada de tipos e transformação pura**.
 * Não persiste nada, não faz rede, não compartilha dados entre usuários.
 *
 * Princípios de privacidade que devem ser respeitados em qualquer evolução:
 *   1. Todo registro nasce PRIVADO (`visibility: "private"`).
 *   2. Nenhum dado pessoal (nome, email, id do auth) é incluído nestes DTOs.
 *      O vínculo com o usuário deve ser feito apenas no backend, via auth.uid,
 *      e nunca ficar visível para outros usuários.
 *   3. Qualquer uso coletivo futuro precisa ser opt-in explícito e
 *      anonimizado/agregado (ver `MercadoPrecoAgregado`).
 *   4. Geolocalização (cidade/UF) é opcional e só deve ser preenchida se o
 *      usuário fornecer manualmente ou autorizar de forma explícita.
 *
 * EVOLUÇÃO FUTURA (não criar agora — apenas referência de modelo mental):
 *   - Tabela `mercado_produtos`           → catálogo normalizado por nome/EAN
 *   - Tabela `mercado_estabelecimentos`   → mercados informados pelo usuário
 *   - Tabela `mercado_precos_usuario`     → 1 linha por compra/item (PRIVADO, RLS por user_id)
 *   - Tabela `mercado_precos_agregados`   → médias/min/max derivadas, sem user_id
 *
 * Quando essas tabelas existirem, esta camada continua útil:
 *   - `itemParaRegistroPrivado()` produz o payload exato para insert privado.
 *   - O agregado público é derivado por job/edge function a partir dos
 *     registros privados que o usuário marcou como `contribute = true`.
 */

import type { ListaItem, MercadoCompraHistorico } from "./listas-store";

/** Visibilidade do registro. Default sempre `private`. */
export type PrecoVisibility = "private" | "anonymized" | "aggregated";

/** Origem do dado, herdada do item da lista ou inferida. */
export type PrecoOrigem = "manual" | "lista" | "barcode" | "cupom" | "qrcode";

/**
 * Registro PRIVADO de preço — pertence somente ao usuário que o gerou.
 * Este DTO NÃO contém nenhum dado pessoal: o vínculo com o auth.uid acontece
 * no backend, fora deste objeto. Nunca incluir nome/email/telefone aqui.
 */
export interface MercadoPrecoUsuarioRegistro {
  /** Identificador local do registro (UUID/local id). */
  id: string;
  /** Id local do item de origem (rastreabilidade). */
  itemId: string;
  /** Id local da lista de origem, quando aplicável. */
  listaId?: string;
  /** Id local do histórico (compra finalizada) de origem, quando aplicável. */
  historicoId?: string;

  /** Nome do produto, exatamente como o usuário digitou. */
  produtoNome: string;
  /** Categoria opcional informada pelo usuário (não inferida). */
  categoria?: string;
  /** Código de barras opcional (EAN/UPC). */
  codigoBarras?: string;
  /** Unidade de medida (un, kg, L, ml, g…). */
  unidade?: string;
  /** Quantidade comprada. */
  quantidade: number;

  /** Preço unitário pago. Se não houver `precoPago`, cai para `precoEstimado`. */
  precoUnitario: number;
  /** Preço total da linha: `precoUnitario * quantidade`. */
  precoTotal: number;
  /** Indica se o preço veio de valor pago (true) ou estimado (false). */
  fromPaidPrice: boolean;

  /** Data da compra (ISO). */
  compradoEm: string;
  /** Origem do dado. Default: `manual`. */
  origem: PrecoOrigem;

  /** Cidade opcional, somente se o usuário informar manualmente. */
  cidade?: string;
  /** UF opcional, somente se o usuário informar manualmente. */
  uf?: string;
  /** Estabelecimento opcional, somente se o usuário informar manualmente. */
  estabelecimento?: string;

  /**
   * Visibilidade do registro. SEMPRE nasce como `private`.
   * Só pode mudar para `anonymized`/`aggregated` mediante opt-in explícito
   * do usuário (toggle "Contribuir anonimamente"), que ainda não existe.
   */
  visibility: PrecoVisibility;
  /** Flag de contribuição anônima. SEMPRE `false` até existir opt-in. */
  contribuirAnonimamente: boolean;
}

/**
 * Registro AGREGADO derivado (sem user_id, sem dado pessoal).
 * Reservado apenas como referência de tipos para a evolução futura.
 * Nada neste arquivo gera registros agregados hoje.
 */
export interface MercadoPrecoAgregado {
  /** Chave do produto (ex.: EAN ou slug do nome normalizado). */
  produtoKey: string;
  produtoNome: string;
  categoria?: string;
  unidade?: string;
  /** Escopo geográfico opcional. */
  uf?: string;
  cidade?: string;
  /** Estatísticas agregadas (derivadas, nunca expõem o usuário). */
  precoMedio: number;
  precoMin: number;
  precoMax: number;
  amostras: number;
  atualizadoEm: string;
}

// ---------------------------------------------------------------------------
// Transformações puras (sem I/O, sem rede, sem persistência)
// ---------------------------------------------------------------------------

function genLocalId(prefix: string): string {
  if (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { crypto?: Crypto }).crypto !== "undefined" &&
    "randomUUID" in (globalThis as { crypto: Crypto }).crypto
  ) {
    return (globalThis as { crypto: Crypto }).crypto.randomUUID();
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Transforma um item da lista em um registro privado de histórico de preço.
 * Retorna `null` quando o item não tem preço utilizável (nem pago, nem estimado).
 *
 * Esta função é PURA: não persiste, não envia para rede, não compartilha.
 * O preço pago tem prioridade sobre o estimado quando ambos existem.
 */
export function itemParaRegistroPrivado(
  item: ListaItem,
  opts: {
    listaId?: string;
    historicoId?: string;
    compradoEm?: string;
    /** Cidade informada manualmente pelo usuário, opcional. */
    cidade?: string;
    uf?: string;
    estabelecimento?: string;
  } = {},
): MercadoPrecoUsuarioRegistro | null {
  const qtd = item.quantidade > 0 ? item.quantidade : 1;
  const precoPago =
    typeof item.precoPago === "number" && Number.isFinite(item.precoPago) && item.precoPago > 0
      ? item.precoPago
      : undefined;
  const precoEst =
    typeof item.precoEstimado === "number" &&
    Number.isFinite(item.precoEstimado) &&
    item.precoEstimado > 0
      ? item.precoEstimado
      : undefined;
  const precoUnitario = precoPago ?? precoEst;
  if (precoUnitario === undefined) return null;

  return {
    id: genLocalId("prc"),
    itemId: item.id,
    listaId: opts.listaId,
    historicoId: opts.historicoId,
    produtoNome: item.nome.trim(),
    categoria: item.categoria,
    codigoBarras: item.codigoBarras,
    unidade: item.unidade,
    quantidade: qtd,
    precoUnitario,
    precoTotal: precoUnitario * qtd,
    fromPaidPrice: precoPago !== undefined,
    compradoEm: opts.compradoEm ?? item.atualizadoEm ?? new Date().toISOString(),
    origem: item.origem ?? "manual",
    cidade: opts.cidade,
    uf: opts.uf,
    estabelecimento: opts.estabelecimento,
    visibility: "private",
    contribuirAnonimamente: false,
  };
}

/**
 * Transforma uma compra finalizada (`MercadoCompraHistorico`) em uma lista de
 * registros privados de preço — um por item com preço utilizável.
 * Pura, sem persistência. Útil para, no futuro, fazer batch insert privado.
 */
export function compraParaRegistrosPrivados(
  compra: MercadoCompraHistorico,
  opts: { cidade?: string; uf?: string; estabelecimento?: string } = {},
): MercadoPrecoUsuarioRegistro[] {
  const out: MercadoPrecoUsuarioRegistro[] = [];
  for (const item of compra.itensSnapshot) {
    if (!item.comprado) continue;
    const reg = itemParaRegistroPrivado(item, {
      listaId: compra.listaId,
      historicoId: compra.id,
      compradoEm: compra.concluidaEm,
      cidade: opts.cidade,
      uf: opts.uf,
      estabelecimento: opts.estabelecimento,
    });
    if (reg) out.push(reg);
  }
  return out;
}

/**
 * Remove qualquer campo potencialmente identificável antes de qualquer uso
 * coletivo futuro (anonimização). Mantém apenas dados de produto/preço/contexto
 * geográfico macro. NUNCA usar sem opt-in explícito do usuário.
 */
export function anonimizarRegistro(
  reg: MercadoPrecoUsuarioRegistro,
): Omit<
  MercadoPrecoUsuarioRegistro,
  "id" | "itemId" | "listaId" | "historicoId" | "estabelecimento" | "contribuirAnonimamente"
> & { visibility: "anonymized" } {
  return {
    produtoNome: reg.produtoNome,
    categoria: reg.categoria,
    codigoBarras: reg.codigoBarras,
    unidade: reg.unidade,
    quantidade: reg.quantidade,
    precoUnitario: reg.precoUnitario,
    precoTotal: reg.precoTotal,
    fromPaidPrice: reg.fromPaidPrice,
    compradoEm: reg.compradoEm,
    origem: reg.origem,
    cidade: reg.cidade,
    uf: reg.uf,
    visibility: "anonymized",
  };
}

// ---------------------------------------------------------------------------
// E13 — Histórico LOCAL de preços por produto (somente este dispositivo)
// ---------------------------------------------------------------------------
// Persiste em localStorage, isolado dos demais stores do Mercado. SSR-safe.
// Não usa Supabase, não compartilha dados, não cria base comunitária.

import { useEffect, useState, useSyncExternalStore } from "react";

export const MERCADO_PRECOS_STORAGE_KEY = "gi:mercado:precos:v1";
export const MERCADO_PRECOS_LEGACY_ANON_KEY = MERCADO_PRECOS_STORAGE_KEY;

// ----- Sync state (preenchido por mercado-sync.ts) -----
let precosActiveUserId: string | null = null;

function currentPrecosKey(): string {
  return precosActiveUserId
    ? `${MERCADO_PRECOS_STORAGE_KEY}:${precosActiveUserId}`
    : MERCADO_PRECOS_STORAGE_KEY;
}

type PrecosSyncHooks = {
  onUpsertRegistros?: (regs: MercadoPrecoLocal[]) => void;
};
let precosSyncHooks: PrecosSyncHooks = {};

export function __setMercadoPrecosSyncHooks(hooks: PrecosSyncHooks) {
  precosSyncHooks = hooks;
}

export function __setMercadoPrecosActiveUser(uid: string | null) {
  if (precosActiveUserId === uid) return;
  precosActiveUserId = uid;
  emitPrecos();
}

export function __replacePrecosCache(items: MercadoPrecoLocal[]) {
  safeWritePrecos(items);
  emitPrecos();
}

/** Versão pública do registro local (mesma forma do registro privado). */
export type MercadoPrecoLocal = MercadoPrecoUsuarioRegistro;

/** Chave determinística para agrupar registros do mesmo produto. */
export function buildProdutoKey(input: { nome?: string; codigoBarras?: string }): string {
  const ean = (input.codigoBarras ?? "").trim();
  if (ean) return `ean:${ean}`;
  // Normaliza: minúsculas, remove acentos (NFD), colapsa espaços.
  // Evita que "Açúcar" vs "acucar" gerem produtos diferentes.
  const nome = (input.nome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return nome ? `nome:${nome}` : "";
}

function isBrowserPrec() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizePreco(raw: unknown): MercadoPrecoLocal | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.produtoNome !== "string") return null;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  const precoUnitario = num(r.precoUnitario);
  if (precoUnitario === undefined) return null;
  const qtd = num(r.quantidade) ?? 1;
  const origens = ["manual", "lista", "barcode", "cupom", "qrcode"] as const;
  const origem = (origens as readonly string[]).includes(r.origem as string)
    ? (r.origem as PrecoOrigem)
    : "manual";
  return {
    id: r.id,
    itemId: typeof r.itemId === "string" ? r.itemId : "",
    listaId: typeof r.listaId === "string" ? r.listaId : undefined,
    historicoId: typeof r.historicoId === "string" ? r.historicoId : undefined,
    produtoNome: r.produtoNome,
    categoria: typeof r.categoria === "string" && r.categoria ? r.categoria : undefined,
    codigoBarras: typeof r.codigoBarras === "string" && r.codigoBarras ? r.codigoBarras : undefined,
    unidade: typeof r.unidade === "string" && r.unidade ? r.unidade : undefined,
    quantidade: qtd,
    precoUnitario,
    precoTotal: num(r.precoTotal) ?? precoUnitario * qtd,
    fromPaidPrice: Boolean(r.fromPaidPrice),
    compradoEm:
      typeof r.compradoEm === "string" && r.compradoEm ? r.compradoEm : "1970-01-01T00:00:00.000Z",
    origem,
    cidade: typeof r.cidade === "string" && r.cidade ? r.cidade : undefined,
    uf: typeof r.uf === "string" && r.uf ? r.uf : undefined,
    estabelecimento:
      typeof r.estabelecimento === "string" && r.estabelecimento ? r.estabelecimento : undefined,
    visibility: "private",
    contribuirAnonimamente: false,
  };
}

function safeReadPrecos(): MercadoPrecoLocal[] {
  if (!isBrowserPrec()) return [];
  try {
    const raw = window.localStorage.getItem(currentPrecosKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePreco).filter((x): x is MercadoPrecoLocal => x !== null);
  } catch {
    return [];
  }
}

function safeWritePrecos(next: MercadoPrecoLocal[]) {
  if (!isBrowserPrec()) return;
  try {
    window.localStorage.setItem(currentPrecosKey(), JSON.stringify(next));
  } catch {
    // ignore quota / privacy errors
  }
}

type PrecoListener = () => void;
const precosListeners = new Set<PrecoListener>();

function emitPrecos() {
  for (const l of Array.from(precosListeners)) {
    try {
      l();
    } catch {
      // ignore
    }
  }
}

export function getHistoricoPrecos(): MercadoPrecoLocal[] {
  return safeReadPrecos().sort((a, b) => b.compradoEm.localeCompare(a.compradoEm));
}

export function getPrecosPorProduto(nomeOuCodigo: string): MercadoPrecoLocal[] {
  const key = buildProdutoKey({
    nome: nomeOuCodigo,
    codigoBarras: /^\d{8,14}$/.test(nomeOuCodigo.trim()) ? nomeOuCodigo.trim() : undefined,
  });
  if (!key) return [];
  return getHistoricoPrecos().filter(
    (r) => buildProdutoKey({ nome: r.produtoNome, codigoBarras: r.codigoBarras }) === key,
  );
}

export type ResumoPrecoProduto = {
  produtoKey: string;
  produtoNome: string;
  unidade?: string;
  codigoBarras?: string;
  registros: number;
  precoMin: number;
  precoMax: number;
  precoMedio: number;
  ultimoPreco: number;
  ultimoEm: string;
  /** E15: lista única de mercados onde o produto foi registrado, em ordem de aparição. */
  mercados: string[];
};

export function getResumoPrecoProduto(nomeOuCodigo: string): ResumoPrecoProduto | null {
  const regs = getPrecosPorProduto(nomeOuCodigo);
  if (regs.length === 0) return null;
  return resumirRegistros(regs);
}

function resumirRegistros(regs: MercadoPrecoLocal[]): ResumoPrecoProduto {
  // regs assumed non-empty
  const sorted = [...regs].sort((a, b) => b.compradoEm.localeCompare(a.compradoEm));
  const last = sorted[0];
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  const mercadosSet = new Set<string>();
  const mercados: string[] = [];
  for (const r of sorted) {
    if (r.precoUnitario < min) min = r.precoUnitario;
    if (r.precoUnitario > max) max = r.precoUnitario;
    sum += r.precoUnitario;
    const m = (r.estabelecimento ?? "").trim();
    if (m && !mercadosSet.has(m)) {
      mercadosSet.add(m);
      mercados.push(m);
    }
  }
  const safeMin = Number.isFinite(min) ? min : last.precoUnitario;
  const safeMax = Number.isFinite(max) ? max : last.precoUnitario;
  const medio = sorted.length > 0 ? sum / sorted.length : last.precoUnitario;
  return {
    produtoKey: buildProdutoKey({ nome: last.produtoNome, codigoBarras: last.codigoBarras }),
    produtoNome: last.produtoNome,
    unidade: last.unidade,
    codigoBarras: last.codigoBarras,
    registros: sorted.length,
    precoMin: safeMin,
    precoMax: safeMax,
    precoMedio: medio,
    ultimoPreco: last.precoUnitario,
    ultimoEm: last.compradoEm,
    mercados,
  };
}

/**
 * E16 — Agrupa uma lista qualquer de registros locais por produto e devolve
 * os resumos, ordenados pelo registro mais recente. Pura, sem I/O.
 */
export function agruparResumosPorProduto(regs: MercadoPrecoLocal[]): ResumoPrecoProduto[] {
  const groups = new Map<string, MercadoPrecoLocal[]>();
  for (const r of regs) {
    const key = buildProdutoKey({ nome: r.produtoNome, codigoBarras: r.codigoBarras });
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }
  const out: ResumoPrecoProduto[] = [];
  for (const arr of groups.values()) {
    out.push(resumirRegistros(arr));
  }
  out.sort((a, b) => b.ultimoEm.localeCompare(a.ultimoEm));
  return out;
}

/** Resumos agrupados por produto, ordenados pelo registro mais recente. */
export function getResumosPrecos(): ResumoPrecoProduto[] {
  return agruparResumosPorProduto(getHistoricoPrecos());
}

// ---------------------------------------------------------------------------
// E16 — Filtros locais por mercado (puros, sem React, sem I/O)
// ---------------------------------------------------------------------------

/** Sentinelas usados pela UI de filtro de mercado. */
export const MERCADO_FILTRO_ALL = "__all__";
export const MERCADO_FILTRO_SEM = "__sem_mercado__";

function normalizeMercado(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Filtra registros locais por mercado. Pura: não usa React, não toca em
 * localStorage, não faz fetch.
 *
 * Regras:
 *  - `MERCADO_FILTRO_ALL` (ou string vazia) → retorna tudo;
 *  - `MERCADO_FILTRO_SEM` → registros sem estabelecimento;
 *  - qualquer outro valor → match por nome normalizado (case-insensitive,
 *    espaços colapsados).
 */
export function filterRegistrosPrecoPorMercado(
  registros: MercadoPrecoLocal[],
  mercadoFiltro: string,
): MercadoPrecoLocal[] {
  if (!Array.isArray(registros)) return [];
  const filtro = (mercadoFiltro ?? "").trim();
  if (!filtro || filtro === MERCADO_FILTRO_ALL) return registros;
  if (filtro === MERCADO_FILTRO_SEM) {
    return registros.filter((r) => normalizeMercado(r.estabelecimento) === "");
  }
  const alvo = normalizeMercado(filtro).toLowerCase();
  if (!alvo) return registros;
  return registros.filter((r) => normalizeMercado(r.estabelecimento).toLowerCase() === alvo);
}

/**
 * Lista única e ordenada (locale-aware) dos mercados existentes nos registros.
 * Ignora valores vazios. Não inclui o sentinela "sem mercado informado".
 */
export function buildMercadosDisponiveis(registros: MercadoPrecoLocal[]): string[] {
  if (!Array.isArray(registros)) return [];
  const seen = new Map<string, string>();
  for (const r of registros) {
    const m = normalizeMercado(r.estabelecimento);
    if (!m) continue;
    const key = m.toLowerCase();
    if (!seen.has(key)) seen.set(key, m);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Registra os preços de uma compra finalizada no histórico LOCAL.
 * Deduplica por `historicoId`: se já houver registros dessa compra, não insere
 * novamente (evita duplicar quando o usuário finalizar a mesma lista duas vezes
 * rapidamente). Retorna a quantidade de novos registros inseridos.
 */
export function registrarPrecosDaCompra(compra: MercadoCompraHistorico): number {
  const novos = compraParaRegistrosPrivados(compra, {
    estabelecimento: compra.mercadoNome,
  });
  if (novos.length === 0) return 0;
  const atuais = safeReadPrecos();
  if (compra.id && atuais.some((r) => r.historicoId === compra.id)) {
    return 0;
  }
  safeWritePrecos([...novos, ...atuais]);
  emitPrecos();
  // Push para Supabase (best-effort, não bloqueia o fluxo local).
  if (precosSyncHooks.onUpsertRegistros) {
    try {
      precosSyncHooks.onUpsertRegistros(novos);
    } catch {
      /* ignore */
    }
  }
  return novos.length;
}

function subscribePrecos(listener: PrecoListener): () => void {
  precosListeners.add(listener);
  if (isBrowserPrec()) {
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith(MERCADO_PRECOS_STORAGE_KEY)) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      precosListeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => precosListeners.delete(listener);
}

let cachedPrecos: MercadoPrecoLocal[] = [];
let cachedPrecosSerialized = "[]";

function getPrecosSnapshot(): MercadoPrecoLocal[] {
  const fresh = getHistoricoPrecos();
  const serialized = JSON.stringify(fresh);
  if (serialized !== cachedPrecosSerialized) {
    cachedPrecosSerialized = serialized;
    cachedPrecos = fresh;
  }
  return cachedPrecos;
}

function getPrecosServerSnapshot(): MercadoPrecoLocal[] {
  return [];
}

export function useHistoricoPrecos(): MercadoPrecoLocal[] {
  const data = useSyncExternalStore(subscribePrecos, getPrecosSnapshot, getPrecosServerSnapshot);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? data : [];
}

let cachedResumos: ResumoPrecoProduto[] = [];
let cachedResumosSerialized = "[]";

function getResumosSnapshot(): ResumoPrecoProduto[] {
  const fresh = getResumosPrecos();
  const serialized = JSON.stringify(fresh);
  if (serialized !== cachedResumosSerialized) {
    cachedResumosSerialized = serialized;
    cachedResumos = fresh;
  }
  return cachedResumos;
}

function getResumosServerSnapshot(): ResumoPrecoProduto[] {
  return [];
}

export function useResumosPrecos(): ResumoPrecoProduto[] {
  const data = useSyncExternalStore(subscribePrecos, getResumosSnapshot, getResumosServerSnapshot);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? data : [];
}

// ---------------------------------------------------------------------------
// E14 — Inteligência local de preços (pura, sem React, sem I/O)
// ---------------------------------------------------------------------------

export type PrecoInsightStatus = "sem_historico" | "bom" | "normal" | "alto" | "muito_alto";

export interface PrecoLocalInsight {
  status: PrecoInsightStatus;
  /** Diferença relativa à média, em porcentagem. Positivo = acima da média. */
  diffPercent?: number;
  menorPreco?: number;
  precoMedio?: number;
  ultimoPreco?: number;
  registros?: number;
}

/**
 * Análise pura do preço unitário informado vs histórico local do mesmo
 * produto. Não usa React, não lê localStorage diretamente: recebe os
 * resumos já calculados como parâmetro.
 *
 * Retorna `null` quando faltam dados mínimos (sem nome/código ou sem preço
 * válido). Para produto sem histórico, retorna `status: "sem_historico"`.
 *
 * Regras (apenas leitura, não altera nada):
 *  - preço ≤ menor preço histórico  → "bom"
 *  - até +10% da média              → "normal"
 *  - entre +10% e +25% da média     → "alto"
 *  - acima de +25% da média         → "muito_alto"
 */
export function buildPrecoLocalInsight(input: {
  nome?: string;
  codigoBarras?: string;
  precoUnitario: number | undefined | null;
  resumos: ResumoPrecoProduto[];
}): PrecoLocalInsight | null {
  const preco =
    typeof input.precoUnitario === "number" &&
    Number.isFinite(input.precoUnitario) &&
    input.precoUnitario > 0
      ? input.precoUnitario
      : undefined;
  if (preco === undefined) return null;

  const key = buildProdutoKey({ nome: input.nome, codigoBarras: input.codigoBarras });
  if (!key) return null;

  const resumo = input.resumos.find((r) => r.produtoKey === key);
  if (!resumo || resumo.registros === 0) {
    return { status: "sem_historico" };
  }

  const { precoMedio, precoMin, ultimoPreco, registros } = resumo;
  const diffPercent = precoMedio > 0 ? ((preco - precoMedio) / precoMedio) * 100 : 0;

  let status: PrecoInsightStatus;
  if (preco <= precoMin) {
    status = "bom";
  } else if (diffPercent <= 10) {
    status = "normal";
  } else if (diffPercent <= 25) {
    status = "alto";
  } else {
    status = "muito_alto";
  }

  return {
    status,
    diffPercent: Math.round(diffPercent * 10) / 10,
    menorPreco: precoMin,
    precoMedio,
    ultimoPreco,
    registros,
  };
}

/**
 * Hook ergonômico para componentes: reativo aos resumos locais.
 * Retorna `null` quando não há insight aplicável.
 */
export function usePrecoInsight(
  nome: string | undefined,
  codigoBarras: string | undefined,
  precoUnitario: number | undefined | null,
): PrecoLocalInsight | null {
  const resumos = useResumosPrecos();
  return buildPrecoLocalInsight({ nome, codigoBarras, precoUnitario, resumos });
}

// ---------------------------------------------------------------------------
// E17 — Comparativo LOCAL por mercado (pura, sem React, sem I/O)
// ---------------------------------------------------------------------------

export type ResumoMercadoStatus = "melhor" | "medio" | "pouco_dado";

export interface ResumoMercadoProdutoBom {
  produtoKey: string;
  produtoNome: string;
  /** Menor preço unitário registrado para este produto neste mercado. */
  precoNesteMercado: number;
  /** Média do preço unitário global do produto (todos os mercados). */
  precoMedioGlobal: number;
  /** Diferença percentual vs média global. Negativo = mais barato neste mercado. */
  diffPercent: number;
}

export interface ResumoMercadoCard {
  /** Chave estável (normalizada). Para "sem mercado", `__sem__`. */
  mercadoKey: string;
  /** Nome de exibição do mercado. Vazio quando `semMercado`. */
  mercadoNome: string;
  semMercado: boolean;
  registros: number;
  produtos: number;
  ultimoEm: string;
  status: ResumoMercadoStatus;
  /**
   * Média das diferenças percentuais (preço deste mercado vs média global)
   * across all produtos deste mercado. Negativo = barato em média.
   * `null` quando não há produto com média global computável.
   */
  diffMedioPercent: number | null;
  /** Até 3 produtos mais baratos neste mercado em relação à média global. */
  melhoresProdutos: ResumoMercadoProdutoBom[];
}

export interface ResumoMercadosGlobal {
  mercados: ResumoMercadoCard[];
  totalMercados: number;
  /** Mercados nomeados (exclui o agrupamento "sem mercado"). */
  totalMercadosNomeados: number;
  totalProdutos: number;
  totalRegistros: number;
  /** Nome do mercado com mais registros (exclui "sem mercado"). Pode ser null. */
  mercadoComMaisRegistros: string | null;
  hasSemMercado: boolean;
}

const MERCADO_SEM_KEY = "__sem__";

/**
 * Agrupa os registros locais por mercado/local da compra e produz um resumo
 * conservador, baseado APENAS no histórico do próprio usuário. Pura: não usa
 * React, não toca em localStorage, não faz rede.
 *
 * Regras:
 *  - Ignora registros inválidos (sem nome ou sem preço > 0).
 *  - Registros sem `estabelecimento` válido são agrupados como "sem mercado".
 *  - A média global de um produto é calculada considerando TODOS os mercados.
 *  - `diffPercent` por produto = (precoNesteMercado − médiaGlobal) / médiaGlobal × 100.
 *  - `status`:
 *      - `pouco_dado` quando o mercado tem < 3 registros;
 *      - `melhor` quando `diffMedioPercent` ≤ −5%;
 *      - `medio` caso contrário.
 *  - `melhoresProdutos`: top 3 produtos com menor `diffPercent` (mais baratos vs média global).
 */
export function buildResumoMercados(registros: MercadoPrecoLocal[]): ResumoMercadosGlobal {
  if (!Array.isArray(registros) || registros.length === 0) {
    return {
      mercados: [],
      totalMercados: 0,
      totalMercadosNomeados: 0,
      totalProdutos: 0,
      totalRegistros: 0,
      mercadoComMaisRegistros: null,
      hasSemMercado: false,
    };
  }

  // Filtra registros utilizáveis (preço > 0 e produtoKey válido).
  type Valid = {
    reg: MercadoPrecoLocal;
    produtoKey: string;
    mercadoKey: string;
    mercadoNome: string;
  };
  const valid: Valid[] = [];
  for (const r of registros) {
    if (
      typeof r.precoUnitario !== "number" ||
      !Number.isFinite(r.precoUnitario) ||
      r.precoUnitario <= 0
    ) {
      continue;
    }
    const produtoKey = buildProdutoKey({ nome: r.produtoNome, codigoBarras: r.codigoBarras });
    if (!produtoKey) continue;
    const mercadoNome = (r.estabelecimento ?? "").replace(/\s+/g, " ").trim();
    const mercadoKey = mercadoNome ? mercadoNome.toLowerCase() : MERCADO_SEM_KEY;
    valid.push({ reg: r, produtoKey, mercadoKey, mercadoNome });
  }

  if (valid.length === 0) {
    return {
      mercados: [],
      totalMercados: 0,
      totalMercadosNomeados: 0,
      totalProdutos: 0,
      totalRegistros: 0,
      mercadoComMaisRegistros: null,
      hasSemMercado: false,
    };
  }

  // Média global de preço por produto.
  const globalPorProduto = new Map<string, { soma: number; n: number; nome: string }>();
  for (const v of valid) {
    const cur = globalPorProduto.get(v.produtoKey);
    if (cur) {
      cur.soma += v.reg.precoUnitario;
      cur.n += 1;
    } else {
      globalPorProduto.set(v.produtoKey, {
        soma: v.reg.precoUnitario,
        n: 1,
        nome: v.reg.produtoNome,
      });
    }
  }

  // Agrupa por mercado.
  type MercadoBucket = {
    key: string;
    nome: string;
    semMercado: boolean;
    registros: MercadoPrecoLocal[];
    produtoMin: Map<string, { preco: number; nome: string }>;
    ultimoEm: string;
  };
  const buckets = new Map<string, MercadoBucket>();
  for (const v of valid) {
    let b = buckets.get(v.mercadoKey);
    if (!b) {
      b = {
        key: v.mercadoKey,
        nome: v.mercadoNome,
        semMercado: v.mercadoKey === MERCADO_SEM_KEY,
        registros: [],
        produtoMin: new Map(),
        ultimoEm: v.reg.compradoEm,
      };
      buckets.set(v.mercadoKey, b);
    }
    b.registros.push(v.reg);
    if (v.reg.compradoEm > b.ultimoEm) b.ultimoEm = v.reg.compradoEm;
    const cur = b.produtoMin.get(v.produtoKey);
    if (!cur || v.reg.precoUnitario < cur.preco) {
      b.produtoMin.set(v.produtoKey, { preco: v.reg.precoUnitario, nome: v.reg.produtoNome });
    }
  }

  const mercados: ResumoMercadoCard[] = [];
  for (const b of buckets.values()) {
    const comparaveis: ResumoMercadoProdutoBom[] = [];
    for (const [produtoKey, { preco, nome }] of b.produtoMin.entries()) {
      const g = globalPorProduto.get(produtoKey);
      if (!g || g.n === 0) continue;
      const medio = g.soma / g.n;
      if (medio <= 0) continue;
      const diffPercent = ((preco - medio) / medio) * 100;
      comparaveis.push({
        produtoKey,
        produtoNome: nome,
        precoNesteMercado: preco,
        precoMedioGlobal: medio,
        diffPercent: Math.round(diffPercent * 10) / 10,
      });
    }
    comparaveis.sort((a, b2) => a.diffPercent - b2.diffPercent);
    const melhores = comparaveis.filter((c) => c.diffPercent < 0).slice(0, 3);
    // Fallback: se nenhum negativo, mostra os 3 mais próximos da média (não exagera).
    const melhoresProdutos = melhores.length > 0 ? melhores : comparaveis.slice(0, 3);

    const diffMedioPercent =
      comparaveis.length === 0
        ? null
        : Math.round(
            (comparaveis.reduce((s, c) => s + c.diffPercent, 0) / comparaveis.length) * 10,
          ) / 10;

    let status: ResumoMercadoStatus;
    if (b.registros.length < 3) {
      status = "pouco_dado";
    } else if (diffMedioPercent !== null && diffMedioPercent <= -5) {
      status = "melhor";
    } else {
      status = "medio";
    }

    mercados.push({
      mercadoKey: b.key,
      mercadoNome: b.nome,
      semMercado: b.semMercado,
      registros: b.registros.length,
      produtos: b.produtoMin.size,
      ultimoEm: b.ultimoEm,
      status,
      diffMedioPercent,
      melhoresProdutos,
    });
  }

  // Ordena: mercados nomeados primeiro (por status melhor → médio → pouco_dado,
  // depois por nº de registros desc), "sem mercado" sempre por último.
  const statusOrder: Record<ResumoMercadoStatus, number> = { melhor: 0, medio: 1, pouco_dado: 2 };
  mercados.sort((a, b2) => {
    if (a.semMercado !== b2.semMercado) return a.semMercado ? 1 : -1;
    const so = statusOrder[a.status] - statusOrder[b2.status];
    if (so !== 0) return so;
    if (b2.registros !== a.registros) return b2.registros - a.registros;
    return a.mercadoNome.localeCompare(b2.mercadoNome, "pt-BR");
  });

  const nomeados = mercados.filter((m) => !m.semMercado);
  const topNomeado = nomeados.reduce<ResumoMercadoCard | null>(
    (top, m) => (top === null || m.registros > top.registros ? m : top),
    null,
  );

  return {
    mercados,
    totalMercados: mercados.length,
    totalMercadosNomeados: nomeados.length,
    totalProdutos: globalPorProduto.size,
    totalRegistros: valid.length,
    mercadoComMaisRegistros: topNomeado ? topNomeado.mercadoNome : null,
    hasSemMercado: mercados.some((m) => m.semMercado),
  };
}

/** Hook ergonômico para componentes: reativo aos registros locais. */
export function useResumoMercados(): ResumoMercadosGlobal {
  const registros = useHistoricoPrecos();
  return buildResumoMercados(registros);
}
