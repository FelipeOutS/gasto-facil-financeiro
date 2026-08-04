import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";
import i18n from "@/i18n";
import { LegalLayout } from "@/components/landing/LegalLayout";

export const Route = createFileRoute("/status")({
  head: () => {
    const t = i18n.getFixedT(null, "legal");
    return {
      meta: [
        { title: t("status.metaTitle") },
        { name: "description", content: t("status.metaDesc") },
        { property: "og:title", content: t("status.metaTitle") },
        { property: "og:description", content: t("status.ogDesc") },
        { property: "og:url", content: "https://gastointeligente.com.br/status" },
        {
          property: "og:image",
          content: "https://gastointeligente.com.br/og-gasto-inteligente.png",
        },
        {
          name: "twitter:image",
          content: "https://gastointeligente.com.br/og-gasto-inteligente.png",
        },
      ],
      links: [{ rel: "canonical", href: "https://gastointeligente.com.br/status" }],
    };
  },
  component: StatusPage,
});

function StatusPage() {
  const { t, i18n: i18nInst } = useTranslation("legal");
  const locale = i18nInst.language === "en" ? "en-US" : "pt-BR";
  let updated: string;
  try {
    updated = new Date().toLocaleString(locale, {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    updated = new Date().toISOString();
  }

  const services = [
    { key: "web", name: t("status.services.web") },
    { key: "auth", name: t("status.services.auth") },
    { key: "imports", name: t("status.services.imports") },
    { key: "accountant", name: t("status.services.accountant") },
    { key: "radar", name: t("status.services.radar") },
  ];

  return (
    <LegalLayout title={t("status.title")} eyebrow={t("status.eyebrow")} updatedAt={updated}>
      <div className="not-prose mb-8 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold text-emerald-800">{t("status.allOk")}</p>
          <p className="text-xs text-emerald-700/80">{t("status.noIncidents")}</p>
        </div>
      </div>

      <h2>{t("status.servicesHeader")}</h2>
      <ul className="not-prose mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {services.map((s) => (
          <li key={s.key} className="flex items-center justify-between px-5 py-3 text-sm">
            <span className="font-medium text-slate-800">{s.name}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {t("status.operational")}
            </span>
          </li>
        ))}
      </ul>

      <h2 className="mt-10">{t("status.incidentsHeader")}</h2>
      <p>{t("status.incidentsBody")}</p>
    </LegalLayout>
  );
}
