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
  setAgendaStatus,
  updateAgendaItem,
  type AgendaDeps,
  type AgendaRow,
} from "./agenda.server";
import {
  AGENDA_CANCEL_PREFIX,
  AGENDA_DONE_PREFIX,
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

function buttons(body: string, item: AgendaRow) {
  return {
    type: "button",
    body: { text: body.slice(0, 1024) },
    action: {
      buttons: [
        { type: "reply", reply: { id: `${AGENDA_DONE_PREFIX}${item.id}`, title: "✅ Concluir" } },
        { type: "reply", reply: { id: `${AGENDA_CANCEL_PREFIX}${item.id}`, title: "❌ Cancelar" } },
      ],
    },
  };
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
        const body = `${head}\n• ${item.titulo}\n• ${formatWhen(at, tz, now)}${rec}\n\nTambém aparece na Agenda do site.`;
        return { resposta: body, graphInteractive: buttons(body, item), itemId: item.id };
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
        const label = await itemWhenLabel(item, deps);
        const body = `Combinado! 🔔 Vou te avisar ${intent.diasAntes === 0 ? "no dia do vencimento" : `${intent.diasAntes} dia(s) antes do vencimento`}.\n• ${item.titulo}\n• ${label}\n\nO valor e a data são conferidos de novo na hora do aviso.`;
        return { resposta: body, graphInteractive: buttons(body, item), itemId: item.id };
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
        const body = `Atualizado ✏️\n• ${upd.titulo}\n• ${formatWhen(at, upd.timezone, now)}`;
        return { resposta: body, graphInteractive: buttons(body, upd), itemId: upd.id };
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
  acao: "concluir" | "cancelar",
  deps: AgendaDeps,
  now: Date,
): Promise<AgendaReply> {
  const cur = await getAgendaItem(userId, id, deps);
  if (!cur) return { resposta: "Esse item não está mais na sua agenda." };
  if (cur.status !== "ativo")
    return { resposta: `"${cur.titulo}" já está ${cur.status === "cancelado" ? "cancelado" : "concluído"}.` };
  const { row, advanced } = await setAgendaStatus(userId, id, acao, deps);
  if (acao === "cancelar") return { resposta: `Tudo certo, cancelei "${row.titulo}". ❌`, itemId: row.id };
  if (advanced && row.starts_at)
    return { resposta: `Feito ✅ "${row.titulo}". Próxima vez: ${formatWhen(row.starts_at, row.timezone, now)}.`, itemId: row.id };
  return { resposta: `Feito ✅ "${row.titulo}" marcado como concluído.`, itemId: row.id };
}
