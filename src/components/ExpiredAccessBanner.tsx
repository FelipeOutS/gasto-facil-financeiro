import { Link, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Clock, XCircle } from "lucide-react";
import { usePlan } from "@/lib/use-plan";

/**
 * Banner persistente que aparece no topo das telas protegidas quando o
 * acesso premium está em risco: expirado, cancelado (após período pago) ou
 * aguardando pagamento. Não aparece para Admin Master nem dentro de
 * `/meu-plano` (para não duplicar a info).
 */
export function ExpiredAccessBanner() {
  const { status, isAdminMaster, loading, isCancelled, accessUntil, isTrialActive } =
    usePlan();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (loading || isAdminMaster) return null;
  // Não duplica dentro da própria tela de plano.
  if (pathname.startsWith("/meu-plano")) return null;
  if (pathname.startsWith("/login") || pathname.startsWith("/cadastro")) return null;

  const now = Date.now();
  const cancelExpired =
    isCancelled && accessUntil ? new Date(accessUntil).getTime() < now : false;

  let kind: "expired" | "awaiting" | "cancelled" | null = null;
  if (status === "expirado") kind = "expired";
  else if (status === "aguardando_pagamento") kind = "awaiting";
  else if (status === "cancelado" && cancelExpired) kind = "cancelled";

  if (!kind) return null;
  // Teste ativo nunca mostra banner (já tem chip próprio nas telas).
  if (isTrialActive) return null;

  const config = {
    expired: {
      icon: XCircle,
      tone: "border-destructive/40 bg-destructive/10 text-destructive",
      title: "Seu plano expirou",
      msg: "Renove sua assinatura para continuar usando os recursos pagos.",
      cta: "Renovar agora",
    },
    awaiting: {
      icon: Clock,
      tone: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      title: "Aguardando confirmação de pagamento",
      msg: "Assim que o pagamento for confirmado, seu acesso premium é liberado.",
      cta: "Ver pagamento",
    },
    cancelled: {
      icon: AlertTriangle,
      tone: "border-muted-foreground/40 bg-muted/40 text-foreground",
      title: "Acesso premium encerrado",
      msg: "Sua assinatura foi cancelada e o período pago acabou. Renove para continuar.",
      cta: "Renovar plano",
    },
  }[kind];

  const Icon = config.icon;

  return (
    <div
      className={`mb-3 rounded-2xl border ${config.tone} px-3 py-2.5 text-sm`}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">{config.title}</div>
          <div className="mt-0.5 text-xs opacity-90">{config.msg}</div>
        </div>
        <Link
          to="/meu-plano"
          className="ml-1 inline-flex shrink-0 items-center gap-1 self-center rounded-full bg-background/80 px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-background"
        >
          {config.cta}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
