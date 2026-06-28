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
  | "listar_gastos_mes";

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
  if (
    /\bresumo (do )?m[eê]s\b/.test(t) ||
    /\bcomo foi (o )?meu m[eê]s\b/.test(t) ||
    /\bquanto (eu )?gastei (no )?m[eê]s\b/.test(t) ||
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

  // ----- listar gastos/despesas do mês (precede parser de cartão/fatura) -----
  // Cobre variações comuns. Evita roteamento incorreto para faturas, onde
  // "gastos do mês" era interpretado como "compras do <cartão mês>".
  if (
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
  }
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
