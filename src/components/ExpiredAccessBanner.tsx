import { Link, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Clock, XCircle } from "lucide-react";
import { usePlan } from "@/lib/use-plan";
import { cn } from "@/lib/utils";

/**
 * Banner persistente que aparece no topo das telas protegidas quando o
 * acesso premium está em risco: expirado, cancelado (após período pago) ou
 * aguardando pagamento. Não aparece para Admin Master nem dentro de
 * `/meu-plano` (para não duplicar a info).
 */
export function ExpiredAccessBanner() {
  const { status, isAdminMaster, loading, isCancelled, accessUntil, isTrialActive } = usePlan();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (loading || isAdminMaster) return null;
  if (pathname.startsWith("/meu-plano")) return null;
  if (pathname.startsWith("/login") || pathname.startsWith("/cadastro")) return null;

  const now = Date.now();
  const cancelExpired = isCancelled && accessUntil ? new Date(accessUntil).getTime() < now : false;

  let kind: "expired" | "awaiting" | "cancelled" | null = null;
  if (status === "expirado") kind = "expired";
  else if (status === "aguardando_pagamento") kind = "awaiting";
  else if (status === "cancelado" && cancelExpired) kind = "cancelled";

  if (!kind) return null;
  if (isTrialActive) return null;

  const config = {
    expired: {
      icon: XCircle,
      container: "border-destructive/30 bg-destructive/5",
      iconWrap: "bg-destructive/15 text-destructive",
      title: "Seu plano expirou",
      msg: "Renove sua assinatura para continuar usando os recursos pagos.",
      cta: "Renovar agora",
      ctaCls: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    },
    awaiting: {
      icon: Clock,
      container: "border-warning/40 bg-warning/5",
      iconWrap: "bg-warning/15 text-warning",
      title: "Aguardando confirmação de pagamento",
      msg: "Assim que o pagamento for confirmado, seu acesso premium é liberado.",
      cta: "Ver pagamento",
      ctaCls: "bg-warning text-background hover:bg-warning/90",
    },
    cancelled: {
      icon: AlertTriangle,
      container: "border-border bg-muted/40",
      iconWrap: "bg-muted text-muted-foreground",
      title: "Acesso premium encerrado",
      msg: "Sua assinatura foi cancelada e o período pago acabou. Renove para continuar.",
      cta: "Renovar plano",
      ctaCls: "bg-foreground text-background hover:bg-foreground/90",
    },
  }[kind];

  const Icon = config.icon;

  return (
    <div
      className={cn("mb-3 rounded-2xl border px-3 py-2.5 text-sm shadow-card", config.container)}
      role="status"
    >
      <div className="flex items-center gap-3">
        <span
          className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", config.iconWrap)}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight text-foreground">{config.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{config.msg}</div>
        </div>
        <Link
          to="/meu-plano"
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors",
            config.ctaCls,
          )}
        >
          <span className="hidden sm:inline">{config.cta}</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
