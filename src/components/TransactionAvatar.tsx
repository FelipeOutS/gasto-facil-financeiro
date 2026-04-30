/**
 * TransactionAvatar — Avatar global para qualquer transação/gasto exibido no app.
 *
 * Regra:
 *   1. Se o estabelecimento tiver logo conhecido → mostra apenas o logo da empresa.
 *   2. Senão, se houver categoria → mostra o ícone vetorial da categoria.
 *   3. Fallback final → BrandLogo merchant (círculo com inicial).
 *
 * Use em qualquer lista/card que exibe gastos para garantir consistência visual.
 */
import { memo } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { CategoryIcon } from "@/components/CategoryIcon";
import { hasMerchantLogo } from "@/lib/logos";
import type { Categoria } from "@/lib/types";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

const wrapperSize: Record<Size, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
};

type Props = {
  /** Nome do estabelecimento ou descrição livre da transação. */
  estabelecimento?: string | null;
  /** Categoria da transação (usada como fallback visual). */
  categoria?: Categoria;
  size?: Size;
  className?: string;
};

function TransactionAvatarBase({ estabelecimento, categoria, size = "md", className }: Props) {
  const merchantName = (estabelecimento || "").trim();

  // 1) Logo da empresa, quando reconhecido.
  if (merchantName && hasMerchantLogo(merchantName)) {
    return (
      <BrandLogo
        name={merchantName}
        variant="merchant"
        className={cn(wrapperSize[size], "shrink-0", className)}
      />
    );
  }

  // 2) Ícone vetorial da categoria.
  if (categoria) {
    return <CategoryIcon categoria={categoria} size={size} className={className} />;
  }

  // 3) Fallback elegante (inicial do estabelecimento, círculo neutro).
  return (
    <BrandLogo
      name={merchantName || "?"}
      variant="merchant"
      className={cn(wrapperSize[size], "shrink-0", className)}
    />
  );
}

export const TransactionAvatar = memo(TransactionAvatarBase);
