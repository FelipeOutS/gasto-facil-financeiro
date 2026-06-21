/**
 * Helpers server-only para a integração WhatsApp.
 * NÃO importar em código de browser.
 *
 * Fluxo conversacional com sessão persistente.
 *
 * Estados de sessão (coluna `status` em whatsapp_messages):
 *   - aguardando_forma_pagamento  (já temos valor+nome, falta forma)
 *   - aguardando_cartao           (forma=credito, falta cartão)
 *   - aguardando_confirmacao      (todos os campos prontos)
 *   - salva | cancelada | sem_pendencia | pendente | expirada
 *
 * NUNCA salva gasto sem o usuário responder sim/ok/confirmar/✅.
 * NUNCA cria cartão automaticamente.
 * NUNCA descarta valor/nome/data/forma já coletados.
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

// ---------- assinatura ----------

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

export function maskTelefone(tel: string): string {
  const digits = tel.replace(/\D/g, "");
  if (digits.length <= 4) return "***";
  return `***${digits.slice(-4)}`;
}

// ---------- vínculo/consentimento ----------

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

// ---------- cartões ----------

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

function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Mascara cartão para exibição (nunca número completo). */
export function maskCartaoLabel(c: Cartao): string {
  const nome = (c.nome ?? "").trim();
  const banco = (c.banco ?? "").trim();
  // Tenta extrair 4 dígitos contíguos do nome (ex.: "Nubank 1234")
  const m = nome.match(/(\d{4})(?!.*\d{4})/);
  if (m) {
    const base = nome.replace(m[0], "").replace(/[•·\-\s]+$/, "").trim();
    return `${base || banco || "Cartão"} •••• ${m[1]}`;
  }
  if (banco && !nome.toLowerCase().includes(banco.toLowerCase())) {
    return `${nome} (${banco})`;
  }
  return nome || banco || "Cartão";
}

/**
 * Casa texto digitado com cartões do usuário.
 * Retorna { match, ambiguous } — ambiguous lista os nomes mascarados quando >1.
 */
export function matchCartao(
  input: string,
  cartoes: Cartao[],
): { match: Cartao | null; ambiguous?: string[] } {
  const t = normalizeText(input);
  if (!t || cartoes.length === 0) return { match: null };
  const digits = input.replace(/\D/g, "");
  const last4 = digits.length >= 4 ? digits.slice(-4) : null;
  const hits = new Set<string>();
  const list: Cartao[] = [];
  const push = (c: Cartao) => {
    if (!hits.has(c.id)) {
      hits.add(c.id);
      list.push(c);
    }
  };

  for (const c of cartoes) {
    const nome = normalizeText(c.nome);
    const banco = normalizeText(c.banco || "");
    if (last4) {
      const cdigits = (c.nome + " " + (c.banco ?? "")).replace(/\D/g, "");
      if (cdigits.includes(last4)) {
        push(c);
        continue;
      }
    }
    if (nome && (t === nome || t.includes(nome) || nome.includes(t))) {
      push(c);
      continue;
    }
    if (banco && (t === banco || t.includes(banco) || banco.includes(t))) {
      push(c);
      continue;
    }
    // token-level
    for (const w of nome.split(/\s+/)) {
      if (w.length >= 3 && t.split(/\s+/).includes(w)) {
        push(c);
        break;
      }
    }
  }
  if (list.length === 0) return { match: null };
  if (list.length === 1) return { match: list[0] };
  return { match: null, ambiguous: list.map((c) => maskCartaoLabel(c)) };
}

// ---------- categorias ----------

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

// ---------- tipos públicos ----------

export type ProcessOutcome = {
  status:
    | "duplicada"
    | "salva"
    | "aguardando_confirmacao"
    | "aguardando_forma_pagamento"
    | "aguardando_cartao"
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

// ---------- confirmação / cancelamento ----------

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

function detectFormaPagamentoFromText(text: string): FormaPagamento | null {
  const t = normalizeText(text);
  if (!t) return null;
  if (/\bpix\b/.test(t)) return "pix";
  if (/\b(dinheiro|especie|cash)\b/.test(t)) return "dinheiro";
  if (/\b(debito|cartao de debito|cartão de débito)\b/.test(t)) return "debito";
  if (/\b(credito|cartao de credito|cartao|cartoes|credit card)\b/.test(t)) return "credito";
  if (/\bboleto\b/.test(t)) return "boleto";
  if (/\btransfer/.test(t)) return "transferencia";
  if (/\b(vr|vale.?refei)/.test(t)) return "vale_refeicao";
  if (/\b(va|vale.?aliment)/.test(t)) return "vale_alimentacao";
  return null;
}

// ---------- formatação ----------

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const APP_TZ = "America/Sao_Paulo";

function todayLocalISO(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function formatDataBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  if (iso === todayLocalISO()) return "hoje";
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

const CATEGORIA_LABEL: Record<string, string> = {
  mercado: "Mercado",
  transporte: "Transporte",
  saude: "Saúde",
  restaurante: "Restaurante",
  internet: "Internet",
  lazer: "Lazer",
  educacao: "Educação",
  moradia: "Moradia",
  servicos: "Serviços",
  vestuario: "Vestuário",
  outros: "Outros",
};

function categoriaLabel(key: string | undefined | null): string {
  if (!key) return "Outros";
  const k = key.toLowerCase().trim();
  if (CATEGORIA_LABEL[k]) return CATEGORIA_LABEL[k];
  return k.charAt(0).toUpperCase() + k.slice(1);
}

/** Resolve a label limpa de categoria a partir do nome do gasto. */
function categoriaParaExibir(nome: string): string {
  const key = suggestCategoryFromText(nome) || "outros";
  return categoriaLabel(key);
}

export function formatarConfirmacao(parsed: ParsedExpense, cartaoNome?: string): string {
  const categoria = categoriaParaExibir(parsed.nome);
  const dataFmt = formatDataBR(parsed.data);
  const linhas = [
    "🧾 Encontrei este gasto:",
    "",
    `Descrição: ${parsed.nome}`,
    `Categoria: ${categoria}`,
    `Valor: ${formatBRL(parsed.valor)}`,
    `Data: ${dataFmt === "hoje" ? "Hoje" : dataFmt}`,
    `Pagamento: ${rotuloFormaPagamento(parsed.formaPagamento, cartaoNome)}`,
  ];
  if (parsed.parcelas && parsed.parcelas > 1) linhas.push(`Parcelas: ${parsed.parcelas}x`);
  linhas.push("");
  linhas.push("Deseja salvar esse gasto? Responda sim ou não.");
  return linhas.join("\n");
}

/** Mantido para compatibilidade com testes existentes. */
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

// ---------- sessão persistida ----------

type Session = {
  nome: string;
  valor: number;
  data: string;
  formaPagamento?: FormaPagamento;
  cartaoId?: string | null;
  cartaoNomeDetectado?: string;
  cartaoDigitado?: string;
  cartaoNaoCadastrado?: boolean;
  parcelas?: number;
  categoriaSugestao?: string;
  mensagemOriginal: string;
  confianca?: number;
};

function sessionToParsed(s: Session, cartoes: Cartao[]): ParsedExpense {
  const cartaoNome = s.cartaoId
    ? cartoes.find((c) => c.id === s.cartaoId)?.nome
    : s.cartaoNaoCadastrado
      ? (s.cartaoDigitado || "cartão não cadastrado")
      : s.cartaoNomeDetectado;
  return {
    nome: s.nome,
    valor: s.valor,
    data: s.data,
    formaPagamento: s.formaPagamento ?? "credito",
    cartaoNomeDetectado: cartaoNome,
    cartaoId: s.cartaoId ?? undefined,
    parcelas: s.parcelas,
    categoriaSugestao: s.categoriaSugestao,
    mensagemOriginal: s.mensagemOriginal,
    confianca: s.confianca ?? 0.8,
    notas: [],
  };
}

const PENDING_TTL_MS = 30 * 60 * 1000;
const PENDING_STATES = [
  "aguardando_confirmacao",
  "aguardando_forma_pagamento",
  "aguardando_cartao",
];

type SessaoRow = {
  id: string;
  status: string;
  session: Session;
  recebida_em: string;
};

async function buscarSessaoAtiva(
  userId: string,
  telefone: string,
): Promise<SessaoRow | null> {
  const desde = new Date(Date.now() - PENDING_TTL_MS).toISOString();
  const { data } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id, status, parsed, recebida_em")
    .eq("user_id", userId)
    .eq("telefone", telefone)
    .in("status", PENDING_STATES)
    .gte("recebida_em", desde)
    .order("recebida_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.parsed) return null;
  return {
    id: data.id,
    status: data.status,
    session: data.parsed as Session,
    recebida_em: data.recebida_em,
  };
}

async function fecharSessoesAnteriores(
  userId: string,
  telefone: string,
  motivo: "salva" | "cancelada" | "expirada",
  gastoId?: string,
) {
  await supabaseAdmin
    .from("whatsapp_messages")
    .update({
      status: motivo,
      gasto_id: gastoId ?? null,
    })
    .eq("user_id", userId)
    .eq("telefone", telefone)
    .in("status", PENDING_STATES);
}

function listarCartoesParaPergunta(cartoes: Cartao[]): string {
  if (cartoes.length === 0) return "";
  const linhas = cartoes.map((c) => `• ${maskCartaoLabel(c)}`);
  return `\nSeus cartões cadastrados:\n${linhas.join("\n")}`;
}

function perguntaFormaPagamento(s: Session): string {
  return `Anotei ${formatBRL(s.valor)} em ${s.nome}.\nVocê pagou com Pix, dinheiro, débito ou cartão?`;
}
function perguntaCartao(s: Session, cartoes: Cartao[]): string {
  const lista = listarCartoesParaPergunta(cartoes);
  return `Qual cartão você usou para ${s.nome} (${formatBRL(s.valor)})?${lista}`;
}
function avisoCartaoAmbiguo(nomes: string[]): string {
  return `Encontrei mais de um cartão parecido:\n${nomes.map((n) => `• ${n}`).join("\n")}\nMe diga o nome exato (ou os últimos 4 dígitos).`;
}
function avisoCartaoNaoCadastrado(s: Session, digitado: string): string {
  return `Não encontrei "${digitado}" entre os seus cartões cadastrados.\nVou registrar este gasto como cartão não cadastrado. Depois, caso queira, você poderá cadastrá-lo na área Cartões do Gasto Inteligente.\n\nConfirma o gasto de ${formatBRL(s.valor)} em ${s.nome}, ${formatDataBR(s.data) === "hoje" ? "hoje" : formatDataBR(s.data)}, pago com cartão não cadastrado? Responda sim ou não.`;
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

// ---------- persistência de gasto ----------

async function persistirGasto(
  userId: string,
  s: Session,
): Promise<{ gastoId?: string; resposta: string; ok: boolean }> {
  // Sempre derivamos a categoria a partir do nome do gasto — nunca da mensagem
  // original (evita "Mercado mercado 45,90" virar categoria/descrição).
  const categoriaKey = suggestCategoryFromText(s.nome) || "outros";
  const categoriaId = await resolveCategoriaId(userId, categoriaKey);
  const [y, m] = s.data.split("-").map(Number);

  const cartaoFinalId =
    s.formaPagamento === "credito" && s.cartaoId && !s.cartaoNaoCadastrado
      ? s.cartaoId
      : null;

  const obsExtra = s.cartaoNaoCadastrado && s.cartaoDigitado
    ? ` (cartão não cadastrado: ${s.cartaoDigitado.slice(0, 60)})`
    : "";

  const { data: gastoRow, error: gastoErr } = await supabaseAdmin
    .from("gastos")
    .insert({
      user_id: userId,
      categoria_id: categoriaId,
      descricao: s.nome,
      estabelecimento: s.nome,
      valor: s.valor,
      data: s.data,
      mes: m,
      ano: y,
      forma_pagamento: (s.formaPagamento ?? "credito") as FormaPagamento,
      cartao_id: cartaoFinalId,
      tipo_gasto: s.parcelas ? "parcelado" : "unico",
      total_parcelas: s.parcelas ?? null,
      observacao: `WhatsApp: ${s.mensagemOriginal}${obsExtra}`,
      origem: "whatsapp",
      confirmado: true,
    })
    .select("id")
    .single();

  if (gastoErr || !gastoRow) {
    console.error("[whatsapp] gasto insert failed", gastoErr);
    return { ok: false, resposta: "❌ Não consegui salvar agora. Pode tentar de novo em instantes?" };
  }

  const categoria =
    s.categoriaSugestao && s.categoriaSugestao.length < 40
      ? s.categoriaSugestao
      : suggestCategoryFromText(s.nome) ?? "Outros";
  const ondePagou = s.cartaoNaoCadastrado
    ? " (cartão não cadastrado)"
    : s.cartaoId
      ? ` no Cartão ${s.cartaoNomeDetectado ?? ""}`.replace(/\s+$/, "")
      : ` no ${rotuloFormaPagamento(s.formaPagamento ?? "credito")}`;
  const resposta = `✅ Gasto salvo com sucesso!\n${formatBRL(s.valor)} em ${categoria} foi registrado${ondePagou}.`;
  return { ok: true, gastoId: gastoRow.id, resposta };
}

// ---------- helpers de transição ----------

function buildSessionFromParse(parsed: ParsedExpense): Session {
  return {
    nome: parsed.nome,
    valor: parsed.valor,
    data: parsed.data,
    formaPagamento: undefined,
    parcelas: parsed.parcelas,
    categoriaSugestao: parsed.categoriaSugestao,
    mensagemOriginal: parsed.mensagemOriginal,
    confianca: parsed.confianca,
  };
}

function nextStateFor(s: Session): {
  status: "aguardando_forma_pagamento" | "aguardando_cartao" | "aguardando_confirmacao";
  resposta: string;
} | null {
  if (!s.valor || s.valor <= 0 || !s.nome) return null;
  if (!s.formaPagamento) {
    return { status: "aguardando_forma_pagamento", resposta: perguntaFormaPagamento(s) };
  }
  if (s.formaPagamento === "credito" && !s.cartaoId && !s.cartaoNaoCadastrado) {
    // caller deve passar lista de cartões via perguntaCartao
    return { status: "aguardando_cartao", resposta: "" };
  }
  return { status: "aguardando_confirmacao", resposta: "" };
}

async function gravarSessao(
  userId: string,
  telefone: string,
  externalId: string | null,
  texto: string,
  recebidaEm: string,
  status: string,
  session: Session,
  resposta: string,
  gastoId?: string,
) {
  await supabaseAdmin.from("whatsapp_messages").insert({
    user_id: userId,
    external_id: externalId,
    telefone,
    texto,
    recebida_em: recebidaEm,
    status,
    confianca: session.confianca ?? null,
    parsed: session as unknown as Record<string, unknown>,
    resposta_sugerida: resposta,
    gasto_id: gastoId ?? null,
  });
}

async function atualizarSessao(
  id: string,
  status: string,
  session: Session,
  resposta: string,
  gastoId?: string,
) {
  await supabaseAdmin
    .from("whatsapp_messages")
    .update({
      status,
      parsed: session as unknown as Record<string, unknown>,
      resposta_sugerida: resposta,
      gasto_id: gastoId ?? null,
    })
    .eq("id", id);
}

// ---------- pipeline principal ----------

export async function processarMensagemWhatsApp(
  msg: WhatsAppMessageRow,
): Promise<ProcessOutcome> {
  // Dedupe por external_id
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
      if (PENDING_STATES.includes(existente.status)) {
        return {
          status: "duplicada",
          resposta: "Mensagem já recebida — aguardando sua resposta.",
        };
      }
      await supabaseAdmin.from("whatsapp_messages").delete().eq("id", existente.id);
    }
  }

  const texto = (msg.texto ?? "").trim();
  if (!texto) {
    return {
      status: "erro",
      resposta:
        "Não recebi nenhum texto. Me envie o gasto, ex.: \"Mercado 48,90 hoje no Nubank\".",
    };
  }

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
  const userId = resolved.userId as string;

  const planoOk = await userPodeUsarWhatsApp(userId);
  if (!planoOk.ok) {
    return {
      status: "sem_plano",
      resposta: `Olá! ${planoOk.reason ?? "Sua assinatura não está ativa."} Ative um plano no app para usar os lançamentos pelo WhatsApp.`,
    };
  }

  const recebidaEm = msg.recebida_em ?? new Date().toISOString();
  const cartoes = await carregarCartoes(userId);
  const decisao = classificarResposta(texto);
  const sessao = await buscarSessaoAtiva(userId, msg.telefone);

  // ---- Confirmar/cancelar ----
  if (decisao !== "outro") {
    if (!sessao || sessao.status !== "aguardando_confirmacao") {
      await gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "sem_pendencia",
        sessao?.session ?? {
          nome: "",
          valor: 0,
          data: new Date().toISOString().slice(0, 10),
          mensagemOriginal: texto,
        },
        "Não há nenhum gasto aguardando confirmação no momento. Me envie o gasto, ex.: \"Mercado 48,90 hoje no Nubank\".",
      );
      return {
        status: "sem_pendencia",
        resposta:
          "Não há nenhum gasto aguardando confirmação no momento. Me envie o gasto, ex.: \"Mercado 48,90 hoje no Nubank\".",
      };
    }

    if (decisao === "cancel") {
      await fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
      await gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "cancelada",
        sessao.session,
        "Cancelado pelo usuário.",
      );
      return {
        status: "cancelada",
        resposta: "❌ Tudo bem, gasto cancelado.\nNada foi salvo.",
      };
    }

    // confirm → grava gasto
    const result = await persistirGasto(userId, sessao.session);
    if (!result.ok) return { status: "erro", resposta: result.resposta };
    await fecharSessoesAnteriores(userId, msg.telefone, "salva", result.gastoId);
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "salva",
      sessao.session,
      result.resposta,
      result.gastoId,
    );
    await supabaseAdmin
      .from("whatsapp_links")
      .update({ ultimo_uso: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("telefone", msg.telefone);
    return { status: "salva", gastoId: result.gastoId, resposta: result.resposta };
  }

  // ---- Mensagem livre ----
  // Caso A: sessão ativa esperando uma informação específica
  if (sessao && sessao.status === "aguardando_forma_pagamento") {
    const forma = detectFormaPagamentoFromText(texto);
    if (!forma) {
      const resposta = `Ainda preciso saber a forma de pagamento.\n${perguntaFormaPagamento(sessao.session)}`;
      await gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "aguardando_forma_pagamento",
        sessao.session,
        resposta,
      );
      return { status: "aguardando_forma_pagamento", resposta };
    }
    const next: Session = { ...sessao.session, formaPagamento: forma };
    if (forma === "credito") {
      const resposta = perguntaCartao(next, cartoes);
      await atualizarSessao(sessao.id, "aguardando_cartao", next, resposta);
      await gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "aguardando_cartao",
        next,
        resposta,
      );
      // fecha a sessão antiga deixando só a nova como ativa
      await supabaseAdmin
        .from("whatsapp_messages")
        .update({ status: "expirada" })
        .eq("id", sessao.id);
      return { status: "aguardando_cartao", resposta };
    }
    const resposta = formatarConfirmacao(sessionToParsed(next, cartoes));
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({ status: "expirada" })
      .eq("id", sessao.id);
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "aguardando_confirmacao",
      next,
      resposta,
    );
    return {
      status: "aguardando_confirmacao",
      confianca: next.confianca,
      resposta,
    };
  }

  if (sessao && sessao.status === "aguardando_cartao") {
    const { match, ambiguous } = matchCartao(texto, cartoes);
    if (ambiguous && ambiguous.length > 1) {
      const resposta = avisoCartaoAmbiguo(ambiguous);
      await gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "aguardando_cartao",
        sessao.session,
        resposta,
      );
      return { status: "aguardando_cartao", resposta };
    }
    if (match) {
      const next: Session = {
        ...sessao.session,
        formaPagamento: "credito",
        cartaoId: match.id,
        cartaoNomeDetectado: match.nome,
        cartaoNaoCadastrado: false,
      };
      const resposta = formatarConfirmacao(sessionToParsed(next, cartoes));
      await supabaseAdmin
        .from("whatsapp_messages")
        .update({ status: "expirada" })
        .eq("id", sessao.id);
      await gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "aguardando_confirmacao",
        next,
        resposta,
      );
      return { status: "aguardando_confirmacao", resposta };
    }
    // cartão não cadastrado
    const next: Session = {
      ...sessao.session,
      formaPagamento: "credito",
      cartaoId: null,
      cartaoDigitado: texto.slice(0, 80),
      cartaoNaoCadastrado: true,
    };
    const resposta = avisoCartaoNaoCadastrado(next, texto.trim());
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({ status: "expirada" })
      .eq("id", sessao.id);
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "aguardando_confirmacao",
      next,
      resposta,
    );
    return { status: "aguardando_confirmacao", resposta };
  }

  if (sessao && sessao.status === "aguardando_confirmacao") {
    // Mensagem nova enquanto pendência aguarda sim/não. Não reinicia, não sobrescreve.
    const cartaoNomeAnt = sessao.session.cartaoId
      ? cartoes.find((c) => c.id === sessao.session.cartaoId)?.nome
      : sessao.session.cartaoNaoCadastrado
        ? "cartão não cadastrado"
        : undefined;
    const resumoAnt = formatarConfirmacao(
      sessionToParsed(sessao.session, cartoes),
      cartaoNomeAnt,
    );
    const aviso = `⏳ Você já tem um gasto aguardando confirmação:\n\n${resumoAnt}\n\nResponda sim para salvar ou não para cancelar antes de enviar um novo gasto.`;
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "pendente",
      sessao.session,
      aviso,
    );
    return { status: "pendente", resposta: aviso };
  }

  // ---- Caso B: nenhuma sessão ativa → parse normal ----
  const parsed = parseWhatsAppExpenseMessage(texto, cartoes);
  if (!parsed.valor || parsed.valor <= 0) {
    const resposta =
      "❓ Só preciso de mais uma informação: qual foi o valor do gasto? Ex.: R$ 48,90.";
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "pendente",
      { ...buildSessionFromParse(parsed) },
      resposta,
    );
    return { status: "valor_invalido", confianca: parsed.confianca, resposta };
  }
  if (!parsed.nome || parsed.nome.length < 2) {
    const resposta =
      "❓ Só preciso de mais uma informação: o que você comprou ou pagou? Ex.: mercado, uber, farmácia.";
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "pendente",
      { ...buildSessionFromParse(parsed) },
      resposta,
    );
    return { status: "pendente", confianca: parsed.confianca, resposta };
  }

  const sess: Session = {
    nome: parsed.nome,
    valor: parsed.valor,
    data: parsed.data,
    parcelas: parsed.parcelas,
    categoriaSugestao: parsed.categoriaSugestao,
    mensagemOriginal: parsed.mensagemOriginal,
    confianca: parsed.confianca,
  };

  // Forma de pagamento foi explicitamente identificada?
  const formaExplicita =
    !parsed.notas.includes("Forma de pagamento não identificada");

  if (formaExplicita) {
    sess.formaPagamento = parsed.formaPagamento;
    if (parsed.formaPagamento === "credito") {
      if (parsed.cartaoAmbiguo && parsed.cartaoAmbiguo.nomes.length > 1) {
        const resposta = avisoCartaoAmbiguo(parsed.cartaoAmbiguo.nomes);
        await gravarSessao(
          userId,
          msg.telefone,
          msg.external_id,
          texto,
          recebidaEm,
          "aguardando_cartao",
          sess,
          resposta,
        );
        return { status: "aguardando_cartao", resposta };
      }
      if (parsed.cartaoId) {
        sess.cartaoId = parsed.cartaoId;
        sess.cartaoNomeDetectado = parsed.cartaoNomeDetectado;
      } else if (parsed.cartaoNomeDetectado) {
        // citou um cartão que não está cadastrado
        sess.cartaoDigitado = parsed.cartaoNomeDetectado;
        sess.cartaoNaoCadastrado = true;
        const resposta = avisoCartaoNaoCadastrado(sess, parsed.cartaoNomeDetectado);
        await gravarSessao(
          userId,
          msg.telefone,
          msg.external_id,
          texto,
          recebidaEm,
          "aguardando_confirmacao",
          sess,
          resposta,
        );
        return { status: "aguardando_confirmacao", confianca: sess.confianca, resposta };
      } else {
        const resposta = perguntaCartao(sess, cartoes);
        await gravarSessao(
          userId,
          msg.telefone,
          msg.external_id,
          texto,
          recebidaEm,
          "aguardando_cartao",
          sess,
          resposta,
        );
        return { status: "aguardando_cartao", resposta };
      }
    }
    const resposta = formatarConfirmacao(sessionToParsed(sess, cartoes));
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "aguardando_confirmacao",
      sess,
      resposta,
    );
    return {
      status: "aguardando_confirmacao",
      confianca: sess.confianca,
      resposta,
    };
  }

  // Forma não foi identificada → pergunta agora
  const resposta = perguntaFormaPagamento(sess);
  await gravarSessao(
    userId,
    msg.telefone,
    msg.external_id,
    texto,
    recebidaEm,
    "aguardando_forma_pagamento",
    sess,
    resposta,
  );
  return { status: "aguardando_forma_pagamento", confianca: sess.confianca, resposta };
}

// ---------- envio ----------

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
