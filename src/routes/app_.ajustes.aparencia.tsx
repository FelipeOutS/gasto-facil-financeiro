import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Palette, Moon, Sun, Monitor, Layout, Type, Check } from "lucide-react";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { useAccent, ACCENTS } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/app_/ajustes/aparencia")({
  head: () => ({ meta: [{ title: "Aparência — Gasto Inteligente" }] }),
  component: AparenciaPage,
});

function AparenciaPage() {
  const { t } = useTranslation("settings");
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();

  const themeOptions: { id: ThemeChoice; icon: typeof Sun; label: string }[] = [
    { id: "light", icon: Sun, label: t("appearance.themes.light") },
    { id: "dark", icon: Moon, label: t("appearance.themes.dark") },
    { id: "system", icon: Monitor, label: t("appearance.themes.system") },
  ];

  return (
    <>
      <SettingsPageHeader
        title={t("appearance.title")}
        description={t("appearance.description")}
      />

      <div className="space-y-8 mt-6">
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Palette className="h-4 w-4 text-brand" />
            {t("appearance.theme")}
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {themeOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={theme === opt.id}
                onClick={() => {
                  setTheme(opt.id);
                  toast.success(t("appearance.themeUpdated"));
                }}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-2xl border p-4 transition-all",
                  theme === opt.id
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border bg-card hover:bg-card-elevated",
                )}
              >
                <opt.icon className="h-6 w-6" />
                <span className="text-xs font-medium">{opt.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Palette className="h-4 w-4 text-brand" />
            {t("appearance.accent")}
          </h2>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                aria-label={a.label}
                aria-pressed={accent === a.id}
                title={a.label}
                onClick={() => {
                  setAccent(a.id);
                  toast.success(t("appearance.themeUpdated"));
                }}
                className={cn(
                  "grid aspect-square place-items-center rounded-2xl border transition-all",
                  accent === a.id ? "border-brand ring-2 ring-brand/40" : "border-border",
                )}
              >
                <span
                  className="grid h-7 w-7 place-items-center rounded-full"
                  style={{ backgroundColor: a.swatch }}
                >
                  {accent === a.id ? <Check className="h-4 w-4 text-black/70" /> : null}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="border-t border-border pt-6">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 px-1">
            {t("appearance.moreOptions")}
          </h2>
          <div className="grid gap-2">
            <div className="flex items-center justify-between rounded-xl border border-border bg-card/40 px-3 py-2.5 opacity-70">
              <div className="flex items-center gap-2.5 min-w-0">
                <Layout className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-medium">
                  {t("appearance.compactLayout")}
                </span>
              </div>
              <span className="ml-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
                {t("appearance.comingSoon")}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-card/40 px-3 py-2.5 opacity-70">
              <div className="flex items-center gap-2.5 min-w-0">
                <Type className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-medium">{t("appearance.fontSize")}</span>
              </div>
              <span className="ml-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
                {t("appearance.comingSoon")}
              </span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
