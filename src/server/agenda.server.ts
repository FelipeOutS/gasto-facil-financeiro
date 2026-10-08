/**
 * GI Agenda — núcleo server-side compartilhado por site e WhatsApp.
 *
 * Fonte única: `public.agenda_items`. Site e WhatsApp chamam ESTAS funções.
 * - Ownership: toda leitura/escrita filtra `user_id`; o banco também valida
 *   (RLS no site + trigger `agenda_validate_source` para vínculos).
 * - Vínculo financeiro guarda só (source_type, source_id, dias antes). Valor,
 *   vencimento e situação são lidos da origem na hora (nunca snapshot).
 * - Avisos usam a fila existente `whatsapp_notifications` (entity_type
 *   'agenda_item'). Toda alteração cancela o aviso pendente e agenda o novo.
 *   O dispatcher revalida antes de enviar (revalidateAgendaForDispatch).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_TZ,
  addDaysYmd,
  isoToYmd,
  localParts,
  localToUtc,
  ymdToIso,
  formatWhen,
} from "@/lib/agenda/datetime";
import { nextOccurrence, type RecurrenceFreq } from "@/lib/agenda/recurrence";
import type { Database } from "@/integrations/supabase/types";

export type AgendaRow = Database["public"]["Tables"]["agenda_items"]["Row"];
export type AgendaKind = "lembrete" | "compromisso";
export type AgendaStatus = "ativo" | "concluido" | "cancelado";
export type AgendaSourceType = "conta_a_pagar" | "cartao" | "recorrencia";

export const AGENDA_ENTITY = "agenda_item";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export interface AgendaDeps {
  client?: Client;
  now?: () => Date;
  /** Fatura vigente do cartão (valor/vencimento atuais). */
  faturaAtual?: (
    userId: string,
    cartao: { id: string; nome: string; dia_fechamento: number | null; dia_vencimento: number | null; limite_total: number | null },
  ) => Promise<{ total: number; vencimento: Date | null }>;
  /**
   * Fatura completa do cartão (mesma fonte de "minha fatura do X":
   * getFaturaAtualPorCartao + getItensFaturaAtualPorCartao). Injetável em testes.
   */
  faturaDetalhe?: (
    userId: string,
    cartao: { id: string; nome: string; dia_fechamento: number | null; dia_vencimento: number | null; limite_total: number | null },
  ) => Promise<{
    fatura: { competencia: string; total: number; limite: number; disponivel: number; fechamento: Date | null; vencimento: Date | null };
    itens: Array<{ descricao: string; valor: number; data: string; parcelaAtual: number | null; totalParcelas: number | null }>;
  }>;
  /** Fila de avisos (injetável para testes). */
  enqueue?: (input: {
    userId: string;
    type: string;
    category: "agenda";
    scheduledAt: Date;
    dedupeKey: string;
    payload: Record<string, unknown>;
    entityType: string;
    entityId: string;
    priority: "baixa" | "media" | "alta";
  }) => Promise<unknown>;
  cancelPending?: (userId: string, entityType: string, entityId: string) => Promise<number>;
}

const c = (d?: AgendaDeps): Client => d?.client ?? supabaseAdmin;
const nowOf = (d?: AgendaDeps) => d?.now?.() ?? new Date();

export class AgendaError extends Error {
  constructor(
    public code: "not_found" | "invalid" | "source_not_owned",
    message: string,
  ) {
    super(message);
  }
}

export type AgendaInput = {
  kind?: AgendaKind;
  titulo: string;
  descricao?: string | null;
  starts_at?: string | null;
  timezone?: string;
  recurrence_freq?: RecurrenceFreq | null;
  recurrence_interval?: number;
  recurrence_until?: string | null;
  aviso_minutos_antes?: number;
  source_type?: AgendaSourceType | null;
  source_id?: string | null;
  aviso_dias_antes?: number | null;
  aviso_hora_local?: number;
  origem?: "site" | "whatsapp";
};

function cleanTitle(t: string): string {
  const s = (t ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function validTz(tz: string | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/** Confere que a entidade financeira é do MESMO usuário (defesa antes do trigger). */
export async function assertSourceOwned(
  userId: string,
  type: AgendaSourceType,
  id: string,
  deps?: AgendaDeps,
): Promise<void> {
  const table = type === "conta_a_pagar" ? "contas_a_pagar" : type === "cartao" ? "cartoes" : "recorrencias";
  const { data } = await c(deps).from(table).select("id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) throw new AgendaError("source_not_owned", "Item financeiro não encontrado.");
}

export async function createAgendaItem(userId: string, input: AgendaInput, deps?: AgendaDeps): Promise<AgendaRow> {
  const titulo = cleanTitle(input.titulo);
  if (!titulo) throw new AgendaError("invalid", "Informe um título.");
  const hasSource = !!(input.source_type && input.source_id);
  if (!hasSource && !input.starts_at) throw new AgendaError("invalid", "Informe data e horário.");
  if (hasSource) await assertSourceOwned(userId, input.source_type!, input.source_id!, deps);
  const row = {
    user_id: userId,
    kind: input.kind ?? "lembrete",
    titulo,
    descricao: input.descricao ?? null,
    starts_at: input.starts_at ?? null,
    timezone: validTz(input.timezone),
    recurrence_freq: input.recurrence_freq ?? null,
    recurrence_interval: Math.max(1, Math.floor(input.recurrence_interval ?? 1)),
    recurrence_until: input.recurrence_until ?? null,
    aviso_minutos_antes: Math.max(0, Math.floor(input.aviso_minutos_antes ?? 0)),
    source_type: hasSource ? input.source_type : null,
    source_id: hasSource ? input.source_id : null,
    aviso_dias_antes: hasSource ? Math.max(0, Math.floor(input.aviso_dias_antes ?? 1)) : null,
    aviso_hora_local: input.aviso_hora_local ?? 9,
    origem: input.origem ?? "site",
  };
  const { data, error } = await c(deps).from("agenda_items").insert(row).select("*").single();
  if (error || !data) {
    if (String(error?.message ?? "").includes("agenda_source_not_owned"))
      throw new AgendaError("source_not_owned", "Item financeiro não encontrado.");
    throw new AgendaError("invalid", "Não foi possível salvar.");
  }
  await syncAgendaNotification(data as AgendaRow, deps);
  return data as AgendaRow;
}

export async function getAgendaItem(userId: string, id: string, deps?: AgendaDeps): Promise<AgendaRow | null> {
  const { data } = await c(deps).from("agenda_items").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return (data as AgendaRow) ?? null;
}

export type AgendaPatch = Partial<
  Pick<
    AgendaInput,
    | "titulo"
    | "descricao"
    | "starts_at"
    | "kind"
    | "recurrence_freq"
    | "recurrence_interval"
    | "recurrence_until"
    | "aviso_minutos_antes"
    | "aviso_dias_antes"
    | "aviso_hora_local"
    | "timezone"
  >
>;

export async function updateAgendaItem(
  userId: string,
  id: string,
  patch: AgendaPatch,
  deps?: AgendaDeps,
): Promise<AgendaRow> {
  const cur = await getAgendaItem(userId, id, deps);
  if (!cur) throw new AgendaError("not_found", "Item não encontrado.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upd: Record<string, any> = {};
  if (patch.titulo !== undefined) {
    const t = cleanTitle(patch.titulo);
    if (!t) throw new AgendaError("invalid", "Informe um título.");
    upd.titulo = t;
  }
  for (const k of [
    "descricao",
    "starts_at",
    "kind",
    "recurrence_freq",
    "recurrence_interval",
    "recurrence_until",
    "aviso_minutos_antes",
    "aviso_dias_antes",
    "aviso_hora_local",
  ] as const) {
    if (patch[k] !== undefined) upd[k] = patch[k];
  }
  if (patch.timezone !== undefined) upd.timezone = validTz(patch.timezone);
  if (!cur.source_type && upd.starts_at === null) throw new AgendaError("invalid", "Informe data e horário.");
  const { data, error } = await c(deps)
    .from("agenda_items")
    .update(upd)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !data) throw new AgendaError("invalid", "Não foi possível salvar.");
  await syncAgendaNotification(data as AgendaRow, deps);
  return data as AgendaRow;
}

/**
 * Concluir: item recorrente avança para a próxima ocorrência (continua ativo);
 * item único vira "concluido". Cancelar: sempre "cancelado".
 */
export async function setAgendaStatus(
  userId: string,
  id: string,
  action: "concluir" | "cancelar" | "reativar",
  deps?: AgendaDeps,
): Promise<{ row: AgendaRow; advanced: boolean }> {
  const cur = await getAgendaItem(userId, id, deps);
  if (!cur) throw new AgendaError("not_found", "Item não encontrado.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let upd: Record<string, any>;
  let advanced = false;
  if (action === "cancelar") upd = { status: "cancelado", cancelled_at: nowOf(deps).toISOString() };
  else if (action === "reativar") upd = { status: "ativo", cancelled_at: null, completed_at: null };
  else if (cur.recurrence_freq && cur.starts_at) {
    const base = new Date(cur.starts_at);
    const after = new Date(Math.max(base.getTime(), nowOf(deps).getTime()));
    const nxt = nextOccurrence(
      base,
      { freq: cur.recurrence_freq as RecurrenceFreq, interval: cur.recurrence_interval, until: cur.recurrence_until },
      after,
      cur.timezone,
    );
    if (nxt) {
      upd = { starts_at: nxt.toISOString() };
      advanced = true;
    } else upd = { status: "concluido", completed_at: nowOf(deps).toISOString() };
  } else upd = { status: "concluido", completed_at: nowOf(deps).toISOString() };
  const { data, error } = await c(deps)
    .from("agenda_items")
    .update(upd)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !data) throw new AgendaError("invalid", "Não foi possível salvar.");
  await syncAgendaNotification(data as AgendaRow, deps);
  return { row: data as AgendaRow, advanced };
}

export async function listAgenda(
  userId: string,
  opts: { status?: AgendaStatus | "todos"; fromIso?: string; toIso?: string; limit?: number } = {},
  deps?: AgendaDeps,
): Promise<AgendaRow[]> {
  let q = c(deps).from("agenda_items").select("*").eq("user_id", userId);
  if (opts.status && opts.status !== "todos") q = q.eq("status", opts.status);
  const { data } = await q.order("starts_at", { ascending: true, nullsFirst: false }).limit(opts.limit ?? 200);
  let rows = ((data as AgendaRow[]) ?? []).slice();
  if (opts.fromIso || opts.toIso) {
    rows = rows.filter((r) => {
      if (!r.starts_at) return true; // financeiros: data vem da origem
      if (opts.fromIso && r.starts_at < opts.fromIso) return false;
      if (opts.toIso && r.starts_at >= opts.toIso) return false;
      return true;
    });
  }
  return rows;
}

function normTxt(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["o", "a", "os", "as", "de", "da", "do", "das", "dos", "meu", "minha", "lembrete", "compromisso", "para", "pra"]);

/** Itens ativos cujo título contém as palavras informadas. */
export async function findAgendaByTitle(userId: string, query: string, deps?: AgendaDeps): Promise<AgendaRow[]> {
  const words = normTxt(query)
    .split(" ")
    .filter((w) => w && !STOP.has(w));
  if (!words.length) return [];
  const rows = await listAgenda(userId, { status: "ativo" }, deps);
  return rows.filter((r) => {
    const t = normTxt(r.titulo);
    return words.every((w) => t.includes(w) || (w.length > 4 && t.includes(w.slice(0, -1))));
  });
}

// ---------------- vínculo financeiro (leitura ao vivo) ----------------

export type FinancialSnapshot =
  | { ok: true; nome: string; valor: number | null; dueIso: string; label: string }
  | { ok: false; reason: "payable_paid" | "payable_cancelled" | "payable_not_found" };

/** Lê a entidade de origem AGORA. Nunca usa valor/vencimento guardados. */
export async function resolveFinancialSource(item: AgendaRow, deps?: AgendaDeps): Promise<FinancialSnapshot> {
  if (!item.source_type || !item.source_id) return { ok: false, reason: "payable_not_found" };
  const db = c(deps);
  const tz = item.timezone || DEFAULT_TZ;
  if (item.source_type === "conta_a_pagar") {
    const { data } = await db
      .from("contas_a_pagar")
      .select("id, nome, valor, data_vencimento, status")
      .eq("id", item.source_id)
      .eq("user_id", item.user_id)
      .maybeSingle();
    if (!data) return { ok: false, reason: "payable_not_found" };
    if (data.status === "pago") return { ok: false, reason: "payable_paid" };
    if (data.status !== "pendente") return { ok: false, reason: "payable_cancelled" };
    return { ok: true, nome: data.nome, valor: Number(data.valor ?? 0), dueIso: data.data_vencimento, label: "Conta" };
  }
  if (item.source_type === "cartao") {
    const { data } = await db
      .from("cartoes")
      .select("id, nome, dia_fechamento, dia_vencimento, limite_total")
      .eq("id", item.source_id)
      .eq("user_id", item.user_id)
      .maybeSingle();
    if (!data) return { ok: false, reason: "payable_not_found" };
    const fatura = deps?.faturaAtual
      ? await deps.faturaAtual(item.user_id, data)
      : await (async () => {
          const m = await import("./cartao-fatura.server");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return m.getFaturaAtualPorCartao(item.user_id, data as any);
        })();
    if (!fatura.vencimento) return { ok: false, reason: "payable_not_found" };
    // `vencimento` vem como data local (sem hora): usa os componentes de data.
    const due = { y: fatura.vencimento.getFullYear(), m: fatura.vencimento.getMonth() + 1, d: fatura.vencimento.getDate() };
    return { ok: true, nome: data.nome, valor: Number(fatura.total ?? 0), dueIso: ymdToIso(due), label: "Fatura" };
  }
  const { data } = await db
    .from("recorrencias")
    .select("id, nome, valor, proxima_cobranca, status")
    .eq("id", item.source_id)
    .eq("user_id", item.user_id)
    .maybeSingle();
  if (!data) return { ok: false, reason: "payable_not_found" };
  const st = String(data.status ?? "ativa").toLowerCase();
  if (st.startsWith("cancel") || st === "inativa" || st === "pausada") return { ok: false, reason: "payable_cancelled" };
  if (!data.proxima_cobranca) return { ok: false, reason: "payable_not_found" };
  return { ok: true, nome: data.nome, valor: Number(data.valor ?? 0), dueIso: data.proxima_cobranca, label: "Assinatura" };
}

/** Instante do aviso: N dias antes do vencimento, na hora local escolhida. */
export function financialAvisoAt(dueIso: string, diasAntes: number, horaLocal: number, tz: string): Date {
  const day = addDaysYmd(isoToYmd(dueIso), -Math.max(0, diasAntes));
  return localToUtc(day, { h: horaLocal, mi: 0 }, tz);
}

/** Próximo aviso do item (null = nada a agendar). */
export async function computeNextAviso(
  item: AgendaRow,
  deps?: AgendaDeps,
): Promise<{ at: Date; occurrence: Date | null; snapshot?: FinancialSnapshot } | null> {
  if (item.status !== "ativo") return null;
  const now = nowOf(deps);
  if (item.source_type) {
    const snap = await resolveFinancialSource(item, deps);
    if (!snap.ok) return null;
    const at = financialAvisoAt(snap.dueIso, item.aviso_dias_antes ?? 1, item.aviso_hora_local ?? 9, item.timezone);
    if (at.getTime() <= now.getTime()) return null;
    return { at, occurrence: null, snapshot: snap };
  }
  if (!item.starts_at) return null;
  const lead = (item.aviso_minutos_antes ?? 0) * 60_000;
  const start = new Date(item.starts_at);
  let occ: Date | null = start;
  if (start.getTime() - lead <= now.getTime()) {
    occ = item.recurrence_freq
      ? nextOccurrence(
          start,
          { freq: item.recurrence_freq as RecurrenceFreq, interval: item.recurrence_interval, until: item.recurrence_until },
          new Date(now.getTime() + lead),
          item.timezone,
        )
      : null;
  }
  if (!occ) return null;
  return { at: new Date(occ.getTime() - lead), occurrence: occ };
}

/**
 * Mantém a fila coerente com o item: cancela avisos pendentes e agenda o
 * próximo. Idempotente (dedupe por item+instante). Best-effort: falha aqui
 * nunca desfaz a gravação do item.
 */
export async function syncAgendaNotification(item: AgendaRow, deps?: AgendaDeps): Promise<Date | null> {
  try {
    const nxt = await computeNextAviso(item, deps);
    const dedupeKey = nxt ? `agenda:${item.id}:${nxt.at.toISOString()}:${item.updated_at}` : null;
    if (dedupeKey && !deps?.cancelPending) {
      const {data, error} = await c(deps).from("whatsapp_notifications").select("id,status")
        .eq("user_id", item.user_id).eq("dedupe_key", dedupeKey).maybeSingle();
      if (error) throw new Error("agenda_queue_lookup_unavailable");
      if (data) return data.status === "pending" || data.status === "processing" ? nxt!.at : null;
    }
    const cancel =
      deps?.cancelPending ??
      (async (u: string, t: string, i: string) => (await import("./whatsapp-notifications.server")).cancelByEntity(u, t, i));
    await cancel(item.user_id, AGENDA_ENTITY, item.id);
    if (!nxt) return null;
    const enqueue =
      deps?.enqueue ??
      (async (input: Parameters<NonNullable<AgendaDeps["enqueue"]>>[0]) =>
        (await import("./whatsapp-notifications.server")).enqueueNotification(input));
    // Reaproveita a mesma linha se o horário não mudou (dedupe estável).
    const queued = await enqueue({
      userId: item.user_id,
      type: item.source_type ? "gi_agenda_financeiro" : "gi_agenda_lembrete",
      category: "agenda",
      scheduledAt: nxt.at,
      dedupeKey: dedupeKey!,
      payload: {
        agenda_item_id: item.id,
        aviso_at: nxt.at.toISOString(),
        occurrence_at: nxt.occurrence?.toISOString() ?? null,
        // Só referência: o texto/valor final é recalculado no envio.
        due_date: nxt.snapshot && nxt.snapshot.ok ? nxt.snapshot.dueIso : null,
      },
      entityType: AGENDA_ENTITY,
      entityId: item.id,
      priority: item.source_type ? "alta" : "media",
    });
    if (queued === null) return null;
    return nxt.at;
  } catch (err) {
    console.error("[agenda] sync falhou", (err as Error)?.name ?? "err");
    return null;
  }
}

export type AgendaTemplateVars = {
  kind: "lembrete" | "financeiro";
  /** Variáveis na ordem do template Meta sugerido. */
  params: string[];
  text: string;
};

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Revalida um aviso da Agenda no momento do envio (dispatcher).
 * - item concluído/cancelado/apagado → skip `agenda_inactive`;
 * - conta paga/cancelada → skip `payable_paid`/`payable_cancelled`;
 * - horário mudou (ex.: vencimento alterado) → skip `agenda_changed` e
 *   agenda o aviso correto;
 * - ok → variáveis ATUAIS (valor/vencimento lidos agora).
 */
export async function revalidateAgendaForDispatch(
  n: { user_id: string; category: string; entity_type: string | null; entity_id: string | null; payload: Record<string, unknown> },
  deps?: AgendaDeps,
): Promise<{ ok: true; vars?: AgendaTemplateVars } | { ok: false; reason: string }> {
  if (n.category !== "agenda") return { ok: true };
  const id = n.entity_id ?? (n.payload?.agenda_item_id as string | undefined);
  if (!id) return { ok: false, reason: "agenda_inactive" };
  const item = await getAgendaItem(n.user_id, id, deps);
  if (!item || item.status !== "ativo") return { ok: false, reason: "agenda_inactive" };
  const tz = item.timezone || DEFAULT_TZ;
  const now = nowOf(deps);
  if (item.source_type) {
    const snap = await resolveFinancialSource(item, deps);
    if (!snap.ok) return { ok: false, reason: snap.reason };
    const expected = financialAvisoAt(snap.dueIso, item.aviso_dias_antes ?? 1, item.aviso_hora_local ?? 9, tz);
    const planned = new Date(String(n.payload?.aviso_at ?? ""));
    if (!Number.isFinite(planned.getTime()) || Math.abs(expected.getTime() - planned.getTime()) > 60_000) {
      await syncAgendaNotification(item, deps);
      return { ok: false, reason: "agenda_changed" };
    }
    const due = isoToYmd(snap.dueIso);
    const dueTxt = `${String(due.d).padStart(2, "0")}/${String(due.m).padStart(2, "0")}/${due.y}`;
    const lp = localParts(now, tz);
    const dias = Math.round((Date.UTC(due.y, due.m - 1, due.d) - Date.UTC(lp.y, lp.m - 1, lp.d)) / 86_400_000);
    const quando = dias <= 0 ? "hoje" : dias === 1 ? "amanhã" : `${dias} dias`;
    const valor = snap.valor != null ? brl(snap.valor) : "—";
    const nome = `${snap.label} ${snap.nome}`;
    return {
      ok: true,
      vars: {
        kind: "financeiro",
        params: [nome, quando, valor, dueTxt],
        text: `🔔 Lembrete do Gasto Inteligente\n${nome} vence ${dias <= 1 ? quando : `em ${quando}`}.\nValor atual: ${valor}\nVencimento: ${dueTxt}`,
      },
    };
  }
  const occIso = String(n.payload?.occurrence_at ?? item.starts_at ?? "");
  const occ = new Date(occIso);
  // Validate against the queued occurrence, not a two-minute window around
  // worker execution. Restarts, backoff and quiet hours may delay dispatch.
  const plannedAt = new Date(String(n.payload?.aviso_at ?? ""));
  const lead = (item.aviso_minutos_antes ?? 0) * 60_000;
  const occurrenceValid = Number.isFinite(occ.getTime()) && !!item.starts_at &&
    (item.recurrence_freq
      ? nextOccurrence(new Date(item.starts_at),
          {freq: item.recurrence_freq as RecurrenceFreq, interval: item.recurrence_interval, until: item.recurrence_until},
          new Date(occ.getTime() - 1), tz)?.getTime() === occ.getTime()
      : new Date(item.starts_at).getTime() === occ.getTime());
  const expected = occurrenceValid ? {at: new Date(occ.getTime() - lead)} : null;
  if (!expected || !Number.isFinite(plannedAt.getTime()) || Math.abs(expected.at.getTime() - plannedAt.getTime()) > 60_000) {
    await syncAgendaNotification(item, deps);
    return { ok: false, reason: "agenda_changed" };
  }
  if (item.recurrence_freq) await syncAgendaNotification(item, deps); // próxima ocorrência
  const quando = formatWhen(occ, tz, now);
  return {
    ok: true,
    vars: {
      kind: "lembrete",
      params: [item.titulo, quando],
      text: `🔔 Lembrete do Gasto Inteligente\n${item.titulo}\n🗓️ ${quando}`,
    },
  };
}

/** Rótulo de data (local) de um item — financeiros usam a origem ao vivo. */
export async function itemWhenLabel(item: AgendaRow, deps?: AgendaDeps): Promise<string> {
  const tz = item.timezone || DEFAULT_TZ;
  if (item.source_type) {
    const snap = await resolveFinancialSource(item, deps);
    if (!snap.ok) return snap.reason === "payable_paid" ? "já paga" : "sem vencimento";
    const d = isoToYmd(snap.dueIso);
    const v = snap.valor != null ? ` · ${brl(snap.valor)}` : "";
    return `vence ${String(d.d).padStart(2, "0")}/${String(d.m).padStart(2, "0")}${v} · aviso ${item.aviso_dias_antes ?? 1} dia(s) antes`;
  }
  return item.starts_at ? formatWhen(item.starts_at, tz, nowOf(deps)) : "";
}
