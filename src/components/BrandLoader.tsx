import { cn } from "@/lib/utils";
import { StarfieldBackground } from "@/components/StarfieldBackground";
const ICON_DARK = "/logos/brand/icone-gasto-inteligente-dark.svg";

/**
 * Tela de carregamento padrão do Gasto Inteligente.
 * Usa o ícone oficial sobre um fundo estrelado premium.
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
        "fixed inset-0 flex items-center justify-center overflow-hidden px-6",
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
      <StarfieldBackground />
      <div className="relative z-10 flex flex-col items-center gap-4 animate-fade-in">
        <img
          src={ICON_DARK}
          alt=""
          aria-hidden="true"
          width={64}
          height={64}
          className="h-14 w-14 sm:h-16 sm:w-16 motion-safe:animate-[brand-pulse_1.8s_ease-in-out_infinite]"
        />
        {message && (
          <p className="text-sm text-slate-300/90 text-center">{message}</p>
        )}
      </div>
    </div>
  );
}
