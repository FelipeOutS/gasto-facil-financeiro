/**
 * TransactionAvatar — Avatar global para qualquer transação/gasto exibido no app.
 *
 * Regra:
 *   1. Se o estabelecimento tiver logo conhecido → mostra apenas o logo da empresa.
 *   2. Senão, se houver categoria → mostra o ícone vetorial da categoria.
 *   3. Senão, tenta inferir uma categoria pelo NOME do estabelecimento
 *      (ex: "Aluguel" → ícone de moradia/casa).
 *   4. Fallback final → BrandLogo merchant (círculo com inicial).
 */
import { memo } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { CategoryIcon } from "@/components/CategoryIcon";
import { hasMerchantLogo } from "@/lib/logos";
import type { Categoria } from "@/lib/types";
import { cn } from "@/lib/utils";
import { resolveCategoryKey } from "@/lib/category-visual";
import { DEFAULT_CATEGORIES, ICON_MAP } from "@/lib/categories";

type Size = "sm" | "md" | "lg";

const wrapperSize: Record<Size, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
};

type Props = {
  estabelecimento?: string | null;
  categoria?: Categoria;
  size?: Size;
  className?: string;
};

/**
 * Constrói uma Categoria "virtual" a partir do nome do estabelecimento
 * quando o gasto não tem categoria atribuída ou está como "outros".
 * Garante que nomes como "Aluguel", "Condomínio", "Luz", "Mercado" etc
 * recebam o ícone vetorial correto em vez de cair na inicial textual.
 */
function inferCategoriaFromName(nome: string): Categoria | null {
  const key = resolveCategoryKey(nome);
  if (!key || key === "outros") return null;
  const def = DEFAULT_CATEGORIES.find((c) => c.id === key);
  if (def) {
    return {
      id: def.id,
      nome: def.nome,
      iconName: def.iconName,
      colorVar: def.colorVar,
      criadaPeloUsuario: false,
    } as Categoria;
  }
  // Aliases visuais (uber, energia, etc) que não estão em DEFAULT_CATEGORIES.
  // Usa um ícone padrão e a CSS var correspondente.
  const iconName = (ICON_MAP["MoreHorizontal"] ? "MoreHorizontal" : "MoreHorizontal") as keyof typeof ICON_MAP;
  return {
    id: key,
    nome: key,
    iconName,
    colorVar: `--cat-${key}`,
    criadaPeloUsuario: false,
  } as Categoria;
}

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

  // 2) Ícone vetorial da categoria explícita (ignora "outros" para deixar
  // a heurística pelo nome ter chance de ganhar quando o nome é descritivo).
  const categoriaIsOutros = categoria && (categoria.id === "outros" || categoria.nome?.toLowerCase() === "outros");
  if (categoria && !categoriaIsOutros) {
    return <CategoryIcon categoria={categoria} size={size} className={className} />;
  }

  // 3) Inferência pelo nome do estabelecimento (ex: "Aluguel" → moradia).
  if (merchantName) {
    const inferida = inferCategoriaFromName(merchantName);
    if (inferida) {
      return <CategoryIcon categoria={inferida} size={size} className={className} />;
    }
  }

  // 4) Categoria "outros" sem nome reconhecido → ainda renderiza o ícone
  // vetorial de "outros" em vez de cair na inicial textual.
  if (categoria) {
    return <CategoryIcon categoria={categoria} size={size} className={className} />;
  }

  // 5) Fallback final.
  return (
    <BrandLogo
      name={merchantName || "?"}
      variant="merchant"
      className={cn(wrapperSize[size], "shrink-0", className)}
    />
  );
}

export const TransactionAvatar = memo(TransactionAvatarBase);
