import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, Sun, Moon, Monitor } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { useAccent, ACCENTS } from "@/lib/accent";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app_/ajustes/aparencia")({
  head: () => ({ meta: [{ title: "Aparência — Gasto Inteligente" }] }),
  component: AparenciaPage,
});

function AparenciaPage() {
  const { t } = useTranslation(["settings", "categorias"]);
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2 mb-6">
        <Link
          to="/app/ajustes"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("appearance.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("sections.appearance.description")}</p>
        </div>
      </header>

      <div className="space-y-8">
        {/* Tema */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">{t("appearance.theme")}</h2>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: "light", icon: Sun, label: "light" },
                { id: "dark", icon: Moon, label: "dark" },
                { id: "system", icon: Monitor, label: "system" },
              ] as const
            ).map(({ id, icon: Icon, label }) => {
              const active = theme === id;
              return (
                <button
                  key={id}
                  onClick={() => setTheme(id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 rounded-2xl border p-4 transition-all",
                    active
                      ? "border-brand bg-brand-soft text-brand-on-soft shadow-card"
                      : "border-border bg-card text-muted-foreground hover:bg-card-elevated"
                  )}
                >
                  <Icon className={cn("h-5 w-5", active && "text-brand")} />
                  <span className="text-xs font-medium">{t(`categorias:appearance.themes.${label}`)}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Cor de Destaque */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">{t("appearance.accent")}</h2>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {ACCENTS.map((a) => {
              const active = accent === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setAccent(a.id)}
                  className={cn(
                    "group relative flex flex-col items-center gap-2 rounded-2xl border p-2 transition-all",
                    active
                      ? "border-brand bg-brand-soft shadow-card"
                      : "border-border bg-card hover:bg-card-elevated"
                  )}
                >
                  <span
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-full ring-2 ring-offset-2 ring-offset-card transition-all",
                      active ? "ring-foreground/70 scale-105" : "ring-transparent"
                    )}
                    style={{ background: a.swatch }}
                  >
                    {active && <Check className="h-4 w-4" style={{ color: "#fff" }} strokeWidth={3} />}
                  </span>
                  <span className={cn("text-[10px] font-medium", active ? "text-brand-on-soft" : "text-muted-foreground")}>
                    {a.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </MobileShell>
  );
}
