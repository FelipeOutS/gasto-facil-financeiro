import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Lock, Sparkles, ArrowRight, Target, Repeat, ShoppingCart, Receipt, FileUp, type LucideIcon } from "lucide-react";
import { usePlan } from "@/lib/use-plan";
import { minPlanFor, PLAN_LABEL, type FeatureKey } from "@/lib/plans";
import { NAV_GROUPS, getLockedNavItems } from "@/lib/nav-groups";

/**
 * Etapa 8 — Sub-recursos premium que não viram item de menu próprio.
 * Aparecem como card de upgrade quando o usuário não tem a feature,
 * mas o item de menu correspondente já está visível (versão básica).
 */
type SubFeatureTeaser = {
  feature: FeatureKey;
  to: string;
  icon: LucideIcon;
  labelKey: string;
};
const SUBFEATURE_TEASERS: SubFeatureTeaser[] = [
  // Etapa 22 — Prioridade: importação inteligente primeiro (alta conversão),
  // depois mercado avançado, cupom, e por último automações utilitárias.
  { feature: "importacoes", to: "/gastos", icon: FileUp, labelKey: "importacoes" },
  { feature: "mercado_avancado", to: "/mercado", icon: ShoppingCart, labelKey: "mercadoAvancado" },
  { feature: "mercado_importar_cupom", to: "/mercado", icon: Receipt, labelKey: "mercadoImportarCupom" },
  { feature: "metas_visuais", to: "/metas", icon: Target, labelKey: "metasVisuais" },
  { feature: "assinaturas_recorrencias", to: "/assinaturas", icon: Repeat, labelKey: "assinaturasAuto" },
];

/**
 * Etapa 7 — Cards de upgrade.
 * Mostra, de forma estratégica e limpa, recursos premium que o plano atual
 * do usuário não inclui. Reaproveita as `features` declaradas em NAV_GROUPS,
 * portanto a navegação dinâmica e os cards têm uma única fonte da verdade.
 *
 * Não substitui a proteção real de rota (AuthGate + PREMIUM_ROUTE_RULES).
 */
export function UpgradeCardsList({
  max = 3,
  title,
  className,
}: {
  max?: number;
  title?: string;
  className?: string;
}) {
  const { t } = useTranslation("dashboard");
  const { t: tNav } = useTranslation("nav");
  const { can, isAdminMaster, loading } = usePlan();

  if (loading || isAdminMaster) return null;

  const groups = NAV_GROUPS.filter((g) => !g.adminMasterOnly);
  const navLocked = getLockedNavItems(groups, can, false)
    // WhatsApp ainda é "em breve": não usar como gancho comercial agora.
    .filter((it) => it.to !== "/whatsapp")
    .map((it) => ({
      to: it.to,
      icon: it.icon,
      feature: it.feature,
      label: tNav(`items.${it.labelKey}`),
    }));

  const subLocked = SUBFEATURE_TEASERS.filter((s) => !can(s.feature)).map((s) => ({
    to: s.to,
    icon: s.icon,
    feature: s.feature,
    label: t(`upgradeCards.subFeatures.${s.labelKey}`),
  }));

  const locked = [...navLocked, ...subLocked].slice(0, max);
  if (locked.length === 0) return null;


  return (
    <section
      className={
        "mt-6 rounded-2xl border border-border/60 bg-card/50 p-4 shadow-card " +
        (className ?? "")
      }
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand" />
          <h3 className="text-sm font-semibold">
            {title ?? t("upgradeCards.title")}
          </h3>
        </div>
        <Link
          to="/meu-plano"
          className="text-[11px] font-semibold text-brand hover:underline"
        >
          {t("upgradeCards.seeAll")}
        </Link>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {locked.map((item) => {
          const Icon = item.icon;
          const min = item.feature ? minPlanFor(item.feature) : null;
          return (
            <li key={item.to}>
              <Link
                to="/meu-plano"
                className="group flex min-h-12 items-start gap-3 rounded-xl border border-border/50 bg-background/60 p-3 transition-colors hover:bg-accent/30 active:scale-[0.99]"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-on-soft">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                    <span className="truncate">
                      {item.label}
                    </span>
                    <Lock className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                  </span>
                  {min && (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {t("upgradeCards.unlockIn", { plan: PLAN_LABEL[min] })}
                    </span>
                  )}
                </span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
