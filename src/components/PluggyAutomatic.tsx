import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { pluggyAutomatic } from "@/lib/pluggy/automatic.functions";
export function PluggyAutomatic() {
  const call = useServerFn(pluggyAutomatic);
  const [s, setS] = useState<Awaited<ReturnType<typeof pluggyAutomatic>> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; call({ data: { action: "status" } }).then(r => { if (live) setS(r); }).catch(() => {}); return () => { live = false; }; }, [call]);
  async function change(enabled: boolean) {
    if (enabled && !confirm("Autorizar importação automática somente dos lotes previamente aprovados? Movimentações ambíguas continuarão em revisão. Esta opção não autoriza novos lotes.")) return;
    setBusy(true);
    try { setS(await call({ data: { action: "set", enabled, confirmed: true } })); toast.success(enabled ? "Preferência salva. Somente lotes autorizados serão processados." : "Importação automática desativada."); }
    catch { toast.error("Não foi possível confirmar a preferência. Atualize a página para conferir o estado."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-1">
    <div className="flex items-center justify-between gap-4"><span>Importar automaticamente lotes autorizados</span><Switch aria-label="Importar automaticamente lotes autorizados" checked={s?.enabled ?? false} disabled={busy || !s?.schemaReady || (!s.released && !s.enabled)} onCheckedChange={change} /></div>
    <p className="text-xs text-muted-foreground">{!s ? "Consulta da preferência indisponível." : !s.released ? "Ativação bloqueada até a liberação desta etapa." : "Desligado: você confirma cada lote. Ligado: apenas lotes já autorizados, após sincronização."}</p>
  </div>;
}
