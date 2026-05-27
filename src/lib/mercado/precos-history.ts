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
