import { type Categoria } from "@/lib/types";
import { ICON_MAP } from "@/lib/categories";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export function categoryColor(cat?: Pick<Categoria, "colorVar" | "colorHex">): string {
  if (!cat) return "var(--cat-outros)";
  if (cat.colorHex) return cat.colorHex;
  if (cat.colorVar) return `var(${cat.colorVar})`;
  return "var(--cat-outros)";
}

export function CategoryIcon({
  categoria,
  size = "md",
  className,
}: {
  categoria?: Categoria;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const Icon = (categoria && ICON_MAP[categoria.iconName]) || MoreHorizontal;
  const color = categoryColor(categoria);
  const dim =
    size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const iconDim = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-6 w-6" : "h-5 w-5";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        dim,
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)`,
        color,
      }}
      aria-hidden
    >
      <Icon className={iconDim} strokeWidth={2} />
    </span>
  );
}
