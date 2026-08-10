import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Shield, FileText, Info, ChevronRight } from "lucide-react";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";
import { APP_VERSION } from "@/lib/app-version";

export const Route = createFileRoute("/app_/ajustes/ajuda")({
  head: () => ({ meta: [{ title: "Ajuda e informações — Gasto Inteligente" }] }),
  component: AjudaPage,
});

function AjudaPage() {
  const { t } = useTranslation("settings");

  const version = APP_VERSION;

  const links = [
    { label: t("help.support"), icon: Info, to: "/app/ajustes/ajuda/suporte" },
    { label: t("help.terms"), icon: FileText, to: "/app/ajustes/ajuda/termos" },
    { label: t("help.privacyPolicy"), icon: Shield, to: "/app/ajustes/ajuda/privacidade" },
  ];

  return (
    <>
      <SettingsPageHeader 
        title={t("help.title")} 
        description={t("sections.help.description")} 
      />

      <div className="space-y-4 mt-6">
        <div className="grid gap-2">
          {links.map((link) => (
            <Link
              key={link.label}
              to={link.to as any}
              className="flex items-center justify-between p-4 rounded-2xl border border-border bg-card hover:bg-card-elevated transition-colors"
            >
              <div className="flex items-center gap-3">
                <link.icon className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-medium">{link.label}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
            </Link>
          ))}
        </div>

        <div className="p-6 rounded-3xl border border-border bg-card-elevated/50 text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold mb-1">
            {t("help.version")}
          </p>
          <p className="text-sm font-mono text-foreground/80">{version}</p>
        </div>
      </div>
    </>
  );
}
