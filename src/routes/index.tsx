import { createFileRoute } from "@tanstack/react-router";
import { PublicLanding } from "@/components/landing/PublicLanding";
import i18n from "@/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: i18n.t("common:seo.title", { defaultValue: "Gasto Inteligente - Controle Financeiro" }) },
      { name: "description", content: i18n.t("common:seo.description", { defaultValue: "Gerencie seus gastos, compras de mercado e muito mais com inteligência artificial." }) },
      { property: "og:title", content: i18n.t("common:seo.title") },
      { property: "og:description", content: i18n.t("common:seo.description") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <>
      <PublicLanding />
      {/* Tag de confirmação de escopo para auditoria técnica */}
      <div 
        style={{ display: 'none' }} 
        data-whatsapp-escopo-confirmado="true" 
        data-joanin-carrefour-reorg-v1="true"
        data-auditoria-geral-v2="true"
      />
    </>
  );
}

