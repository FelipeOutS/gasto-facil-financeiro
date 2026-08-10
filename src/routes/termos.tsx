import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { LegalLayout } from "@/components/landing/LegalLayout";
import { TermosContent } from "@/components/legal/LegalContent";

export const Route = createFileRoute("/termos")({
  head: () => {
    const t = i18n.getFixedT(null, "legal");
    return {
      meta: [
        { title: t("termos.metaTitle") },
        { name: "description", content: t("termos.metaDesc") },
        { property: "og:title", content: t("termos.metaTitle") },
        { property: "og:description", content: t("termos.ogDesc") },
        { property: "og:url", content: "https://gastointeligente.com.br/termos" },
        {
          property: "og:image",
          content: "https://gastointeligente.com.br/og-gasto-inteligente.png",
        },
        {
          name: "twitter:image",
          content: "https://gastointeligente.com.br/og-gasto-inteligente.png",
        },
      ],
      links: [{ rel: "canonical", href: "https://gastointeligente.com.br/termos" }],
    };
  },
  component: TermosPage,
});

function TermosPage() {
  const { t } = useTranslation("legal");
  return (
    <LegalLayout title={t("termos.title")} updatedAt={t("updatedAt")}>
      <TermosContent />
    </LegalLayout>
  );
}
