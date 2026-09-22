import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, cleanup, act, waitFor, fireEvent } = await import("@testing-library/react");
let counter = 0;
let user: { id: string } | null = null;
let authLoading = false;
let rolesLoading = false;
let pathname = "/manual";
let writes = false,
  basicWrites = false;
let requests: Array<{ resolve: (value: any) => void; reject: (error: Error) => void }> = [];
const navigate = mock(() => Promise.resolve());
const t = (key: string) => key;
mock.module("@/lib/auth-context", () => ({
  useAuth: () => ({ user, session: user ? { user } : null, loading: authLoading, profile: null }),
}));
mock.module("@/lib/use-roles", () => ({
  useRoles: () => ({ loading: rolesLoading, hasFullAccess: false }),
}));
mock.module("@/lib/active-account", () => ({
  useActiveAccount: () => ({
    isOwnAccount: true,
    activeOwnerId: user?.id,
    canCreate: true,
    canAdmin: true,
  }),
}));
mock.module("@/lib/subscription.functions", () => ({
  getCurrentUserSubscription: () =>
    new Promise((resolve, reject) => requests.push({ resolve, reject })),
}));
mock.module("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user } }) } },
}));
mock.module("@/lib/store", () => ({
  setStoreCanWrite: (v: boolean) => {
    writes = v;
  },
  setStoreCanWriteBasic: (v: boolean) => {
    basicWrites = v;
  },
  findPossibleDuplicate: () => null,
}));
mock.module("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  createFileRoute: () => (options: any) => ({ ...options, useSearch: () => ({}) }),
  useRouterState: ({ select }: any) => select({ location: { pathname } }),
  Link: ({ children }: any) => <span>{children}</span>,
}));
mock.module("react-i18next", () => ({ useTranslation: () => ({ t }) }));
mock.module("@/i18n", () => ({ default: { t } }));
const Passthrough = ({ children }: any) => <>{children}</>;
mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) =>
    open ? <div data-testid="subscription-modal">{children}</div> : null,
  DialogContent: Passthrough,
  DialogDescription: Passthrough,
  DialogFooter: Passthrough,
  DialogHeader: Passthrough,
  DialogTitle: Passthrough,
}));
mock.module("@/components/ui/alert-dialog", () => ({
  AlertDialog: () => null,
  AlertDialogAction: Passthrough,
  AlertDialogCancel: Passthrough,
  AlertDialogContent: Passthrough,
  AlertDialogDescription: Passthrough,
  AlertDialogFooter: Passthrough,
  AlertDialogHeader: Passthrough,
  AlertDialogTitle: Passthrough,
}));
mock.module("@/components/ui/button", () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));
mock.module("@/components/MobileShell", () => ({ MobileShell: Passthrough }));
mock.module("@/components/GastoForm", () => ({
  GastoForm: () => <div data-testid="expense-form">expense</div>,
}));
mock.module("@/components/renda/ReceitaForm", () => ({
  ReceitaForm: () => <div data-testid="income-form">income</div>,
}));
mock.module("@/components/offline/OfflineSyncStatus", () => ({ OfflineSyncStatus: () => null }));
mock.module("@/lib/offline/use-offline-sync", () => ({ syncAllForUser: async () => {} }));
mock.module("@/lib/offline/offline-expense-queue", () => ({
  enqueueExpense: async () => {},
  listExpenses: async () => [],
}));
mock.module("@/components/BrandLoader", () => ({
  BrandLoader: ({ message }: any) => <div role="status">{message ?? "loading"}</div>,
}));
mock.module("@/components/BrandMark", () => ({ BrandMark: () => null }));
mock.module("@/components/PremiumLockModal", () => ({
  PremiumLockModal: () => <div data-testid="premium-lock" />,
}));
mock.module("@/lib/onboarding/service", () => ({
  fetchOnboarding: async () => ({ onboarding_completed: true }),
}));
mock.module("@/lib/biometric-login", () => ({
  isLoginBioBridgeAvailable: () => false,
  isLoginBioEnabled: () => false,
  isLoginBioInProgress: () => false,
  isLoginBioUnlockRequired: () => false,
}));
const { usePlan } = await import("../src/lib/use-plan");
const { SubscriptionGuardProvider, useSubscriptionGuard, ensureCanWriteFinancialData } =
  await import("../src/lib/subscription-guard");
const { AuthGate } = await import("../src/components/AuthGate");
const { Route: manualRoute } = await import("../src/routes/manual");
const { Route: incomeRoute } = await import("../src/routes/renda.nova");
const Manual = (manualRoute as any).component;
const Income = (incomeRoute as any).component;
let plan: ReturnType<typeof usePlan>;
let guard: ReturnType<typeof useSubscriptionGuard>;
function Probe() {
  plan = usePlan();
  guard = useSubscriptionGuard();
  return null;
}
const app = (content: React.ReactNode = <Manual />) => (
  <SubscriptionGuardProvider>
    <Probe />
    {content}
  </SubscriptionGuardProvider>
);
const future = () => new Date(Date.now() + 86400000).toISOString();
const past = () => new Date(Date.now() - 86400000).toISOString();
const subscription = (patch: Record<string, unknown> = {}) => ({
  storedPlan: "pessoal_premium",
  plan: "pessoal_premium",
  status: "ativo",
  active: true,
  currentPeriodEnd: future(),
  trialPlan: null,
  trialEndsAt: null,
  cancelledAt: null,
  accessUntil: null,
  ...patch,
});
async function resolve(value = subscription(), index = 0) {
  await act(async () => requests[index]!.resolve(value));
}
beforeEach(() => {
  user = { id: `ui-${++counter}` };
  authLoading = false;
  rolesLoading = false;
  pathname = "/manual";
  writes = false;
  basicWrites = false;
  requests = [];
  navigate.mockClear();
  localStorage.clear();
});
afterEach(cleanup);

for (const from of ["/app/mais", "/gastos", "/renda"]) {
  for (const elapsed of [0, 5 * 60_000 + 1]) {
    test(`${from} → /app mantém resolução do gate persistente após ${elapsed}ms`, async () => {
      pathname = from;
      // MobileShell owns the outer gate; AppRoot adds another gate on /app.
      const tree = (dashboard: boolean) =>
        app(
          <AuthGate>
            {dashboard ? (
              <AuthGate>
                <div data-testid="dashboard" />
              </AuthGate>
            ) : (
              <div data-testid="origin" />
            )}
          </AuthGate>,
        );
      const ui = render(tree(false));
      await resolve();
      expect(ui.queryByTestId("origin")).not.toBeNull();
      const now = Date.now;
      try {
        Date.now = () => now() + elapsed;
        pathname = "/app";
        ui.rerender(tree(true));
        expect(ui.queryByTestId("dashboard")).not.toBeNull();
        expect(ui.queryByText("Verificando assinatura…")).toBeNull();
        expect(requests).toHaveLength(1);
        expect(guard.canWrite).toBe(true);
        expect(navigate).not.toHaveBeenCalled();
      } finally {
        Date.now = now;
      }
    });
  }
}

test("abertura direta /manual espera resposta lenta e canWriteBasic fica pendente", async () => {
  const ui = render(app());
  expect(guard.loading).toBe(true);
  expect(guard.canWriteBasic).toBe(false);
  expect(writes).toBe(false);
  expect(basicWrites).toBe(false);
  expect(ui.queryByTestId("expense-form")).toBeNull();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 70));
  });
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => guard.requireSubscription());
  expect(ui.queryByTestId("subscription-modal")).toBeNull();
  await resolve();
  expect(guard.loading).toBe(false);
  expect(guard.canWriteBasic).toBe(true);
  expect(writes).toBe(true);
  expect(basicWrites).toBe(true);
  expect(ui.queryByTestId("expense-form")).not.toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});

test("gate aninhado continua bloqueando refresh real e revogação", async () => {
  pathname = "/app";
  const ui = render(
    app(
      <AuthGate>
        <AuthGate>
          <div data-testid="dashboard" />
        </AuthGate>
      </AuthGate>,
    ),
  );
  expect(ui.queryByTestId("dashboard")).toBeNull();
  await resolve();
  expect(ui.queryByTestId("dashboard")).not.toBeNull();
  await act(async () => {
    void plan.refresh();
  });
  expect(requests).toHaveLength(2);
  expect(ui.queryByTestId("dashboard")).toBeNull();
  expect(guard.canWrite).toBe(false);
  await resolve(subscription({ status: "expirado", active: false }), 1);
  expect(ui.queryByTestId("dashboard")).toBeNull();
  expect(guard.canWrite).toBe(false);
  expect(navigate).toHaveBeenCalledWith({ to: "/meu-plano", replace: true });
});

test("Mais → Dashboard não reutiliza autorização com vigência expirada", async () => {
  pathname = "/app/mais";
  const tree = (dashboard: boolean) =>
    app(
      <AuthGate>
        {dashboard ? (
          <AuthGate>
            <div data-testid="dashboard" />
          </AuthGate>
        ) : (
          <div>Mais</div>
        )}
      </AuthGate>,
    );
  const ui = render(tree(false));
  await resolve();
  const now = Date.now;
  try {
    Date.now = () => now() + 2 * 86400000;
    pathname = "/app";
    ui.rerender(tree(true));
    expect(ui.queryByTestId("dashboard")).toBeNull();
    expect(guard.canWrite).toBe(false);
    expect(navigate).toHaveBeenCalledWith({ to: "/meu-plano", replace: true });
  } finally {
    Date.now = now;
  }
});
for (const [label, patch] of [
  ["ativo", {}],
  [
    "trial",
    {
      storedPlan: "free_ads",
      status: "teste",
      trialPlan: "pessoal_premium",
      trialEndsAt: future(),
    },
  ],
  ["cancelado vigente", { status: "cancelado", cancelledAt: past(), accessUntil: future() }],
  ["free_ads básico", { storedPlan: "free_ads", plan: "free_ads", currentPeriodEnd: null }],
] as const) {
  test(`${label}: formulário e guard liberados sem redirect`, async () => {
    const ui = render(app());
    await resolve(subscription(patch));
    expect(guard.canWriteBasic).toBe(true);
    expect(ui.queryByTestId("expense-form")).not.toBeNull();
    expect(guard.canWrite).toBe(label !== "free_ads básico");
    expect(guard.canUseFeature("importacoes")).toBe(label !== "free_ads básico");
    expect(navigate).not.toHaveBeenCalled();
  });
}
for (const status of ["expirado", "sem_assinatura", "aguardando_pagamento", "cancelado"]) {
  test(`${status} sem vigência: bloqueia e redireciona uma vez`, async () => {
    const ui = render(app());
    await resolve(subscription({ status, active: false, accessUntil: past() }));
    expect(guard.canWriteBasic).toBe(false);
    expect(plan.can("importacoes")).toBe(false);
    expect(ui.queryByTestId("expense-form")).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/meu-plano", replace: true });
    ui.rerender(app());
    ui.rerender(app());
    expect(navigate).toHaveBeenCalledTimes(1);
  });
}
test("/renda/nova aguarda carregamento antes de permitir", async () => {
  const ui = render(app(<Income />));
  expect(navigate).not.toHaveBeenCalled();
  expect(ui.queryByTestId("income-form")).toBeNull();
  await resolve();
  expect(ui.queryByTestId("income-form")).not.toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});
test("restauração de sessão não usa negação transitória", async () => {
  user = null;
  authLoading = true;
  const ui = render(app());
  expect(requests).toHaveLength(0);
  expect(guard.loading).toBe(true);
  user = { id: `restored-${counter}` };
  ui.rerender(app());
  expect(navigate).not.toHaveBeenCalled();
  authLoading = false;
  ui.rerender(app());
  expect(guard.loading).toBe(true);
  await resolve();
  expect(guard.canWrite).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
});
test("refresh real aguarda servidor e não usa cache de cinco minutos", async () => {
  render(app());
  await resolve();
  let refresh!: Promise<void>;
  await act(async () => {
    refresh = plan.refresh();
  });
  expect(requests).toHaveLength(2);
  expect(guard.loading).toBe(true);
  expect(plan.loading).toBe(true);
  expect(plan.can("importacoes")).toBe(false);
  await resolve(subscription({ status: "cancelado", accessUntil: future() }), 1);
  await refresh;
  expect(plan.isCancelled).toBe(true);
  expect(guard.canWrite).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
});
test("refresh da página com cache persistido negado espera resolução", async () => {
  localStorage.setItem(
    `gf-plan-cache:${user!.id}`,
    JSON.stringify(subscription({ status: "sem_assinatura", active: false })),
  );
  const ui = render(app());
  expect(guard.loading).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
  await resolve();
  expect(ui.queryByTestId("expense-form")).not.toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});
test("erro de consulta oferece retry sem modal ou redirect", async () => {
  const ui = render(app());
  await act(async () => requests[0]!.reject(new Error("network")));
  expect(guard.error).not.toBeNull();
  expect(guard.canWriteBasic).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  expect(ui.getByRole("alert").textContent).toContain("verificar");
  fireEvent.click(ui.getByText("Tentar novamente"));
  await resolve(subscription(), 1);
  expect(guard.error).toBeNull();
  expect(guard.canWriteBasic).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
});
test("resposta tardia da sessão anterior não autoriza outra identidade", async () => {
  const ui = render(app());
  user = { id: `other-${counter}` };
  ui.rerender(app());
  expect(guard.loading).toBe(true);
  await resolve();
  expect(guard.loading).toBe(true);
  expect(guard.canWriteBasic).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  await resolve(subscription({ status: "sem_assinatura", active: false }), 1);
  expect(guard.canWriteBasic).toBe(false);
  expect(navigate).toHaveBeenCalledTimes(1);
});
test("roles em carregamento não provocam redirecionamento", async () => {
  rolesLoading = true;
  const ui = render(app());
  await resolve();
  expect(guard.loading).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
  rolesLoading = false;
  ui.rerender(app());
  expect(guard.canWriteBasic).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
});
test("expiração com tela aberta revoga escrita sem nova consulta", async () => {
  render(app());
  await resolve(
    subscription({ status: "cancelado", accessUntil: new Date(Date.now() + 120).toISOString() }),
  );
  expect(guard.canWriteBasic).toBe(true);
  await waitFor(() => expect(guard.canWriteBasic).toBe(false));
  expect(writes).toBe(false);
  expect(basicWrites).toBe(false);
  expect(navigate).toHaveBeenCalledTimes(1);
});
test("retorno de WebView suspenso reavalia expiração via pageshow", async () => {
  render(app());
  await resolve(subscription());
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 2 * 86400000;
    await act(async () => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(guard.canWrite).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  } finally {
    Date.now = originalNow;
  }
});
test("AuthGate não monta rota premium durante abertura fria", async () => {
  pathname = "/investimentos";
  const ui = render(
    app(
      <AuthGate>
        <div data-testid="protected" />
      </AuthGate>,
    ),
  );
  expect(ui.queryByTestId("protected")).toBeNull();
  expect(ui.queryByTestId("premium-lock")).toBeNull();
  await resolve(subscription({ status: "cancelado", accessUntil: future() }));
  expect(ui.queryByTestId("protected")).not.toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});
test("AuthGate mantém erro separado de negação de assinatura", async () => {
  pathname = "/investimentos";
  const ui = render(
    app(
      <AuthGate>
        <div data-testid="protected" />
      </AuthGate>,
    ),
  );
  await act(async () => requests[0]!.reject(new Error("network")));
  expect(ui.queryByTestId("protected")).toBeNull();
  expect(ui.queryByRole("alert")).not.toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});
test("AuthGate bloqueia expirado e não repete redirect ao renderizar", async () => {
  pathname = "/investimentos";
  const content = (
    <AuthGate>
      <div data-testid="protected" />
    </AuthGate>
  );
  const ui = render(app(content));
  await resolve(subscription({ status: "expirado", active: false }));
  expect(ui.queryByTestId("protected")).toBeNull();
  expect(navigate).toHaveBeenCalledTimes(1);
  ui.rerender(app(content));
  expect(navigate).toHaveBeenCalledTimes(1);
});
test("verificação defensiva de escrita consulta servidor e aceita cancelado vigente", async () => {
  const result = ensureCanWriteFinancialData();
  await act(async () => {});
  requests[0]!.resolve(subscription({ status: "cancelado", accessUntil: future() }));
  expect(await result).toEqual({ ok: true });
});
test("verificação defensiva de escrita rejeita expirado", async () => {
  const result = ensureCanWriteFinancialData();
  await act(async () => {});
  requests[0]!.resolve(subscription({ status: "expirado", active: false }));
  expect((await result).ok).toBe(false);
});

test("revogação em refresh atualiza todos os guards montados", async () => {
  render(app());
  await resolve();
  await act(async () => {
    void plan.refresh();
  });
  expect(guard.loading).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
  await resolve(subscription({ status: "expirado", active: false }), 1);
  expect(plan.active).toBe(false);
  expect(guard.canWriteBasic).toBe(false);
  expect(navigate).toHaveBeenCalledTimes(1);
});
test("cache válido preserva fallback existente em erro de rede", async () => {
  localStorage.setItem(
    `gf-plan-cache:${user!.id}`,
    JSON.stringify(subscription({ status: "cancelado", accessUntil: future() })),
  );
  render(app());
  await act(async () => requests[0]!.reject(new Error("offline")));
  expect(guard.error).toBeNull();
  expect(guard.canWriteBasic).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
});
test("cache vencido com erro de rede não autoriza nem sugere compra", async () => {
  localStorage.setItem(
    `gf-plan-cache:${user!.id}`,
    JSON.stringify(subscription({ status: "cancelado", accessUntil: past() })),
  );
  render(app());
  await act(async () => requests[0]!.reject(new Error("offline")));
  expect(guard.error).not.toBeNull();
  expect(guard.canWriteBasic).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
});
test("desmontar e reabrir rota autorizada reutiliza resolução sem piscar plano", async () => {
  const ui = render(app());
  await resolve();
  ui.unmount();
  const reopened = render(app());
  expect(reopened.queryByTestId("expense-form")).not.toBeNull();
  expect(guard.canWriteBasic).toBe(true);
  expect(requests).toHaveLength(1);
  expect(navigate).not.toHaveBeenCalled();
});

test("rota montada durante refresh aguarda a consulta compartilhada", async () => {
  const first = render(app());
  await resolve();
  await act(async () => {
    void plan.refresh();
  });
  const second = render(app(<Income />));
  expect(second.queryByTestId("income-form")).toBeNull();
  expect(guard.loading).toBe(true);
  expect(requests).toHaveLength(2);
  await resolve(subscription(), 1);
  expect(second.queryByTestId("income-form")).not.toBeNull();
  expect(navigate).not.toHaveBeenCalled();
  first.unmount();
});
