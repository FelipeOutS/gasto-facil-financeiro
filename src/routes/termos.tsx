import { createFileRoute } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { LegalLayout } from "@/components/landing/LegalLayout";

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
      <p>
        <Trans i18nKey="termos.intro" ns="legal" components={[<strong key="0" />]} />
      </p>

      <h2>{t("termos.s1.h")}</h2>
      <p>{t("termos.s1.p1")}</p>
      <p>
        <Trans i18nKey="termos.s1.p2" ns="legal" components={[<strong key="0" />]} />
      </p>

      <h2>{t("termos.s2.h")}</h2>
      <ul>
        <li>{t("termos.s2.i1")}</li>
        <li>{t("termos.s2.i2")}</li>
        <li>{t("termos.s2.i3")}</li>
      </ul>

      <h2>{t("termos.s3.h")}</h2>
      <p>{t("termos.s3.p")}</p>

      <h2>{t("termos.s4.h")}</h2>
      <p>{t("termos.s4.p")}</p>

      <h2>{t("termos.s5.h")}</h2>
      <p>{t("termos.s5.p")}</p>

      <h2>{t("termos.s6.h")}</h2>
      <p>{t("termos.s6.p")}</p>

      <h2>{t("termos.s7.h")}</h2>
      <p>
        <Trans
          i18nKey="termos.s7.p"
          ns="legal"
          components={[<a key="0" href="mailto:contato@gastointeligente.com.br" />]}
        />
      </p>
    </LegalLayout>
  );
}
