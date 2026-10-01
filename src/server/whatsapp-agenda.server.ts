/**
 * GI Agenda no WhatsApp — usa as MESMAS funções do site (agenda.server.ts).
 * O user_id vem do número vinculado (resolvido antes pelo pipeline); nada
 * aqui aceita user_id/source_id vindos do texto.
 */
import {
  AgendaError,
  createAgendaItem,
  findAgendaByTitle,
  getAgendaItem,
  itemWhenLabel,
  listAgenda,
  financialAvisoAt,
  resolveFinancialSource,
  setAgendaStatus,
  updateAgendaItem,
  type AgendaDeps,
  type AgendaRow,
} from "./agenda.server";
import {
  AGENDA_CANCEL_PREFIX,
  AGENDA_DONE_PREFIX,
  AGENDA_EDIT_PREFIX,
  AGENDA_VIEW_PREFIX,
  detectAgendaIntent,
  tituloFromBody,
  type AgendaIntent,
} from "@/lib/agenda/intent";
import {
  DEFAULT_TZ,
  addDaysYmd,
  localParts,
  localToUtc,
  parseWhen,
  resolveWhen,
  formatWhen,
} from "@/lib/agenda/datetime";

export type AgendaReply = {
  resposta: string;
  /** Objeto `interactive` da Graph API (botões/lista). */
  graphInteractive?: Record<string, unknown>;
  itemId?: string;
  /** Nenhum item da agenda casou: o pipeline segue para os fluxos financeiros. */
  notMatched?: boolean;
};

export { detectAgendaIntent };

function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

type Btn = { id: string; title: string };

function buttonsMsg(body: string, list: Btn[]) {
  return {
    type: "button",
    body: { text: body.slice(0, 1024) },
    action: { buttons: list.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
  };
}

function viewTitle(item: AgendaRow): string {
  if (item.source_type === "cartao") return "💳 Ver fatura";
  if (item.source_type === "conta_a_pagar") return "🧾 Ver conta";
  return "👀 Ver";
}

/**
 * Ações logo após criar/editar: nunca "Concluir" (o item ainda nem aconteceu).
 * Financeiro → Ver / Editar aviso / Cancelar aviso. Comum → Editar / Cancelar.
 */
export function postCreateButtons(item: AgendaRow): Btn[] {
  if (item.source_type)
    return [
      { id: `${AGENDA_VIEW_PREFIX}${item.id}`, title: viewTitle(item) },
      { id: `${AGENDA_EDIT_PREFIX}${item.id}`, title: "✏️ Editar aviso" },
      { id: `${AGENDA_CANCEL_PREFIX}${item.id}`, title: "❌ Cancelar aviso" },
    ];
  return [
    { id: `${AGENDA_EDIT_PREFIX}${item.id}`, title: "✏️ Editar" },
    { id: `${AGENDA_CANCEL_PREFIX}${item.id}`, title: "❌ Cancelar" },
  ];
}

/** Ações ao abrir um item existente: aqui "Concluir" faz sentido. */
export function existingItemButtons(item: AgendaRow): Btn[] {
  if (item.source_type)
    return [
      { id: `${AGENDA_EDIT_PREFIX}${item.id}`, title: "✏️ Editar aviso" },
      { id: `${AGENDA_CANCEL_PREFIX}${item.id}`, title: "❌ Cancelar aviso" },
    ];
  return [
    { id: `${AGENDA_DONE_PREFIX}${item.id}`, title: "✅ Concluir" },
    { id: `${AGENDA_EDIT_PREFIX}${item.id}`, title: "✏️ Editar" },
    { id: `${AGENDA_CANCEL_PREFIX}${item.id}`, title: "❌ Cancelar" },
  ];
}

function ddmm(y: { d: number; m: number }): string {
  return `${String(y.d).padStart(2, "0")}/${String(y.m).padStart(2, "0")}`;
}

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Texto de um item financeiro com dados AO VIVO (valor é só informativo). */
async function financialDetails(item: AgendaRow, deps?: AgendaDeps): Promise<string> {
  const snap = await resolveFinancialSource(item, deps);
  const icon = item.source_type === "cartao" ? "💳" : item.source_type === "conta_a_pagar" ? "🧾" : "🔁";
  if (!snap.ok) return `${icon} ${item.titulo}\n${snap.reason === "payable_paid" ? "✅ Já paga" : "Sem vencimento no momento"}`;
  const dias = item.aviso_dias_antes ?? 1;
  const tz = item.timezone || DEFAULT_TZ;
  const due = snap.dueIso.slice(0, 10).split("-").map(Number);
  const aviso = localParts(financialAvisoAt(snap.dueIso, dias, item.aviso_hora_local ?? 9, tz), tz);
  const avisoTxt = dias === 0 ? `🔔 Aviso em ${ddmm(aviso)} (no dia do vencimento)` : `🔔 Aviso em ${ddmm(aviso)} (${dias} dia${dias > 1 ? "s" : ""} antes)`;
  const valor = snap.valor != null ? `\n💰 Valor atual: ${brl(snap.valor)}` : "";
  return `${icon} ${item.titulo}\n📅 Vence em ${ddmm({ d: due[2], m: due[1] })}\n${avisoTxt}${valor}`;
}

function fixedDetails(item: AgendaRow, now: Date): string {
  if (!item.starts_at) return `🔔 ${item.titulo}`;
  const lp = localParts(new Date(item.starts_at), item.timezone);
  const full = formatWhen(item.starts_at, item.timezone, now);
  const dia = full.split(" às ")[0];
  const hora = `${String(lp.h).padStart(2, "0")}:${String(lp.mi).padStart(2, "0")}`;
  const icon = item.kind === "compromisso" ? "📅" : "🔔";
  return `${icon} ${item.titulo}\n📅 ${dia}\n🕘 ${hora}`;
}

function pickList(body: string, items: AgendaRow[], prefix: string, labels: Map<string, string>) {
  return {
    type: "list",
    body: { text: body.slice(0, 1024) },
    action: {
      button: "Escolher",
      sections: [
        {
          title: "Agenda",
          rows: items.slice(0, 10).map((r) => ({
            id: `${prefix}${r.id}`,
            title: r.titulo.slice(0, 24),
            description: (labels.get(r.id) ?? "").slice(0, 72),
          })),
        },
      ],
    },
  };
}

const ICON = (r: AgendaRow) => (r.source_type ? "💳" : r.kind === "compromisso" ? "📅" : "🔔");

async function sameOrPick(
  userId: string,
  alvo: string,
  acao: "concluir" | "cancelar",
  deps?: AgendaDeps,
): Promise<AgendaReply | AgendaRow> {
  const found = await findAgendaByTitle(userId, alvo, deps);
  if (found.length === 1) return found[0];
  if (!found.length) return { resposta: "", notMatched: true };
  const labels = new Map<string, string>();
  for (const r of found) labels.set(r.id, await itemWhenLabel(r, deps));
  const body = `Encontrei ${found.length} itens com "${alvo}". Qual deles?`;
  return {
    resposta: `${body}\n${found
      .slice(0, 10)
      .map((r, i) => `${i + 1}. ${r.titulo} — ${labels.get(r.id)}`)
      .join("\n")}`,
    graphInteractive: pickList(body, found, acao === "cancelar" ? AGENDA_CANCEL_PREFIX : AGENDA_DONE_PREFIX, labels),
  };
}

async function resolveSourceByName(
  userId: string,
  kind: "cartao" | "conta_a_pagar" | "recorrencia",
  nome: string,
  deps?: AgendaDeps,
): Promise<{ id: string; nome: string }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = deps?.client ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const table = kind === "cartao" ? "cartoes" : kind === "conta_a_pagar" ? "contas_a_pagar" : "recorrencias";
  let q = db.from(table).select("id, nome").eq("user_id", userId);
  if (kind === "conta_a_pagar") q = q.eq("status", "pendente");
  const { data } = await q.limit(200);
  const alvo = norm(nome).replace(/[^a-z0-9 ]/g, " ").trim();
  const rows = ((data as { id: string; nome: string }[]) ?? []).filter((r) => {
    const n = norm(r.nome);
    return n.includes(alvo) || alvo.includes(n);
  });
  // Contas: uma por nome (a pendente mais próxima já vem filtrada por status).
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = norm(r.nome);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function handleAgendaIntent(
  userId: string,
  intent: AgendaIntent,
  opts: { now?: Date; tz?: string; deps?: AgendaDeps } = {},
): Promise<AgendaReply> {
  const now = opts.now ?? opts.deps?.now?.() ?? new Date();
  const tz = opts.tz ?? DEFAULT_TZ;
  const deps: AgendaDeps = { ...opts.deps, now: () => now };
  try {
    switch (intent.type) {
      case "criar": {
        const { titulo, when } = tituloFromBody(intent.when.rest, now, tz);
        const at = resolveWhen(when, now, tz);
        if (!at) {
          return {
            resposta: `Para quando é "${titulo || intent.titulo}"? Ex.: *amanhã às 9*, *sexta às 14h* ou *10/10 às 08:30*.`,
          };
        }
        const item = await createAgendaItem(
          userId,
          {
            kind: intent.kind,
            titulo: titulo || intent.titulo,
            starts_at: at.toISOString(),
            timezone: tz,
            recurrence_freq: intent.recurrence,
            origem: "whatsapp",
          },
          deps,
        );
        const rec = intent.recurrence ? `\n🔁 Repete: ${intent.recurrence}` : "";
        const head = intent.kind === "compromisso" ? "Compromisso agendado! 📅" : "Pronto! Vou te lembrar 🔔";
        const body = `${head}\n\n${fixedDetails(item, now)}${rec}\n\nTambém aparece na Agenda do site.`;
        return { resposta: body, graphInteractive: buttonsMsg(body, postCreateButtons(item)), itemId: item.id };
      }
      case "criar_financeiro": {
        const fontes = await resolveSourceByName(userId, intent.sourceKind, intent.nome, deps);
        const tipo = intent.sourceKind === "cartao" ? "cartão" : intent.sourceKind === "conta_a_pagar" ? "conta pendente" : "assinatura";
        if (!fontes.length) return { resposta: `Não encontrei ${tipo} "${intent.nome}" no seu Gasto Inteligente.` };
        if (fontes.length > 1)
          return {
            resposta: `Encontrei mais de um ${tipo} com "${intent.nome}": ${fontes
              .slice(0, 5)
              .map((f) => f.nome)
              .join(", ")}. Envie o nome completo.`,
          };
        const f = fontes[0];
        const prefixo = intent.sourceKind === "cartao" ? "Fatura" : intent.sourceKind === "recorrencia" ? "Assinatura" : "Conta";
        const item = await createAgendaItem(
          userId,
          {
            kind: "lembrete",
            titulo: `${prefixo} ${f.nome}`,
            source_type: intent.sourceKind,
            source_id: f.id,
            aviso_dias_antes: intent.diasAntes,
            timezone: tz,
            origem: "whatsapp",
          },
          deps,
        );
        const body = `Combinado! 🔔\n\n${await financialDetails(item, deps)}\n\nO valor e o vencimento serão conferidos novamente no momento do aviso.`;
        return { resposta: body, graphInteractive: buttonsMsg(body, postCreateButtons(item)), itemId: item.id };
      }
      case "consultar": {
        const lp = localParts(now, tz);
        const today = { y: lp.y, m: lp.m, d: lp.d };
        let from: Date | null = null;
        let to: Date | null = null;
        let titulo = "📅 Próximos itens da agenda";
        if (intent.periodo === "hoje") {
          from = localToUtc(today, { h: 0, mi: 0 }, tz);
          to = localToUtc(addDaysYmd(today, 1), { h: 0, mi: 0 }, tz);
          titulo = "📅 Sua agenda de hoje";
        } else if (intent.periodo === "amanha") {
          from = localToUtc(addDaysYmd(today, 1), { h: 0, mi: 0 }, tz);
          to = localToUtc(addDaysYmd(today, 2), { h: 0, mi: 0 }, tz);
          titulo = "📅 Sua agenda de amanhã";
        } else if (intent.periodo === "semana") {
          from = localToUtc(today, { h: 0, mi: 0 }, tz);
          to = localToUtc(addDaysYmd(today, 7), { h: 0, mi: 0 }, tz);
          titulo = "📅 Próximos 7 dias";
        } else from = new Date(now.getTime() - 3600_000);
        const all = await listAgenda(userId, { status: "ativo" }, deps);
        const rows = all.filter((r) => {
          if (!r.starts_at) return intent.periodo === "proximos" || intent.periodo === "semana";
          const t = new Date(r.starts_at).getTime();
          return (!from || t >= from.getTime()) && (!to || t < to.getTime());
        });
        if (!rows.length) {
          const quando = intent.periodo === "hoje" ? "hoje" : intent.periodo === "amanha" ? "amanhã" : "nos próximos dias";
          return { resposta: `Nada na sua agenda ${quando}. ✨\nPara criar: *me lembra amanhã às 9 de pagar a internet*.` };
        }
        const lines: string[] = [];
        for (const r of rows.slice(0, 15)) lines.push(`${ICON(r)} ${r.titulo} — ${await itemWhenLabel(r, deps)}`);
        return { resposta: `${titulo}\n\n${lines.join("\n")}${rows.length > 15 ? `\n… e mais ${rows.length - 15} no site.` : ""}` };
      }
      case "editar": {
        const found = await findAgendaByTitle(userId, intent.alvo, deps);
        if (!found.length) return { resposta: "", notMatched: true };
        if (found.length > 1)
          return { resposta: `Encontrei ${found.length} itens com "${intent.alvo}". Diga o nome completo para eu alterar o certo.` };
        const item = found[0];
        if (item.source_type)
          return { resposta: `"${item.titulo}" segue o vencimento do item financeiro. Para mudar a data, altere o vencimento em Contas/Cartões.` };
        const w = parseWhen(intent.when.rest, now, item.timezone);
        const base = item.starts_at ? new Date(item.starts_at) : now;
        const blp = localParts(base, item.timezone);
        // Só hora → mantém o dia; só dia → mantém a hora.
        const date = w.date ?? (w.instant ? null : { y: blp.y, m: blp.m, d: blp.d });
        const time = w.time ?? { h: blp.h, mi: blp.mi };
        const at = w.instant ?? (date ? localToUtc(date, time, item.timezone) : null);
        if (!at) return { resposta: "Não entendi o novo horário. Ex.: *mude o dentista para 15h*." };
        const upd = await updateAgendaItem(userId, item.id, { starts_at: at.toISOString() }, deps);
        const body = `Atualizado ✏️\n\n${fixedDetails(upd, now)}`;
        return { resposta: body, graphInteractive: buttonsMsg(body, postCreateButtons(upd)), itemId: upd.id };
      }
      case "editar_aviso": {
        const found = (await findAgendaByTitle(userId, intent.alvo, deps)).filter((r) => r.source_type);
        if (!found.length) return { resposta: "", notMatched: true };
        if (found.length > 1)
          return { resposta: `Encontrei ${found.length} avisos com "${intent.alvo}". Diga o nome completo para eu alterar o certo.` };
        const upd = await updateAgendaItem(userId, found[0].id, { aviso_dias_antes: intent.diasAntes }, deps);
        const body = `Aviso atualizado ✏️\n\n${await financialDetails(upd, deps)}\n\nO valor e o vencimento serão conferidos novamente no momento do aviso.`;
        return { resposta: body, graphInteractive: buttonsMsg(body, postCreateButtons(upd)), itemId: upd.id };
      }
      case "cancelar":
      case "concluir": {
        const r = await sameOrPick(userId, intent.alvo, intent.type, deps);
        if (!("id" in r)) return r;
        return await applyAction(userId, r.id, intent.type, deps, now);
      }
      case "acao_id":
        return await applyAction(userId, intent.id, intent.acao, deps, now);
    }
  } catch (err) {
    if (err instanceof AgendaError) {
      return { resposta: err.code === "source_not_owned" ? "Não encontrei esse item financeiro." : err.message };
    }
    throw err;
  }
}

async function applyAction(
  userId: string,
  id: string,
  acao: "concluir" | "cancelar" | "editar" | "ver",
  deps: AgendaDeps,
  now: Date,
): Promise<AgendaReply> {
  const cur = await getAgendaItem(userId, id, deps);
  if (!cur) return { resposta: "Esse item não está mais na sua agenda." };
  if (acao === "ver") {
    const det = cur.source_type ? await financialDetails(cur, deps) : fixedDetails(cur, now);
    const st = cur.status === "ativo" ? "" : `\n\nSituação: ${cur.status}`;
    const body = `${det}${st}`;
    return cur.status === "ativo"
      ? { resposta: body, graphInteractive: buttonsMsg(body, existingItemButtons(cur)), itemId: cur.id }
      : { resposta: body, itemId: cur.id };
  }
  if (acao === "editar") {
    if (cur.status !== "ativo") return { resposta: `"${cur.titulo}" não está mais ativo.` };
    const ex = cur.source_type
      ? `Para mudar a antecedência, envie:\n*mude o aviso da ${cur.titulo} para 5 dias antes*\n\nA data do vencimento segue o item financeiro.`
      : `Para mudar o horário, envie:\n*mude ${cur.titulo} para sexta às 15h*\n\nTambém dá para editar na Agenda do site.`;
    return { resposta: `✏️ Editar "${cur.titulo}"\n\n${ex}`, itemId: cur.id };
  }
  if (cur.status !== "ativo")
    return { resposta: `"${cur.titulo}" já está ${cur.status === "cancelado" ? "cancelado" : "concluído"}.` };
  const { row, advanced } = await setAgendaStatus(userId, id, acao, deps);
  if (acao === "cancelar")
    return { resposta: row.source_type ? `Tudo certo, cancelei o aviso "${row.titulo}". ❌` : `Tudo certo, cancelei "${row.titulo}". ❌`, itemId: row.id };
  if (advanced && row.starts_at)
    return { resposta: `Feito ✅ "${row.titulo}". Próxima vez: ${formatWhen(row.starts_at, row.timezone, now)}.`, itemId: row.id };
  return { resposta: `Feito ✅ "${row.titulo}" marcado como concluído.`, itemId: row.id };
}
