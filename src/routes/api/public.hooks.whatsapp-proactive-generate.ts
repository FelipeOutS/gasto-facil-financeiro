/** WhatsApp 1.3 generator endpoint. No Meta send; disabled by default. */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { generateProactiveAlerts } from "@/server/whatsapp-proactive-alerts.server";
import {cronPreflight, readCronBody} from "@/server/whatsapp-cron-preflight.server";

function valid(raw:string,signature:string|null):boolean {
  const secret=process.env.WHATSAPP_DISPATCHER_SECRET;
  if(!secret||!signature) return false;
  const expected=createHmac("sha256",secret).update(raw).digest("hex");
  const a=Buffer.from(signature),b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
export const Route=createFileRoute("/api/public/hooks/whatsapp-proactive-generate")({
  server:{handlers:{POST:async({request})=>{
    const raw=await readCronBody(request);
    if(raw===null) return new Response("body too large",{status:413});
    if(!valid(raw,request.headers.get("x-cron-signature"))) return new Response("invalid signature",{status:401});
    // Operational activation is a separate step, after migration, templates,
    // dispatch mapping and full WhatsApp homologation. No cron is installed.
    if(process.env.WHATSAPP_13_ALERT_GENERATION_ENABLED?.toLowerCase()!=="true")
      return Response.json({enabled:false,users_considered:0,candidates:0,enqueued:0});
    const guard=await cronPreflight(raw,"whatsapp-proactive-generate");
    if(guard!=="ok") return new Response("cron request rejected",{status:guard==="unavailable"?503:409});
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
    const idsSet=new Set<string>();
    for(let offset=0;;offset+=500) {
      const {data,error}=await supabaseAdmin.from("whatsapp_links").select("id,user_id")
        .eq("ativo",true).not("opt_in_em","is",null).is("revogado_em",null)
        .order("id").range(offset,offset+499);
      if(error) return new Response("lookup unavailable",{status:503});
      for(const link of data??[]) idsSet.add(link.user_id);
      if((data??[]).length<500) break;
    }
    const ids=[...idsSet];
    const summary={enabled:true,users_considered:ids.length,candidates:0,enqueued:0,errors:0};
    for(const userId of ids) {
      try {
        const r=await generateProactiveAlerts(userId);
        summary.candidates+=r.candidates; summary.enqueued+=r.enqueued;
      } catch {summary.errors++;}
    }
    return Response.json(summary);
  }}}
});
