/**
 * Fase WA-G2 — Consultas financeiras pelo WhatsApp.
 *
 * Camada server-only que reconhece intenções explícitas de consulta
 * (ajuda, resumo, maiores gastos, impacto) e responde usando APENAS dados
 * reais do usuário autenticado, com agregações simples no banco.
 *
 * - Sem IA / LLM / API externa.
 * - Sem conversa aberta.
 * - Sempre supõe que o usuário já foi resolvido e é elegível.
 * - Sempre considera mês calendário / últimos 7 dias em America/Sao_Paulo.
 * - Nunca acessa dados de outros usuários, cartões ou identificadores internos.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import { whatsappMessages as M } from "./whatsapp-messages";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin = _supabaseAdmin as any;

export type ConsultaIntent =
  | "ajuda_whatsapp"
  | "resumo_semana"
  | "resumo_mes"
  | "maiores_gastos_semana"
  | "maiores_gastos_mes"
  | "impacto_despesas_renda"
  | "listar_receitas_mes"
  | "listar_gastos_mes"
  | "gastos_por_categoria_mes"
  | "orcamento_mes"
  | "listar_recorrencias"
  | "listar_contas_receber";

const APP_TZ = "America/Sao_Paulo";

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- detecção de intenção ----------

/**
 * Retorna a intenção de consulta detectada ou null.
 *
 * IMPORTANTE: nunca é chamada quando existe sessão pendente — quem decide
 * isso é o pipeline principal. Aqui só fazemos o match textual.
 */
export function detectConsultaIntent(texto: string): ConsultaIntent | null {
  const t = norm(texto);
  if (!t) return null;

  // ----- ajuda / menu -----
  // matches isolados ou expressões "o que voce faz/consegue fazer / como pode me ajudar"
  if (
    t === "ajuda" ||
    t === "menu" ||
    t === "ajudar" ||
    t === "help" ||
    /\bo que voce (faz|consegue fazer|pode fazer)\b/.test(t) ||
    /\bcomo voce (pode|consegue) (me )?ajudar\b/.test(t) ||
    /\bquais (sao )?(os )?seus comandos\b/.test(t) ||
    /\bquais (sao )?(as )?op[cç]oes\b/.test(t)
  ) {
    return "ajuda_whatsapp";
  }

  // ----- WA-Q-Orcamento — consulta de LIMITES / ORÇAMENTO do mês -----
  // Precede toda a pipeline de criação (parser de gasto/receita) e
  // também o WA-F5 (limite de cartão), pois "limites" isolado é
  // ambíguo mas por padrão o usuário quer o orçamento mensal.
  // NUNCA cria sessão, gasto, receita, recorrência ou orçamento.
  if (
    t === "limite" ||
    t === "limites" ||
    t === "meu limite" ||
    t === "meus limites" ||
    t === "orcamento" ||
    t === "orcamentos" ||
    t === "meu orcamento" ||
    t === "meus orcamentos" ||
    /\bcomo est[aã]o? (os )?meus? limites\b/.test(t) ||
    /\bcomo est[aã] (o )?meu orcamento\b/.test(t) ||
    /\borcamento do m[eê]s\b/.test(t) ||
    /\bmeu orcamento(?: do m[eê]s)?\b/.test(t) ||
    /\bmeus orcamentos\b/.test(t) ||
    /\bquanto (ainda )?(eu )?posso gastar\b/.test(t) ||
    /\bquanto (ainda )?(me )?sobra (do|no) (meu )?orcamento\b/.test(t)
  ) {
    return "orcamento_mes";
  }

  // ----- WA-Q-Recorrencias — listagem de recorrências ATIVAS -----
  // Precede parser de gasto/receita/contas. Read-only puro. Nunca abre
  // sessão nem escreve em gastos/receitas/recorrencias/contas_a_pagar.
  if (
    t === "recorrencias" ||
    t === "recorrencia" ||
    t === "minhas recorrencias" ||
    t === "minha recorrencia" ||
    t === "recorrencias ativas" ||
    /\bquais (sao )?(as )?minhas recorrencias\b/.test(t) ||
    /\blistar (as )?(minhas )?recorrencias\b/.test(t) ||
    /\bver (as )?(minhas )?recorrencias\b/.test(t) ||
    /\bmeus pagamentos recorrentes\b/.test(t) ||
    /\bminhas (despesas|contas) recorrentes\b/.test(t) ||
    /\bminhas receitas recorrentes\b/.test(t) ||
    /\bassinaturas ativas\b/.test(t) ||
    /\bminhas assinaturas\b/.test(t)
  ) {
    return "listar_recorrencias";
  }

  // ----- WA-Q-ContasReceber — listagem read-only de contas A RECEBER pendentes -----
  // Precede QUALQUER parser de criação (receita, gasto, recorrência). A palavra
  // "receber" isolada arrastava a mensagem para o parser de receita
  // (abrindo `rec_aguardando_tipo`). Aqui é 100% read-only. Nunca abre sessão
  // nem escreve em receitas/contas_a_receber/gastos/recorrencias.
  if (
    t === "contas a receber" ||
    t === "conta a receber" ||
    t === "valores a receber" ||
    t === "valor a receber" ||
    t === "recebimentos pendentes" ||
    t === "meus recebimentos" ||
    t === "meus recebimentos pendentes" ||
    /\bo que (eu )?tenho (a|para|pra) receber\b/.test(t) ||
    /\bquem me deve\b/.test(t) ||
    /\bquem esta me devendo\b/.test(t) ||
    /\blistar (as )?(minhas )?contas a receber\b/.test(t) ||
    /\bver (as )?(minhas )?contas a receber\b/.test(t) ||
    /\bminhas contas a receber\b/.test(t)
  ) {
    return "listar_contas_receber";
  }



  // ----- maiores gastos (verificar antes de "mes/semana" sozinhos) -----
  const fala_em_maiores =
    /\bmaiores? gastos?\b/.test(t) ||
    /\bonde (eu )?(estou|to) gastando (mais|mais )/.test(t) ||
    /\bonde (estou|to) gastando mais\b/.test(t) ||
    /\bgastei mais com\b/.test(t);
  if (fala_em_maiores) {
    if (/\bm[eê]s\b|\bmensal\b|\bdo mes\b/.test(t)) return "maiores_gastos_mes";
    return "maiores_gastos_semana";
  }

  // ----- impacto despesas / renda -----
  if (
    /\bquanto (meus )?gastos? afet/.test(t) ||
    /\bquanto (das )?(minhas )?receitas eu gastei\b/.test(t) ||
    /\bque (porcentagem|percentual) da (minha )?renda\b/.test(t) ||
    /\b(porcentagem|percentual) da (minha )?renda\b/.test(t) ||
    /\bimpacto (dos|das) (meus |minhas )?(gastos|despesas)\b/.test(t) ||
    /\bgastos? na renda\b/.test(t)
  ) {
    return "impacto_despesas_renda";
  }

  // ----- resumo da semana -----
  if (
    /\bresumo (da )?semana\b/.test(t) ||
    /\bcomo foi (a )?minha semana\b/.test(t) ||
    /\bquanto (eu )?gastei (n?essa|esta|na) semana\b/.test(t) ||
    /\bcomo est[aã]o (as )?minhas finan[cç]as (n?essa|esta|na) semana\b/.test(t) ||
    /\bfinan[cç]as (da |n?essa |esta |na )?semana\b/.test(t)
  ) {
    return "resumo_semana";
  }

  // ----- resumo do mês -----
  // Nota: frases como "quanto gastei no mês" são totalizadoras de gastos
  // e roteadas para listar_gastos_mes (mais específico), não para resumo.
  if (
    /\bresumo (do )?m[eê]s\b/.test(t) ||
    /\bcomo foi (o )?meu m[eê]s\b/.test(t) ||
    /\bcomo est[aã]o (as )?minhas finan[cç]as\b/.test(t) ||
    /\bfinan[cç]as do m[eê]s\b/.test(t)
  ) {
    return "resumo_mes";
  }

  // ----- listar receitas do mês (precede qualquer fluxo de criação) -----
  // Aceita variações comuns de consulta sobre receitas/entradas recebidas
  // no mês corrente. Frases sem "do mês" (ex.: "minhas receitas") caem
  // aqui também, defaultando para o mês atual. Evita casar "renda"
  // isolada (que aparece em "quanto sobra da minha renda").
  if (
    /\bminhas receitas\b/.test(t) ||
    /\breceitas (do |deste |desse |neste |nesse )?m[eê]s\b/.test(t) ||
    /\breceitas (do )?(m[eê]s )?atual\b/.test(t) ||
    /\b(quais|quanto|qual o total) (sao |s[aã]o |de |das )?(as )?(minhas )?receitas\b/.test(t) ||
    /\b(o que|quanto) (eu )?recebi (este|esse|neste|nesse|no|do) ?m[eê]s\b/.test(t) ||
    /\btotal (de |das )?receitas\b/.test(t) ||
    /\blistar (as )?(minhas )?receitas\b/.test(t) ||
    /\bver (as )?(minhas )?receitas\b/.test(t)
  ) {
    return "listar_receitas_mes";
  }

  // ----- gastos por categoria (precede parser de criação e de cartão) -----
  // Aceita variações que pedem agregação por grupo, evitando que o parser
  // de gasto interprete "categoria" como nome de estabelecimento.
  if (
    /\bgastos? por categoria(s)?\b/.test(t) ||
    /\bdespesas? por categoria(s)?\b/.test(t) ||
    /\bcategorias? (de |dos |das )?(gastos|despesas)\b/.test(t) ||
    /\bonde (eu )?gastei mais\b/.test(t) ||
    /\bonde gasto mais\b/.test(t) ||
    /\bgastos? agrupados? por categoria(s)?\b/.test(t) ||
    /\btotal por categoria(s)?\b/.test(t)
  ) {
    return "gastos_por_categoria_mes";
  }

  // ----- listar gastos/despesas do mês (precede parser de cartão/fatura) -----
  // Cobre variações comuns. Evita roteamento incorreto para faturas, onde
  // "gastos do mês" era interpretado como "compras do <cartão mês>".
  // Excluir frases com modificadores temporais que pertencem a
  // consultas específicas (ex.: "meus gastos de ontem", "gastos de hoje",
  // "gastos da semana") — essas são roteadas por detectConsultaEspecifica.
  const tempModificador = /\b(ontem|hoje|amanha|amanh[aã]|da semana|de hoje|de ontem)\b/.test(t);
  if (
    !tempModificador && (
      /\bmeus gastos\b/.test(t) ||
      /\bminhas despesas\b/.test(t) ||
      /\bgastos (do |deste |desse |neste |nesse )?m[eê]s\b/.test(t) ||
      /\bdespesas (do |deste |desse |neste |nesse )?m[eê]s\b/.test(t) ||
      /\bgastos (do )?(m[eê]s )?atual\b/.test(t) ||
      /\bquanto (eu )?gastei (este|esse|neste|nesse|no|do) ?m[eê]s\b/.test(t) ||
      /\btotal (de |dos )?gastos\b/.test(t) ||
      /\btotal (de |das )?despesas\b/.test(t) ||
      /\blistar (os |as )?(meus |minhas )?(gastos|despesas)\b/.test(t) ||
      /\bver (os |as )?(meus |minhas )?(gastos|despesas)\b/.test(t)
    )
  ) {
    return "listar_gastos_mes";
  }

  return null;
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
// WA-G3: removida `nextMonthStartISO` — janelas mensais usam "até hoje".


function mesPorExtenso(iso: string): string {
  const [, m] = iso.split("-").map(Number);
  const meses = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  return meses[m - 1] ?? "";
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------- consultas a dados ----------

type GastoRow = {
  descricao: string | null;
  valor: number | string | null;
  data: string;
  categoria_id: string | null;
};
type ReceitaRow = { valor: number | string | null; data: string };
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

async function loadReceitas(
  userId: string,
  from: string,
  toExclusive: string,
): Promise<ReceitaRow[]> {
  const { data } = await supabaseAdmin
    .from("receitas")
    .select("valor, data")
    .eq("user_id", userId)
    .gte("data", from)
    .lt("data", toExclusive);
  return Array.isArray(data) ? (data as ReceitaRow[]) : [];
}

async function loadCategoriasMap(userId: string): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from("categorias")
    .select("id, nome")
    .eq("user_id", userId);
  const map = new Map<string, string>();
  if (Array.isArray(data)) {
    for (const c of data as CategoriaRow[]) {
      if (c.id) map.set(c.id, (c.nome ?? "").trim());
    }
  }
  return map;
}

function sumValor(rows: { valor: number | string | null }[]): number {
  let total = 0;
  for (const r of rows) total += Number(r.valor ?? 0) || 0;
  return total;
}

function maiorGrupoCategoria(
  gastos: GastoRow[],
  catMap: Map<string, string>,
): { nome: string; valor: number } | null {
  if (gastos.length === 0) return null;
  const totals = new Map<string, number>();
  for (const g of gastos) {
    const key = g.categoria_id ?? "__sem__";
    totals.set(key, (totals.get(key) ?? 0) + (Number(g.valor ?? 0) || 0));
  }
  let bestKey = "";
  let bestVal = -Infinity;
  for (const [k, v] of totals) {
    if (v > bestVal) {
      bestVal = v;
      bestKey = k;
    }
  }
  if (bestVal <= 0) return null;
  const nome = bestKey === "__sem__" ? "Outros" : (catMap.get(bestKey) || "Outros");
  return { nome, valor: bestVal };
}

// ---------- handlers ----------

export type ConsultaResult = { status: "consulta"; resposta: string };

async function handleResumoSemana(userId: string): Promise<ConsultaResult> {
  const hoje = todayLocalISO();
  const from = addDaysISO(hoje, -6);
  const to = addDaysISO(hoje, 1);
  const [gastos, receitas, catMap] = await Promise.all([
    loadGastos(userId, from, to),
    loadReceitas(userId, from, to),
    loadCategoriasMap(userId),
  ]);
  const totDesp = sumValor(gastos);
  const totRec = sumValor(receitas);
  const grupo = maiorGrupoCategoria(gastos, catMap);
  return {
    status: "consulta",
    resposta: M.consulta.resumoSemana({
      receitas: formatBRL(totRec),
      despesas: formatBRL(totDesp),
      saldo: formatBRL(totRec - totDesp),
      maiorGrupo: grupo ? { nome: grupo.nome, valor: formatBRL(grupo.valor) } : null,
    }),
  };
}

async function handleResumoMes(userId: string): Promise<ConsultaResult> {
  const hoje = todayLocalISO();
  const from = monthStartISO(hoje);
  // WA-G2.1: janela mensal "até hoje" — não inclui lançamentos futuros
  // (ex.: receitas recorrentes do mesmo mês ainda não recebidas).
  const to = addDaysISO(hoje, 1);
  const [gastos, receitas] = await Promise.all([
    loadGastos(userId, from, to),
    loadReceitas(userId, from, to),
  ]);
  const totDesp = sumValor(gastos);
  const totRec = sumValor(receitas);
  const percentual = totRec > 0 ? Math.round((totDesp / totRec) * 100) : null;
  return {
    status: "consulta",
    resposta: M.consulta.resumoMes({
      mes: mesPorExtenso(hoje),
      receitas: formatBRL(totRec),
      despesas: formatBRL(totDesp),
      saldo: formatBRL(totRec - totDesp),
      percentual,
    }),
  };
}

async function handleMaioresGastos(
  userId: string,
  escopo: "semana" | "mes",
): Promise<ConsultaResult> {
  const hoje = todayLocalISO();
  const from = escopo === "semana" ? addDaysISO(hoje, -6) : monthStartISO(hoje);
  // WA-G3: maiores gastos do mês também ignora despesas futuras (até hoje, inclusive).
  const to = addDaysISO(hoje, 1);

  const gastos = await loadGastos(userId, from, to);
  const ordenados = [...gastos]
    .map((g) => ({ descricao: (g.descricao ?? "").trim() || "Gasto", valor: Number(g.valor ?? 0) || 0 }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 3);
  return {
    status: "consulta",
    resposta: M.consulta.maioresGastos({
      escopo,
      itens: ordenados.map((g) => ({ descricao: g.descricao, valor: formatBRL(g.valor) })),
      total: formatBRL(ordenados.reduce((acc, g) => acc + g.valor, 0)),
    }),
  };
}

async function handleImpacto(userId: string): Promise<ConsultaResult> {
  const hoje = todayLocalISO();
  const from = monthStartISO(hoje);
  // WA-G2.1: janela mensal "até hoje" — exclui receitas/despesas futuras.
  const to = addDaysISO(hoje, 1);
  const [gastos, receitas] = await Promise.all([
    loadGastos(userId, from, to),
    loadReceitas(userId, from, to),
  ]);
  const totDesp = sumValor(gastos);
  const totRec = sumValor(receitas);
  if (totRec <= 0) {
    return { status: "consulta", resposta: M.consulta.impactoSemReceita() };
  }
  const percentual = Math.round((totDesp / totRec) * 100);
  return {
    status: "consulta",
    resposta: M.consulta.impactoComReceita({
      receitas: formatBRL(totRec),
      despesas: formatBRL(totDesp),
      saldo: formatBRL(totRec - totDesp),
      percentual,
    }),
  };
}

type ReceitaListRow = {
  descricao: string | null;
  tipo: string | null;
  valor: number | string | null;
  data: string;
};

async function loadReceitasDetalhadas(
  userId: string,
  from: string,
  toExclusive: string,
): Promise<ReceitaListRow[]> {
  const { data } = await supabaseAdmin
    .from("receitas")
    .select("descricao, tipo, valor, data")
    .eq("user_id", userId)
    .gte("data", from)
    .lt("data", toExclusive)
    .order("data", { ascending: false });
  return Array.isArray(data) ? (data as ReceitaListRow[]) : [];
}

const TIPO_RECEITA_LABELS: Record<string, string> = {
  salario: "Salário",
  freelance: "Freelance",
  comissao: "Comissão",
  venda: "Venda",
  reembolso: "Reembolso",
  pix: "Pix recebido",
  bonus: "Bônus",
  outros: "Outros",
};

function formatDataBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

async function handleListarReceitasMes(userId: string): Promise<ConsultaResult> {
  const hoje = todayLocalISO();
  const from = monthStartISO(hoje);
  const to = addDaysISO(hoje, 1);
  const receitas = await loadReceitasDetalhadas(userId, from, to);
  const total = sumValor(receitas);
  const itens = receitas.slice(0, 10).map((r) => ({
    descricao: (r.descricao ?? "").trim() || (TIPO_RECEITA_LABELS[String(r.tipo ?? "").toLowerCase()] ?? "Receita"),
    tipo: TIPO_RECEITA_LABELS[String(r.tipo ?? "").toLowerCase()] ?? "Outros",
    valor: formatBRL(Number(r.valor ?? 0) || 0),
    data: formatDataBR(r.data),
  }));
  return {
    status: "consulta",
    resposta: M.consulta.listarReceitasMes({
      mes: mesPorExtenso(hoje),
      itens,
      total: formatBRL(total),
      totalRegistros: receitas.length,
    }),
  };
}

export async function handleConsulta(
  userId: string,
  intent: ConsultaIntent,
): Promise<ConsultaResult> {
  switch (intent) {
    case "ajuda_whatsapp":
      return { status: "consulta", resposta: M.consulta.ajuda() };
    case "resumo_semana":
      return await handleResumoSemana(userId);
    case "resumo_mes":
      return await handleResumoMes(userId);
    case "maiores_gastos_semana":
      return await handleMaioresGastos(userId, "semana");
    case "maiores_gastos_mes":
      return await handleMaioresGastos(userId, "mes");
    case "impacto_despesas_renda":
      return await handleImpacto(userId);
    case "listar_receitas_mes":
      return await handleListarReceitasMes(userId);
    case "listar_gastos_mes":
      return await handleListarGastosMes(userId);
    case "gastos_por_categoria_mes":
      return await handleGastosPorCategoriaMes(userId);
    case "orcamento_mes":
      return await handleOrcamentoMes(userId);
    case "listar_recorrencias":
      return await handleListarRecorrencias(userId);
    case "listar_contas_receber":
      return await handleListarContasReceber(userId);
  }
}

// ---------- WA-Q-ContasReceber — listagem read-only de contas a receber ----------
// Estritamente somente leitura. Filtra por status='pendente' | 'parcial'
// (exclui 'recebido' e 'cancelado'). Classifica como "atrasada" quando a
// data_prevista já passou. Ordena por data_prevista ASC. Zero escrita.
type ContaReceberRow = {
  id: string;
  titulo: string | null;
  pagador_nome: string | null;
  valor_total: number | string | null;
  valor_restante: number | string | null;
  data_prevista: string | null;
  status: string | null;
};

async function handleListarContasReceber(userId: string): Promise<ConsultaResult> {
  const { data: raw } = await supabaseAdmin
    .from("contas_a_receber")
    .select("id, titulo, pagador_nome, valor_total, valor_restante, data_prevista, status")
    .eq("user_id", userId)
    .in("status", ["pendente", "parcial"]);
  const rows = (Array.isArray(raw) ? raw : []) as ContaReceberRow[];

  if (rows.length === 0) {
    return {
      status: "consulta",
      resposta:
        "Você não tem contas a receber pendentes no momento. ✅\n\n" +
        "Para cadastrar um valor a receber, acesse:\n" +
        "https://gastointeligente.com.br → Contas a receber",
    };
  }

  rows.sort((a, b) => {
    const av = a.data_prevista ?? "9999-99-99";
    const bv = b.data_prevista ?? "9999-99-99";
    return av < bv ? -1 : av > bv ? 1 : 0;
  });

  const hoje = todayLocalISO();
  const linhas: string[] = [];
  linhas.push(`Suas contas a receber pendentes 💰 (${rows.length})`);
  linhas.push("");
  let total = 0;
  for (const r of rows) {
    const nome = (r.titulo ?? "").trim() || "Recebimento";
    const pagador = (r.pagador_nome ?? "").trim();
    const restante = Number(r.valor_restante ?? r.valor_total ?? 0) || 0;
    total += restante;
    const prevista = r.data_prevista ?? "";
    const atrasada = prevista && prevista < hoje;
    const suffix = atrasada ? " ⚠️ atrasada" : "";
    const de = pagador ? ` (de ${pagador})` : "";
    const quando = prevista ? formatDataBR(prevista) : "-";
    linhas.push(`• ${nome}${de} — ${formatBRL(restante)} · previsto: ${quando}${suffix}`);
  }
  linhas.push("");
  linhas.push(`Total pendente: ${formatBRL(total)}`);
  linhas.push("");
  linhas.push("Para dar baixa ou editar: https://gastointeligente.com.br → Contas a receber");

  return { status: "consulta", resposta: linhas.join("\n") };
}

// ---------- WA-Q-Recorrencias — listagem read-only de recorrências ativas ----------
// Estritamente somente leitura. Não cria/atualiza recorrência, receita,
// gasto, sessão ou conta a pagar. Classifica cada recorrência ativa em
// "receita" (quando existe pelo menos uma linha em public.receitas com
// recorrencia_id = r.id) ou "despesa" (caso contrário).
type RecorrenciaRow = {
  id: string;
  nome: string | null;
  valor: number | string | null;
  frequencia: string | null;
  proxima_cobranca: string | null;
  forma_pagamento: string | null;
  categoria_id: string | null;
};

async function handleListarRecorrencias(userId: string): Promise<ConsultaResult> {
  const { data: recosRaw } = await supabaseAdmin
    .from("recorrencias")
    .select("id, nome, valor, frequencia, proxima_cobranca, forma_pagamento, categoria_id")
    .eq("user_id", userId)
    .eq("status", "ativa");
  const recos = (Array.isArray(recosRaw) ? recosRaw : []) as RecorrenciaRow[];

  if (recos.length === 0) {
    return {
      status: "consulta",
      resposta:
        "Você ainda não tem recorrências ativas cadastradas.\n\n" +
        "Para cadastrar uma assinatura, salário ou conta fixa, é só me mandar aqui — " +
        "ex.: \"receita recorrente salário 3500 dia 5\" ou \"despesa recorrente Spotify 23,90 dia 3\".",
    };
  }

  // Classifica: se há receita com recorrencia_id = r.id → receita; senão → despesa.
  const { data: recRaw } = await supabaseAdmin
    .from("receitas")
    .select("recorrencia_id")
    .eq("user_id", userId);
  const receitaLinks = new Set<string>();
  for (const r of (Array.isArray(recRaw) ? recRaw : []) as Array<{ recorrencia_id: string | null }>) {
    if (r?.recorrencia_id) receitaLinks.add(r.recorrencia_id);
  }

  const catMap = await loadCategoriasMap(userId);

  const fmtFreq = (f: string | null): string => {
    const v = (f ?? "").toLowerCase();
    if (v === "mensal") return "mensal";
    if (v === "semanal") return "semanal";
    if (v === "quinzenal") return "quinzenal";
    if (v === "anual") return "anual";
    return v || "-";
  };

  const fmtLinha = (r: RecorrenciaRow): string => {
    const nome = (r.nome ?? "").trim() || "Recorrência";
    const valor = formatBRL(Number(r.valor ?? 0) || 0);
    const freq = fmtFreq(r.frequencia);
    const prox = r.proxima_cobranca ? formatDataBR(r.proxima_cobranca) : "-";
    const cat = r.categoria_id ? (catMap.get(r.categoria_id) || null) : null;
    const catSuffix = cat ? ` · ${cat}` : "";
    return `• ${nome} — ${valor} (${freq}) · próx.: ${prox}${catSuffix}`;
  };

  const sortByProx = (a: RecorrenciaRow, b: RecorrenciaRow) => {
    const av = a.proxima_cobranca ?? "9999-99-99";
    const bv = b.proxima_cobranca ?? "9999-99-99";
    return av < bv ? -1 : av > bv ? 1 : 0;
  };

  const receitas = recos.filter((r) => receitaLinks.has(r.id)).sort(sortByProx);
  const despesas = recos.filter((r) => !receitaLinks.has(r.id)).sort(sortByProx);

  const linhas: string[] = [];
  linhas.push(`Suas recorrências ativas 🔁 (${recos.length})`);
  if (receitas.length) {
    linhas.push("");
    linhas.push(`Receitas recorrentes (${receitas.length}):`);
    for (const r of receitas) linhas.push(fmtLinha(r));
  }
  if (despesas.length) {
    linhas.push("");
    linhas.push(`Despesas recorrentes (${despesas.length}):`);
    for (const r of despesas) linhas.push(fmtLinha(r));
  }
  linhas.push("");
  linhas.push("Para editar ou cancelar: https://gastointeligente.com.br → Recorrências");

  return { status: "consulta", resposta: linhas.join("\n") };
}

// ---------- WA-Q-Orcamento — leitura de limites/orçamento do mês ----------
// Estritamente somente leitura. Não cria/atualiza gasto, receita,
// recorrência, sessão ou limite. Quando não há limites cadastrados no
// mês vigente, responde amigável e orienta a configurar no site.
type LimiteRow = {
  tipo: string | null;
  valor: number | string | null;
  mes: number | null;
  ano: number | null;
};

async function loadLimitesDoMes(
  userId: string,
  mes: number,
  ano: number,
): Promise<LimiteRow[]> {
  const { data } = await supabaseAdmin
    .from("limites")
    .select("tipo, valor, mes, ano")
    .eq("user_id", userId)
    .eq("mes", mes)
    .eq("ano", ano);
  return Array.isArray(data) ? (data as LimiteRow[]) : [];
}

async function handleOrcamentoMes(userId: string): Promise<ConsultaResult> {
  const hoje = todayLocalISO();
  const [y, m] = hoje.split("-").map(Number);
  const from = monthStartISO(hoje);
  const to = addDaysISO(hoje, 1);
  const [limites, gastos, catMap] = await Promise.all([
    loadLimitesDoMes(userId, m, y),
    loadGastos(userId, from, to),
    loadCategoriasMap(userId),
  ]);

  if (!limites.length) {
    return {
      status: "consulta",
      resposta:
        `Você ainda não tem limites de orçamento cadastrados para ${mesPorExtenso(hoje)}.\n\n` +
        `Para definir um limite total ou por categoria, acesse:\n` +
        `https://gastointeligente.com.br → Limites\n\n` +
        `Depois é só me perguntar "meu orçamento" que eu te mostro como está o mês.`,
    };
  }

  // Índices de gasto: total do mês e por nome de categoria (lowercased).
  const totalGastoMes = sumValor(gastos);
  const gastoPorCat = new Map<string, number>();
  for (const g of gastos) {
    const nome = g.categoria_id
      ? (catMap.get(g.categoria_id) || "Outros")
      : "Outros";
    const key = nome.trim().toLowerCase();
    gastoPorCat.set(key, (gastoPorCat.get(key) ?? 0) + (Number(g.valor ?? 0) || 0));
  }

  const linhas: string[] = [];
  linhas.push(`Seu orçamento de ${mesPorExtenso(hoje)} 📊`);
  linhas.push("");

  // Total primeiro, se houver.
  const totalRow = limites.find(
    (l) => (l.tipo ?? "").trim().toLowerCase() === "total",
  );
  if (totalRow) {
    const orc = Number(totalRow.valor ?? 0) || 0;
    const restante = orc - totalGastoMes;
    linhas.push(`• Total: ${formatBRL(totalGastoMes)} de ${formatBRL(orc)}`);
    linhas.push(
      restante >= 0
        ? `  Ainda pode gastar ${formatBRL(restante)}.`
        : `  Ultrapassou em ${formatBRL(-restante)}.`,
    );
    linhas.push("");
  }

  // Depois cada categoria (exclui "total" e a chave "meta_gasto_mensal"
  // que é do app antigo).
  const categoriasCadastradas = limites.filter((l) => {
    const t = (l.tipo ?? "").trim().toLowerCase();
    return t && t !== "total" && t !== "meta_gasto_mensal";
  });
  for (const l of categoriasCadastradas) {
    const nome = (l.tipo ?? "").trim();
    const orc = Number(l.valor ?? 0) || 0;
    const gasto = gastoPorCat.get(nome.toLowerCase()) ?? 0;
    const restante = orc - gasto;
    linhas.push(
      `• ${nome.charAt(0).toUpperCase() + nome.slice(1)}: ${formatBRL(gasto)} de ${formatBRL(orc)}`,
    );
    linhas.push(
      restante >= 0
        ? `  Restam ${formatBRL(restante)}.`
        : `  Ultrapassou em ${formatBRL(-restante)}.`,
    );
  }

  if (linhas[linhas.length - 1] !== "") linhas.push("");
  linhas.push("Para ajustar seus limites: https://gastointeligente.com.br → Limites");

  return { status: "consulta", resposta: linhas.join("\n") };
}


async function handleListarGastosMes(userId: string): Promise<ConsultaResult> {
  const hoje = todayLocalISO();
  const from = monthStartISO(hoje);
  const to = addDaysISO(hoje, 1);
  const [gastos, catMap] = await Promise.all([
    loadGastos(userId, from, to),
    loadCategoriasMap(userId),
  ]);
  const ordenados = [...gastos].sort((a, b) => (a.data < b.data ? 1 : -1));
  const total = sumValor(ordenados);
  const itens = ordenados.slice(0, 10).map((g) => ({
    descricao: (g.descricao ?? "").trim() || "Gasto",
    categoria: g.categoria_id ? (catMap.get(g.categoria_id) || "Outros") : "Outros",
    valor: formatBRL(Number(g.valor ?? 0) || 0),
    data: formatDataBR(g.data),
  }));
  return {
    status: "consulta",
    resposta: M.consulta.listarGastosMes({
      mes: mesPorExtenso(hoje),
      itens,
      total: formatBRL(total),
      totalRegistros: ordenados.length,
    }),
  };
}

async function handleGastosPorCategoriaMes(userId: string): Promise<ConsultaResult> {
  const hoje = todayLocalISO();
  const from = monthStartISO(hoje);
  const to = addDaysISO(hoje, 1);
  const [gastos, catMap] = await Promise.all([
    loadGastos(userId, from, to),
    loadCategoriasMap(userId),
  ]);
  const totals = new Map<string, { nome: string; valor: number; quantidade: number }>();
  for (const g of gastos) {
    const key = g.categoria_id ?? "__sem__";
    const nome = key === "__sem__" ? "Outros" : (catMap.get(key) || "Outros");
    const cur = totals.get(key) ?? { nome, valor: 0, quantidade: 0 };
    cur.valor += Number(g.valor ?? 0) || 0;
    cur.quantidade += 1;
    totals.set(key, cur);
  }
  const itens = [...totals.values()]
    .sort((a, b) => b.valor - a.valor)
    .map((c) => ({
      categoria: c.nome,
      valor: formatBRL(c.valor),
      quantidade: c.quantidade,
    }));
  const total = sumValor(gastos);
  return {
    status: "consulta",
    resposta: M.consulta.gastosPorCategoriaMes({
      mes: mesPorExtenso(hoje),
      itens,
      total: formatBRL(total),
      totalRegistros: gastos.length,
    }),
  };
}

// =====================================================================
// WA-G3 — Intenções conversacionais (saudação, menu, finanças genérico).
// Não acessam banco. Não criam sessão. Não retornam dados financeiros.
// =====================================================================

export type ConversationalIntent =
  | "saudacao_whatsapp"
  | "menu_whatsapp"
  | "ajuda_whatsapp"
  | "comandos_whatsapp"
  | "financas_generico"
  | "cancelar_sem_sessao";

const SAUDACOES = new Set<string>([
  "oi", "ola", "ei", "e ai", "eai",
  "bom dia", "boa tarde", "boa noite",
  "hey", "hello", "alo",
]);

// WA-C6 (corrigido): "menu" é a lista numerada; "ajuda" e "comandos"
// foram separados em intents próprios para devolver respostas distintas.
const MENU_EXATOS = new Set<string>([
  "menu", "opcoes", "opcao",
  "gi", "oi gi", "ola gi", "ei gi", "bom dia gi", "boa tarde gi", "boa noite gi",
  "gasto inteligente", "oi gasto inteligente", "ola gasto inteligente",
]);

const AJUDA_EXATOS = new Set<string>([
  "ajuda", "ajudar", "help", "me ajuda", "exemplos", "exemplo", "como usar",
]);

const COMANDOS_EXATOS = new Set<string>([
  "comandos", "comando", "lista de comandos", "quais comandos",
  "atalhos", "atalho",
]);

const CANCELAR_EXATOS = new Set<string>([
  "cancelar", "cancela", "cancelado", "cancelada",
]);

/**
 * Detecta intenção conversacional. Roda apenas quando NÃO há sessão pendente.
 * Tem precedência sobre `detectConsultaIntent` para palavras-chave compartilhadas
 * (ex.: "menu", "ajuda", "como estão minhas finanças").
 */
export function detectConversationalIntent(texto: string): ConversationalIntent | null {
  const t = norm(texto);
  if (!t) return null;

  if (CANCELAR_EXATOS.has(t)) return "cancelar_sem_sessao";

  if (COMANDOS_EXATOS.has(t)) return "comandos_whatsapp";
  if (AJUDA_EXATOS.has(t)) return "ajuda_whatsapp";
  if (MENU_EXATOS.has(t)) return "menu_whatsapp";
  if (
    /\bo que voce (faz|consegue fazer|pode fazer)\b/.test(t) ||
    /\bcomo voce (pode|consegue) (me )?ajudar\b/.test(t) ||
    /\bquais (sao )?(os )?seus comandos\b/.test(t) ||
    /\bquais (sao )?(as )?op[cç]oes\b/.test(t)
  ) {
    return "menu_whatsapp";
  }

  if (
    /\bquero (ver|saber) (as )?minhas finan[cç]as\b/.test(t) ||
    /\bcomo est(a|ao) (as )?minhas finan[cç]as\b/.test(t) ||
    /\bme ajuda com (as )?minhas finan[cç]as\b/.test(t)
  ) {
    return "financas_generico";
  }

  if (SAUDACOES.has(t)) return "saudacao_whatsapp";

  return null;
}

// Cache anti-repetição em memória (best-effort, 5 min). Chave = telefone.
// Não armazena conteúdo da mensagem do usuário — apenas qual intenção
// acabamos de responder, para evitar repetir o menu inteiro logo em seguida.
const RECENT_TTL_MS = 5 * 60 * 1000;
const recentIntent = new Map<string, { intent: ConversationalIntent; at: number }>();

export function _resetConversationalCache(): void {
  recentIntent.clear();
}

function getRecentIntent(telefone: string): ConversationalIntent | null {
  const e = recentIntent.get(telefone);
  if (!e) return null;
  if (Date.now() - e.at > RECENT_TTL_MS) {
    recentIntent.delete(telefone);
    return null;
  }
  return e.intent;
}

function markRecentIntent(telefone: string, intent: ConversationalIntent): void {
  recentIntent.set(telefone, { intent, at: Date.now() });
}

export function handleConversational(
  telefone: string,
  intent: ConversationalIntent,
): { status: "consulta"; resposta: string } {
  let resposta: string;
  if (intent === "saudacao_whatsapp") {
    const recente = getRecentIntent(telefone);
    resposta = recente === "saudacao_whatsapp" || recente === "menu_whatsapp"
      ? M.consulta.menuCurto()
      : M.consulta.saudacao();
  } else if (intent === "menu_whatsapp") {
    const recente = getRecentIntent(telefone);
    resposta = recente === "menu_whatsapp"
      ? M.consulta.menuCurto()
      : M.consulta.ajuda();
  } else if (intent === "ajuda_whatsapp") {
    resposta = M.consulta.ajudaExemplos();
  } else if (intent === "comandos_whatsapp") {
    resposta = M.consulta.comandosLista();
  } else if (intent === "financas_generico") {
    resposta = M.consulta.financasGenerico();
  } else {
    // cancelar_sem_sessao
    resposta = M.consulta.cancelarSemPendencia();
  }
  markRecentIntent(telefone, intent);
  return { status: "consulta", resposta };
}

// =====================================================================
// WA-C6 — Menu numerado guiado.
//
// Quando o usuário responde apenas com um dígito 1..8 (após receber o
// menu) reescrevemos para uma frase canônica que os handlers existentes
// já entendem. Não cria handlers novos, apenas roteia.
// =====================================================================

const MENU_OPCAO_RE = /^\s*([1-8])\s*[.)\-:º°]?\s*$/;

/** Retorna o índice 1..8 quando o texto é apenas um número de menu. */
export function detectMenuOption(texto: string): number | null {
  const m = (texto ?? "").match(MENU_OPCAO_RE);
  return m ? Number(m[1]) : null;
}

/**
 * Para cada opção do menu retorna a frase canônica (em PT-BR) que será
 * injetada no roteador como se o usuário a tivesse digitado. Quando a
 * opção exige uma orientação textual (registrar gasto, editar conta),
 * devolvemos `{ guidance }` com o texto a responder ao usuário.
 */
export type MenuDispatch =
  | { kind: "rewrite"; texto: string }
  | { kind: "guidance"; resposta: string };

export function dispatchMenuOption(opcao: number): MenuDispatch | null {
  switch (opcao) {
    case 1:
      return {
        kind: "guidance",
        resposta:
          "Para registrar um gasto, me envie em uma única mensagem.\n\n" +
          "Exemplos:\n" +
          "• “Uber 29,90 hoje no pix”\n" +
          "• “Mercado 148 ontem no cartão Nubank”\n" +
          "• “Almoço 35 débito”",
      };
    case 2:
      return {
        kind: "guidance",
        resposta:
          "Para cadastrar uma conta a pagar, me envie nome, valor e vencimento.\n\n" +
          "Exemplos:\n" +
          "• “Cadastrar internet 119,90 vence dia 5 todo mês”\n" +
          "• “Nova conta aluguel 1500 vence 10/07”",
      };
    case 3:
      return { kind: "rewrite", texto: "minhas contas" };
    case 4:
      return { kind: "rewrite", texto: "contas atrasadas" };
    case 5:
      return {
        kind: "guidance",
        resposta:
          "Para marcar uma conta como paga, diga o nome dela.\n\n" +
          "Exemplos:\n" +
          "• “Paguei a internet”\n" +
          "• “Quitei o aluguel ontem”\n" +
          "Se você acabou de ver uma lista, também posso entender “paguei a segunda”.",
      };
    case 6:
      return {
        kind: "guidance",
        resposta:
          "Para editar uma conta, diga o nome dela.\n\n" +
          "Exemplos:\n" +
          "• “Editar internet”\n" +
          "• “Alterar aluguel”\n" +
          "Depois eu pergunto o que você quer mudar.",
      };
    case 7:
      return {
        kind: "guidance",
        resposta:
          "Para cancelar uma conta, diga o nome dela.\n\n" +
          "Exemplos:\n" +
          "• “Cancelar internet”\n" +
          "• “Excluir academia”\n" +
          "Eu confirmo antes de remover.",
      };
    case 8:
      return { kind: "rewrite", texto: "ajuda" };
    default:
      return null;
  }
}
