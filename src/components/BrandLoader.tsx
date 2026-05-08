import { BrandMark } from "@/components/BrandMark";
import { cn } from "@/lib/utils";

/**
 * Tela de carregamento padrão do Gasto Inteligente.
 * Usa o logo oficial com uma pulsação suave e elegante.
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
        "flex min-h-screen items-center justify-center bg-background px-6",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <BrandMark
          className="h-12 w-auto sm:h-16 motion-safe:animate-[brand-pulse_1.8s_ease-in-out_infinite]"
        />
        {message && (
          <p className="text-sm text-muted-foreground">{message}</p>
        )}
      </div>
    </div>
  );
}
