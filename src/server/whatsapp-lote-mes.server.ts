/**
 * P1 (14/10/2026) — Exclusão e restauração de UM MÊS INTEIRO de gastos OU
 * receitas pelo WhatsApp.
 *
 * TRAVADO: `LOTE_MES_RELEASE_AUTHORIZED = false`. Enquanto a migração
 * candidata `docs/migrations-candidate/whatsapp-lote-mes.sql` não for revisada
 * e aplicada com autorização explícita, o pedido é reconhecido (nunca cai no
 * fluxo individual nem no cadastro) e respondido com "indisponível, nada foi
 * alterado". Sem a trava, a execução vai SOMENTE pelas RPCs transacionais
 * (`wa_lote_mes_excluir` / `wa_lote_mes_restaurar`); nunca há loop de UPDATEs
 * individuais. RPC ausente/erro/timeout → nada é reportado como sucesso.
 *
 * Fluxo: pedido (tipo + mês/ano explícitos) → prévia calculada do estado
 * real (elegíveis e bloqueados, contagem e soma) → "Continuar" → frase exata
 * ("EXCLUIR GASTOS 09/2026") → RPC com IDs + updated_at da prévia. Se o
 * conjunto mudou, a RPC não grava e a prévia é recalculada.
 *
 * Estado em `whatsapp_messages.parsed` (kind `wa_lote_mes`), um passo por
 * linha, `external_id` único (replay = dedupe), nonce novo por passo, TTL.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import { toGraphInteractive } from "./whatsapp-interactive.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
const defaultDb: Db = _supabaseAdmin;

/** Trava de liberação. Só muda com autorização explícita após aplicar a migração. */
export const LOTE_MES_RELEASE_AUTHORIZED = false;
export const LOTE_MES_KIND = "wa_lote_mes";
export const LOTE_MES_TTL_MS = 10 * 60 * 1000;
export const LOTE_MES_MAX = 500;
const PAGE = 8;
const TOKEN = /^wa_lm:([0-9a-f]{12}):(go|ls|pg|bk|x|tg|tr)(?::(\d{1,3}))?$/i;

type Tbl = "gastos" | "receitas";
type Acao = "excluir" | "restaurar";
type Item = { id: string; v: string; valor: number; descricao: string; data: string };
export type LoteState = {
  kind: typeof LOTE_MES_KIND;
  stage: "tipo" | "periodo" | "preview" | "frase" | "applying" | "done";
  acao: Acao; tipo: Tbl | null; ano: number | null; mes: number | null;
  nonce: string; seq: number; expires_at: string;
  items?: Item[]; total?: number;
  bloqueados?: Array<{ motivo: string; n: number; total: number }>;
  batch_id?: string; page?: number;
};
export type LoteReply = { resposta: string; graphInteractive?: Record<string, unknown> };
export type LoteDeps = { db?: Db; now?: () => Date; nonce?: () => string; uuid?: () => string; releaseAuthorized?: boolean };

// ---------------------------------------------------------------- utils
function norm(s: string): string {
  return (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[?!.,;:"']+/g, " ").replace(/\s+/g, " ").trim();
}
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBR = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
const mm = (m: number) => String(m).padStart(2, "0");
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
function randNonce(): string {
  const a = new Uint8Array(6); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
const MESES: Record<string, number> = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const MES_NOME = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// ------------------------------------------------------------- detector
const DEL_VERB = /\b(excluir|exclui|exclua|apagar|apaga|apague|remover|remove|remova|deletar|deleta|delete|zerar)\b/;
const REST_VERB = /\b(restaurar|restaura|restaure|recuperar|recupera|recupere|desfazer|desfaz)\b/;
const BULK_W = /\b(todos|todas|tudo|inteiro|inteira|em massa)\b/;
const PLURAL_W = /\b(gastos|despesas|receitas|rendas|entradas|movimentacoes|lancamentos)\b/;
const GASTO_W = /\b(gastos?|despesas?)\b/;
const RECEITA_W = /\b(receitas?|rendas?|entradas?)\b/;
const AMBOS_W = /\b(movimentacoes|movimentacao|lancamentos|tudo)\b/;
const OUTROS = /\b(contas?|boletos?|fatura|faturas|cartao|cartoes|categoria|categorias|meta|metas|lembrete|lembretes|agenda|compras?)\b/;

export type Periodo = { kind: "ok"; ano: number; mes: number } | { kind: "ausente" } | { kind: "ambiguo" };
/** Mês/ano EXPLÍCITOS. Nunca assume mês ou ano atual (operação destrutiva). */
export function extrairPeriodo(texto: string): Periodo {
  const t = norm(texto);
  const achados = new Set<string>();
  for (const m of t.matchAll(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b(?:\s+(?:de|do)?\s*(\d{4}))?/g)) {
    achados.add(`${m[2] ?? "?"}-${MESES[m[1]]}`);
  }
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{4})\b/g)) achados.add(`${m[2]}-${Number(m[1])}`);
  if (achados.size === 0) return { kind: "ausente" };
  if (achados.size > 1) return { kind: "ambiguo" };
  const [a, mStr] = [...achados][0].split("-");
  const mes = Number(mStr);
  if (a === "?" || !(mes >= 1 && mes <= 12)) return { kind: "ausente" };
  const ano = Number(a);
  if (!(ano >= 2000 && ano <= 2100)) return { kind: "ambiguo" };
  return { kind: "ok", ano, mes };
}

export type LoteIntent = { acao: Acao; tipo: Tbl | "ambos" | null; periodo: Periodo };
/**
 * "Excluir todos os gastos de setembro de 2026", "Apagar minhas receitas de
 * agosto de 2026", "Restaurar os gastos que excluí de setembro de 2026".
 * Singular ("o gasto", "um gasto") continua no fluxo individual.
 */
export function detectLoteMes(texto: string): LoteIntent | null {
  const t = norm(texto);
  if (!t) return null;
  const rest = REST_VERB.test(t);
  const del = !rest && DEL_VERB.test(t);
  if (!rest && !del) return null;
  if (OUTROS.test(t)) return null;
  if (!BULK_W.test(t) && !PLURAL_W.test(t)) return null;
  const g = GASTO_W.test(t), r = RECEITA_W.test(t);
  const tipo: LoteIntent["tipo"] = (g && r) || (!g && !r && AMBOS_W.test(t)) ? "ambos" : g ? "gastos" : r ? "receitas" : null;
  return { acao: rest ? "restaurar" : "excluir", tipo, periodo: extrairPeriodo(texto) };
}

// ------------------------------------------------------------- state
async function loadState(db: Db, userId: string, phone: string, now: Date): Promise<LoteState | null> {
  const { data, error } = await db.from("whatsapp_messages").select("parsed, created_at")
    .eq("user_id", userId).eq("telefone", phone).eq("parsed->>kind", LOTE_MES_KIND)
    .order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error("lote_state_read_failed");
  const rows = (Array.isArray(data) ? data : []) as Array<{ parsed: LoteState; created_at: string }>;
  const st = rows.sort((a, b) => (b.parsed?.seq ?? 0) - (a.parsed?.seq ?? 0) || String(b.created_at).localeCompare(String(a.created_at)))[0]?.parsed;
  if (!st || st.kind !== LOTE_MES_KIND) return null;
  if (st.stage === "done" || st.stage === "applying") return st;
  if (Date.parse(st.expires_at) <= now.getTime()) return { ...st, stage: "done" };
  return st;
}
async function saveState(db: Db, userId: string, phone: string, externalId: string | null, text: string, st: LoteState, resposta: string, now: Date) {
  const { error } = await db.from("whatsapp_messages").insert({
    user_id: userId, telefone: phone, external_id: externalId, texto: text,
    status: "sem_pendencia", parsed: st, resposta_sugerida: resposta,
    recebida_em: now.toISOString(), created_at: now.toISOString(),
  });
  if (!error) return "ok" as const;
  return error.code === "23505" ? "duplicate" as const : "error" as const;
}

// ------------------------------------------------------------- leitura
/** Mesmas regras de bloqueio da exclusão individual (whatsapp-editar-antigo). */
function motivoBloqueio(t: Tbl, r: Record<string, unknown>): string | null {
  if (t === "gastos") {
    if (r.grupo_parcelamento_id || Number(r.total_parcelas ?? 1) > 1) return "parcelados";
    if (r.recorrencia_id) return "recorrentes";
    if (r.bem_id) return "ligados a bens e financiamentos";
    if (r.cartao_id || r.forma_pagamento === "credito") return "no cartão de crédito";
    if (r.import_batch_id) return "importados de extrato";
    return null;
  }
  if (r.recorrencia_id) return "recorrentes";
  if (r.import_batch_id) return "importados de extrato";
  return null;
}
type Previa = { items: Item[]; total: number; bloqueados: LoteState["bloqueados"] } | "muitos";
async function calcularPrevia(db: Db, userId: string, t: Tbl, ano: number, mes: number): Promise<Previa> {
  const last = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const cols = t === "gastos"
    ? "id, descricao, valor, data, forma_pagamento, cartao_id, grupo_parcelamento_id, total_parcelas, recorrencia_id, bem_id, import_batch_id, updated_at"
    : "id, descricao, valor, data, recorrencia_id, import_batch_id, updated_at";
  const { data, error } = await db.from(t).select(cols).eq("user_id", userId).is("deleted_at", null)
    .gte("data", `${ano}-${mm(mes)}-01`).lte("data", `${ano}-${mm(mes)}-${mm(last)}`)
    .order("data", { ascending: true }).limit(LOTE_MES_MAX * 2 + 1);
  if (error) throw new Error("lote_preview_read_failed");
  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
  if (rows.length > LOTE_MES_MAX * 2) return "muitos";
  let pagos = new Set<string>();
  if (t === "gastos" && rows.length) {
    const { data: cp, error: e2 } = await db.from("contas_a_pagar").select("gasto_id").eq("user_id", userId).in("gasto_id", rows.map((r) => String(r.id)));
    if (e2) throw new Error("lote_preview_links_failed");
    pagos = new Set((Array.isArray(cp) ? cp : []).map((c: { gasto_id: string }) => String(c.gasto_id)));
  }
  const items: Item[] = []; const grupos = new Map<string, { n: number; c: number }>();
  for (const r of rows) {
    const motivo = motivoBloqueio(t, r) ?? (pagos.has(String(r.id)) ? "pagamentos de contas a pagar" : null);
    if (motivo) { const g = grupos.get(motivo) ?? { n: 0, c: 0 }; g.n++; g.c += cents(r.valor); grupos.set(motivo, g); continue; }
    items.push({ id: String(r.id), v: String(r.updated_at ?? ""), valor: Number(r.valor ?? 0), descricao: String(r.descricao ?? ""), data: String(r.data ?? "") });
  }
  if (items.length > LOTE_MES_MAX) return "muitos";
  items.sort((a, b) => a.id.localeCompare(b.id));
  return {
    items, total: items.reduce((s, i) => s + cents(i.valor), 0) / 100,
    bloqueados: [...grupos].map(([motivo, g]) => ({ motivo, n: g.n, total: g.c / 100 })),
  };
}
const mesmoConjunto = (a: Item[], b: Item[]) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.v === b[i].v);

// ------------------------------------------------------------- render
const nomeTipo = (t: Tbl, n = 2) => t === "gastos" ? (n === 1 ? "gasto" : "gastos") : (n === 1 ? "receita" : "receitas");
const periodoLabel = (s: LoteState) => `${MES_NOME[s.mes!]} de ${s.ano} (${mm(s.mes!)}/${s.ano})`;
export const frasePara = (s: Pick<LoteState, "acao" | "tipo" | "ano" | "mes">) =>
  `${s.acao === "excluir" ? "EXCLUIR" : "RESTAURAR"} ${s.tipo === "gastos" ? "GASTOS" : "RECEITAS"} ${mm(s.mes!)}/${s.ano}`;
const btns = (body: string, rows: Array<{ id: string; title: string }>) => toGraphInteractive({ type: "button", body, buttons: rows });

function renderPreview(s: LoteState, aviso = ""): LoteReply {
  const items = s.items ?? []; const t = s.tipo!;
  const verbo = s.acao === "excluir" ? "excluir" : "restaurar";
  const linhas = [
    aviso,
    `Prévia: ${verbo} ${nomeTipo(t)} de ${periodoLabel(s)}`,
    `• ${items.length} ${nomeTipo(t, items.length)} ${s.acao === "excluir" ? "serão excluídos" : "serão restaurados"} — total ${brl(s.total ?? 0)}`,
  ];
  for (const b of s.bloqueados ?? []) linhas.push(`• ${b.n} ${nomeTipo(t, b.n)} ${b.motivo} — total ${brl(b.total)} (NÃO serão alterados; use o site ou app)`);
  const ex = items.slice(0, 5).map((i) => `  - ${i.descricao || "Sem descrição"} — ${brl(i.valor)} — ${dateBR(i.data)}`);
  if (ex.length) linhas.push("", "Exemplos:", ...ex);
  linhas.push("", s.acao === "excluir"
    ? "Eles deixam de aparecer nas consultas e nos totais. Dá para restaurar depois pelo WhatsApp."
    : "Só voltam os lançamentos que essa exclusão em lote marcou.", "Deseja continuar?");
  const body = linhas.filter((x, i) => x !== "" || i > 0).join("\n").trim();
  return { resposta: body, graphInteractive: btns(body, [
    { id: `wa_lm:${s.nonce}:go`, title: "Continuar" },
    { id: `wa_lm:${s.nonce}:ls`, title: "Ver lista" },
    { id: `wa_lm:${s.nonce}:x`, title: "Cancelar" },
  ]) };
}
function renderLista(s: LoteState): LoteReply {
  const items = s.items ?? []; const page = s.page ?? 0;
  const slice = items.slice(page * PAGE, (page + 1) * PAGE);
  const more = items.length > (page + 1) * PAGE;
  const body = [`Lista (${page * PAGE + 1}–${page * PAGE + slice.length} de ${items.length}):`,
    ...slice.map((i, k) => `${page * PAGE + k + 1}. ${i.descricao || "Sem descrição"} — ${brl(i.valor)} — ${dateBR(i.data)}`)].join("\n");
  const rows = [{ id: `wa_lm:${s.nonce}:go`, title: "Continuar" }];
  if (more) rows.push({ id: `wa_lm:${s.nonce}:pg:${page + 1}`, title: "Ver mais" });
  rows.push({ id: `wa_lm:${s.nonce}:x`, title: "Cancelar" });
  return { resposta: body, graphInteractive: btns(body, rows) };
}
function renderFrase(s: LoteState): LoteReply {
  const body = [
    `Confirmação final: ${s.acao === "excluir" ? "excluir" : "restaurar"} ${s.items?.length ?? 0} ${nomeTipo(s.tipo!, s.items?.length ?? 0)} de ${periodoLabel(s)}, total ${brl(s.total ?? 0)}.`,
    "",
    "Para confirmar, digite exatamente:",
    frasePara(s),
    "",
    "Nada foi alterado ainda.",
  ].join("\n");
  return { resposta: body, graphInteractive: btns(body, [
    { id: `wa_lm:${s.nonce}:bk`, title: "Voltar" },
    { id: `wa_lm:${s.nonce}:x`, title: "Cancelar" },
  ]) };
}
const INDISPONIVEL = "Excluir ou restaurar um mês inteiro ainda não está disponível pelo WhatsApp. Nada foi alterado.\n\nPor aqui você pode excluir ou restaurar um lançamento por vez, por exemplo: “excluir o Uber de ontem”.";

// ----------------------------------------------------------------- main
export async function handleLoteMes(args: {
  userId: string; phone: string; externalId: string | null; text: string; podeIniciar: boolean;
}, deps: LoteDeps = {}): Promise<LoteReply | null> {
  const db = deps.db ?? defaultDb;
  const now = (deps.now ?? (() => new Date()))();
  const mkNonce = deps.nonce ?? randNonce;
  const mkUuid = deps.uuid ?? (() => crypto.randomUUID());
  const liberado = deps.releaseAuthorized ?? LOTE_MES_RELEASE_AUTHORIZED;
  const { userId, phone, externalId, text } = args;
  const tok = TOKEN.exec(text.trim());
  const t = norm(text);

  let st: LoteState | null;
  try { st = await loadState(db, userId, phone, now); } catch {
    return tok || args.podeIniciar ? { resposta: "Não consegui continuar agora. Nada foi alterado. Tente novamente daqui a pouco." } : null;
  }
  const active = st && st.stage !== "done" && st.stage !== "applying" ? st : null;

  const save = async (next: LoteState, reply: LoteReply): Promise<LoteReply> => {
    const r = await saveState(db, userId, phone, externalId, text, next, reply.resposta, now);
    if (r === "duplicate") return { resposta: "Mensagem já processada anteriormente." };
    if (r === "error") return { resposta: "Não consegui continuar agora. Nada foi alterado. Tente novamente." };
    return reply;
  };
  const step = (base: LoteState, patch: Partial<LoteState>): LoteState => ({
    ...base, ...patch, seq: (base.seq ?? 0) + 1, nonce: mkNonce(), expires_at: new Date(now.getTime() + LOTE_MES_TTL_MS).toISOString(),
  });
  const close = (base: LoteState, resposta: string) => save({ ...base, stage: "done", seq: (base.seq ?? 0) + 1, nonce: mkNonce() }, { resposta });

  if (tok) {
    if (!active || active.nonce !== tok[1].toLowerCase()) return { resposta: "Essa opção expirou ou já foi usada. Nada foi alterado." };
    return continuar(active, tok[2].toLowerCase(), tok[3] ?? null);
  }
  if (active) {
    if (/^(cancelar|cancela|sair|parar|menu)$/.test(t)) return close(active, "Tudo bem, cancelado. Nenhum lançamento foi alterado.");
    return continuar(active, "text", null);
  }
  if (!args.podeIniciar) return null;
  const intent = detectLoteMes(text);
  if (!intent) return null;
  if (!liberado) return { resposta: INDISPONIVEL };

  const base: LoteState = { kind: LOTE_MES_KIND, stage: "tipo", acao: intent.acao, tipo: intent.tipo === "ambos" ? null : intent.tipo,
    ano: intent.periodo.kind === "ok" ? intent.periodo.ano : null, mes: intent.periodo.kind === "ok" ? intent.periodo.mes : null,
    nonce: "", seq: st?.seq ?? 0, expires_at: "" };
  return avancar(base, intent.periodo.kind === "ambiguo" ? "Você citou mais de um mês ou um ano inválido. " : "");

  // ------------------------------------------------------- internals
  async function avancar(s: LoteState, aviso = ""): Promise<LoteReply> {
    if (!s.tipo) {
      const next = step(s, { stage: "tipo" });
      const body = `${aviso}Por segurança, ${s.acao === "excluir" ? "excluo" : "restauro"} gastos e receitas separadamente. Qual deles?\n\nNada foi alterado.`;
      return save(next, { resposta: body, graphInteractive: btns(body, [
        { id: `wa_lm:${next.nonce}:tg`, title: "Gastos" }, { id: `wa_lm:${next.nonce}:tr`, title: "Receitas" }, { id: `wa_lm:${next.nonce}:x`, title: "Cancelar" },
      ]) });
    }
    if (!s.ano || !s.mes) {
      return save(step(s, { stage: "periodo" }), { resposta: `${aviso}De qual mês e ano? Escreva o mês e o ano, por exemplo: setembro de 2026.\n\nNada foi alterado. Digite “cancelar” para sair.` });
    }
    return s.acao === "excluir" ? previaExcluir(s, aviso) : previaRestaurar(s, aviso);
  }

  async function previaExcluir(s: LoteState, aviso: string): Promise<LoteReply> {
    let p: Previa;
    try { p = await calcularPrevia(db, userId, s.tipo!, s.ano!, s.mes!); } catch { return close(s, "Não consegui calcular a prévia agora. Nada foi alterado. Tente novamente."); }
    if (p === "muitos") return close(s, `Há lançamentos demais em ${periodoLabel(s)} para excluir pelo WhatsApp. Use o site ou app. Nada foi alterado.`);
    if (p.items.length === 0) {
      const bl = (p.bloqueados ?? []).map((b) => `${b.n} ${b.motivo}`).join(", ");
      return close(s, `Não há ${nomeTipo(s.tipo!)} que possam ser excluídos por aqui em ${periodoLabel(s)}.${bl ? ` Existem ${bl}, que só podem ser alterados pelo site ou app.` : ""} Nada foi alterado.`);
    }
    const next = step(s, { stage: "preview", items: p.items, total: p.total, bloqueados: p.bloqueados, page: 0, batch_id: mkUuid() });
    return save(next, renderPreview(next, aviso));
  }

  async function previaRestaurar(s: LoteState, aviso: string): Promise<LoteReply> {
    const { data, error } = await db.from("whatsapp_lote_mes_acoes").select("id, item_ids, deleted_stamp, status, created_at")
      .eq("user_id", userId).eq("tipo", s.tipo).eq("ano", s.ano).eq("mes", s.mes).eq("status", "excluido")
      .order("created_at", { ascending: false }).limit(1);
    if (error) return close(s, INDISPONIVEL);
    const lote = (Array.isArray(data) ? data : [])[0] as { id: string; item_ids: string[] } | undefined;
    if (!lote) return close(s, `Não encontrei uma exclusão em lote de ${nomeTipo(s.tipo!)} de ${periodoLabel(s)} para restaurar. Nada foi alterado.\n\nPara um lançamento só: “restaurar o gasto mercado”.`);
    // soft-delete-exceção: restauração lê os lançamentos EXCLUÍDOS daquele lote (só IDs do lote, do próprio usuário).
    const { data: rows, error: e2 } = await db.from(s.tipo!).select("id, descricao, valor, data, updated_at").eq("user_id", userId)
      .in("id", lote.item_ids ?? []).not("deleted_at", "is", null);
    if (e2) return close(s, "Não consegui calcular a prévia agora. Nada foi alterado. Tente novamente.");
    const items: Item[] = (Array.isArray(rows) ? rows : []).map((r: Record<string, unknown>) => ({ id: String(r.id), v: String(r.updated_at ?? ""), valor: Number(r.valor ?? 0), descricao: String(r.descricao ?? ""), data: String(r.data ?? "") }))
      .sort((a: Item, b: Item) => a.id.localeCompare(b.id));
    if (items.length === 0) return close(s, "Os lançamentos dessa exclusão em lote já foram restaurados. Nada foi alterado.");
    const fora = (lote.item_ids?.length ?? 0) - items.length;
    const next = step(s, { stage: "preview", items, total: items.reduce((x, i) => x + cents(i.valor), 0) / 100, bloqueados: [], page: 0, batch_id: lote.id });
    return save(next, renderPreview(next, `${aviso}${fora > 0 ? `${fora} lançamento(s) desse lote já tinham sido restaurados e não entram. ` : ""}`));
  }

  async function continuar(cur: LoteState, cmd: string, arg: string | null): Promise<LoteReply> {
    if (cmd === "x") return close(cur, "Tudo bem, cancelado. Nenhum lançamento foi alterado.");
    if (cur.stage === "tipo") {
      const tipo: Tbl | null = cmd === "tg" || (cmd === "text" && GASTO_W.test(t) && !RECEITA_W.test(t)) ? "gastos"
        : cmd === "tr" || (cmd === "text" && RECEITA_W.test(t) && !GASTO_W.test(t)) ? "receitas" : null;
      if (!tipo) return save(step(cur, {}), { resposta: "Responda “gastos” ou “receitas” (um tipo por vez), ou “cancelar”." });
      return avancar({ ...cur, tipo });
    }
    if (cur.stage === "periodo") {
      const p = extrairPeriodo(text);
      if (p.kind !== "ok") return save(step(cur, {}), { resposta: "Preciso do mês e do ano, por exemplo: setembro de 2026. Digite “cancelar” para sair." });
      return avancar({ ...cur, ano: p.ano, mes: p.mes });
    }
    if (cur.stage === "preview") {
      if (cmd === "ls") return save(step(cur, { page: 0 }), renderLista({ ...cur, page: 0 }));
      if (cmd === "pg") { const page = Number(arg); if (!Number.isInteger(page) || page < 0 || page * PAGE >= (cur.items?.length ?? 0)) return save(step(cur, {}), { resposta: "Não há mais itens. Toque em Continuar ou Cancelar." }); const n = step(cur, { page }); return save(n, renderLista(n)); }
      if (cmd === "go" || (cmd === "text" && /^(continuar|sim|ok)$/.test(t))) { const n = step(cur, { stage: "frase" }); return save(n, renderFrase(n)); }
      return save(step(cur, {}), { resposta: "Toque em Continuar, Ver lista ou Cancelar. Nada foi alterado." });
    }
    if (cur.stage === "frase") {
      if (cmd === "bk" || t === "voltar") { const n = step(cur, { stage: "preview" }); return save(n, renderPreview(n)); }
      if (cmd !== "text" || norm(text) !== norm(frasePara(cur))) {
        return save(step(cur, {}), { resposta: `Frase diferente. Para confirmar, digite exatamente:\n${frasePara(cur)}\n\nOu “voltar”/“cancelar”. Nada foi alterado.` });
      }
      return executar(cur);
    }
    return { resposta: "Essa opção expirou. Nada foi alterado." };
  }

  async function executar(cur: LoteState): Promise<LoteReply> {
    // Revalida o estado real antes de gravar (exclusão).
    if (cur.acao === "excluir") {
      let p: Previa;
      try { p = await calcularPrevia(db, userId, cur.tipo!, cur.ano!, cur.mes!); } catch { return close(cur, "Não consegui conferir os lançamentos agora. Nada foi alterado."); }
      if (p === "muitos" || !mesmoConjunto(p.items, cur.items ?? [])) {
        if (p === "muitos" || p.items.length === 0) return close(cur, "Os lançamentos mudaram desde a prévia. Nada foi alterado. Peça a exclusão de novo.");
        const n = step(cur, { stage: "preview", items: p.items, total: p.total, bloqueados: p.bloqueados, page: 0, batch_id: mkUuid() });
        return save(n, renderPreview(n, "Os lançamentos mudaram desde a prévia. Nada foi alterado. Confira a nova prévia. "));
      }
    }
    // Consome o estado antes da RPC: replay/duplo Confirmar caem no dedupe.
    const applying: LoteState = { ...cur, stage: "applying", seq: (cur.seq ?? 0) + 1, nonce: mkNonce() };
    const r = await saveState(db, userId, phone, externalId, text, applying, "", now);
    if (r === "duplicate") return { resposta: "Mensagem já processada anteriormente." };
    if (r === "error") return { resposta: "Não consegui continuar agora. Nada foi alterado. Tente novamente." };
    const done = (resposta: string) => saveState(db, userId, phone, null, text, { ...applying, stage: "done", seq: applying.seq + 1 }, resposta, now).then(() => ({ resposta }));

    let res: { data: unknown; error: { code?: string; message?: string } | null };
    try {
      res = cur.acao === "excluir"
        ? await db.rpc("wa_lote_mes_excluir", { p_user_id: userId, p_batch_id: cur.batch_id, p_tipo: cur.tipo, p_ano: cur.ano, p_mes: cur.mes,
          p_ids: (cur.items ?? []).map((i) => i.id), p_versions: (cur.items ?? []).map((i) => i.v) })
        : await db.rpc("wa_lote_mes_restaurar", { p_user_id: userId, p_batch_id: cur.batch_id, p_expected: cur.items?.length ?? 0 });
    } catch {
      return done("Não consegui confirmar o resultado agora. Não considere como feito: confira no site ou app antes de tentar de novo.");
    }
    if (res.error) {
      const ausente = res.error.code === "PGRST202" || res.error.code === "42883" || /could not find the function|does not exist/i.test(res.error.message ?? "");
      return done(ausente ? INDISPONIVEL : "Não consegui concluir. A operação foi desfeita por completo e nada foi alterado. Tente novamente mais tarde.");
    }
    const d = (res.data ?? {}) as { status?: string; count?: number };
    const n = Number(d.count ?? 0);
    const nomeR = `${n} ${nomeTipo(cur.tipo!, n)} de ${periodoLabel(cur)}`;
    if (d.status === "deleted" || (d.status === "replay" && cur.acao === "excluir")) {
      return done(`Pronto: excluí ${nomeR}.\n\nPara desfazer, envie: “restaurar os ${nomeTipo(cur.tipo!)} que excluí de ${MES_NOME[cur.mes!]} de ${cur.ano}”.`);
    }
    if (d.status === "restored" || (d.status === "replay" && cur.acao === "restaurar")) return done(`Pronto: restaurei ${nomeR}.`);
    if (d.status === "changed") return done("Os lançamentos mudaram desde a prévia. Nada foi alterado. Peça de novo para ver a prévia atualizada.");
    return done("Não consegui confirmar o resultado agora. Não considere como feito: confira no site ou app antes de tentar de novo.");
  }
}
