import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface AppSectionBlockProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Ação à direita do título (link "ver tudo", botão pequeno). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Remove o padding/borda do card (útil para wrappers de vitrines). */
  bare?: boolean;
}

/**
 * Bloco de seção reutilizável: título + descrição + ação opcional + corpo.
 * Padrão visual consistente em todos os módulos.
 */
export function AppSectionBlock({
  title,
  description,
  action,
  children,
  className,
  bare = false,
}: AppSectionBlockProps) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h3 className="text-sm font-semibold text-foreground sm:text-base">{title}</h3>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {bare ? (
        <>{children}</>
      ) : (
        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-card sm:p-5">
          {children}
        </div>
      )}
    </section>
  );
}
