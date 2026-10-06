/** WhatsApp 1.3: category opt-in is distinct from global PARAR. */
import { supabaseAdmin as _admin } from "@/integrations/supabase/client.server";
import { isChannelOptedIn } from "./whatsapp-notification-gates.server";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = _admin as any;
const norm = (s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const names = {
  orcamento:"orçamento", faturas:"fatura", contas_a_pagar:"contas",
  renovacao_assinatura:"renovação de assinatura", metas:"metas",
  resumo_semanal:"resumo semanal", resumo_mensal:"resumo mensal",
} as const;
type Key = keyof typeof names;
const keys=Object.keys(names) as Key[];
const defaults:Record<Key,boolean>={orcamento:false,faturas:false,contas_a_pagar:true,
  renovacao_assinatura:false,metas:false,resumo_semanal:false,resumo_mensal:false};
export type AlertPreferenceCommand={kind:"list"}|{kind:"set";key:Key;enabled:boolean};

export function parseAlertPreference(text:string):AlertPreferenceCommand|null {
  const t=norm(text);
  if (/^(?:meus alertas|minhas notificacoes|quais notificacoes estao ativas)$/.test(t)) return {kind:"list"};
  const enable=/\b(?:ativa|ativar|me avisa|quero aviso|manda um resumo)\b/.test(t);
  const disable=/\b(?:desativa|desativar|nao quero mais|para de mandar|pare de mandar)\b/.test(t);
  if (!enable && !disable) return null;
  let key:Key|null=null;
  if (/\borcamento\b/.test(t)) key="orcamento";
  else if (/\bfatura\b/.test(t)) key="faturas";
  else if (/\bassinatura|renovacao\b/.test(t)) key="renovacao_assinatura";
  else if (/\bmeta|metas\b/.test(t)) key="metas";
  else if (/\bresumo semanal|toda semana\b/.test(t)) key="resumo_semanal";
  else if (/\bresumo mensal|todo mes\b/.test(t)) key="resumo_mensal";
  else if (/\bcontas?\b/.test(t)) key="contas_a_pagar";
  if (!key) return null;
  return {kind:"set",key,enabled:!disable};
}

export async function handleAlertPreference(userId:string,text:string):Promise<{resposta:string}|null> {
  const cmd=parseAlertPreference(text);
  if (!cmd) return null;
  const {data,error}=await db.from("whatsapp_notification_preferences").select("*")
    .eq("user_id",userId).maybeSingle();
  if (error) return {resposta:"Não consegui consultar seus alertas agora. Tente novamente."};
  const p=(data??{}) as Partial<Record<Key,boolean>>;
  if (cmd.kind==="list") return {resposta:`🔔 Alertas do WhatsApp\n${keys.map(k=>`• ${names[k]}: ${(p[k]??defaults[k])?"ativo":"desligado"}`).join("\n")}\n\n“PARAR” desliga todo o canal; “desativa alerta de fatura” desliga só essa categoria.`};
  if (cmd.enabled && !(await isChannelOptedIn(userId)).ok) return {resposta:"Para receber alertas, ative o vínculo do WhatsApp no app primeiro."};
  const {error:writeError}=await db.from("whatsapp_notification_preferences")
    .upsert({user_id:userId,[cmd.key]:cmd.enabled},{onConflict:"user_id"});
  if (writeError) return {resposta:"Não consegui salvar a preferência agora. Nada foi alterado."};
  if (!cmd.enabled) {
    const {error:cancelError}=await db.from("whatsapp_notifications")
      .update({status:"cancelled",cancelled_at:new Date().toISOString()})
      .eq("user_id",userId).eq("category",cmd.key).eq("status","pending");
    if(cancelError) return {resposta:`🔔 Alerta de ${names[cmd.key]} desativado. Não consegui limpar os avisos pendentes agora; o bloqueio por categoria será conferido antes de qualquer envio.`};
  }
  return {resposta:`🔔 Alerta de ${names[cmd.key]} ${cmd.enabled?"ativado":"desativado"}. ${cmd.enabled?"O envio depende de horário adequado e de um modelo de mensagem aprovado.":"Os avisos pendentes dessa categoria foram cancelados."}`};
}
