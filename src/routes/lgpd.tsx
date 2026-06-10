import { createFileRoute } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { LegalLayout } from "@/components/landing/LegalLayout";

export const Route = createFileRoute("/lgpd")({
  head: () => {
    const t = i18n.getFixedT(null, "legal");
    return {
      meta: [
        { title: t("lgpd.metaTitle") },
        { name: "description", content: t("lgpd.metaDesc") },
        { property: "og:title", content: t("lgpd.metaTitle") },
        { property: "og:description", content: t("lgpd.ogDesc") },
        { property: "og:url", content: "https://gastointeligente.com.br/lgpd" },
        { property: "og:image", content: "https://gastointeligente.com.br/og-gasto-inteligente.png" },
        { name: "twitter:image", content: "https://gastointeligente.com.br/og-gasto-inteligente.png" },
      ],
      links: [{ rel: "canonical", href: "https://gastointeligente.com.br/lgpd" }],
    };
  },
  component: LgpdPage,
});

function LgpdPage() {
  const { t } = useTranslation("legal");
  return (
    <LegalLayout title={t("lgpd.title")} updatedAt={t("updatedAt")}>
      <p>
        <Trans i18nKey="lgpd.intro" ns="legal" components={[<strong key="0" />]} />
      </p>

      <h2>{t("lgpd.s1.h")}</h2>
      <ul>
        <li><strong>{t("lgpd.s1.i1Strong")}</strong> {t("lgpd.s1.i1")}</li>
        <li><strong>{t("lgpd.s1.i2Strong")}</strong> {t("lgpd.s1.i2")}</li>
        <li><strong>{t("lgpd.s1.i3Strong")}</strong> {t("lgpd.s1.i3")}</li>
        <li><strong>{t("lgpd.s1.i4Strong")}</strong> {t("lgpd.s1.i4")}</li>
      </ul>

      <h2>{t("lgpd.s2.h")}</h2>
      <p>{t("lgpd.s2.p")}</p>
      <ul>
        <li>{t("lgpd.s2.i1")}</li>
        <li>{t("lgpd.s2.i2")}</li>
        <li>{t("lgpd.s2.i3")}</li>
        <li>{t("lgpd.s2.i4")}</li>
      </ul>

      <h2>{t("lgpd.s3.h")}</h2>
      <p>
        <Trans
          i18nKey="lgpd.s3.p"
          ns="legal"
          components={[<a key="0" href="mailto:contato@gastointeligente.com.br" />]}
        />
      </p>

      <h2>{t("lgpd.s4.h")}</h2>
      <p>{t("lgpd.s4.p")}</p>
    </LegalLayout>
  );
}
