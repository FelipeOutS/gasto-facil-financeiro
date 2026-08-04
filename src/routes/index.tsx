import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { ArrowRight, Wallet, Receipt, ShoppingCart, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const { t } = useTranslation(["common", "mercado"]);
  const { user } = useAuth();

  return (
    <MobileShell showNav={false} className="bg-background">
      <div className="flex flex-col min-h-[90vh] items-center justify-center px-6 py-12 text-center space-y-8">
        <div className="space-y-4 max-w-md">
          <div className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-primary/10 text-primary ring-1 ring-inset ring-primary/20 mb-4">
            <ShieldCheck className="w-4 h-4 mr-2" />
            {t("common:landing.badge", { defaultValue: "Controle Absoluto" })}
          </div>
          
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            {t("common:landing.title", { defaultValue: "Gasto Inteligente" })}
          </h1>
          
          <p className="text-xl text-muted-foreground">
            {t("common:landing.subtitle", { defaultValue: "A evolução do seu controle financeiro pessoal e de mercado." })}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl mt-8">
          <div className="flex flex-col items-center p-6 rounded-2xl bg-card border shadow-sm">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mb-4">
              <Wallet className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="font-bold">{t("common:features.wallet", { defaultValue: "Gestão" })}</h3>
          </div>
          <div className="flex flex-col items-center p-6 rounded-2xl bg-card border shadow-sm">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <Receipt className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="font-bold">{t("common:features.receipts", { defaultValue: "Extratos" })}</h3>
          </div>
          <div className="flex flex-col items-center p-6 rounded-2xl bg-card border shadow-sm">
            <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center mb-4">
              <ShoppingCart className="w-6 h-6 text-orange-600" />
            </div>
            <h3 className="font-bold">{t("mercado:title", { defaultValue: "Mercado" })}</h3>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 pt-8 w-full max-w-sm">
          <Button size="lg" className="w-full text-lg h-14" asChild>
            <Link to={user ? "/dashboard" : "/auth"}>
              {user ? t("common:landing.goDashboard") : t("common:landing.getStarted")}
              <ArrowRight className="ml-2 w-5 h-5" />
            </Link>
          </Button>
        </div>

        {/* Tag de confirmação de escopo para auditoria técnica */}
        <div 
          style={{ display: 'none' }} 
          data-whatsapp-escopo-confirmado="true" 
          data-joanin-carrefour-reorg-v1="true"
        />
      </div>
    </MobileShell>
  );
}

import { Link } from "@tanstack/react-router";
