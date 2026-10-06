/** WhatsApp 1.3: deterministic planning proposals, never an unconfirmed write. */
import { supabaseAdmin as _admin } from "@/integrations/supabase/client.server";
import { calcMetaProgresso } from "@/lib/metas-progresso";
import { validarDiaCartao, validarLimiteCartao, validarNomeCartao } from "@/lib/cartao-validacao";
import { findCartoesDoUsuarioByTerm, getFaturaAtualPorCartao, loadCartoesDoUsuario } from "./cartao-fatura.server";
import { toGraphInteractive } from "./whatsapp-interactive.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = _admin as any;
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const buttons = (body: string, id: string) => toGraphInteractive({ type: "button", body, buttons: [
  { id: `wa13_confirm:${id}`, title: "Confirmar" },
  { id: `wa13_adjust:${id}`, title: "Ajustar" },
  { id: `wa13_cancel:${id}`, title: "Cancelar" },
] });
type Kind = "goal_create" | "goal_add" | "goal_withdraw" | "goal_edit" | "goal_cancel" |
  "recurrence_create" | "recurrence_edit" | "recurrence_cancel" | "card_edit";
type Draft = { id: string; user_id: string; telefone: string; kind: Kind; target_id: string | null;
  payload: Record<string, unknown>; state: "draft" | "ready" | "applied" | "cancelled";
  expires_at: string; source_external_id: string };
type Reply = { resposta: string; graphInteractive?: Record<string, unknown> };
type Entity = { id: string; nome: string; [key: string]: unknown };

export function parseMoney(text: string): number | null {
  const m = text.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(mil|milhao|milhoes)?\b/i);
  if (!m) return null;
  const raw = m[1];
  const n = raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", "."))
    : /^\d{1,3}(?:\.\d{3})+$/.test(raw) ? Number(raw.replace(/\./g, "")) : Number(raw);
  const multiplier = m[2] ? norm(m[2]).startsWith("milha") || norm(m[2]).startsWith("milho") ? 1_000_000 : 1_000 : 1;
  const v = Math.round(n * multiplier * 100) / 100;
  return Number.isFinite(v) && v > 0 && v <= 99_999_999 ? v : null;
}

const months = ["janeiro","fevereiro","marco","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
function parseDate(text: string): string | null {
  const t = norm(text);
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) {
    const d=new Date(`${iso[0]}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===iso[0] ? iso[0] : null;
  }
  const full = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/.exec(t);
  if (full) {
    const d = new Date(Date.UTC(Number(full[3]), Number(full[2])-1, Number(full[1])));
    return d.getUTCDate() === Number(full[1]) && d.getUTCMonth()+1 === Number(full[2])
      ? `${full[3]}-${full[2].padStart(2,"0")}-${full[1].padStart(2,"0")}` : null;
  }
  const month = months.findIndex(x => new RegExp(`\\b${x}\\b`).test(t));
  if (month < 0) return null;
  const year = /\b20\d{2}\b/.exec(t);
  const now = new Date();
  const y = year ? Number(year[0]) : now.getUTCFullYear() + (month < now.getUTCMonth() ? 1 : 0);
  return `${y}-${String(month+1).padStart(2,"0")}-${String(new Date(Date.UTC(y,month+1,0)).getUTCDate()).padStart(2,"0")}`;
}
function nextDay(day: number): string {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const thisMonth = new Date(Date.UTC(y,m,Math.min(day,new Date(Date.UTC(y,m+1,0)).getUTCDate())));
  const target = thisMonth >= new Date(Date.UTC(y,m,now.getUTCDate())) ? thisMonth :
    new Date(Date.UTC(y,m+1,Math.min(day,new Date(Date.UTC(y,m+2,0)).getUTCDate())));
  return target.toISOString().slice(0,10);
}
function cleanName(s: string): string {
  return s.replace(/\s+(?:por|de|no valor de|ate|até|todo dia|todos os meses).*$/i, "")
    .replace(/\s+(?:r\$\s*)?\d+(?:[.,]\d+)?(?:\s*mil)?(?:\s.*)?$/i, "").trim();
}
export function detectPlanningIntent(text: string): { kind: Kind; term?: string; payload: Record<string, unknown> } | null {
  const t = norm(text);
  let m: RegExpExecArray | null;
  if (/\b(?:quero |pode )?(?:criar|cria|fazer|faz|nova) (?:uma )?meta\b/.test(t) || /\bquero juntar\b/.test(t)) {
    m = /(?:meta(?: de)?|juntar)\s+(?:r\$\s*)?[\d.,]+(?:\s*mil)?\s+(?:para|pra)\s+(.+)$/i.exec(text);
    return { kind: "goal_create", payload: { name: m ? cleanName(m[1]) : "", amount: parseMoney(text), date: parseDate(text) } };
  }
  m = /\b(?:guardei|coloca|coloque|adicione|adiciona|aporta|aportei)\s+(?:r\$\s*)?[\d.,]+(?:\s*mil)?\s+(?:na|no|para|pra|em)\s+(?:meta\s+)?(.+)$/i.exec(text);
  if (m) return { kind: "goal_add", term: m[1].trim(), payload: { amount: parseMoney(text) } };
  m = /\b(?:retirei|retira|tira|saquei)\s+(?:r\$\s*)?[\d.,]+(?:\s*mil)?\s+(?:da|do|de)\s+(?:meta\s+)?(.+)$/i.exec(text);
  if (m) return { kind: "goal_withdraw", term: m[1].trim(), payload: { amount: parseMoney(text) } };
  m = /\b(?:muda|altera|edita)\s+(?:a\s+)?meta\s+(.+?)\s+(?:para|pra)\s+(?:r\$\s*)?([\d.,]+(?:\s*mil)?)/i.exec(text);
  if (m) return { kind: "goal_edit", term: m[1].trim(), payload: { field: "target", value: parseMoney(m[2]) } };
  m = /\b(?:renomeia|muda o nome da)\s+meta\s+(.+?)\s+(?:para|pra)\s+(.+)$/i.exec(text);
  if (m) return { kind: "goal_edit", term: m[1].trim(), payload: { field: "name", value: m[2].trim().slice(0,80) } };
  m = /\b(?:muda|altera)\s+(?:o\s+)?prazo\s+da\s+meta\s+(.+?)\s+(?:para|pra)\s+(.+)$/i.exec(text);
  if (m) return { kind: "goal_edit", term: m[1].trim(), payload: { field: "date", value: parseDate(m[2]) } };
  m = /\b(?:cancela|exclui|apaga)\s+(?:a\s+)?meta\s+(.+)$/i.exec(text);
  if (m) return { kind: "goal_cancel", term: m[1].trim(), payload: {} };
  m = /\b(?:assino|assinei|cria (?:uma )?assinatura de|criar (?:uma )?assinatura de|pago)\s+(.+)$/i.exec(text);
  if (m && (/\b(?:por|de|todo dia|mensal|semanal|anual)\b/i.test(m[1]) || /assinatura/i.test(text))) {
    const name = cleanName(m[1]);
    const day = /\b(?:todo dia|dia)\s+(\d{1,2})\b/i.exec(text);
    const frequency = /\banual\b/i.test(text) ? "anual" : /\bquinzenal\b/i.test(text) ? "quinzenal" : /\bsemanal\b/i.test(text) ? "semanal" : "mensal";
    const withoutDay = text.replace(/\b(?:todo dia|dia)\s+\d{1,2}\b/i, "");
    return { kind: "recurrence_create", payload: { name, amount: parseMoney(withoutDay), frequency,
      type: /\b(?:internet|luz|energia|agua|aluguel|condominio)\b/.test(t) ? "recorrencia_fixa" : "assinatura",
      ...(day && Number(day[1]) >= 1 && Number(day[1]) <= 31 ? { date: nextDay(Number(day[1])) } : {}) } };
  }
  m = /\b(?:cancela|cancelar)\s+(?:a\s+)?(?:assinatura|recorrencia)\s+(?:da|do|de)?\s*(.+)$/i.exec(text);
  if (m) return { kind: "recurrence_cancel", term: m[1].trim(), payload: {} };
  m = /\b(.+?)\s+(?:agora custa|aumentou para|passou para)\s+(?:r\$\s*)?([\d.,]+)/i.exec(text);
  if (m) return { kind: "recurrence_edit", term: m[1].trim(), payload: { field: "amount", value: parseMoney(m[2]) } };
  m = /\b(?:muda|altera)\s+(.+?)\s+para\s+dia\s+(\d{1,2})\b/i.exec(text);
  if (m && !/\b(?:limite|vencimento|fechamento|cartao)\b/i.test(m[1])) return { kind:"recurrence_edit",term:m[1].trim(),payload:{field:"date",value:nextDay(Number(m[2]))} };
  m = /\b(?:muda|altera|edita)\s+(?:o\s+)?(limite|vencimento|fechamento|nome|banco|emissor)\s+(?:do|da|de)\s+(.+?)\s+(?:para|pra|dia)\s+(.+)$/i.exec(text);
  if (m) return { kind: "card_edit", term: m[2].trim(), payload: { field: ({limite:"limit",vencimento:"due",fechamento:"closing",nome:"name",banco:"bank",emissor:"bank"} as Record<string,string>)[norm(m[1])], raw: m[3].trim() } };
  m = /\b(?:meu|minha|o)\s+(.+?)\s+vence\s+dia\s+(\d{1,2})\b/i.exec(text);
  if (m) return { kind: "card_edit", term: m[1].trim(), payload: { field: "due", raw: m[2] } };
  m = /\b(?:o\s+)?(fechamento|vencimento)\s+agora\s+(?:e|é)\s+dia\s+(\d{1,2})\b/i.exec(text);
  if (m) return {kind:"card_edit",payload:{field:norm(m[1])==="fechamento"?"closing":"due",raw:m[2]}};
  m = /\b(?:renomeia|renomear)\s+(?:o\s+)?cartao\s+(.+?)\s+(?:para|pra)\s+(.+)$/i.exec(text);
  if (m) return { kind:"card_edit",term:m[1].trim(),payload:{field:"name",raw:m[2].trim()} };
  return null;
}

function feature(kind: Kind): string { return kind.startsWith("goal") ? "metas" : kind.startsWith("recurrence") ? "assinaturas_recorrencias" : "cartoes_basico"; }
async function allowed(userId: string, kind: Kind): Promise<boolean> {
  const { data, error } = await db.rpc("has_feature_access", { _user_id: userId, _feature: feature(kind) });
  return !error && data === true;
}
function table(kind: Kind): string { return kind.startsWith("goal") ? "metas_financeiras" : kind.startsWith("recurrence") ? "recorrencias" : "cartoes"; }
async function findEntities(userId: string, kind: Kind, term: string): Promise<Entity[]> {
  const { data, error } = await db.from(table(kind)).select("*").eq("user_id", userId).limit(100);
  if (error) throw error;
  const rows = (data ?? []) as Entity[];
  const active = kind.startsWith("recurrence") ? rows.filter(r => !["cancelada","excluida"].includes(String(r.status))) : rows;
  const n = norm(term).replace(/^(meta|do|da|de|cartao|assinatura)\s+/, "");
  return active.filter(r => norm(r.nome).includes(n) || n.includes(norm(r.nome))).slice(0,10);
}
async function loadDraft(userId: string, phone: string): Promise<Draft | null> {
  try {
    const { data, error } = await db.from("whatsapp_planning_actions").select("*")
      .eq("user_id",userId).eq("telefone",phone).in("state",["draft","ready"])
      .gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if (error) return null;
    return data as Draft | null;
  } catch {
    // Before migration 1.3 (or in older test doubles), legacy intents must
    // still run. No write is attempted without this table.
    return null;
  }
}
async function saveDraft(draft: Draft, patch: Partial<Draft>): Promise<Draft> {
  const { data, error } = await db.from("whatsapp_planning_actions").update(patch)
    .eq("id",draft.id).eq("user_id",draft.user_id).eq("telefone",draft.telefone)
    .in("state",["draft","ready"]).gt("expires_at",new Date().toISOString()).select("*").single();
  if (error || !data) throw new Error("wa13_draft_update_failed");
  return data as Draft;
}
function prompt(d: Draft): string | null {
  const p = d.payload;
  if (p.candidates && !d.target_id) return "Encontrei mais de uma opção. Escolha pelo número da lista ou envie o nome completo.";
  if (!d.target_id && d.kind !== "goal_create" && d.kind !== "recurrence_create")
    return d.kind==="card_edit" ? "Qual cartão você quer editar? Envie o nome como aparece no app." : "Qual registro você quer alterar?";
  if (d.kind === "goal_create" || d.kind === "recurrence_create") {
    if (!p.name) return d.kind === "goal_create" ? "Qual é o nome da meta?" : "Qual serviço ou conta recorrente?";
    if (!p.amount) return d.kind === "goal_create" ? "Qual é o valor objetivo?" : "Qual é o valor da cobrança?";
  }
  if (["goal_add","goal_withdraw"].includes(d.kind) && !p.amount) return "Qual valor?";
  if (["goal_edit","recurrence_edit"].includes(d.kind) && !p.value) return "Qual é o novo valor?";
  if (d.kind==="card_edit" && !p.raw && !p.value) return "Qual é o novo valor?";
  return null;
}
function preview(d: Draft, entity?: Entity | null): Reply {
  const p = d.payload;
  const name = String(entity?.nome ?? p.name ?? "");
  const amount = Number(p.amount ?? p.value ?? 0);
  const date = p.date ? `\nPrazo/próxima data: ${String(p.date)}` : "";
  const label: Record<Kind,string> = {
    goal_create:"🎯 Criar meta",goal_add:"🎯 Adicionar à meta",goal_withdraw:"🎯 Retirar da meta",
    goal_edit:"🎯 Editar meta",goal_cancel:"🎯 Excluir meta",recurrence_create:"🔁 Criar recorrência",
    recurrence_edit:"🔁 Editar série recorrente",recurrence_cancel:"🔁 Cancelar série recorrente",card_edit:"💳 Editar cartão",
  };
  const fieldLabel=({name:"Nome",bank:"Banco",target:"Objetivo",date:"Data",amount:"Valor",limit:"Limite",closing:"Fechamento",due:"Vencimento"} as Record<string,string>)[String(p.field)]??String(p.field);
  const change = p.field ? `\n${fieldLabel}: ${String(p.before ?? "—")} → ${String(p.value)}` : "";
  const current = d.kind==="recurrence_cancel" ? `\n${brl(Number(entity?.valor??0))}/${String(entity?.frequencia??"mês")}`
    : d.kind==="goal_cancel" ? `\nObjetivo: ${brl(Number(entity?.valor_objetivo??0))}` : "";
  const frequency = d.kind==="recurrence_create" ? `\nFrequência: ${String(p.frequency)}` : "";
  const body = `${label[d.kind]}\n${name}${amount > 0 && !p.field ? `\n${brl(amount)}` : ""}${current}${frequency}${date}${change}\n\nConfirma?`;
  const cancelAction=d.kind==="goal_cancel"||d.kind==="recurrence_cancel";
  return { resposta: body, graphInteractive: cancelAction ? toGraphInteractive({type:"button",body,buttons:[
    {id:`wa13_confirm:${d.id}`,title:"Confirmar"},{id:`wa13_cancel:${d.id}`,title:"Manter"}]}) : buttons(body,d.id) };
}
async function complete(d: Draft): Promise<Reply> {
  if (!d.target_id && d.kind !== "goal_create" && d.kind !== "recurrence_create") return { resposta: "Não identifiquei o registro. Envie o nome completo." };
  let entity: Entity | null = null;
  if (d.target_id) {
    const { data, error } = await db.from(table(d.kind)).select("*").eq("id",d.target_id).eq("user_id",d.user_id).maybeSingle();
    if (error || !data) return { resposta: "Não encontrei esse registro. Consulte o app e tente de novo." };
    entity = data as Entity;
  }
  const p = { ...d.payload };
  if (d.kind === "card_edit") {
    const f = String(p.field), raw = String(p.raw ?? p.value ?? "");
    if (f === "name") { const v = validarNomeCartao(raw); if (!v.ok) return { resposta: v.erro }; p.value = v.valor; }
    else if (f === "bank") { const value=raw.trim(); if(!/^[^\d<>]{2,60}$/.test(value)) return {resposta:"Use apenas o nome do banco ou emissor, sem números."}; p.value=value; }
    else if (f === "limit") { const v = validarLimiteCartao(raw); if (!v.ok) return { resposta: v.erro }; p.value = v.valor; }
    else if (f === "closing" || f === "due") { const v = validarDiaCartao(raw,f === "closing" ? "fechamento":"vencimento"); if (!v.ok) return { resposta: v.erro }; p.value = v.valor; }
    const column = ({ name:"nome", bank:"banco", limit:"limite_total", closing:"dia_fechamento", due:"dia_vencimento" } as Record<string,string>)[f];
    p.before = String(entity?.[column] ?? "");
  }
  if (d.kind === "goal_edit") p.before = String(entity?.[p.field === "target" ? "valor_objetivo" : p.field === "date" ? "prazo" : "nome"] ?? "");
  if (d.kind === "recurrence_edit") p.before = String(entity?.[p.field === "amount" ? "valor" : "proxima_cobranca"] ?? "");
  const ready = await saveDraft(d,{ payload:p, state:"ready" });
  return preview(ready,entity);
}

async function recentGoalList(userId: string, phone: string): Promise<string[]> {
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data, error } = await db.from("whatsapp_messages").select("parsed")
    .eq("user_id",userId).eq("telefone",phone).eq("parsed->>kind","wa13_goal_list")
    .gte("recebida_em",since).order("recebida_em",{ascending:false}).limit(1).maybeSingle();
  return !error && Array.isArray(data?.parsed?.ids) ? data.parsed.ids.filter((id:unknown)=>typeof id==="string").slice(0,5) : [];
}
async function goalSummary(args: {userId:string;phone:string;externalId:string|null;text:string}): Promise<Reply | null> {
  const {userId,text}=args;
  const t = norm(text);
  const list = /^(?:minhas metas|metas|ver metas|listar metas)$/.test(t);
  if (!list && (!/\b(?:meta|guardado)\b/.test(t) || !/\b(?:mais perto|quanto tenho guardado|quanto falta|como esta)\b/.test(t))) return null;
  const [mr,gr,vr] = await Promise.all([
    db.from("metas_financeiras").select("id,nome,valor_atual,valor_objetivo,prazo").eq("user_id",userId),
    db.from("dinheiro_guardado").select("meta_id,valor").eq("user_id",userId),
    db.from("movimentacoes_meta").select("meta_id,valor").eq("user_id",userId),
  ]);
  if (mr.error || gr.error || vr.error) return { resposta:"Não consegui consultar suas metas agora. Tente novamente." };
  const rows = (mr.data ?? []).map((m: Entity) => ({ m, p: calcMetaProgresso({ valorAtual:m.valor_atual as number,
    valorObjetivo:m.valor_objetivo as number,guardados:(gr.data ?? []).filter((g:{meta_id:string})=>g.meta_id===m.id),
    movimentacoes:(vr.data ?? []).filter((v:{meta_id:string})=>v.meta_id===m.id) }) }));
  if (!rows.length) return { resposta:"Você ainda não tem metas. Diga “criar meta” para começar." };
  if (list) {
    const shown=rows.slice(0,5);
    const resposta=`🎯 Suas metas (${rows.length})\n${shown.map((x:{m:Entity;p:{total:number;objetivo:number}},i:number)=>`${i+1}. ${x.m.nome}: ${brl(x.p.total)} de ${brl(x.p.objetivo)}`).join("\n")}\n\nPara aportar, diga “coloca 300 na primeira”. O valor mostrado é progresso em metas, não saldo bancário.`;
    if(args.externalId) {
      const {error}=await db.from("whatsapp_messages").insert({user_id:userId,telefone:args.phone,
        external_id:args.externalId,texto:text,recebida_em:new Date().toISOString(),status:"sem_pendencia",
        parsed:{kind:"wa13_goal_list",ids:shown.map((x:{m:Entity})=>x.m.id)},resposta_sugerida:resposta});
      if(error && error.code!=="23505") throw error;
    }
    return {resposta};
  }
  if (/mais perto/.test(t)) {
    const best = rows.filter((x:{p:{restante:number;objetivo:number}})=>x.p.objetivo>0 && x.p.restante>0)
      .sort((a:{p:{percentual:number}},b:{p:{percentual:number}})=>b.p.percentual-a.p.percentual)[0];
    return { resposta:best ? `🎯 ${best.m.nome} é a mais próxima: ${best.p.percentual}% concluída; faltam ${brl(best.p.restante)}.` : "Todas as suas metas com objetivo foram atingidas." };
  }
  const term = /\bmeta\s+(?:do|da|de)?\s*(.+)$/.exec(t)?.[1]?.replace(/[?!.]+$/g,"").trim() || null;
  const filtered = term ? rows.filter((x:{m:Entity})=>norm(x.m.nome).includes(term)) : rows;
  if (!filtered.length) return { resposta:"Não encontrei essa meta. Diga “minhas metas” para ver os nomes." };
  const total = filtered.reduce((s:number,x:{p:{total:number}})=>s+x.p.total,0);
  return { resposta:`🎯 Guardado em metas: ${brl(total)}\n${filtered.slice(0,5).map((x:{m:Entity;p:{total:number;objetivo:number;restante:number}})=>`• ${x.m.nome}: ${brl(x.p.total)} de ${brl(x.p.objetivo)} (faltam ${brl(x.p.restante)})`).join("\n")}\n\nIsso é progresso registrado em metas, não saldo bancário.` };
}

async function recurrenceSummary(userId: string, text: string): Promise<Reply | null> {
  const t = norm(text);
  if (!(/\b(?:assinatura|assinaturas|recorrencia|recorrencias)\b/.test(t) && /\b(?:quanto|mais cara|renova|mensal|total)\b/.test(t))
    && !/^o que renova (?:esse|este) mes$/.test(t)) return null;
  const { data,error } = await db.from("recorrencias").select("nome,valor,frequencia,proxima_cobranca,tipo_recorrencia,moeda")
    .eq("user_id",userId).eq("status","ativa");
  if (error) return { resposta:"Não consegui consultar as recorrências agora." };
  const rows = (data ?? []) as Array<{nome:string;valor:number;frequencia:string;proxima_cobranca:string|null;tipo_recorrencia:string;moeda:string}>;
  if (!rows.length) return { resposta:"Você não tem recorrências ativas registradas." };
  const brlRows = rows.filter(r=>r.moeda === "BRL");
  const equiv = (r:typeof rows[number]) => r.frequencia === "semanal" ? r.valor*4.345 : r.frequencia === "quinzenal" ? r.valor*2.1725 : r.frequencia === "anual" ? r.valor/12 : r.valor;
  if (/mais cara/.test(t)) {
    const top = [...brlRows].sort((a,b)=>equiv(b)-equiv(a))[0];
    return { resposta:top ? `🔁 Maior recorrência em BRL: ${top.nome}, equivalente a ${brl(equiv(top))}/mês.` : "Não há recorrências em BRL para comparar." };
  }
  if (/renova/.test(t)) {
    const ym = new Date().toISOString().slice(0,7);
    const due = rows.filter(r=>r.proxima_cobranca?.startsWith(ym));
    return { resposta:due.length ? `🔁 Renovam neste mês:\n${due.slice(0,8).map(r=>`• ${r.nome}: ${r.proxima_cobranca} (${r.moeda} ${r.valor})`).join("\n")}` : "Nenhuma recorrência com data confiável registrada para este mês." };
  }
  return { resposta:`🔁 ${rows.length} recorrências ativas. Total mensal equivalente em BRL: ${brl(brlRows.reduce((s,r)=>s+equiv(r),0))}. ${rows.length-brlRows.length ? "Moedas estrangeiras não foram somadas." : ""}` };
}

export function detectCardLimitQuestion(text:string): {kind:"available";term:string}|{kind:"highest"}|null {
  const t=norm(text);
  if (/^qual cartao tem (?:mais|maior) limite\??$/.test(t)) return {kind:"highest"};
  const m=/^quanto (?:falta|tenho disponivel|resta) de limite (?:no|do|da) (.+?)\??$/.exec(t);
  return m ? {kind:"available",term:m[1].replace(/[?!.]+$/g,"").trim()} : null;
}
async function cardLimitSummary(userId:string,text:string):Promise<Reply|null> {
  const q=detectCardLimitQuestion(text);
  if(!q) return null;
  if(q.kind==="highest") {
    const cards=await loadCartoesDoUsuario(userId);
    const top=[...cards].sort((a,b)=>Number(b.limite_total??0)-Number(a.limite_total??0))[0];
    return {resposta:top ? `💳 ${top.nome} tem o maior limite cadastrado: ${brl(Number(top.limite_total??0))}. Não é uma consulta bancária em tempo real.`
      : "Você ainda não tem cartão cadastrado no app."};
  }
  const cards=await findCartoesDoUsuarioByTerm(userId,q.term);
  if(!cards.length) return {resposta:`Não encontrei um cartão chamado “${q.term}”. Confira o nome no app.`};
  if(cards.length>1) return {resposta:`Encontrei mais de um cartão: ${cards.map(c=>c.nome).join(", ")}. Envie o nome completo.`};
  const f=await getFaturaAtualPorCartao(userId,cards[0]);
  return {resposta:`💳 ${cards[0].nome}: limite disponível estimado ${brl(f.disponivel)}. Limite cadastrado: ${brl(f.limite)}; fatura atual registrada: ${brl(f.total)}. Baseado nos lançamentos do Gasto Inteligente, sem consulta bancária em tempo real.`};
}

export async function handlePlanning(args:{userId:string;phone:string;externalId:string|null;text:string}):Promise<Reply|null> {
  const text = args.text.trim();
  if (norm(text)==="editar cartao") return {resposta:"Para editar, diga por exemplo: “muda o limite do Nubank para 5000” ou “muda o vencimento do Nubank para dia 10”."};
  const cmd = /^wa13_(confirm|cancel|adjust|pick):([0-9a-f-]{36})(?::(\d{1,2}))?$/i.exec(text);
  if (cmd) {
    const {data,error} = await db.from("whatsapp_planning_actions").select("*").eq("id",cmd[2])
      .eq("user_id",args.userId).eq("telefone",args.phone).maybeSingle();
    if (error || !data) return { resposta:"Essa ação não está disponível." };
    const d = data as Draft;
    if (cmd[1]==="confirm") {
      const {data:result,error:rpcError} = await db.rpc("whatsapp_apply_planning_action",{p_id:d.id,p_user_id:args.userId,p_telefone:args.phone});
      if (rpcError) return { resposta:"Não consegui concluir. Seus dados não foram alterados; tente novamente." };
      if (["applied","already_applied"].includes(result?.status)) return { resposta:"✅ Confirmado. A alteração foi registrada. Consulte o app para ver os dados atualizados." };
      if (result?.status==="has_history") return { resposta:"Essa meta tem histórico de movimentações. Para preservá-lo, faça a exclusão pelo app." };
      return { resposta:"A ação expirou ou os dados mudaram. Nada foi alterado; comece novamente." };
    }
    if (d.state==="applied" || d.state==="cancelled" || Date.parse(d.expires_at)<=Date.now()) return { resposta:"Esse pedido já terminou ou expirou." };
    if (cmd[1]==="cancel") { await saveDraft(d,{state:"cancelled"}); return { resposta:"Tudo bem, nada foi alterado." }; }
    if (cmd[1]==="adjust") {
      if(d.kind==="goal_cancel"||d.kind==="recurrence_cancel") return {resposta:"Para escolher outro registro, mantenha este e faça um novo pedido com o nome exato."};
      await saveDraft(d,{state:"draft",payload:{...d.payload,amount:null,value:null,raw:null}});
      return { resposta:"Certo. Envie o novo valor; para mudar outra informação, cancele e comece de novo." };
    }
    if (cmd[1]==="pick" && Array.isArray(d.payload.candidates)) {
      const id = (d.payload.candidates as string[])[Number(cmd[3])-1];
      if (!id) return { resposta:"Escolha uma opção válida." };
      return complete(await saveDraft(d,{target_id:id,payload:{...d.payload,candidates:null}}));
    }
  }

  let intent = detectPlanningIntent(text);
  if (!intent) {
    const genericCancel = /^cancela\s+(.+)$/i.exec(text);
    if (genericCancel && !/^(?:a\s+)?(?:meta|conta|cartao|fatura)\b/i.test(genericCancel[1])
      && !/^(?:a\s+|o\s+)?(?:\d{1,2}|primeir[ao]|segund[ao]|terceir[ao])$/i.test(genericCancel[1].trim())) {
      const name=genericCancel[1].trim();
      const recs=await findEntities(args.userId,"recurrence_cancel",name);
      if(recs.length) {
        const {data:accounts,error}=await db.from("contas_a_pagar").select("nome")
          .eq("user_id",args.userId).limit(100);
        if(error) return {resposta:"Não consegui identificar com segurança. Diga “cancela assinatura Nome” ou “cancela conta Nome”."};
        if((accounts??[]).some((a:{nome:string})=>norm(a.nome).includes(norm(name))))
          return {resposta:"Encontrei uma assinatura e uma conta com esse nome. Diga “cancela assinatura Nome” ou “cancela conta Nome”."};
        intent={kind:"recurrence_cancel",term:name,payload:{}};
      }
    }
  }
  if (intent && args.externalId) {
    if (!(await allowed(args.userId,intent.kind))) return { resposta:"Seu plano não inclui essa função. Consulte os recursos disponíveis no app." };
    let targetId:string|null = null, candidates:string[]|null = null;
    if (intent.term) {
      const ordinal = /^(?:a\s+|o\s+)?(primeir[ao]|segund[ao]|terceir[ao]|quart[ao]|quint[ao]|[1-5])$/i.exec(intent.term);
      if (intent.kind.startsWith("goal_") && ordinal) {
        const index=({primeira:0,primeiro:0,segunda:1,segundo:1,terceira:2,terceiro:2,quarta:3,quarto:3,quinta:4,quinto:4} as Record<string,number>)[norm(ordinal[1])] ?? Number(ordinal[1])-1;
        targetId=(await recentGoalList(args.userId,args.phone))[index]??null;
        if (!targetId) return {resposta:"Essa referência não está mais disponível. Envie “minhas metas” e tente de novo."};
      }
      const matches = targetId ? [] : await findEntities(args.userId,intent.kind,intent.term);
      if (!targetId && !matches.length) return { resposta:`Não encontrei “${intent.term}”. Envie o nome exato como aparece no app.` };
      if (matches.length===1) targetId=matches[0].id;
      else candidates=matches.map(r=>r.id);
    }
    const {data,error}=await db.from("whatsapp_planning_actions").insert({user_id:args.userId,
      telefone:args.phone,source_external_id:args.externalId,kind:intent.kind,target_id:targetId,
      payload:{...intent.payload,...(candidates?{candidates}: {})}}).select("*").single();
    if (error && error.code!=="23505") return { resposta:"Não consegui iniciar esse pedido. Tente novamente." };
    const prior = error?.code==="23505" ? await db.from("whatsapp_planning_actions").select("*")
      .eq("user_id",args.userId).eq("source_external_id",args.externalId).maybeSingle() : null;
    const d=(data??prior?.data) as Draft | null;
    if (!d) return {resposta:"Não consegui continuar esse pedido agora."};
    if (d.state==="applied") return {resposta:"Esse pedido já foi confirmado anteriormente."};
    if (d.state==="cancelled") return {resposta:"Esse pedido já foi cancelado."};
    if (candidates) {
      const matches=await findEntities(args.userId,intent.kind,intent.term!);
      const body=`Encontrei mais de uma opção:\n${matches.map((r,i)=>`${i+1}. ${r.nome}`).join("\n")}\n\nEscolha uma:`;
      return {resposta:body,graphInteractive:toGraphInteractive({type:"list",body,buttonText:"Escolher",rows:matches.map((r,i)=>({id:`wa13_pick:${d.id}:${i+1}`,title:r.nome.slice(0,24)}))})};
    }
    const question=prompt(d);
    return question ? {resposta:question} : complete(d);
  }

  const d=await loadDraft(args.userId,args.phone);
  if(d && !intent) {
    const answer=norm(text);
    if(d.state==="ready" && /^(?:confirmar|confirmo)$/.test(answer))
      return handlePlanning({...args,text:`wa13_confirm:${d.id}`});
    if(d.state==="ready" && answer==="ajustar")
      return handlePlanning({...args,text:`wa13_adjust:${d.id}`});
    if(answer==="cancelar" || answer==="cancela este pedido")
      return handlePlanning({...args,text:`wa13_cancel:${d.id}`});
  }
  if (d && d.state==="draft" && !intent) {
    const p={...d.payload};
    if (Array.isArray(p.candidates) && !d.target_id) {
      const i=/^(?:a\s*)?(?:primeira|primeiro|1)$/.test(norm(text))?0:/^(?:a\s*)?(?:segunda|segundo|2)$/.test(norm(text))?1:/^(?:a\s*)?(?:terceira|terceiro|3)$/.test(norm(text))?2:Number(text)-1;
      const id=(p.candidates as string[])[i];
      if (!id) return {resposta:"Escolha o número da lista ou envie um nome completo."};
      p.candidates=null;
      return complete(await saveDraft(d,{target_id:id,payload:p}));
    }
    if (!d.target_id && d.kind!=="goal_create" && d.kind!=="recurrence_create") {
      const matches=await findEntities(args.userId,d.kind,text);
      if (!matches.length) return {resposta:"Não encontrei esse registro. Envie o nome exato como aparece no app."};
      if (matches.length===1) {
        const selected=await saveDraft(d,{target_id:matches[0].id});
        const question=prompt(selected);
        return question?{resposta:question}:complete(selected);
      }
      const selected=await saveDraft(d,{payload:{...p,candidates:matches.map(r=>r.id)}});
      const body=`Encontrei mais de uma opção:\n${matches.map((r,i)=>`${i+1}. ${r.nome}`).join("\n")}\n\nEscolha uma:`;
      return {resposta:body,graphInteractive:toGraphInteractive({type:"list",body,buttonText:"Escolher",rows:matches.map((r,i)=>({id:`wa13_pick:${selected.id}:${i+1}`,title:r.nome.slice(0,24)}))})};
    }
    if (!p.name && ["goal_create","recurrence_create"].includes(d.kind)) p.name=text.slice(0,80).trim();
    else if (!p.amount && ["goal_create","recurrence_create","goal_add","goal_withdraw"].includes(d.kind)) p.amount=parseMoney(text);
    else if (!p.value && ["goal_edit","recurrence_edit","card_edit"].includes(d.kind))
      p.value=d.kind==="card_edit"||p.field==="name"?text:p.field==="date"?parseDate(text):parseMoney(text);
    const updated=await saveDraft(d,{payload:p});
    const question=prompt(updated);
    return question?{resposta:question}:complete(updated);
  }
  return await goalSummary(args) ?? await recurrenceSummary(args.userId,text) ?? await cardLimitSummary(args.userId,text);
}
