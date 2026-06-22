/**
 * Fase WA-G4 — Consultas financeiras específicas via WhatsApp.
 *
 * Reconhece e responde perguntas objetivas sobre dados reais do próprio
 * usuário (gasto por descrição, gasto por categoria, receita por tipo,
 * gastos de ontem, sobra do mês). Sem IA, sem chat livre, sem APIs
 * externas. Todas as queries filtram por user_id e usam timezone
 * America/Sao_Paulo. Despesas e receitas com data futura são sempre
 * excluídas.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import { whatsappMessages as M } from "./whatsapp-messages";
import { TIPOS_RECEITA, type TipoReceita } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin = _supabaseAdmin as any;

const APP_TZ = "America/Sao_Paulo";

// ---------- normalização ----------
function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- datas ----------
function todayLocalISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function monthStartISO(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------- detecção ----------

export type EspecificaIntent =
  | { kind: "consulta_gasto_por_descricao"; termo: string }
  | { kind: "consulta_gasto_por_categoria"; termo: string }
  | { kind: "consulta_receita_por_tipo"; termo: string }
  | { kind: "consulta_gastos_ontem" }
  | { kind: "consulta_sobra_mes" };

/**
 * Detecta intenção de consulta específica. Só reconhece quando a mensagem
 * carrega claramente intenção de pergunta — "Uber 29,90" jamais vira
 * consulta. Retorna null quando nada bate.
 */
export function detectConsultaEspecifica(texto: string): EspecificaIntent | null {
  const t = norm(texto);
  if (!t) return null;

  // ---- gastos de ontem (antes de qualquer "gastei com X") ----
  if (
    /\b(quais|quanto|qual o total)\b.*\bontem\b/.test(t) ||
    /\b(meus|os) gastos? de ontem\b/.test(t) ||
    /\bgastos? de ontem\b/.test(t) ||
    /\bresumo de ontem\b/.test(t) ||
    /\bcomo foi (o )?meu dia ontem\b/.test(t)
  ) {
    return { kind: "consulta_gastos_ontem" };
  }

  // ---- quanto sobra da renda este mês ----
  if (
    /\bquanto (sobra|sobrou|resta|restou)\b/.test(t) ||
    /\bquanto (eu )?ainda tenho (da )?(minha )?renda\b/.test(t) ||
    /\bquanto (eu )?(posso usar|tenho dispon[ií]vel)( este m[eê]s)?\b/.test(t) ||
    /\bquanto (da )?(minha )?renda (sobra|sobrou|resta|restou|ainda tenho)\b/.test(t)
  ) {
    return { kind: "consulta_sobra_mes" };
  }

  // ---- receita por tipo ----
  // Exige "recebi", "ganhei", "recebido", "total de salario/freela...".
  let m: RegExpMatchArray | null = null;
  m = t.match(
    /\b(quanto|qual o total)\b.*\b(recebi|ganhei|foi recebido)\b\s+(?:de|em|com)\s+(.+?)$/,
  );
  if (m) {
    const termo = stripPeriodoSuffix(m[3]);
    if (termo) return { kind: "consulta_receita_por_tipo", termo };
  }
  m = t.match(/\btotal (?:de|em)\s+([a-z0-9 ]+?)\s+(?:no )?m[eê]s\b/);
  if (m) {
    const termo = stripPeriodoSuffix(m[1]);
    if (termo && looksLikeTipoReceita(termo)) {
      return { kind: "consulta_receita_por_tipo", termo };
    }
  }

  // ---- gasto por descrição/categoria ----
  // Padrões aceitos:
  //   "quanto gastei com X (este mês)"
  //   "quanto eu gastei em/no/na X"
  //   "total gasto com X" / "total que gastei com X"
  //   "quanto foi gasto com X"
  //   "gastei quanto com X"
  const expensePatterns: RegExp[] = [
    /\bquanto (?:eu )?gastei\s+(?:com|em|no|na|de)\s+(.+?)$/,
    /\bgastei quanto\s+(?:com|em|no|na|de)\s+(.+?)$/,
    /\btotal (?:gasto|que (?:eu )?gastei)\s+(?:com|em|no|na|de)\s+(.+?)$/,
    /\bquanto foi gasto\s+(?:com|em|no|na|de)\s+(.+?)$/,
    /\btotal de gastos\s+(?:com|em|no|na|de)\s+(.+?)$/,
  ];
  for (const re of expensePatterns) {
    const mm = t.match(re);
    if (mm) {
      const termo = stripPeriodoSuffix(mm[1]);
      if (!termo) continue;
      // O caller decide se é categoria ou descrição.
      return { kind: "consulta_gasto_por_descricao", termo };
    }
  }

  return null;
}

const PERIODO_SUFFIXES = [
  "este mes", "esse mes", "neste mes", "nesse mes", "do mes", "no mes",
  "este mês", "esse mês", "neste mês", "nesse mês", "do mês", "no mês",
  "hoje", "agora",
];
function stripPeriodoSuffix(raw: string): string {
  let s = raw.trim();
  for (const suf of PERIODO_SUFFIXES) {
    const n = norm(s);
    const nsuf = norm(suf);
    if (n.endsWith(" " + nsuf)) {
      s = s.slice(0, s.length - suf.length).trim();
    }
  }
  return s.replace(/[?!.,;:]+$/g, "").trim();
}

function looksLikeTipoReceita(termo: string): boolean {
  const n = norm(termo);
  for (const t of TIPOS_RECEITA) {
    if (n.includes(norm(t.label)) || n.includes(t.id)) return true;
  }
  if (/\b(freela|freelancer|freelance|salario|comissao|venda|vendas|reembolso|bonus|pix)\b/.test(n)) {
    return true;
  }
  return false;
}

// ---------- tipo de receita: mapeamento termo → tipo ----------
const TIPO_ALIASES: Array<{ tipo: TipoReceita; label: string; words: string[] }> = [
  { tipo: "salario",   label: "Salário",    words: ["salario"] },
  { tipo: "freelance", label: "Freelance",  words: ["freelancer", "freela", "freelance"] },
  { tipo: "comissao",  label: "Comissão",   words: ["comissao", "comissoes"] },
  { tipo: "venda",     label: "Venda",      words: ["venda", "vendas", "vendi"] },
  { tipo: "reembolso", label: "Reembolso",  words: ["reembolso", "reembolsos"] },
  { tipo: "pix",       label: "Pix",        words: ["pix"] },
  { tipo: "bonus",     label: "Bônus",      words: ["bonus"] },
];

function matchTipoReceita(termo: string): { tipo: TipoReceita; label: string } | null {
  const n = norm(termo);
  for (const t of TIPO_ALIASES) {
    for (const w of t.words) {
      if (n === w || new RegExp(`\\b${w}\\b`).test(n)) return { tipo: t.tipo, label: t.label };
    }
  }
  return null;
}

// ---------- I/O ----------
type GastoRow = {
  descricao: string | null;
  valor: number | string | null;
  data: string;
  categoria_id: string | null;
};
type ReceitaRow = {
  descricao: string | null;
  valor: number | string | null;
  data: string;
  tipo: string | null;
};
type CategoriaRow = { id: string; nome: string | null };

async function loadGastos(userId: string, from: string, toExclusive: string): Promise<GastoRow[]> {
  const { data } = await supabaseAdmin
    .from("gastos")
    .select("descricao, valor, data, categoria_id")
    .eq("user_id", userId)
    .gte("data", from)
    .lt("data", toExclusive);
  return Array.isArray(data) ? (data as GastoRow[]) : [];
}

async function loadReceitas(userId: string, from: string, toExclusive: string): Promise<ReceitaRow[]> {
  const { data } = await supabaseAdmin
    .from("receitas")
    .select("descricao, valor, data, tipo")
    .eq("user_id", userId)
    .gte("data", from)
    .lt("data", toExclusive);
  return Array.isArray(data) ? (data as ReceitaRow[]) : [];
}

/**
 * Carrega as categorias do próprio usuário. A tabela `public.categorias`
 * só armazena categorias de despesa (receitas têm seu próprio enum
 * `tipo`). Importante: NÃO selecionar colunas inexistentes — a versão
 * anterior pedia `tipo`, coluna que não existe no schema real, e o
 * Supabase devolvia erro, deixando a busca por categoria sempre vazia.
 */
async function loadCategoriasDespesa(userId: string): Promise<CategoriaRow[]> {
  const { data } = await supabaseAdmin
    .from("categorias")
    .select("id, nome")
    .eq("user_id", userId);
  if (!Array.isArray(data)) return [];
  return data as CategoriaRow[];
}

function sumValor(rows: { valor: number | string | null }[]): number {
  let total = 0;
  for (const r of rows) total += Number(r.valor ?? 0) || 0;
  return total;
}

// ---------- match de termos ----------

function descricaoMatches(descricao: string, termo: string): boolean {
  const d = norm(descricao);
  const t = norm(termo);
  if (!d || !t) return false;
  if (d.includes(t)) return true;
  // tokens — todos os tokens do termo precisam estar na descrição
  const tokens = t.split(" ").filter((w) => w.length >= 2);
  if (tokens.length === 0) return false;
  return tokens.every((w) => new RegExp(`\\b${w}`).test(d));
}

function singularize(s: string): string {
  // Português: heurística simples para casar plural/singular.
  // Mantém palavras curtas intactas.
  if (s.length < 4) return s;
  if (s.endsWith("oes")) return s.slice(0, -3) + "ao"; // cartoes -> cartao
  if (s.endsWith("aes")) return s.slice(0, -3) + "ao"; // paes -> pao
  if (s.endsWith("ais")) return s.slice(0, -2) + "l";  // animais -> animal
  if (s.endsWith("eis")) return s.slice(0, -2) + "l";  // moveis -> movel
  if (s.endsWith("ois")) return s.slice(0, -2) + "l";  // farois -> farol
  if (s.endsWith("uis")) return s.slice(0, -2) + "l";  // azuis -> azul
  if (s.endsWith("ns"))  return s.slice(0, -2) + "m";  // homens -> homem
  if (s.endsWith("res") || s.endsWith("ses") || s.endsWith("zes")) return s.slice(0, -2);
  if (s.endsWith("s"))   return s.slice(0, -1);
  return s;
}

function normCat(s: string): string {
  return singularize(norm(s));
}

function findCategoriasByTermo(
  categorias: CategoriaRow[],
  termo: string,
): CategoriaRow[] {
  const t = normCat(termo);
  if (!t) return [];
  const exact = categorias.filter((c) => normCat(c.nome ?? "") === t);
  if (exact.length > 0) return exact;
  return categorias.filter((c) => {
    const n = normCat(c.nome ?? "");
    if (!n) return false;
    return n.includes(t) || t.includes(n);
  });
}

// ---------- handlers ----------

export type EspecificaResult =
  | { status: "consulta"; resposta: string }
  | {
      status: "consulta_categoria_ambigua";
      resposta: string;
      termo: string;
      options: Array<{ id: string; nome: string }>;
    };

/** Janela mensal "[primeiro_dia_do_mes, amanha)" — exclui datas futuras. */
function janelaMesAteHoje(): { from: string; to: string; hoje: string } {
  const hoje = todayLocalISO();
  return { from: monthStartISO(hoje), to: addDaysISO(hoje, 1), hoje };
}

/** Janela do dia anterior "[ontem, hoje)". */
function janelaOntem(): { from: string; to: string } {
  const hoje = todayLocalISO();
  return { from: addDaysISO(hoje, -1), to: hoje };
}

export async function handleConsultaEspecifica(
  userId: string,
  intent: EspecificaIntent,
): Promise<EspecificaResult> {
  switch (intent.kind) {
    case "consulta_gastos_ontem":
      return await handleGastosOntem(userId);
    case "consulta_sobra_mes":
      return await handleSobraMes(userId);
    case "consulta_receita_por_tipo":
      return await handleReceitaPorTipo(userId, intent.termo);
    case "consulta_gasto_por_descricao":
      return await handleGastoPorDescricaoOuCategoria(userId, intent.termo);
    case "consulta_gasto_por_categoria":
      return await handleGastoPorDescricaoOuCategoria(userId, intent.termo);
  }
}

async function handleGastosOntem(userId: string): Promise<EspecificaResult> {
  const { from, to } = janelaOntem();
  const gastos = await loadGastos(userId, from, to);
  if (gastos.length === 0) {
    return { status: "consulta", resposta: M.consultaEspecifica.gastosOntemSemRegistros() };
  }
  const itens = gastos
    .map((g) => ({ descricao: (g.descricao ?? "").trim() || "Gasto", valor: Number(g.valor ?? 0) || 0 }))
    .sort((a, b) => b.valor - a.valor);
  const total = itens.reduce((acc, g) => acc + g.valor, 0);
  const maior = itens[0];
  const topItens = itens.slice(0, 3);
  return {
    status: "consulta",
    resposta: M.consultaEspecifica.gastosOntem({
      total: formatBRL(total),
      quantidade: itens.length,
      maior: { descricao: maior.descricao, valor: formatBRL(maior.valor) },
      itens: itens.length > 1
        ? topItens.map((g) => ({ descricao: g.descricao, valor: formatBRL(g.valor) }))
        : [],
    }),
  };
}

async function handleSobraMes(userId: string): Promise<EspecificaResult> {
  const { from, to } = janelaMesAteHoje();
  const [gastos, receitas] = await Promise.all([
    loadGastos(userId, from, to),
    loadReceitas(userId, from, to),
  ]);
  const totDesp = sumValor(gastos);
  const totRec = sumValor(receitas);
  if (totRec <= 0) {
    return { status: "consulta", resposta: M.consultaEspecifica.sobraSemReceitas() };
  }
  const saldo = totRec - totDesp;
  if (saldo < 0) {
    return {
      status: "consulta",
      resposta: M.consultaEspecifica.sobraNegativa({
        receitas: formatBRL(totRec),
        despesas: formatBRL(totDesp),
        valorAcima: formatBRL(-saldo),
      }),
    };
  }
  return {
    status: "consulta",
    resposta: M.consultaEspecifica.sobraPositiva({
      receitas: formatBRL(totRec),
      despesas: formatBRL(totDesp),
      saldo: formatBRL(saldo),
    }),
  };
}

async function handleReceitaPorTipo(userId: string, termo: string): Promise<EspecificaResult> {
  const match = matchTipoReceita(termo);
  const { from, to } = janelaMesAteHoje();
  const receitas = await loadReceitas(userId, from, to);
  const tipoLabel = match?.label ?? termo;
  if (!match) {
    return {
      status: "consulta",
      resposta: M.consultaEspecifica.receitaSemResultado(tipoLabel),
    };
  }
  const filtradas = receitas.filter((r) => String(r.tipo ?? "").toLowerCase() === match.tipo);
  if (filtradas.length === 0) {
    return {
      status: "consulta",
      resposta: M.consultaEspecifica.receitaSemResultado(tipoLabel),
    };
  }
  const total = sumValor(filtradas);
  return {
    status: "consulta",
    resposta: M.consultaEspecifica.receitaPorTipo({
      tipo: tipoLabel,
      valor: formatBRL(total),
      quantidade: filtradas.length,
    }),
  };
}

async function handleGastoPorDescricaoOuCategoria(
  userId: string,
  termo: string,
): Promise<EspecificaResult> {
  const categorias = await loadCategoriasDespesa(userId);
  const matches = findCategoriasByTermo(categorias, termo);

  if (matches.length > 1) {
    return {
      status: "consulta_categoria_ambigua",
      termo,
      options: matches.slice(0, 5).map((c) => ({ id: c.id, nome: c.nome ?? "" })),
      resposta: M.consultaEspecifica.categoriaAmbigua({
        termo,
        opcoes: matches.slice(0, 5).map((c) => c.nome ?? ""),
      }),
    };
  }

  if (matches.length === 1) {
    return await respostaCategoria(userId, matches[0]);
  }

  // Sem match de categoria → consulta por descrição.
  return await respostaDescricao(userId, termo);
}

async function respostaCategoria(
  userId: string,
  categoria: CategoriaRow,
): Promise<EspecificaResult> {
  const { from, to } = janelaMesAteHoje();
  const gastos = await loadGastos(userId, from, to);
  const filtrados = gastos.filter((g) => g.categoria_id === categoria.id);
  if (filtrados.length === 0) {
    return {
      status: "consulta",
      resposta: M.consultaEspecifica.categoriaSemResultado(categoria.nome ?? ""),
    };
  }
  const total = sumValor(filtrados);
  return {
    status: "consulta",
    resposta: M.consultaEspecifica.gastoPorCategoria({
      categoria: categoria.nome ?? "",
      valor: formatBRL(total),
      quantidade: filtrados.length,
    }),
  };
}

async function respostaDescricao(userId: string, termo: string): Promise<EspecificaResult> {
  const { from, to } = janelaMesAteHoje();
  const gastos = await loadGastos(userId, from, to);
  const filtrados = gastos.filter((g) => descricaoMatches(g.descricao ?? "", termo));
  if (filtrados.length === 0) {
    return {
      status: "consulta",
      resposta: M.consultaEspecifica.descricaoSemResultado(termo),
    };
  }
  const total = sumValor(filtrados);
  return {
    status: "consulta",
    resposta: M.consultaEspecifica.gastoPorDescricao({
      descricao: termo,
      valor: formatBRL(total),
      quantidade: filtrados.length,
    }),
  };
}

/**
 * Continuação após pergunta de categoria ambígua. Tenta casar a resposta
 * do usuário com uma das opções persistidas. Retorna null quando nada
 * bate — nesse caso o pipeline encerra o estado temporário e segue o
 * processamento normal.
 */
export async function handleCategoriaAmbiguaResponse(
  userId: string,
  texto: string,
  options: Array<{ id: string; nome: string }>,
): Promise<EspecificaResult | null> {
  const t = norm(texto);
  if (!t) return null;
  let chosen: { id: string; nome: string } | null = null;
  for (const o of options) {
    const n = norm(o.nome);
    if (!n) continue;
    if (n === t || t.includes(n) || n.includes(t)) {
      chosen = o;
      break;
    }
  }
  if (!chosen) return null;
  // Reusa respostaCategoria — precisamos do `categoria_id` real para filtrar.
  return await respostaCategoria(userId, { id: chosen.id, nome: chosen.nome });
}
