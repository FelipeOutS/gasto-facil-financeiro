/**
 * TransactionAvatar — Avatar global para qualquer transação/gasto exibido no app.
 *
 * Prioridade (regra obrigatória):
 *   1. Logo real da empresa/estabelecimento (BrandLogo global, com cascata
 *      Logo.dev → DuckDuckGo → Google s2).
 *   2. Se nenhum logo carregar, ícone vetorial da categoria.
 *   3. Sem categoria útil → ícone inferido pelo nome.
 *   4. Fallback final → inicial colorida.
 *
 * A categoria NUNCA bloqueia a tentativa de buscar o logo da marca.
 */
import { memo } from "react";
import { BrandLogo as BrandLogoLegacy } from "@/components/BrandLogo";
import { BrandLogo as GlobalBrandLogo } from "@/components/brand/BrandLogo";
import { CategoryIcon } from "@/components/CategoryIcon";
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

function inferCategoriaFromName(nome: string): Categoria {
  const key = resolveCategoryKey(nome);
  const safeKey = key || "outros";
  const def = DEFAULT_CATEGORIES.find((c) => c.id === safeKey);
  if (def) {
    return {
      id: def.id,
      nome: def.nome,
      iconName: def.iconName,
      colorVar: def.colorVar,
      criadaPeloUsuario: false,
    } as Categoria;
  }
  const iconName = (
    ICON_MAP["MoreHorizontal"] ? "MoreHorizontal" : "MoreHorizontal"
  ) as keyof typeof ICON_MAP;
  return {
    id: safeKey,
    nome: safeKey,
    iconName,
    colorVar: `--cat-${safeKey}`,
    criadaPeloUsuario: false,
  } as Categoria;
}

function TransactionAvatarBase({ estabelecimento, categoria, size = "md", className }: Props) {
  const merchantName = (estabelecimento || "").trim();
  const brandSize = size === "sm" ? "sm" : size === "lg" ? "lg" : "md";

  // Categoria que usaremos como fallback visual (preferindo a explícita;
  // depois inferida pelo nome; depois "outros").
  const categoriaIsOutros =
    categoria && (categoria.id === "outros" || categoria.nome?.toLowerCase() === "outros");
  const categoriaUtil: Categoria | undefined =
    (categoria && !categoriaIsOutros ? categoria : undefined) ||
    (merchantName ? inferCategoriaFromName(merchantName) : undefined) ||
    categoria;

  // 1) Sempre que houver um nome, tenta logo real PRIMEIRO.
  if (merchantName) {
    const fallbackNode = categoriaUtil ? (
      <CategoryIcon categoria={categoriaUtil} size={size} className={className} />
    ) : undefined;
    return (
      <GlobalBrandLogo
        name={merchantName}
        size={brandSize}
        variant="circle"
        className={cn(wrapperSize[size], "shrink-0", className)}
        fallback={fallbackNode}
        // Quando temos um ícone de categoria pronto, evitamos tentar palpites
        // de domínio por TLD — eles causam flicker (favicons genéricos
        // aparecendo por 1-2s) antes de cair no fallback. Marcas conhecidas
        // (SEED: ifood, sabesp, enel, netflix...) continuam carregando.
        trustedOnly={!!fallbackNode}
      />
    );
  }

  // 2) Sem nome — usa categoria explícita ou inferida.
  if (categoriaUtil) {
    return <CategoryIcon categoria={categoriaUtil} size={size} className={className} />;
  }

  // 3) Fallback final.
  return (
    <BrandLogoLegacy
      name="?"
      variant="merchant"
      className={cn(wrapperSize[size], "shrink-0", className)}
    />
  );
}

export const TransactionAvatar = memo(TransactionAvatarBase);
