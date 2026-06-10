import { createFileRoute } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { LegalLayout } from "@/components/landing/LegalLayout";

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
        { property: "og:image", content: "https://gastointeligente.com.br/og-gasto-inteligente.png" },
        { name: "twitter:image", content: "https://gastointeligente.com.br/og-gasto-inteligente.png" },
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
      <p>
        <Trans i18nKey="privacidade.intro" ns="legal" components={[<strong key="0" />]} />
      </p>

      <h2>{t("privacidade.s1.h")}</h2>
      <ul>
        <li><strong>{t("privacidade.s1.i1Strong")}</strong> {t("privacidade.s1.i1")}</li>
        <li><strong>{t("privacidade.s1.i2Strong")}</strong> {t("privacidade.s1.i2")}</li>
        <li><strong>{t("privacidade.s1.i3Strong")}</strong> {t("privacidade.s1.i3")}</li>
      </ul>

      <h2>{t("privacidade.s2.h")}</h2>
      <ul>
        <li>{t("privacidade.s2.i1")}</li>
        <li>{t("privacidade.s2.i2")}</li>
        <li>{t("privacidade.s2.i3")}</li>
        <li>{t("privacidade.s2.i4")}</li>
      </ul>

      <h2>{t("privacidade.s3.h")}</h2>
      <p>{t("privacidade.s3.p")}</p>

      <h2>{t("privacidade.s4.h")}</h2>
      <p>{t("privacidade.s4.p")}</p>

      <h2>{t("privacidade.s5.h")}</h2>
      <ul>
        <li>{t("privacidade.s5.i1")}</li>
        <li>{t("privacidade.s5.i2")}</li>
        <li>{t("privacidade.s5.i3")}</li>
      </ul>

      <h2>{t("privacidade.s6.h")}</h2>
      <p>{t("privacidade.s6.p")}</p>

      <h2>{t("privacidade.s7.h")}</h2>
      <p>
        <Trans
          i18nKey="privacidade.s7.p"
          ns="legal"
          components={[<a key="0" href="mailto:contato@gastointeligente.com.br" />]}
        />
      </p>
    </LegalLayout>
  );
}
