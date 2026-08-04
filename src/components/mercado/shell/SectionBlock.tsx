import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionBlockProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  id?: string;
}

/**
 * Wrapper padronizado para seções da Home/telas do Mercado Inteligente.
 * Título + ação opcional (ex.: link "Ver tudo") e corpo livre.
 * Sem chamadas de dados ou estado.
 */
export function SectionBlock({
  title,
  description,
  action,
  className,
  children,
  id,
}: SectionBlockProps) {
  return (
    <section id={id} className={cn("mt-6", className)}>
      <div className="mb-3 flex items-end justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight md:text-lg">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
