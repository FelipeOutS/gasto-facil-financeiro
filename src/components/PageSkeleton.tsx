import { Skeleton } from "@/components/ui/skeleton";
import { MobileShell } from "./MobileShell";

export function PageSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <MobileShell wide={wide}>
      <div className="space-y-4 pt-2 animate-fade-in" aria-label="Carregando página">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20 skeleton-shimmer" />
          <Skeleton className="h-8 w-48 skeleton-shimmer" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl skeleton-shimmer" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-3xl skeleton-shimmer" />
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-2xl skeleton-shimmer" />
          <Skeleton className="h-16 rounded-2xl skeleton-shimmer" />
          <Skeleton className="h-16 rounded-2xl skeleton-shimmer" />
        </div>
      </div>
    </MobileShell>
  );
}
