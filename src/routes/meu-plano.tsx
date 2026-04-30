import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowLeft,
  Check,
  Crown,
  Hourglass,
  Lock,
  Sparkles,
  Zap,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { usePlan } from "@/lib/use-plan";
import {
  COMMERCIAL_PLANS,
  PLAN_FEATURES,
  PLAN_LABEL,
  commercialPlanByTier,
  planAllowsFeature,
  suggestedUpgrade,
  type PlanTier,
} from "@/lib/plans";
import {
  getVocab,
  tipoCadastroLabel,
  type TipoCadastro,
} from "@/lib/profile-utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/meu-plano")({
  head: () => ({ meta: [{ title: "Meu plano — Gasto Fácil" }] }),
  component: MeuPlanoPage,
});

const STATUS_LABEL: Record<string, string> = {
  ativo: "Ativo",
  teste: "Em teste",
  aguardando_pagamento: "Aguardando pagamento",
  expirado: "Expirado",
  cancelado: "Cancelado",
  sem_assinatura: "Sem assinatura",
};

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
  const { profile } = useAuth();
  const { plan, storedPlan, status, trialEndsAt, loading, isAdminMaster, refresh } =
    usePlan();
  const tipo = (profile?.tipo_cadastro as TipoCadastro) ?? null;
  const vocab = getVocab(tipo);
  const recommended = suggestedUpgrade(plan, tipo);
  const semAssinatura =
    !isAdminMaster &&
    (storedPlan === "sem_assinatura" || storedPlan === "free");
  const aguardando = !isAdminMaster && status === "aguardando_pagamento";
  const ativoPago =
    !isAdminMaster && status === "ativo" && !semAssinatura;

  const [submitting, setSubmitting] = useState<PlanTier | null>(null);
  const [pixCharge, setPixCharge] = useState<{
    qr_code?: string | null;
    qr_code_base64?: string | null;
    ticket_url?: string | null;
  } | null>(null);

  async function escolherPlano(tier: PlanTier) {
    if (isAdminMaster) return;
    setSubmitting(tier);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast.error("Faça login para assinar um plano.");
        return;
      }
      const res = await fetch("/api/checkout/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plano: tier, method: "pix" }),
      });
      const data = (await res.json()) as {
        pendingIntegration?: boolean;
        message?: string;
        payment?: {
          qr_code?: string | null;
          qr_code_base64?: string | null;
          ticket_url?: string | null;
        };
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Não foi possível iniciar o pagamento.");
        return;
      }
      if (data.pendingIntegration) {
        toast.info(
          "Plano selecionado. Pagamento será liberado em breve assim que a integração for concluída.",
        );
        setPixCharge(null);
      } else if (data.payment) {
        setPixCharge(data.payment);
        toast.success("Cobrança Pix gerada! Use o QR Code abaixo para pagar.");
        if (data.payment.ticket_url) {
          window.open(data.payment.ticket_url, "_blank", "noopener");
        }
      }
      await refresh();
    } catch {
      toast.error("Erro inesperado ao iniciar pagamento.");
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
              {isAdminMaster ? (
                <Crown className="h-5 w-5 text-amber-500" />
              ) : aguardando ? (
                <Hourglass className="h-5 w-5 text-amber-500" />
              ) : (
                <Sparkles className="h-5 w-5 text-primary" />
              )}
              <h2 className="text-2xl font-bold">
                {loading
                  ? "Carregando…"
                  : isAdminMaster
                    ? "Acesso total"
                    : aguardando
                      ? "Aguardando pagamento"
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
                Finalize o pagamento para liberar os recursos do plano{" "}
                <strong>{PLAN_LABEL[plan]}</strong>.
              </p>
            )}
            {!isAdminMaster && semAssinatura && (
              <p className="mt-2 text-xs text-muted-foreground">
                Escolha um dos planos abaixo para liberar todos os recursos.
              </p>
            )}
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
              STATUS_TONE[status] ?? STATUS_TONE.sem_assinatura,
            )}
          >
            {isAdminMaster ? "Ativo" : (STATUS_LABEL[status] ?? status)}
          </span>
        </div>

        {!isAdminMaster && trialEndsAt && status === "teste" && (
          <p className="mt-3 rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">
            Período de teste até{" "}
            <strong>{new Date(trialEndsAt).toLocaleDateString("pt-BR")}</strong>.
          </p>
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
            <Button variant="outline" className="rounded-2xl sm:flex-1" disabled>
              Trocar plano
            </Button>
            <Button variant="outline" className="rounded-2xl sm:flex-1" disabled>
              Cancelar assinatura
            </Button>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button
              className="rounded-2xl sm:flex-1"
              onClick={() => escolherPlano(recommended)}
              disabled={submitting !== null}
            >
              <Zap className="mr-2 h-4 w-4" />
              Assinar agora — {PLAN_LABEL[recommended]}
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

      {/* Tabela de planos comerciais (sem Free) */}
      <h3 className="mt-8 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Planos disponíveis
      </h3>
      <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {COMMERCIAL_PLANS.map((p) => {
          const isCurrent = !isAdminMaster && plan === p.tier && ativoPago;
          const isPending = !isAdminMaster && plan === p.tier && aguardando;
          return (
            <div
              key={p.tier}
              className={cn(
                "flex flex-col rounded-2xl border p-4 transition-colors",
                isCurrent
                  ? "border-primary bg-primary/5"
                  : isPending
                    ? "border-amber-500/40 bg-amber-500/5"
                    : "border-border bg-card hover:border-primary/40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{p.name}</p>
                {isCurrent && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    Atual
                  </span>
                )}
                {isPending && (
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                    Aguardando
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-base font-bold">{p.priceLabel}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {p.tagline}
              </p>
              <ul className="mt-3 space-y-1">
                {p.highlights.map((h) => (
                  <li
                    key={h}
                    className="flex items-start gap-1.5 text-xs text-muted-foreground"
                  >
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                    {h}
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <Button
                  size="sm"
                  className="w-full rounded-xl"
                  variant={isCurrent ? "outline" : "default"}
                  disabled={isAdminMaster || isCurrent || submitting !== null}
                  onClick={() => escolherPlano(p.tier)}
                >
                  {isAdminMaster
                    ? "Acesso total"
                    : isCurrent
                      ? "Plano atual"
                      : isPending
                        ? "Gerar nova cobrança"
                        : submitting === p.tier
                          ? "Gerando…"
                          : "Assinar agora"}
                </Button>
              </div>
            </div>
          );
        })}
        {/* Investimentos: card "em breve" */}
        <div className="flex flex-col rounded-2xl border border-dashed border-border bg-card/50 p-4 sm:col-span-2 xl:col-span-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Investimentos</p>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Em breve
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Estrutura preparada para acompanhar investimentos pessoais e
            empresariais nos planos Premium, MEI e Empresa.
          </p>
        </div>
      </section>

      <p className="mt-8 text-center text-[11px] text-muted-foreground">
        Pagamentos via Pix e cartão pelo Mercado Pago. A cobrança real é
        liberada assim que a integração de pagamento estiver configurada.
      </p>
    </MobileShell>
  );
}
