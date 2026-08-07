import { ShieldCheck } from "lucide-react";
import { usePlan } from "@/lib/use-plan";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AdminMasterBadge({ className }: { className?: string }) {
  const { isAdminMaster, loading } = usePlan();

  if (loading || !isAdminMaster) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20 shadow-sm transition-all hover:bg-amber-500/15 cursor-help",
              className
            )}
          >
            <ShieldCheck className="h-3 w-3" />
            Admin Master
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          Você tem acesso total a todos os recursos do sistema.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
