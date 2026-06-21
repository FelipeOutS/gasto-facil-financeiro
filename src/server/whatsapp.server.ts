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
  cleanDescricao,
  type ParsedExpense,
} from "@/lib/whatsappParser";
import { suggestCategoryFromText } from "@/lib/categories";
import type { Cartao, FormaPagamento } from "@/lib/types";
import { canUseWhatsApp } from "./whatsapp-beta.server";
import { whatsappMessages as M } from "./whatsapp-messages";
import {
  RECEITA_PENDING_STATES,
  isReceitaIntent,
  isReceitaSession,
  startReceitaFromText,
  nextStepReceita,
  persistirReceita,
  buildConfirmacao as buildReceitaConfirmacao,
  type ReceitaSession,
  type ReceitaStatus,
} from "./whatsapp-receitas.server";
import {
  detectConsultaIntent,
  handleConsulta,
  detectConversationalIntent,
  handleConversational,
} from "./whatsapp-consultas.server";


// ---------- elegibilidade WhatsApp (gate único) ----------
// Admin Master OU participante ativo da beta fechada (whatsapp_beta_access).
// Esta é a única fonte de verdade usada no webhook e nas server functions.
async function userPodeUsarWhatsApp(userId: string): Promise<{ ok: boolean; reason?: string }> {
  const ok = await canUseWhatsApp(userId);
  if (!ok) {
    return {
      ok: false,
      reason:
        "Seu acesso ao WhatsApp ainda não está disponível — o recurso está em beta fechada.",
    };
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

/** Capitalização canônica de marcas conhecidas — usada quando o cadastro foi
 *  salvo com caixa inconsistente (ex.: "Mercado pago" → "Mercado Pago"). */
const CANONICAL_BRAND: Record<string, string> = {
  "nubank": "Nubank",
  "itau": "Itaú",
  "itaú": "Itaú",
  "santander": "Santander",
  "mercado pago": "Mercado Pago",
  "mercadopago": "Mercado Pago",
  "inter": "Inter",
  "c6": "C6",
  "c6 bank": "C6 Bank",
  "bradesco": "Bradesco",
  "banco do brasil": "Banco do Brasil",
  "bb": "Banco do Brasil",
  "caixa": "Caixa",
  "picpay": "PicPay",
  "next": "Next",
  "neon": "Neon",
  "will": "Will",
  "will bank": "Will Bank",
  "pan": "Pan",
  "original": "Original",
  "btg": "BTG",
  "xp": "XP",
  "porto": "Porto",
  "safra": "Safra",
};

function canonicalizeBrand(nome: string | null | undefined): string {
  const raw = (nome ?? "").trim();
  if (!raw) return raw;
  const key = raw.toLowerCase();
  if (CANONICAL_BRAND[key]) return CANONICAL_BRAND[key];
  return raw;
}

/** Nome a ser exibido para um cartão cadastrado, preservando a capitalização
 *  do cadastro — apenas corrige marcas conhecidas salvas em caixa errada. */
export function displayCartaoNome(c: Cartao): string {
  return canonicalizeBrand(c.nome);
}

/** Mascara cartão para exibição (nunca número completo). */
export function maskCartaoLabel(c: Cartao): string {
  const nome = displayCartaoNome(c);
  const banco = canonicalizeBrand(c.banco ?? "");
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

type CategoriaRow = { id: string; legacy_id: string | null; nome: string };

async function carregarCategorias(userId: string): Promise<CategoriaRow[]> {
  const { data } = await supabaseAdmin
    .from("categorias")
    .select("id, legacy_id, nome")
    .eq("user_id", userId);
  if (!data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((c: any) => ({
    id: c.id,
    legacy_id: c.legacy_id ?? null,
    nome: c.nome ?? "",
  }));
}

function normalizeCat(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    // tolera plurais simples (refeicoes <-> refeicao)
    .replace(/oes$/, "ao")
    .replace(/s$/, "");
}

/** Termos na descrição que indicam alimentação humana / refeição. */
const ALIMENTACAO_KEYWORDS = [
  "padaria", "padoca", "pao", "lanche", "lanchonete",
  "restaurante", "cafe", "refeicao", "comida",
];

/** Nomes canônicos aceitos como "categoria de alimentação" do usuário. */
const ALIMENTACAO_CATEGORY_NAMES = [
  "alimentacao", "comida", "refeicao", "alimentos",
];

/** Encontra a categoria do usuário cujo nome normalizado bate com algum dos
 *  nomes aceitos. Compara também legacy_id. Preserva o nome oficial salvo. */
function findCategoriaByNames(
  categorias: CategoriaRow[],
  acceptedNames: string[],
): CategoriaRow | null {
  const accepted = new Set(acceptedNames.map(normalizeCat));
  for (const c of categorias) {
    if (c.legacy_id && accepted.has(normalizeCat(c.legacy_id))) return c;
    if (c.nome && accepted.has(normalizeCat(c.nome))) return c;
  }
  return null;
}

function categoriaExiste(categorias: CategoriaRow[], key: string): boolean {
  const k = normalizeCat(key);
  return categorias.some(
    (c) => normalizeCat(c.legacy_id ?? "") === k || normalizeCat(c.nome ?? "") === k,
  );
}

/** Diagnóstico interno (Admin Master): qual categoria o WhatsApp escolheria
 *  para uma descrição como "padaria". Nunca expõe IDs. */
export function diagnoseCategoriaResolution(
  nome: string,
  categorias: CategoriaRow[],
): {
  categoria_alimentacao_disponivel: "sim" | "nao";
  categoria_resolvida: "alimentacao" | "fallback_mercado" | "outra";
} {
  const ali = findCategoriaByNames(categorias, ALIMENTACAO_CATEGORY_NAMES);
  const key = pickCategoriaKey(nome, categorias);
  let resolvida: "alimentacao" | "fallback_mercado" | "outra";
  if (ali && key === "alimentacao") resolvida = "alimentacao";
  else if (key === "mercado") resolvida = "fallback_mercado";
  else resolvida = "outra";
  return {
    categoria_alimentacao_disponivel: ali ? "sim" : "nao",
    categoria_resolvida: resolvida,
  };
}

/**
 * Escolhe a categoria preferida considerando as categorias ativas do usuário.
 * Termos de alimentação (padaria, lanche, restaurante, café, refeição…)
 * preferem uma categoria compatível com "Alimentação" se o usuário a tiver.
 * Caso contrário, cai no sugerido por keyword (geralmente "mercado").
 */
function pickCategoriaKey(nome: string, categorias: CategoriaRow[]): string {
  const sugerido = suggestCategoryFromText(nome) || "outros";
  const norm = normalizeCat(nome);
  const hasAlimentacaoKeyword = ALIMENTACAO_KEYWORDS.some((kw) =>
    new RegExp(`\\b${kw}\\b`).test(norm),
  );
  if (hasAlimentacaoKeyword) {
    const ali = findCategoriaByNames(categorias, ALIMENTACAO_CATEGORY_NAMES);
    if (ali) return "alimentacao";
  }
  return sugerido;
}

function resolveCategoriaIdFromList(
  categorias: CategoriaRow[],
  categoriaKey: string,
): string | null {
  if (categorias.length === 0) return null;
  // "alimentacao" pode ser representada por nomes equivalentes do usuário.
  if (categoriaKey === "alimentacao") {
    const ali = findCategoriaByNames(categorias, ALIMENTACAO_CATEGORY_NAMES);
    if (ali) return ali.id;
  }
  const byLegacy = categorias.find((c) => c.legacy_id === categoriaKey);
  if (byLegacy) return byLegacy.id;
  const k = normalizeCat(categoriaKey);
  const byName = categorias.find((c) => normalizeCat(c.nome ?? "") === k);
  if (byName) return byName.id;
  const outros = categorias.find((c) => c.legacy_id === "outros") ?? categorias[0];
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
    | "gasto_excluido"
    | "consulta";
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
  alimentacao: "Alimentação",
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
function categoriaParaExibir(nome: string, categorias?: CategoriaRow[]): string {
  const key = categorias && categorias.length
    ? pickCategoriaKey(nome, categorias)
    : (suggestCategoryFromText(nome) || "outros");
  // Preserva o nome oficial salvo pelo usuário quando aplicável.
  if (categorias && categorias.length) {
    if (key === "alimentacao") {
      const ali = findCategoriaByNames(categorias, ALIMENTACAO_CATEGORY_NAMES);
      if (ali && ali.nome) return ali.nome;
    } else {
      const byLegacy = categorias.find((c) => c.legacy_id === key);
      if (byLegacy && byLegacy.nome) return byLegacy.nome;
    }
  }
  return categoriaLabel(key);
}


export function formatarConfirmacao(
  parsed: ParsedExpense,
  cartaoNome?: string,
  categorias?: CategoriaRow[],
): string {
  const cartao = canonicalizeBrand(cartaoNome ?? parsed.cartaoNomeDetectado ?? "");
  const descricao = cleanDescricao(parsed.nome) || parsed.nome;
  const categoria = categoriaParaExibir(descricao, categorias);
  const dataFmt = formatDataBR(parsed.data);
  return M.resumoConfirmacao({
    descricao,
    categoria,
    valor: formatBRL(parsed.valor),
    data: dataFmt === "hoje" ? "Hoje" : dataFmt,
    pagamento: rotuloFormaPagamento(parsed.formaPagamento, cartao || undefined),
    parcelas: parsed.parcelas,
  });
}

/**
 * Normaliza texto para comparação de comandos genéricos:
 * remove acentos, baixa caixa, colapsa espaços, remove pontuação final.
 */
function normalizeCmd(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "")
    .trim();
}

/**
 * Comandos/descrições genéricos que NÃO podem virar descrição de gasto.
 * Inclui tanto frases-comando ("registrar gasto") quanto descrições
 * automáticas inválidas ("Gasto WhatsApp"). Comparação após normalizeCmd.
 */
const GENERIC_EXPENSE_TERMS: ReadonlySet<string> = new Set([
  "gasto",
  "gastos",
  "despesa",
  "despesas",
  "lancamento",
  "lancamentos",
  "registrar gasto",
  "registrar um gasto",
  "registrar despesa",
  "registrar uma despesa",
  "novo gasto",
  "nova despesa",
  "adicionar gasto",
  "adicionar um gasto",
  "adicionar despesa",
  "lancar gasto",
  "lancar um gasto",
  "lancar despesa",
  "quero registrar um gasto",
  "quero registrar gasto",
  "quero lancar um gasto",
  "quero lancar gasto",
  "quero adicionar um gasto",
  "quero adicionar gasto",
  "gasto whatsapp",
  "despesa whatsapp",
]);

export function isGenericExpenseCommand(texto: string): boolean {
  if (!texto) return false;
  return GENERIC_EXPENSE_TERMS.has(normalizeCmd(texto));
}

/**
 * Comandos de reinício geral da conversa.
 * Encerram qualquer sessão pendente e devolvem o usuário ao estado inicial.
 * Comparação após `normalizeCmd` (sem acento, minúsculas, sem pontuação final).
 *
 * IMPORTANTE: "não", "n", "errado" etc. NÃO são reset — são respostas de
 * confirmação. Por isso este conjunto é separado de `CANCEL_TOKENS`.
 */
const RESET_COMMANDS: ReadonlySet<string> = new Set([
  "cancelar",
  "cancela",
  "cancelar tudo",
  "reiniciar",
  "reinicia",
  "recomecar",
  "recomeca",
  "comecar de novo",
  "comeca de novo",
  "voltar ao inicio",
  "voltar pro inicio",
  "voltar para o inicio",
]);

export function isResetCommand(texto: string): boolean {
  if (!texto) return false;
  return RESET_COMMANDS.has(normalizeCmd(texto));
}


/**
 * Bloqueia que descrições genéricas (vindas do parser ou de uma sessão)
 * sejam usadas como nome real do gasto. Ex.: "registrar gasto",
 * "Gasto WhatsApp", "Novo Gasto" — todas inválidas.
 */
export function isGenericExpenseDescription(nome: string | undefined | null): boolean {
  if (!nome) return true;
  const n = normalizeCmd(nome);
  if (!n) return true;
  return GENERIC_EXPENSE_TERMS.has(n);
}

/** Mantido para compatibilidade com testes existentes. */
export function detectarFaltantes(
  parsed: ParsedExpense,
  cartoes: Cartao[],
): string | null {
  const valorAusente = !parsed.valor || parsed.valor <= 0;
  const nomeAusente =
    !parsed.nome ||
    parsed.nome.length < 2 ||
    isGenericExpenseDescription(parsed.nome);
  if (valorAusente && nomeAusente) {
    return M.faltaDescricaoEValor();
  }
  if (valorAusente) {
    return M.faltaValor(parsed.nome);
  }
  if (nomeAusente) {
    return M.faltaNome();
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
      return M.cartaoNaoEncontradoNoParse(parsed.cartaoNomeDetectado, lista);
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
  /** Marcador explícito: distingue sessões de gasto das de receita.
   *  Persistido em whatsapp_messages.parsed quando criamos uma sessão
   *  vazia de gasto (status=aguardando_descricao_e_valor_gasto). */
  kind?: "gasto";
};

function sessionToParsed(s: Session, cartoes: Cartao[]): ParsedExpense {
  const cartaoCadastrado = s.cartaoId
    ? cartoes.find((c) => c.id === s.cartaoId)
    : undefined;
  const cartaoNome = cartaoCadastrado
    ? displayCartaoNome(cartaoCadastrado)
    : s.cartaoNaoCadastrado
      ? (s.cartaoDigitado || "cartão não cadastrado")
      : canonicalizeBrand(s.cartaoNomeDetectado ?? "");
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
  // WA — sessão de gasto criada por comando genérico ("registrar gasto"),
  // ainda sem descrição e/ou valor. Precisa ficar persistida para que a
  // próxima mensagem (incluindo "oi", "ajuda", "menu") não interrompa o
  // fluxo nem dispare saudação / consulta / nova intenção.
  "aguardando_descricao_e_valor_gasto",
  ...RECEITA_PENDING_STATES,
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
  return `\n${linhas.join("\n")}`;
}

function perguntaFormaPagamento(s: Session): string {
  return M.perguntaFormaPagamento(formatBRL(s.valor), s.nome);
}
function perguntaCartao(s: Session, cartoes: Cartao[]): string {
  const lista = listarCartoesParaPergunta(cartoes);
  return M.perguntaCartao(lista);
}
function avisoCartaoAmbiguo(nomes: string[]): string {
  return M.avisoCartaoAmbiguo(nomes);
}
const NEGACAO_CARTAO_PATTERNS = [
  /\bnenhum desses\b/,
  /\bnenhum deles\b/,
  /\bnenhum\b/,
  /\bnao tenho\b/,
  /\bnão tenho\b/,
  /\boutro cart[aã]o\b/,
  /\boutro\b/,
];

function isNegacaoCartao(texto: string): boolean {
  const t = normalizeText(texto);
  return NEGACAO_CARTAO_PATTERNS.some((re) => re.test(t));
}

function avisoCartaoNaoCadastrado(s: Session, digitado: string): string {
  const dataFmt = formatDataBR(s.data);
  return M.avisoCartaoNaoCadastrado(
    digitado,
    formatBRL(s.valor),
    s.nome,
    dataFmt === "hoje" ? "hoje" : dataFmt,
  );
}

function avisoCartaoNaoCadastradoNegado(s: Session): string {
  const dataFmt = formatDataBR(s.data);
  return M.avisoCartaoNaoCadastradoNegado(
    formatBRL(s.valor),
    s.nome,
    dataFmt === "hoje" ? "hoje" : dataFmt,
  );
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
  const categorias = await carregarCategorias(userId);
  const nomeLimpo = cleanDescricao(s.nome) || s.nome;
  // Salvaguarda final: nunca persistir despesa com descrição genérica
  // (ex.: "Gasto WhatsApp", "registrar gasto"). Bloqueia também o caso
  // em que cleanDescricao normalize um texto-comando.
  if (isGenericExpenseDescription(nomeLimpo)) {
    return { ok: false, resposta: M.faltaNome() };
  }
  const categoriaKey = pickCategoriaKey(nomeLimpo, categorias);
  const categoriaId = resolveCategoriaIdFromList(categorias, categoriaKey);

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
      descricao: nomeLimpo,
      estabelecimento: nomeLimpo,
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
    return { ok: false, resposta: M.erroAoSalvar() };
  }

  const categoria = categoriaLabel(categoriaKey);
  const ondePagou = s.cartaoNaoCadastrado
    ? "cartão não cadastrado"
    : s.cartaoId
      ? `Cartão ${canonicalizeBrand(s.cartaoNomeDetectado ?? "")}`.replace(/\s+$/, "")
      : rotuloFormaPagamento(s.formaPagamento ?? "credito");
  const resposta = M.gastoSalvo(formatBRL(s.valor), nomeLimpo, categoria, ondePagou);
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

// ---------- pipeline de receitas (Fase WA-G1) ----------

async function processarReceita(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  decisao: "confirm" | "cancel" | "outro";
  sessao: SessaoRow | null;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, decisao, sessao } = args;
  const currentStatus = (sessao?.status ?? "") as ReceitaStatus | "";
  // "cancelar" explícito encerra a sessão em qualquer etapa.
  // Já o "não" (decisao=cancel) só é tratado como cancelamento global em
  // estados que não fazem perguntas sim/não — caso contrário ele é uma
  // resposta válida (ex.: "Esse valor costuma entrar de forma recorrente?").
  const hardCancelRe = /\b(cancelar|cancela|cancelado|cancelada)\b/i;
  const isHardCancel = hardCancelRe.test(texto);
  const cancelStatesGlobais: ReceitaStatus[] = [
    "rec_aguardando_tipo",
    "rec_aguardando_valor",
    "rec_aguardando_frequencia",
    "rec_aguardando_dia",
    "rec_aguardando_categoria",
    "rec_aguardando_confirmacao",
  ];
  const shouldHardCancel =
    !!sessao &&
    (isHardCancel ||
      (decisao === "cancel" &&
        cancelStatesGlobais.includes(currentStatus as ReceitaStatus)));

  if (shouldHardCancel && sessao) {
    await fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "cancelada",
      sessao.session as unknown as Session,
      M.receita.cancelado(),
    );
    return { status: "cancelada", resposta: M.receita.cancelado() };
  }

  // Sem sessão: iniciar fluxo a partir do texto livre.
  if (!sessao) {
    const step = startReceitaFromText(texto);
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      step.status,
      step.session as unknown as Session,
      step.resposta,
    );
    return { status: "pendente", resposta: step.resposta };
  }

  const current = sessao.status as ReceitaStatus;
  const session = sessao.session as unknown as ReceitaSession;

  // Confirmação final: persiste.
  if (current === "rec_aguardando_confirmacao") {
    if (decisao === "confirm") {
      const result = await persistirReceita(userId, session);
      if (!result.ok) {
        // mantém sessão para o usuário tentar de novo
        await gravarSessao(
          userId,
          msg.telefone,
          msg.external_id,
          texto,
          recebidaEm,
          "rec_aguardando_confirmacao",
          session as unknown as Session,
          result.resposta,
        );
        return { status: "erro", resposta: result.resposta };
      }
      await fecharSessoesAnteriores(userId, msg.telefone, "salva");
      // Persistência da receita gera marcadores explícitos em `parsed`
      // (kind/status/receita_id/recorrencia_id) — usados pelo dedup por
      // external_message_id no reenvio do mesmo webhook pela Meta.
      const sessionSalva = {
        ...session,
        status: "salva",
        receita_id: result.receitaId,
        ...(result.recorrenciaId ? { recorrencia_id: result.recorrenciaId } : {}),
      } as unknown as Session;
      await gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "salva",
        sessionSalva,
        result.resposta,
      );
      return { status: "salva", resposta: result.resposta };
    }
    // resposta inválida na confirmação
    const aviso = M.receita.naoEntendiSimNao();
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "pendente",
      session as unknown as Session,
      aviso,
    );
    return { status: "pendente", resposta: aviso };
  }

  // Demais etapas: delegar ao state machine.
  const step = nextStepReceita(current, session, texto, decisao);
  // marca sessão antiga como expirada e cria nova com novo status
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
    step.status,
    step.session as unknown as Session,
    step.resposta,
  );
  // Reconfirma o resumo no estado de confirmação para garantir consistência.
  if (step.status === "rec_aguardando_confirmacao") {
    return { status: "aguardando_confirmacao", resposta: buildReceitaConfirmacao(step.session) };
  }
  return { status: "pendente", resposta: step.resposta };
}

// ---------- pipeline principal ----------


export async function processarMensagemWhatsApp(
  msg: WhatsAppMessageRow,
): Promise<ProcessOutcome> {
  // Dedupe por external_id
  if (msg.external_id) {
    const { data: existente } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, gasto_id, status, parsed")
      .eq("external_id", msg.external_id)
      .maybeSingle();
    if (existente) {
      const gastoAindaExiste = await verificarGastoExiste(existente.gasto_id);
      // Receitas salvas via WhatsApp registram marcadores explícitos
      // em `parsed` (kind=receita + status=salva + receita_id/recorrencia_id).
      // O dedup consulta esses campos explícitos — nunca infere por
      // ausência de gasto_id.
      const parsed = (existente.parsed ?? {}) as {
        kind?: string;
        status?: string;
        receita_id?: string;
        recorrencia_id?: string;
      };
      const receitaSalva =
        existente.status === "salva" &&
        parsed.kind === "receita" &&
        parsed.status === "salva" &&
        (typeof parsed.receita_id === "string" || typeof parsed.recorrencia_id === "string");
      if ((existente.status === "salva" && gastoAindaExiste) || receitaSalva) {
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
  const categorias = await carregarCategorias(userId);
  const decisao = classificarResposta(texto);
  const sessao = await buscarSessaoAtiva(userId, msg.telefone);

  // ---- WA: comando de reinício geral ("cancelar", "reiniciar", ...) ----
  // Prioridade máxima: encerra qualquer sessão pendente (gasto, receita,
  // confirmação, cartão, descrição/valor) e devolve o usuário ao estado
  // inicial limpo. Não toca em lançamentos já confirmados nem em vínculo,
  // consentimento, retenção ou histórico — apenas estados aguardando_*.
  if (isResetCommand(texto)) {
    if (sessao) {
      await fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    }
    const resposta = M.resetConversa();
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "cancelada",
      {
        nome: "",
        valor: 0,
        data: todayLocalISO(),
        mensagemOriginal: texto,
      },
      resposta,
    );
    return { status: "cancelada", resposta };
  }


  // ---- Fase WA-G1: sessão de receita pendente sempre tem prioridade. ----
  const sessionIsReceita = sessao && isReceitaSession(sessao.session);
  if (sessionIsReceita) {
    return await processarReceita({
      userId, msg, texto, recebidaEm, decisao, sessao,
    });
  }

  // ---- WA: sessão de gasto aguardando descrição e/ou valor ----
  // Prioridade sobre saudação, menu, ajuda, consulta ou nova intenção.
  // Mantém o fluxo de despesa em andamento — "oi"/"ajuda"/"menu" apenas
  // lembram o usuário do que falta. Só "cancelar" encerra a sessão.
  if (sessao && sessao.status === "aguardando_descricao_e_valor_gasto") {
    const prev = sessao.session;
    const hardCancelRe = /\b(cancelar|cancela|cancelado|cancelada)\b/i;
    if (hardCancelRe.test(texto) || decisao === "cancel") {
      await fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
      await gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "cancelada", prev, M.gastoCancelado(),
      );
      return { status: "cancelada", resposta: M.gastoCancelado() };
    }
    // Saudação, menu, ajuda, finanças genérico → relembrar sem perder sessão.
    if (decisao === "outro" && detectConversationalIntent(texto)) {
      const resposta = M.aguardandoGastoEValor();
      await atualizarSessao(
        sessao.id, "aguardando_descricao_e_valor_gasto", prev, resposta,
      );
      return { status: "pendente", resposta };
    }
    // Tenta extrair descrição/valor da nova mensagem e mescla com a sessão.
    const parsedNovo = parseWhatsAppExpenseMessage(texto, cartoes);
    if (isGenericExpenseDescription(parsedNovo.nome)) parsedNovo.nome = "";
    const mergedNome =
      parsedNovo.nome && parsedNovo.nome.length >= 2 ? parsedNovo.nome : (prev.nome ?? "");
    const mergedValor =
      parsedNovo.valor && parsedNovo.valor > 0 ? parsedNovo.valor : (prev.valor ?? 0);
    const valorAusente = !mergedValor || mergedValor <= 0;
    const nomeAusente =
      !mergedNome ||
      mergedNome.length < 2 ||
      isGenericExpenseDescription(mergedNome);

    if (valorAusente && nomeAusente) {
      const resposta = M.aguardandoGastoEValor();
      await atualizarSessao(
        sessao.id, "aguardando_descricao_e_valor_gasto", prev, resposta,
      );
      return { status: "pendente", resposta };
    }
    if (valorAusente) {
      const next: Session = {
        ...prev,
        nome: mergedNome,
        mensagemOriginal: texto,
        kind: "gasto",
      };
      const resposta = M.faltaValor(mergedNome);
      await atualizarSessao(
        sessao.id, "aguardando_descricao_e_valor_gasto", next, resposta,
      );
      return { status: "valor_invalido", resposta };
    }
    if (nomeAusente) {
      const next: Session = {
        ...prev,
        valor: mergedValor,
        data: parsedNovo.data || prev.data,
        mensagemOriginal: texto,
        kind: "gasto",
      };
      const resposta = M.faltaNome();
      await atualizarSessao(
        sessao.id, "aguardando_descricao_e_valor_gasto", next, resposta,
      );
      return { status: "pendente", resposta };
    }
    // Ambos presentes → avança para forma de pagamento. Não tentamos extrair
    // forma/cartão automaticamente aqui (caminho conservador): se o usuário
    // mandou "Uber 48,90 pix", vamos perguntar a forma — comportamento
    // alinhado ao spec ("segue o lançamento" = forma_pagamento).
    const next: Session = {
      nome: mergedNome,
      valor: mergedValor,
      data: parsedNovo.data,
      parcelas: parsedNovo.parcelas,
      categoriaSugestao: parsedNovo.categoriaSugestao,
      mensagemOriginal: texto,
      confianca: parsedNovo.confianca,
    };
    const resposta = perguntaFormaPagamento(next);
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({ status: "expirada" })
      .eq("id", sessao.id);
    await gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "aguardando_forma_pagamento", next, resposta,
    );
    return {
      status: "aguardando_forma_pagamento",
      confianca: next.confianca,
      resposta,
    };
  }


  // ---- Fase WA-G3: intenções conversacionais (saudação, menu, finanças genérico) ----
  // Tem precedência sobre consultas reais e sobre parsing de gasto/receita.
  // Só roda quando NÃO há sessão pendente e não é uma resposta sim/não/forma.
  if (!sessao && decisao === "outro") {
    const conv = detectConversationalIntent(texto);
    if (conv) {
      const out = handleConversational(msg.telefone, conv);
      await gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "sem_pendencia",
        {
          nome: "",
          valor: 0,
          data: todayLocalISO(),
          mensagemOriginal: texto,
        },
        out.resposta,
      );
      return { status: "consulta", resposta: out.resposta };
    }
  }

  // ---- Fase WA-G3: "cancelar" sem sessão pendente → mensagem neutra. ----
  if (!sessao && decisao === "cancel") {
    const resposta = M.consulta.cancelarSemPendencia();
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "sem_pendencia",
      {
        nome: "",
        valor: 0,
        data: todayLocalISO(),
        mensagemOriginal: texto,
      },
      resposta,
    );
    return { status: "sem_pendencia", resposta };
  }

  // ---- Fase WA-G2: consultas financeiras ----
  // Roda ANTES da detecção de receita livre porque frases como "quanto meus
  // gastos afetam minha renda" contêm a palavra "renda" mas são consulta.
  // Só dispara quando NÃO há sessão pendente e a mensagem não é uma resposta
  // sim/não/forma de pagamento. Curtas como "sim"/"pix" continuam roteadas
  // para o pendente quando houver.
  if (!sessao && decisao === "outro") {
    const intent = detectConsultaIntent(texto);
    if (intent) {
      const out = await handleConsulta(userId, intent);
      await gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "sem_pendencia",
        {
          nome: "",
          valor: 0,
          data: todayLocalISO(),
          mensagemOriginal: texto,
        },
        out.resposta,
      );
      return { status: "consulta", resposta: out.resposta };
    }
  }


  // ---- Fase WA-G1: texto livre indicando intenção de receita. ----
  const startsReceita = !sessao && decisao === "outro" && isReceitaIntent(texto);
  if (startsReceita) {
    return await processarReceita({
      userId, msg, texto, recebidaEm, decisao, sessao: null,
    });
  }






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
        M.semPendencia(),
      );
      return {
        status: "sem_pendencia",
        resposta: M.semPendencia(),
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
        resposta: M.gastoCancelado(),
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
      const resposta = M.faltaForma(perguntaFormaPagamento(sessao.session));
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
    const resposta = formatarConfirmacao(sessionToParsed(next, cartoes), undefined, categorias);
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
        cartaoNomeDetectado: displayCartaoNome(match),
        cartaoNaoCadastrado: false,
      };
      const resposta = formatarConfirmacao(sessionToParsed(next, cartoes), undefined, categorias);
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
    const negado = isNegacaoCartao(texto);
    const next: Session = {
      ...sessao.session,
      formaPagamento: "credito",
      cartaoId: null,
      cartaoDigitado: negado ? undefined : texto.slice(0, 80),
      cartaoNaoCadastrado: true,
    };
    const resposta = negado
      ? avisoCartaoNaoCadastradoNegado(next)
      : avisoCartaoNaoCadastrado(next, texto.trim());
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
    // Resposta inválida (ex.: "sin") enquanto aguardamos sim/não.
    // Não repetimos o resumo nem reiniciamos a sessão — apenas pedimos
    // uma resposta válida. A sessão original permanece intacta.
    const aviso = M.naoEntendiSimNao();
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
  // Comandos genéricos ("registrar gasto", "novo gasto", ...) e descrições
  // automáticas inválidas ("Gasto WhatsApp") NUNCA podem virar descrição
  // real. Limpamos o nome antes de seguir, para que a sessão pendente
  // gravada não retenha o texto-comando como descrição.
  const nomeEhGenerico = isGenericExpenseDescription(parsed.nome);
  if (nomeEhGenerico) {
    parsed.nome = "";
  }
  const valorAusente = !parsed.valor || parsed.valor <= 0;
  const nomeAusente = !parsed.nome || parsed.nome.length < 2;
  if (valorAusente || nomeAusente) {
    let resposta: string;
    let status: ProcessOutcome["status"];
    if (valorAusente && nomeAusente) {
      resposta = M.faltaDescricaoEValor();
      status = "pendente";
    } else if (valorAusente) {
      resposta = M.faltaValor(parsed.nome);
      status = "valor_invalido";
    } else {
      resposta = M.faltaNome();
      status = "pendente";
    }
    // Persistir como sessão de gasto pendente (kind=gasto) para que a
    // próxima mensagem do usuário — inclusive "oi", "ajuda", "menu" —
    // continue dentro do mesmo fluxo de despesa e não dispare saudação,
    // menu ou consulta. Vide handler de "aguardando_descricao_e_valor_gasto".
    const sessaoPendente: Session = {
      ...buildSessionFromParse(parsed),
      kind: "gasto",
    };
    await gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "aguardando_descricao_e_valor_gasto",
      sessaoPendente,
      resposta,
    );
    return { status, confianca: parsed.confianca, resposta };
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
    const resposta = formatarConfirmacao(sessionToParsed(sess, cartoes), undefined, categorias);
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
