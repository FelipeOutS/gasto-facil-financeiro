import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/BrandMark";

/**
 * Tela de carregamento padrão do Gasto Inteligente.
 * Usa o símbolo oficial sobre um fundo discreto, inclusive atrás da biometria nativa.
 */
export function BrandLoader({
  message = "Preparando tudo…",
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center overflow-hidden bg-background px-6",
        className,
      )}
      style={{
        minHeight: "100dvh",
        paddingTop: "var(--app-safe-top)",
        paddingBottom: "var(--app-safe-bottom)",
      }}
      role="status"
      aria-live="polite"
    >
      <div className="relative z-10 flex flex-col items-center gap-5">
        <BrandMark variant="symbol" decorative className="h-20 w-auto" />
        <p className="text-sm font-medium text-foreground">Gasto Inteligente</p>
        {message && <p className="text-sm text-muted-foreground text-center">{message}</p>}
      </div>
    </div>
  );
}
