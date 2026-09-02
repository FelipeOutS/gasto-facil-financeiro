/**
 * IA Financeira — agregação real do mês + resumo por IA.
 *
 * Server-only. Todas as leituras usam o client autenticado do usuário
 * (RLS aplicada), nunca service role. O resumo textual usa o mesmo
 * Lovable AI Gateway já usado pelo OCR de comprovantes.
 */

export type ForecastStatus = "positivo" | "negativo" | "atencao" | "neutro";

export type MonthAggregate = {
  mes: number;
  ano: number;
  hoje: string;
  temDados: boolean;
  entradasConfirmadas: number;
  entradasPrevistas: number;
  saidasConfirmadas: number;
  saidasPendentes: number;
  resultadoAtual: number;
  resultadoPrevisto: number;
  status: ForecastStatus;
  impactos: Array<{ nome: string; valor: number; detalhe?: string }>;
  receitas: Array<{ nome: string; valor: number; detalhe?: string }>;
  faturasDetalhe: Array<{
    cartao: string;
    total: number;
    pago: number;
    pendente: number;
    nome?: string;
    detalhe?: string;
    valor?: number;
  }>;
  topCategorias: Array<{ nome: string; valor: number }>;
};

type AnyClient = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Janela [inicio, fimExclusivo) do mês em datas ISO (YYYY-MM-DD). */
export function janelaMes(mes: number, ano: number): { from: string; toExclusive: string } {
  const m = mes >= 1 && mes <= 12 ? mes : 1;
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? ano + 1 : ano;
  return {
    from: `${ano}-${pad(m)}-01`,
    toExclusive: `${nextYear}-${pad(nextMonth)}-01`,
  };
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Data de hoje em America/Sao_Paulo (YYYY-MM-DD). */
export function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function resolveMesAno(mes?: number, ano?: number): { mes: number; ano: number } {
  const hoje = hojeSaoPaulo();
  const y = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  return {
    mes: mes && mes >= 1 && mes <= 12 ? mes : m,
    ano: ano && ano >= 2000 && ano <= 2100 ? ano : y,
  };
}

/**
 * Agrega o mês do usuário a partir de dados reais:
 * gastos, receitas, contas a pagar e contas a receber.
 */
export async function agregarMes(
  supabase: AnyClient,
  mesIn?: number,
  anoIn?: number,
): Promise<MonthAggregate> {
  const { mes, ano } = resolveMesAno(mesIn, anoIn);
  const { from, toExclusive } = janelaMes(mes, ano);

  const [gastosRes, receitasRes, contasPagarRes, contasReceberRes, cartoesRes, categoriasRes] =
    await Promise.all([
      supabase
        .from("gastos")
        .select("descricao, estabelecimento, valor, data, confirmado, cartao_id, categoria_id")
        .gte("data", from)
        .lt("data", toExclusive),
      supabase
        .from("receitas")
        .select("descricao, valor, data")
        .is("deleted_at", null)
        .gte("data", from)
        .lt("data", toExclusive),
      supabase
        .from("contas_a_pagar")
        .select("nome, valor, status, data_vencimento")
        .gte("data_vencimento", from)
        .lt("data_vencimento", toExclusive),
      supabase
        .from("contas_a_receber")
        .select("titulo, valor_total, valor_restante, status, data_prevista")
        .gte("data_prevista", from)
        .lt("data_prevista", toExclusive),
      supabase.from("cartoes").select("id, nome, banco"),
      supabase.from("categorias").select("id, nome"),
    ]);

  const gastos = (gastosRes?.data ?? []) as Array<Record<string, unknown>>;
  const receitas = (receitasRes?.data ?? []) as Array<Record<string, unknown>>;
  const contasPagar = (contasPagarRes?.data ?? []) as Array<Record<string, unknown>>;
  const contasReceber = (contasReceberRes?.data ?? []) as Array<Record<string, unknown>>;
  const cartoes = (cartoesRes?.data ?? []) as Array<Record<string, unknown>>;
  const categorias = (categoriasRes?.data ?? []) as Array<Record<string, unknown>>;

  const cartaoNome = new Map<string, string>();
  for (const c of cartoes) {
    const id = String(c["id"] ?? "");
    if (id)
      cartaoNome.set(
        id,
        String(c["nome"] ?? "").trim() || String(c["banco"] ?? "").trim() || "Cartão",
      );
  }
  const catNome = new Map<string, string>();
  for (const c of categorias) {
    const id = String(c["id"] ?? "");
    if (id) catNome.set(id, String(c["nome"] ?? "").trim() || "Sem categoria");
  }

  let saidasConfirmadas = 0;
  let saidasPendentes = 0;
  const porCategoria = new Map<string, number>();
  const faturas = new Map<string, { total: number; pago: number; pendente: number }>();
  const impactos: Array<{ nome: string; valor: number; detalhe?: string }> = [];

  for (const g of gastos) {
    const valor = num(g["valor"]);
    const confirmado = g["confirmado"] !== false;
    if (confirmado) saidasConfirmadas += valor;
    else saidasPendentes += valor;

    const catId = g["categoria_id"] ? String(g["categoria_id"]) : "";
    const catLabel = catNome.get(catId) ?? "Sem categoria";
    porCategoria.set(catLabel, (porCategoria.get(catLabel) ?? 0) + valor);

    const cartaoId = g["cartao_id"] ? String(g["cartao_id"]) : "";
    if (cartaoId) {
      const label = cartaoNome.get(cartaoId) ?? "Cartão";
      const cur = faturas.get(label) ?? { total: 0, pago: 0, pendente: 0 };
      cur.total += valor;
      if (confirmado) cur.pago += valor;
      else cur.pendente += valor;
      faturas.set(label, cur);
    }

    if (!confirmado && valor > 0) {
      const nome =
        String(g["descricao"] ?? "").trim() || String(g["estabelecimento"] ?? "").trim() || "Gasto";
      impactos.push({ nome, valor: round2(valor), detalhe: "Gasto não confirmado" });
    }
  }

  for (const c of contasPagar) {
    const valor = num(c["valor"]);
    const status = String(c["status"] ?? "").toLowerCase();
    const paga = status === "paga" || status === "pago" || status === "pagou";
    if (paga) continue;
    saidasPendentes += valor;
    if (valor > 0) {
      impactos.push({
        nome: String(c["nome"] ?? "").trim() || "Conta a pagar",
        valor: round2(valor),
        detalhe: `Vence ${String(c["data_vencimento"] ?? "").slice(0, 10)}`,
      });
    }
  }

  let entradasConfirmadas = 0;
  const receitasList: Array<{ nome: string; valor: number; detalhe?: string }> = [];
  for (const r of receitas) {
    const valor = num(r["valor"]);
    entradasConfirmadas += valor;
    if (valor > 0) {
      receitasList.push({
        nome: String(r["descricao"] ?? "").trim() || "Receita",
        valor: round2(valor),
        detalhe: "Recebida",
      });
    }
  }

  let entradasPrevistas = 0;
  for (const c of contasReceber) {
    const restante = num(c["valor_restante"]) || Math.max(0, num(c["valor_total"]));
    const status = String(c["status"] ?? "").toLowerCase();
    if (status === "recebido" || status === "recebida" || restante <= 0) continue;
    entradasPrevistas += restante;
    receitasList.push({
      nome: String(c["titulo"] ?? "").trim() || "A receber",
      valor: round2(restante),
      detalhe: `Previsto ${String(c["data_prevista"] ?? "").slice(0, 10)}`,
    });
  }

  const resultadoAtual = round2(entradasConfirmadas - saidasConfirmadas);
  const resultadoPrevisto = round2(
    entradasConfirmadas + entradasPrevistas - saidasConfirmadas - saidasPendentes,
  );

  const temDados =
    gastos.length > 0 || receitas.length > 0 || contasPagar.length > 0 || contasReceber.length > 0;

  let status: ForecastStatus = "neutro";
  if (temDados) {
    if (resultadoPrevisto < 0) status = "negativo";
    else if (resultadoAtual < 0 || resultadoPrevisto < entradasConfirmadas * 0.05)
      status = "atencao";
    else status = "positivo";
  }

  impactos.sort((a, b) => b.valor - a.valor);
  receitasList.sort((a, b) => b.valor - a.valor);

  const topCategorias = [...porCategoria.entries()]
    .map(([nome, valor]) => ({ nome, valor: round2(valor) }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 6);

  return {
    mes,
    ano,
    hoje: hojeSaoPaulo(),
    temDados,
    entradasConfirmadas: round2(entradasConfirmadas),
    entradasPrevistas: round2(entradasPrevistas),
    saidasConfirmadas: round2(saidasConfirmadas),
    saidasPendentes: round2(saidasPendentes),
    resultadoAtual,
    resultadoPrevisto,
    status,
    impactos: impactos.slice(0, 8),
    receitas: receitasList.slice(0, 8),
    faturasDetalhe: [...faturas.entries()].map(([cartao, v]) => ({
      cartao,
      nome: cartao,
      total: round2(v.total),
      pago: round2(v.pago),
      pendente: round2(v.pendente),
      valor: round2(v.total),
    })),
    topCategorias,
  };
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function mesLabel(mes: number, ano: number): string {
  return `${MESES[Math.min(11, Math.max(0, mes - 1))]} de ${ano}`;
}

export type SummaryOutcome =
  | { ok: true; reply: string }
  | { ok: false; error: { message: string } };

/**
 * Resumo inteligente do mês via Lovable AI Gateway (mesmo gateway do OCR).
 * Recebe agregados já calculados — nunca envia dados de outros usuários,
 * nem identificadores internos.
 */
export async function gerarResumoInteligente(
  agg: MonthAggregate,
  lang: "pt" | "en" = "pt",
): Promise<SummaryOutcome> {
  const apiKey = process.env['LOVABLE_API_KEY'];
  if (!apiKey) {
    return { ok: false, error: { message: "IA indisponível: chave não configurada." } };
  }
  if (!agg.temDados) {
    return {
      ok: true,
      reply:
        lang === "en"
          ? "No entries this month yet. Add an expense or income and I'll analyze your month right away."
          : "Ainda não há lançamentos neste mês. Registre um gasto ou receita e eu analiso seu mês na hora.",
    };
  }

  const fmt = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

  const contexto = [
    `Mês de referência: ${mesLabel(agg.mes, agg.ano)} (hoje: ${agg.hoje}).`,
    `Receitas confirmadas: ${fmt(agg.entradasConfirmadas)}.`,
    `Receitas previstas ainda a receber: ${fmt(agg.entradasPrevistas)}.`,
    `Despesas confirmadas: ${fmt(agg.saidasConfirmadas)}.`,
    `Despesas pendentes/previstas: ${fmt(agg.saidasPendentes)}.`,
    `Saldo atual: ${fmt(agg.resultadoAtual)}. Saldo previsto no fim do mês: ${fmt(agg.resultadoPrevisto)}.`,
    agg.topCategorias.length
      ? `Maiores categorias de gasto: ${agg.topCategorias.map((c) => `${c.nome} ${fmt(c.valor)}`).join("; ")}.`
      : "",
    agg.impactos.length
      ? `Maiores compromissos pendentes: ${agg.impactos
          .slice(0, 5)
          .map((i) => `${i.nome} ${fmt(i.valor)}`)
          .join("; ")}.`
      : "",
    agg.faturasDetalhe.length
      ? `Cartões: ${agg.faturasDetalhe
          .map((f) => `${f.cartao} total ${fmt(f.total)} (pendente ${fmt(f.pendente)})`)
          .join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system =
    lang === "en"
      ? `You are a Brazilian personal finance assistant. Use ONLY the provided numbers — never invent values. Reply in English, in markdown, max 120 words: one short sentence on the month's situation, then 2-3 bullets with concrete, actionable observations, then one closing suggestion. No greetings, no disclaimers.`
      : `Você é um assistente de finanças pessoais brasileiro. Use APENAS os números fornecidos — nunca invente valores. Responda em português do Brasil, em markdown, no máximo 120 palavras: uma frase curta sobre a situação do mês, depois 2 a 3 bullets com observações concretas e acionáveis, e uma sugestão final. Sem saudações e sem avisos genéricos.`;

  let resp: Response;
  try {
    resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: contexto },
        ],
      }),
    });
  } catch (err) {
    console.error("[finance-ai] gateway fetch error", err);
    return { ok: false, error: { message: "Não consegui gerar o resumo agora." } };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error("[finance-ai] gateway error", resp.status, text);
    if (resp.status === 429) {
      return {
        ok: false,
        error: { message: "Muitas análises seguidas. Tente novamente em alguns segundos." },
      };
    }
    if (resp.status === 402) {
      return { ok: false, error: { message: "Sem créditos de IA disponíveis no momento." } };
    }
    return { ok: false, error: { message: "Não consegui gerar o resumo agora." } };
  }

  const json = (await resp.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const reply = json?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    return { ok: false, error: { message: "A IA não retornou um resumo válido." } };
  }
  return { ok: true, reply };
}
