import { type Categoria } from "@/lib/types";
import { ICON_MAP } from "@/lib/categories";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCategoryArt } from "@/components/CategoryArt";

export function categoryColor(cat?: Pick<Categoria, "colorVar" | "colorHex">): string {
  if (!cat) return "var(--cat-outros)";
  if (cat.colorHex) return cat.colorHex;
  if (cat.colorVar) return `var(${cat.colorVar})`;
  return "var(--cat-outros)";
}

/**
 * Tenta inferir uma "arte" para a categoria. Para categorias padrão, o `id`
 * já é o slug (ex: "mercado"). Para categorias customizadas, fazemos um
 * fallback heurístico pelo nome em minúsculas.
 */
function resolveArtKey(c?: Categoria): string | null {
  if (!c) return null;
  const direct = getCategoryArt(c.id);
  if (direct) return c.id;
  const nome = (c.nome || "").toLowerCase();
  const guesses: Array<[string, string[]]> = [
    ["aluguel", ["aluguel", "aluguer"]],
    ["moradia", ["moradia", "condom"]],
    ["mercado", ["mercado", "supermerc"]],
    ["besteiras", ["besteira", "doce", "lanche"]],
    ["cabeleireiro", ["cabel", "salão", "salao", "barb"]],
    ["roupas", ["roup", "vestu"]],
    ["alimentacao", ["alimenta", "comida", "restaur"]],
    ["transporte", ["transp", "uber", "carro", "combust"]],
    ["casa", ["casa", "lar"]],
    ["saude", ["saúd", "saud", "médic", "medic"]],
    ["lazer", ["lazer", "diver"]],
    ["educacao", ["educa", "escola", "curso", "facul"]],
    ["contas", ["conta", "boleto"]],
    ["assinaturas", ["assina", "stream"]],
    ["farmacia", ["farm", "remed"]],
    ["online", ["online", "compra"]],
    ["presentes", ["presente", "gift"]],
    ["pet", ["pet", "anim"]],
    ["trabalho", ["trabalho", "freela", "escrit"]],
  ];
  for (const [key, terms] of guesses) {
    if (terms.some((t) => nome.includes(t))) return key;
  }
  return "outros";
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
  const dim =
    size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const iconDim = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-6 w-6" : "h-5 w-5";
  const artDim = size === "sm" ? "h-6 w-6" : size === "lg" ? "h-9 w-9" : "h-7 w-7";

  const artKey = !flat ? resolveArtKey(categoria) : null;
  const Art = artKey ? getCategoryArt(artKey) : null;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full transition-transform duration-200 ease-out group-hover:scale-105",
        dim,
        className,
      )}
      style={{
        background: `radial-gradient(circle at 30% 30%, color-mix(in oklab, ${color} 32%, transparent), color-mix(in oklab, ${color} 12%, transparent) 70%)`,
        boxShadow: `0 1px 0 0 color-mix(in oklab, ${color} 24%, transparent) inset, 0 6px 14px -8px color-mix(in oklab, ${color} 60%, transparent)`,
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
