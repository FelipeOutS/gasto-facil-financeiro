/**
 * Helpers server-only para a integração WhatsApp.
 * NÃO importar em código de browser.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseWhatsAppExpenseMessage } from "@/lib/whatsappParser";
import { suggestCategoryFromText } from "@/lib/categories";
import type { Cartao, FormaPagamento } from "@/lib/types";

type WhatsAppMessageRow = {
  external_id: string | null;
  telefone: string;
  texto: string;
  recebida_em?: string;
};

/** Mascarar telefone para exibição segura. */
export function maskTelefone(tel: string): string {
  const digits = tel.replace(/\D/g, "");
  if (digits.length <= 4) return "***";
  return `***${digits.slice(-4)}`;
}

/** Resolve o user_id dono daquele telefone, considerando variações. */
async function resolveUserId(telefone: string): Promise<string | null> {
  const digits = telefone.replace(/\D/g, "");
  // Tenta match exato e variações comuns (com/sem 55 e com/sem nono dígito)
  const candidatos = new Set<string>([telefone, digits]);
  if (digits.startsWith("55")) candidatos.add(digits.slice(2));
  else candidatos.add(`55${digits}`);

  const { data } = await supabaseAdmin
    .from("whatsapp_links")
    .select("user_id, telefone, ativo")
    .in("telefone", Array.from(candidatos))
    .limit(1)
    .maybeSingle();

  if (data?.ativo) return data.user_id;
  return null;
}

/** Carrega cartões do usuário (necessário para o parser identificar cartão). */
async function carregarCartoes(userId: string): Promise<Cartao[]> {
  const { data } = await supabaseAdmin
    .from("cartoes")
    .select("*")
    .eq("user_id", userId);
  if (!data) return [];
  return data.map(
    (c): Cartao => ({
      id: c.id,
      nome: c.nome,
      banco: c.banco ?? "",
      limiteTotal: Number(c.limite_total ?? 0),
      diaFechamento: c.dia_fechamento ?? 1,
      diaVencimento: c.dia_vencimento ?? 10,
      cor: c.cor ?? "#8b5cf6",
      observacao: c.observacao ?? undefined,
    }),
  );
}

/** Resolve a categoria_id (uuid) para o user a partir do legacy_id ou nome. */
async function resolveCategoriaId(
  userId: string,
  categoriaKey: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("categorias")
    .select("id, legacy_id, nome")
    .eq("user_id", userId);
  if (!data || data.length === 0) return null;
  const byLegacy = data.find((c) => c.legacy_id === categoriaKey);
  if (byLegacy) return byLegacy.id;
  const norm = categoriaKey.toLowerCase();
  const byName = data.find((c) => c.nome.toLowerCase() === norm);
  if (byName) return byName.id;
  // fallback: "outros"
  const outros = data.find((c) => c.legacy_id === "outros") ?? data[0];
  return outros?.id ?? null;
}

export type ProcessOutcome = {
  status:
    | "duplicada"
    | "salva"
    | "pendente"
    | "sem_vinculo"
    | "erro"
    | "valor_invalido";
  gastoId?: string;
  confianca?: number;
  resposta: string;
};

/**
 * Processa uma mensagem recebida (do webhook) usando o mesmo parser do
 * simulador. Salva gasto se confiança alta + valor + (cartão ou forma != crédito).
 */
export async function processarMensagemWhatsApp(
  msg: WhatsAppMessageRow,
): Promise<ProcessOutcome> {
  // 1) Dedupe por external_id, se houver
  if (msg.external_id) {
    const { data: existente } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, gasto_id, status")
      .eq("external_id", msg.external_id)
      .maybeSingle();
    if (existente) {
      return {
        status: "duplicada",
        gastoId: existente.gasto_id ?? undefined,
        resposta: "Mensagem já processada anteriormente.",
      };
    }
  }

  const texto = (msg.texto ?? "").trim();
  if (!texto) {
    return { status: "erro", resposta: "Mensagem vazia." };
  }

  // 2) Resolver usuário pelo telefone
  const userId = await resolveUserId(msg.telefone);
  if (!userId) {
    // registra mesmo sem user para a tela de log do owner futuramente?
    // sem user_id, RLS bloqueia tudo — não persiste.
    return {
      status: "sem_vinculo",
      resposta:
        "Número não vinculado a nenhuma conta. Acesse o app em /whatsapp e vincule seu número.",
    };
  }

  // 3) Parser
  const cartoes = await carregarCartoes(userId);
  const parsed = parseWhatsAppExpenseMessage(texto, cartoes);

  // 4) Persist log inicial
  const { data: logRow, error: logErr } = await supabaseAdmin
    .from("whatsapp_messages")
    .insert({
      user_id: userId,
      external_id: msg.external_id,
      telefone: msg.telefone,
      texto,
      recebida_em: msg.recebida_em ?? new Date().toISOString(),
      status: "recebida",
      confianca: parsed.confianca,
      parsed: parsed as unknown as Record<string, unknown>,
    })
    .select("id")
    .single();
  if (logErr) {
    console.error("[whatsapp] log insert failed", logErr);
    return { status: "erro", resposta: "Erro interno ao registrar mensagem." };
  }

  // 5) Validações
  if (parsed.valor <= 0) {
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({
        status: "pendente",
        resposta_sugerida:
          "⚠️ Não consegui identificar o valor. Reenvie informando o valor (ex: R$ 26,00).",
      })
      .eq("id", logRow.id);
    return {
      status: "valor_invalido",
      resposta:
        "⚠️ Não consegui identificar o valor. Reenvie informando o valor (ex: R$ 26,00).",
    };
  }

  const altaConfianca =
    parsed.confianca >= 0.7 &&
    (parsed.formaPagamento !== "credito" || !!parsed.cartaoId);

  if (!altaConfianca) {
    const motivo = parsed.notas[0] ?? "informações insuficientes";
    const resposta = `⚠️ Recebi "${parsed.nome}" — ${formatBRL(parsed.valor)}, mas precisa de revisão (${motivo}). Ajuste no app.`;
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({ status: "pendente", resposta_sugerida: resposta })
      .eq("id", logRow.id);
    return { status: "pendente", confianca: parsed.confianca, resposta };
  }

  // 6) Salvar gasto
  const categoriaKey =
    suggestCategoryFromText(parsed.categoriaSugestao || parsed.nome) || "outros";
  const categoriaId = await resolveCategoriaId(userId, categoriaKey);

  const dataISO = parsed.data;
  const [y, m] = dataISO.split("-").map(Number);

  const { data: gastoRow, error: gastoErr } = await supabaseAdmin
    .from("gastos")
    .insert({
      user_id: userId,
      categoria_id: categoriaId,
      descricao: parsed.nome,
      estabelecimento: parsed.nome,
      valor: parsed.valor,
      data: dataISO,
      mes: m,
      ano: y,
      forma_pagamento: parsed.formaPagamento as FormaPagamento,
      cartao_id:
        parsed.formaPagamento === "credito" ? parsed.cartaoId ?? null : null,
      tipo_gasto: parsed.parcelas ? "parcelado" : "unico",
      total_parcelas: parsed.parcelas ?? null,
      observacao: `WhatsApp: ${parsed.mensagemOriginal}`,
      origem: "whatsapp",
      confirmado: true,
    })
    .select("id")
    .single();

  if (gastoErr || !gastoRow) {
    console.error("[whatsapp] gasto insert failed", gastoErr);
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({ status: "erro", erro: gastoErr?.message ?? "insert failed" })
      .eq("id", logRow.id);
    return { status: "erro", resposta: "Erro ao salvar gasto." };
  }

  const cartaoNome = parsed.cartaoId
    ? cartoes.find((c) => c.id === parsed.cartaoId)?.nome
    : undefined;
  const resposta = `✅ Gasto registrado: ${parsed.nome} — ${formatBRL(parsed.valor)}${cartaoNome ? ` no cartão ${cartaoNome}` : ""}.`;

  await supabaseAdmin
    .from("whatsapp_messages")
    .update({
      status: "salva",
      gasto_id: gastoRow.id,
      resposta_sugerida: resposta,
    })
    .eq("id", logRow.id);

  await supabaseAdmin
    .from("whatsapp_links")
    .update({ ultimo_uso: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("telefone", msg.telefone);

  return {
    status: "salva",
    gastoId: gastoRow.id,
    confianca: parsed.confianca,
    resposta,
  };
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/**
 * Envio de resposta pelo WhatsApp (Graph API). PREPARADO mas inativo
 * enquanto WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID não forem
 * configurados. Retorna { sent: false, reason: "not_configured" } nesse caso.
 */
export async function sendWhatsAppReply(
  to: string,
  text: string,
): Promise<{ sent: boolean; reason?: string; status?: number }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    return { sent: false, reason: "not_configured" };
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        }),
      },
    );
    return { sent: res.ok, status: res.status };
  } catch (e) {
    return { sent: false, reason: (e as Error).message };
  }
}
