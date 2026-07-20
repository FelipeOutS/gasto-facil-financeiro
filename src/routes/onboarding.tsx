import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_TYPES,
  GOALS,
  MODULES,
  recommendPlan,
  type AccountType,
  type GoalKey,
  type ModuleKey,
} from "@/lib/onboarding/types";
import { useOnboarding } from "@/lib/onboarding/use-onboarding";
import { commercialPlanByTier, PLAN_LABEL, type PlanTier } from "@/lib/plans";
import { BrandLoader } from "@/components/BrandLoader";
import i18n from "@/i18n";

export const Route = createFileRoute("/onboarding")({
  head: () => {
    const t = i18n.getFixedT(null, "onboarding");
    return { meta: [{ title: t("meta.title") }] };
  },
  component: OnboardingPage,
});

type TFn = ReturnType<typeof useTranslation>["t"];

type Step = 0 | 1 | 2 | 3 | 4 | 5;

function OnboardingPage() {
  const { t } = useTranslation("onboarding");
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const { state, loading, save } = useOnboarding();

  const [step, setStep] = useState<Step>(0);
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [goals, setGoals] = useState<GoalKey[]>([]);
  const [modules, setModules] = useState<ModuleKey[]>([]);
  const [saving, setSaving] = useState(false);

  // Auth gate manual (página é unprotected mas precisa de sessão)
  useEffect(() => {
    if (!authLoading && !session) {
      void navigate({ to: "/login" });
    }
  }, [authLoading, session, navigate]);

  // Hidrata a partir do estado salvo
  useEffect(() => {
    if (state) {
      if (state.account_type) setAccountType(state.account_type);
      if (state.goals.length) setGoals(state.goals);
      if (state.enabled_modules.length) setModules(state.enabled_modules);
    }
  }, [state]);

  const recommended: PlanTier = useMemo(
    () => recommendPlan(accountType, goals, modules),
    [accountType, goals, modules],
  );
  const recPlan = commercialPlanByTier(recommended);

  function toggleGoal(g: GoalKey) {
    setGoals((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  }
  function toggleModule(m: ModuleKey) {
    setModules((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );
  }

  async function skipAll() {
    setSaving(true);
    try {
      await save({
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
      });
      void navigate({ to: "/app" });
    } finally {
      setSaving(false);
    }
  }

  async function finish() {
    setSaving(true);
    try {
      await save({
        account_type: accountType,
        goals,
        enabled_modules: modules,
        recommended_plan: recommended,
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
      });
      setStep(5);
    } finally {
      setSaving(false);
    }
  }

  function next() {
    setStep((s) => Math.min(5, s + 1) as Step);
  }
  function back() {
    setStep((s) => Math.max(0, s - 1) as Step);
  }

  if (authLoading || loading) {
    return <BrandLoader message={t("loading")} />;
  }

  return (
    <div className="min-h-screen bg-background px-5 py-8 safe-top">
      <div className="mx-auto w-full max-w-md animate-fade-in">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-card shadow-elevated">
              <Wallet className="h-5 w-5 text-foreground" />
            </span>
            <span className="text-base font-extrabold tracking-tight">
              {t("brand")}
            </span>
          </div>
          {step > 0 && step < 5 && (
            <button
              type="button"
              onClick={skipAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("skip")}
            </button>
          )}
        </div>

        {/* Progress */}
        {step > 0 && step < 5 && (
          <div className="mb-6 flex items-center gap-1.5">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  step >= i ? "bg-primary" : "bg-card",
                )}
              />
            ))}
          </div>
        )}

        {/* Steps */}
        {step === 0 && (
          <StepWelcome onStart={() => setStep(1)} onSkip={skipAll} t={t} />
        )}

        {step === 1 && (
          <StepAccountType
            value={accountType}
            onChange={setAccountType}
            onNext={next}
            t={t}
          />
        )}

        {step === 2 && (
          <StepGoals
            value={goals}
            onToggle={toggleGoal}
            onBack={back}
            onNext={next}
            t={t}
          />
        )}

        {step === 3 && (
          <StepModules
            value={modules}
            onToggle={toggleModule}
            onBack={back}
            onNext={next}
            t={t}
          />
        )}

        {step === 4 && (
          <StepPlan
            recommended={recommended}
            recommendedLabel={recPlan?.name ?? PLAN_LABEL[recommended]}
            priceLabel={recPlan?.priceLabel ?? ""}
            highlights={recPlan?.highlights ?? []}
            onBack={back}
            onContinue={finish}
            onSeePlan={async () => {
              await finish();
              void navigate({ to: "/meu-plano" });
            }}
            saving={saving}
            t={t}
          />
        )}

        {step === 5 && (
          <StepDone
            modules={modules}
            onGoDashboard={() => navigate({ to: "/app" })}
            t={t}
          />
        )}
      </div>
    </div>
  );
}

/* ============== Steps ============== */

function StepWelcome({
  onStart,
  onSkip,
  t,
}: {
  onStart: () => void;
  onSkip: () => void;
  t: TFn;
}) {
  return (
    <div className="space-y-6">
      <div className="grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-primary/30 to-primary/5">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">
          {t("welcome.title")}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("welcome.subtitle")}
        </p>
      </div>
      <div className="space-y-3 pt-4">
        <Button size="lg" className="w-full" onClick={onStart}>
          {t("common.start")}
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="w-full"
          onClick={onSkip}
        >
          {t("skip")}
        </Button>
      </div>
    </div>
  );
}

function StepAccountType({
  value,
  onChange,
  onNext,
  t,
}: {
  value: AccountType | null;
  onChange: (v: AccountType) => void;
  onNext: () => void;
  t: TFn;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight">
          {t("accountType.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("accountType.subtitle")}
        </p>
      </div>
      <div className="space-y-3">
        {ACCOUNT_TYPES.map((at) => {
          const active = value === at.key;
          return (
            <button
              key={at.key}
              type="button"
              onClick={() => onChange(at.key)}
              className={cn(
                "w-full rounded-2xl border p-4 text-left transition-all",
                active
                  ? "border-primary bg-primary/10 shadow-elevated"
                  : "border-border bg-card hover:border-primary/40",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">
                    {t(`accountType.items.${at.key}.title` as const)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t(`accountType.items.${at.key}.description` as const)}
                  </div>
                </div>
                {active && (
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-4 w-4" />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <Button
        size="lg"
        className="w-full"
        disabled={!value}
        onClick={onNext}
      >
        {t("common.continue")} <ArrowRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  );
}

function StepGoals({
  value,
  onToggle,
  onBack,
  onNext,
  t,
}: {
  value: GoalKey[];
  onToggle: (g: GoalKey) => void;
  onBack: () => void;
  onNext: () => void;
  t: TFn;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight">
          {t("goals.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("goals.subtitle")}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {GOALS.map((g) => {
          const active = value.includes(g.key);
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => onToggle(g.key)}
              className={cn(
                "flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-all",
                active
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/40",
              )}
            >
              <span>{t(`goals.items.${g.key}` as const)}</span>
              {active && (
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Button
          size="lg"
          variant="ghost"
          className="flex-1"
          onClick={onBack}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> {t("common.back")}
        </Button>
        <Button size="lg" className="flex-1" onClick={onNext}>
          {t("common.continue")} <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function StepModules({
  value,
  onToggle,
  onBack,
  onNext,
  t,
}: {
  value: ModuleKey[];
  onToggle: (m: ModuleKey) => void;
  onBack: () => void;
  onNext: () => void;
  t: TFn;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight">
          {t("modules.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("modules.subtitle")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {MODULES.map((m) => {
          const active = value.includes(m.key);
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => onToggle(m.key)}
              className={cn(
                "rounded-xl border px-3 py-3 text-left text-sm font-medium transition-all",
                active
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span>{t(`modules.items.${m.key}` as const)}</span>
                {active && (
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Button
          size="lg"
          variant="ghost"
          className="flex-1"
          onClick={onBack}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> {t("common.back")}
        </Button>
        <Button size="lg" className="flex-1" onClick={onNext}>
          {t("common.continue")} <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function StepPlan({
  recommendedLabel,
  priceLabel,
  highlights,
  onBack,
  onContinue,
  onSeePlan,
  saving,
  t,
}: {
  recommended: PlanTier;
  recommendedLabel: string;
  priceLabel: string;
  highlights: string[];
  onBack: () => void;
  onContinue: () => void;
  onSeePlan: () => void;
  saving: boolean;
  t: TFn;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight">
          {t("plan.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("plan.subtitle")}
        </p>
      </div>

      <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 to-primary/5 p-5 shadow-elevated">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            {t("plan.recommendedTag")}
          </span>
        </div>
        <h3 className="mt-2 text-xl font-extrabold">{recommendedLabel}</h3>
        {priceLabel && (
          <div className="mt-1 text-sm text-muted-foreground">{priceLabel}</div>
        )}
        <ul className="mt-4 space-y-2">
          {highlights.slice(0, 5).map((h) => (
            <li key={h} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{h}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <Button
          size="lg"
          className="w-full"
          onClick={onSeePlan}
          disabled={saving}
        >
          {t("plan.seePlan")}
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="w-full"
          onClick={onContinue}
          disabled={saving}
        >
          {t("plan.keepCurrent")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="w-full"
          onClick={onBack}
          disabled={saving}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> {t("common.back")}
        </Button>
      </div>
    </div>
  );
}

function StepDone({
  modules,
  onGoDashboard,
  t,
}: {
  modules: ModuleKey[];
  onGoDashboard: () => void;
  t: TFn;
}) {
  const shortcuts = useMemo(() => {
    const all: { key: ModuleKey; label: string; to: string }[] = [
      { key: "gastos", label: t("done.shortcuts.gastos"), to: "/adicionar" },
      { key: "cartoes", label: t("done.shortcuts.cartoes"), to: "/cartoes" },
      { key: "contas_a_pagar", label: t("done.shortcuts.contas_a_pagar"), to: "/contas-a-pagar" },
      { key: "contas_a_receber", label: t("done.shortcuts.contas_a_receber"), to: "/contas-a-receber" },
      { key: "orcamento", label: t("done.shortcuts.orcamento"), to: "/orcamento" },
      { key: "investimentos", label: t("done.shortcuts.investimentos"), to: "/investimentos" },
    ];
    if (modules.length === 0) return all.slice(0, 4);
    return all.filter((s) => modules.includes(s.key));
  }, [modules, t]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-emerald-500/30 to-emerald-500/5">
        <Check className="h-8 w-8 text-emerald-400" />
      </div>
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight">{t("done.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("done.subtitle")}
        </p>
      </div>

      {shortcuts.length > 0 && (
        <div className="space-y-2">
          {shortcuts.map((s) => (
            <a
              key={s.key}
              href={s.to}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-primary/40"
            >
              <span>{s.label}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </a>
          ))}
        </div>
      )}

      <Button size="lg" className="w-full" onClick={onGoDashboard}>
        {t("done.goDashboard")}
      </Button>
    </div>
  );
}

