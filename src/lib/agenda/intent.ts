/**
 * GI Agenda — intenção em linguagem natural (WhatsApp).
 *
 * Só reconhece frases com gatilho explícito de agenda ("me lembra",
 * "tenho dentista sexta às 14h", "o que tenho amanhã", "meus lembretes",
 * "mude o dentista para 15h", "cancele o lembrete da internet").
 * "gastei 50" / "paguei 50" NUNCA casam aqui — continuam no fluxo financeiro.
 */
import { parseWhen, type ParsedWhen } from "./datetime";
import { detectRecurrence, stripRecurrence, type RecurrenceFreq } from "./recurrence";

export type AgendaIntent =
  | {
      type: "criar";
      kind: "lembrete" | "compromisso";
      titulo: string;
      when: ParsedWhen;
      recurrence: RecurrenceFreq | null;
    }
  | {
      type: "criar_financeiro";
      sourceKind: "cartao" | "conta_a_pagar" | "recorrencia";
      nome: string;
      diasAntes: number;
    }
  | { type: "consultar"; periodo: "hoje" | "amanha" | "semana" | "proximos" }
  | { type: "editar"; alvo: string; when: ParsedWhen; novoTitulo?: string; adiar?: boolean }
  | { type: "cancelar"; alvo: string }
  | { type: "concluir"; alvo: string }
  /** Comando sem alvo ("cancelar lembrete", "concluir", "adiar para amanhã"): o usuário escolhe. */
  | { type: "escolher"; acao: "cancelar" | "concluir" | "adiar"; when?: ParsedWhen }
  | { type: "editar_aviso"; alvo: string; diasAntes: number }
  | { type: "acao_id"; acao: AgendaAcaoId; id: string }
  | { type: "cancel_page"; page: number }
  | { type: "cancel_ok"; id: string; issuedMin: number; sig: string }
  | { type: "historico" };

/**
 * "ver" = genérico/legado (botões já enviados): abre a entidade conforme o
 * tipo do item. "ver_fatura"/"ver_conta" = IDs explícitos dos botões novos.
 */
export type AgendaAcaoId = "concluir" | "cancelar" | "editar" | "ver" | "ver_fatura" | "ver_conta";

export const AGENDA_DONE_PREFIX = "agenda_done:";
export const AGENDA_CANCEL_PREFIX = "agenda_cancel:";
export const AGENDA_EDIT_PREFIX = "agenda_edit:";
export const AGENDA_VIEW_PREFIX = "agenda_view:";
export const AGENDA_VIEW_INVOICE_PREFIX = "agenda_view_invoice:";
export const AGENDA_VIEW_BILL_PREFIX = "agenda_view_bill:";
/** Cancelamento em 2 passos: página da lista → resumo → confirmação (com validade). */
export const AGENDA_CANCEL_PAGE_PREFIX = "agenda_cpage:";
export const AGENDA_CANCEL_OK_PREFIX = "agenda_cancel_ok:";
export const AGENDA_CANCEL_BACK_ID = "agenda_cancel_back";

function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const REMIND_RE = /^(?:gi[, ]+)?(?:por favor[, ]+)?(?:me lembr[ae]r?|me lembre|lembre-?me|lembra-?me|me avis[ae]r?|cri[ae]r? (?:um )?lembrete|novo lembrete|lembrete)\b[:,]?\s*/;
const APPT_RE = /^(?:gi[, ]+)?(?:eu )?(?:tenho|terei|vou ter|marquei|marca(?:r)?|agend[ae]r?|agenda(?:r)?|cri[ae]r? (?:um )?compromisso|novo compromisso|compromisso)\b[:,]?\s*/;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function cleanTitle(rest: string): string {
  return rest
    .replace(/^(?:de|que|da|do|pra|para|a|o|um|uma)\s+/, "")
    .replace(/^(?:de|que|pra|para)\s+/, "")
    .replace(/\s+(?:as|a|de|em|no|na|para|pra|e)$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectAgendaIntent(text: string): AgendaIntent | null {
  const raw = (text ?? "").trim();
  if (!raw || raw.length > 400) return null;
  const cpage = new RegExp(`^${AGENDA_CANCEL_PAGE_PREFIX}(\\d{1,4})$`).exec(raw);
  if (cpage) return { type: "cancel_page", page: Number(cpage[1]) };
  if (raw === AGENDA_CANCEL_BACK_ID) return { type: "cancel_page", page: 0 };
  const cok = new RegExp(`^${AGENDA_CANCEL_OK_PREFIX}(${UUID}):([0-9a-z]{1,10}):([A-Za-z0-9_-]{22})$`).exec(raw);
  if (cok) return { type: "cancel_ok", id: cok[1].toLowerCase(), issuedMin: parseInt(cok[2], 36), sig: cok[3] };
  // Formato antigo/sem assinatura: nunca cancela; o handler pede para escolher de novo.
  if (raw.startsWith(AGENDA_CANCEL_OK_PREFIX)) return { type: "cancel_ok", id: "", issuedMin: -1, sig: "" };
  const idDone = new RegExp(`^${AGENDA_DONE_PREFIX}(${UUID})$`, "i").exec(raw);
  if (idDone) return { type: "acao_id", acao: "concluir", id: idDone[1].toLowerCase() };
  const idCancel = new RegExp(`^${AGENDA_CANCEL_PREFIX}(${UUID})$`, "i").exec(raw);
  if (idCancel) return { type: "acao_id", acao: "cancelar", id: idCancel[1].toLowerCase() };
  const idEdit = new RegExp(`^${AGENDA_EDIT_PREFIX}(${UUID})$`, "i").exec(raw);
  if (idEdit) return { type: "acao_id", acao: "editar", id: idEdit[1].toLowerCase() };
  const idInv = new RegExp(`^${AGENDA_VIEW_INVOICE_PREFIX}(${UUID})$`, "i").exec(raw);
  if (idInv) return { type: "acao_id", acao: "ver_fatura", id: idInv[1].toLowerCase() };
  const idBill = new RegExp(`^${AGENDA_VIEW_BILL_PREFIX}(${UUID})$`, "i").exec(raw);
  if (idBill) return { type: "acao_id", acao: "ver_conta", id: idBill[1].toLowerCase() };
  const idView = new RegExp(`^${AGENDA_VIEW_PREFIX}(${UUID})$`, "i").exec(raw);
  if (idView) return { type: "acao_id", acao: "ver", id: idView[1].toLowerCase() };

  const n = norm(raw).replace(/[?!.]+$/g, "");

  // Editar antecedência de um aviso financeiro: "mude o aviso da fatura nubank para 5 dias antes"
  const ea = /^(?:mud[ae]r?|alter[ae]r?|troc[ae]r?) (?:o )?aviso (?:da |do |de )?(.+?) para (\d{1,2}) dias? antes$/.exec(n);
  if (ea) return { type: "editar_aviso", alvo: ea[1].trim(), diasAntes: Math.min(60, Number(ea[2])) };

  // Consultas
  if (/^(?:(?:quais (?:sao )?)?(?:os )?meus (?:lembretes|compromissos)|minha agenda|agenda|meus lembretes|meus compromissos|lembretes|compromissos|ver (?:minha )?agenda|proximos (?:lembretes|compromissos))$/.test(n))
    return { type: "consultar", periodo: "proximos" };
  let m = /^(?:o que|oque|que) (?:eu )?(?:tenho|terei|tem)(?: (?:marcado|na agenda|agendado))?(?: para| pra)? (hoje|amanha|essa semana|esta semana|nesta semana|na semana)$/.exec(n);
  if (!m) m = /^(?:agenda|lembretes|compromissos|minha agenda) (?:de |para |pra |da )?(hoje|amanha|essa semana|esta semana|semana)$/.exec(n);
  if (m) {
    const p = m[1];
    return { type: "consultar", periodo: p === "hoje" ? "hoje" : p === "amanha" ? "amanha" : "semana" };
  }

  // Comandos sem alvo: nunca escolhem sozinhos; o handler lista para o usuário escolher.
  if (/^(?:cancel(?:e|a|ar)|apag(?:ue|a|ar)|remov(?:e|a|er)|exclu(?:a|i|ir))\s+(?:o |meu )?(?:lembrete|compromisso)$/.test(n))
    return { type: "escolher", acao: "cancelar" };
  if (/^confirm(?:ar|o|e) (?:o )?cancelamento$/.test(n)) return { type: "escolher", acao: "cancelar" };
  if (/^(?:lembretes (?:cancelados|concluidos|antigos)|historico (?:de |dos )?lembretes|historico da agenda)$/.test(n)) return { type: "historico" };
  if (/^(?:conclu(?:a|i|ir|ido)|marc(?:a|ar|ue) (?:o lembrete )?como (?:feito|concluido)|finaliz(?:e|a|ar)(?: o lembrete)?|conclu(?:a|i|ir) (?:o )?lembrete)$/.test(n))
    return { type: "escolher", acao: "concluir" };
  m = /^(?:adi(?:e|a|ar)|remarc(?:a|ar)|remarque)(?: o lembrete)?\s+(?:para|pra)\s+(.+)$/.exec(n);
  if (m) {
    const w = parseWhen(m[1], new Date(0));
    if (w.date || w.time || w.instant) return { type: "escolher", acao: "adiar", when: whenPlaceholder(m[1]) };
  }

  // Cancelar / concluir item da agenda (precisa citar lembrete/compromisso OU um alvo + "da agenda").
  m = /^(?:cancel(?:e|a|ar)|apag(?:ue|a|ar)|remov(?:e|a|er)|exclu(?:a|i|ir))\s+(?:o |a |meu |minha )?(?:lembrete|compromisso)\s*(?:de |da |do |das |dos |com |para |pra )?(.+)$/.exec(n);
  if (m && m[1].trim()) return { type: "cancelar", alvo: m[1].trim() };
  m = /^(?:conclu(?:a|i|ir|ido)|marc(?:a|ar|ue) (?:como )?(?:feito|concluido)|finaliz(?:e|a|ar))\s+(?:o |a )?(?:lembrete|compromisso)?\s*(?:de |da |do |com )?(.+)$/.exec(n);
  if (m && m[1].trim()) return { type: "concluir", alvo: m[1].trim().replace(/ como (?:feito|concluido)$/, "") };

  // Editar: "mude o dentista para 15h", "remarque a reuniao para sexta"
  m = /^(?:mud(?:e|a|ar)|alter(?:e|a|ar)|remarc(?:a|ar)|remarque|pass(?:e|a|ar)|adi(?:e|a|ar)|troc(?:a|ar|que))\s+(?:o |a |meu |minha )?(?:lembrete |compromisso )?(?:de |da |do )?(.+?)\s+(?:para|pra)\s+(.+)$/.exec(n);
  if (m && !/\b(vencimento|valor|conta|fatura|limite|fechamento|categoria|gasto|receita|pagamento)\b/.test(m[1])) {
    const when = parseWhen(m[2], new Date(0));
    // Só é edição de agenda se o destino é data/hora.
    if (when.date || when.time || when.instant) return { type: "editar", alvo: m[1].trim(), when: whenPlaceholder(m[2]), ...(/^adi/.test(n) ? { adiar: true } : {}) };
  }

  // Lembrete financeiro: "me lembra da fatura do Nubank 3 dias antes"
  const remind = REMIND_RE.exec(n);
  if (remind) {
    const rest = n.slice(remind[0].length);
    const fin = /^(?:de |da |do )?(?:pagar )?(?:a |o )?(fatura|conta|boleto|assinatura)\s+(?:do |da |de |dos )?(?:cartao |cartao de credito )?(.+?)\s+(\d{1,2}|um|uma|dois|tres) dias? antes(?: do vencimento)?$/.exec(rest);
    if (fin) {
      const word = fin[1];
      const dias = { um: 1, uma: 1, dois: 2, tres: 3 }[fin[3] as "um"] ?? Number(fin[3]);
      return {
        type: "criar_financeiro",
        sourceKind: word === "fatura" ? "cartao" : word === "assinatura" ? "recorrencia" : "conta_a_pagar",
        nome: fin[2].trim(),
        diasAntes: Math.min(60, dias),
      };
    }
    const fin1 = /^(?:de |da |do )?(?:pagar )?(?:a |o )?(fatura)\s+(?:do |da |de )?(?:cartao )?(.+?)\s+(?:no dia do vencimento|no vencimento|um dia antes|na vespera)$/.exec(rest);
    if (fin1) {
      return { type: "criar_financeiro", sourceKind: "cartao", nome: fin1[2].trim(), diasAntes: /antes|vespera/.test(rest) ? 1 : 0 };
    }
    return buildCriar("lembrete", raw, remind[0].length);
  }
  const appt = APPT_RE.exec(n);
  if (appt) {
    const out = buildCriar("compromisso", raw, appt[0].length);
    // "tenho 50 reais?" não é compromisso: exige data/hora.
    if (out) {
      const w = parseWhen(out.when.rest, new Date(0));
      if (w.date || w.time || w.instant) return out;
    }
  }
  return null;
}

/** Guarda o texto do horário; o handler reinterpreta com o relógio real. */
function whenPlaceholder(t: string): ParsedWhen {
  return { date: null, time: null, instant: null, rest: t };
}

function buildCriar(kind: "lembrete" | "compromisso", raw: string, cutLen: number): AgendaIntent & { type: "criar" } | null {
  const n = norm(raw).replace(/[?!.]+$/g, "");
  const rec = detectRecurrence(n);
  const body = stripRecurrence(n.slice(cutLen));
  const when = whenPlaceholder(body);
  const parsed = parseWhen(body, new Date(0));
  const titulo = cleanTitle(parsed.rest);
  if (!titulo) return null;
  return { type: "criar", kind, titulo, when, recurrence: rec };
}

/** Título a partir do corpo, usando o relógio real (para o handler). */
export function tituloFromBody(body: string, now: Date, tz?: string): { titulo: string; when: ParsedWhen } {
  const w = parseWhen(body, now, tz);
  return { titulo: cleanTitle(w.rest), when: w };
}
