import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { chooseFreeAdsPlan } from "@/lib/subscription.functions";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Check,
  Crown,
  Hourglass,
  Lock,
  Sparkles,
  Zap,
  Receipt,
  XCircle,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { UpgradeCardsList } from "@/components/UpgradeCardsList";
import { requireOnline } from "@/lib/use-online-status";
import { ZonaDeRiscoCard } from "@/components/DeleteAccountDialog";
import { CancelarAssinaturaDialog } from "@/components/CancelarAssinaturaDialog";
import { useAuth } from "@/lib/auth-context";
import { usePlan } from "@/lib/use-plan";
import {
  COMMERCIAL_PLANS,
  PERIODICIDADES,
  PLAN_FEATURES,
  PLAN_LABEL,
  commercialPlanByTier,
  formatBRL,
  planAllowsFeature,
  priceForPeriod,
  suggestedUpgrade,
  type Periodicidade,
  type PlanTier,
} from "@/lib/plans";
import {
  getVocab,
  tipoCadastroLabel,
  type TipoCadastro,
} from "@/lib/profile-utils";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { EmptyState as PremiumEmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  criarCheckout,
  listarPagamentos,
  statusLabelMP,
  verificarPagamento,
  type PaymentHistoryRow,
} from "@/lib/payments-mp";
import { toast } from "sonner";

export const Route = createFileRoute("/meu-plano")({
  head: () => ({ meta: [{ title: "Meu plano — Gasto Inteligente" }] }),
  component: MeuPlanoPage,
});

const STATUS_BADGE_TONE: Record<string, StatusTone> = {
  ativo: "success",
  teste: "info",
  aguardando_pagamento: "warning",
  expirado: "destructive",
  cancelado: "muted",
  sem_assinatura: "muted",
};

function MeuPlanoPage() {
  const { t, i18n } = useTranslation("landing");
  const { t: tp } = useTranslation("meu-plano");
  const { profile, user } = useAuth();
  const {
    plan,
    storedPlan,
    status,
    trialEndsAt,
    loading,
    isAdminMaster,
    isTrialActive,
    trialDaysLeft,
    trialUsed,
    isCancelled,
    accessUntil,
    paymentMethod,
    paymentAmountCents,
    paidAt,
    periodicidade: activePeriodicidade,
    currentPeriodStart,
    currentPeriodEnd,
    refresh,
  } = usePlan();
  const tipo = (profile?.tipo_cadastro as TipoCadastro) ?? null;
  const vocab = getVocab(tipo);
  const recommended = suggestedUpgrade(plan, tipo);
  const semAssinatura =
    !loading &&
    !isAdminMaster &&
    !isTrialActive &&
    (storedPlan === "sem_assinatura" || storedPlan === "free");
  const aguardando = !loading && !isAdminMaster && status === "aguardando_pagamento";
  const expirado = !loading && !isAdminMaster && status === "expirado";
  const ativoPago =
    !loading && !isAdminMaster && status === "ativo" && storedPlan !== "sem_assinatura" && storedPlan !== "free" && !isTrialActive;

  const [submitting, setSubmitting] = useState<PlanTier | null>(null);
  const [periodicidade, setPeriodicidade] = useState<Periodicidade>("mensal");
  const [metodoPagamento, setMetodoPagamento] = useState<"pix" | "card">("pix");
  const [pixCharge, setPixCharge] = useState<{
    paymentId?: string;
    qr_code?: string | null;
    qr_code_base64?: string | null;
    ticket_url?: string | null;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [historico, setHistorico] = useState<PaymentHistoryRow[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    void listarPagamentos(user.id).then(setHistorico);
  }, [user?.id]);

  // Tratamento do retorno do Checkout Pro (?status=success|pending|failure)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const st = params.get("status");
    if (!st) return;
    if (st === "success") {
      toast.success(tp("toasts.paymentApproved"));
    } else if (st === "pending") {
      toast.info(tp("toasts.paymentPending"));
    } else if (st === "failure") {
      toast.error(tp("toasts.paymentFailure"));
    }
    // limpa a URL para não disparar novamente
    params.delete("status");
    params.delete("payment_id");
    params.delete("collection_id");
    params.delete("collection_status");
    params.delete("preference_id");
    params.delete("external_reference");
    params.delete("merchant_order_id");
    params.delete("payment_type");
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? `?${qs}` : "");
    window.history.replaceState({}, "", newUrl);
    void refresh();
    if (user?.id) void listarPagamentos(user.id).then(setHistorico);
  }, [user?.id, refresh]);

  // Periodicidade do plano atual: último pagamento aprovado, se houver
  const ultimoAprovado = historico.find((h) =>
    ["approved", "paid", "authorized"].includes((h.status ?? "").toLowerCase()),
  );
  const planoAtualPeriodo = (ultimoAprovado as unknown as { periodicidade?: Periodicidade } | undefined)?.periodicidade ?? null;
  const planoAtualMetodo = paymentMethod ?? ultimoAprovado?.method ?? null;
  const planoAtualTotal = paymentAmountCents ?? ultimoAprovado?.amount_cents ?? null;
  const planoAtualPagoEm = paidAt ?? ultimoAprovado?.paid_at ?? null;
  const isEnglish = i18n.language?.startsWith("en");
  const periodLabel = (key: Periodicidade) => t(`billing.periods.${key}.label`);
  const periodSuffix = (key: Periodicidade) => t(`billing.periods.${key}.suffix`);
  const periodBadge = (key: Periodicidade, fallback?: string) =>
    t(`billing.periods.${key}.badge`, { defaultValue: fallback ?? "" });
  const formatDate = (date: string | Date) =>
    new Date(date).toLocaleDateString(isEnglish ? "en-US" : "pt-BR");
  const planName = (tier: PlanTier) => t(`plans.names.${tier}`, { defaultValue: PLAN_LABEL[tier] });
  const planDescription = (tier: PlanTier, fallback: string) =>
    t(`plans.descriptions.${tier}`, { defaultValue: fallback });
  const planHighlights = (tier: PlanTier, fallback: string[]) => {
    const translated = t(`plans.highlights.${tier}`, { returnObjects: true }) as string[];
    return Array.isArray(translated) ? translated : fallback;
  };

  const ultimoStatus = historico[0]?.status?.toLowerCase() ?? "";
  const recusado =
    !isAdminMaster &&
    !ativoPago &&
    !aguardando &&
    !isTrialActive &&
    ["rejected", "cancelled", "refunded", "charged_back"].includes(ultimoStatus);

  async function escolherPlano(tier: PlanTier) {
    if (isAdminMaster) return;
    if (!user?.id) {
      toast.error(tp("toasts.loginToSubscribe"));
      return;
    }
    if (!(await requireOnline())) return;
    setSubmitting(tier);
    try {
      const res = await criarCheckout(tier, { periodicidade, method: metodoPagamento });
      if (!res.ok) {
        toast.error(res.reason);
        setPixCharge(null);
        return;
      }
      if (res.pendingIntegration) {
        toast.info(res.message);
        setPixCharge(null);
        return;
      }
      if (res.method === "card") {
        toast.success(tp("toasts.redirectingCard"));
        setPixCharge(null);
        await refresh();
        void listarPagamentos(user.id).then(setHistorico);
        window.location.href = res.payment.init_point;
        return;
      }
      setPixCharge({
        paymentId: res.payment.id,
        qr_code: res.payment.qr_code,
        qr_code_base64: res.payment.qr_code_base64,
        ticket_url: res.payment.ticket_url,
      });
      toast.success(tp("toasts.pixGenerated"));
      await refresh();
      void listarPagamentos(user.id).then(setHistorico);
    } catch {
      toast.error(tp("toasts.startPaymentError"));
    } finally {
      setSubmitting(null);
    }
  }


  async function checarPagamento() {
    if (!pixCharge?.paymentId || !user?.id) return;
    if (!(await requireOnline())) return;
    setVerifying(true);
    try {
      const r = await verificarPagamento(pixCharge.paymentId);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      if (r.status === "approved") {
        toast.success(tp("toasts.approvedActivated"));
        setPixCharge(null);
      } else if (["rejected", "cancelled", "expired"].includes(r.status)) {
        toast.error(tp("toasts.rejectedTryAgain"));
      } else {
        toast.info(tp("toasts.stillAnalyzing"));
      }
      await refresh();
      void listarPagamentos(user.id).then(setHistorico);
    } finally {
      setVerifying(false);
    }
  }

  async function iniciarTeste(tier: PlanTier) {
    if (isAdminMaster) return;
    if (!user?.id) {
      toast.error(tp("toasts.loginToTrial"));
      return;
    }
    if (trialUsed) {
      toast.error(tp("toasts.trialUsed"));
      return;
    }
    if (!(await requireOnline())) return;
    setSubmitting(tier);
    try {
      const { startTrial } = await import("@/lib/use-plan");
      const res = await startTrial(user.id, tier);
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success(tp("toasts.trialActivated", { plan: PLAN_LABEL[tier] }));
      await refresh();
    } catch {
      toast.error(tp("toasts.trialError"));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <MobileShell wide>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/conta"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card"
          aria-label={tp("back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {tp("eyebrow")}
          </p>
          <h1 className="text-xl font-bold tracking-tight">{vocab.controle}</h1>
        </div>
      </header>

      {/* Card do plano atual */}
      <section
        className={cn(
          "mt-6 overflow-hidden rounded-3xl border p-5 shadow-card",
          isAdminMaster
            ? "border-amber-400/40 bg-gradient-to-br from-amber-500/15 via-card to-primary/10"
            : aguardando
              ? "border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-card to-card"
              : ativoPago
                ? "border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card"
                : "border-border bg-card",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {isAdminMaster ? tp("card.accessLabel") : tp("card.currentPlanLabel")}
            </p>
            <div className="mt-1 flex items-center gap-2">
              {loading ? (
                <Sparkles className="h-5 w-5 text-muted-foreground animate-pulse" />
              ) : isAdminMaster ? (
                <Crown className="h-5 w-5 text-amber-500" />
              ) : aguardando ? (
                <Hourglass className="h-5 w-5 text-amber-500" />
              ) : (
                <Sparkles className="h-5 w-5 text-primary" />
              )}
              <h2 className="text-2xl font-bold">
                {loading
                  ? tp("card.checking")
                  : isAdminMaster
                    ? tp("card.totalAccess")
                    : aguardando
                      ? tp("card.awaitingPayment")
                      : ativoPago
                        ? planName(plan)
                        : semAssinatura
                          ? tp("card.noActiveSubscription")
                          : planName(plan)}
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {tp("card.type", { value: isAdminMaster ? tp("card.adminMaster") : tipoCadastroLabel(tipo) })}
            </p>
            {ativoPago && (
              <p className="mt-1 text-xs text-muted-foreground">
                {commercialPlanByTier(plan)?.priceLabel}
                {(activePeriodicidade ?? planoAtualPeriodo) ? tp("card.perFreq", { value: periodLabel((activePeriodicidade ?? planoAtualPeriodo) as Periodicidade) }) : ""}
                {planoAtualMetodo ? tp("card.method", { value: planoAtualMetodo.toLowerCase() === "pix" ? tp("methods.pix") : planoAtualMetodo }) : ""}
                {planoAtualTotal !== null ? tp("card.totalPaid", { value: formatBRL(planoAtualTotal) }) : ""}
              </p>
            )}
            {isAdminMaster && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                {tp("card.adminNote")}
              </p>
            )}
            {aguardando && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                {tp("card.pendingNotePrefix")}
                <strong>{planName(plan)}</strong>.
              </p>
            )}
            {ativoPago && currentPeriodStart && currentPeriodEnd && (
              <p className="mt-2 text-xs text-muted-foreground">
                {tp("card.activePeriod", {
                  start: formatDate(currentPeriodStart),
                  end: formatDate(currentPeriodEnd),
                  paid: planoAtualPagoEm ? tp("card.paidOn", { date: formatDate(planoAtualPagoEm) }) : "",
                })}
              </p>
            )}
            {expirado && (
              <p className="mt-2 text-xs text-destructive">
                {tp("card.expiredNote")}
              </p>
            )}
            {recusado && (
              <p className="mt-2 text-xs text-destructive">
                {tp("card.rejectedNote")}
              </p>
            )}
            {!isAdminMaster && semAssinatura && !recusado && (
              <p className="mt-2 text-xs text-muted-foreground">
                {tp("card.noSubNote")}
              </p>
            )}
          </div>
          {!loading && (
            <StatusBadge
              tone={STATUS_BADGE_TONE[status] ?? "muted"}
              dot
              size="md"
              className="shrink-0 uppercase tracking-wide"
            >
              {isAdminMaster ? tp("status.ativo") : tp(`status.${status}`, { defaultValue: status })}
            </StatusBadge>
          )}
        </div>

        {!isAdminMaster && isTrialActive && (
          <div className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
            <p>
              <strong>{tp("trial.activeTitle")}</strong>{tp("trial.activeRelease", { plan: planName(plan) })}
            </p>
            <p className="mt-0.5 text-primary/80">
              {tp("trial.daysLeft", { count: trialDaysLeft })}
            </p>
            {trialEndsAt && (
              <p className="mt-0.5 text-[10px] text-primary/70">
                {tp("trial.endsOn", { date: formatDate(trialEndsAt) })}
              </p>
            )}
          </div>
        )}
        {!isAdminMaster && trialEndsAt && status !== "teste" && trialUsed && !isTrialActive && (
          <p className="mt-3 rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {tp("trial.alreadyUsed")}
          </p>
        )}
        {!isAdminMaster && isCancelled && accessUntil && (
          <div className="mt-3 rounded-xl border border-muted-foreground/30 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <p>
              <strong>{tp("cancelled.title")}</strong>{tp("cancelled.untilPrefix", { date: formatDate(accessUntil) })}
            </p>
            <p className="mt-0.5">
              {tp("cancelled.after")}
            </p>
          </div>
        )}

        {isAdminMaster ? (
          <div className="mt-5">
            <Button className="w-full rounded-2xl" variant="outline" disabled>
              <Crown className="mr-2 h-4 w-4 text-amber-500" />
              {tp("actions.totalAccessGranted")}
            </Button>
          </div>
        ) : aguardando ? (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button
              className="rounded-2xl sm:flex-1"
              onClick={() => escolherPlano(plan)}
              disabled={submitting !== null}
            >
              <Hourglass className="mr-2 h-4 w-4" />
              {tp("actions.newPixCharge")}
            </Button>
          </div>
        ) : ativoPago ? (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="rounded-2xl sm:flex-1"
              onClick={() => {
                document
                  .getElementById("planos-disponiveis")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              {tp("actions.changePlan")}
            </Button>
            {!isCancelled ? (
              <Button
                variant="outline"
                className="rounded-2xl sm:flex-1 text-destructive hover:text-destructive"
                onClick={() => setCancelOpen(true)}
              >
                <XCircle className="mr-2 h-4 w-4" />
                {tp("actions.cancelSubscription")}
              </Button>
            ) : (
              <Button variant="outline" className="rounded-2xl sm:flex-1" disabled>
                {tp("actions.alreadyCancelled")}
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button
              className="rounded-2xl sm:flex-1"
              onClick={() => escolherPlano(recommended)}
              disabled={submitting !== null}
            >
              <Zap className="mr-2 h-4 w-4" />
              {expirado || recusado
                ? tp("actions.regularize", { plan: planName(recommended) })
                : tp("actions.subscribeNow", { plan: planName(recommended) })}
            </Button>
          </div>
        )}
      </section>

      {/* Cards de upgrade — recursos premium ainda não liberados no plano atual */}
      <UpgradeCardsList max={6} />


      {/* QR Code Pix — exibido após gerar cobrança */}
      {!isAdminMaster && pixCharge && (pixCharge.qr_code_base64 || pixCharge.ticket_url) && (
        <section className="mt-4 overflow-hidden rounded-3xl border border-amber-500/30 bg-amber-500/5 p-5">
          <p className="text-[11px] uppercase tracking-widest text-amber-600 dark:text-amber-400">
            {tp("pix.eyebrow")}
          </p>
          <h3 className="mt-1 text-base font-bold">{tp("pix.title")}</h3>
          {pixCharge.qr_code_base64 && (
            <img
              src={`data:image/png;base64,${pixCharge.qr_code_base64}`}
              alt={tp("pix.qrAlt")}
              className="mx-auto mt-3 h-48 w-48 rounded-xl bg-white p-2"
            />
          )}
          {pixCharge.qr_code && (
            <div className="mt-3">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {tp("pix.copyTitle")}
              </p>
              <textarea
                readOnly
                value={pixCharge.qr_code}
                className="mt-1 h-20 w-full resize-none rounded-xl border border-border bg-background p-2 text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-2 w-full rounded-xl"
                onClick={() => {
                  navigator.clipboard.writeText(pixCharge.qr_code ?? "");
                  toast.success(tp("pix.copied"));
                }}
              >
                {tp("pix.copy")}
              </Button>
            </div>
          )}
          {pixCharge.ticket_url && (
            <a
              href={pixCharge.ticket_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block rounded-xl border border-border bg-card px-3 py-2 text-center text-xs font-semibold hover:border-primary/40"
            >
              {tp("pix.openMP")}
            </a>
          )}
          {pixCharge.paymentId && (
            <Button
              size="sm"
              className="mt-3 w-full rounded-xl"
              onClick={checarPagamento}
              disabled={verifying}
            >
              {verifying ? tp("pix.verifying") : tp("pix.verify")}
            </Button>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            {tp("pix.afterApproval")}
          </p>
        </section>
      )}

      {/* Recursos */}
      <h3 className="mt-8 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {tp("sections.features")}
      </h3>
      <section className="mt-3 grid gap-2 sm:grid-cols-2">
        {PLAN_FEATURES.map((f) => {
          const allowed =
            isAdminMaster ||
            (ativoPago && planAllowsFeature(plan, f.feature));
          return (
            <div
              key={f.feature}
              className={cn(
                "rounded-2xl border p-3.5 transition-colors",
                allowed
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-border bg-card",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{f.label}</p>
                {allowed ? (
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {f.description}
              </p>
            </div>
          );
        })}
      </section>

      <h3 id="planos-disponiveis" className="mt-8 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {tp("sections.plans")}
      </h3>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PERIODICIDADES.map((p) => {
          const active = periodicidade === p.key;
          return (
            <button key={p.key} type="button" onClick={() => setPeriodicidade(p.key)}
              className={cn("relative rounded-2xl border p-3 text-left transition-colors",
                active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40")}>
              <p className="text-sm font-semibold">{periodLabel(p.key)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {p.discountPercent > 0 ? `${p.discountPercent}% off` : t("billing.noDiscount")}
              </p>
              {p.badge && (
                <span className="absolute -top-2 right-2 rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                  {periodBadge(p.key, p.badge)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(["pix", "card"] as const).map((m) => {
          const active = metodoPagamento === m;
          return (
            <button key={m} type="button" onClick={() => setMetodoPagamento(m)}
              className={cn("rounded-2xl border p-3 text-center transition-colors",
                active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40")}>
              <p className="text-sm font-semibold">{m === "pix" ? tp("methods.pix") : tp("methods.card")}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {m === "pix" ? tp("methods.pixDesc") : tp("methods.cardDesc")}
              </p>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("billing.secureInfo")}
      </p>
      <section className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {COMMERCIAL_PLANS.map((p) => {
          const isCurrent = !isAdminMaster && plan === p.tier && ativoPago;
          const isPending = !isAdminMaster && plan === p.tier && aguardando;
          const isRecommended = !isCurrent && !isPending && recommended === p.tier;
          const accessGranted = isAdminMaster || isCurrent;
          const pr = priceForPeriod(p, periodicidade);
          const translatedName = planName(p.tier);
          const translatedDescription = planDescription(p.tier, p.tagline);
          const translatedHighlights = planHighlights(p.tier, p.highlights);
          const badgeTone: StatusTone | null = isCurrent
            ? "success"
            : isPending
              ? "warning"
              : isRecommended
                ? "info"
                : null;
          const badgeLabel = isCurrent
            ? t("billing.currentPlan")
            : isPending
              ? t("billing.pendingPayment")
              : isRecommended
                ? t("billing.mostChosen")
                : null;
          return (
            <div
              key={p.tier}
              className={cn(
                "relative flex flex-col rounded-3xl border bg-card p-6 shadow-card transition-all duration-200",
                isCurrent
                  ? "border-success/50 ring-1 ring-success/25 bg-gradient-to-b from-success/5 via-card to-card"
                  : isPending
                    ? "border-warning/40 ring-1 ring-warning/20 bg-gradient-to-b from-warning/5 via-card to-card"
                    : isRecommended
                      ? "border-primary/40 ring-1 ring-primary/20 bg-gradient-to-b from-primary/5 via-card to-card hover:-translate-y-0.5 hover:border-primary/60"
                      : "border-border hover:-translate-y-0.5 hover:border-primary/40",
              )}
            >
              {/* Tag superior */}
              {badgeTone && badgeLabel && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <StatusBadge
                    tone={badgeTone}
                    dot
                    size="md"
                    className="shadow-md uppercase tracking-wider"
                  >
                    {badgeLabel}
                  </StatusBadge>
                </div>
              )}

              {/* Cabeçalho */}
              <div>
                <p className="text-base font-bold tracking-tight">{translatedName}</p>
                <p className="mt-1 text-xs text-muted-foreground min-h-[2rem]">
                  {translatedDescription}
                </p>
              </div>

              {/* Preço */}
              <div className="mt-4 border-t border-border/60 pt-4">
                <div className="flex items-baseline gap-1">
                  <span className="num text-3xl font-extrabold tracking-tight text-foreground">
                    {formatBRL(pr.totalCents)}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">
                    {periodSuffix(periodicidade)}
                  </span>
                </div>
                {pr.discountCents > 0 ? (
                  <p className="mt-1 text-[11px] font-semibold text-success">
                    {t("billing.save", { value: formatBRL(pr.discountCents), percent: pr.discountPercent })}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">{formatBRL(p.priceCents)}{periodSuffix("mensal")}</p>
                )}
              </div>

              {/* Benefícios */}
              <ul className="mt-5 flex-1 space-y-2.5">
                {translatedHighlights.map((h) => (
                  <li
                    key={h}
                    className="flex items-start gap-2 text-xs leading-relaxed text-foreground/85"
                  >
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                    <span className="break-words">{h}</span>
                  </li>
                ))}
              </ul>

              {/* Botões */}
              <div className="mt-6 space-y-2">
                {accessGranted ? (
                  <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-success/40 bg-success/10 px-4 py-2.5 text-sm font-semibold text-success min-h-11">
                    <Check className="h-4 w-4" />
                    {isAdminMaster ? t("billing.totalAccess") : t("billing.currentPlan")}
                  </div>
                ) : (
                  <Button
                    className={cn(
                      "w-full rounded-xl font-semibold min-h-11",
                      isRecommended && "bg-gradient-to-r from-primary to-primary/85 hover:opacity-90 shadow-md shadow-primary/20",
                    )}
                    disabled={submitting !== null}
                    onClick={() => escolherPlano(p.tier)}
                  >
                    {isPending
                      ? t("billing.newCharge")
                      : submitting === p.tier
                        ? t("billing.processing")
                        : t("billing.subscribe")}
                  </Button>
                )}
                {!isAdminMaster && !trialUsed && !isCurrent && !isPending && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full rounded-xl border-primary/40 text-primary hover:bg-primary/5 min-h-11"
                    disabled={submitting !== null}
                    onClick={() => iniciarTeste(p.tier)}
                  >
                    <Sparkles className="mr-2 h-3.5 w-3.5" />
                    {t("billing.trial")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </section>


      {/* Plano Gratuito com Anúncios: card informativo "Em breve" — não ativa o plano. */}
      <section className="mt-5">
        <div className="flex flex-col gap-3 rounded-3xl border border-dashed border-border bg-card/50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold">{tp("freeAds.name")}</p>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                {tp("freeAds.comingSoon")}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">{tp("freeAds.price")}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{tp("freeAds.short")}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {tp("freeAds.limitsNote")} · {tp("freeAds.noExternalAdsNote")}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled
            aria-disabled="true"
            title={tp("freeAds.disabledReason")}
            className="shrink-0 rounded-xl min-h-10"
          >
            {tp("freeAds.comingSoon")}
          </Button>
        </div>
      </section>

      {/* Investimentos: seção dedicada abaixo dos planos */}
      <section className="mt-5">
        <div className="flex flex-col gap-2 rounded-3xl border border-dashed border-border bg-card/50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold">{tp("investments.title")}</p>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                {tp("investments.soon")}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {tp("investments.desc")}
            </p>
          </div>
        </div>
      </section>

      <p className="mt-8 text-center text-[11px] text-muted-foreground">
        {tp("footer")}
      </p>

      {/* ===== Histórico de pagamentos ===== */}
      {!isAdminMaster && (
        <section className="mt-8">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {tp("sections.history")}
          </h3>
          {historico.length === 0 ? (
            <div className="mt-3">
              <PremiumEmptyState
                icon={<Receipt className="h-6 w-6" />}
                title={tp("history.empty")}
              />
            </div>
          ) : (
            <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
              <ul className="divide-y divide-border">
                {historico.map((h) => {
                  const s = statusLabelMP(h.status);
                  const badgeTone: StatusTone =
                    s.tone === "ok"
                      ? "success"
                      : s.tone === "warn"
                        ? "warning"
                        : s.tone === "danger"
                          ? "destructive"
                          : "muted";
                  const label = planName(h.plano as PlanTier) ?? h.plano;
                  const dt = h.paid_at ?? h.created_at;
                  return (
                    <li key={h.id} className="flex items-center gap-3 p-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted/40 text-muted-foreground">
                        <Receipt className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDate(dt)} ·{" "}
                          {h.method.toUpperCase()} ·{" "}
                          {(h.amount_cents / 100).toLocaleString(isEnglish ? "en-US" : "pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                          {h.periodicidade ? tp("card.perFreq", { value: periodLabel(h.periodicidade as Periodicidade) }) : ""}
                        </p>
                      </div>
                      <StatusBadge tone={badgeTone} dot className="uppercase tracking-wide">
                        {s.label}
                      </StatusBadge>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ===== Conta e privacidade ===== */}
      <section className="mt-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {tp("sections.accountPrivacy")}
        </p>
        <ZonaDeRiscoCard />
      </section>

      {user?.id && (
        <CancelarAssinaturaDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          userId={user.id}
          onCancelled={() => {
            void refresh();
          }}
        />
      )}
    </MobileShell>
  );
}
