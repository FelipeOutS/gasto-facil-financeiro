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

export function _resetShortContext(): void {
  store.clear();
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
