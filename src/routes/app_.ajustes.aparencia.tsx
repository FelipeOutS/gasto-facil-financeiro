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
    { id: "light", icon: Sun, label: t("appearance.themes.light") },
    { id: "dark", icon: Moon, label: t("appearance.themes.dark") },
    { id: "system", icon: Monitor, label: t("appearance.themes.system") },
  ];

  return (
    <MobileShell data-testid="settings-appearance-page">
      <SettingsPageHeader 
        title={t("appearance.title")} 
        description={t("appearance.description")} 
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

        <section className="rounded-3xl border border-border bg-card p-6 opacity-50 cursor-not-allowed">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-muted text-muted-foreground">
              <Layout className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Layout Compacto</h3>
              <p className="text-xs text-muted-foreground">Exibir mais itens na tela</p>
            </div>
          </div>
          <p className="text-[10px] text-brand font-bold uppercase tracking-widest mt-4">Em breve na versão Beta</p>
        </section>

        <section className="rounded-3xl border border-border bg-card p-6 opacity-50 cursor-not-allowed">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-muted text-muted-foreground">
              <Type className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Tamanho da Fonte</h3>
              <p className="text-xs text-muted-foreground">Ajustar legibilidade dos textos</p>
            </div>
          </div>
          <p className="text-[10px] text-brand font-bold uppercase tracking-widest mt-4">Em breve na versão Beta</p>
        </section>
      </div>
    </MobileShell>
  );
}
