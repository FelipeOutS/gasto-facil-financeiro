import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Crown,
  Lock,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { usePlan } from "@/lib/use-plan";
import {
  PLAN_FEATURES,
  PLAN_LABEL,
  planSummary,
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

export const Route = createFileRoute("/meu-plano")({
  head: () => ({ meta: [{ title: "Meu plano — Gasto Fácil" }] }),
  component: MeuPlanoPage,
});

const STATUS_LABEL: Record<string, string> = {
  ativo: "Ativo",
  teste: "Em teste",
  expirado: "Expirado",
  cancelado: "Cancelado",
};

const STATUS_TONE: Record<string, string> = {
  ativo: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  teste: "border-primary/30 bg-primary/10 text-primary",
  expirado: "border-destructive/30 bg-destructive/10 text-destructive",
  cancelado: "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
};

function MeuPlanoPage() {
  const { profile } = useAuth();
  const { plan, status, trialEndsAt, loading } = usePlan();
  const tipo = (profile?.tipo_cadastro as TipoCadastro) ?? null;
  const vocab = getVocab(tipo);
  const recommended = suggestedUpgrade(plan, tipo);
  const summary = planSummary(plan);

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
          <h1 className="text-xl font-bold tracking-tight">
            {vocab.controle}
          </h1>
        </div>
      </header>

      {/* Card do plano atual */}
      <section
        className={cn(
          "mt-6 overflow-hidden rounded-3xl border p-5 shadow-card",
          plan === "admin_master"
            ? "border-amber-400/40 bg-gradient-to-br from-amber-500/15 via-card to-primary/10"
            : plan === "free"
              ? "border-border bg-card"
              : "border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Plano atual
            </p>
            <div className="mt-1 flex items-center gap-2">
              {plan === "admin_master" ? (
                <Crown className="h-5 w-5 text-amber-500" />
              ) : plan === "free" ? (
                <Star className="h-5 w-5 text-muted-foreground" />
              ) : (
                <Sparkles className="h-5 w-5 text-primary" />
              )}
              <h2 className="text-2xl font-bold">
                {loading ? "Carregando…" : PLAN_LABEL[plan]}
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Tipo: {tipoCadastroLabel(tipo)}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
              STATUS_TONE[status] ?? STATUS_TONE.ativo,
            )}
          >
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>

        {trialEndsAt && status === "teste" && (
          <p className="mt-3 rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">
            Período de teste até{" "}
            <strong>
              {new Date(trialEndsAt).toLocaleDateString("pt-BR")}
            </strong>
            .
          </p>
        )}

        <ul className="mt-4 space-y-1.5">
          {summary.highlights.map((h) => (
            <li key={h} className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-emerald-500" /> {h}
            </li>
          ))}
        </ul>

        {plan !== "admin_master" && (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button className="rounded-2xl sm:flex-1" disabled>
              <Zap className="mr-2 h-4 w-4" />
              Fazer upgrade para {PLAN_LABEL[recommended]}
            </Button>
            <span className="text-center text-[11px] text-muted-foreground sm:self-center">
              Pagamento em breve
            </span>
          </div>
        )}
      </section>

      {/* Recursos */}
      <h3 className="mt-8 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Recursos
      </h3>
      <section className="mt-3 grid gap-2 sm:grid-cols-2">
        {PLAN_FEATURES.map((f) => {
          const allowed = planAllowsFeature(plan, f.feature);
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

      {/* Tabela rápida de planos */}
      <h3 className="mt-8 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Comparar planos
      </h3>
      <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(["free", "pessoal", "mei", "empresa"] as PlanTier[]).map((p) => {
          const isCurrent = plan === p;
          const s = planSummary(p);
          return (
            <div
              key={p}
              className={cn(
                "rounded-2xl border p-4 transition-colors",
                isCurrent
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-primary/40",
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{PLAN_LABEL[p]}</p>
                {isCurrent && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    Atual
                  </span>
                )}
              </div>
              <ul className="mt-2 space-y-1">
                {s.highlights.map((h) => (
                  <li
                    key={h}
                    className="flex items-start gap-1.5 text-xs text-muted-foreground"
                  >
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <p className="mt-8 text-center text-[11px] text-muted-foreground">
        Pagamento ainda não disponível — você está visualizando a estrutura
        de planos.
      </p>
    </MobileShell>
  );
}
