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
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin = _supabaseAdmin as any;

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
