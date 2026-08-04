import { useState, type ReactNode, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePlan } from "@/lib/use-plan";
import type { FeatureKey } from "@/lib/plans";
import { UpgradeModal } from "@/components/UpgradeModal";
import { cn } from "@/lib/utils";

type Props = {
  /** Feature premium necessária para abrir o destino. */
  feature: FeatureKey;
  /** Rota de destino caso o usuário tenha acesso. */
  to: string;
  /** Conteúdo visível do link/botão. */
  children: ReactNode;
  /** Classes do link em si. */
  className?: string;
  /** Título do modal premium (i18n já resolvido). */
  modalTitle: string;
  /** Descrição/benefício do modal premium (i18n já resolvido). */
  modalDescription: string;
  /** Mostrar cadeado pequeno ao lado do conteúdo quando bloqueado. */
  showLockIcon?: boolean;
};

/**
 * Etapa 17 — Gate visual inline para atalhos do Mercado Inteligente que
 * apontam a recursos premium. Quando o usuário NÃO tem a feature, o link
 * abre o `UpgradeModal` em vez de navegar para a rota premium (a rota
 * continua protegida por `PREMIUM_ROUTE_RULES` via AuthGate).
 */
export function PremiumInlineLink({
  feature,
  to,
  children,
  className,
  modalTitle,
  modalDescription,
  showLockIcon = true,
}: Props) {
  const { can } = usePlan();
  const [open, setOpen] = useState(false);
  const allowed = can(feature);

  if (allowed) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={cn("inline-flex items-center gap-1", className)}
      >
        {children}
        {showLockIcon && <Lock className="h-3 w-3 shrink-0 opacity-70" aria-hidden />}
      </button>
      <UpgradeModal
        open={open}
        onOpenChange={setOpen}
        feature={feature}
        featureLabel={modalTitle}
        benefit={modalDescription}
      />
    </>
  );
}
