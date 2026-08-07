import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MobileShell } from "@/components/MobileShell";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";
import { ArrowLeft, ShieldCheck, FileText, Info } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/app_/ajustes/ajuda/suporte")({
  component: SuportePage,
});

function SuportePage() {
  const { t } = useTranslation("settings");
  return (
    <MobileShell>
      <SettingsPageHeader title={t("help.support")} backTo="/app/ajustes/ajuda" />
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
            Entre em contato conosco através dos nossos canais oficiais de suporte:
        </p>
        <a href="mailto:suporte@gastointeligente.com.br" className="flex items-center gap-3 p-4 rounded-2xl border border-border bg-card hover:bg-card-elevated">
          <Info className="h-5 w-5 text-brand" />
          <span className="text-sm font-medium">suporte@gastointeligente.com.br</span>
        </a>
      </div>
    </MobileShell>
  );
}
