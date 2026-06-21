import { BrandMark } from "@/components/BrandMark";
import { cn } from "@/lib/utils";

/**
 * Tela de carregamento padrão do Gasto Inteligente.
 * Usa o logo oficial com uma pulsação suave e elegante.
 * Centraliza vertical/horizontalmente respeitando safe-area (notch/câmera).
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
        "fixed inset-0 flex items-center justify-center bg-background px-6",
        className,
      )}
      style={{
        minHeight: "100dvh",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <BrandMark
          variant="symbol"
          className="h-14 w-14 sm:h-16 sm:w-16 motion-safe:animate-[brand-pulse_1.8s_ease-in-out_infinite]"
        />
        {message && (
          <p className="text-sm text-muted-foreground text-center">{message}</p>
        )}
      </div>
    </div>
  );
}
