import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { 
  Palette, 
  Moon, 
  Sun, 
  Monitor,
  Layout,
  Type
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";
import { useStore, setTheme } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/app_/ajustes/aparencia")({
  head: () => ({ meta: [{ title: "Aparência — Gasto Inteligente" }] }),
  component: AparenciaPage,
});

function AparenciaPage() {
  const { t } = useTranslation("settings");
  // @ts-ignore - useStore in this project expects a selector with no arguments
  const theme = useStore(() => {
    if (typeof window === "undefined") return "system";
    return localStorage.getItem("gi-theme") || "system";
  });

  const themeOptions = [
    { id: "light", icon: Sun, label: t("appearance.themes.light") || "Claro" },
    { id: "dark", icon: Moon, label: t("appearance.themes.dark") || "Escuro" },
    { id: "system", icon: Monitor, label: t("appearance.themes.system") || "Sistema" },
  ];

  return (
    <>
      <SettingsPageHeader 
        title={t("appearance.title")} 
        description={t("appearance.description") || "Personalize como o Gasto Inteligente aparece para você."} 
      />

      <div className="space-y-6 mt-6">
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Palette className="h-4 w-4 text-brand" />
            Tema do Aplicativo
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {themeOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  setTheme(opt.id as any);
                  toast.success(t("appearance.themeUpdated"));
                }}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-2xl border p-4 transition-all",
                  theme === opt.id 
                    ? "border-brand bg-brand/10 text-brand" 
                    : "border-border bg-card hover:bg-card-elevated"
                )}
              >
                <opt.icon className="h-6 w-6" />
                <span className="text-xs font-medium">{opt.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-8 border-t border-border pt-6">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4 px-1">
            Mais opções
          </h2>
          <div className="grid gap-3">
            <div className="flex items-center justify-between p-4 rounded-2xl border border-border bg-card/50 opacity-70">
              <div className="flex items-center gap-3">
                <Layout className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h3 className="text-sm font-semibold">Layout Compacto</h3>
                  <p className="text-xs text-muted-foreground">Exiba mais informações na tela</p>
                </div>
              </div>
              <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full font-bold uppercase text-muted-foreground tracking-tight">Em breve</span>
            </div>

            <div className="flex items-center justify-between p-4 rounded-2xl border border-border bg-card/50 opacity-70">
              <div className="flex items-center gap-3">
                <Type className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h3 className="text-sm font-semibold">Tamanho da Fonte</h3>
                  <p className="text-xs text-muted-foreground">Ajuste a legibilidade dos textos</p>
                </div>
              </div>
              <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full font-bold uppercase text-muted-foreground tracking-tight">Em breve</span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
