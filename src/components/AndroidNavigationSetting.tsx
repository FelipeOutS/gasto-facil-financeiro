import { useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type {} from "@/lib/system-surface";

export function AndroidNavigationSetting() {
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const bridge = window.AndroidSystemUi;
    if (!bridge?.getNavigationHidden || !bridge.setNavigationHidden) return;
    try { setHidden(bridge.getNavigationHidden()); } catch { return; }
    const confirmed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (typeof detail?.hidden !== "boolean" || typeof detail?.saved !== "boolean") return;
      clearTimeout(timer.current);
      setHidden(detail.hidden);
      setBusy(false);
      if (!detail.saved) toast.error("Não foi possível salvar esta preferência.");
    };
    window.addEventListener("android-navigation-preference", confirmed);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("android-navigation-preference", confirmed);
    };
  }, []);
  if (hidden === null) return null;
  return (
    <section className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
      <div>
        <label htmlFor="hide-android-navigation" className="text-sm font-medium">Ocultar navegação do sistema</label>
        <p id="android-navigation-help" className="mt-1 text-xs text-muted-foreground">
          Deslize da borda inferior para cima para mostrar os botões temporariamente. Esta opção vale somente neste aparelho.
        </p>
      </div>
      <Switch id="hide-android-navigation" aria-describedby="android-navigation-help" checked={hidden} disabled={busy}
        onCheckedChange={(next) => {
          setBusy(true);
          timer.current = setTimeout(() => {
            setBusy(false);
            try { setHidden(window.AndroidSystemUi!.getNavigationHidden!()); } catch { /* Keep last confirmed state. */ }
            toast.error("Não foi possível confirmar a alteração. Tente novamente.");
          }, 4000);
          try { window.AndroidSystemUi!.setNavigationHidden!(next); }
          catch {
            clearTimeout(timer.current);
            setBusy(false);
            toast.error("Não foi possível alterar esta preferência.");
          }
        }} />
    </section>
  );
}
