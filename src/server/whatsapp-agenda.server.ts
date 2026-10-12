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
  listActivePage,
  financialAvisoAt,
  resolveFinancialSource,
  setAgendaStatus,
  updateAgendaItem,
  type AgendaDeps,
  type AgendaRow,
} from "./agenda.server";
import {
  AGENDA_CANCEL_PREFIX,
  AGENDA_CANCEL_PAGE_PREFIX,
  AGENDA_CANCEL_OK_PREFIX,
  AGENDA_CANCEL_BACK_ID,
  AGENDA_DONE_PREFIX,
  AGENDA_EDIT_PREFIX,
  AGENDA_VIEW_PREFIX,
  AGENDA_VIEW_INVOICE_PREFIX,
  AGENDA_VIEW_BILL_PREFIX,
  detectAgendaIntent,
  tituloFromBody,
  type AgendaIntent,
  type AgendaAcaoId,
} from "@/lib/agenda/intent";
import { nomeMesYm } from "@/lib/fatura-competencia";
import { nextOccurrence } from "@/lib/agenda/recurrence";
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

/** ID explícito por entidade (não depende do texto do botão). */
function viewId(item: AgendaRow): string {
  if (item.source_type === "cartao") return `${AGENDA_VIEW_INVOICE_PREFIX}${item.id}`;
  if (item.source_type === "conta_a_pagar") return `${AGENDA_VIEW_BILL_PREFIX}${item.id}`;
  return `${AGENDA_VIEW_PREFIX}${item.id}`;
}

/**
 * Ações logo após criar/editar: nunca "Concluir" (o item ainda nem aconteceu).
 * Financeiro → Ver / Editar aviso / Cancelar aviso. Comum → Editar / Cancelar.
 */
export function postCreateButtons(item: AgendaRow): Btn[] {
  if (item.source_type)
    return [
      { id: viewId(item), title: viewTitle(item) },
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

function ddmmDate(d: Date | null): string | null {
  return d ? ddmm({ d: d.getDate(), m: d.getMonth() + 1 }) : null;
}

/**
 * "💳 Ver fatura": mostra a FATURA do cartão vinculado (não o lembrete).
 * Mesma fonte de "minha fatura do Nubank" e da tela Cartões:
 * getFaturaAtualPorCartao + getItensFaturaAtualPorCartao.
 */
async function invoiceView(item: AgendaRow, deps?: AgendaDeps): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = deps?.client ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const { data: cartao } = await db
    .from("cartoes")
    .select("id, nome, dia_fechamento, dia_vencimento, limite_total")
    .eq("id", item.source_id)
    .eq("user_id", item.user_id)
    .maybeSingle();
  if (!cartao) return `💳 ${item.titulo}\nNão encontrei mais esse cartão no seu Gasto Inteligente.`;
  const det = deps?.faturaDetalhe
    ? await deps.faturaDetalhe(item.user_id, cartao)
    : await (async () => {
        const m = await import("./cartao-fatura.server");
        const [fatura, itens] = await Promise.all([
          m.getFaturaAtualPorCartao(item.user_id, cartao),
          m.getItensFaturaAtualPorCartao(item.user_id, cartao),
        ]);
        return { fatura, itens };
      })();
  const { cleanDescricaoDisplay } = await import("./whatsapp-faturas.server");
  const f = det.fatura;
  const linhas = [`💳 Fatura ${cartao.nome} — ${nomeMesYm(f.competencia)}`, "", `💰 Valor atual: ${brl(f.total)}`];
  const venc = ddmmDate(f.vencimento);
  const fech = ddmmDate(f.fechamento);
  if (venc) linhas.push(`📅 Vencimento: ${venc}`);
  if (fech) linhas.push(`🗓️ Fechamento: ${fech}`);
  if (f.limite > 0) linhas.push(`💳 Limite disponível: ${brl(f.disponivel)}`);
  const recentes = [...det.itens].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0)).slice(0, 5);
  linhas.push("");
  if (recentes.length) {
    linhas.push("Últimas compras:");
    for (const i of recentes) {
      const parc = i.parcelaAtual && i.totalParcelas ? ` (${i.parcelaAtual}/${i.totalParcelas})` : "";
      linhas.push(`• ${cleanDescricaoDisplay(i.descricao)}${parc} — ${brl(i.valor)}`);
    }
    if (det.itens.length > recentes.length) linhas.push(`… e mais ${det.itens.length - recentes.length}. Peça "compras da fatura do ${cartao.nome}".`);
  } else linhas.push("Nenhuma compra nesta fatura até agora.");
  return linhas.join("\n");
}

/** "🧾 Ver conta" / "👀 Ver" (assinatura): mostra a entidade de origem. */
async function sourceView(item: AgendaRow, deps?: AgendaDeps): Promise<string> {
  const snap = await resolveFinancialSource(item, deps);
  const conta = item.source_type === "conta_a_pagar";
  const icon = conta ? "🧾" : "🔁";
  if (!snap.ok) {
    const why = snap.reason === "payable_paid" ? "✅ Já paga" : snap.reason === "payable_cancelled" ? "Cancelada" : "Não encontrei mais esse item.";
    return `${icon} ${item.titulo}\n${why}`;
  }
  const due = snap.dueIso.slice(0, 10).split("-").map(Number);
  const linhas = [`${icon} ${conta ? "Conta" : "Assinatura"} ${snap.nome}`, ""];
  if (snap.valor != null) linhas.push(`💰 Valor: ${brl(snap.valor)}`);
  linhas.push(`📅 ${conta ? "Vencimento" : "Próxima cobrança"}: ${ddmm({ d: due[2], m: due[1] })}`);
  if (conta) linhas.push("Situação: pendente");
  return linhas.join("\n");
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
        let at = resolveWhen(when, now, tz);
        if (at && at.getTime() <= now.getTime()) {
          // Recorrente: começa na próxima ocorrência futura. Único: não agenda no passado.
          at = intent.recurrence ? nextOccurrence(at, { freq: intent.recurrence }, now, tz) : null;
          if (!at)
            return { resposta: `Esse horário já passou. Para quando é "${titulo || intent.titulo}"? Ex.: *amanhã às 9* ou *hoje às 20h*.` };
        }
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
        if (intent.adiar && item.recurrence_freq)
          return { resposta: `"${item.titulo}" se repete (${item.recurrence_freq}). Adiar mudaria todas as próximas vezes, então não alterei. Para mudar o horário da série, diga por exemplo *mude ${item.titulo} para 15h*, ou ajuste na Agenda do site.` };
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
        if (intent.type === "cancelar") return await askCancel(userId, r.id, deps, now);
        return await applyAction(userId, r.id, intent.type, deps, now);
      }
      case "escolher": {
        const ativos = await listAgenda(userId, { status: "ativo" }, deps);
        if (intent.acao === "adiar") {
          const elegiveis = ativos.filter((r) => !r.source_type && !r.recurrence_freq);
          if (!elegiveis.length)
            return { resposta: "Não há lembrete único para adiar. Lembretes que se repetem e avisos de contas/faturas não são adiados por aqui." };
          const lines: string[] = [];
          for (const r of elegiveis.slice(0, 10)) lines.push(`${ICON(r)} ${r.titulo} — ${await itemWhenLabel(r, deps)}`);
          return { resposta: `Qual lembrete quer adiar?\n\n${lines.join("\n")}\n\nResponda com o nome, ex.: *adie o lembrete ${elegiveis[0].titulo} para ${intent.when?.rest ?? "amanhã"}*.` };
        }
        if (intent.acao === "cancelar") return await cancelPage(userId, 0, deps);
        if (!ativos.length) return { resposta: "Você não tem lembretes ativos na agenda." };
        const labels = new Map<string, string>();
        for (const r of ativos.slice(0, 10)) labels.set(r.id, await itemWhenLabel(r, deps));
        const verbo = intent.acao === "cancelar" ? "cancelar" : "marcar como concluído";
        const body = `Qual item você quer ${verbo}? Toque em um da lista.`;
        return {
          resposta: `${body}\n${ativos.slice(0, 10).map((r, i) => `${i + 1}. ${r.titulo} — ${labels.get(r.id)}`).join("\n")}`,
          graphInteractive: pickList(body, ativos, intent.acao === "cancelar" ? AGENDA_CANCEL_PREFIX : AGENDA_DONE_PREFIX, labels),
        };
      }
      case "cancel_page":
        return await cancelPage(userId, intent.page, deps);
      case "cancel_ok": {
        const ageMin = Math.floor(now.getTime() / 60_000) - intent.issuedMin;
        if (!(ageMin >= 0 && ageMin <= CANCEL_TTL_MIN))
          return { resposta: "Essa confirmação expirou e nada foi cancelado. Envie *cancelar lembrete* para escolher de novo." };
        const r = await applyAction(userId, intent.id, "cancelar", deps, now);
        return r.resposta.startsWith("Tudo certo") ? { ...r, resposta: `${r.resposta}\nO histórico fica preservado na Agenda do site.` } : r;
      }
      case "historico": {
        const old = (await listAgenda(userId, { status: "todos" }, deps)).filter((r) => r.status !== "ativo").slice(-10).reverse();
        if (!old.length) return { resposta: "Você ainda não tem lembretes cancelados ou concluídos." };
        return { resposta: `🗂️ Histórico (últimos ${old.length})\n\n${old.map((r) => `• ${r.titulo} — ${r.status}`).join("\n")}` };
      }
      case "acao_id":
        // Cancelar por botão sempre passa por um resumo + confirmação.
        if (intent.acao === "cancelar") return await askCancel(userId, intent.id, deps, now);
        return await applyAction(userId, intent.id, intent.acao, deps, now);
    }
  } catch (err) {
    if (err instanceof AgendaError) {
      return { resposta: err.code === "source_not_owned" ? "Não encontrei esse item financeiro." : err.message };
    }
    throw err;
  }
}

const CANCEL_PAGE_SIZE = 8; // + até 2 linhas de navegação = 10 (limite da Meta)
const CANCEL_TTL_MIN = 30;
const FREQ_TXT: Record<string, string> = { diaria: "todo dia", semanal: "toda semana", mensal: "todo mês", anual: "todo ano" };
const ORIGEM_TXT = (o: string | null | undefined) => (o === "whatsapp" ? "WhatsApp" : o === "site" ? "Site" : "");

async function cancelPage(userId: string, page: number, deps: AgendaDeps): Promise<AgendaReply> {
  const { rows, hasMore } = await listActivePage(userId, page, CANCEL_PAGE_SIZE, deps);
  if (!rows.length && page === 0) return { resposta: "Você não tem lembretes ativos na agenda. Nada para cancelar. ✨" };
  if (!rows.length) return await cancelPage(userId, 0, deps);
  const labels = new Map<string, string>();
  for (const r of rows) {
    const extra = [r.recurrence_freq ? FREQ_TXT[r.recurrence_freq] : "", ORIGEM_TXT(r.origem)].filter(Boolean).join(" · ");
    labels.set(r.id, `${await itemWhenLabel(r, deps)}${extra ? ` · ${extra}` : ""}`);
  }
  const body = `Qual item você quer cancelar? (página ${page + 1})\nAvisos de conta/fatura: cancelar o aviso não apaga a conta, o cartão nem lançamentos.`;
  const navRows: Array<{ id: string; title: string; description: string }> = [];
  if (page > 0) navRows.push({ id: `${AGENDA_CANCEL_PAGE_PREFIX}${page - 1}`, title: "⬅️ Anteriores", description: `Página ${page}` });
  if (hasMore) navRows.push({ id: `${AGENDA_CANCEL_PAGE_PREFIX}${page + 1}`, title: "➡️ Próximos", description: `Página ${page + 2}` });
  const list = pickList(body, rows, AGENDA_CANCEL_PREFIX, labels) as { action: { sections: Array<{ rows: unknown[] }> } };
  list.action.sections[0].rows.push(...navRows);
  const start = page * CANCEL_PAGE_SIZE;
  return {
    resposta: `${body}\n${rows.map((r, i) => `${start + i + 1}. ${ICON(r)} ${r.titulo} — ${labels.get(r.id)}`).join("\n")}${hasMore ? "\n… há mais itens: toque em *Próximos*." : ""}`,
    graphInteractive: list as unknown as Record<string, unknown>,
  };
}

async function askCancel(userId: string, id: string, deps: AgendaDeps, now: Date): Promise<AgendaReply> {
  const cur = await getAgendaItem(userId, id, deps);
  if (!cur) return { resposta: "Esse item não está mais na sua agenda." };
  if (cur.status !== "ativo") return { resposta: `"${cur.titulo}" já está ${cur.status === "cancelado" ? "cancelado" : "concluído"}. Nada foi alterado.` };
  const when = await itemWhenLabel(cur, deps);
  const rec = cur.recurrence_freq ? `\n🔁 ${FREQ_TXT[cur.recurrence_freq]} — todas as próximas vezes serão canceladas.` : "";
  const fin = cur.source_type ? "\n\nIsso cancela só o aviso. A conta/fatura e seus lançamentos continuam como estão." : "";
  const origem = ORIGEM_TXT(cur.origem);
  const body = `Cancelar este item?\n\n${ICON(cur)} ${cur.titulo}\n🗓️ ${when}${origem ? `\nCriado no ${origem}` : ""}${rec}${fin}`;
  const okId = `${AGENDA_CANCEL_OK_PREFIX}${cur.id}:${Math.floor(now.getTime() / 60_000).toString(36)}`;
  return {
    resposta: `${body}\n\nToque em *Confirmar cancelamento* (vale por ${CANCEL_TTL_MIN} min).`,
    graphInteractive: buttonsMsg(body, [
      { id: okId, title: "❌ Confirmar cancel." },
      { id: AGENDA_CANCEL_BACK_ID, title: "↩️ Voltar" },
    ]),
    itemId: cur.id,
  };
}

async function applyAction(
  userId: string,
  id: string,
  acao: AgendaAcaoId,
  deps: AgendaDeps,
  now: Date,
): Promise<AgendaReply> {
  const cur = await getAgendaItem(userId, id, deps);
  if (!cur) return { resposta: "Esse item não está mais na sua agenda." };
  if (acao === "ver" || acao === "ver_fatura" || acao === "ver_conta") {
    // O tipo do item (não o texto do botão) decide a entidade. O ID legado
    // `agenda_view:` de mensagens antigas cai aqui e abre a mesma visão.
    const det =
      cur.source_type === "cartao"
        ? await invoiceView(cur, deps)
        : cur.source_type
          ? await sourceView(cur, deps)
          : fixedDetails(cur, now);
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
