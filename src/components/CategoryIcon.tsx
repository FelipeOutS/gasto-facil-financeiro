import { type Categoria } from "@/lib/types";
import { ICON_MAP } from "@/lib/categories";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCategoryArt } from "@/components/CategoryArt";
import { getCategoryVisual, resolveCategoryKey } from "@/lib/category-visual";

export function categoryColor(
  cat?: Pick<Categoria, "colorVar" | "colorHex" | "nome" | "id">,
): string {
  if (!cat) return "var(--cat-outros)";
  if (cat.colorHex) return cat.colorHex;
  if (cat.colorVar) return `var(${cat.colorVar})`;
  // Fallback: tenta inferir pela identidade central
  const visual = getCategoryVisual((cat as Categoria).id || (cat as Categoria).nome);
  return visual.color;
}

/**
 * Resolve a chave da arte combinando id direto + heurística pelo nome.
 * Mantido para compatibilidade — delega para o resolver central.
 */
function resolveArtKey(c?: Categoria): string | null {
  if (!c) return null;
  const direct = getCategoryArt(c.id);
  if (direct) return c.id;
  const key = resolveCategoryKey(c.nome || c.id);
  return key;
}

export function CategoryIcon({
  categoria,
  size = "md",
  className,
  /** Quando true, força uso do ícone Lucide simples (sem ilustração SVG). */
  flat = false,
}: {
  categoria?: Categoria;
  size?: "sm" | "md" | "lg";
  className?: string;
  flat?: boolean;
}) {
  const Icon = (categoria && ICON_MAP[categoria.iconName]) || MoreHorizontal;
  const color = categoryColor(categoria);
  const dim = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const iconDim = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-6 w-6" : "h-5 w-5";
  const artDim = size === "sm" ? "h-6 w-6" : size === "lg" ? "h-9 w-9" : "h-7 w-7";

  const artKey = !flat ? resolveArtKey(categoria) : null;
  const Art = artKey ? getCategoryArt(artKey) : null;

  return (
    <span
      className={cn(
        // Badge premium: borda + sombra colorida + hover sutil
        "relative inline-flex shrink-0 items-center justify-center rounded-full",
        "transition-[transform,box-shadow] duration-200 ease-out",
        "ring-1 ring-inset",
        "group-hover:scale-105 group-hover:shadow-lg",
        dim,
        className,
      )}
      style={{
        background: `radial-gradient(circle at 30% 28%, color-mix(in oklab, ${color} 38%, transparent), color-mix(in oklab, ${color} 14%, transparent) 72%)`,
        boxShadow: `0 1px 0 0 color-mix(in oklab, ${color} 30%, transparent) inset, 0 6px 16px -10px color-mix(in oklab, ${color} 70%, transparent)`,
        // borda interna sutil acompanhando a cor da categoria
        ["--tw-ring-color" as string]: `color-mix(in oklab, ${color} 35%, transparent)`,
        color,
      }}
      aria-hidden
    >
      {Art ? (
        <Art className={cn(artDim, "drop-shadow-[0_1px_1px_rgba(0,0,0,0.18)]")} />
      ) : (
        <Icon className={iconDim} strokeWidth={2} />
      )}
    </span>
  );
}
