import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";
import { TermosContent } from "@/components/legal/LegalContent";

export const Route = createFileRoute("/app_/ajustes/ajuda/termos")({
  head: () => ({ meta: [{ title: "Termos de Uso — Gasto Inteligente" }] }),
  component: TermosInternoPage,
});

function TermosInternoPage() {
  const { t } = useTranslation("legal");
  return (
    <>
      <SettingsPageHeader title={t("termos.title")} backTo="/app/ajustes/ajuda" />
      <div className="mt-6 rounded-3xl border border-border bg-card p-6">
        <p className="mb-4 text-xs text-muted-foreground">
          {t("updatedAtLabel", { defaultValue: "Última atualização" })}: {t("updatedAt")}
        </p>
        <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground prose-a:text-brand">
          <TermosContent />
        </div>
      </div>
    </>
  );
}
