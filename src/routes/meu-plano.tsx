import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  getPeriodicidade,
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

const STATUS_TONE: Record<string, string> = {
  ativo: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  teste: "border-primary/30 bg-primary/10 text-primary",
  aguardando_pagamento:
    "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  expirado: "border-destructive/30 bg-destructive/10 text-destructive",
  cancelado: "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
  sem_assinatura:
    "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
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
      toast.error("Faça login para assinar.");
      return;
    }
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
        toast.success("Redirecionando para o pagamento seguro do Mercado Pago…");
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
      toast.success("Cobrança Pix gerada. Pague para ativar o plano.");
      await refresh();
      void listarPagamentos(user.id).then(setHistorico);
    } catch {
      toast.error("Erro ao iniciar pagamento.");
    } finally {
      setSubmitting(null);
    }
  }


  async function checarPagamento() {
    if (!pixCharge?.paymentId || !user?.id) return;
    setVerifying(true);
    try {
      const r = await verificarPagamento(pixCharge.paymentId);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      if (r.status === "approved") {
        toast.success("Pagamento aprovado! Plano ativado.");
        setPixCharge(null);
      } else if (["rejected", "cancelled", "expired"].includes(r.status)) {
        toast.error("Pagamento recusado. Tente novamente.");
      } else {
        toast.info("Pagamento ainda em análise. Tente novamente em instantes.");
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
      toast.error("Faça login para iniciar o teste.");
      return;
    }
    if (trialUsed) {
      toast.error("Você já utilizou o teste gratuito.");
      return;
    }
    setSubmitting(tier);
    try {
      const { startTrial } = await import("@/lib/use-plan");
      const res = await startTrial(user.id, tier);
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success(`Teste grátis ativado! ${PLAN_LABEL[tier]} liberado por 10 dias.`);
      await refresh();
    } catch {
      toast.error("Erro ao iniciar o teste.");
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
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Meu plano
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
              {isAdminMaster ? "Acesso" : "Plano atual"}
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
                  ? "Verificando assinatura…"
                  : isAdminMaster
                    ? "Acesso total"
                    : aguardando
                      ? "Aguardando pagamento"
                      : ativoPago
                        ? PLAN_LABEL[plan]
                        : semAssinatura
                          ? "Sem assinatura ativa"
                          : PLAN_LABEL[plan]}
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Tipo:{" "}
              {isAdminMaster ? "Admin Master" : tipoCadastroLabel(tipo)}
            </p>
            {ativoPago && (
              <p className="mt-1 text-xs text-muted-foreground">
                {commercialPlanByTier(plan)?.priceLabel}
                {(activePeriodicidade ?? planoAtualPeriodo) ? ` · ${getPeriodicidade((activePeriodicidade ?? planoAtualPeriodo) as Periodicidade).label}` : ""}
                {planoAtualMetodo ? ` · ${planoAtualMetodo.toLowerCase() === "pix" ? "Pix" : planoAtualMetodo}` : ""}
                {planoAtualTotal !== null ? ` · Total pago: ${formatBRL(planoAtualTotal)}` : ""}
              </p>
            )}
            {isAdminMaster && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Usuário com acesso completo. Todos os recursos atuais e futuros
                estão liberados — sem cobrança.
              </p>
            )}
            {aguardando && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Pagamento aguardando confirmação. Finalize o Pix para liberar{" "}
                <strong>{PLAN_LABEL[plan]}</strong>.
              </p>
            )}
            {ativoPago && currentPeriodStart && currentPeriodEnd && (
              <p className="mt-2 text-xs text-muted-foreground">
                Plano ativo. Início: {new Date(currentPeriodStart).toLocaleDateString("pt-BR")} ·{" "}
                Vencimento: {new Date(currentPeriodEnd).toLocaleDateString("pt-BR")}
                {planoAtualPagoEm ? ` · Pago em: ${new Date(planoAtualPagoEm).toLocaleDateString("pt-BR")}` : ""}.
              </p>
            )}
            {expirado && (
              <p className="mt-2 text-xs text-destructive">
                Plano expirado. Regularize para voltar a usar os recursos
                premium.
              </p>
            )}
            {recusado && (
              <p className="mt-2 text-xs text-destructive">
                Pagamento recusado. Tente novamente.
              </p>
            )}
            {!isAdminMaster && semAssinatura && !recusado && (
              <p className="mt-2 text-xs text-muted-foreground">
                Escolha um dos planos abaixo para liberar todos os recursos.
              </p>
            )}
          </div>
          {!loading && (
            <span
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
                STATUS_TONE[status] ?? STATUS_TONE.sem_assinatura,
              )}
            >
              {isAdminMaster ? "Ativo" : (STATUS_LABEL[status] ?? status)}
            </span>
          )}
        </div>

        {!isAdminMaster && isTrialActive && (
          <div className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
            <p>
              <strong>Teste grátis ativo</strong> — {PLAN_LABEL[plan]} liberado por 10 dias.
            </p>
            <p className="mt-0.5 text-primary/80">
              Faltam {trialDaysLeft} dia{trialDaysLeft === 1 ? "" : "s"} para o fim do teste.
            </p>
            {trialEndsAt && (
              <p className="mt-0.5 text-[10px] text-primary/70">
                Termina em {new Date(trialEndsAt).toLocaleDateString("pt-BR")}.
              </p>
            )}
          </div>
        )}
        {!isAdminMaster && trialEndsAt && status !== "teste" && trialUsed && !isTrialActive && (
          <p className="mt-3 rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Seu teste gratuito de 10 dias já foi utilizado.
          </p>
        )}
        {!isAdminMaster && isCancelled && accessUntil && (
          <div className="mt-3 rounded-xl border border-muted-foreground/30 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <p>
              <strong>Assinatura cancelada.</strong> Seu acesso premium continua até{" "}
              {new Date(accessUntil).toLocaleDateString("pt-BR")}.
            </p>
            <p className="mt-0.5">
              Depois disso, os recursos premium serão bloqueados — seus dados continuam salvos.
            </p>
          </div>
        )}

        {isAdminMaster ? (
          <div className="mt-5">
            <Button className="w-full rounded-2xl" variant="outline" disabled>
              <Crown className="mr-2 h-4 w-4 text-amber-500" />
              Acesso total liberado
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
              Gerar nova cobrança Pix
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
              Trocar plano
            </Button>
            {!isCancelled ? (
              <Button
                variant="outline"
                className="rounded-2xl sm:flex-1 text-destructive hover:text-destructive"
                onClick={() => setCancelOpen(true)}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Cancelar assinatura
              </Button>
            ) : (
              <Button variant="outline" className="rounded-2xl sm:flex-1" disabled>
                Já cancelada
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
                ? `Regularizar pagamento — ${PLAN_LABEL[recommended]}`
                : `Assinar agora — ${PLAN_LABEL[recommended]}`}
            </Button>
          </div>
        )}
      </section>

      {/* QR Code Pix — exibido após gerar cobrança */}
      {!isAdminMaster && pixCharge && (pixCharge.qr_code_base64 || pixCharge.ticket_url) && (
        <section className="mt-4 overflow-hidden rounded-3xl border border-amber-500/30 bg-amber-500/5 p-5">
          <p className="text-[11px] uppercase tracking-widest text-amber-600 dark:text-amber-400">
            Pague com Pix
          </p>
          <h3 className="mt-1 text-base font-bold">Escaneie o QR Code abaixo</h3>
          {pixCharge.qr_code_base64 && (
            <img
              src={`data:image/png;base64,${pixCharge.qr_code_base64}`}
              alt="QR Code Pix"
              className="mx-auto mt-3 h-48 w-48 rounded-xl bg-white p-2"
            />
          )}
          {pixCharge.qr_code && (
            <div className="mt-3">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Pix Copia e Cola
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
                  toast.success("Código Pix copiado!");
                }}
              >
                Copiar código Pix
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
              Abrir página de pagamento Mercado Pago
            </a>
          )}
          {pixCharge.paymentId && (
            <Button
              size="sm"
              className="mt-3 w-full rounded-xl"
              onClick={checarPagamento}
              disabled={verifying}
            >
              {verifying ? "Verificando…" : "Já paguei, verificar pagamento"}
            </Button>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            Após o pagamento ser aprovado, seu plano é ativado automaticamente.
          </p>
        </section>
      )}

      {/* Recursos */}
      <h3 className="mt-8 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Recursos
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
        Planos disponíveis
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
              <p className="text-sm font-semibold">{m === "pix" ? "Pix" : "Cartão de crédito"}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {m === "pix" ? "QR Code instantâneo" : "Até 12x no Checkout Pro"}
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
          return (
            <div
              key={p.tier}
              className={cn(
                "relative flex flex-col rounded-3xl border p-6 shadow-card transition-all duration-200",
                "bg-gradient-to-b from-card to-card/60 backdrop-blur-sm",
                isCurrent
                  ? "border-primary/60 ring-2 ring-primary/30 shadow-lg shadow-primary/10"
                  : isPending
                    ? "border-amber-500/50 ring-1 ring-amber-500/20"
                    : isRecommended
                      ? "border-primary/40 hover:border-primary/60 hover:-translate-y-0.5"
                      : "border-border/80 hover:border-primary/40 hover:-translate-y-0.5",
              )}
            >
              {/* Tag superior */}
              {(isCurrent || isPending || isRecommended) && (
                <span
                  className={cn(
                    "absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider shadow-md",
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isPending
                        ? "bg-amber-500 text-white"
                        : "bg-gradient-to-r from-primary to-primary/80 text-primary-foreground",
                  )}
                >
                  {isCurrent ? t("billing.currentPlan") : isPending ? t("billing.pendingPayment") : t("billing.mostChosen")}
                </span>
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
                  <span className="text-3xl font-extrabold tracking-tight text-foreground">
                    {formatBRL(pr.totalCents)}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">
                    {periodSuffix(periodicidade)}
                  </span>
                </div>
                {pr.discountCents > 0 ? (
                  <p className="mt-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
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
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                    <span className="break-words">{h}</span>
                  </li>
                ))}
              </ul>

              {/* Botões */}
              <div className="mt-6 space-y-2">
                {accessGranted ? (
                  <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary">
                    <Check className="h-4 w-4" />
                    {isAdminMaster ? t("billing.totalAccess") : t("billing.currentPlan")}
                  </div>
                ) : (
                  <Button
                    className={cn(
                      "w-full rounded-xl font-semibold",
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
                    className="w-full rounded-xl border-primary/40 text-primary hover:bg-primary/5"
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

      {/* Investimentos: seção dedicada abaixo dos planos */}
      <section className="mt-5">
        <div className="flex flex-col gap-2 rounded-3xl border border-dashed border-border bg-card/50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold">Investimentos</p>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                Em breve
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Estrutura preparada para acompanhar investimentos pessoais e
              empresariais nos planos Premium, MEI e Empresa.
            </p>
          </div>
        </div>
      </section>

      <p className="mt-8 text-center text-[11px] text-muted-foreground">
        Pagamentos via Pix pelo Mercado Pago. Seu plano é ativado automaticamente
        após a confirmação do pagamento.
      </p>

      {/* ===== Histórico de pagamentos ===== */}
      {!isAdminMaster && (
        <section className="mt-8">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Histórico de pagamentos
          </h3>
          {historico.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-border bg-card/50 p-5 text-center text-xs text-muted-foreground">
              Nenhum pagamento encontrado ainda.
            </div>
          ) : (
            <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
              <ul className="divide-y divide-border">
                {historico.map((h) => {
                  const s = statusLabelMP(h.status);
                  const tone =
                    s.tone === "ok"
                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                      : s.tone === "warn"
                        ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                        : s.tone === "danger"
                          ? "bg-destructive/10 text-destructive border-destructive/30"
                          : "bg-muted text-muted-foreground border-border";
                  const label = PLAN_LABEL[h.plano as PlanTier] ?? h.plano;
                  const dt = h.paid_at ?? h.created_at;
                  return (
                    <li key={h.id} className="flex items-center gap-3 p-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted/40 text-muted-foreground">
                        <Receipt className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(dt).toLocaleDateString("pt-BR")} ·{" "}
                          {h.method.toUpperCase()} ·{" "}
                          {(h.amount_cents / 100).toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                          {h.periodicidade ? ` · ${getPeriodicidade(h.periodicidade as Periodicidade).label}` : ""}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          tone,
                        )}
                      >
                        {s.label}
                      </span>
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
          Conta e privacidade
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
