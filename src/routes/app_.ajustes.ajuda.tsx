import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ExternalLink, Shield, FileText, Info } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { getBuildId } from "@/lib/build-id.server";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/app_/ajustes/ajuda")({
  head: () => ({ meta: [{ title: "Ajuda e informações — Gasto Inteligente" }] }),
  component: AjudaPage,
});

function AjudaPage() {
  const { t } = useTranslation("settings");
  
  // Mock version for now as we are in preview
  const version = "v2.6.0-beta";

  const links = [
    { label: t("help.support"), icon: Info, href: "mailto:suporte@gastointeligente.com.br" },
    { label: t("help.terms"), icon: FileText, href: "/termos" },
    { label: t("help.privacyPolicy"), icon: Shield, href: "/privacidade" },
  ];

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
          <h1 className="text-2xl font-bold tracking-tight">{t("help.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("sections.help.description")}</p>
        </div>
      </header>

      <div className="space-y-4">
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
