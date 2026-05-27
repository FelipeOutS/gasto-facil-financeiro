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

/** Versão pública do registro local (mesma forma do registro privado). */
export type MercadoPrecoLocal = MercadoPrecoUsuarioRegistro;

/** Chave determinística para agrupar registros do mesmo produto. */
export function buildProdutoKey(input: {
  nome?: string;
  codigoBarras?: string;
}): string {
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
    codigoBarras:
      typeof r.codigoBarras === "string" && r.codigoBarras ? r.codigoBarras : undefined,
    unidade: typeof r.unidade === "string" && r.unidade ? r.unidade : undefined,
    quantidade: qtd,
    precoUnitario,
    precoTotal: num(r.precoTotal) ?? precoUnitario * qtd,
    fromPaidPrice: Boolean(r.fromPaidPrice),
    compradoEm:
      typeof r.compradoEm === "string" && r.compradoEm
        ? r.compradoEm
        : "1970-01-01T00:00:00.000Z",
    origem,
    cidade: typeof r.cidade === "string" && r.cidade ? r.cidade : undefined,
    uf: typeof r.uf === "string" && r.uf ? r.uf : undefined,
    estabelecimento:
      typeof r.estabelecimento === "string" && r.estabelecimento
        ? r.estabelecimento
        : undefined,
    visibility: "private",
    contribuirAnonimamente: false,
  };
}

function safeReadPrecos(): MercadoPrecoLocal[] {
  if (!isBrowserPrec()) return [];
  try {
    const raw = window.localStorage.getItem(MERCADO_PRECOS_STORAGE_KEY);
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
    window.localStorage.setItem(MERCADO_PRECOS_STORAGE_KEY, JSON.stringify(next));
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
  for (const r of sorted) {
    if (r.precoUnitario < min) min = r.precoUnitario;
    if (r.precoUnitario > max) max = r.precoUnitario;
    sum += r.precoUnitario;
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
  };
}

/** Resumos agrupados por produto, ordenados pelo registro mais recente. */
export function getResumosPrecos(): ResumoPrecoProduto[] {
  const all = getHistoricoPrecos();
  const groups = new Map<string, MercadoPrecoLocal[]>();
  for (const r of all) {
    const key = buildProdutoKey({ nome: r.produtoNome, codigoBarras: r.codigoBarras });
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }
  const out: ResumoPrecoProduto[] = [];
  for (const regs of groups.values()) {
    out.push(resumirRegistros(regs));
  }
  out.sort((a, b) => b.ultimoEm.localeCompare(a.ultimoEm));
  return out;
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
  return novos.length;
}

function subscribePrecos(listener: PrecoListener): () => void {
  precosListeners.add(listener);
  if (isBrowserPrec()) {
    const onStorage = (e: StorageEvent) => {
      if (e.key === MERCADO_PRECOS_STORAGE_KEY) listener();
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
  const data = useSyncExternalStore(
    subscribePrecos,
    getPrecosSnapshot,
    getPrecosServerSnapshot,
  );
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
  const data = useSyncExternalStore(
    subscribePrecos,
    getResumosSnapshot,
    getResumosServerSnapshot,
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? data : [];
}

// ---------------------------------------------------------------------------
// E14 — Inteligência local de preços (pura, sem React, sem I/O)
// ---------------------------------------------------------------------------

export type PrecoInsightStatus =
  | "sem_historico"
  | "bom"
  | "normal"
  | "alto"
  | "muito_alto";

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
  const diffPercent =
    precoMedio > 0 ? ((preco - precoMedio) / precoMedio) * 100 : 0;

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

