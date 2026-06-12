/**
 * AdSlot — Placeholder visual de anúncios para o plano `free_ads`.
 *
 * Fase 1E-B2L. Sem rede externa, sem script, sem iframe, sem pixel,
 * sem cookie, sem tracking. Renderiza apenas um card estático interno.
 *
 * Visibilidade:
 *  - Só aparece para usuário com `plan === "free_ads"` e
 *    `status === "ativo"`.
 *  - Não aparece para Admin Master, planos pagos, `sem_assinatura`,
 *    `expirado`, `cancelado` nem durante carregamento.
 *  - Controlado pela flag `VITE_ENABLE_AD_PLACEHOLDERS` (default: ligada
 *    — o slot já depende do plano para aparecer, então a flag é um
 *    kill-switch global; defina como `"false"` para desligar em todos
 *    os usuários sem precisar fazer deploy de código).
 */
import { useTranslation } from "react-i18next";
import { Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlan } from "@/lib/use-plan";

const FLAG = (import.meta.env.VITE_ENABLE_AD_PLACEHOLDERS ?? "true") !== "false";

export interface AdSlotProps {
  /** Classes extras para alinhar o card ao layout da página. */
  className?: string;
  /** Para testes/analytics interno (não envia para fora). */
  slotId?: string;
}

export function AdSlot({ className, slotId }: AdSlotProps) {
  const { t } = useTranslation("common");
  const { plan, status, isAdminMaster, loading } = usePlan();

  if (!FLAG) return null;
  if (loading) return null;
  if (isAdminMaster) return null;
  if (plan !== "free_ads" || status !== "ativo") return null;

  return (
    <aside
      role="complementary"
      aria-label={t("ads.placeholderTitle")}
      data-ad-slot={slotId ?? "generic"}
      className={cn(
        "rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-3",
        "flex items-center gap-3 text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Megaphone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
          {t("ads.freePlanBadge")}
        </p>
        <p className="truncate text-sm font-medium text-foreground/80">
          {t("ads.placeholderTitle")}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {t("ads.placeholderSubtitle")}
        </p>
      </div>
    </aside>
  );
}

export default AdSlot;
