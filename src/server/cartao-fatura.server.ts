/**
 * WA-F1 — Helper server-side reutilizável para cálculo de FATURA ATUAL
 * de cartões de crédito. Espelha as regras já usadas no site/app
 * (`src/lib/store.ts`: faturaCorrente, cicloFatura, gastosDaFatura,
 * resumoFaturaPorMes, proximoFechamentoData, proximoVencimentoFaturaAberta),
 * porém consultando o Supabase diretamente para uso em fluxos server-side
 * (WhatsApp, server functions, jobs). NÃO faz cache global e NÃO toca em
 * memória in-memory do store cliente.
 *
 * Regras (mantidas idênticas ao site):
 * - Apenas gastos com `forma_pagamento === "credito"`, `confirmado !== false`
 *   e `cartao_id` igual ao cartão alvo entram na fatura.
 * - Fonte da verdade do mês da fatura: `invoice_month` quando presente; senão,
 *   janela cicloFatura baseada em `dia_fechamento` do cartão.
 * - Fatura corrente: ciclo aberto considerando `hoje.dia <= diaFech` → mês
 *   anterior; senão mês atual.
 * - Timezone: America/Sao_Paulo (mesmo padrão das demais consultas).
 * - Não cria, não altera, não notifica.
 *
 * Privacidade: o chamador deve passar `userId` autorizado pelo gate
 * canônico. Todas as queries filtram por `user_id`. Nunca expor dados
 * de outro usuário.
 */
import * as _supa from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Lazy live-binding: garante que mock.module() em testes seja
// resolvido a cada chamada, sem snapshot no escopo de módulo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = new Proxy({}, { get: (_t, prop) => (_supa.supabaseAdmin as any)[prop] });

const APP_TZ = "America/Sao_Paulo";

export type CartaoRow = {
  id: string;
  nome: string;
  banco?: string | null;
  limite_total?: number | string | null;
  dia_fechamento?: number | null;
  dia_vencimento?: number | null;
};

export type FaturaAtual = {
  cartaoId: string;
  cartaoNome: string;
  mesRef: number; // 1-12
  anoRef: number;
  total: number;
  limite: number;
  disponivel: number;
  qtd: number;
  fechamento: Date | null;
  vencimento: Date | null;
};

/** Hoje em America/Sao_Paulo como Date no fuso local desse TZ. */
export function nowInAppTz(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // Construímos um Date "wallclock" em SP — usado só para cálculos de dia.
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** Espelha `faturaCorrente` do store. */
export function faturaCorrenteRef(diaFech: number, hoje: Date): { mes: number; ano: number } {
  const baseDay = hoje.getDate();
  let y = hoje.getFullYear();
  let m0 = hoje.getMonth();
  if (baseDay <= Math.max(1, diaFech)) {
    m0 -= 1;
    if (m0 < 0) { m0 = 11; y -= 1; }
  }
  return { mes: m0 + 1, ano: y };
}

/** Espelha `cicloFatura` do store. */
export function cicloFatura(diaFech: number, mes: number, ano: number) {
  const d = diaFech > 0 ? diaFech : 1;
  const inicio = new Date(ano, mes - 1, d + 1, 0, 0, 0, 0);
  const fim = new Date(ano, mes, d, 23, 59, 59, 999);
  return { inicio, fim };
}

/** Espelha `proximoFechamentoData` do store. */
export function proximoFechamentoData(diaFech: number, hoje: Date): Date | null {
  if (!diaFech) return null;
  const ref = new Date(hoje.getFullYear(), hoje.getMonth(), diaFech, 23, 59, 59, 999);
  const startOfToday = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  if (ref.getTime() < startOfToday.getTime()) {
    return new Date(hoje.getFullYear(), hoje.getMonth() + 1, diaFech, 23, 59, 59, 999);
  }
  return ref;
}

/** Espelha `proximoVencimentoFaturaAberta` do store. */
export function proximoVencimentoFaturaAberta(
  diaFech: number, diaVenc: number, hoje: Date,
): Date | null {
  if (!diaVenc) return null;
  const fech = proximoFechamentoData(diaFech, hoje);
  if (!fech) return null;
  let venc = new Date(fech.getFullYear(), fech.getMonth(), diaVenc);
  if (venc.getTime() <= fech.getTime()) {
    venc = new Date(fech.getFullYear(), fech.getMonth() + 1, diaVenc);
  }
  return venc;
}

/** Carrega cartões do próprio usuário. */
export async function loadCartoesDoUsuario(userId: string): Promise<CartaoRow[]> {
  const { data, error } = await supabaseAdmin
    .from("cartoes")
    .select("id, nome, banco, limite_total, dia_fechamento, dia_vencimento")
    .eq("user_id", userId);
  if (error) return [];
  return Array.isArray(data) ? (data as CartaoRow[]) : [];
}

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Encontra cartões do usuário cujo nome OU banco bate (inclusão
 * bidirecional) com o termo informado. Filtra apenas cartões do próprio
 * usuário — nunca vaza nome de cartão de outro usuário.
 */
export async function findCartoesDoUsuarioByTerm(
  userId: string,
  termo: string,
): Promise<CartaoRow[]> {
  const t = norm(termo);
  if (!t) return [];
  const cartoes = await loadCartoesDoUsuario(userId);
  return cartoes.filter((c) => {
    const n = norm(c.nome ?? "");
    const b = norm(c.banco ?? "");
    if (!n && !b) return false;
    return (
      n === t || b === t ||
      (n && (n.includes(t) || t.includes(n))) ||
      (b && (b.includes(t) || t.includes(b)))
    );
  });
}

function ymOf(mes: number, ano: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

/**
 * Calcula a fatura ATUAL (ciclo aberto) de um cartão específico. Lê
 * apenas gastos do próprio `user_id`, mesmo cartão alvo, crédito e
 * confirmados. Aplica `invoice_month` quando presente; senão usa
 * `cicloFatura` por data.
 */
export async function getFaturaAtualPorCartao(
  userId: string,
  cartao: CartaoRow,
  hoje: Date = nowInAppTz(),
): Promise<FaturaAtual> {
  const diaFech = Number(cartao.dia_fechamento ?? 1) || 1;
  const diaVenc = Number(cartao.dia_vencimento ?? 10) || 10;
  const { mes, ano } = faturaCorrenteRef(diaFech, hoje);
  const { inicio, fim } = cicloFatura(diaFech, mes, ano);
  const targetYm = ymOf(mes, ano);

  // Janela ampla para apanhar tanto gastos com invoice_month manual quanto
  // por data dentro do ciclo. Filtramos em memória pelas regras finas.
  const fromIso = inicio.toISOString().slice(0, 10);
  const toIso = new Date(fim.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from("gastos")
    .select("valor, data, cartao_id, invoice_month, forma_pagamento, confirmado")
    .eq("user_id", userId)
    .eq("cartao_id", cartao.id)
    .gte("data", fromIso)
    .lt("data", toIso);

  const rows = Array.isArray(data) ? (data as Array<{
    valor: number | string | null;
    data: string;
    cartao_id: string | null;
    invoice_month: string | null;
    forma_pagamento: string | null;
    confirmado: boolean | null;
  }>) : [];

  let total = 0;
  let qtd = 0;
  for (const g of rows) {
    if (g.cartao_id !== cartao.id) continue;
    if ((g.forma_pagamento ?? "") !== "credito") continue;
    if (g.confirmado === false) continue;
    const im = g.invoice_month;
    if (im && /^\d{4}-\d{2}$/.test(im)) {
      if (im !== targetYm) continue;
    } else {
      const d = g.data ? new Date(g.data + "T00:00:00") : null;
      if (!d) continue;
      if (d < inicio || d > fim) continue;
    }
    total += Number(g.valor ?? 0) || 0;
    qtd += 1;
  }

  const limite = Number(cartao.limite_total ?? 0) || 0;
  const disponivel = Math.max(0, limite - total);

  return {
    cartaoId: cartao.id,
    cartaoNome: cartao.nome,
    mesRef: mes,
    anoRef: ano,
    total,
    limite,
    disponivel,
    qtd,
    fechamento: proximoFechamentoData(diaFech, hoje),
    vencimento: proximoVencimentoFaturaAberta(diaFech, diaVenc, hoje),
  };
}

/**
 * Resumo consolidado: fatura atual de todos os cartões do usuário.
 * Inclui também cartões com fatura zerada (qtd=0) — o chamador decide
 * se filtra. Nunca lê dados de outro usuário.
 */
export async function getResumoFaturasAtuais(
  userId: string,
  hoje: Date = nowInAppTz(),
): Promise<FaturaAtual[]> {
  const cartoes = await loadCartoesDoUsuario(userId);
  const out: FaturaAtual[] = [];
  for (const c of cartoes) {
    out.push(await getFaturaAtualPorCartao(userId, c, hoje));
  }
  return out;
}

// =====================================================================
// WA-F2 — Itens (lançamentos) da fatura atual
// =====================================================================

/**
 * Item individual que compõe a fatura atual. Estritamente derivado do
 * gasto persistido — nunca inventa estabelecimento, descrição ou
 * categoria.
 */
export type ItemFatura = {
  id: string;
  descricao: string;
  valor: number;
  data: string; // ISO yyyy-mm-dd
  parcelaAtual: number | null;
  totalParcelas: number | null;
};

/**
 * Lê os lançamentos da fatura ATUAL de um cartão específico aplicando
 * exatamente as mesmas regras de `getFaturaAtualPorCartao`:
 *   - mesmo `user_id`
 *   - mesmo `cartao_id`
 *   - `forma_pagamento === "credito"`
 *   - `confirmado !== false`
 *   - `invoice_month` quando presente; senão, janela `cicloFatura`
 *
 * Não cria, não altera e não notifica nada. Filtra em memória pela mesma
 * regra usada no total para garantir que o somatório dos itens bate
 * com `FaturaAtual.total`.
 */
export async function getItensFaturaAtualPorCartao(
  userId: string,
  cartao: CartaoRow,
  hoje: Date = nowInAppTz(),
): Promise<ItemFatura[]> {
  const diaFech = Number(cartao.dia_fechamento ?? 1) || 1;
  const { mes, ano } = faturaCorrenteRef(diaFech, hoje);
  const { inicio, fim } = cicloFatura(diaFech, mes, ano);
  const targetYm = ymOf(mes, ano);

  const fromIso = inicio.toISOString().slice(0, 10);
  const toIso = new Date(fim.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from("gastos")
    .select(
      "id, descricao, estabelecimento, valor, data, cartao_id, invoice_month, forma_pagamento, confirmado, parcela_atual, total_parcelas",
    )
    .eq("user_id", userId)
    .eq("cartao_id", cartao.id)
    .gte("data", fromIso)
    .lt("data", toIso);

  const rows = Array.isArray(data) ? (data as Array<{
    id: string;
    descricao: string | null;
    estabelecimento: string | null;
    valor: number | string | null;
    data: string;
    cartao_id: string | null;
    invoice_month: string | null;
    forma_pagamento: string | null;
    confirmado: boolean | null;
    parcela_atual: number | null;
    total_parcelas: number | null;
  }>) : [];

  const out: ItemFatura[] = [];
  for (const g of rows) {
    if (g.cartao_id !== cartao.id) continue;
    if ((g.forma_pagamento ?? "") !== "credito") continue;
    if (g.confirmado === false) continue;
    const im = g.invoice_month;
    if (im && /^\d{4}-\d{2}$/.test(im)) {
      if (im !== targetYm) continue;
    } else {
      const d = g.data ? new Date(g.data + "T00:00:00") : null;
      if (!d) continue;
      if (d < inicio || d > fim) continue;
    }
    // Só consideramos parcela "confiável" quando AMBOS parcela_atual e
    // total_parcelas vierem preenchidos com inteiros consistentes
    // (1 <= atual <= total). Nunca inferimos parcelamento pelo nome,
    // valor ou data do estabelecimento.
    const pa = Number(g.parcela_atual);
    const tp = Number(g.total_parcelas);
    const parcelaConfiavel =
      Number.isFinite(pa) && Number.isFinite(tp) &&
      pa >= 1 && tp >= 2 && pa <= tp;

    out.push({
      id: String(g.id ?? ""),
      descricao: String(g.descricao ?? g.estabelecimento ?? "").trim(),
      valor: Number(g.valor ?? 0) || 0,
      data: g.data,
      parcelaAtual: parcelaConfiavel ? pa : null,
      totalParcelas: parcelaConfiavel ? tp : null,
    });
  }
  return out;
}

/**
 * Resumo de itens consolidado por cartão: usa o mesmo helper acima
 * para cada cartão do usuário. Retorna um array com pares
 * {cartao, itens}, mesmo que `itens` esteja vazio.
 */
export async function getResumoItensFaturaAtual(
  userId: string,
  hoje: Date = nowInAppTz(),
): Promise<Array<{ cartao: CartaoRow; itens: ItemFatura[] }>> {
  const cartoes = await loadCartoesDoUsuario(userId);
  const out: Array<{ cartao: CartaoRow; itens: ItemFatura[] }> = [];
  for (const c of cartoes) {
    out.push({ cartao: c, itens: await getItensFaturaAtualPorCartao(userId, c, hoje) });
  }
  return out;
}

// =====================================================================
// WA-F4 — Faturas FUTURAS (mês específico) e COMPRAS PARCELADAS em aberto.
// Reusa estritamente as regras de ciclo/`invoice_month` já definidas
// acima. Nunca cria, altera ou exclui registros. Nunca atravessa
// fronteiras de `user_id`.
// =====================================================================

/** Valida e parseia "YYYY-MM". Retorna null se inválido. */
export function parseInvoiceMonth(ym: string | null | undefined):
  | { mes: number; ano: number; ym: string }
  | null {
  if (!ym || typeof ym !== "string") return null;
  const m = ym.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  return { mes, ano, ym };
}

/**
 * Calcula a fatura ESTIMADA de um cartão para um mês específico
 * (`invoice_month`). Aplica as mesmas regras de filtro do
 * `getFaturaAtualPorCartao`, porém com o ciclo do MÊS alvo, não do
 * ciclo aberto. Útil para responder "próxima fatura", "fatura de
 * agosto", parcelas futuras. Não infere status de pagamento.
 */
export async function getFaturaPorMes(
  userId: string,
  cartao: CartaoRow,
  invoiceMonth: string,
): Promise<FaturaAtual | null> {
  const parsed = parseInvoiceMonth(invoiceMonth);
  if (!parsed) return null;
  const diaFech = Number(cartao.dia_fechamento ?? 1) || 1;
  const diaVenc = Number(cartao.dia_vencimento ?? 10) || 10;
  const { mes, ano, ym: targetYm } = parsed;
  const { inicio, fim } = cicloFatura(diaFech, mes, ano);

  const fromIso = inicio.toISOString().slice(0, 10);
  const toIso = new Date(fim.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);

  // Buscamos TODOS os gastos do cartão por dois caminhos:
  // a) gastos com invoice_month = targetYm (parcelas futuras já criadas);
  // b) gastos com data dentro da janela do ciclo (sem invoice_month).
  // Como a query SQL não consegue um OR limpo neste fake, varremos a
  // janela do ciclo e também rebuscamos só por invoice_month — depois
  // deduplicamos por id.
  const { data: byDate } = await supabaseAdmin
    .from("gastos")
    .select("id, valor, data, cartao_id, invoice_month, forma_pagamento, confirmado")
    .eq("user_id", userId)
    .eq("cartao_id", cartao.id)
    .gte("data", fromIso)
    .lt("data", toIso);
  const { data: byYm } = await supabaseAdmin
    .from("gastos")
    .select("id, valor, data, cartao_id, invoice_month, forma_pagamento, confirmado")
    .eq("user_id", userId)
    .eq("cartao_id", cartao.id)
    .eq("invoice_month", targetYm);

  type Row = {
    id: string;
    valor: number | string | null;
    data: string;
    cartao_id: string | null;
    invoice_month: string | null;
    forma_pagamento: string | null;
    confirmado: boolean | null;
  };
  const seen = new Set<string>();
  const all: Row[] = [];
  for (const r of [...((byDate as Row[]) ?? []), ...((byYm as Row[]) ?? [])]) {
    const id = String(r.id ?? "");
    if (seen.has(id)) continue;
    seen.add(id);
    all.push(r);
  }

  let total = 0;
  let qtd = 0;
  for (const g of all) {
    if (g.cartao_id !== cartao.id) continue;
    if ((g.forma_pagamento ?? "") !== "credito") continue;
    if (g.confirmado === false) continue;
    const im = g.invoice_month;
    if (im && /^\d{4}-\d{2}$/.test(im)) {
      if (im !== targetYm) continue;
    } else {
      const d = g.data ? new Date(g.data + "T00:00:00") : null;
      if (!d) continue;
      if (d < inicio || d > fim) continue;
    }
    total += Number(g.valor ?? 0) || 0;
    qtd += 1;
  }

  // Datas de fechamento/vencimento DO MÊS alvo (não do ciclo aberto).
  const fechamento = new Date(ano, mes - 1, diaFech, 23, 59, 59, 999);
  let vencimento = new Date(ano, mes - 1, diaVenc);
  if (vencimento.getTime() <= fechamento.getTime()) {
    vencimento = new Date(ano, mes, diaVenc);
  }

  const limite = Number(cartao.limite_total ?? 0) || 0;
  const disponivel = Math.max(0, limite - total);
  return {
    cartaoId: cartao.id,
    cartaoNome: cartao.nome,
    mesRef: mes,
    anoRef: ano,
    total,
    limite,
    disponivel,
    qtd,
    fechamento,
    vencimento,
  };
}

/** Resumo consolidado de faturas estimadas por mês (todos os cartões). */
export async function getResumoFaturasPorMes(
  userId: string,
  invoiceMonth: string,
): Promise<FaturaAtual[]> {
  const cartoes = await loadCartoesDoUsuario(userId);
  const out: FaturaAtual[] = [];
  for (const c of cartoes) {
    const f = await getFaturaPorMes(userId, c, invoiceMonth);
    if (f) out.push(f);
  }
  return out;
}

// ---- Compras parceladas em aberto ----------------------------------

export type ParcelaRow = {
  id: string;
  descricao: string;
  estabelecimento: string | null;
  valor: number;
  data: string;
  invoiceMonth: string | null;
  parcelaAtual: number;
  totalParcelas: number;
  grupoId: string;
  cartaoId: string;
};

export type CompraParcelada = {
  grupoId: string;
  descricao: string;
  cartaoId: string;
  totalParcelas: number;
  parcelas: ParcelaRow[];
  totalCompra: number;
  /** Parcelas com invoice_month >= ciclo atual do cartão. */
  parcelasRestantes: ParcelaRow[];
  saldoRestante: number;
  /** Primeira parcela futura/atual, em ordem cronológica. */
  proximaParcela: ParcelaRow | null;
};

/**
 * Carrega TODAS as parcelas (linhas de gastos com grupo_parcelamento_id
 * não-nulo) do próprio usuário, agrupadas por grupo. Filtra pelas
 * regras seguras: crédito, confirmadas, com parcela_atual/total
 * coerentes. Não infere parcelas por texto/valor.
 */
async function loadParcelasDoUsuario(userId: string): Promise<ParcelaRow[]> {
  const { data } = await supabaseAdmin
    .from("gastos")
    .select(
      "id, descricao, estabelecimento, valor, data, invoice_month, forma_pagamento, confirmado, parcela_atual, total_parcelas, grupo_parcelamento_id, cartao_id",
    )
    .eq("user_id", userId);
  const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  const out: ParcelaRow[] = [];
  for (const g of rows) {
    if ((g.forma_pagamento ?? "") !== "credito") continue;
    if (g.confirmado === false) continue;
    const grupoId = g.grupo_parcelamento_id as string | null;
    const cartaoId = g.cartao_id as string | null;
    if (!grupoId || !cartaoId) continue;
    const pa = Number(g.parcela_atual);
    const tp = Number(g.total_parcelas);
    if (!(Number.isFinite(pa) && Number.isFinite(tp) && pa >= 1 && tp >= 2 && pa <= tp)) continue;
    out.push({
      id: String(g.id ?? ""),
      descricao: String(g.descricao ?? g.estabelecimento ?? "").trim(),
      estabelecimento: (g.estabelecimento as string | null) ?? null,
      valor: Number(g.valor ?? 0) || 0,
      data: String(g.data ?? ""),
      invoiceMonth: (g.invoice_month as string | null) ?? null,
      parcelaAtual: pa,
      totalParcelas: tp,
      grupoId,
      cartaoId,
    });
  }
  return out;
}

/**
 * Define se uma parcela "ainda está aberta" — heurística segura,
 * sem inventar status de pagamento:
 *   - parcela com invoice_month >= ciclo atual do cartão; OU
 *   - parcela sem invoice_month cuja data cai no ciclo atual ou depois.
 */
function isParcelaEmAberto(
  p: ParcelaRow,
  cartao: CartaoRow,
  hoje: Date,
): boolean {
  const diaFech = Number(cartao.dia_fechamento ?? 1) || 1;
  const { mes, ano } = faturaCorrenteRef(diaFech, hoje);
  const curYm = ymOf(mes, ano);
  // "Em aberto" = parcela ainda NÃO foi para uma fatura já fechada
  // nem para a fatura atualmente em cobrança. Usamos > ciclo atual
  // (estritamente). A parcela do ciclo atual é considerada "prevista
  // até agora" (já apareceu na fatura corrente).
  if (p.invoiceMonth && /^\d{4}-\d{2}$/.test(p.invoiceMonth)) {
    return p.invoiceMonth > curYm;
  }
  if (!p.data) return false;
  const d = new Date(p.data + "T00:00:00");
  const fimAtual = cicloFatura(diaFech, mes, ano).fim;
  return d > fimAtual;

}

function buildCompraParcelada(
  parcelas: ParcelaRow[],
  cartao: CartaoRow,
  hoje: Date,
): CompraParcelada {
  const ordenadas = parcelas.slice().sort((a, b) => a.parcelaAtual - b.parcelaAtual);
  const totalCompra = ordenadas.reduce((s, p) => s + p.valor, 0);
  const restantes = ordenadas.filter((p) => isParcelaEmAberto(p, cartao, hoje));
  const saldo = restantes.reduce((s, p) => s + p.valor, 0);
  const proxima =
    restantes.slice().sort((a, b) => {
      const ka = a.invoiceMonth ?? a.data;
      const kb = b.invoiceMonth ?? b.data;
      return ka < kb ? -1 : ka > kb ? 1 : a.parcelaAtual - b.parcelaAtual;
    })[0] ?? null;
  const descricao = (ordenadas.find((p) => p.descricao)?.descricao ?? "").trim();
  return {
    grupoId: ordenadas[0].grupoId,
    descricao,
    cartaoId: cartao.id,
    totalParcelas: ordenadas[0].totalParcelas,
    parcelas: ordenadas,
    totalCompra,
    parcelasRestantes: restantes,
    saldoRestante: saldo,
    proximaParcela: proxima,
  };
}

/**
 * Retorna apenas as compras parceladas com pelo menos UMA parcela
 * ainda em aberto (cycle atual ou futuro). Ordenadas pela próxima
 * parcela mais próxima.
 */
export async function getComprasParceladasEmAberto(
  userId: string,
  hoje: Date = nowInAppTz(),
): Promise<CompraParcelada[]> {
  const parcelas = await loadParcelasDoUsuario(userId);
  if (parcelas.length === 0) return [];
  const cartoes = await loadCartoesDoUsuario(userId);
  const byCartao = new Map(cartoes.map((c) => [c.id, c]));
  const groups = new Map<string, ParcelaRow[]>();
  for (const p of parcelas) {
    const arr = groups.get(p.grupoId) ?? [];
    arr.push(p);
    groups.set(p.grupoId, arr);
  }
  const out: CompraParcelada[] = [];
  for (const [, arr] of groups) {
    const cartao = byCartao.get(arr[0].cartaoId);
    if (!cartao) continue; // cartão excluído → ignora
    const compra = buildCompraParcelada(arr, cartao, hoje);
    if (compra.parcelasRestantes.length > 0) out.push(compra);
  }
  out.sort((a, b) => {
    const ka = a.proximaParcela?.invoiceMonth ?? a.proximaParcela?.data ?? "";
    const kb = b.proximaParcela?.invoiceMonth ?? b.proximaParcela?.data ?? "";
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}

/** Detalhe de UMA compra parcelada por grupo. Null se não pertencer ao usuário. */
export async function getDetalheCompraParcelada(
  userId: string,
  grupoId: string,
  hoje: Date = nowInAppTz(),
): Promise<CompraParcelada | null> {
  if (!grupoId) return null;
  const parcelas = (await loadParcelasDoUsuario(userId)).filter((p) => p.grupoId === grupoId);
  if (parcelas.length === 0) return null;
  const cartoes = await loadCartoesDoUsuario(userId);
  const cartao = cartoes.find((c) => c.id === parcelas[0].cartaoId);
  if (!cartao) return null;
  return buildCompraParcelada(parcelas, cartao, hoje);
}

function normTermo(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Encontra compras parceladas EM ABERTO cuja descrição corresponde ao
 * termo informado (inclusão bidirecional, normalizada). Apenas dados
 * do próprio usuário.
 */
export async function findCompraParceladaByTerm(
  userId: string,
  termo: string,
  hoje: Date = nowInAppTz(),
): Promise<CompraParcelada[]> {
  const t = normTermo(termo);
  if (!t) return [];
  const compras = await getComprasParceladasEmAberto(userId, hoje);
  return compras.filter((c) => {
    const d = normTermo(c.descricao);
    if (!d) return false;
    return d === t || d.includes(t) || t.includes(d);
  });
}

