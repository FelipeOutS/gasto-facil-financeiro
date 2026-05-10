import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSubscriptionForUserIdentity } from "@/server/subscription.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { planAllowsFeature, isAdminMasterEmail, type PlanTier } from "@/lib/plans";

const MAX_MESSAGE_LEN = 1500;
const HISTORY_LIMIT = 30;

const SYSTEM_PROMPT = `Você é o "Gasto Inteligente AI", um assistente financeiro brasileiro do app Gasto Inteligente.

Tom: descontraído, amigável, próximo, brasileiro. Pode usar "bora", "opa", "tranquilo". Nada de tom robótico ou frio.

ESTILO DA RESPOSTA (MUITO IMPORTANTE):
- Comece com 1 frase curta de abertura amigável (ex: "Bora lá!" ou "Olha só o que vi:").
- Use **negrito em markdown** apenas para destacar 2-3 palavras-chave por resposta.
- Quando listar pontos, use Markdown de lista com hífens ("- item"). Nunca use asteriscos soltos ("*") nem "• ". Nunca use markdown cru visível.
- No máximo 3 a 5 itens por resposta. Cada item curto, 1-2 linhas.
- Termine com 1 frase de incentivo curta (opcional).
- Resposta total: no máximo 8 linhas. Direto ao ponto.

REGRAS:
- Use APENAS dados do "RESUMO FINANCEIRO DO USUÁRIO". Não invente valores, datas, categorias.
- Se faltam dados, diga com gentileza: "Ainda não tenho informações suficientes. Cadastre alguns gastos e receitas para eu te ajudar melhor."
- Pode dar orientações gerais de organização, economia, planejamento, metas e orçamento.
- NÃO prometa lucro nem garanta economia. Seja cauteloso com investimentos.
- Não cite e-mail do usuário, senhas ou tokens.
- Valores em reais: R$ 1.234,56.`;

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

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `RESUMO FINANCEIRO DO USUÁRIO\n${summary}` },
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
