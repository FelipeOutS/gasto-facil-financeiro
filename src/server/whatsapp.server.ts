/**
 * Helpers server-only para a integração WhatsApp.
 * NÃO importar em código de browser.
 *
 * Fluxo (importante!): NUNCA salva gasto automaticamente. O parser identifica
 * os campos, o servidor responde com uma confirmação clara e só salva o gasto
 * quando o usuário responder "sim", "salvar", "confirmar" etc.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin = _supabaseAdmin as any;
import {
  parseWhatsAppExpenseMessage,
  type ParsedExpense,
} from "@/lib/whatsappParser";
import { suggestCategoryFromText } from "@/lib/categories";
import type { Cartao, FormaPagamento } from "@/lib/types";
import { getSubscriptionForUserIdentity } from "./subscription.server";
import { planAllowsFeature } from "@/lib/plans";

/** Verifica se o dono do número tem plano ativo que inclua WhatsApp. */
async function userPodeUsarWhatsApp(userId: string): Promise<{ ok: boolean; reason?: string }> {
  const { data: u } = await supabaseAdmin
    .from("auth.users" as never)
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  let email: string | null = null;
  if (u?.email) email = u.email;
  if (!email) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adminApi = (supabaseAdmin as any).auth?.admin;
      if (adminApi?.getUserById) {
        const { data } = await adminApi.getUserById(userId);
        email = data?.user?.email ?? null;
      }
    } catch {
      email = null;
    }
  }
  const sub = await getSubscriptionForUserIdentity({ userId, email });
  if (!sub.active) return { ok: false, reason: "Sua assinatura não está ativa." };
  if (!planAllowsFeature(sub.plan, "whatsapp")) {
    return { ok: false, reason: "Seu plano atual não inclui o lançamento por WhatsApp." };
  }
  return { ok: true };
}

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

/**
 * Resolve o user_id dono daquele telefone, considerando variações.
 * Requer consentimento LGPD válido (opt_in_em IS NOT NULL, revogado_em IS NULL,
 * ativo = true). Sem isso, retorna null — webhook trata como "sem consentimento".
 */
async function resolveUserId(telefone: string): Promise<
  | { userId: string; status: "ok" }
  | { userId: null; status: "sem_vinculo" | "sem_consentimento" }
> {
  const digits = telefone.replace(/\D/g, "");
  const candidatos = new Set<string>([telefone, digits]);
  if (digits.startsWith("55")) candidatos.add(digits.slice(2));
  else candidatos.add(`55${digits}`);

  const { data } = await supabaseAdmin
    .from("whatsapp_links")
    .select("user_id, telefone, ativo, opt_in_em, revogado_em")
    .in("telefone", Array.from(candidatos))
    .limit(1)
    .maybeSingle();

  if (!data) return { userId: null, status: "sem_vinculo" };
  if (!data.ativo || !data.opt_in_em || data.revogado_em) {
    return { userId: null, status: "sem_consentimento" };
  }
  return { userId: data.user_id, status: "ok" };
}

/** Carrega cartões do usuário. */
async function carregarCartoes(userId: string): Promise<Cartao[]> {
  const { data } = await supabaseAdmin
    .from("cartoes")
    .select("*")
    .eq("user_id", userId);
  if (!data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any): Cartao => ({
      id: c.id,
      nome: c.nome,
      banco: c.banco ?? "",
      limiteTotal: Number(c.limite_total ?? 0),
      diaFechamento: c.dia_fechamento ?? 1,
      diaVencimento: c.dia_vencimento ?? 10,
      cor: c.cor ?? "#8b5cf6",
      observacao: c.observacao ?? undefined,
      criadoEm: c.created_at ?? new Date().toISOString(),
      atualizadoEm: c.updated_at ?? new Date().toISOString(),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arr = data as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byLegacy = arr.find((c: any) => c.legacy_id === categoriaKey);
  if (byLegacy) return byLegacy.id;
  const norm = categoriaKey.toLowerCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byName = arr.find((c: any) => c.nome.toLowerCase() === norm);
  if (byName) return byName.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outros = arr.find((c: any) => c.legacy_id === "outros") ?? arr[0];
  return outros?.id ?? null;
}

export type ProcessOutcome = {
  status:
    | "duplicada"
    | "salva"
    | "aguardando_confirmacao"
    | "cancelada"
    | "sem_pendencia"
    | "pendente"
    | "sem_vinculo"
    | "sem_consentimento"
    | "sem_plano"
    | "erro"
    | "valor_invalido"
    | "gasto_excluido";
  gastoId?: string;
  confianca?: number;
  resposta: string;
};

function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function verificarGastoExiste(gastoId: string | null | undefined): Promise<boolean> {
  if (!gastoId) return false;
  const { data } = await supabaseAdmin
    .from("gastos")
    .select("id")
    .eq("id", gastoId)
    .maybeSingle();
  return !!data;
}

// ---------- Confirmação / cancelamento ----------

const CONFIRM_TOKENS = [
  "sim", "s", "ok", "okay", "salvar", "salva", "confirmar", "confirma",
  "confirmado", "confirmada", "pode salvar", "pode", "isso", "isso mesmo",
  "correto", "👍", "✅", "yes", "y",
];
const CANCEL_TOKENS = [
  "nao", "não", "n", "cancelar", "cancela", "cancelado", "ignora",
  "ignorar", "apaga", "apagar", "errado", "no",
];

export function classificarResposta(texto: string): "confirm" | "cancel" | "outro" {
  const t = normalizeText(texto);
  if (!t) return "outro";
  if (CONFIRM_TOKENS.includes(t)) return "confirm";
  if (CANCEL_TOKENS.includes(t)) return "cancel";
  return "outro";
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDataBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  const hoje = new Date();
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  if (iso === hojeIso) return "hoje";
  return `${d}/${m}/${y}`;
}

function rotuloFormaPagamento(f: FormaPagamento, cartaoNome?: string): string {
  switch (f) {
    case "credito":
      return cartaoNome ? `Cartão ${cartaoNome} (crédito)` : "Cartão de crédito";
    case "debito":
      return "Cartão de débito";
    case "pix":
      return "Pix";
    case "dinheiro":
      return "Dinheiro";
    case "boleto":
      return "Boleto";
    case "transferencia":
      return "Transferência";
    case "vale_alimentacao":
      return "Vale alimentação";
    case "vale_refeicao":
      return "Vale refeição";
    default:
      return String(f);
  }
}

export function formatarConfirmacao(parsed: ParsedExpense, cartaoNome?: string): string {
  const categoria =
    parsed.categoriaSugestao && parsed.categoriaSugestao.length < 40
      ? parsed.categoriaSugestao
      : suggestCategoryFromText(parsed.nome) ?? "Outros";
  const linhas = [
    "🧾 Encontrei este gasto:",
    "",
    `Valor: ${formatBRL(parsed.valor)}`,
    `Categoria: ${categoria}`,
    `Data: ${formatDataBR(parsed.data) === "hoje" ? "Hoje" : formatDataBR(parsed.data)}`,
    `Pagamento: ${rotuloFormaPagamento(parsed.formaPagamento, cartaoNome)}`,
  ];
  if (parsed.parcelas && parsed.parcelas > 1) {
    linhas.push(`Parcelas: ${parsed.parcelas}x`);
  }
  linhas.push("");
  linhas.push("Deseja salvar esse gasto? Responda sim ou não.");
  return linhas.join("\n");
}

/** Pergunta o que falta. Retorna null se nada falta. */
export function detectarFaltantes(
  parsed: ParsedExpense,
  cartoes: Cartao[],
): string | null {
  if (!parsed.valor || parsed.valor <= 0) {
    return "❓ Só preciso de mais uma informação: qual foi o valor do gasto? Ex.: R$ 48,90.";
  }
  if (!parsed.nome || parsed.nome.length < 2) {
    return "❓ Só preciso de mais uma informação: o que você comprou ou pagou? Ex.: mercado, uber, farmácia.";
  }
  if (parsed.formaPagamento === "credito") {
    if (parsed.cartaoAmbiguo && parsed.cartaoAmbiguo.nomes.length > 1) {
      return `❓ Você tem mais de um cartão parecido: ${parsed.cartaoAmbiguo.nomes.join(", ")}. Me diga o nome exato do cartão usado.`;
    }
    if (!parsed.cartaoId && !parsed.cartaoNomeDetectado) {
      return "❓ Só preciso de mais uma informação: você pagou com Pix, dinheiro, débito ou cartão?";
    }
    if (!parsed.cartaoId && parsed.cartaoNomeDetectado) {
      const nomes = cartoes.map((c) => c.nome).filter(Boolean);
      const lista = nomes.length > 0 ? `\nSeus cartões cadastrados: ${nomes.join(", ")}.` : "";
      return `❓ Não encontrei o cartão "${parsed.cartaoNomeDetectado}" cadastrado.${lista}\nMe diga o nome certo do cartão ou cadastre um novo no app antes de confirmar.`;
    }
  }
  return null;
}

// ---------- Persistência do gasto ----------

async function persistirGasto(
  userId: string,
  parsed: ParsedExpense,
  cartoes: Cartao[],
): Promise<{ gastoId?: string; resposta: string; ok: boolean }> {
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
    return { ok: false, resposta: "❌ Não consegui salvar agora. Pode tentar de novo em instantes?" };
  }

  const cartaoNome = parsed.cartaoId
    ? cartoes.find((c) => c.id === parsed.cartaoId)?.nome
    : undefined;
  const categoria =
    parsed.categoriaSugestao && parsed.categoriaSugestao.length < 40
      ? parsed.categoriaSugestao
      : suggestCategoryFromText(parsed.nome) ?? "Outros";
  const ondePagou = cartaoNome
    ? ` no Cartão ${cartaoNome}`
    : ` no ${rotuloFormaPagamento(parsed.formaPagamento)}`;
  const resposta = `✅ Gasto salvo com sucesso!\n${formatBRL(parsed.valor)} em ${categoria} foi registrado${ondePagou}.`;

  return { ok: true, gastoId: gastoRow.id, resposta };
}

// ---------- Pendências (aguardando confirmação) ----------

const PENDING_TTL_MS = 30 * 60 * 1000; // 30 min

async function buscarPendencia(userId: string, telefone: string): Promise<{
  id: string;
  parsed: ParsedExpense;
  recebida_em: string;
} | null> {
  const desde = new Date(Date.now() - PENDING_TTL_MS).toISOString();
  const { data } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id, parsed, recebida_em")
    .eq("user_id", userId)
    .eq("telefone", telefone)
    .eq("status", "aguardando_confirmacao")
    .gte("recebida_em", desde)
    .order("recebida_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.parsed) return null;
  return {
    id: data.id,
    parsed: data.parsed as ParsedExpense,
    recebida_em: data.recebida_em,
  };
}

// ---------- Pipeline principal ----------

export async function processarMensagemWhatsApp(
  msg: WhatsAppMessageRow,
): Promise<ProcessOutcome> {
  // Dedupe por external_id (Meta retenta o mesmo evento).
  if (msg.external_id) {
    const { data: existente } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, gasto_id, status")
      .eq("external_id", msg.external_id)
      .maybeSingle();
    if (existente) {
      const gastoAindaExiste = await verificarGastoExiste(existente.gasto_id);
      if (existente.status === "salva" && gastoAindaExiste) {
        return {
          status: "duplicada",
          gastoId: existente.gasto_id ?? undefined,
          resposta: "Mensagem já processada anteriormente.",
        };
      }
      // status pendente/aguardando ou gasto excluído → libera o slot
      if (existente.status === "aguardando_confirmacao") {
        return {
          status: "duplicada",
          resposta: "Mensagem já recebida — aguardando sua confirmação.",
        };
      }
      await supabaseAdmin.from("whatsapp_messages").delete().eq("id", existente.id);
    }
  }

  const texto = (msg.texto ?? "").trim();
  if (!texto) return { status: "erro", resposta: "Não recebi nenhum texto. Me envie o gasto, ex.: \"Mercado 48,90 hoje no Nubank\"." };

  const resolved = await resolveUserId(msg.telefone);
  if (resolved.status === "sem_vinculo") {
    return {
      status: "sem_vinculo",
      resposta:
        "Olá! Esse número ainda não está vinculado a uma conta no Gasto Inteligente. Abra o app, vá em WhatsApp e cadastre seu número para começar a lançar gastos por aqui.",
    };
  }
  if (resolved.status === "sem_consentimento") {
    return {
      status: "sem_consentimento",
      resposta:
        "Seu WhatsApp não possui consentimento ativo para lançamentos. Acesse o app e vincule novamente seu número.",
    };
  }
  const userId = resolved.userId;

  const planoOk = await userPodeUsarWhatsApp(userId);
  if (!planoOk.ok) {
    return {
      status: "sem_plano",
      resposta: `Olá! ${planoOk.reason ?? "Sua assinatura não está ativa."} Ative um plano no app para usar os lançamentos pelo WhatsApp.`,
    };
  }

  // 1) É uma resposta a uma confirmação pendente?
  const decisao = classificarResposta(texto);
  if (decisao !== "outro") {
    const pend = await buscarPendencia(userId, msg.telefone);
    if (!pend) {
      // log e responde, mas não cria gasto
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: userId,
        external_id: msg.external_id,
        telefone: msg.telefone,
        texto,
        recebida_em: msg.recebida_em ?? new Date().toISOString(),
        status: "sem_pendencia",
        resposta_sugerida:
          "Não há nenhum gasto aguardando confirmação no momento. Me envie o gasto, ex.: \"Mercado 48,90 hoje no Nubank\".",
      });
      return {
        status: "sem_pendencia",
        resposta:
          "Não há nenhum gasto aguardando confirmação no momento. Me envie o gasto, ex.: \"Mercado 48,90 hoje no Nubank\".",
      };
    }

    if (decisao === "cancel") {
      await supabaseAdmin
        .from("whatsapp_messages")
        .update({
          status: "cancelada",
          resposta_sugerida: "❌ Tudo bem, gasto cancelado.\nNada foi salvo.",
        })
        .eq("id", pend.id);
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: userId,
        external_id: msg.external_id,
        telefone: msg.telefone,
        texto,
        recebida_em: msg.recebida_em ?? new Date().toISOString(),
        status: "cancelada",
        resposta_sugerida: "Cancelado pelo usuário.",
      });
      return {
        status: "cancelada",
        resposta: "❌ Tudo bem, gasto cancelado.\nNada foi salvo.",
      };
    }

    // confirm → salva o gasto vinculado à pendência
    const cartoes = await carregarCartoes(userId);
    const result = await persistirGasto(userId, pend.parsed, cartoes);
    if (!result.ok) {
      return { status: "erro", resposta: result.resposta };
    }
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({
        status: "salva",
        gasto_id: result.gastoId,
        resposta_sugerida: result.resposta,
      })
      .eq("id", pend.id);
    await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: userId,
      external_id: msg.external_id,
      telefone: msg.telefone,
      texto,
      recebida_em: msg.recebida_em ?? new Date().toISOString(),
      status: "salva",
      gasto_id: result.gastoId,
      resposta_sugerida: result.resposta,
    });
    await supabaseAdmin
      .from("whatsapp_links")
      .update({ ultimo_uso: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("telefone", msg.telefone);
    return {
      status: "salva",
      gastoId: result.gastoId,
      resposta: result.resposta,
    };
  }

  // 2) Nova mensagem: parse e cria pendência (NUNCA salva direto)
  const cartoes = await carregarCartoes(userId);
  const parsed = parseWhatsAppExpenseMessage(texto, cartoes);

  // Regra: se já existe uma pendência ativa, NÃO sobrescreve nem salva nada.
  // Avisa o usuário para confirmar ou cancelar a anterior primeiro.
  const pendenteExistente = await buscarPendencia(userId, msg.telefone);
  if (pendenteExistente) {
    const cartaoNomeAnt = pendenteExistente.parsed.cartaoId
      ? cartoes.find((c) => c.id === pendenteExistente.parsed.cartaoId)?.nome
      : undefined;
    const resumoAnt = formatarConfirmacao(pendenteExistente.parsed, cartaoNomeAnt);
    const aviso = `⏳ Você já tem um gasto aguardando confirmação:\n\n${resumoAnt}\n\nResponda sim para salvar ou não para cancelar antes de enviar um novo gasto.`;
    await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: userId,
      external_id: msg.external_id,
      telefone: msg.telefone,
      texto,
      recebida_em: msg.recebida_em ?? new Date().toISOString(),
      status: "pendente",
      resposta_sugerida: aviso,
    });
    return { status: "pendente", resposta: aviso };
  }

  // Verifica se faltam dados essenciais.
  const faltante = detectarFaltantes(parsed, cartoes);
  if (faltante) {
    await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: userId,
      external_id: msg.external_id,
      telefone: msg.telefone,
      texto,
      recebida_em: msg.recebida_em ?? new Date().toISOString(),
      status: "pendente",
      confianca: parsed.confianca,
      parsed: parsed as unknown as Record<string, unknown>,
      resposta_sugerida: faltante,
    });
    const status: ProcessOutcome["status"] =
      !parsed.valor || parsed.valor <= 0 ? "valor_invalido" : "pendente";
    return { status, confianca: parsed.confianca, resposta: faltante };
  }

  // OK: cria pendência aguardando_confirmacao
  const cartaoNome = parsed.cartaoId
    ? cartoes.find((c) => c.id === parsed.cartaoId)?.nome
    : undefined;
  const respostaConfirm = formatarConfirmacao(parsed, cartaoNome);

  const { error: insErr } = await supabaseAdmin
    .from("whatsapp_messages")
    .insert({
      user_id: userId,
      external_id: msg.external_id,
      telefone: msg.telefone,
      texto,
      recebida_em: msg.recebida_em ?? new Date().toISOString(),
      status: "aguardando_confirmacao",
      confianca: parsed.confianca,
      parsed: parsed as unknown as Record<string, unknown>,
      resposta_sugerida: respostaConfirm,
    });
  if (insErr) {
    console.error("[whatsapp] log insert failed", insErr);
    return { status: "erro", resposta: "Tive um problema para registrar sua mensagem agora. Pode tentar de novo em instantes?" };
  }

  return {
    status: "aguardando_confirmacao",
    confianca: parsed.confianca,
    resposta: respostaConfirm,
  };
}

/**
 * Envio de resposta pelo WhatsApp (Graph API). Inativo até os secrets
 * estarem configurados.
 */
export async function sendWhatsAppReply(
  to: string,
  text: string,
): Promise<{ sent: boolean; reason?: string; status?: number }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { sent: false, reason: "not_configured" };
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
