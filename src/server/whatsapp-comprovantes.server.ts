/**
 * Fase WA-G5A — Leitura de comprovantes pelo WhatsApp.
 *
 * Reaproveita integralmente o leitor de comprovantes do site
 * (`src/server/ocr-comprovante.server.ts`, originalmente
 * `src/routes/api/ocr-gasto.ts`) — não introduz uma segunda solução
 * de OCR.
 *
 * Privacidade:
 *  - Imagem é enviada APENAS ao gateway de IA do Lovable.
 *  - A imagem bruta NUNCA é persistida; só metadados mínimos
 *    (hash sha256, mime_type) ficam em whatsapp_messages.parsed
 *    para auditoria e deduplicação.
 *  - Nenhuma URL pública é exposta.
 *
 * Nunca cria gasto automaticamente — sempre passa por confirmação.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import { runExtractor, type OcrResult } from "@/server/ocr-comprovante.server";
import { whatsappMessages as M } from "./whatsapp-messages";
import { createHash } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin = _supabaseAdmin as any;

// ----- estados -----------------------------------------------------------
export const COMPROVANTE_PENDING_STATES = [
  "img_aguardando_confirmacao",
  "img_aguardando_valor",
  "img_aguardando_descricao",
  "img_aguardando_pagamento",
  "img_aguardando_ajuste",
  "img_aguardando_data_confirmacao",
  "img_aguardando_categoria_obrigatoria",
] as const;
export type ComprovanteStatus = (typeof COMPROVANTE_PENDING_STATES)[number];

const APP_TZ = "America/Sao_Paulo";

// ----- tipos públicos ----------------------------------------------------
export type ComprovanteSession = {
  kind: "imagem_comprovante";
  descricao?: string;
  valor?: number;
  data?: string; // YYYY-MM-DD
  categoriaSugerida?: string | null; // chave do OCR
  categoriaLabel?: string | null; // nome resolvido do usuário (display)
  categoriaId?: string | null;
  categoriaNaoIdentificada?: boolean;
  formaPagamento?: string | null;
  confianca?: "alta" | "media" | "baixa";
  dataConfirmada?: boolean;
  /** Marca quando a data lida do OCR é incerta (confiança baixa). Nesses
   *  casos a data não é apresentada como certeza e o usuário precisa
   *  confirmar antes de salvar. */
  dataIncerta?: boolean;
  imageSha256?: string;
  imageMimeType?: string;
  pendingField?: "valor" | "descricao" | "categoria" | "data" | "pagamento";
  mensagemOriginal: string;
};

export function isComprovanteSession(s: unknown): s is ComprovanteSession {
  return !!s && typeof s === "object" && (s as { kind?: string }).kind === "imagem_comprovante";
}

export type ImageAttachment = {
  /** Data URL completa "data:image/...;base64,..." */
  base64: string;
  mimeType?: string;
  sha256?: string;
};

export type ComprovanteResult = {
  status:
    | "duplicada"
    | "sessao_em_andamento"
    | "aguardando_confirmacao"
    | "aguardando_pagamento"
    | "aguardando_valor"
    | "aguardando_descricao"
    | "aguardando_ajuste"
    | "aguardando_data_confirmacao"
    | "aguardando_categoria_obrigatoria"
    | "ilegivel"
    | "nao_elegivel"
    | "salva"
    | "cancelada"
    | "erro";
  resposta: string;
  session?: ComprovanteSession;
  newStatus?: ComprovanteStatus | "salva" | "cancelada";
  gastoId?: string;
};

// ----- helpers locais ----------------------------------------------------
function todayLocalISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function ontemLocalISO(): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDataBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  if (iso === todayLocalISO()) return "Hoje";
  if (iso === ontemLocalISO()) return "Ontem";
  return `${d}/${m}/${y}`;
}

function normalize(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Capitaliza descrição vinda em CAIXA ALTA do OCR (ex.: "EXPEDITO ALVES DE
// LIMA ME" → "Expedito Alves de Lima ME"). Só atua quando o texto está
// majoritariamente em maiúsculas; preservações de sigla comuns (ME, EPP,
// LTDA, SA) ficam em caixa alta. NUNCA inventa palavras.
const PRESERVAR_SIGLA = new Set([
  "ME", "EPP", "LTDA", "SA", "S/A", "S.A", "S.A.",
  "CNPJ", "CPF", "RJ", "SP", "MG", "RS", "DF", "PR", "SC", "BA",
  "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII",
]);
const MINUSCULA_CONJ = new Set([
  "de", "da", "do", "das", "dos", "e", "a", "o", "em", "para", "por", "com",
]);
function titleCaseDescricao(input: string): string {
  if (!input) return input;
  const trimmed = input.replace(/\s+/g, " ").trim();
  // letras alfabéticas (com acento) — para decidir se está em CAPS
  const letras = trimmed.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (!letras) return trimmed;
  const upperLetras = letras.replace(/[a-zà-ÿ]/g, "");
  const ratioCaps = upperLetras.length / letras.length;
  // Só ajusta quando ≥80% das letras já estão em caixa alta — preserva
  // entradas que vieram com formatação normal do OCR.
  if (ratioCaps < 0.8) return trimmed;
  const palavras = trimmed.split(" ");
  return palavras
    .map((w, i) => {
      const up = w.toUpperCase();
      if (PRESERVAR_SIGLA.has(up)) return up;
      const baixo = w.toLowerCase();
      if (i > 0 && MINUSCULA_CONJ.has(baixo)) return baixo;
      return baixo.charAt(0).toUpperCase() + baixo.slice(1);
    })
    .join(" ");
}

function diasDeDiferenca(iso: string): number | null {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const target = Date.UTC(y, m - 1, d);
  const today = todayLocalISO().split("-").map(Number);
  const now = Date.UTC(today[0], today[1] - 1, today[2]);
  return Math.round((target - now) / 86400000);
}

function dataPrecisaConfirmacao(iso: string | undefined): boolean {
  if (!iso) return false;
  const diff = diasDeDiferenca(iso);
  if (diff === null) return false;
  // futura OU anterior a 30 dias
  return diff > 0 || diff < -30;
}

function parseValor(texto: string): number | null {
  const t = texto.replace(/[Rr]\$\s*/g, "").trim();
  // dois grupos: "1.234,56" (BR) ou "1234.56" / "1234,56"
  const m = t.match(/(\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  let s = m[1].replace(/\s/g, "");
  // se contém ',' tratamos como BR
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function parseData(texto: string): string | null {
  const t = normalize(texto);
  if (!t) return null;
  if (t === "hoje") return todayLocalISO();
  if (t === "ontem") return ontemLocalISO();
  // DD/MM/YYYY ou DD/MM/YY
  const m = t.match(/\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    let yy = m[3] ?? String(new Date().getFullYear());
    if (yy.length === 2) yy = `20${yy}`;
    if (Number(dd) >= 1 && Number(dd) <= 31 && Number(mm) >= 1 && Number(mm) <= 12) {
      return `${yy}-${mm}-${dd}`;
    }
  }
  return null;
}

function detectFormaPagamento(text: string): string | null {
  const t = normalize(text);
  if (!t) return null;
  if (/\bpix\b/.test(t)) return "pix";
  if (/\b(dinheiro|especie|cash)\b/.test(t)) return "dinheiro";
  if (/\b(debito|cartao de debito)\b/.test(t)) return "debito";
  if (/\b(credito|cartao de credito|cartao|cartoes)\b/.test(t)) return "credito";
  if (/\bboleto\b/.test(t)) return "boleto";
  if (/\btransfer/.test(t)) return "transferencia";
  if (/\b(vr|vale.?refei)/.test(t)) return "vale_refeicao";
  if (/\b(va|vale.?aliment)/.test(t)) return "vale_alimentacao";
  if (/\boutro\b/.test(t)) return "outro";
  return null;
}

function rotuloPagamento(f: string | null | undefined): string {
  switch (f) {
    case "credito": return "Cartão de crédito";
    case "debito": return "Cartão de débito";
    case "pix": return "Pix";
    case "dinheiro": return "Dinheiro";
    case "boleto": return "Boleto";
    case "transferencia": return "Transferência";
    case "vale_alimentacao": return "Vale alimentação";
    case "vale_refeicao": return "Vale refeição";
    case "outro": return "Outro";
    default: return "Não informado";
  }
}

// ----- categorias do usuário ---------------------------------------------
type CategoriaRow = { id: string; legacy_id: string | null; nome: string };

async function carregarCategoriasDespesa(userId: string): Promise<CategoriaRow[]> {
  const { data } = await supabaseAdmin
    .from("categorias")
    .select("id, legacy_id, nome")
    .eq("user_id", userId);
  if (!Array.isArray(data)) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((c: any) => ({
    id: c.id,
    legacy_id: c.legacy_id ?? null,
    nome: c.nome ?? "",
  }));
}

function findCategoriaByTerm(
  cats: CategoriaRow[],
  termo: string,
): CategoriaRow | null {
  if (!termo) return null;
  const t = normalize(termo);
  // exato por legacy_id ou nome
  for (const c of cats) {
    if (c.legacy_id && normalize(c.legacy_id) === t) return c;
    if (c.nome && normalize(c.nome) === t) return c;
  }
  // contém
  for (const c of cats) {
    if (c.nome && normalize(c.nome).includes(t)) return c;
  }
  return null;
}

function fallbackCategoria(cats: CategoriaRow[]): CategoriaRow | null {
  const out = cats.find((c) => c.legacy_id === "outros") ?? cats[0] ?? null;
  return out;
}

/**
 * Resolve uma categoria a partir do texto do usuário durante a sessão de
 * comprovante. Aceita:
 *  - índice numérico ("1", "2", ...) referente à ordem exibida em
 *    `listarCategorias`;
 *  - "categoria <termo>" — tira o prefixo;
 *  - nome exato (ex.: "Transporte") ou contém (ex.: "transp").
 *
 * Categorias de outro usuário nunca entram em `cats` (filtro por
 * `user_id` em `carregarCategoriasDespesa`).
 */
function pickCategoria(
  cats: CategoriaRow[],
  texto: string,
): CategoriaRow | null {
  const raw = (texto || "").trim();
  if (!raw) return null;
  // pontuação/aspas no fim
  const limpo = raw.replace(/^[•\-.\s]+/, "").replace(/[.!?\s]+$/, "");
  const t = normalize(limpo);
  if (!t) return null;
  // "categoria X" → X
  const semPrefixo = t.replace(/^categoria\s+/, "").trim();
  // numérico puro → índice
  const numMatch = semPrefixo.match(/^(\d{1,3})$/);
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    if (idx >= 0 && idx < cats.length) return cats[idx];
    return null;
  }
  return findCategoriaByTerm(cats, semPrefixo);
}

// ----- detecção de comandos ---------------------------------------------
type AjusteField = "valor" | "descricao" | "categoria" | "data" | "pagamento";
type AjusteIntent =
  | { kind: "ask"; field: AjusteField }
  | { kind: "direct"; field: "valor"; valor: number }
  | { kind: "direct"; field: "descricao"; descricao: string }
  | { kind: "direct"; field: "categoria"; termo: string }
  | { kind: "direct"; field: "data"; data: string }
  | { kind: "direct"; field: "pagamento"; forma: string };

const VERBO_AJUSTE = "(alterar|trocar|mudar|corrigir|editar|ajustar)";

export function detectAjuste(texto: string): AjusteIntent | null {
  if (!texto) return null;
  // remove pontuação final que costuma chegar do WhatsApp ("categoria.",
  // "categoria!", "categoria?").
  const limpo = texto.replace(/[.!?\s]+$/g, "").trim();
  const t = normalize(limpo);
  if (!t) return null;

  // pedidos simples — "categoria", "alterar categoria", "editar categoria"...
  if (new RegExp(`^(${VERBO_AJUSTE}\\s+)?valor$`).test(t)) {
    return { kind: "ask", field: "valor" };
  }
  if (new RegExp(`^(${VERBO_AJUSTE}\\s+)?(descricao|descrição)$`).test(t)) {
    return { kind: "ask", field: "descricao" };
  }
  if (new RegExp(`^(${VERBO_AJUSTE}\\s+)?categoria$`).test(t)) {
    return { kind: "ask", field: "categoria" };
  }
  if (new RegExp(`^(${VERBO_AJUSTE}\\s+)?data$`).test(t)) {
    return { kind: "ask", field: "data" };
  }
  if (new RegExp(`^(${VERBO_AJUSTE}\\s+)?(pagamento|forma de pagamento|forma)$`).test(t)) {
    return { kind: "ask", field: "pagamento" };
  }

  // formas diretas: "valor 52,90", "categoria Transporte", "descrição Uber",
  // "data ontem", "pagamento pix"
  let m = t.match(/^valor\s+(.+)$/);
  if (m) {
    const v = parseValor(m[1]);
    if (v) return { kind: "direct", field: "valor", valor: v };
  }
  m = t.match(/^(descricao|descrição)\s+(.+)$/);
  if (m) return { kind: "direct", field: "descricao", descricao: m[2].slice(0, 80) };
  m = t.match(/^categoria\s+(.+)$/);
  if (m) return { kind: "direct", field: "categoria", termo: m[1].slice(0, 60) };
  m = t.match(/^data\s+(.+)$/);
  if (m) {
    const d = parseData(m[1]);
    if (d) return { kind: "direct", field: "data", data: d };
  }
  m = t.match(/^(pagamento|forma de pagamento|forma)\s+(.+)$/);
  if (m) {
    const f = detectFormaPagamento(m[2]);
    if (f) return { kind: "direct", field: "pagamento", forma: f };
  }
  return null;
}

// ----- construção da sessão a partir do OCR ------------------------------
function ocrParaSessao(
  ocr: OcrResult,
  mensagemOriginal: string,
  img: ImageAttachment,
): ComprovanteSession {
  const descricao = ocr.descricao ? titleCaseDescricao(ocr.descricao) : undefined;
  // Categoria fica "não identificada" quando o OCR não sugeriu nada
  // ou retornou confiança baixa — nunca salvamos como Outros sozinhos.
  const categoriaNaoIdentificada =
    !ocr.categoriaSugerida || ocr.confianca === "baixa";
  // Data fica "incerta" quando o OCR trouxe uma data mas a confiança geral
  // é baixa — não confiar mesmo dentro da janela ±30 dias.
  const dataIncerta = !!ocr.data && ocr.confianca === "baixa";
  return {
    kind: "imagem_comprovante",
    descricao,
    valor: ocr.valor ?? undefined,
    data: ocr.data ?? todayLocalISO(),
    categoriaSugerida: ocr.categoriaSugerida,
    categoriaLabel: null,
    categoriaNaoIdentificada,
    formaPagamento: ocr.formaPagamento,
    confianca: ocr.confianca,
    dataIncerta,
    // Se OCR não trouxe data, usamos hoje (sem precisar confirmar).
    // Se a data é incerta, precisa de confirmação explícita.
    dataConfirmada: !ocr.data && !dataIncerta,
    imageSha256: img.sha256,
    imageMimeType: img.mimeType,
    mensagemOriginal,
  };
}

function categoriaSugestaoLabel(
  s: ComprovanteSession,
  cats: CategoriaRow[],
): { label: string; id: string | null } {
  if (s.categoriaLabel && s.categoriaId) {
    return { label: s.categoriaLabel, id: s.categoriaId };
  }
  if (s.categoriaNaoIdentificada) {
    return { label: "Não identificada", id: null };
  }
  const termo = s.categoriaSugerida ?? "";
  const found = findCategoriaByTerm(cats, termo);
  if (found) return { label: found.nome, id: found.id };
  const fb = fallbackCategoria(cats);
  return { label: fb?.nome ?? "Outros", id: fb?.id ?? null };
}

function dataLabelEValor(
  s: ComprovanteSession,
): { label: string; valor: string } {
  const iso = s.data;
  if (s.dataIncerta && !s.dataConfirmada) {
    return { label: "Data da nota", valor: "Não confirmada" };
  }
  if (!iso) return { label: "Data", valor: "Hoje" };
  const fmt = formatDataBR(iso);
  const isToday = iso === todayLocalISO();
  return { label: isToday ? "Data" : "Data da nota", valor: fmt };
}

function buildResumo(s: ComprovanteSession, cats: CategoriaRow[]): string {
  const cat = categoriaSugestaoLabel(s, cats);
  const d = dataLabelEValor(s);
  return M.imagem.resumo({
    descricao: s.descricao ?? "—",
    valor: s.valor ? formatBRL(s.valor) : "—",
    dataLabel: d.label,
    dataValor: d.valor,
    pagamento: s.formaPagamento ? rotuloPagamento(s.formaPagamento) : "Não identificado",
    categoria: cat.label,
  });
}

// ----- persistência do gasto --------------------------------------------
async function persistirGastoComprovante(
  userId: string,
  s: ComprovanteSession,
  cats: CategoriaRow[],
): Promise<{ ok: boolean; gastoId?: string; resposta: string }> {
  const cat = categoriaSugestaoLabel(s, cats);
  const data = s.data ?? todayLocalISO();
  const [y, mo] = data.split("-").map(Number);

  const desc = (s.descricao ?? "").trim().slice(0, 120);
  if (!desc || !s.valor || s.valor <= 0) {
    return { ok: false, resposta: M.erroAoSalvar() };
  }

  const obs = `WhatsApp (foto): ${s.mensagemOriginal}`.slice(0, 240);

  const { data: row, error } = await supabaseAdmin
    .from("gastos")
    .insert({
      user_id: userId,
      categoria_id: cat.id,
      descricao: desc,
      estabelecimento: desc,
      valor: s.valor,
      data,
      mes: mo,
      ano: y,
      forma_pagamento: s.formaPagamento ?? "outro",
      cartao_id: null,
      tipo_gasto: "unico",
      total_parcelas: null,
      observacao: obs,
      origem: "whatsapp",
      confirmado: true,
    })
    .select("id")
    .single();

  if (error || !row) {
    console.error("[whatsapp-comprovante] gasto insert failed", error);
    return { ok: false, resposta: M.erroAoSalvar() };
  }
  const resposta = M.imagem.salvo({
    valor: formatBRL(s.valor),
    descricao: desc,
    categoria: cat.label,
    pagamento: rotuloPagamento(s.formaPagamento),
  });
  return { ok: true, gastoId: row.id, resposta };
}

// ----- API pública: nova imagem ------------------------------------------
export function hashImageBase64(b64: string): string {
  // hash da parte de dados (sem prefixo data URL), para deduplicação estável.
  const idx = b64.indexOf(",");
  const payload = idx >= 0 ? b64.slice(idx + 1) : b64;
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Processa uma imagem recém-recebida (sem sessão pendente).
 * Retorna a sessão a ser persistida + a resposta a enviar.
 */
export async function processarNovaImagem(args: {
  userId: string;
  texto: string;
  image: ImageAttachment;
}): Promise<ComprovanteResult> {
  const { userId, texto, image } = args;

  const sha = image.sha256 || hashImageBase64(image.base64);
  image.sha256 = sha;

  const ocr = await runExtractor(image.base64);
  if (!ocr.ok) {
    return { status: "ilegivel", resposta: M.imagem.ileagivel() };
  }

  const cats = await carregarCategoriasDespesa(userId);
  const session = ocrParaSessao(ocr.data, texto || "(foto)", image);

  const temValor = !!session.valor && session.valor > 0;
  const temDescricao = !!session.descricao && session.descricao.trim().length >= 2;

  // Leitura totalmente vazia
  if (!temValor && !temDescricao) {
    return { status: "ilegivel", resposta: M.imagem.ileagivel() };
  }

  // Só valor
  if (temValor && !temDescricao) {
    return {
      status: "aguardando_descricao",
      newStatus: "img_aguardando_descricao",
      session,
      resposta: M.imagem.apenasValor(formatBRL(session.valor as number)),
    };
  }

  // Só descrição
  if (!temValor && temDescricao) {
    return {
      status: "aguardando_valor",
      newStatus: "img_aguardando_valor",
      session,
      resposta: M.imagem.apenasDescricao(session.descricao as string),
    };
  }

  // Leitura completa → resumo (sem cravar categoriaId quando OCR está incerto)
  const cat = categoriaSugestaoLabel(session, cats);
  if (!session.categoriaNaoIdentificada) {
    session.categoriaId = cat.id;
    session.categoriaLabel = cat.label;
  }
  return {
    status: "aguardando_confirmacao",
    newStatus: "img_aguardando_confirmacao",
    session,
    resposta: buildResumo(session, cats),
  };
}

// Avança o fluxo após o "sim": exige categoria (quando não identificada),
// confirma data fora da janela, pergunta forma de pagamento (quando não
// detectada) e por fim persiste o gasto. Cada passo retorna um novo estado
// pendente — nunca cria gasto sem todas as confirmações.
async function avancarAposConfirmacao(
  userId: string,
  session: ComprovanteSession,
  cats: CategoriaRow[],
): Promise<ComprovanteResult> {
  // 1) Categoria obrigatória quando OCR não identificou com confiança.
  if (session.categoriaNaoIdentificada && !session.categoriaId) {
    return {
      status: "aguardando_categoria_obrigatoria",
      newStatus: "img_aguardando_categoria_obrigatoria",
      session,
      resposta: M.imagem.perguntaCategoriaObrigatoria(listarCategorias(cats)),
    };
  }
  // 2) Confirmação de data: nota antiga (>30d), futura ou marcada como incerta
  //    pela confiança baixa do OCR.
  if (
    !session.dataConfirmada &&
    (session.dataIncerta || dataPrecisaConfirmacao(session.data))
  ) {
    const resposta = session.dataIncerta
      ? M.imagem.perguntaDataIncerta()
      : M.imagem.perguntaDataConfirmacao(formatDataBR(session.data as string));
    return {
      status: "aguardando_data_confirmacao",
      newStatus: "img_aguardando_data_confirmacao",
      session,
      resposta,
    };
  }
  // 3) Forma de pagamento, quando não detectada.
  if (!session.formaPagamento) {
    return {
      status: "aguardando_pagamento",
      newStatus: "img_aguardando_pagamento",
      session,
      resposta: M.imagem.perguntaFormaPagamento(),
    };
  }
  // 4) Persiste.
  const saved = await persistirGastoComprovante(userId, session, cats);
  if (!saved.ok) return { status: "erro", resposta: saved.resposta, session };
  return {
    status: "salva",
    newStatus: "salva",
    session,
    gastoId: saved.gastoId,
    resposta: saved.resposta,
  };
}

/**
 * Processa uma mensagem do usuário enquanto existe uma sessão de imagem.
 */
export async function processarRespostaImagem(args: {
  userId: string;
  texto: string;
  session: ComprovanteSession;
  status: ComprovanteStatus;
  decisao: "confirm" | "cancel" | "outro";
}): Promise<ComprovanteResult> {
  const { userId, texto, session, status, decisao } = args;
  const cats = await carregarCategoriasDespesa(userId);

  if (decisao === "cancel") {
    return { status: "cancelada", resposta: M.imagem.cancelado(), session };
  }

  // ----- estados de pedido de ajuste -----
  if (status === "img_aguardando_ajuste" && session.pendingField) {
    const field = session.pendingField;
    const next: ComprovanteSession = { ...session, pendingField: undefined };
    if (field === "valor") {
      const v = parseValor(texto);
      if (!v) {
        return {
          status: "aguardando_ajuste",
          newStatus: "img_aguardando_ajuste",
          session,
          resposta: M.imagem.pedirNovoValor(),
        };
      }
      next.valor = v;
    } else if (field === "descricao") {
      const d = texto.trim().slice(0, 80);
      if (!d) {
        return {
          status: "aguardando_ajuste",
          newStatus: "img_aguardando_ajuste",
          session,
          resposta: M.imagem.pedirNovaDescricao(),
        };
      }
      next.descricao = d;
    } else if (field === "categoria") {
      const found = pickCategoria(cats, texto);
      if (!found) {
        return {
          status: "aguardando_ajuste",
          newStatus: "img_aguardando_ajuste",
          session: { ...session, pendingField: "categoria" },
          resposta: M.imagem.pedirNovaCategoria(listarCategorias(cats)),
        };
      }
      next.categoriaId = found.id;
      next.categoriaLabel = found.nome;
      next.categoriaNaoIdentificada = false;
    } else if (field === "data") {
      const d = parseData(texto);
      if (!d) {
        return {
          status: "aguardando_ajuste",
          newStatus: "img_aguardando_ajuste",
          session,
          resposta: M.imagem.pedirNovaData(),
        };
      }
      next.data = d;
      next.dataConfirmada = true; // usuário forneceu data explicitamente
    } else if (field === "pagamento") {
      const forma = detectFormaPagamento(texto);
      if (!forma) {
        return {
          status: "aguardando_ajuste",
          newStatus: "img_aguardando_ajuste",
          session,
          resposta: M.imagem.pedirNovoPagamento(),
        };
      }
      next.formaPagamento = forma;
    }
    return rebuildResumoOuPreencher(next, cats);
  }

  // ----- campos faltantes -----
  if (status === "img_aguardando_valor") {
    const v = parseValor(texto);
    if (!v) {
      return {
        status: "aguardando_valor",
        newStatus: "img_aguardando_valor",
        session,
        resposta: M.imagem.apenasDescricao(session.descricao ?? ""),
      };
    }
    const next: ComprovanteSession = { ...session, valor: v };
    return rebuildResumoOuPreencher(next, cats);
  }

  if (status === "img_aguardando_descricao") {
    const d = texto.trim().slice(0, 80);
    if (!d) {
      return {
        status: "aguardando_descricao",
        newStatus: "img_aguardando_descricao",
        session,
        resposta: M.imagem.apenasValor(formatBRL(session.valor ?? 0)),
      };
    }
    const next: ComprovanteSession = { ...session, descricao: d };
    return rebuildResumoOuPreencher(next, cats);
  }

  // ----- aguardando confirmação de DATA (fora da janela ±30 dias OU incerta) -----
  if (status === "img_aguardando_data_confirmacao") {
    const t = normalize(texto);
    const usarNota = /^(usar data da nota|usar a data da nota|manter data|manter|data da nota|nota)$/.test(t);
    const usarHoje = /^(usar hoje|hoje|usar a data de hoje)$/.test(t);
    // Quando o usuário responde com uma data direta ("15/06/2026", "ontem")
    // também aceitamos — confirma a data informada manualmente.
    const dataInformada = parseData(texto);
    if (!usarNota && !usarHoje && !dataInformada) {
      const resposta = session.dataIncerta
        ? M.imagem.perguntaDataIncerta()
        : M.imagem.perguntaDataConfirmacao(formatDataBR(session.data as string));
      return {
        status: "aguardando_data_confirmacao",
        newStatus: "img_aguardando_data_confirmacao",
        session,
        resposta,
      };
    }
    const next: ComprovanteSession = {
      ...session,
      dataConfirmada: true,
      dataIncerta: false,
    };
    if (usarHoje) next.data = todayLocalISO();
    if (dataInformada && !usarNota && !usarHoje) next.data = dataInformada;
    return avancarAposConfirmacao(userId, next, cats);
  }

  // ----- aguardando categoria obrigatória -----
  if (status === "img_aguardando_categoria_obrigatoria") {
    const found = pickCategoria(cats, texto);
    if (!found) {
      return {
        status: "aguardando_categoria_obrigatoria",
        newStatus: "img_aguardando_categoria_obrigatoria",
        session,
        resposta: M.imagem.perguntaCategoriaObrigatoria(listarCategorias(cats)),
      };
    }
    const next: ComprovanteSession = {
      ...session,
      categoriaId: found.id,
      categoriaLabel: found.nome,
      categoriaNaoIdentificada: false,
    };
    return avancarAposConfirmacao(userId, next, cats);
  }

  // ----- aguardando forma de pagamento -----
  if (status === "img_aguardando_pagamento") {
    const forma = detectFormaPagamento(texto);
    if (!forma) {
      return {
        status: "aguardando_pagamento",
        newStatus: "img_aguardando_pagamento",
        session,
        resposta: M.imagem.perguntaFormaPagamento(),
      };
    }
    const next: ComprovanteSession = { ...session, formaPagamento: forma };
    return avancarAposConfirmacao(userId, next, cats);
  }

  // ----- aguardando confirmação principal -----
  if (status === "img_aguardando_confirmacao") {
    const aj = detectAjuste(texto);
    if (aj) {
      if (aj.kind === "ask") {
        const next: ComprovanteSession = { ...session, pendingField: aj.field };
        const resposta =
          aj.field === "valor"
            ? M.imagem.pedirNovoValor()
            : aj.field === "descricao"
              ? M.imagem.pedirNovaDescricao()
              : aj.field === "categoria"
                ? M.imagem.pedirNovaCategoria(listarCategorias(cats))
                : aj.field === "pagamento"
                  ? M.imagem.pedirNovoPagamento()
                  : M.imagem.pedirNovaData();
        return {
          status: "aguardando_ajuste",
          newStatus: "img_aguardando_ajuste",
          session: next,
          resposta,
        };
      }
      // direct
      const next: ComprovanteSession = { ...session };
      if (aj.field === "valor") next.valor = aj.valor;
      if (aj.field === "descricao") next.descricao = aj.descricao;
      if (aj.field === "data") {
        next.data = aj.data;
        next.dataConfirmada = true;
      }
      if (aj.field === "pagamento") next.formaPagamento = aj.forma;
      if (aj.field === "categoria") {
        const found = findCategoriaByTerm(cats, aj.termo);
        if (!found) {
          return {
            status: "aguardando_ajuste",
            newStatus: "img_aguardando_ajuste",
            session: { ...session, pendingField: "categoria" },
            resposta: M.imagem.pedirNovaCategoria(listarCategorias(cats)),
          };
        }
        next.categoriaId = found.id;
        next.categoriaLabel = found.nome;
        next.categoriaNaoIdentificada = false;
      }
      return rebuildResumoOuPreencher(next, cats);
    }

    if (decisao === "confirm") {
      return avancarAposConfirmacao(userId, session, cats);
    }
    // resposta desconhecida — reapresenta o resumo
    return {
      status: "aguardando_confirmacao",
      newStatus: "img_aguardando_confirmacao",
      session,
      resposta: buildResumo(session, cats),
    };
  }

  // fallback: reapresenta resumo
  return {
    status: "aguardando_confirmacao",
    newStatus: "img_aguardando_confirmacao",
    session,
    resposta: buildResumo(session, cats),
  };
}

function rebuildResumoOuPreencher(
  s: ComprovanteSession,
  cats: CategoriaRow[],
): ComprovanteResult {
  const temValor = !!s.valor && s.valor > 0;
  const temDesc = !!s.descricao && s.descricao.trim().length >= 2;
  if (!temValor) {
    return {
      status: "aguardando_valor",
      newStatus: "img_aguardando_valor",
      session: s,
      resposta: M.imagem.apenasDescricao(s.descricao ?? ""),
    };
  }
  if (!temDesc) {
    return {
      status: "aguardando_descricao",
      newStatus: "img_aguardando_descricao",
      session: s,
      resposta: M.imagem.apenasValor(formatBRL(s.valor as number)),
    };
  }
  if (!s.categoriaNaoIdentificada) {
    const cat = categoriaSugestaoLabel(s, cats);
    s.categoriaId = cat.id;
    s.categoriaLabel = cat.label;
  }
  return {
    status: "aguardando_confirmacao",
    newStatus: "img_aguardando_confirmacao",
    session: s,
    resposta: buildResumo(s, cats),
  };
}

function listarCategorias(cats: CategoriaRow[]): string {
  const nomes = cats
    .map((c) => c.nome)
    .filter(Boolean)
    .slice(0, 20);
  if (nomes.length === 0) return "";
  return "\n" + nomes.map((n) => `• ${n}`).join("\n");
}

// ----- entitlement: importar foto / OCR ----------------------------------
/**
 * Mesmo gate server-side que `/api/ocr-gasto` aplica para o site:
 * Admin Master sempre passa; demais usuários precisam de assinatura ativa
 * com o feature "importacoes" liberado pelo plano.
 *
 * Retorna `true` quando o usuário pode usar OCR; `false` caso contrário.
 * Não envia resposta — o caller decide o drop silencioso (HTTP 200).
 */
export async function podeUsarOcrComprovante(userId: string): Promise<boolean> {
  try {
    const adminEmails = [
      "felipe.out.silva@outlook.com",
      "michael@medeiroscenografia.com.br",
    ];
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email: string = (u?.user?.email ?? "").trim().toLowerCase();
    if (email && adminEmails.includes(email)) return true;
    const { getSubscriptionForUserIdentity } = await import("@/server/subscription.server");
    const { planAllowsFeature } = await import("@/lib/plans");
    const sub = await getSubscriptionForUserIdentity({ userId, email: email || null, repairLink: false });
    if (!sub.active) return false;
    return planAllowsFeature(sub.plan, "importacoes");
  } catch (err) {
    console.error("[whatsapp-comprovante] entitlement check failed", err);
    return false;
  }
}
