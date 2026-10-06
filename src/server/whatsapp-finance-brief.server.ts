/** Consultas financeiras determinísticas e contexto curto persistido no histórico WhatsApp. */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import { handleConsultaEspecifica, type EspecificaResult } from "./whatsapp-consultas-especificas.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = _supabaseAdmin as any;
const TZ = "America/Sao_Paulo";
const CONTEXT_MS = 15 * 60 * 1000;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const localToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const parts = (d: string) => d.split("-").map(Number) as [number, number, number];
const monthLabel = (y: number, m: number) => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const total = (rows: Array<{ valor: number | string | null }>) => rows.reduce((n, r) => n + (Number(r.valor) || 0), 0);

export type BriefIntent = "overview" | "compare" | "spending" | "category" | "top_category" | "category_growth" | "follow_previous";
export type BriefContext = { kind: "wa12_finance_query"; intent: BriefIntent; categoryId?: string; categoryName?: string };
type SpecificExpenseContext = { kind: "wa12_specific_expense_query"; term: string };

export function detectFinanceBrief(text: string): BriefIntent | null {
  const t = norm(text);
  if (/^(?:e )?(?:no |o |do )?mes passado\??$/.test(t)) return "follow_previous";
  if (/qual categoria (?:aumentou|cresceu) mais/.test(t)) return "category_growth";
  if (/\bonde (?:eu )?(?:estou|to) gastando mais\b|\bonde gasto mais\b/.test(t)) return "top_category";
  if (/\b(?:gastei mais com|quanto gastei (?:com|de)|despesas? (?:com|de))\b/.test(t)) return "category";
  if (/\b(?:gastei mais (?:esse|este|nesse|neste) mes|estou gastando mais|compar(?:e|ado|ar|acao)|quanto aumentaram minhas despesas)\b/.test(t)) return "compare";
  if (/\b(?:quanto gastei (?:no )?mes passado|gastos? (?:no|do) mes passado)\b/.test(t)) return "spending";
  if (/\b(?:como estao minhas financas|como estou (?:esse|este) mes|me da um resumo|como foi meu mes|resumo financeiro)\b/.test(t)) return "overview";
  return null;
}

export function equivalentMonthWindows(today = localToday(), fullMonths = false) {
  const [y, m, d] = parts(today);
  const currentStart = iso(y, m, 1);
  const previousStart = iso(y, m - 1, 1);
  const currentEnd = fullMonths ? iso(y, m + 1, 1) : iso(y, m, d + 1);
  const previousEnd = fullMonths ? currentStart : iso(y, m - 1, Math.min(d, new Date(Date.UTC(y, m - 1, 0)).getUTCDate()) + 1);
  return { currentStart, currentEnd, previousStart, previousEnd, currentLabel: monthLabel(y, m), previousLabel: monthLabel(y, m - 1), throughDay: d };
}

export function namedFullMonthComparison(text: string, today = localToday()) {
  const t = norm(text);
  const re = /\b(?:compare|comparar)\s+(\w+)\s+(?:inteiro|completo)\s+com\s+(\w+)\b/;
  const match = re.exec(t);
  if (!match) return null;
  const a = MONTHS.indexOf(match[1]) + 1;
  const b = MONTHS.indexOf(match[2]) + 1;
  if (!a || !b) return null;
  const [year, month] = parts(today);
  const ay = a > month ? year - 1 : year;
  const by = b > a ? ay - 1 : ay;
  return { currentStart: iso(ay, a, 1), currentEnd: iso(ay, a + 1, 1),
    previousStart: iso(by, b, 1), previousEnd: iso(by, b + 1, 1),
    currentLabel: monthLabel(ay, a), previousLabel: monthLabel(by, b) };
}

async function recentContext(userId: string, phone: string): Promise<BriefContext | SpecificExpenseContext | null> {
  const { data, error } = await db.from("whatsapp_messages")
    .select("parsed, recebida_em")
    .eq("user_id", userId).eq("telefone", phone)
    .gte("recebida_em", new Date(Date.now() - CONTEXT_MS).toISOString())
    .order("recebida_em", { ascending: false }).limit(1).maybeSingle();
  if (error || !data || Date.now() - Date.parse(data.recebida_em) > CONTEXT_MS) return null;
  if (data.parsed?.kind === "wa12_specific_expense_query" &&
      typeof data.parsed.term === "string" && data.parsed.term.length > 0 && data.parsed.term.length <= 80)
    return data.parsed as SpecificExpenseContext;
  return data.parsed?.kind === "wa12_finance_query" ? data.parsed as BriefContext : null;
}

type Entry = { valor: number | string | null; categoria_id?: string | null };
async function loadEntries(userId: string, table: "gastos" | "receitas", from: string, to: string): Promise<Entry[]> {
  const all: Entry[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let q = db.from(table).select(table === "gastos" ? "id, valor, categoria_id" : "id, valor")
      .eq("user_id", userId).gte("data", from).lt("data", to).order("id")
      .range(offset, offset + pageSize - 1);
    if (table === "receitas") q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) throw error;
    const page = Array.isArray(data) ? data as Entry[] : [];
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

async function loadCategories(userId: string): Promise<Array<{ id: string; nome: string }>> {
  const { data, error } = await db.from("categorias").select("id, nome").eq("user_id", userId);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function categoryTotals(rows: Entry[]) {
  const m = new Map<string, number>();
  for (const r of rows) if (r.categoria_id) m.set(r.categoria_id, (m.get(r.categoria_id) ?? 0) + (Number(r.valor) || 0));
  return m;
}

function comparison(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "Sem gastos nos dois períodos." : "Sem gastos no período anterior para calcular variação.";
  const pct = Math.round(Math.abs(current - previous) / previous * 100);
  return current === previous ? "Gastos iguais nos dois períodos." : `Gastos ${pct}% ${current > previous ? "maiores" : "menores"} que no período anterior.`;
}

type AmbiguousExpense = Extract<EspecificaResult, { status: "consulta_categoria_ambigua" }>;
export async function handleFinanceBrief(args: { userId: string; phone: string; externalId: string | null; text: string; receivedAt: string }): Promise<{ resposta: string; pendingCategory?: Pick<AmbiguousExpense, "termo" | "options"> } | null> {
  let intent = detectFinanceBrief(args.text);
  if (!intent) return null;
  const prior = intent === "follow_previous" ? await recentContext(args.userId, args.phone) : null;
  if (intent === "follow_previous" && prior?.kind === "wa12_specific_expense_query") {
    const out = await handleConsultaEspecifica(args.userId,
      { kind: "consulta_gasto_por_descricao", termo: prior.term }, "previous");
    if (out.status === "consulta_categoria_ambigua")
      return { resposta: out.resposta, pendingCategory: { termo: out.termo, options: out.options } };
    const { error } = await db.from("whatsapp_messages").insert({
      user_id: args.userId, telefone: args.phone, external_id: args.externalId,
      texto: args.text, recebida_em: args.receivedAt, status: "sem_pendencia",
      parsed: prior, resposta_sugerida: out.resposta,
    });
    if (error && error.code !== "23505") throw error;
    return { resposta: out.resposta };
  }
  if (intent === "follow_previous" && !prior) return { resposta: "Qual gasto você quer consultar do mês passado? Pode me dizer a categoria ou pedir um resumo." };
  const briefPrior = prior?.kind === "wa12_finance_query" ? prior : null;
  if (intent === "follow_previous") intent = briefPrior!.intent === "category" ? "category" : "spending";
  const lastMonth = (intent === "spending" || intent === "category") && (/mes passado/.test(norm(args.text)) || !!briefPrior);
  const fullMonths = /\b(?:inteiro|completo)\b/.test(norm(args.text)) || lastMonth;
  const w = equivalentMonthWindows(localToday(), fullMonths);
  const named = intent === "compare" ? namedFullMonthComparison(args.text) : null;
  const window = named ?? w;
  const from = lastMonth ? w.previousStart : window.currentStart;
  const to = lastMonth ? (fullMonths ? w.currentStart : w.previousEnd) : window.currentEnd;
  try {
    const [gastos, receitas, cats] = await Promise.all([
      loadEntries(args.userId, "gastos", from, to),
      loadEntries(args.userId, "receitas", from, to),
      loadCategories(args.userId),
    ]);
    const gastosTotal = total(gastos);
    const receitasTotal = total(receitas);
    const catTotals = categoryTotals(gastos);
    let category = briefPrior?.categoryId ? cats.find(c => c.id === briefPrior.categoryId) : undefined;
    if (intent === "category" && !category) {
      const query = norm(args.text);
      const matches = cats.filter(c => query.includes(norm(c.nome)) && norm(c.nome).length >= 3);
      if (matches.length === 1) category = matches[0];
      else return { resposta: "Qual categoria você quer consultar? Diga o nome que aparece no seu app." };
    }
    let resposta: string;
    if (intent === "category") {
      const currentCategory = catTotals.get(category!.id) ?? 0;
      if (/gastei mais com/.test(norm(args.text))) {
        const prev = await loadEntries(args.userId, "gastos", w.previousStart, w.previousEnd);
        const previousCategory = categoryTotals(prev).get(category!.id) ?? 0;
        resposta = `${category!.nome}: ${brl(currentCategory)} até o dia ${w.throughDay} deste mês, contra ${brl(previousCategory)} no mesmo período do mês passado.\n${comparison(currentCategory, previousCategory)}`;
      } else resposta = `Em ${lastMonth ? w.previousLabel : w.currentLabel}, você registrou ${brl(currentCategory)} em ${category!.nome}.`;
    } else if (intent === "spending") {
      resposta = `Gastos de ${lastMonth ? w.previousLabel : w.currentLabel}${!fullMonths ? ` até o dia ${w.throughDay}` : ""}: ${brl(gastosTotal)}.`;
    } else {
      const prevGastos = intent === "top_category" ? [] : await loadEntries(args.userId, "gastos", window.previousStart, window.previousEnd);
      const prevTotal = total(prevGastos);
      if (intent === "top_category") {
        const top = [...catTotals].filter(([id]) => cats.some(c => c.id === id)).sort((a, b) => b[1] - a[1])[0];
        resposta = top ? `Sua maior categoria em ${w.currentLabel} até o dia ${w.throughDay} é ${cats.find(c => c.id === top[0])!.nome}: ${brl(top[1])}.` : "Ainda não há gastos categorizados neste mês.";
      } else if (intent === "category_growth") {
        const prevCats = categoryTotals(prevGastos);
        const growth = [...catTotals].map(([id, value]) => ({ id, delta: value - (prevCats.get(id) ?? 0) })).filter(x => x.delta > 0 && cats.some(c => c.id === x.id)).sort((a, b) => b.delta - a.delta)[0];
        resposta = growth ? `${cats.find(c => c.id === growth.id)!.nome} teve o maior aumento: ${brl(growth.delta)} a mais que no mesmo período de ${w.previousLabel}.` : "Nenhuma categoria aumentou nesse período comparável.";
      } else if (intent === "compare") {
        resposta = named
          ? `Gastos de ${named.currentLabel}: ${brl(gastosTotal)}. Em ${named.previousLabel}: ${brl(prevTotal)}.\n${comparison(gastosTotal, prevTotal)}`
          : `Gastos até o dia ${w.throughDay}: ${brl(gastosTotal)} em ${w.currentLabel} e ${brl(prevTotal)} no mesmo período de ${w.previousLabel}.\n${comparison(gastosTotal, prevTotal)}`;
      } else {
        const top = [...catTotals].sort((a, b) => b[1] - a[1])[0];
        const topName = top ? cats.find(c => c.id === top[0])?.nome : null;
        resposta = [`📊 ${w.currentLabel} até o dia ${w.throughDay}`, `Receitas registradas: ${brl(receitasTotal)}`, `Gastos registrados: ${brl(gastosTotal)}`, `Resultado do período: ${brl(receitasTotal - gastosTotal)}`, top && topName ? `Maior categoria: ${topName} (${brl(top[1])})` : "", comparison(gastosTotal, prevTotal)].filter(Boolean).join("\n");
      }
    }
    const context: BriefContext = { kind: "wa12_finance_query", intent, ...(category ? { categoryId: category.id, categoryName: category.nome } : {}) };
    const { error } = await db.from("whatsapp_messages").insert({ user_id: args.userId, telefone: args.phone, external_id: args.externalId, texto: args.text, recebida_em: args.receivedAt, status: "sem_pendencia", parsed: context, resposta_sugerida: resposta });
    if (error && error.code !== "23505") throw error;
    return { resposta };
  } catch {
    return { resposta: "Não consegui consultar seus lançamentos agora. Tente novamente daqui a pouco." };
  }
}
