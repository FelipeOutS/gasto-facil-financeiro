/** WhatsApp 1.3 candidate generation. Does not send to Meta. */
import { supabaseAdmin as _admin } from "@/integrations/supabase/client.server";
import { calcMetaProgresso } from "@/lib/metas-progresso";
import { getFaturaPorMes, loadCartoesDoUsuario } from "./cartao-fatura.server";
import { canCreateNotificationForUser } from "./whatsapp-c11-gates.server";
import { getPreferences, getUserTimezone, isChannelOptedIn } from "./whatsapp-notification-gates.server";
import { enqueueNotification, type NotificationCategory } from "./whatsapp-notifications.server";
import { resolveAllowedMapping } from "./whatsapp-meta-template-mapping.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = _admin as any;
type Candidate = { type:string; category:NotificationCategory; dedupeKey:string;
  entityType?:string; entityId?:string; payload:Record<string,unknown> };
const dayIn=(d:Date,tz:string)=>new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
function nextSafeHour(now:Date,tz:string):Date {
  const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone:tz,hour:"2-digit",hour12:false}).format(now))%24;
  if (hour>=9 && hour<19) return now;
  let at=new Date(now.getTime()+60*60_000);
  for(let i=0;i<30;i++,at=new Date(at.getTime()+60*60_000)) {
    const h=Number(new Intl.DateTimeFormat("en-US",{timeZone:tz,hour:"2-digit",hour12:false}).format(at))%24;
    if(h===9) return at;
  }
  return new Date(now.getTime()+24*60*60_000);
}
const plusDays=(iso:string,n:number)=>new Date(Date.parse(`${iso}T12:00:00Z`)+n*86400_000).toISOString().slice(0,10);
function sums(rows:Array<{valor:number|string|null}>):number {return rows.reduce((s,r)=>s+(Number(r.valor)||0),0);}
async function pagedEntries(userId:string,table:"gastos"|"receitas",start:string,end:string){
  const all:Array<{valor:number|string|null;categoria_id?:string|null}>=[];
  for(let offset=0;;offset+=500){
    let q=db.from(table).select(table==="gastos"?"id,valor,categoria_id,confirmado":"id,valor")
      .eq("user_id",userId).gte("data",start).lt("data",end).order("id")
      .range(offset,offset+499);
    if(table==="receitas") q=q.is("deleted_at",null);
    const {data,error}=await q;
    if(error) throw error;
    const page=(data??[]) as Array<{valor:number|string|null;categoria_id?:string|null;confirmado?:boolean|null}>;
    all.push(...page.filter(r=>table==="receitas"||r.confirmado!==false));
    if(page.length<500) break;
  }
  return all;
}
async function summaryPayload(userId:string,start:string,end:string){
  const [expenses,incomes]=await Promise.all([
    pagedEntries(userId,"gastos",start,end),pagedEntries(userId,"receitas",start,end),
  ]);
  const expense=sums(expenses),income=sums(incomes);
  const totals=new Map<string,number>();
  for(const g of expenses) if(g.categoria_id) totals.set(g.categoria_id,
    (totals.get(g.categoria_id)??0)+(Number(g.valor)||0));
  const top=[...totals].sort((a,b)=>b[1]-a[1])[0];
  return {period:start,end,gastos_centavos:Math.round(expense*100),
    receitas_centavos:Math.round(income*100),resultado_centavos:Math.round((income-expense)*100),
    maior_categoria_id:top?.[0]??null};
}

/** Pure threshold choice: crossing 100% emits 100, not three alerts at once. */
export function crossedBudgetThreshold(used:number,limit:number):80|90|100|null {
  if(!Number.isFinite(used)||!Number.isFinite(limit)||limit<=0) return null;
  const pct=used/limit*100;
  return pct>=100?100:pct>=90?90:pct>=80?80:null;
}

export async function collectProactiveCandidates(userId:string,now=new Date()):Promise<Candidate[]> {
  const tz=await getUserTimezone(userId);
  const today=dayIn(now,tz);
  const prefs=await getPreferences(userId);
  const out:Candidate[]=[];

  if(prefs.orcamento===true) {
    const [y,m]=today.split("-").map(Number);
    const [lr,gastos,cr]=await Promise.all([
      db.from("limites").select("id,tipo,valor").eq("user_id",userId).eq("ano",y).eq("mes",m),
      pagedEntries(userId,"gastos",`${today.slice(0,7)}-01`,plusDays(today,1)),
      db.from("categorias").select("id,nome").eq("user_id",userId),
    ]);
    if(!lr.error&&!cr.error) {
      const categories=new Map<string,string>((cr.data??[]).map((c:{id:string;nome:string})=>[c.id,c.nome.toLowerCase()]));
      for(const l of lr.data??[]) {
        const key=String(l.tipo).toLowerCase();
        if(!key||key==="meta_gasto_mensal") continue;
        const relevant=key==="total"?gastos:gastos.filter(g=>categories.get(g.categoria_id??"")===key);
        const threshold=crossedBudgetThreshold(sums(relevant),Number(l.valor));
        if(threshold) out.push({type:"gi_orcamento_limiar",category:"orcamento",
          dedupeKey:`wa13:budget:${l.id}:${today.slice(0,7)}:${threshold}`,
          entityType:"limite",entityId:l.id,payload:{limit_id:l.id,month:today.slice(0,7),threshold,
            used_centavos:Math.round(sums(relevant)*100),limit_centavos:Math.round(Number(l.valor)*100)}});
      }
    }
  }

  if(prefs.faturas===true) {
    const inThree=plusDays(today,3);
    for(const card of await loadCartoesDoUsuario(userId)) {
      const [y,m]=inThree.split("-").map(Number);
      const invoiceMonths=[`${y}-${String(m).padStart(2,"0")}`,
        new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7)];
      for(const ym of invoiceMonths) {
        const invoice=await getFaturaPorMes(userId,card,ym);
        if(!invoice||invoice.total<=0||!invoice.vencimento) continue;
        const due=invoice.vencimento.toISOString().slice(0,10);
        if(due!==inThree) continue;
        const {data:paid}=await db.from("faturas_cartao").select("status")
          .eq("user_id",userId).eq("cartao_id",card.id).eq("ano",invoice.anoRef).eq("mes",invoice.mesRef).maybeSingle();
        if(paid?.status==="paga") continue;
        out.push({type:"gi_fatura_proxima",category:"faturas",
          dedupeKey:`wa13:invoice:${card.id}:${invoice.competencia}:3`,entityType:"cartao",entityId:card.id,
          payload:{card_id:card.id,due_date:due,competence:invoice.competencia,
            registered_total_centavos:Math.round(invoice.total*100)}});
        break;
      }
    }
  }

  if(prefs.renovacao_assinatura===true) {
    const tomorrow=plusDays(today,1);
    const {data,error}=await db.from("recorrencias").select("id,proxima_cobranca,valor,moeda")
      .eq("user_id",userId).eq("status","ativa").eq("proxima_cobranca",tomorrow);
    if(!error) for(const r of data??[]) out.push({type:"gi_assinatura_renovacao",category:"renovacao_assinatura",
      dedupeKey:`wa13:renewal:${r.id}:${tomorrow}`,entityType:"recorrencia",entityId:r.id,
      payload:{recurrence_id:r.id,due_date:tomorrow,amount_centavos:Math.round(Number(r.valor)*100),currency:r.moeda}});
  }

  if(prefs.metas===true) {
    const since=new Date(now.getTime()-48*3600_000).toISOString();
    const [mr,gr,vr]=await Promise.all([
      db.from("metas_financeiras").select("id,valor_atual,valor_objetivo,updated_at").eq("user_id",userId).gte("updated_at",since),
      db.from("dinheiro_guardado").select("meta_id,valor").eq("user_id",userId),
      db.from("movimentacoes_meta").select("meta_id,valor").eq("user_id",userId),
    ]);
    if(!mr.error&&!gr.error&&!vr.error) for(const m of mr.data??[]) {
      const p=calcMetaProgresso({valorAtual:m.valor_atual,valorObjetivo:m.valor_objetivo,
        guardados:(gr.data??[]).filter((g:{meta_id:string})=>g.meta_id===m.id),
        movimentacoes:(vr.data??[]).filter((v:{meta_id:string})=>v.meta_id===m.id)});
      if(p.objetivo>0 && p.total>=p.objetivo) out.push({type:"gi_meta_atingida",category:"metas",
        dedupeKey:`wa13:goal:${m.id}:${p.objetivo}:reached`,entityType:"meta",entityId:m.id,
        payload:{goal_id:m.id,target:p.objetivo,progress_centavos:Math.round(p.total*100)}});
    }
  }

  const weekday=new Date(`${today}T12:00:00Z`).getUTCDay();
  if(prefs.resumo_semanal===true && weekday===1) {
    const end=today,start=plusDays(today,-7);
    out.push({type:"gi_resumo_semanal",category:"resumo_semanal",dedupeKey:`wa13:weekly:${start}`,
      payload:await summaryPayload(userId,start,end)});
  }
  if(prefs.resumo_mensal===true && today.endsWith("-01")) {
    const end=today,start=new Date(Date.parse(`${today}T12:00:00Z`)-86400_000).toISOString().slice(0,7)+"-01";
    out.push({type:"gi_resumo_mensal",category:"resumo_mensal",dedupeKey:`wa13:monthly:${start}`,
      payload:await summaryPayload(userId,start,end)});
  }
  return out;
}

/** Existing runtime/entitlement/quota + explicit pref + Meta mapping gates.
 * Until approved templates are mapped, candidates remain local and no queue
 * rows are created. The queue's unique key handles retries and concurrency.
 */
export async function generateProactiveAlerts(userId:string,now=new Date()):Promise<{candidates:number;enqueued:number}> {
  if(!(await isChannelOptedIn(userId)).ok) return {candidates:0,enqueued:0};
  const gate=await canCreateNotificationForUser({userId});
  if(!gate.allowed) return {candidates:0,enqueued:0};
  const candidates=await collectProactiveCandidates(userId,now);
  if(!candidates.length) return {candidates:0,enqueued:0};
  const tz=await getUserTimezone(userId);
  const scheduledAt=nextSafeHour(now,tz);
  let enqueued=0;
  for(const c of candidates) {
    if(!resolveAllowedMapping(c.type).ok) continue;
    const {data:tpl,error}=await db.from("whatsapp_notification_templates")
      .select("active,meta_template_name").eq("key",c.type).maybeSingle();
    if(error||!tpl?.active||!tpl.meta_template_name) continue;
    const n=await enqueueNotification({userId,type:c.type,category:c.category,scheduledAt,
      dedupeKey:c.dedupeKey,entityType:c.entityType,entityId:c.entityId,payload:c.payload});
    if(n) enqueued++;
  }
  return {candidates:candidates.length,enqueued};
}
