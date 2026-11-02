import { Children, isValidElement, useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DASHBOARD_BLOCKS,
  defaultDashboardLayout,
  dashboardLayoutKey,
  moveDashboardBlock,
  readDashboardLayout,
  saveDashboardLayout,
  type DashboardBlockId,
} from "@/lib/dashboard-layout";

export function DashboardBlock({ children }: { id: DashboardBlockId; children: ReactNode }) {
  return <>{children}</>;
}

// Mount with key=userId so account switches never reuse another user's draft or layout.
export function PersonalizedDashboard({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [layout, setLayout] = useState(defaultDashboardLayout);
  const [draft, setDraft] = useState(defaultDashboardLayout);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const load = () => {
      try {
        setLayout(readDashboardLayout(window.localStorage, userId));
      } catch {
        setLayout(defaultDashboardLayout());
      }
      setReady(true);
    };
    load();
    const sync = (e: StorageEvent) => {
      if (e.key === dashboardLayoutKey(userId) || e.key === null) load();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [userId]);
  const blocks = new Map(
    Children.toArray(children).flatMap((child) =>
      isValidElement<{ id: DashboardBlockId }>(child) ? [[child.props.id, child] as const] : [],
    ),
  );
  function changeOpen(next: boolean) {
    if (next) {
      setDraft(layout);
      setError("");
      setAnnouncement("");
    }
    setOpen(next);
  }
  function save() {
    try {
      saveDashboardLayout(window.localStorage, userId, draft);
      setLayout(draft);
      setOpen(false);
      setAnnouncement("Dashboard salvo neste aparelho.");
    } catch {
      setError(
        "Não foi possível salvar neste aparelho. Suas preferências anteriores foram mantidas.",
      );
    }
  }
  return (
    <>
      <div className="mt-4 flex justify-end">
        <Sheet open={open} onOpenChange={changeOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" disabled={!ready || !userId} className="min-h-11 gap-2">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Personalizar Dashboard
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="mx-auto max-w-2xl rounded-t-3xl">
            <SheetTitle className="pr-10">Seu Dashboard</SheetTitle>
            <SheetDescription className="mt-2">
              Escolha os blocos e a ordem. O resumo do mês e as ações rápidas permanecem no topo.
              Preferências salvas para sua conta apenas neste aparelho.
            </SheetDescription>
            <ul className="my-4 space-y-2">
              {draft.order.map((id, index) => {
                const label = DASHBOARD_BLOCKS.find((b) => b.id === id)!.label;
                return (
                  <li
                    key={id}
                    className="flex items-center gap-1 rounded-xl border border-border bg-card p-2"
                  >
                    <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 px-1 text-sm">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0"
                        style={{ accentColor: "var(--brand, #10b981)" }}
                        checked={!draft.hidden.includes(id)}
                        onChange={(e) =>
                          setDraft((current) => ({
                            ...current,
                            hidden: e.target.checked
                              ? current.hidden.filter((v) => v !== id)
                              : [...current.hidden, id],
                          }))
                        }
                      />
                      {label}
                    </label>
                    {([-1, 1] as const).map((direction) => (
                      <Button
                        key={direction}
                        variant="ghost"
                        className="h-11 w-11 shrink-0 p-0"
                        aria-label={`${direction === -1 ? "Subir" : "Descer"} ${label}`}
                        disabled={direction === -1 ? index === 0 : index === draft.order.length - 1}
                        onClick={() => {
                          setDraft((current) => moveDashboardBlock(current, id, direction));
                          setAnnouncement(
                            `${label}: posição ${index + direction + 1} de ${draft.order.length}.`,
                          );
                        }}
                      >
                        {direction === -1 ? (
                          <ArrowUp className="h-4 w-4" />
                        ) : (
                          <ArrowDown className="h-4 w-4" />
                        )}
                      </Button>
                    ))}
                  </li>
                );
              })}
            </ul>
            <p role="status" className="sr-only">
              {announcement}
            </p>
            {error && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                className="min-h-11 mr-auto"
                onClick={() => {
                  setDraft(defaultDashboardLayout());
                  setAnnouncement("Layout padrão selecionado. Salve para aplicar.");
                }}
              >
                Restaurar padrão
              </Button>
              <Button variant="outline" className="min-h-11" onClick={() => changeOpen(false)}>
                Cancelar
              </Button>
              <Button className="min-h-11" onClick={save}>
                Salvar
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
      {!open && (
        <p role="status" className="sr-only">
          {announcement}
        </p>
      )}
      <div className="dashboard-block-grid">
        {layout.order
          .filter((id) => !layout.hidden.includes(id))
          .map((id) => (
            <div key={id} data-dashboard-block={id}>
              {blocks.get(id)}
            </div>
          ))}
      </div>
      {layout.hidden.length === DASHBOARD_BLOCKS.length && (
        <p className="mt-6 rounded-2xl border border-border p-4 text-sm text-muted-foreground">
          Os blocos adicionais estão ocultos. Use Personalizar Dashboard para exibi-los novamente.
        </p>
      )}
    </>
  );
}
