import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";
import { PrivacidadeContent } from "@/components/legal/LegalContent";

export const Route = createFileRoute("/app_/ajustes/ajuda/privacidade")({
  head: () => ({ meta: [{ title: "Política de Privacidade — Gasto Inteligente" }] }),
  component: PrivacidadeInternoPage,
});

function PrivacidadeInternoPage() {
  const { t } = useTranslation("legal");
  return (
    <div data-testid="settings-help-privacy" className="contents">
      <SettingsPageHeader title={t("privacidade.title")} backTo="/app/ajustes/ajuda" />
      <div className="mt-6 rounded-3xl border border-border bg-card p-6">
        <p className="mb-4 text-xs text-muted-foreground">
          {t("updatedAtLabel", { defaultValue: "Última atualização" })}: {t("updatedAt")}
        </p>
        <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground prose-a:text-brand">
          <PrivacidadeContent />
        </div>
      </div>
    </div>
  );
}
