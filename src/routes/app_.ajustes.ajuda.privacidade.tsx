import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MobileShell } from "@/components/MobileShell";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";

export const Route = createFileRoute("/app_/ajustes/ajuda/privacidade")({
  component: PrivacidadeInternoPage,
});

function PrivacidadeInternoPage() {
  const { t } = useTranslation("legal");
  return (
    <MobileShell>
      <SettingsPageHeader title="Política de Privacidade" backTo="/app/ajustes/ajuda" />
      <div className="p-6">
         <h2 className="text-xl font-bold mb-4">{t("privacidade.title")}</h2>
         <p className="text-xs text-muted-foreground mb-4">Última atualização: {t("updatedAt")}</p>
         <div className="space-y-4 text-sm text-muted-foreground">
             <p>{t("privacidade.intro")}</p>
         </div>
      </div>
    </MobileShell>
  );
}
