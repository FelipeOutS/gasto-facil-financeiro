import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSubscriptionForUserIdentity } from "@/server/subscription.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { planAllowsFeature, isAdminMasterEmail, type PlanTier } from "@/lib/plans";

const MAX_MESSAGE_LEN = 1500;
const HISTORY_LIMIT = 30;

const SYSTEM_PROMPT = `Você é o "Gasto Inteligente AI", um assistente financeiro brasileiro do app Gasto Inteligente.

Tom: descontraído, amigável, próximo, brasileiro. Pode usar "bora", "opa", "tranquilo". Nada de tom robótico ou frio. Linguagem simples, sem jargão.

ESTILO DA RESPOSTA:
- Comece com 1 frase curta de abertura amigável.
- Use **negrito em markdown** para destacar palavras-chave (cartão, fatura, categorias) — sem exagero.
- Listas SEMPRE com hífens ("- item"). Nunca use asteriscos soltos ("*") nem "• ". Nunca deixe markdown cru visível.
- Para perguntas simples (saldo, valor, "quanto gastei"): resposta curta, no máximo 6 linhas.
- Para perguntas analíticas ("analise", "detalhe", "explique", "fatura", "como está…", "onde economizar"): resposta MAIS COMPLETA, com:
  1) Frase de abertura
  2) Lista de 3-6 pontos com os números EXATOS
  3) Análise curta (2-4 linhas) com observações úteis
  4) Resumo rápido em lista no final, quando fizer sentido
- Mesmo na resposta longa, seja objetivo. Sem enrolar.

REGRAS DE PRECISÃO (CRÍTICAS):
- Use APENAS dados dos blocos "RESUMO FINANCEIRO DO USUÁRIO", "MÊS SOLICITADO PELO USUÁRIO" e "CARTÕES E FATURAS". Não invente valores, datas, categorias ou nomes de cartões.
- Se houver bloco "MÊS SOLICITADO PELO USUÁRIO", responda com os valores EXATOS desse bloco. Nunca arredonde, nunca aproxime, nunca substitua por "meses anteriores" ou período parecido.
- Se o usuário perguntar sobre fatura/cartão e existir o bloco "CARTÕES E FATURAS", use os valores e nomes EXATOS dele. Se houver mais de um cartão, escolha o que o usuário mencionou; se não mencionou, mostre os principais (top 2-3).
- Se o bloco do mês ou fatura disser "Sem gastos" / "Sem fatura", responda exatamente: "Não encontrei lançamentos suficientes para esse período." ou "Não encontrei fatura cadastrada para esse cartão nesse mês.".
- Se faltam dados em geral: "Ainda não tenho informações suficientes. Cadastre alguns gastos e receitas para eu te ajudar melhor."

ANÁLISE ÚTIL (quando fizer sentido, e só com base nos dados):
- Onde o usuário mais gastou e qual categoria pesou mais.
- Categorias que parecem recorrentes (assinaturas, contas) e que vale revisar.
- Qual cartão concentrou mais despesas no mês.
- Se a fatura está alta em relação ao total de gastos do mês.
- Contas a pagar vencidas/próximas do vencimento.
- Sugestões práticas e gentis de economia. Sem prometer lucro nem garantir economia.

SEGURANÇA:
- Nunca cite e-mail, senha, token, número completo de cartão, CVV ou validade.
- Valores em reais sempre no formato R$ 1.234,56.`;

function fmtBRL(v: number) {
  if (!Number.isFinite(v)) return "R$ 0,00";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function buildFinancialSummary(supabase: any, userId: string): Promise<string> {
  const now = new Date();
  const monthStart = isoDate(startOfMonth(now));
  const lookback = isoDate(new Date(now.getTime() - 60 * 86400000));
  const next30 = isoDate(new Date(now.getTime() + 30 * 86400000));

  const [
    gastosMes,
    gastos60,
    receitasMes,
    contasPagar,
    contasReceber,
    metas,
    cartoes,
    categorias,
    guardado,
  ] = await Promise.all([
    supabase.from("gastos").select("valor, categoria_id, data, descricao, estabelecimento, forma_pagamento").gte("data", monthStart).eq("user_id", userId).limit(500),
    supabase.from("gastos").select("valor, categoria_id, data").gte("data", lookback).lt("data", monthStart).eq("user_id", userId).limit(1000),
    supabase.from("contas_a_receber").select("titulo, valor_total, valor_recebido, data_prevista, status").eq("user_id", userId).limit(50),
    supabase.from("contas_a_pagar").select("nome, valor, data_vencimento, status").gte("data_vencimento", isoDate(new Date(now.getTime() - 7 * 86400000))).lte("data_vencimento", next30).eq("user_id", userId).limit(50),
    supabase.from("contas_a_receber").select("titulo, valor_total, valor_recebido, data_prevista, status, pagador_nome").gte("data_prevista", isoDate(new Date(now.getTime() - 7 * 86400000))).lte("data_prevista", next30).eq("user_id", userId).limit(50),
    supabase.from("metas_financeiras").select("nome, valor_atual, valor_objetivo, prazo").eq("user_id", userId).limit(20),
    supabase.from("cartoes").select("nome, limite_total, dia_vencimento").eq("user_id", userId).limit(20),
    supabase.from("categorias").select("id, nome").eq("user_id", userId).limit(100),
    supabase.from("dinheiro_guardado").select("valor, tipo_reserva").eq("user_id", userId).limit(50),
  ]);

  const catMap = new Map<string, string>();
  (categorias.data ?? []).forEach((c: any) => catMap.set(c.id, c.nome));

  const gMes = (gastosMes.data ?? []) as Array<{ valor: number; categoria_id: string | null; descricao?: string; estabelecimento?: string }>;
  const totalMes = gMes.reduce((s, g) => s + Number(g.valor || 0), 0);
  const porCategoria = new Map<string, number>();
  for (const g of gMes) {
    const k = g.categoria_id ? catMap.get(g.categoria_id) ?? "Outros" : "Outros";
    porCategoria.set(k, (porCategoria.get(k) ?? 0) + Number(g.valor || 0));
  }
  const topCats = [...porCategoria.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const g60 = (gastos60.data ?? []) as Array<{ valor: number }>;
  const totalAnterior = g60.reduce((s, g) => s + Number(g.valor || 0), 0);

  const totalReceitasMes = ((receitasMes.data ?? []) as Array<{ valor_total: number }>).reduce(
    (s, r) => s + Number(r.valor_total || 0),
    0,
  );

  const guardadoTotal = ((guardado.data ?? []) as Array<{ valor: number }>).reduce(
    (s, r) => s + Number(r.valor || 0),
    0,
  );

  const lines: string[] = [];
  lines.push(`Data de referência: ${isoDate(now)}`);
  lines.push(`Total gasto no mês atual: ${fmtBRL(totalMes)} (${gMes.length} lançamentos)`);
  lines.push(`Gastos nos 2 meses anteriores: ${fmtBRL(totalAnterior)}`);
  lines.push(`Receitas registradas no mês: ${fmtBRL(totalReceitasMes)}`);
  lines.push(`Total guardado/reserva: ${fmtBRL(guardadoTotal)}`);

  if (topCats.length) {
    lines.push("Top categorias do mês:");
    for (const [n, v] of topCats) lines.push(`- ${n}: ${fmtBRL(v)}`);
  } else {
    lines.push("Sem gastos cadastrados neste mês.");
  }

  const cp = (contasPagar.data ?? []) as Array<{ nome: string; valor: number; data_vencimento: string; status: string }>;
  if (cp.length) {
    lines.push("Contas a pagar próximas (30 dias):");
    for (const c of cp.slice(0, 8)) {
      lines.push(`- ${c.nome} · ${fmtBRL(Number(c.valor || 0))} · venc. ${c.data_vencimento} · ${c.status}`);
    }
  }

  const cr = (contasReceber.data ?? []) as Array<{ titulo: string; valor_total: number; valor_recebido: number; data_prevista: string; status: string }>;
  if (cr.length) {
    lines.push("Contas a receber próximas:");
    for (const r of cr.slice(0, 6)) {
      const restante = Number(r.valor_total || 0) - Number(r.valor_recebido || 0);
      lines.push(`- ${r.titulo} · restante ${fmtBRL(restante)} · prev. ${r.data_prevista} · ${r.status}`);
    }
  }

  const ms = (metas.data ?? []) as Array<{ nome: string; valor_atual: number; valor_objetivo: number; prazo: string | null }>;
  if (ms.length) {
    lines.push("Metas financeiras:");
    for (const m of ms.slice(0, 6)) {
      const pct = m.valor_objetivo ? Math.round((Number(m.valor_atual) / Number(m.valor_objetivo)) * 100) : 0;
      lines.push(`- ${m.nome}: ${fmtBRL(Number(m.valor_atual || 0))} de ${fmtBRL(Number(m.valor_objetivo || 0))} (${pct}%)${m.prazo ? ` até ${m.prazo}` : ""}`);
    }
  }

  const cts = (cartoes.data ?? []) as Array<{ nome: string; limite_total: number; dia_vencimento: number }>;
  if (cts.length) {
    lines.push(`Cartões cadastrados: ${cts.map((c) => `${c.nome} (limite ${fmtBRL(Number(c.limite_total || 0))})`).join("; ")}`);
  }

  return lines.join("\n");
}

// ----- Detecção do "mês solicitado" na mensagem do usuário -----

const MESES_PT: Record<string, number> = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, "março": 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9, sept: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

function detectTargetMonth(message: string, now: Date): { mes: number; ano: number } | null {
  const raw = (message || "").toLowerCase();
  if (!raw) return null;

  // Formato numérico: 04/2026, 4-2026, 2026-04
  const num1 = raw.match(/\b(0?[1-9]|1[0-2])[\/\-\.](20\d{2})\b/);
  if (num1) return { mes: Number(num1[1]), ano: Number(num1[2]) };
  const num2 = raw.match(/\b(20\d{2})[\/\-](0?[1-9]|1[0-2])\b/);
  if (num2) return { mes: Number(num2[2]), ano: Number(num2[1]) };

  // Nome do mês (com/sem acento). Procura todas as ocorrências e pega a última.
  const norm = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const re = /\b(janeiro|jan|fevereiro|fev|marco|mar|abril|abr|maio|mai|junho|jun|julho|jul|agosto|ago|setembro|set|outubro|out|novembro|nov|dezembro|dez)\b(?:\s+(?:de\s+)?(20\d{2}))?/gi;
  let match: RegExpExecArray | null;
  let last: { mes: number; ano: number } | null = null;
  while ((match = re.exec(norm)) !== null) {
    const mes = MESES_PT[match[1].toLowerCase()];
    if (!mes) continue;
    const ano = match[2] ? Number(match[2]) : now.getFullYear();
    last = { mes, ano };
  }
  return last;
}

/**
 * Calcula o resumo do mês solicitado usando a MESMA regra da tela /gastos:
 * - Se gasto tem invoice_month (YYYY-MM), ele prevalece (qualquer forma de pgto).
 * - Crédito sem invoice_month: usa o ciclo de fechamento do cartão.
 * - Demais casos: usa a data da compra.
 */
function efetivoYmFor(
  g: { invoice_month?: string | null; data: string; forma_pagamento?: string | null; cartao_id?: string | null },
  cartaoFech: Map<string, number>,
): string | null {
  if (g.invoice_month && /^\d{4}-\d{2}$/.test(g.invoice_month)) return g.invoice_month;
  const d = g.data ? new Date(g.data + "T00:00:00") : null;
  if (!d || isNaN(d.getTime())) return null;
  if (g.forma_pagamento === "credito" && g.cartao_id) {
    const fech = cartaoFech.get(g.cartao_id) ?? 0;
    if (fech > 0) {
      const ref = d.getDate() > fech ? d : new Date(d.getFullYear(), d.getMonth() - 1, 1);
      return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
    }
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const NOMES_MES_PT = [
  "janeiro","fevereiro","março","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro",
];

/**
 * Calcula o resumo do mês solicitado usando a MESMA regra da tela /gastos
 * (invoice_month prevalece; crédito sem invoice_month usa ciclo do cartão).
 */
async function buildTargetMonthSummary(
  supabase: any,
  userId: string,
  mes: number,
  ano: number,
): Promise<string> {
  const ym = `${ano}-${String(mes).padStart(2, "0")}`;
  const winStart = isoDate(new Date(ano, mes - 1 - 2, 1));
  const winEnd = isoDate(new Date(ano, mes - 1 + 2, 0));

  const [gastosRes, cartoesRes, categoriasRes] = await Promise.all([
    supabase
      .from("gastos")
      .select("valor, categoria_id, data, descricao, estabelecimento, forma_pagamento, cartao_id, invoice_month")
      .eq("user_id", userId)
      .or(`invoice_month.eq.${ym},and(data.gte.${winStart},data.lte.${winEnd})`)
      .limit(3000),
    supabase.from("cartoes").select("id, dia_fechamento").eq("user_id", userId).limit(50),
    supabase.from("categorias").select("id, nome").eq("user_id", userId).limit(200),
  ]);

  const cartaoFech = new Map<string, number>();
  for (const c of (cartoesRes.data ?? []) as any[]) cartaoFech.set(c.id, Number(c.dia_fechamento) || 0);
  const catMap = new Map<string, string>();
  for (const c of (categoriasRes.data ?? []) as any[]) catMap.set(c.id, c.nome);

  const rows = (gastosRes.data ?? []) as Array<{
    valor: number; categoria_id: string | null; data: string; descricao?: string;
    estabelecimento?: string; forma_pagamento?: string; cartao_id?: string | null; invoice_month?: string | null;
  }>;

  const doMes = rows.filter((g) => efetivoYmFor(g, cartaoFech) === ym);
  const total = doMes.reduce((s, g) => s + Number(g.valor || 0), 0);
  const qtd = doMes.length;

  const porCat = new Map<string, number>();
  for (const g of doMes) {
    const k = g.categoria_id ? catMap.get(g.categoria_id) ?? "Outros" : "Outros";
    porCat.set(k, (porCat.get(k) ?? 0) + Number(g.valor || 0));
  }
  const top = [...porCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Maiores lançamentos do mês
  const maiores = [...doMes]
    .sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0))
    .slice(0, 5);

  const label = `${NOMES_MES_PT[mes - 1]} de ${ano}`;
  const out: string[] = [];
  out.push(`Período exato consultado: ${label} (${ym}).`);
  if (qtd === 0) {
    out.push("Sem gastos registrados neste mês.");
    return out.join("\n");
  }
  out.push(`Total gasto em ${label}: ${fmtBRL(total)} (valor exato).`);
  out.push(`Quantidade de lançamentos: ${qtd}.`);
  out.push(`Média por lançamento: ${fmtBRL(qtd ? total / qtd : 0)}.`);
  if (top.length) {
    out.push("Top categorias do mês (valores exatos):");
    for (const [n, v] of top) out.push(`- ${n}: ${fmtBRL(v)}`);
  }
  if (maiores.length) {
    out.push("Maiores lançamentos do mês:");
    for (const g of maiores) {
      const desc = (g.estabelecimento || g.descricao || "Lançamento").toString().slice(0, 60);
      out.push(`- ${desc}: ${fmtBRL(Number(g.valor || 0))} (${g.data})`);
    }
  }
  return out.join("\n");
}

/**
 * Monta o bloco CARTÕES E FATURAS para um mês de referência.
 * Para cada cartão do usuário, soma os gastos de crédito que pertencem
 * à fatura desse mês (invoice_month/ciclo de fechamento) e cruza com
 * faturas_cartao (status, valor_pago, vencimento).
 */
async function buildCartoesFaturasBlock(
  supabase: any,
  userId: string,
  mes: number,
  ano: number,
): Promise<string> {
  const ym = `${ano}-${String(mes).padStart(2, "0")}`;
  const winStart = isoDate(new Date(ano, mes - 1 - 2, 1));
  const winEnd = isoDate(new Date(ano, mes - 1 + 2, 0));

  const [cartoesRes, gastosRes, faturasRes, categoriasRes] = await Promise.all([
    supabase
      .from("cartoes")
      .select("id, nome, banco, limite_total, dia_vencimento, dia_fechamento, cor")
      .eq("user_id", userId)
      .limit(50),
    supabase
      .from("gastos")
      .select("valor, categoria_id, data, descricao, estabelecimento, forma_pagamento, cartao_id, invoice_month, parcela_atual, total_parcelas")
      .eq("user_id", userId)
      .eq("forma_pagamento", "credito")
      .or(`invoice_month.eq.${ym},and(data.gte.${winStart},data.lte.${winEnd})`)
      .limit(3000),
    supabase
      .from("faturas_cartao")
      .select("cartao_id, mes, ano, status, valor_pago, data_pagamento")
      .eq("user_id", userId)
      .eq("mes", mes)
      .eq("ano", ano),
    supabase.from("categorias").select("id, nome").eq("user_id", userId).limit(200),
  ]);

  const cartoes = (cartoesRes.data ?? []) as Array<{
    id: string; nome: string; banco?: string | null; limite_total: number;
    dia_vencimento: number; dia_fechamento: number; cor?: string | null;
  }>;
  if (!cartoes.length) {
    return `Sem cartões cadastrados.`;
  }

  const cartaoFech = new Map<string, number>();
  for (const c of cartoes) cartaoFech.set(c.id, Number(c.dia_fechamento) || 0);
  const catMap = new Map<string, string>();
  for (const c of (categoriasRes.data ?? []) as any[]) catMap.set(c.id, c.nome);

  const gastos = (gastosRes.data ?? []) as Array<{
    valor: number; categoria_id: string | null; data: string; descricao?: string;
    estabelecimento?: string; forma_pagamento?: string; cartao_id?: string | null;
    invoice_month?: string | null; parcela_atual?: number | null; total_parcelas?: number | null;
  }>;

  // Agrupa por cartao_id apenas os que caem na fatura do (mes, ano)
  const porCartao = new Map<string, typeof gastos>();
  for (const g of gastos) {
    if (!g.cartao_id) continue;
    if (efetivoYmFor(g, cartaoFech) !== ym) continue;
    const arr = porCartao.get(g.cartao_id) ?? [];
    arr.push(g);
    porCartao.set(g.cartao_id, arr);
  }

  const faturaInfo = new Map<string, { status: string; valor_pago: number; data_pagamento: string | null }>();
  for (const f of (faturasRes.data ?? []) as any[]) {
    faturaInfo.set(f.cartao_id, {
      status: f.status ?? "aberta",
      valor_pago: Number(f.valor_pago || 0),
      data_pagamento: f.data_pagamento ?? null,
    });
  }

  const label = `${NOMES_MES_PT[mes - 1]} de ${ano}`;
  const lines: string[] = [];
  lines.push(`Mês de referência da fatura: ${label} (${ym}).`);

  let totalGeralFatura = 0;
  // Ordena cartões por valor da fatura desc
  const cartoesOrdenados = cartoes.slice().sort((a, b) => {
    const va = (porCartao.get(a.id) ?? []).reduce((s, g) => s + Number(g.valor || 0), 0);
    const vb = (porCartao.get(b.id) ?? []).reduce((s, g) => s + Number(g.valor || 0), 0);
    return vb - va;
  });

  for (const c of cartoesOrdenados) {
    const itens = porCartao.get(c.id) ?? [];
    const total = itens.reduce((s, g) => s + Number(g.valor || 0), 0);
    totalGeralFatura += total;
    const f = faturaInfo.get(c.id);
    const vencimento = c.dia_vencimento ? `dia ${c.dia_vencimento}` : "—";
    const banco = c.banco ? ` (${c.banco})` : "";
    lines.push(`Cartão "${c.nome}"${banco}:`);
    lines.push(`  - Fatura de ${label}: ${fmtBRL(total)} (${itens.length} lançamentos).`);
    lines.push(`  - Limite total: ${fmtBRL(Number(c.limite_total || 0))}. Vencimento: ${vencimento}.`);
    if (f) {
      lines.push(`  - Status na tabela de faturas: ${f.status}. Valor pago: ${fmtBRL(f.valor_pago)}${f.data_pagamento ? ` em ${f.data_pagamento}` : ""}.`);
      const pend = Math.max(0, total - f.valor_pago);
      lines.push(`  - Pendente estimado: ${fmtBRL(pend)}.`);
    } else if (total > 0) {
      lines.push(`  - Status: fatura ainda não marcada no app (sem registro em faturas_cartao para esse mês).`);
    }
    if (itens.length) {
      const porCat = new Map<string, number>();
      for (const g of itens) {
        const k = g.categoria_id ? catMap.get(g.categoria_id) ?? "Outros" : "Outros";
        porCat.set(k, (porCat.get(k) ?? 0) + Number(g.valor || 0));
      }
      const top = [...porCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (top.length) {
        lines.push(`  - Top categorias da fatura:`);
        for (const [n, v] of top) lines.push(`    - ${n}: ${fmtBRL(v)}`);
      }
      const maiores = itens.slice().sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0)).slice(0, 3);
      lines.push(`  - Maiores lançamentos:`);
      for (const g of maiores) {
        const desc = (g.estabelecimento || g.descricao || "Lançamento").toString().slice(0, 50);
        const parc = g.parcela_atual && g.total_parcelas ? ` (parc. ${g.parcela_atual}/${g.total_parcelas})` : "";
        lines.push(`    - ${desc}: ${fmtBRL(Number(g.valor || 0))} em ${g.data}${parc}`);
      }
    }
  }

  lines.push(`Soma de todas as faturas de ${label}: ${fmtBRL(totalGeralFatura)}.`);
  return lines.join("\n");
}

async function ensureFeatureAccess(userId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = data.user?.email ?? null;
  if (isAdminMasterEmail(email)) return { ok: true };

  const sub = await getSubscriptionForUserIdentity({ userId, email, repairLink: false });
  const plan = sub.plan as PlanTier;
  if (!sub.active) return { ok: false, reason: "Sua assinatura não está ativa. Acesse Meu plano para liberar." };
  if (!planAllowsFeature(plan, "gasto_ai")) {
    return { ok: false, reason: "Este recurso está disponível nos planos Pessoa Física Premium, MEI Inteligente e Empresa." };
  }
  return { ok: true };
}

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        message: z.string().trim().min(1, "Digite uma mensagem.").max(MAX_MESSAGE_LEN, "Mensagem muito longa."),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const access = await ensureFeatureAccess(userId);
    if (!access.ok) {
      throw new Response(access.reason, { status: 403 });
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Response("Serviço de IA indisponível.", { status: 500 });
    }

    // Save user message (RLS-protected, via authenticated client)
    const { error: insertUserErr } = await supabase
      .from("ai_chat_messages")
      .insert({ user_id: userId, role: "user", content: data.message });
    if (insertUserErr) {
      console.error("[finance-ai-chat] insert user message failed", insertUserErr);
    }

    // Load recent history
    const { data: history } = await supabase
      .from("ai_chat_messages")
      .select("role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);

    const ordered = [...(history ?? [])].reverse();

    const summary = await buildFinancialSummary(supabase, userId);

    const now = new Date();
    const target = detectTargetMonth(data.message, now);
    const targetBlock = target
      ? await buildTargetMonthSummary(supabase, userId, target.mes, target.ano)
      : null;

    // Detecta intenção de fatura/cartão para anexar bloco dedicado
    const lowerMsg = data.message.toLowerCase();
    const wantsFatura = /\b(fatura|faturas|cart[ãa]o|cart[õo]es|limite|vencimento da fatura|venceu o cart)\b/i.test(lowerMsg);
    const faturaRef = target ?? { mes: now.getMonth() + 1, ano: now.getFullYear() };
    const faturaBlock = wantsFatura
      ? await buildCartoesFaturasBlock(supabase, userId, faturaRef.mes, faturaRef.ano)
      : null;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `RESUMO FINANCEIRO DO USUÁRIO\n${summary}` },
      ...(targetBlock
        ? [{ role: "system" as const, content: `MÊS SOLICITADO PELO USUÁRIO\n${targetBlock}` }]
        : []),
      ...(faturaBlock
        ? [{ role: "system" as const, content: `CARTÕES E FATURAS\n${faturaBlock}` }]
        : []),
      ...ordered.map((m: any) => ({ role: m.role, content: m.content })),
    ];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
    });

    if (!aiResp.ok) {
      const text = await aiResp.text().catch(() => "");
      console.error("[finance-ai-chat] AI gateway error", aiResp.status, text);
      if (aiResp.status === 429) {
        throw new Response("Muitas perguntas seguidas. Aguarde alguns instantes.", { status: 429 });
      }
      if (aiResp.status === 402) {
        throw new Response("Sem créditos da IA no momento.", { status: 402 });
      }
      throw new Response("Não consegui responder agora. Tente novamente em alguns instantes.", { status: 502 });
    }

    const json: any = await aiResp.json();
    const reply: string = json?.choices?.[0]?.message?.content?.trim?.() ?? "";
    if (!reply) {
      throw new Response("Não consegui gerar uma resposta agora.", { status: 502 });
    }

    const { data: inserted } = await supabase
      .from("ai_chat_messages")
      .insert({ user_id: userId, role: "assistant", content: reply })
      .select("id, created_at")
      .single();

    return {
      reply,
      assistantMessageId: inserted?.id ?? null,
      createdAt: inserted?.created_at ?? new Date().toISOString(),
    };
  });

export const getChatHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("ai_chat_messages")
      .select("id, role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      console.error("[finance-ai-chat] getChatHistory", error);
      return { messages: [] as Array<{ id: string; role: "user" | "assistant"; content: string; created_at: string }> };
    }
    return { messages: (data ?? []) as any };
  });

// ====================================================================
// Resumo Inteligente do Mês — análise automática para o Dashboard
// ====================================================================

const SMART_SUMMARY_PROMPT = `Você é o "Gasto Inteligente AI". Gere um RESUMO INTELIGENTE DO MÊS para exibir num card do Dashboard.

Tom: amigável, descontraído, brasileiro, próximo. Linguagem simples, sem jargão.

FORMATO OBRIGATÓRIO (markdown limpo, curto):
- Comece com 1 frase resumindo receitas, gastos e saldo do mês (use os valores EXATOS).
- Em seguida, 1 parágrafo curto destacando a categoria de maior peso e 1-2 categorias relevantes a revisar.
- Se houver fatura de cartão com valor relevante, inclua um bloco curto:
  **Ponto de atenção:** descreva fatura(s) com valor, cartão e dia de vencimento (use os dados do bloco CARTÕES E FATURAS).
- Se houver contas vencidas/próximas, mencione brevemente.
- Termine com **Sugestão:** uma dica curta, gentil e prática (1-2 linhas).

Regras críticas:
- Use APENAS os números dos blocos. Nunca invente valores, datas, categorias ou nomes de cartões.
- Se faltarem dados, escreva: "Ainda não tenho dados suficientes deste mês para uma análise completa."
- Total máximo: 8 linhas. Sem títulos H1/H2. Sem listas longas. Sem despedidas.
- Valores em R$ 1.234,56.`;

async function buildMonthFullSummary(
  supabase: any,
  userId: string,
  mes: number,
  ano: number,
): Promise<string> {
  const ym = `${ano}-${String(mes).padStart(2, "0")}`;
  const monthStart = isoDate(new Date(ano, mes - 1, 1));
  const nextMonthStart = isoDate(new Date(ano, mes, 1));
  const winStart = isoDate(new Date(ano, mes - 1 - 2, 1));
  const winEnd = isoDate(new Date(ano, mes - 1 + 2, 0));
  const prevMes = mes === 1 ? 12 : mes - 1;
  const prevAno = mes === 1 ? ano - 1 : ano;
  const prevYm = `${prevAno}-${String(prevMes).padStart(2, "0")}`;

  const [
    gastosRes,
    cartoesRes,
    categoriasRes,
    receitasRes,
    contasPagarRes,
    metasRes,
    faturasRes,
  ] = await Promise.all([
    supabase
      .from("gastos")
      .select("valor, categoria_id, data, descricao, estabelecimento, forma_pagamento, cartao_id, invoice_month, gasto_fixo, tipo_gasto")
      .eq("user_id", userId)
      .or(`invoice_month.in.(${ym},${prevYm}),and(data.gte.${winStart},data.lte.${winEnd})`)
      .limit(5000),
    supabase.from("cartoes").select("id, nome, banco, limite_total, dia_vencimento, dia_fechamento").eq("user_id", userId).limit(50),
    supabase.from("categorias").select("id, nome").eq("user_id", userId).limit(200),
    supabase
      .from("contas_a_receber")
      .select("titulo, valor_total, valor_recebido, data_prevista, status")
      .eq("user_id", userId)
      .gte("data_prevista", monthStart)
      .lt("data_prevista", nextMonthStart)
      .limit(100),
    supabase
      .from("contas_a_pagar")
      .select("nome, valor, data_vencimento, status")
      .eq("user_id", userId)
      .gte("data_vencimento", isoDate(new Date(ano, mes - 1 - 1, 1)))
      .lte("data_vencimento", isoDate(new Date(ano, mes, 0)))
      .limit(100),
    supabase.from("metas_financeiras").select("nome, valor_atual, valor_objetivo, prazo").eq("user_id", userId).limit(20),
    supabase.from("faturas_cartao").select("cartao_id, mes, ano, status, valor_pago, data_pagamento").eq("user_id", userId).eq("mes", mes).eq("ano", ano),
  ]);

  const cartaoFech = new Map<string, number>();
  const cartaoMap = new Map<string, { nome: string; banco?: string | null; dia_vencimento: number; limite_total: number }>();
  for (const c of (cartoesRes.data ?? []) as any[]) {
    cartaoFech.set(c.id, Number(c.dia_fechamento) || 0);
    cartaoMap.set(c.id, { nome: c.nome, banco: c.banco, dia_vencimento: Number(c.dia_vencimento) || 0, limite_total: Number(c.limite_total) || 0 });
  }
  const catMap = new Map<string, string>();
  for (const c of (categoriasRes.data ?? []) as any[]) catMap.set(c.id, c.nome);

  const allGastos = (gastosRes.data ?? []) as Array<{
    valor: number; categoria_id: string | null; data: string; descricao?: string;
    estabelecimento?: string; forma_pagamento?: string; cartao_id?: string | null;
    invoice_month?: string | null; gasto_fixo?: boolean | null; tipo_gasto?: string | null;
  }>;

  const doMes = allGastos.filter((g) => efetivoYmFor(g, cartaoFech) === ym);
  const doMesAnt = allGastos.filter((g) => efetivoYmFor(g, cartaoFech) === prevYm);

  const totalMes = doMes.reduce((s, g) => s + Number(g.valor || 0), 0);
  const totalMesAnt = doMesAnt.reduce((s, g) => s + Number(g.valor || 0), 0);

  const porCat = new Map<string, number>();
  for (const g of doMes) {
    const k = g.categoria_id ? catMap.get(g.categoria_id) ?? "Outros" : "Outros";
    porCat.set(k, (porCat.get(k) ?? 0) + Number(g.valor || 0));
  }
  const topCat = [...porCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const maior = doMes.slice().sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0))[0] ?? null;

  const recorrentes = doMes
    .filter((g) => g.gasto_fixo || g.tipo_gasto === "recorrente")
    .reduce((s, g) => s + Number(g.valor || 0), 0);

  const receitas = (receitasRes.data ?? []) as Array<{ valor_total: number; valor_recebido: number; status: string }>;
  const totalReceitas = receitas.reduce((s, r) => s + Number(r.valor_total || 0), 0);
  const totalRecebido = receitas.reduce((s, r) => s + Number(r.valor_recebido || 0), 0);

  // Faturas por cartão (mesma lógica do buildCartoesFaturasBlock)
  const porCartao = new Map<string, { total: number; itens: number }>();
  for (const g of doMes) {
    if (g.forma_pagamento !== "credito" || !g.cartao_id) continue;
    const cur = porCartao.get(g.cartao_id) ?? { total: 0, itens: 0 };
    cur.total += Number(g.valor || 0);
    cur.itens += 1;
    porCartao.set(g.cartao_id, cur);
  }
  const faturaInfo = new Map<string, { status: string; valor_pago: number }>();
  for (const f of (faturasRes.data ?? []) as any[]) {
    faturaInfo.set(f.cartao_id, { status: f.status ?? "aberta", valor_pago: Number(f.valor_pago || 0) });
  }

  const contasPagar = (contasPagarRes.data ?? []) as Array<{ nome: string; valor: number; data_vencimento: string; status: string }>;
  const hojeISO = isoDate(new Date());
  const vencidas = contasPagar.filter((c) => c.status !== "pago" && c.data_vencimento < hojeISO);
  const proximas = contasPagar.filter((c) => c.status !== "pago" && c.data_vencimento >= hojeISO);
  const pagas = contasPagar.filter((c) => c.status === "pago");

  const metas = (metasRes.data ?? []) as Array<{ nome: string; valor_atual: number; valor_objetivo: number; prazo: string | null }>;

  const saldo = totalReceitas - totalMes;
  const label = `${NOMES_MES_PT[mes - 1]} de ${ano}`;

  const lines: string[] = [];
  lines.push(`Mês de referência: ${label} (${ym}). Hoje: ${hojeISO}.`);
  lines.push(`Receitas previstas no mês: ${fmtBRL(totalReceitas)} (recebido até agora: ${fmtBRL(totalRecebido)}).`);
  lines.push(`Total gasto no mês: ${fmtBRL(totalMes)} (${doMes.length} lançamentos).`);
  lines.push(`Saldo do mês (receitas - gastos): ${fmtBRL(saldo)}.`);
  if (totalMesAnt > 0) {
    const diff = totalMes - totalMesAnt;
    const pct = totalMesAnt ? Math.round((diff / totalMesAnt) * 100) : 0;
    lines.push(`Mês anterior gastou: ${fmtBRL(totalMesAnt)} (${diff >= 0 ? "+" : ""}${pct}% vs. mês atual).`);
  }
  lines.push(`Gastos recorrentes/fixos do mês: ${fmtBRL(recorrentes)}.`);

  if (topCat.length) {
    lines.push("Top categorias do mês:");
    for (const [n, v] of topCat) lines.push(`- ${n}: ${fmtBRL(v)}`);
  } else {
    lines.push("Sem gastos cadastrados neste mês.");
  }

  if (maior) {
    const desc = (maior.estabelecimento || maior.descricao || "Lançamento").toString().slice(0, 60);
    lines.push(`Maior gasto individual: ${desc} — ${fmtBRL(Number(maior.valor || 0))} em ${maior.data}.`);
  }

  if (porCartao.size) {
    lines.push("Faturas de cartão deste mês:");
    for (const [cid, info] of porCartao.entries()) {
      const c = cartaoMap.get(cid);
      if (!c) continue;
      const fi = faturaInfo.get(cid);
      const venc = c.dia_vencimento ? `vence dia ${String(c.dia_vencimento).padStart(2, "0")}` : "vencimento não definido";
      const pago = fi ? `, status ${fi.status}, pago ${fmtBRL(fi.valor_pago)}` : "";
      lines.push(`- ${c.nome}${c.banco ? ` (${c.banco})` : ""}: ${fmtBRL(info.total)} em ${info.itens} lançamentos, ${venc}${pago}.`);
    }
  } else {
    lines.push("Sem fatura de cartão de crédito neste mês.");
  }

  if (vencidas.length) {
    lines.push(`Contas vencidas: ${vencidas.length} (${fmtBRL(vencidas.reduce((s, c) => s + Number(c.valor || 0), 0))}).`);
    for (const c of vencidas.slice(0, 3)) lines.push(`- ${c.nome}: ${fmtBRL(Number(c.valor || 0))} venceu em ${c.data_vencimento}.`);
  }
  if (proximas.length) {
    lines.push(`Contas a pagar próximas: ${proximas.length} (${fmtBRL(proximas.reduce((s, c) => s + Number(c.valor || 0), 0))}).`);
    for (const c of proximas.slice(0, 3)) lines.push(`- ${c.nome}: ${fmtBRL(Number(c.valor || 0))} venc. ${c.data_vencimento}.`);
  }
  if (pagas.length) {
    lines.push(`Contas pagas no mês: ${pagas.length}.`);
  }

  if (metas.length) {
    lines.push("Metas em andamento:");
    for (const m of metas.slice(0, 4)) {
      const pct = m.valor_objetivo ? Math.round((Number(m.valor_atual) / Number(m.valor_objetivo)) * 100) : 0;
      lines.push(`- ${m.nome}: ${fmtBRL(Number(m.valor_atual || 0))} de ${fmtBRL(Number(m.valor_objetivo || 0))} (${pct}%)${m.prazo ? `, prazo ${m.prazo}` : ""}.`);
    }
  }

  return lines.join("\n");
}

export const getMonthlySmartSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        mes: z.number().int().min(1).max(12).optional(),
        ano: z.number().int().min(2000).max(2100).optional(),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const access = await ensureFeatureAccess(userId);
    if (!access.ok) {
      throw new Response(access.reason, { status: 403 });
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Response("Serviço de IA indisponível.", { status: 500 });
    }

    const now = new Date();
    const mes = data.mes ?? now.getMonth() + 1;
    const ano = data.ano ?? now.getFullYear();

    const block = await buildMonthFullSummary(supabase, userId, mes, ano);

    const messages = [
      { role: "system", content: SMART_SUMMARY_PROMPT },
      { role: "system", content: `DADOS DO MÊS\n${block}` },
      {
        role: "user",
        content: `Gere o resumo inteligente do mês ${NOMES_MES_PT[mes - 1]} de ${ano} com base apenas nos dados acima.`,
      },
    ];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
    });

    if (!aiResp.ok) {
      const text = await aiResp.text().catch(() => "");
      console.error("[smart-summary] AI gateway error", aiResp.status, text);
      if (aiResp.status === 429) throw new Response("Muitas requisições. Aguarde alguns instantes.", { status: 429 });
      if (aiResp.status === 402) throw new Response("Sem créditos da IA no momento.", { status: 402 });
      throw new Response("Não consegui gerar o resumo agora.", { status: 502 });
    }

    const json: any = await aiResp.json();
    const reply: string = json?.choices?.[0]?.message?.content?.trim?.() ?? "";
    if (!reply) throw new Response("Não consegui gerar o resumo agora.", { status: 502 });

    return { reply, mes, ano, generatedAt: new Date().toISOString() };
  });

export const clearChatHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("ai_chat_messages").delete().eq("user_id", userId);
    if (error) {
      console.error("[finance-ai-chat] clearChatHistory", error);
      throw new Response("Não consegui limpar o histórico.", { status: 500 });
    }
    return { ok: true };
  });
