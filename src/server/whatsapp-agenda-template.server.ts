/** Separate from proactive activation. A name in notification_templates is
 * not evidence of Meta approval. Require the synchronized canonical catalog. */
export function agendaTemplateApproved(key:string,name:string|null,row: {
  internal_key?:string;meta_name?:string;language?:string;category?:string;
  version?:number;status?:string;active?:boolean;provider_template_id?:string|null;
  last_synced_at?:string|null;
}|null): boolean {
  const names:Record<string,string>={gi_agenda_lembrete:"gi_agenda_lembrete_v1",gi_agenda_financeiro:"gi_agenda_financeiro_v1"};
  return !!row && !!names[key] && name===names[key] && row.internal_key===key &&
    row.meta_name===name && row.language==="pt_BR" && row.category==="UTILITY" &&
    row.version===1 && row.status==="approved" && row.active===true &&
    !!row.provider_template_id && !!row.last_synced_at;
}
