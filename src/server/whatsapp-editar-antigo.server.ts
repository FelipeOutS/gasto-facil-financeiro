/**
 * P1 (14/10/2026) — Edição de gastos e receitas JÁ REGISTRADOS pelo WhatsApp
 * (inclusive de meses anteriores e lançamentos criados no site).
 *
 * Fluxo: localizar → escolher → campo → novo valor → comparação → Confirmar.
 * Nada é persistido antes do Confirmar.
 *
 * Segurança (sem migração):
 *  - Toda leitura/escrita filtra `user_id` do vínculo já validado pelo
 *    pipeline (vínculo + consentimento + plano revalidados a cada mensagem)
 *    e `deleted_at IS NULL`. Contas conectadas NÃO são editáveis por aqui.
 *  - O estado da conversa fica em `whatsapp_messages.parsed`
 *    (kind = "wa_edit_old"), uma linha por passo, com `external_id` único:
 *    replay do webhook cai no dedupe e nunca reaplica nada.
 *  - Cada passo gera um `nonce` novo: botão/lista de um passo antigo é
 *    recusado ("expirada"). A seleção guarda o ID real do registro; o
 *    número digitado só é traduzido para um ID dentro da lista daquele passo.
 *  - Persistência com controle otimista: UPDATE ... WHERE id AND user_id AND
 *    updated_at = <snapshot> AND deleted_at IS NULL. Se o site alterou o
 *    lançamento depois da seleção, 0 linhas → nada é sobrescrito.
 *  - Confirmação: primeiro grava a linha "applying" (consome o estado e o
 *    external_id); só então faz o UPDATE. Confirmação repetida ou
 *    concorrente não reaplica.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import { validateFinancialAmount } from "@/lib/financial-limits";
import { parseData, parseValor } from "@/lib/whatsappParser";
import { toGraphInteractive } from "./whatsapp-interactive.server";
import { detectMesNoTexto } from "./whatsapp-mes-nomeado";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
const defaultDb: Db = _supabaseAdmin;

export const EDIT_OLD_KIND = "wa_edit_old";
export const EDIT_OLD_TTL_MS = 15 * 60 * 1000;
export const EDIT_OLD_PAGE = 8;
const TOKEN = /^wa_ed:([0-9a-f]{12}):(sel|pg|f|ok|adj|x|cont|novo|del|bk|rst)(?::([0-9a-z_-]{1,40}))?$/i;

type Tbl = "gastos" | "receitas";
type Field = "valor" | "descricao" | "data" | "categoria_id";
type Cand = { t: Tbl; id: string };
type Snap = {
  t: Tbl; id: string; updated_at: string;
  descricao: string; valor: number; data: string; categoria_id: string | null;
  allowed: Field[];
};
type Patch = { field: Field; value: string; label: string; beforeLabel: string };
export type EditOldState = {
  kind: typeof EDIT_OLD_KIND;
  stage: "periodo" | "select" | "field" | "value" | "confirm" | "interrupt" | "applying" | "done";
  nonce: string;
  seq?: number;
  expires_at: string;
  tipo: "receita" | "gasto" | "lancamento";
  /** P1 exclusão individual (14/10): mesmo fluxo/estado da edição, ação diferente. */
  acao?: "editar" | "excluir" | "restaurar";
  termo?: string | null;
  cands?: Cand[];
  page?: number;
  sel?: Snap;
  field?: Field;
  patch?: Patch;
  /** Etapa a retomar quando o usuário escolhe "Continuar edição". */
  resume?: "periodo" | "select" | "field" | "value" | "confirm";
  /** Texto do novo lançamento; só é processado após escolha explícita. */
  pending_text?: string;
};
export type EditOldReply = {
  resposta: string; graphInteractive?: Record<string, unknown>;
  /** "Iniciar novo lançamento": o pipeline processa este texto como mensagem nova. */
  replayText?: string;
};
export type EditOldDeps = { db?: Db; now?: () => Date; nonce?: () => string };

// ---------------------------------------------------------------- utils
function norm(s: string): string {
  return (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[?!.,;:]+/g, " ").replace(/\s+/g, " ").trim();
}
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBR = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
const FIELD_LABEL: Record<Field, string> = { valor: "Valor", descricao: "Descrição", data: "Data", categoria_id: "Categoria" };
function randNonce(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Data de hoje em São Paulo (UTC-3, sem horário de verão desde 2019). */
function todaySP(now: Date): string {
  return new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}
function shiftISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function monthRange(y: number, m: number): [string, string] {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, "0")}`];
}

// ------------------------------------------------------------- detector
const EDIT_VERB = /\b(editar|edita|edite|alterar|altera|altere|corrigir|corrige|corrija|mudar|muda|mude|modificar|modifique|atualizar|atualize)\b/;
const RECEITA_W = /\b(receitas?|rendas?|entradas?|salario|recebimentos?)\b/;
const GASTO_W = /\b(gastos?|despesas?|compras?)\b/;
const LANC_W = /\blancamentos?\b/;
const FIELD_PHRASE = /\b(valor|descricao|data|nome)\s+(do|da|de|dos|das)\s+\S+/;
// Contas a pagar, cartões, categorias (comando próprio), metas e agenda têm
// fluxos próprios — não interceptar.
const OUTROS_FLUXOS = /\b(contas?|boletos?|fatura|cartao|categoria|meta|metas|lembrete|agenda)\b/;

export type EditarTipo = "receita" | "gasto" | "lancamento";
export function detectEdicaoAntiga(texto: string): EditarTipo | null {
  const t = norm(texto);
  if (!t || !EDIT_VERB.test(t)) return null;
  if (OUTROS_FLUXOS.test(t)) return null;
  if (RECEITA_W.test(t)) return "receita";
  if (GASTO_W.test(t)) return "gasto";
  if (LANC_W.test(t)) return "lancamento";
  if (FIELD_PHRASE.test(t)) return "lancamento";
  return null;
}

// --------------------------------------------- detector (exclusão individual)
const DEL_VERB = /\b(excluir|exclui|exclua|apagar|apaga|apague|remover|remove|remova|deletar|deleta|delete)\b/;
/** Pedido de exclusão em massa: fora do escopo desta rodada (etapa própria com prévia). */
export const BULK_DEL = /\b(todos|todas|tudo|inteiro|inteira|em massa|varios|varias)\b/;
/** "excluir um gasto de outubro", "apagar a receita do salário", "remover o Uber de ontem". */
export function detectExclusaoAntiga(texto: string, now: Date = new Date()): EditarTipo | null {
  const t = norm(texto);
  if (!t || !DEL_VERB.test(t)) return null;
  if (OUTROS_FLUXOS.test(t)) return null;
  if (RECEITA_W.test(t)) return "receita";
  if (GASTO_W.test(t)) return "gasto";
  if (LANC_W.test(t)) return "lancamento";
  // Sem a palavra do tipo, só com nome E período ("remover o Uber de ontem").
  const f = extrairFiltro(texto, now);
  if (f.termo && f.range) return "lancamento";
  return null;
}

// ------------------------------------------- detector (restauração individual)
const REST_VERB = /\b(restaurar|restaura|restaure|recuperar|recupera|recupere|desfazer (a )?exclusao|desfaz (a )?exclusao|desexcluir)\b/;
const EXCLUIDOS_W = /\b(excluid[oa]s?|apagad[oa]s?|removid[oa]s?|apaguei|exclui|removi|deletad[oa]s?)\b/;
/** "restaurar um gasto excluído", "mostrar meus gastos excluídos", "desfazer a exclusão do mercado de ontem". */
export function detectRestauracaoAntiga(texto: string, now: Date = new Date()): EditarTipo | null {
  const t = norm(texto);
  if (!t) return null;
  const listar = /\b(mostrar|mostra|ver|listar|quais)\b/.test(t) && EXCLUIDOS_W.test(t);
  if (!REST_VERB.test(t) && !listar) return null;
  if (OUTROS_FLUXOS.test(t)) return null;
  if (RECEITA_W.test(t)) return "receita";
  if (GASTO_W.test(t)) return "gasto";
  if (LANC_W.test(t) || EXCLUIDOS_W.test(t) || /\bexclusao\b/.test(t)) return "lancamento";
  const f = extrairFiltro(texto, now);
  if (f.termo && f.range) return "lancamento";
  return null;
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
};
export type Filtro = {
  range: [string, string] | null;
  termo: string | null;
  periodoLabel: string | null;
  ambiguo?: boolean;
};
const STOP = new Set([
  "quero", "queria", "preciso", "gostaria", "por", "favor", "um", "uma", "uns", "umas", "o", "a", "os", "as",
  "do", "da", "de", "dos", "das", "no", "na", "em", "meu", "minha", "meus", "minhas", "esse", "essa", "este",
  "esta", "aquele", "aquela", "antigo", "antiga", "antigos", "antigas", "anterior", "passado", "passada",
  "mes", "ano", "dia", "feira", "valor", "descricao", "data", "nome", "lancamento", "lancamentos", "gasto",
  "gastos", "despesa", "despesas", "compra", "compras", "receita", "receitas", "renda", "rendas", "entrada",
  "entradas", "recebimento", "recebimentos", "hoje", "ontem", "anteontem", "pra", "para", "com", "que", "e",
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro",
  "novembro", "dezembro", "registrado", "registrada", "lancado", "lancada", "ai", "la",
  ...Object.keys(WEEKDAYS), ...Object.keys(WEEKDAYS).map((d) => `${d}-feira`),
]);

export function extrairFiltro(texto: string, now: Date): Filtro {
  const t = norm(texto);
  const today = todaySP(now);
  let range: [string, string] | null = null;
  let periodoLabel: string | null = null;
  const mes = detectMesNoTexto(texto, { now });
  if (mes.kind === "ambiguo") return { range: null, termo: null, periodoLabel: null, ambiguo: true };
  if (/\banteontem\b/.test(t)) { const d = shiftISO(today, -2); range = [d, d]; periodoLabel = dateBR(d); }
  else if (/\bontem\b/.test(t)) { const d = shiftISO(today, -1); range = [d, d]; periodoLabel = dateBR(d); }
  else if (/\bhoje\b/.test(t)) { range = [today, today]; periodoLabel = dateBR(today); }
  else {
    const wd = t.match(/\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)\b/);
    if (wd) {
      const target = WEEKDAYS[wd[1]];
      const cur = new Date(`${today}T12:00:00Z`).getUTCDay();
      let diff = (cur - target + 7) % 7;
      if (diff === 0) diff = 7; // "segunda" dita numa segunda = a anterior
      const d = shiftISO(today, -diff);
      range = [d, d]; periodoLabel = dateBR(d);
    } else {
      const dm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
      if (dm) {
        const p = parseData(dm[0]);
        if (p.matched) { range = [p.iso, p.iso]; periodoLabel = dateBR(p.iso); }
      } else if (mes.kind === "ok") {
        range = monthRange(mes.year, mes.month);
        periodoLabel = `${String(mes.month).padStart(2, "0")}/${mes.year}`;
      }
    }
  }
  const tokens = t.split(" ").filter((w) => w.length >= 3 && !STOP.has(w) && !EDIT_VERB.test(w) && !DEL_VERB.test(w) && !REST_VERB.test(w) && !EXCLUIDOS_W.test(w) && !["exclusao", "desfazer", "mostrar", "listar", "excluido", "excluida"].includes(w) && !/^\d+$/.test(w));
  return { range, termo: tokens.length ? tokens.join(" ") : null, periodoLabel };
}

// ----------------------------------------------------------- persistence
async function loadState(db: Db, userId: string, phone: string, now: Date): Promise<EditOldState | null> {
  const { data, error } = await db.from("whatsapp_messages").select("parsed, created_at")
    .eq("user_id", userId).eq("telefone", phone).eq("parsed->>kind", EDIT_OLD_KIND)
    .order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error("edit_old_state_read_failed");
  // Desempate por `seq` (passos gravados no mesmo milissegundo).
  const rows = (Array.isArray(data) ? data : []) as Array<{ parsed: EditOldState; created_at: string }>;
  const row = rows.sort((a, b) => (b.parsed?.seq ?? 0) - (a.parsed?.seq ?? 0) || String(b.created_at).localeCompare(String(a.created_at)))[0];
  const st = row?.parsed as EditOldState | undefined;
  if (!st || st.kind !== EDIT_OLD_KIND) return null;
  if (st.stage === "done" || st.stage === "applying") return st;
  if (Date.parse(st.expires_at) <= now.getTime()) return { ...st, stage: "done" };
  return st;
}

async function saveState(
  db: Db, userId: string, phone: string, externalId: string | null, text: string,
  st: EditOldState, resposta: string, now: Date,
): Promise<"ok" | "duplicate" | "error"> {
  const { error } = await db.from("whatsapp_messages").insert({
    user_id: userId, telefone: phone, external_id: externalId, texto: text,
    status: "sem_pendencia", parsed: st, resposta_sugerida: resposta,
    recebida_em: now.toISOString(), created_at: now.toISOString(),
  });
  if (!error) return "ok";
  return error.code === "23505" ? "duplicate" : "error";
}

const GASTO_COLS = "id, descricao, estabelecimento, valor, data, categoria_id, forma_pagamento, cartao_id, grupo_parcelamento_id, total_parcelas, recorrencia_id, bem_id, import_batch_id, updated_at, deleted_at";
const RECEITA_COLS = "id, descricao, valor, data, recorrencia_id, import_batch_id, updated_at, deleted_at";

type Row = Record<string, unknown>;
function allowedFor(t: Tbl, r: Row): Field[] | string {
  if (r.import_batch_id) return "Lançamentos importados seguem a conciliação da importação. Edite esse pelo site ou app.";
  if (t === "gastos") {
    if (r.grupo_parcelamento_id || Number(r.total_parcelas ?? 1) > 1) return "Compras parceladas mexem em todas as parcelas e na fatura. Edite essa pelo site ou app.";
    if (r.recorrencia_id) return "Gastos recorrentes seguem as regras da recorrência. Edite esse pelo site ou app.";
    if (r.bem_id) return "Pagamentos ligados a bens e financiamentos seguem regras próprias. Edite esse pelo site ou app.";
    if (r.cartao_id || r.forma_pagamento === "credito") return ["descricao", "categoria_id"];
    return ["valor", "descricao", "data", "categoria_id"];
  }
  return ["valor", "descricao", "data"];
}

/**
 * Exclusão individual: só tipos com exclusão reversível segura. Retorna o
 * motivo do bloqueio (texto ao usuário) ou null quando pode excluir.
 */
async function deleteBlock(db: Db, userId: string, t: Tbl, r: Row): Promise<string | null> {
  const site = "Exclua esse pelo site ou app.";
  if (t === "gastos") {
    if (r.grupo_parcelamento_id || Number(r.total_parcelas ?? 1) > 1) return `Compras parceladas envolvem todas as parcelas e a fatura. ${site}`;
    if (r.recorrencia_id) return `Gastos recorrentes seguem as regras da recorrência. ${site}`;
    if (r.bem_id) return `Pagamentos ligados a bens e financiamentos seguem regras próprias. ${site}`;
    if (r.cartao_id || r.forma_pagamento === "credito") return `Gastos no cartão de crédito afetam a fatura e o limite. ${site}`;
    if (r.import_batch_id) return `Lançamentos importados de extrato seguem a importação. ${site}`;
    const { data, error } = await db.from("contas_a_pagar").select("id").eq("user_id", userId).eq("gasto_id", String(r.id)).limit(1);
    if (error) throw new Error("delete_old_link_read_failed");
    if (Array.isArray(data) && data.length > 0) return `Esse gasto é o pagamento de uma conta a pagar. ${site}`;
    return null;
  }
  if (r.recorrencia_id) return `Receitas recorrentes seguem as regras da recorrência. ${site}`;
  if (r.import_batch_id) return `Lançamentos importados de extrato seguem a importação. ${site}`;
  return null;
}

/** soft-delete-exceção: lê um lançamento EXCLUÍDO do próprio usuário (restauração). */
async function readDeletedRow(db: Db, userId: string, t: Tbl, id: string): Promise<Row | null> {
  const { data, error } = await db.from(t).select(t === "gastos" ? GASTO_COLS : RECEITA_COLS)
    .eq("id", id).eq("user_id", userId).not("deleted_at", "is", null).maybeSingle();
  if (error) throw new Error("restore_old_row_read_failed");
  return (data as Row) ?? null;
}

async function readRow(db: Db, userId: string, t: Tbl, id: string): Promise<Row | null> {
  const { data, error } = await db.from(t).select(t === "gastos" ? GASTO_COLS : RECEITA_COLS)
    .eq("id", id).eq("user_id", userId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error("edit_old_row_read_failed");
  return (data as Row) ?? null;
}

async function buscar(db: Db, userId: string, tipo: EditarTipo, f: Filtro, now: Date, excluidos = false): Promise<Array<Row & { _t: Tbl }>> {
  const range = f.range ?? [shiftISO(todaySP(now), -365), todaySP(now)];
  const tables: Tbl[] = tipo === "receita" ? ["receitas"] : tipo === "gasto" ? ["gastos"] : ["gastos", "receitas"];
  const out: Array<Row & { _t: Tbl }> = [];
  for (const t of tables) {
    // soft-delete-exceção: na restauração lê SOMENTE os excluídos do próprio usuário.
    let q = db.from(t).select(t === "gastos" ? GASTO_COLS : RECEITA_COLS).eq("user_id", userId);
    q = excluidos ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
    const { data, error } = await q
      .gte("data", range[0]).lte("data", range[1])
      .order("data", { ascending: false }).limit(200);
    if (error) throw new Error("edit_old_search_failed");
    for (const r of (Array.isArray(data) ? data : []) as Row[]) out.push({ ...r, _t: t });
  }
  const byDate = (a: Row, b: Row) => String(b.data).localeCompare(String(a.data));
  if (!f.termo) return out.sort(byDate).slice(0, 40);
  return rankPorTermo(out, f.termo).slice(0, 40);
}

/** Chave de comparação: sem acento/caixa/pontuação e sem palavras vazias. */
function chaveDescricao(s: string): string {
  return norm(s).split(" ").filter((w) => w && !STOP.has(w)).join(" ");
}

/**
 * P1 — busca por descrição em camadas (nunca autoriza nada; só ordena candidatos):
 * 1) exata (descrição normalizada == termo) → somente as exatas;
 * 2) contém todas as palavras do termo;
 * 3) parcial (alguma palavra), mais palavras primeiro.
 */
export function rankPorTermo<R extends object>(rows: R[], termo: string): R[] {
  const v = (r: R, k: string) => (r as Record<string, unknown>)[k];
  const byDate = (a: R, b: R) => String(v(b, "data")).localeCompare(String(v(a, "data")));
  const alvo = chaveDescricao(termo);
  if (!alvo) return [...rows].sort(byDate);
  const exatas = rows.filter((r) => chaveDescricao(String(v(r, "descricao") ?? "")) === alvo || (!!v(r, "estabelecimento") && chaveDescricao(String(v(r, "estabelecimento"))) === alvo));
  if (exatas.length) return exatas.sort(byDate);
  const palavras = alvo.split(" ").map((w) => (w.length > 3 ? w.replace(/s$/, "") : w));
  const scored = rows.map((r) => {
    const h = norm(`${v(r, "descricao") ?? ""} ${v(r, "estabelecimento") ?? ""}`);
    return { r, n: palavras.filter((w) => h.includes(w)).length };
  }).filter((x) => x.n > 0);
  scored.sort((a, b) => b.n - a.n || byDate(a.r, b.r));
  const todas = scored.filter((x) => x.n === palavras.length);
  return (todas.length ? todas : scored).map((x) => x.r);
}

// ------------------------------------------------------------- rendering
function rowLabel(r: { _t?: Tbl; t?: Tbl; descricao?: unknown; valor?: unknown; data?: unknown }) {
  const tipo = (r._t ?? r.t) === "receitas" ? "Receita" : "Gasto";
  return { title: String(r.descricao ?? "Lançamento").slice(0, 24), desc: `${tipo} · ${brl(Number(r.valor ?? 0))} · ${dateBR(String(r.data ?? ""))}` };
}
const btns = (body: string, rows: Array<{ id: string; title: string }>) => toGraphInteractive({ type: "button", body, buttons: rows });

function renderList(st: EditOldState, rows: Array<{ t: Tbl; descricao: unknown; valor: unknown; data: unknown; id: string }>, header: string): EditOldReply {
  const page = st.page ?? 0;
  const slice = rows.slice(page * EDIT_OLD_PAGE, (page + 1) * EDIT_OLD_PAGE);
  const hasMore = rows.length > (page + 1) * EDIT_OLD_PAGE;
  const lines = slice.map((r, i) => {
    const l = rowLabel(r);
    return `${page * EDIT_OLD_PAGE + i + 1}. ${String(r.descricao ?? "Lançamento")} — ${l.desc}`;
  });
  const body = [header, "", ...lines, "", "Escolha na lista ou responda com o número.", hasMore ? "Digite “mais” para ver outros." : "", "Digite “cancelar” para sair."].filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== "")).join("\n").trim();
  const listRows = slice.map((r) => { const l = rowLabel(r); return { id: `wa_ed:${st.nonce}:sel:${r.id}`, title: l.title, description: l.desc.slice(0, 72) }; });
  if (hasMore) listRows.push({ id: `wa_ed:${st.nonce}:pg:${page + 1}`, title: "Ver mais", description: "Próximos lançamentos" });
  return { resposta: body, graphInteractive: toGraphInteractive({ type: "list", body: body.slice(0, 1024), buttonText: "Escolher", rows: listRows }) };
}

function renderFieldMenu(st: EditOldState): EditOldReply {
  const s = st.sel!;
  const head = `${s.descricao} — ${brl(s.valor)} — ${dateBR(s.data)}`;
  const body = `${head}\n\nO que você quer alterar?\n${s.allowed.map((f) => `• ${FIELD_LABEL[f]}`).join("\n")}\n\nDigite “cancelar” para sair.`;
  const rows = s.allowed.map((f) => ({ id: `wa_ed:${st.nonce}:f:${f}`, title: FIELD_LABEL[f] }));
  rows.push({ id: `wa_ed:${st.nonce}:x`, title: "Cancelar" });
  return { resposta: body, graphInteractive: toGraphInteractive({ type: "list", body, buttonText: "Escolher", rows }) };
}

function askValue(st: EditOldState): EditOldReply {
  const f = st.field!;
  const q = f === "valor" ? "Qual é o novo valor? (ex.: 65,00)"
    : f === "descricao" ? "Qual é a nova descrição?"
    : f === "data" ? "Qual é a nova data? (ex.: 12/09/2026, ontem)"
    : "Qual é a nova categoria? (escreva o nome)";
  return { resposta: `${q}\n\nDigite “cancelar” para sair.` };
}

function renderConfirm(st: EditOldState): EditOldReply {
  const s = st.sel!; const p = st.patch!;
  const nome = FIELD_LABEL[p.field].toLowerCase();
  const body = [
    `Lançamento: ${s.descricao}`,
    `${FIELD_LABEL[p.field]} atual: ${p.beforeLabel}`,
    `Nov${p.field === "data" || p.field === "descricao" || p.field === "categoria_id" ? "a" : "o"} ${nome}: ${p.label}`,
    "",
    "Deseja confirmar a alteração?",
  ].join("\n");
  return { resposta: body, graphInteractive: btns(body, [
    { id: `wa_ed:${st.nonce}:ok`, title: "Confirmar" },
    { id: `wa_ed:${st.nonce}:adj`, title: "Ajustar" },
    { id: `wa_ed:${st.nonce}:x`, title: "Cancelar" },
  ]) };
}

// ------------------------------------------------------------- proposal
async function proposal(db: Db, userId: string, s: Snap, field: Field, raw: string): Promise<Patch | string> {
  const v = raw.trim();
  if (field === "descricao") {
    if (v.length < 2 || v.length > 80) return "A descrição precisa ter entre 2 e 80 caracteres.";
    return { field, value: v, label: v, beforeLabel: s.descricao };
  }
  if (field === "valor") {
    const parsed = parseValor(v);
    const ok = validateFinancialAmount(parsed);
    if (!ok.ok) return "Não reconheci o valor. Envie só o número, por exemplo 65,00.";
    return { field, value: ok.value.toFixed(2), label: brl(ok.value), beforeLabel: brl(s.valor) };
  }
  if (field === "data") {
    const p = parseData(v);
    if (!p.matched || !/^\d{4}-\d{2}-\d{2}$/.test(p.iso)) return "Não reconheci a data. Envie no formato 12/09/2026.";
    const [y, m, d] = p.iso.split("-").map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !== p.iso) return "Essa data não existe. Envie no formato 12/09/2026.";
    return { field, value: p.iso, label: dateBR(p.iso), beforeLabel: dateBR(s.data) };
  }
  const { data, error } = await db.from("categorias").select("id, nome").eq("user_id", userId);
  if (error) throw new Error("edit_old_categorias_failed");
  const all = (Array.isArray(data) ? data : []) as Array<{ id: string; nome: string }>;
  const hits = all.filter((c) => norm(c.nome) === norm(v));
  if (hits.length !== 1) return "Não encontrei essa categoria. Escreva o nome exatamente como aparece no app.";
  const before = all.find((c) => c.id === s.categoria_id)?.nome ?? "Sem categoria";
  return { field, value: hits[0].id, label: hits[0].nome, beforeLabel: before };
}

/** UPDATE condicional (controle otimista). Retorna o resultado real. */
export async function aplicarEdicao(db: Db, userId: string, s: Snap, p: Patch, now: Date):
  Promise<"updated" | "already" | "changed" | "deleted" | "error"> {
  const patch: Record<string, unknown> = { updated_at: now.toISOString() };
  if (p.field === "valor") patch.valor = Number(p.value);
  else if (p.field === "descricao") patch.descricao = p.value;
  else if (p.field === "categoria_id") patch.categoria_id = p.value;
  else if (p.field === "data") {
    const [y, m] = p.value.split("-").map(Number);
    patch.data = p.value; patch.mes = m; patch.ano = y;
    if (s.t === "gastos") patch.invoice_month = p.value.slice(0, 7);
  }
  if (!s.allowed.includes(p.field)) return "error";
  const { data, error } = await db.from(s.t).update(patch)
    .eq("id", s.id).eq("user_id", userId).eq("updated_at", s.updated_at).is("deleted_at", null)
    .select("id").maybeSingle();
  if (error) return "error";
  if (data?.id) return "updated";
  // 0 linhas: descobrir por quê, sem escrever nada.
  let cur: Row | null;
  try { cur = await readRow(db, userId, s.t, s.id); } catch { return "error"; }
  if (!cur) return "deleted";
  const curVal = p.field === "valor" ? Number(cur.valor).toFixed(2) : String(cur[p.field] ?? "");
  if (curVal === p.value) return "already";
  return "changed";
}

/**
 * Exclusão reversível (deleted_at), com controle otimista. Nunca DELETE físico.
 * "gone" = já excluído ou inexistente; "changed" = alterado no site depois da escolha.
 */
export async function aplicarExclusao(db: Db, userId: string, s: Snap, now: Date, phone?: string, requestId?: string):
  Promise<"deleted" | "gone" | "changed" | "blocked" | "error"> {
  let cur: Row | null;
  try { cur = await readRow(db, userId, s.t, s.id); } catch { return "error"; }
  if (!cur) return "gone";
  if (String(cur.updated_at ?? "") !== s.updated_at) return "changed";
  try { if (await deleteBlock(db, userId, s.t, cur)) return "blocked"; } catch { return "error"; }
  if (process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION !== "2" || !phone || !requestId) return "blocked";
  const { data, error } = await db.rpc("whatsapp_entry_mutate_v2", {
    p_user_id: userId, p_phone: phone, p_table: s.t, p_id: s.id,
    p_expected_at: s.updated_at, p_operation: "delete", p_request_id: requestId,
  });
  return !error && ["deleted", "gone", "changed", "blocked"].includes(data) ? data : "error";
}

/**
 * Restauração (deleted_at → NULL) com controle otimista. Não cria lançamento novo.
 * "already" = já estava ativo; "gone" = não existe/não é do usuário.
 */
export async function aplicarRestauracao(db: Db, userId: string, s: Snap, now: Date, phone?: string, requestId?: string):
  Promise<"restored" | "already" | "gone" | "changed" | "blocked" | "error"> {
  let cur: Row | null;
  try { cur = await readDeletedRow(db, userId, s.t, s.id); } catch { return "error"; }
  if (!cur) {
    try { return (await readRow(db, userId, s.t, s.id)) ? "already" : "gone"; } catch { return "error"; }
  }
  if (String(cur.updated_at ?? "") !== s.updated_at) return "changed";
  try { if (await deleteBlock(db, userId, s.t, cur)) return "blocked"; } catch { return "error"; }
  if (process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION !== "2" || !phone || !requestId) return "blocked";
  const { data, error } = await db.rpc("whatsapp_entry_mutate_v2", {
    p_user_id: userId, p_phone: phone, p_table: s.t, p_id: s.id,
    p_expected_at: s.updated_at, p_operation: "restore", p_request_id: requestId,
  });
  return !error && ["restored", "already", "gone", "changed", "blocked"].includes(data) ? data : "error";
}

function renderRestConfirm(st: EditOldState): EditOldReply {
  const s = st.sel!;
  const body = [
    "Você vai restaurar este lançamento excluído:",
    `${s.t === "gastos" ? "Gasto" : "Receita"}: ${s.descricao}`,
    `Valor: ${brl(s.valor)}`,
    `Data: ${dateBR(s.data)}`,
    "",
    "Ele volta a aparecer nas consultas e nos totais do site, do app e do WhatsApp.",
    "Deseja confirmar a restauração?",
  ].join("\n");
  return { resposta: body, graphInteractive: btns(body, [
    { id: `wa_ed:${st.nonce}:rst`, title: "Confirmar" },
    { id: `wa_ed:${st.nonce}:x`, title: "Cancelar" },
  ]) };
}

function renderDelConfirm(st: EditOldState): EditOldReply {
  const s = st.sel!;
  const body = [
    "Você vai excluir este lançamento:",
    `${s.t === "gastos" ? "Gasto" : "Receita"}: ${s.descricao}`,
    `Valor: ${brl(s.valor)}`,
    `Data: ${dateBR(s.data)}`,
    "",
    "Ele deixa de aparecer nas consultas e nos totais do site, do app e do WhatsApp.",
    "Deseja confirmar a exclusão?",
  ].join("\n");
  return { resposta: body, graphInteractive: btns(body, [
    { id: `wa_ed:${st.nonce}:del`, title: "Confirmar" },
    { id: `wa_ed:${st.nonce}:bk`, title: "Voltar" },
    { id: `wa_ed:${st.nonce}:x`, title: "Cancelar" },
  ]) };
}

// ----------------------------------------------------------------- main
const RESET = /^(cancelar|cancela|sair|voltar|menu|parar)$/;
/** Novo LANÇAMENTO no meio da edição: pergunta antes de abandonar (14/10). */
const NEW_ENTRY = /^(gastei|paguei|comprei|recebi|ganhei|lancar|registrar|anotar)\b/;
/** Consulta no meio da edição: encerra (só leitura) e segue para o fluxo normal. */
const NEW_QUERY = /^(minhas?|meus?|quanto|qual|quais)\b/;
/** "Ver mais" só quando a mensagem inteira é o pedido de paginação. */
export const MORE_CMD = /^(mais|ver mais|mostrar mais|mostra mais|mais opcoes|mais lancamentos|proxima|proxima pagina|proximos|proximas)[.!]?$/;

function renderInterrupt(st: EditOldState): EditOldReply {
  const resposta = "Você está editando um lançamento. Quer abandonar a edição e iniciar um novo lançamento?\n\n1. Continuar edição\n2. Iniciar novo lançamento\n3. Cancelar\n\nNada foi criado ou alterado até você escolher.";
  return {
    resposta,
    graphInteractive: {
      type: "button",
      body: { text: resposta },
      action: { buttons: [
        { type: "reply", reply: { id: `wa_ed:${st.nonce}:cont`, title: "Continuar edição" } },
        { type: "reply", reply: { id: `wa_ed:${st.nonce}:novo`, title: "Novo lançamento" } },
        { type: "reply", reply: { id: `wa_ed:${st.nonce}:x`, title: "Cancelar" } },
      ] },
    },
  };
}

export async function handleEdicaoAntiga(args: {
  userId: string; phone: string; externalId: string | null; text: string;
  /** true quando não há outra sessão ativa e o pipeline permite iniciar um fluxo novo. */
  podeIniciar: boolean;
}, deps: EditOldDeps = {}): Promise<EditOldReply | null> {
  const db = deps.db ?? defaultDb;
  const now = (deps.now ?? (() => new Date()))();
  const mkNonce = deps.nonce ?? randNonce;
  const { userId, phone, externalId, text } = args;
  const tok = TOKEN.exec(text.trim());
  const t = norm(text);

  let st: EditOldState | null;
  try { st = await loadState(db, userId, phone, now); } catch {
    return tok ? { resposta: "Não consegui continuar a edição agora. Tente novamente daqui a pouco." } : null;
  }
  const active = st && st.stage !== "done" && st.stage !== "applying" ? st : null;

  const save = async (next: EditOldState, reply: EditOldReply): Promise<EditOldReply> => {
      const r = await saveState(db, userId, phone, externalId, text, next, reply.resposta, now);
    if (r === "duplicate") return { resposta: "Mensagem já processada anteriormente." };
    if (r === "error") return { resposta: "Não consegui continuar a edição agora. Nada foi alterado. Tente novamente." };
    return reply;
  };
  const step = (base: EditOldState, patch: Partial<EditOldState>): EditOldState => ({
    ...base, ...patch, seq: (base.seq ?? 0) + 1, nonce: mkNonce(), expires_at: new Date(now.getTime() + EDIT_OLD_TTL_MS).toISOString(),
  });
  const close = (base: EditOldState, resposta: string) =>
    save({ ...base, stage: "done", seq: (base.seq ?? 0) + 1, nonce: mkNonce() }, { resposta });

  // 1) Botão/lista deste fluxo.
  if (tok) {
    if (!active || active.nonce !== tok[1]) {
      return { resposta: "Essa opção expirou ou já foi usada. Nada foi alterado. Para editar, envie de novo, por exemplo: “editar gasto de setembro”." };
    }
    return continuar(active, tok[2], tok[3] ?? null);
  }

  // 2) Texto livre dentro de um fluxo ativo.
  if (active) {
    const del = active.acao === "excluir";
    if (active.acao === "restaurar" && RESET.test(t)) return close(active, "Tudo bem, restauração cancelada. Nenhum lançamento foi alterado.");
    if (del && active.stage === "confirm" && t === "voltar") return continuar(active, "bk", null);
    if (RESET.test(t)) return close(active, del ? "Tudo bem, exclusão cancelada. Nenhum lançamento foi alterado." : "Tudo bem, edição cancelada. Nenhum lançamento foi alterado.");
    if (active.stage === "interrupt") return continuar(active, "text", null);
    if (NEW_ENTRY.test(t)) {
      // Não descarta a edição: guarda o pedido e pergunta. Nada é gravado em gastos/receitas.
      const next = step(active, { stage: "interrupt", resume: active.stage as EditOldState["resume"], pending_text: text.trim().slice(0, 1000) });
      return save(next, renderInterrupt(next));
    }
    if (NEW_QUERY.test(t) && active.stage !== "value" && active.stage !== "periodo") {
      await saveState(db, userId, phone, null, text, { ...active, stage: "done", seq: (active.seq ?? 0) + 1, nonce: mkNonce() }, "", now);
      return null; // segue para o fluxo normal (cadastro/consulta)
    }
    return continuar(active, "text", null);
  }

  // 3) Início de um fluxo novo.
  if (!args.podeIniciar) return null;
  const tipoEd = detectEdicaoAntiga(text);
  const tipoRst = tipoEd ? null : detectRestauracaoAntiga(text, now);
  const tipoDel = tipoEd || tipoRst ? null : detectExclusaoAntiga(text, now);
  const tipo = tipoEd ?? tipoRst ?? tipoDel;
  if (!tipo) return null;
  const acao: "editar" | "excluir" | "restaurar" = tipoRst ? "restaurar" : tipoDel ? "excluir" : "editar";
  if (acao === "excluir" && BULK_DEL.test(t)) {
    return { resposta: "Por aqui eu excluo um lançamento por vez. Diga qual, por exemplo: “excluir o Uber de ontem” ou “excluir um gasto de outubro de 2026”.\n\nNada foi alterado." };
  }
  // `seq` continua a sequência anterior: o passo mais recente sempre vence.
  const base: EditOldState = { kind: EDIT_OLD_KIND, stage: "periodo", nonce: "", expires_at: "", tipo, acao, seq: st?.seq ?? 0 };
  const f = extrairFiltro(text, now);
  if (f.ambiguo) return save(step(base, { stage: "periodo" }), { resposta: "Você citou mais de um mês. De qual mês é o lançamento? (ex.: setembro de 2026)\n\nDigite “cancelar” para sair." });
  if (!f.range && !f.termo && acao !== "restaurar") {
    return save(step(base, { stage: "periodo" }), { resposta: "Certo! De quando é o lançamento? Pode responder com o mês (ex.: setembro de 2026), “ontem” ou o nome, como “mercado”.\n\nNenhum lançamento foi criado ou alterado." });
  }
  return buscarEMostrar(base, f);

  // ---------------------------------------------------------- internals
  async function buscarEMostrar(base: EditOldState, f: Filtro): Promise<EditOldReply> {
    let rows;
    try { rows = await buscar(db, userId, base.tipo, f, now, base.acao === "restaurar"); } catch {
      return { resposta: "Não consegui buscar seus lançamentos agora. Nada foi alterado. Tente novamente." };
    }
    const nome = base.tipo === "receita" ? "receita" : base.tipo === "gasto" ? "gasto" : "lançamento";
    const onde = [f.termo ? `“${f.termo}”` : null, f.periodoLabel ? `em ${f.periodoLabel}` : null].filter(Boolean).join(" ");
    if (rows.length === 0 && base.acao === "restaurar") {
      return close({ ...base, nonce: "", expires_at: "" }, `Não encontrei nenhum ${nome} excluído${onde ? ` ${onde}` : ""} na sua conta. Nada foi alterado.`);
    }
    if (rows.length === 0) {
      return close({ ...base, nonce: "", expires_at: "" }, `Não encontrei nenhum ${nome}${onde ? ` ${onde}` : ""} na sua conta. Nada foi alterado.\n\nTente outro mês ou nome, por exemplo: “editar gasto de agosto de 2026”.`);
    }
    const cands: Cand[] = rows.map((r) => ({ t: r._t, id: String(r.id) }));
    if (rows.length === 1) return selecionar(step(base, { stage: "select", cands, page: 0, termo: f.termo }), cands[0]);
    const next = step(base, { stage: "select", cands, page: 0, termo: f.termo });
    const reply = renderList(next, rows.map((r) => ({ t: r._t, id: String(r.id), descricao: r.descricao, valor: r.valor, data: r.data })),
      `Encontrei ${rows.length} ${rows.length === 1 ? nome : `${nome}s`}${base.acao === "restaurar" ? (rows.length === 1 ? " excluído" : " excluídos") : ""}${onde ? ` ${onde}` : ""}. Qual você quer ${base.acao === "excluir" ? "excluir" : base.acao === "restaurar" ? "restaurar" : "editar"}?`);
    return save(next, reply);
  }

  async function selecionar(cur: EditOldState, c: Cand): Promise<EditOldReply> {
    if (cur.acao === "restaurar") {
      let row: Row | null; let block: string | null = null;
      try {
        row = await readDeletedRow(db, userId, c.t, c.id);
        if (row) block = await deleteBlock(db, userId, c.t, row);
      } catch { return { resposta: "Não consegui abrir esse lançamento agora. Nada foi alterado. Tente novamente." }; }
      if (!row) return close(cur, "Esse lançamento não está mais na lista de excluídos (pode já ter sido restaurado). Nada foi alterado.");
      if (block) return close(cur, `${block.replace("Exclua esse", "Restaure esse")}\n\nNada foi alterado.`);
      const sel: Snap = {
        t: c.t, id: c.id, updated_at: String(row.updated_at ?? ""),
        descricao: String(row.descricao ?? "Lançamento"), valor: Number(row.valor ?? 0),
        data: String(row.data ?? ""), categoria_id: (row.categoria_id as string | null) ?? null, allowed: [],
      };
      const next = step(cur, { stage: "confirm", sel });
      return save(next, renderRestConfirm(next));
    }
    let row: Row | null;
    try { row = await readRow(db, userId, c.t, c.id); } catch {
      return { resposta: "Não consegui abrir esse lançamento agora. Nada foi alterado. Tente novamente." };
    }
    if (!row) return close(cur, "Esse lançamento não está mais disponível (pode ter sido excluído). Nada foi alterado.");
    if (cur.acao === "excluir") {
      let block: string | null;
      try { block = await deleteBlock(db, userId, c.t, row); } catch {
        return { resposta: "Não consegui conferir esse lançamento agora. Nada foi alterado. Tente novamente." };
      }
      if (block) return close(cur, `${block}\n\nNada foi alterado.`);
      const sel: Snap = {
        t: c.t, id: c.id, updated_at: String(row.updated_at ?? ""),
        descricao: String(row.descricao ?? "Lançamento"), valor: Number(row.valor ?? 0),
        data: String(row.data ?? ""), categoria_id: (row.categoria_id as string | null) ?? null, allowed: [],
      };
      // Mantém `cands` para o botão Voltar reabrir a mesma lista.
      const next = step(cur, { stage: "confirm", sel });
      return save(next, renderDelConfirm(next));
    }
    const allowed = allowedFor(c.t, row);
    if (typeof allowed === "string") return close(cur, `${allowed}\n\nNada foi alterado.`);
    const sel: Snap = {
      t: c.t, id: c.id, updated_at: String(row.updated_at ?? ""),
      descricao: String(row.descricao ?? "Lançamento"), valor: Number(row.valor ?? 0),
      data: String(row.data ?? ""), categoria_id: (row.categoria_id as string | null) ?? null, allowed,
    };
    const next = step(cur, { stage: "field", sel, cands: undefined });
    const reply = renderFieldMenu(next);
    if (c.t === "gastos" && !allowed.includes("valor")) reply.resposta += "\n\nGasto no cartão de crédito: valor e data afetam a fatura e só podem ser alterados pelo site ou app.";
    if (c.t === "receitas" && row.recorrencia_id) reply.resposta += "\n\nReceita recorrente: só esta ocorrência será alterada.";
    return save(next, reply);
  }

  async function continuar(cur: EditOldState, cmd: string, arg: string | null): Promise<EditOldReply> {
    if (cmd === "x" && cur.acao === "restaurar") return close(cur, "Tudo bem, restauração cancelada. Nenhum lançamento foi alterado.");
    if (cmd === "x") return close(cur, cur.acao === "excluir" ? "Tudo bem, exclusão cancelada. Nenhum lançamento foi alterado." : "Tudo bem, edição cancelada. Nenhum lançamento foi alterado.");

    if (cur.stage === "interrupt") {
      const c = cmd === "text" ? (/^(1|continuar|continuar edicao|continua)$/.test(t) ? "cont" : /^(2|iniciar|novo|novo lancamento|iniciar novo lancamento)$/.test(t) ? "novo" : /^3$/.test(t) ? "x" : "") : cmd;
      if (c === "x") return close(cur, "Tudo bem, edição cancelada. Nenhum lançamento foi criado ou alterado.");
      if (c === "cont" && cur.resume) {
        const back: EditOldState = { ...cur, stage: cur.resume, resume: undefined, pending_text: undefined };
        const next = step(back, {});
        const reply = next.stage === "field" ? renderFieldMenu(next)
          : next.stage === "value" ? askValue(next)
          : next.stage === "confirm" ? (next.acao === "excluir" ? renderDelConfirm(next) : next.acao === "restaurar" ? renderRestConfirm(next) : renderConfirm(next))
          : next.stage === "select" ? { resposta: "Certo, edição retomada. Responda com o número do lançamento da lista anterior, “mais” para ver outros ou “cancelar”." }
          : { resposta: "Certo, edição retomada. De quando é o lançamento? (ex.: setembro de 2026)" };
        return save(next, reply);
      }
      if (c === "novo" && cur.pending_text) {
        // Sem external_id: o identificador da mensagem fica livre para a sessão do cadastro.
        const r = await saveState(db, userId, phone, null, text, { ...cur, stage: "done", seq: (cur.seq ?? 0) + 1, nonce: mkNonce() }, "", now);
        if (r === "error") return { resposta: "Não consegui iniciar o novo lançamento agora. Nada foi criado ou alterado. Tente novamente." };
        return { resposta: "", replayText: cur.pending_text };
      }
      const again = step(cur, {});
      return save(again, renderInterrupt(again));
    }

    if (cur.stage === "periodo") {
      const f = extrairFiltro(text, now);
      if (f.ambiguo || (!f.range && !f.termo)) return save(step(cur, {}), { resposta: "Não entendi o período. Responda com o mês (ex.: setembro de 2026), “ontem” ou o nome do lançamento.\n\nDigite “cancelar” para sair." });
      return buscarEMostrar(cur, f);
    }

    if (cur.stage === "select") {
      const cands = cur.cands ?? [];
      if (cmd === "pg" || (cmd === "text" && MORE_CMD.test(t))) {
        const page = cmd === "pg" ? Number(arg) : (cur.page ?? 0) + 1;
        if (!Number.isInteger(page) || page < 0 || page * EDIT_OLD_PAGE >= cands.length) return save(step(cur, {}), { resposta: "Não há mais lançamentos nesta busca. Escolha um da lista ou digite “cancelar”." });
        const rows: Array<{ t: Tbl; id: string; descricao: unknown; valor: unknown; data: unknown }> = [];
        const rd = cur.acao === "restaurar" ? readDeletedRow : readRow;
        for (const c of cands) {
          try { const r = await rd(db, userId, c.t, c.id); if (r) rows.push({ t: c.t, id: c.id, descricao: r.descricao, valor: r.valor, data: r.data }); } catch { /* omitido */ }
        }
        const next = step(cur, { page, cands: rows.map((r) => ({ t: r.t, id: r.id })) });
        return save(next, renderList(next, rows, "Mais lançamentos:"));
      }
      let chosen: Cand | undefined;
      if (cmd === "sel") chosen = cands.find((c) => c.id === arg);
      else if (cmd === "text" && /^\d{1,2}$/.test(t)) chosen = cands[Number(t) - 1];
      if (!chosen) return save(step(cur, {}), { resposta: "Não identifiquei o lançamento. Responda com o número da lista ou digite “cancelar”." });
      return selecionar(cur, chosen);
    }

    if (cur.stage === "field") {
      const s = cur.sel!;
      let field: Field | null = null;
      if (cmd === "f") field = (arg as Field) ?? null;
      else if (cmd === "text") {
        if (/\b(valor|preco|quantia)\b/.test(t)) field = "valor";
        else if (/\b(descricao|nome)\b/.test(t)) field = "descricao";
        else if (/\b(data|dia)\b/.test(t)) field = "data";
        else if (/\bcategoria\b/.test(t)) field = "categoria_id";
      }
      if (!field || !s.allowed.includes(field)) {
        const reply = renderFieldMenu(cur);
        reply.resposta = `Esse campo não pode ser alterado por aqui.\n\n${reply.resposta}`;
        return reply;
      }
      return save(step(cur, { stage: "value", field }), askValue({ ...cur, field }));
    }

    if (cur.stage === "value") {
      if (cmd !== "text") return save(step(cur, {}), askValue(cur));
      let p: Patch | string;
      try { p = await proposal(db, userId, cur.sel!, cur.field!, text); } catch {
        return { resposta: "Não consegui validar agora. Nada foi alterado. Tente novamente." };
      }
      if (typeof p === "string") return save(step(cur, {}), { resposta: `${p}\n\nDigite “cancelar” para sair.` });
      const next = step(cur, { stage: "confirm", patch: p });
      return save(next, renderConfirm(next));
    }

    if (cur.stage === "confirm" && cur.acao === "restaurar") {
      const yes = cmd === "rst" || (cmd === "text" && /^(sim|confirmar|confirmo|restaurar|pode)$/.test(t));
      if (!yes) return save(step(cur, {}), renderRestConfirm(cur));
      // Consome o estado ANTES de escrever: confirmação repetida/replay não reaplica.
      const claim = await saveState(db, userId, phone, externalId, text, { ...cur, stage: "applying", seq: (cur.seq ?? 0) + 1, nonce: mkNonce() }, "", now);
      if (claim === "duplicate") return { resposta: "Mensagem já processada anteriormente." };
      if (claim === "error") return { resposta: "Não consegui restaurar agora. Nada foi alterado. Tente novamente." };
      const s = cur.sel!;
      const r = await aplicarRestauracao(db, userId, s, now, phone, `restore:${cur.nonce}`);
      const resposta = r === "restored"
        ? `♻️ ${s.t === "gastos" ? "Gasto restaurado" : "Receita restaurada"}\n${s.descricao} — ${brl(s.valor)} — ${dateBR(s.data)}\nEle voltou para as consultas e os totais.`
        : r === "already" ? "Esse lançamento já estava ativo. Nada foi alterado."
        : r === "gone" ? "Não encontrei esse lançamento na sua conta. Nada foi alterado."
        : r === "changed" ? "Esse lançamento mudou depois que você o escolheu. Para não restaurar algo diferente, não fiz nada. Envie o pedido de novo."
        : r === "blocked" ? "Esse lançamento tem vínculos que não podem ser restaurados por aqui. Use o site ou app. Nada foi alterado."
        : "Não consegui restaurar agora. Nada foi alterado. Tente novamente.";
      await saveState(db, userId, phone, null, "", { ...cur, stage: "done", seq: (cur.seq ?? 0) + 2, nonce: mkNonce() }, resposta, now);
      return { resposta };
    }

    if (cur.stage === "confirm" && cur.acao === "excluir") {
      if (cmd === "bk" || (cmd === "text" && /^(voltar|volta)$/.test(t))) {
        const cands = cur.cands ?? [];
        if (cands.length > 1) {
          const rows: Array<{ t: Tbl; id: string; descricao: unknown; valor: unknown; data: unknown }> = [];
          for (const c of cands) {
            try { const r = await readRow(db, userId, c.t, c.id); if (r) rows.push({ t: c.t, id: c.id, descricao: r.descricao, valor: r.valor, data: r.data }); } catch { /* omitido */ }
          }
          const next = step(cur, { stage: "select", sel: undefined, page: 0, cands: rows.map((r) => ({ t: r.t, id: r.id })) });
          return save(next, renderList(next, rows, "Qual você quer excluir?"));
        }
        return save(step(cur, { stage: "periodo", sel: undefined, cands: undefined }), { resposta: "Certo. De quando é o lançamento que você quer excluir? (ex.: setembro de 2026, ontem ou o nome)\n\nNada foi alterado." });
      }
      const yes = cmd === "del" || (cmd === "text" && /^(sim|confirmar|confirmo|excluir|pode)$/.test(t));
      if (!yes) return save(step(cur, {}), renderDelConfirm(cur));
      // Consome o estado ANTES de escrever: confirmação repetida/replay não reaplica.
      const claim = await saveState(db, userId, phone, externalId, text, { ...cur, stage: "applying", seq: (cur.seq ?? 0) + 1, nonce: mkNonce() }, "", now);
      if (claim === "duplicate") return { resposta: "Mensagem já processada anteriormente." };
      if (claim === "error") return { resposta: "Não consegui excluir agora. Nada foi alterado. Tente novamente." };
      const s = cur.sel!;
      const r = await aplicarExclusao(db, userId, s, now, phone, `delete:${cur.nonce}`);
      const resposta = r === "deleted"
        ? `🗑️ ${s.t === "gastos" ? "Gasto excluído" : "Receita excluída"}\n${s.descricao} — ${brl(s.valor)} — ${dateBR(s.data)}\nEle não aparece mais nas consultas e nos totais.`
        : r === "gone" ? "Esse lançamento já foi excluído ou não existe mais. Nada foi alterado."
        : r === "changed" ? "Esse lançamento foi alterado no site ou app depois que você o escolheu. Para não excluir algo diferente, não fiz nada. Envie o pedido de novo para ver os dados atuais."
        : r === "blocked" ? "Esse lançamento passou a ter vínculos que não podem ser desfeitos por aqui. Exclua pelo site ou app. Nada foi alterado."
        : "Não consegui excluir agora. Nada foi alterado. Confira o lançamento no app e tente novamente.";
      await saveState(db, userId, phone, null, "", { ...cur, stage: "done", seq: (cur.seq ?? 0) + 2, nonce: mkNonce() }, resposta, now);
      return { resposta };
    }

    if (cur.stage === "confirm") {
      if (cmd === "adj" || (cmd === "text" && /^(ajustar|ajusta|corrigir|mudar)$/.test(t))) {
        const next = step(cur, { stage: "field", field: undefined, patch: undefined });
        return save(next, renderFieldMenu(next));
      }
      const yes = cmd === "ok" || (cmd === "text" && /^(sim|confirmar|confirmo|ok|pode)$/.test(t));
      if (!yes) return save(step(cur, {}), renderConfirm(cur));
      // Consome o estado ANTES de escrever: confirmação repetida/replay não reaplica.
      const claim = await saveState(db, userId, phone, externalId, text, { ...cur, stage: "applying", seq: (cur.seq ?? 0) + 1, nonce: mkNonce() }, "", now);
      if (claim === "duplicate") return { resposta: "Mensagem já processada anteriormente." };
      if (claim === "error") return { resposta: "Não consegui salvar agora. Nada foi alterado. Tente novamente." };
      const r = await aplicarEdicao(db, userId, cur.sel!, cur.patch!, now);
      const s = cur.sel!; const p = cur.patch!;
      const resposta = r === "updated"
        ? `✅ ${s.t === "gastos" ? "Gasto" : "Receita"} atualizad${s.t === "gastos" ? "o" : "a"}\n${s.descricao}\n${FIELD_LABEL[p.field]}: ${p.beforeLabel} → ${p.label}`
        : r === "already" ? "Essa alteração já tinha sido salva. Nada foi alterado de novo."
        : r === "changed" ? "Esse lançamento foi alterado no site ou app depois que você o escolheu. Para não sobrescrever, não salvei nada. Envie o pedido de edição de novo para ver os dados atuais."
        : r === "deleted" ? "Esse lançamento foi excluído e não pode ser editado. Nada foi alterado."
        : "Não consegui salvar a alteração. Nada foi alterado. Confira o lançamento no app e tente novamente.";
      await saveState(db, userId, phone, null, "", { ...cur, stage: "done", seq: (cur.seq ?? 0) + 2, nonce: mkNonce() }, resposta, now);
      return { resposta };
    }
    return close(cur, "Essa edição foi encerrada. Nada foi alterado.");
  }
}
