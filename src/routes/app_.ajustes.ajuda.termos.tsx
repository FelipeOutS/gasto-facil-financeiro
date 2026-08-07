import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MobileShell } from "@/components/MobileShell";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";
import { LegalLayout } from "@/components/landing/LegalLayout";

// Temporary wrapper until we refactor LegalLayout to be context-aware
function WrappedLegal({ ns, i18nKey }: { ns: string; i18nKey: string }) {
    const { t } = useTranslation(ns);
    // Reuse existing LegalLayout logic but make it internal
    return (
        <div className="p-6 space-y-4">
             <h2 className="text-xl font-bold">{t(`${i18nKey}.title`)}</h2>
             {/* Simple renderer for now */}
             <p>{t(`${i18nKey}.intro`)}</p>
        </div>
    )
}

export const Route = createFileRoute("/app_/ajustes/ajuda/termos")({
  component: TermosInternoPage,
});

function TermosInternoPage() {
  const { t } = useTranslation("legal");
  return (
    <MobileShell>
      <SettingsPageHeader title="Termos de Uso" backTo="/app/ajustes/ajuda" />
      <div className="p-6">
         <h2 className="text-xl font-bold mb-4">{t("termos.title")}</h2>
         <p className="text-xs text-muted-foreground mb-4">Última atualização: {t("updatedAt")}</p>
         <div className="space-y-4 text-sm text-muted-foreground">
             <p>{t("termos.intro")}</p>
             <h3 className="font-bold">{t("termos.s1.h")}</h3>
             <p>{t("termos.s1.p1")}</p>
         </div>
      </div>
    </MobileShell>
  );
}
