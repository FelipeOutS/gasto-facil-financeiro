import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { LegalLayout } from "@/components/landing/LegalLayout";
import { PrivacidadeContent } from "@/components/legal/LegalContent";

export const Route = createFileRoute("/privacidade")({
  head: () => {
    const t = i18n.getFixedT(null, "legal");
    return {
      meta: [
        { title: t("privacidade.metaTitle") },
        { name: "description", content: t("privacidade.metaDesc") },
        { property: "og:title", content: t("privacidade.metaTitle") },
        { property: "og:description", content: t("privacidade.ogDesc") },
        { property: "og:url", content: "https://gastointeligente.com.br/privacidade" },
        {
          property: "og:image",
          content: "https://gastointeligente.com.br/og-gasto-inteligente.png",
        },
        {
          name: "twitter:image",
          content: "https://gastointeligente.com.br/og-gasto-inteligente.png",
        },
      ],
      links: [{ rel: "canonical", href: "https://gastointeligente.com.br/privacidade" }],
    };
  },
  component: PrivacidadePage,
});

function PrivacidadePage() {
  const { t } = useTranslation("legal");
  return (
    <LegalLayout title={t("privacidade.title")} updatedAt={t("updatedAt")}>
      <PrivacidadeContent />
    </LegalLayout>
  );
}
