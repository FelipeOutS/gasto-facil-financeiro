import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Mail, MessageCircle } from "lucide-react";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";

export const Route = createFileRoute("/app_/ajustes/ajuda/suporte")({
  head: () => ({ meta: [{ title: "Suporte — Gasto Inteligente" }] }),
  component: SuportePage,
});

function SuportePage() {
  const { t } = useTranslation("settings");
  return (
    <div data-testid="settings-help-support" className="contents">
      <SettingsPageHeader
        title={t("help.support")}
        description="Fale com a nossa equipe pelos canais oficiais."
        backTo="/app/ajustes/ajuda"
      />
      <div className="mt-6 grid gap-2">
        <a
          href="mailto:contato@gastointeligente.com.br"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-card-elevated"
        >
          <Mail className="h-5 w-5 text-brand" />
          <div className="min-w-0">
            <p className="text-sm font-medium">E-mail oficial</p>
            <p className="truncate text-xs text-muted-foreground">
              contato@gastointeligente.com.br
            </p>
          </div>
        </a>
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
          <MessageCircle className="h-5 w-5 text-brand" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Suporte, privacidade e LGPD</p>
            <p className="text-xs text-muted-foreground">
              Use o mesmo e-mail oficial e descreva o assunto no título.
            </p>
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Respondemos em dias úteis. Nunca pedimos sua senha por e-mail.
      </p>
    </div>
  );
}
