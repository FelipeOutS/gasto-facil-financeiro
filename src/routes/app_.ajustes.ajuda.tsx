import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink, Shield, FileText, Info } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";

export const Route = createFileRoute("/app_/ajustes/ajuda")({
  head: () => ({ meta: [{ title: "Ajuda e informações — Gasto Inteligente" }] }),
  component: AjudaPage,
});

function AjudaPage() {
  const { t } = useTranslation("settings");
  
  const version = "v2.6.0-beta";

  const links = [
    { label: t("help.support"), icon: Info, href: "mailto:suporte@gastointeligente.com.br" },
    { label: t("help.terms"), icon: FileText, href: "/termos" },
    { label: t("help.privacyPolicy"), icon: Shield, href: "/privacidade" },
  ];

  return (
    <MobileShell>
      <SettingsPageHeader 
        title={t("help.title")} 
        description={t("sections.help.description")} 
      />

      <div className="space-y-4 mt-6">
        <div className="grid gap-2">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target={link.href.startsWith("http") || link.href.includes("@") ? "_blank" : undefined}
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 rounded-2xl border border-border bg-card hover:bg-card-elevated transition-colors"
            >
              <div className="flex items-center gap-3">
                <link.icon className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-medium">{link.label}</span>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground/50" />
            </a>
          ))}
        </div>

        <div className="p-6 rounded-3xl border border-border bg-card-elevated/50 text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold mb-1">
            {t("help.version")}
          </p>
          <p className="text-sm font-mono text-foreground/80">{version}</p>
        </div>
      </div>
    </MobileShell>
  );
}
