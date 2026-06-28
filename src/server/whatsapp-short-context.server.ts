/**
 * WA-C6 — Memória curta de contexto conversacional (somente RAM).
 *
 * Objetivo: permitir que o usuário diga "pagar a segunda", "cancela 3",
 * "editar a primeira", "e a terceira?", "paguei" — reaproveitando a última
 * lista de contas a pagar mostrada para ele.
 *
 * Garantias:
 *  - Apenas em memória (Map por telefone). Some no restart/deploy.
 *  - TTL curto (~5 min), igual ao cache de intents conversacionais.
 *  - Não persiste no banco, não toca em RLS, não cria sessão.
 *  - Não loga PII (nem nomes nem telefone — apenas contagem agregada).
 *
 * Esta camada apenas REESCREVE o texto do usuário para uma frase canônica
 * que os handlers já existentes (`detectPayableAccountIntent`,
 * `detectEdicaoContaIntent`, etc.) sabem processar. Não altera handlers
 * nem regras financeiras.
 */

const TTL_MS = 5 * 60 * 1000;

export type ShortContextItem = { nome: string };

type Entry = {
  itens: ShortContextItem[];
  /** Última posição referenciada pelo usuário (para "e a terceira?"). */
  lastIndex: number | null;
  at: number;
};

const store = new Map<string, Entry>();

/**
 * WA-C7 — Último favorecido referenciado por telefone (somente RAM, TTL).
 * Permite que "paguei 50" logo após consultar o Pix do João resolva o
 * destinatário sem ambiguidade. Nunca guarda chave Pix — só nome.
 */
type FavorecidoEntry = { nome: string; at: number };
const favoritoStore = new Map<string, FavorecidoEntry>();

export function _resetShortContext(): void {
  store.clear();
  favoritoStore.clear();
  lembreteStore.clear();
}

// =========================================================================
// WA-C9 — Contexto curto de lembrete de conta a pagar.
//
// Quando o dispatcher envia um lembrete ("Hoje vence sua conta..."), o
// servidor registra qual conta foi referenciada para que respostas como
// "Paguei", "Adiar para sexta", "Ver detalhes" ou "Ignorar" sejam
// interpretadas no contexto certo. Mesmo TTL/RAM da memória curta —
// efêmero, sem PII em log, escopado por telefone.
// =========================================================================
const LEMBRETE_TTL_MS = 24 * 60 * 60 * 1000; // 24h: cobre janela 24h da Meta.

export type LembreteContaContext = {
  contaId: string;
  notificationId: string;
  nomeCurto?: string | null;
  dueISO: string;
};

type LembreteEntry = LembreteContaContext & { at: number };
const lembreteStore = new Map<string, LembreteEntry>();

export function recordLembreteConta(
  telefone: string,
  ctx: LembreteContaContext,
): void {
  if (!telefone || !ctx?.contaId) return;
  lembreteStore.set(telefone, { ...ctx, at: Date.now() });
}

export function getLembreteConta(
  telefone: string,
): LembreteContaContext | null {
  const e = lembreteStore.get(telefone);
  if (!e) return null;
  if (Date.now() - e.at > LEMBRETE_TTL_MS) {
    lembreteStore.delete(telefone);
    return null;
  }
  const { at: _at, ...rest } = e;
  void _at;
  return rest;
}

export function clearLembreteConta(telefone: string): void {
  lembreteStore.delete(telefone);
}

export type LembreteResponseKind =
  | { kind: "paguei" }
  | { kind: "adiar"; novaData: string | null }
  | { kind: "detalhes" }
  | { kind: "ignorar" };

const RE_PAGUEI =
  /^\s*(?:1\.?|paguei|j[aá]\s+paguei|quitei|marcar\s+como\s+paga|pagou|pago)\b/i;
const RE_ADIAR = /^\s*(?:2\.?|adiar|postergar|adia)\b/i;
const RE_DETALHES = /^\s*(?:3\.?|ver\s+detalhes|detalhes?)\b/i;
const RE_IGNORAR = /^\s*(?:4\.?|ignorar|ignora|depois)\b/i;

/**
 * Interpreta a resposta do usuário a um lembrete. Retorna `null` se não há
 * lembrete ativo OU se o texto não casa com nenhum dos atalhos esperados.
 *
 * Não altera estado financeiro — apenas classifica.
 */
export function resolveLembreteResposta(
  telefone: string,
  texto: string,
): LembreteResponseKind | null {
  const ctx = getLembreteConta(telefone);
  if (!ctx) return null;
  const raw = (texto ?? "").trim();
  if (!raw) return null;
  if (RE_PAGUEI.test(raw)) return { kind: "paguei" };
  if (RE_ADIAR.test(raw)) {
    const m = raw.match(/para\s+(.+)$/i);
    return { kind: "adiar", novaData: m ? m[1].trim() : null };
  }
  if (RE_DETALHES.test(raw)) return { kind: "detalhes" };
  if (RE_IGNORAR.test(raw)) return { kind: "ignorar" };
  return null;
}

export function recordFavorecido(telefone: string, nome: string): void {
  if (!telefone || !nome || nome.trim().length === 0) return;
  favoritoStore.set(telefone, { nome: nome.trim(), at: Date.now() });
}

export function getLastFavorecido(telefone: string): string | null {
  const e = favoritoStore.get(telefone);
  if (!e) return null;
  if (!ttlOk(e.at)) {
    favoritoStore.delete(telefone);
    return null;
  }
  return e.nome;
}

export function clearFavorecido(telefone: string): void {
  favoritoStore.delete(telefone);
}

function ttlOk(at: number): boolean {
  return Date.now() - at <= TTL_MS;
}

/**
 * Registra a lista de contas mostradas ao usuário (em ordem).
 * Nomes vazios são descartados.
 */
export function recordContas(telefone: string, itens: ShortContextItem[]): void {
  if (!telefone) return;
  const limpos = itens
    .map((i) => ({ nome: (i?.nome ?? "").trim() }))
    .filter((i) => i.nome.length > 0)
    .slice(0, 20);
  if (limpos.length === 0) {
    store.delete(telefone);
    return;
  }
  store.set(telefone, { itens: limpos, lastIndex: null, at: Date.now() });
}

export function clear(telefone: string): void {
  store.delete(telefone);
}

function getEntry(telefone: string): Entry | null {
  const e = store.get(telefone);
  if (!e) return null;
  if (!ttlOk(e.at)) {
    store.delete(telefone);
    return null;
  }
  return e;
}

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ORDINAIS: Record<string, number> = {
  "primeira": 1, "primeiro": 1, "1a": 1, "1o": 1, "1ª": 1, "1º": 1,
  "segunda": 2, "segundo": 2, "2a": 2, "2o": 2,
  "terceira": 3, "terceiro": 3, "3a": 3, "3o": 3,
  "quarta": 4, "quarto": 4, "4a": 4, "4o": 4,
  "quinta": 5, "quinto": 5, "5a": 5, "5o": 5,
  "sexta": 6, "sexto": 6,
  "setima": 7, "setimo": 7,
  "oitava": 8, "oitavo": 8,
  "nona": 9, "nono": 9,
  "decima": 10, "decimo": 10,
};

type Action = "pagar" | "editar" | "cancelar";

function detectAction(t: string): Action | null {
  if (/\b(paguei|quitei|quitar|dar\s+baixa|baixar|marcar\s+como\s+pago|ja\s+paguei|ja\s+quitei|resolvido|resolvi|acabei\s+de\s+pagar|pode\s+marcar)\b/.test(t)) {
    return "pagar";
  }
  if (/\b(pagar|paga)\b/.test(t)) return "pagar";
  if (/\b(editar|edita|alterar|altera|mudar|muda|corrigir|corrige)\b/.test(t)) return "editar";
  if (/\b(cancelar|cancela|excluir|exclui|remover|remove|apagar|apaga)\b/.test(t)) return "cancelar";
  return null;
}

function detectIndex(t: string): number | null {
  // "a segunda", "primeiro", "a 2", "numero 3", "item 4"
  for (const [palavra, idx] of Object.entries(ORDINAIS)) {
    const re = new RegExp(`\\b${palavra}\\b`);
    if (re.test(t)) return idx;
  }
  const m = t.match(/\b(?:n(?:umero)?|item|opcao|conta)?\s*([1-9]|10)\b/);
  if (m) return Number(m[1]);
  return null;
}

/**
 * Tenta resolver o texto do usuário usando a memória curta de lista.
 * Retorna o texto canônico reescrito (ex.: "paguei Internet") ou null se
 * não aplicável. Não altera estado do banco.
 *
 * Casos cobertos:
 *  - "pagar a segunda" / "paga 2" / "quitei a 3"
 *  - "cancela a primeira" / "exclui 2"
 *  - "editar a terceira"
 *  - "e a terceira?" (referência implícita após uma ação na lista)
 *  - "paguei" / "ja paguei" sozinhos: usa item destacado se houver apenas 1
 */
export function resolveOrdinal(telefone: string, texto: string): string | null {
  const entry = getEntry(telefone);
  if (!entry || entry.itens.length === 0) return null;
  const t = norm(texto);
  if (!t) return null;

  const action = detectAction(t);
  const idx = detectIndex(t);

  // "e a terceira?" — referência implícita usando última ação executada
  // sobre a lista. Só dispara se houver lastIndex registrado.
  if (!action && idx && /^\s*e\s+/.test(t)) {
    const item = entry.itens[idx - 1];
    if (!item) return null;
    entry.lastIndex = idx;
    // Repete a última ação inferida: como não há ação explícita, usamos
    // a ação registrada na última interação (lastIndex implica que houve).
    // Sem ação anterior conhecida, não reescreve.
    return null;
  }

  if (!action) {
    // "paguei" sozinho com lista de 1 item.
    if (/^(paguei|ja paguei|quitei|ja quitei|resolvido|resolvi|pode marcar(?: como pago)?)$/.test(t)) {
      if (entry.itens.length === 1) {
        entry.lastIndex = 1;
        return `paguei ${entry.itens[0].nome}`;
      }
    }
    return null;
  }

  // Com ação explícita.
  let alvo: number | null = idx;
  if (alvo === null) {
    // "paguei" / "cancela" sem índice: só dispara se a lista tem 1 item.
    if (entry.itens.length === 1) alvo = 1;
    else return null;
  }
  const item = entry.itens[alvo - 1];
  if (!item) return null;
  entry.lastIndex = alvo;

  if (action === "pagar") return `paguei ${item.nome}`;
  if (action === "editar") return `editar ${item.nome}`;
  return `cancelar ${item.nome}`;
}

// =========================================================================
// WA-C7.2.a — Atalho "Paguei." usando memória curta de favorecido
// =========================================================================
//
// Quando o usuário acabou de consultar o Pix de alguém (ou registrou um
// pagamento para essa pessoa) e dispara apenas "paguei", "paguei R$ 50" ou
// "paguei 50 do almoço", o sistema reescreve a frase para incluir o nome do
// último favorecido. Isso permite que o handler de pagamento para pessoa
// (`handlePagarPessoaIntent`) entenda o destinatário sem o usuário ter
// que repetir o nome.
//
// Regras estritas para evitar reescritas indevidas:
//  - Não reescreve se já houver um nome próprio reconhecível (qualquer
//    palavra capitalizada com 2+ letras) na frase.
//  - Não reescreve se a frase mencionar boleto/fatura/cartão/conta — esses
//    sinais devem permanecer com o fluxo de Contas a Pagar (WA-C3).
//  - Não reescreve se a frase parecer um lançamento de gasto comum
//    (ex.: "paguei 50 no mercado", "paguei 30 no pix no Uber"): a presença
//    de "no/na <estabelecimento>" indica gasto, não pagamento para pessoa.
//  - Só aciona se há favorecido recente válido (TTL ok).
// O texto retornado é determinístico e seguro: insere `<nome>` logo após o
// verbo "paguei", preservando o restante da frase para que o parser de
// `parsePagarPessoa` extraia valor/descrição normalmente.
const VERBO_PAGUEI_RE = /^\s*(paguei|ja\s+paguei|já\s+paguei|acabei\s+de\s+pagar|quitei)\b/i;
const TEM_NOME_PROPRIO_RE = /\b[A-ZÀ-Ý][a-zà-ÿ]{1,}\b/; // capitalizado
const SINAIS_CONTA_RE = /\b(boleto|fatura|cartao|cartão|conta\s+de\s+\w+)\b/i;
const SINAIS_ESTABELECIMENTO_RE = /\b(?:no|na|nos|nas)\s+[a-zà-ÿ]/i;
const PREP_DESTINATARIO_RE = /\b(?:para|pra|pro|ao|à)\s+[a-zà-ÿ]/i;

/**
 * Tenta reescrever uma frase de pagamento curta para incluir o último
 * favorecido recentemente referenciado. Retorna o texto reescrito ou null
 * quando não for seguro reescrever.
 *
 * Exemplos:
 *  - "paguei"                         → "paguei João"
 *  - "paguei 50"                      → "paguei João 50"
 *  - "paguei R$ 50 do almoço"         → "paguei João R$ 50 do almoço"
 *  - "paguei 50 no mercado"           → null  (sinal de estabelecimento)
 *  - "paguei João 50"                 → null  (já tem destinatário)
 *  - "paguei a fatura"                → null  (sinal de conta a pagar)
 */
export function resolvePagueiSemNome(
  telefone: string,
  texto: string,
): string | null {
  const raw = (texto ?? "").trim();
  if (!raw) return null;
  if (!VERBO_PAGUEI_RE.test(raw)) return null;
  if (SINAIS_CONTA_RE.test(raw)) return null;
  if (PREP_DESTINATARIO_RE.test(raw)) return null;
  if (SINAIS_ESTABELECIMENTO_RE.test(raw)) return null;
  // Heurística: a primeira palavra após o verbo, se capitalizada, costuma
  // ser nome próprio explícito ("paguei João 50") — não reescrever.
  const aposVerbo = raw.replace(VERBO_PAGUEI_RE, "").trim();
  if (TEM_NOME_PROPRIO_RE.test(aposVerbo)) return null;
  const nome = getLastFavorecido(telefone);
  if (!nome) return null;
  // Insere o nome logo depois do verbo. Preserva o restante.
  return raw.replace(VERBO_PAGUEI_RE, (m) => `${m} ${nome}`);
}
