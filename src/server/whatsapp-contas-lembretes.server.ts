/**
 * WA-C9 — Geração de lembretes de contas a pagar (DRY-RUN).
 *
 * Usa a infraestrutura genérica WA-C8 (`enqueueNotification`). Não envia
 * nada: o dispatcher (`/api/public/hooks/whatsapp-dispatcher`) continua em
 * dry-run enquanto `WHATSAPP_DISPATCH_ENABLED=false`.
 *
 * Regras WA-C9:
 *  - Apenas contas `status='pendente'` (paga/cancelada nunca gera).
 *  - Sempre filtra `user_id`.
 *  - dedupeKey determinístico por (conta, due_date, tipo) — o índice único
 *    `(user_id, dedupe_key)` no banco garante que outro user não colida.
 *  - Payload mínimo: IDs, centavos, datas. Nunca nome, descrição, telefone,
 *    Pix, CPF/CNPJ. O texto final é renderizado em tempo de envio.
 *  - Logs sem PII (somente contadores e tipo).
 *
 * Tipos de lembrete:
 *  - conta_vencendo_hoje
 *  - conta_vencendo_amanha
 *  - conta_atrasada
 *  - conta_recorrente_pendente (conta pendente recorrente vencendo nos
 *    próximos 7 dias; sinal mais brando, prioridade baixa)
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  enqueueNotification,
  cancelByEntity,
  type NotificationRow,
} from "./whatsapp-notifications.server";

export type LembreteContaType =
  | "conta_vencendo_hoje"
  | "conta_vencendo_amanha"
  | "conta_atrasada"
  | "conta_recorrente_pendente";

const TYPE_TO_TEMPLATE: Record<LembreteContaType, string> = {
  conta_vencendo_hoje: "gi_conta_vencendo_hoje",
  conta_vencendo_amanha: "gi_conta_vencendo_amanha",
  conta_atrasada: "gi_conta_atrasada",
  conta_recorrente_pendente: "gi_conta_recorrente_pendente",
};

const TYPE_PRIORITY: Record<LembreteContaType, "baixa" | "media" | "alta"> = {
  conta_vencendo_hoje: "alta",
  conta_vencendo_amanha: "media",
  conta_atrasada: "alta",
  conta_recorrente_pendente: "baixa",
};

export interface ContaPendenteMinimal {
  id: string;
  nome: string;
  valor: number; // BRL
  data_vencimento: string; // YYYY-MM-DD
  status: string;
  recorrente?: boolean | null;
}

export interface LembretesDeps {
  client?: typeof supabaseAdmin;
  now?: () => Date;
  /** Hora local (0..23) em que lembretes "do dia" devem disparar. Default 8. */
  reminderHourLocal?: number;
  /** Timezone IANA do usuário; default 'America/Sao_Paulo'. */
  timezone?: string;
  /** Override para testes. */
  fetchContasPendentes?: (userId: string) => Promise<ContaPendenteMinimal[]>;
}

function client(deps?: LembretesDeps) {
  return deps?.client ?? supabaseAdmin;
}

// ---------- helpers de data em timezone do usuário ----------

function ymdInTz(d: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // en-CA produz YYYY-MM-DD
    return fmt.format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function diffDaysISO(a: string, b: string): number {
  // a - b (em dias)
  const da = Date.UTC(...(a.split("-").map(Number) as [number, number, number]));
  const db = Date.UTC(...(b.split("-").map(Number) as [number, number, number]));
  return Math.round((da - db) / (24 * 3600_000));
}

/**
 * Calcula o instante (UTC) em que a notificação deve ser disparada:
 * `reminderHourLocal` horas no fuso do usuário, do dia indicado.
 * Implementação aproximada: usa offset do fuso "agora" — bom o bastante para
 * janela de minutos/horas (não há DST agressivo em America/Sao_Paulo).
 */
function scheduledAtForLocalHour(
  dayISO: string,
  tz: string,
  hour: number,
  now: Date,
): Date {
  const reference = ymdInTz(now, tz); // YYYY-MM-DD local
  const refLocalMidnightUTC = Date.UTC(
    ...(reference.split("-").map(Number) as [number, number, number]),
  );
  // Quantos minutos UTC representam "00:00 local do dia atual"?
  // Calculamos pelo delta entre o instante atual e a meia-noite local
  // expressa em UTC (assumindo que o fuso aplicado a 'now' coincide com o
  // do dia-alvo — ok porque reminderHourLocal sempre é hoje/amanhã).
  const hoursOfNowLocal = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(now).find((p) => p.type === "hour")?.value ?? "0",
  );
  const minutesOfNowLocal = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      minute: "2-digit",
    }).formatToParts(now).find((p) => p.type === "minute")?.value ?? "0",
  );
  const nowMsUTC = now.getTime();
  const localMidnightUTC =
    nowMsUTC - (hoursOfNowLocal * 3600 + minutesOfNowLocal * 60) * 1000;
  // Diferença entre dayISO e referência de hoje (em dias):
  const deltaDays = diffDaysISO(dayISO, reference);
  const targetMs =
    localMidnightUTC + deltaDays * 24 * 3600_000 + hour * 3600_000;
  // Sanity: se a data calculada não bate com dayISO ao formatar em tz,
  // adiciona/subtrai 1h até bater (correção de DST hipotética).
  let candidate = new Date(targetMs);
  for (let i = 0; i < 3; i++) {
    if (ymdInTz(candidate, tz) === dayISO) break;
    candidate = new Date(candidate.getTime() + 3600_000);
  }
  void refLocalMidnightUTC;
  return candidate;
}

// ---------- API pública ----------

/**
 * Lê contas pendentes do usuário (somente colunas necessárias).
 * Default: via supabaseAdmin. Pode ser sobrescrito por `deps.fetchContasPendentes`.
 */
async function fetchContas(
  userId: string,
  deps?: LembretesDeps,
): Promise<ContaPendenteMinimal[]> {
  if (deps?.fetchContasPendentes) return deps.fetchContasPendentes(userId);
  const c = client(deps);
  const { data, error } = await c
    .from("contas_a_pagar")
    .select("id,nome,valor,data_vencimento,status,recorrente")
    .eq("user_id", userId)
    .eq("status", "pendente");
  if (error || !Array.isArray(data)) return [];
  return data as unknown as ContaPendenteMinimal[];
}

export interface LembreteGerado {
  type: LembreteContaType;
  contaId: string;
  notification: NotificationRow | null;
}

/**
 * Gera (idempotente) os lembretes do usuário para hoje. Não envia.
 * Retorna a lista de itens enfileirados ou já existentes.
 */
export async function gerarLembretesContasUsuario(
  userId: string,
  deps?: LembretesDeps,
): Promise<LembreteGerado[]> {
  if (!userId) return [];
  const tz = deps?.timezone ?? "America/Sao_Paulo";
  const now = deps?.now?.() ?? new Date();
  const reminderHour = deps?.reminderHourLocal ?? 8;
  const todayISO = ymdInTz(now, tz);
  const tomorrowISO = addDaysISO(todayISO, 1);
  const recurringHorizonISO = addDaysISO(todayISO, 7);

  const contas = await fetchContas(userId, deps);
  const out: LembreteGerado[] = [];
  let counts = { hoje: 0, amanha: 0, atrasada: 0, recorrente: 0, skipped_paid_or_cancelled: 0 };

  for (const conta of contas) {
    if (!conta || conta.status !== "pendente") {
      counts.skipped_paid_or_cancelled++;
      continue;
    }
    const due = conta.data_vencimento;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) continue;

    let type: LembreteContaType | null = null;
    if (due === todayISO) type = "conta_vencendo_hoje";
    else if (due === tomorrowISO) type = "conta_vencendo_amanha";
    else if (due < todayISO) type = "conta_atrasada";
    else if (
      conta.recorrente === true &&
      due > tomorrowISO &&
      due <= recurringHorizonISO
    )
      type = "conta_recorrente_pendente";

    if (!type) continue;

    const dedupeKey = `payable_due:${conta.id}:${due}:${type}`;
    // payload minimalíssimo: IDs + centavos + tipo. SEM nome/descrição.
    const valorCentavos = Math.max(0, Math.round(Number(conta.valor || 0) * 100));
    const payload = {
      conta_id: conta.id,
      due_date: due,
      valor_centavos: valorCentavos,
      type,
    };

    // Para vencendo-hoje e atrasada, agenda 08:00 local DE HOJE.
    // Para vencendo-amanhã, agenda 19:00 local de HOJE (aviso na noite anterior).
    // Para recorrente, agenda 09:00 local 2 dias antes do vencimento.
    let scheduledAt: Date;
    if (type === "conta_vencendo_amanha") {
      scheduledAt = scheduledAtForLocalHour(todayISO, tz, 19, now);
    } else if (type === "conta_recorrente_pendente") {
      const target = addDaysISO(due, -2);
      const base = target >= todayISO ? target : todayISO;
      scheduledAt = scheduledAtForLocalHour(base, tz, 9, now);
    } else {
      scheduledAt = scheduledAtForLocalHour(todayISO, tz, reminderHour, now);
    }

    const notification = await enqueueNotification(
      {
        userId,
        type: TYPE_TO_TEMPLATE[type],
        category: "contas_a_pagar",
        scheduledAt,
        dedupeKey,
        payload,
        priority: TYPE_PRIORITY[type],
        entityType: "conta_a_pagar",
        entityId: conta.id,
      },
      { client: client(deps) },
    );

    if (type === "conta_vencendo_hoje") counts.hoje++;
    else if (type === "conta_vencendo_amanha") counts.amanha++;
    else if (type === "conta_atrasada") counts.atrasada++;
    else counts.recorrente++;

    out.push({ type, contaId: conta.id, notification });
  }

  // Log agregado: sem userId, sem ids, sem valores.
  console.info(
    "[wa-c9] lembretes_gerados",
    JSON.stringify({ counts, total_pendentes: contas.length }),
  );
  return out;
}

/**
 * Cancela lembretes pendentes de uma conta (chamar quando ela é paga ou
 * cancelada). Reusa `cancelByEntity`. Filtra `user_id`.
 */
export async function cancelarLembretesDaConta(
  userId: string,
  contaId: string,
  deps?: LembretesDeps,
): Promise<number> {
  if (!userId || !contaId) return 0;
  return cancelByEntity(userId, "conta_a_pagar", contaId, {
    client: client(deps),
  });
}

// =========================================================================
// WA-C9.1 — Rechecagem final do dispatcher.
// Antes de marcar `would_send` ou de fato enviar, o dispatcher consulta a
// conta vinculada à notificação e confirma que ela ainda está elegível.
// Retorna { ok: true } quando segue ou { ok: false, reason } com motivo
// seguro para `markSkipped`. Sem PII em log.
// =========================================================================
export type RevalidateReason =
  | "payable_paid"
  | "payable_cancelled"
  | "payable_changed"
  | "payable_not_found";

export interface NotificationLike {
  user_id: string;
  category: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown>;
}

export async function revalidateContaForDispatch(
  n: NotificationLike,
  deps?: LembretesDeps,
): Promise<{ ok: true } | { ok: false; reason: RevalidateReason }> {
  if (n.category !== "contas_a_pagar") return { ok: true };
  const contaId = n.entity_id ?? (n.payload?.conta_id as string | undefined) ?? null;
  if (!contaId || !n.user_id) return { ok: false, reason: "payable_not_found" };

  const c = client(deps);
  const { data, error } = await c
    .from("contas_a_pagar")
    .select("id, status, data_vencimento, valor, user_id")
    .eq("id", contaId)
    .eq("user_id", n.user_id)
    .maybeSingle();

  if (error || !data) return { ok: false, reason: "payable_not_found" };
  const row = data as {
    status?: string | null;
    data_vencimento?: string | null;
    valor?: number | string | null;
  };
  const status = String(row.status ?? "");
  if (status === "pago") return { ok: false, reason: "payable_paid" };
  if (status === "cancelado") return { ok: false, reason: "payable_cancelled" };
  if (status !== "pendente") return { ok: false, reason: "payable_cancelled" };

  const expectedDue = (n.payload?.due_date as string | undefined) ?? null;
  if (expectedDue && row.data_vencimento && expectedDue !== row.data_vencimento) {
    return { ok: false, reason: "payable_changed" };
  }
  const expectedCentavos = Number(n.payload?.valor_centavos ?? NaN);
  if (Number.isFinite(expectedCentavos)) {
    const actualCentavos = Math.max(0, Math.round(Number(row.valor ?? 0) * 100));
    if (expectedCentavos !== actualCentavos) {
      return { ok: false, reason: "payable_changed" };
    }
  }
  return { ok: true };
}

// =========================================================================
// WA-C9.1 — Fallback persistente após restart do servidor.
//
// Se a RAM da memória curta foi limpa (deploy/restart) e o usuário responde
// "Paguei", "Adiar", "Ver detalhes" ou "Ignorar" sem reply_to nativo, o
// servidor consulta `whatsapp_notifications` para recuperar o contexto.
//
// Regras de segurança:
//  - Filtro estrito por `user_id` (nunca cruza usuários).
//  - Considera apenas categoria `contas_a_pagar` enviadas (`status='sent'`)
//    nas últimas LEMBRETE_FALLBACK_TTL_HOURS horas (24h: alinhado à janela
//    da Meta e ao TTL da RAM).
//  - Se houver mais de uma entidade distinta → retorna `ambiguous`.
//  - Se providerMessageId for fornecido, tem prioridade absoluta.
//  - Sem PII em log.
// =========================================================================
const LEMBRETE_FALLBACK_TTL_HOURS = 24;

export type RecentLembreteLookup =
  | { kind: "single"; contaId: string; notificationId: string; nomeCurto: string | null; dueISO: string }
  | { kind: "ambiguous"; count: number }
  | { kind: "none" };

export interface RecentLembreteDeps {
  client?: typeof supabaseAdmin;
  now?: () => Date;
}

export async function findRecentSentLembreteForUser(
  userId: string,
  opts: { providerMessageId?: string | null } = {},
  deps?: RecentLembreteDeps,
): Promise<RecentLembreteLookup> {
  if (!userId) return { kind: "none" };
  const c = deps?.client ?? supabaseAdmin;
  const now = deps?.now?.() ?? new Date();
  const since = new Date(now.getTime() - LEMBRETE_FALLBACK_TTL_HOURS * 3600_000);

  // 1) Prioridade: reply_to nativo.
  const pmid = (opts.providerMessageId ?? "").trim();
  if (pmid) {
    const { data } = await c
      .from("whatsapp_notifications")
      .select("id, user_id, entity_id, payload, sent_at, category")
      .eq("user_id", userId)
      .eq("provider_message_id", pmid)
      .maybeSingle();
    const row = data as {
      id?: string; entity_id?: string | null; payload?: Record<string, unknown> | null; sent_at?: string | null; category?: string | null;
    } | null;
    if (row && row.category === "contas_a_pagar" && row.entity_id) {
      const sentAt = row.sent_at ? new Date(row.sent_at) : null;
      if (sentAt && sentAt >= since) {
        return {
          kind: "single",
          contaId: row.entity_id,
          notificationId: row.id ?? "",
          nomeCurto: null,
          dueISO: String(row.payload?.due_date ?? ""),
        };
      }
    }
  }

  // 2) Caso contrário, lembretes enviados recentemente para o mesmo usuário.
  const { data } = await c
    .from("whatsapp_notifications")
    .select("id, entity_id, payload, sent_at")
    .eq("user_id", userId)
    .eq("category", "contas_a_pagar")
    .eq("status", "sent")
    .gte("sent_at", since.toISOString())
    .order("sent_at", { ascending: false })
    .limit(20);
  const rows = (Array.isArray(data) ? data : []) as Array<{
    id: string; entity_id: string | null; payload: Record<string, unknown> | null; sent_at: string | null;
  }>;
  if (rows.length === 0) return { kind: "none" };
  const distinct = new Map<string, { id: string; payload: Record<string, unknown> | null }>();
  for (const r of rows) {
    if (!r.entity_id) continue;
    if (!distinct.has(r.entity_id)) distinct.set(r.entity_id, { id: r.id, payload: r.payload });
  }
  if (distinct.size === 0) return { kind: "none" };
  if (distinct.size > 1) return { kind: "ambiguous", count: distinct.size };
  const [contaId, info] = distinct.entries().next().value as [string, { id: string; payload: Record<string, unknown> | null }];
  return {
    kind: "single",
    contaId,
    notificationId: info.id,
    nomeCurto: null,
    dueISO: String(info.payload?.due_date ?? ""),
  };
}

// ---------- Renderização (usada pelo dispatcher na hora do envio) ----------

export interface RenderInput {
  type: LembreteContaType;
  valorCentavos: number;
  nomeCurto?: string | null; // opcional: snapshot lido na hora do envio
  dueISO: string;
}

export interface RenderedMessage {
  text: string;
  quickReplies: string[];
}

function brl(centavos: number): string {
  const v = (centavos / 100).toFixed(2).replace(".", ",");
  return `R$ ${v}`;
}

/**
 * Renderiza o texto final do lembrete. NUNCA é persistido — só usado no
 * momento do envio. Inclui valor e (opcionalmente) nome curto da conta;
 * jamais Pix, CPF/CNPJ, descrição completa, telefone.
 */
export function renderLembreteConta(input: RenderInput): RenderedMessage {
  const valor = brl(input.valorCentavos);
  const refConta = input.nomeCurto ? `da conta "${input.nomeCurto}"` : "de uma conta sua";
  const linhasPorTipo: Record<LembreteContaType, string> = {
    conta_vencendo_hoje: `Bom dia! Hoje vence o pagamento ${refConta} no Gasto Inteligente.`,
    conta_vencendo_amanha: `Lembrete: amanhã vence o pagamento ${refConta} no Gasto Inteligente.`,
    conta_atrasada: `Atenção: o pagamento ${refConta} está atrasado.`,
    conta_recorrente_pendente: `Lembrete: você tem um pagamento recorrente ${refConta} chegando.`,
  };
  const text = [
    linhasPorTipo[input.type],
    `Valor: ${valor}`,
    "",
    "Como deseja responder?",
    "1. Paguei",
    "2. Adiar",
    "3. Ver detalhes",
    "4. Ignorar",
  ].join("\n");
  return {
    text,
    quickReplies: ["Paguei", "Adiar", "Ver detalhes", "Ignorar"],
  };
}
