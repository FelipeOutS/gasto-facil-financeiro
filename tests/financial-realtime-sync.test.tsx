import { beforeEach, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, cleanup, waitFor, fireEvent } = await import("@testing-library/react");
type Entity = "gastos" | "receitas";
let rows: Record<Entity, any[]> = { gastos: [], receitas: [] };
let reads: any[] = [];
let channels: any[] = [];
let offlineRealtime = false;
let readError = false;
let gate: Promise<void> | null = null;
let stop: (() => void) | undefined;
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => {
      if (offlineRealtime) throw Error("Websocket unavailable");
      const channel: any = {
        name,
        listeners: [],
        removed: false,
        on: (_kind: string, filter: any, callback: () => void) => {
          channel.listeners.push({ filter, callback });
          return channel;
        },
        subscribe: (callback: any) => {
          channel.status = callback;
          return channel;
        },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel: async (channel: any) => {
      channel.removed = true;
    },
    from: (table: Entity) => {
      let owner: string | null = null;
      let softDelete = false;
      const q: any = {
        select: () => q,
        eq: (field: string, value: string) => {
          if (field === "user_id") owner = value;
          return q;
        },
        is: (field: string, value: any) => {
          expect(field).toBe("deleted_at");
          expect(value).toBeNull();
          softDelete = true;
          return q;
        },
        then: (resolve: any, reject: any) => {
          reads.push({ table, owner, softDelete });
          const snapshot = rows[table]
            .filter((r) => r.user_id === owner && (!softDelete || !r.deleted_at))
            .map((r) => ({ ...r }));
          const error = readError ? { message: "RLS/network failure" } : null;
          return (async () => {
            if (gate) await gate;
            return { data: snapshot, error };
          })().then(resolve, reject);
        },
      };
      return q;
    },
  },
}));
const store = await import("../src/lib/store");
const { startFinancialRealtimeSync, useFinancialRealtimeSync } =
  await import("../src/lib/financial-realtime-sync");
function row(id: string, owner = "A", month = 9) {
  return {
    id,
    user_id: owner,
    descricao: id,
    valor: 50,
    data: `2026-${String(month).padStart(2, "0")}-20`,
    mes: month,
    ano: 2026,
    forma_pagamento: "pix",
    invoice_month: `2026-${String(month).padStart(2, "0")}`,
    tipo_gasto: "unico",
    confirmado: true,
    tipo: "outros",
    recorrente: false,
    origem: "whatsapp",
    deleted_at: null,
  };
}
function event(table: Entity, type = "INSERT", channel = channels.at(-1)) {
  channel.listeners
    .find((x: any) => x.filter.table === table && x.filter.event === type)
    .callback({ new: { valor: 999999, user_id: "untrusted" } });
}
const settle = () => new Promise((r) => setTimeout(r, 420));
function Probe() {
  const [month, setMonth] = React.useState(9);
  const incomes = store.useStore(store.getReceitas);
  const expenses = store.useStore(store.getGastos);
  return (
    <>
      <output data-testid="income">
        {incomes.filter((r) => r.mes === month && r.ano === 2026).reduce((s, r) => s + r.valor, 0)}
      </output>
      <output data-testid="expense">{expenses.reduce((s, r) => s + r.valor, 0)}</output>
      <button onClick={() => setMonth(10)}>Outubro</button>
    </>
  );
}
beforeEach(() => {
  rows = { gastos: [], receitas: [] };
  reads = [];
  channels = [];
  offlineRealtime = false;
  readError = false;
  gate = null;
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  store.setActiveUserId(null);
  store.setActiveUserId("A");
});
afterEach(() => {
  stop?.();
  stop = undefined;
  cleanup();
  store.setActiveUserId(null);
});

test("filtered INSERTs refetch income and WhatsApp expenses and update mounted store consumers", async () => {
  const ui = render(<Probe />);
  stop = startFinancialRealtimeSync("actor", "A");
  expect(channels).toHaveLength(1);
  expect(channels[0].listeners).toHaveLength(4);
  for (const l of channels[0].listeners) {
    expect(l.filter.filter).toBe("user_id=eq.A");
    expect(l.filter.schema).toBe("public");
    expect(["INSERT", "UPDATE"]).toContain(l.filter.event);
  }
  rows.receitas = [row("income"), row("foreign", "B")];
  rows.gastos = [row("WhatsApp expense")];
  event("receitas");
  event("gastos");
  await waitFor(() => expect(ui.getByTestId("income").textContent).toBe("50"));
  expect(ui.getByTestId("expense").textContent).toBe("50");
  expect(reads).toHaveLength(2);
  expect(store.getReceitas()[0].id).toBe("income");
});
test("burst coalesces and ignores untrusted event payload", async () => {
  stop = startFinancialRealtimeSync("actor", "A");
  rows.receitas = [row("real")];
  for (let i = 0; i < 20; i++) event("receitas", i % 2 ? "UPDATE" : "INSERT");
  await settle();
  expect(reads).toHaveLength(1);
  expect(store.getReceitas()[0].valor).toBe(50);
});
test("events during SELECT produce one trailing refresh", async () => {
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  stop = startFinancialRealtimeSync("actor", "A");
  event("receitas");
  await settle();
  rows.receitas = [row("arrived-during-select")];
  event("receitas");
  event("receitas");
  release();
  gate = null;
  await settle();
  expect(reads).toHaveLength(2);
  expect(store.getReceitas()[0].id).toBe("arrived-during-select");
});
test("foreground restores both entities without websocket, and physical deletes are recovered", async () => {
  offlineRealtime = true;
  stop = startFinancialRealtimeSync("actor", "A");
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  rows.receitas = [row("background income")];
  rows.gastos = [row("background expense")];
  await settle();
  expect(reads).toHaveLength(0);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("pageshow"));
  window.dispatchEvent(new Event("online"));
  await settle();
  expect(reads).toHaveLength(2);
  expect(store.getReceitas()).toHaveLength(1);
  expect(store.getGastos()).toHaveLength(1);
  rows.gastos = [];
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(store.getGastos()).toHaveLength(0);
});
test("cleanup cancels pending timers, removes channel/listeners and ignores old callbacks", async () => {
  stop = startFinancialRealtimeSync("actor", "A");
  const old = channels[0];
  event("receitas");
  stop();
  expect(old.removed).toBe(true);
  store.setActiveUserId("B");
  event("receitas", "INSERT", old);
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(reads).toHaveLength(0);
  stop = startFinancialRealtimeSync("actor", "B");
  rows.receitas = [row("B income", "B")];
  event("receitas");
  await settle();
  expect(reads[0].owner).toBe("B");
  expect(store.getReceitas()[0].id).toBe("B income");
});
test("old callback is harmless before effect cleanup and after A-B-A session change", async () => {
  stop = startFinancialRealtimeSync("actor", "A");
  store.setActiveUserId("B");
  store.setActiveUserId("A");
  event("receitas");
  await settle();
  expect(reads).toHaveLength(0);
});
test("late SELECT cannot publish into a new generation of the same account", async () => {
  rows.receitas = [row("private-old")];
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  const pending = store.refreshReceitas();
  await Promise.resolve();
  store.setActiveUserId("B");
  store.setActiveUserId("A");
  release();
  await pending;
  expect(store.getReceitas()).toHaveLength(0);
});
test("month selection remains unchanged until user selects the other month", async () => {
  const ui = render(<Probe />);
  stop = startFinancialRealtimeSync("actor", "A");
  rows.receitas = [row("October income", "A", 10)];
  event("receitas");
  await waitFor(() => expect(store.getReceitas()).toHaveLength(1));
  expect(ui.getByTestId("income").textContent).toBe("0");
  fireEvent.click(ui.getByRole("button", { name: "Outubro" }));
  expect(ui.getByTestId("income").textContent).toBe("50");
});
test("soft-deleted income disappears on UPDATE and errors preserve last valid data", async () => {
  rows.receitas = [row("income")];
  await store.refreshReceitas();
  expect(store.getReceitas()).toHaveLength(1);
  readError = true;
  rows.receitas = [];
  await store.refreshReceitas();
  expect(store.getReceitas()).toHaveLength(1);
  readError = false;
  rows.receitas = [{ ...row("income"), deleted_at: "2026-09-24T12:00:00Z" }];
  stop = startFinancialRealtimeSync("actor", "A");
  event("receitas", "UPDATE");
  await settle();
  expect(store.getReceitas()).toHaveLength(0);
  expect(reads.every((r) => r.softDelete)).toBe(true);
});
test("concurrent refresh requests share SELECTs, SUBSCRIBED recovers missed changes", async () => {
  await Promise.all([
    store.refreshFinancialCore(),
    store.refreshFinancialCore(),
    store.refreshReceitas(),
  ]);
  expect(reads).toHaveLength(2);
  reads = [];
  rows.receitas = [row("reconnected")];
  stop = startFinancialRealtimeSync("actor", "A");
  channels[0].status("SUBSCRIBED");
  channels[0].status("SUBSCRIBED");
  await settle();
  expect(reads).toHaveLength(2);
  expect(store.getReceitas()).toHaveLength(1);
});
test("hook owns one subscription through rerender, replacement and logout", async () => {
  function Host({ actor, owner }: { actor: string | null; owner: string | null }) {
    useFinancialRealtimeSync(actor, owner);
    return null;
  }
  const ui = render(<Host actor="actor" owner="A" />);
  ui.rerender(<Host actor="actor" owner="A" />);
  expect(channels).toHaveLength(1);
  store.setActiveUserId("B");
  ui.rerender(<Host actor="actor" owner="B" />);
  expect(channels[0].removed).toBe(true);
  expect(channels).toHaveLength(2);
  ui.rerender(<Host actor={null} owner={null} />);
  expect(channels[1].removed).toBe(true);
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(reads).toHaveLength(0);
});

test("timed-out refresh releases single-flight and late results cannot overwrite a retry", async () => {
  const nativeTimeout = globalThis.setTimeout;
  let expire!: () => void;
  let release!: () => void;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  rows.receitas = [row("stale")];
  globalThis.setTimeout = ((callback: () => void, ms?: number) => {
    if (ms === 15000) {
      expire = callback;
      return nativeTimeout(() => {}, 60000);
    }
    return nativeTimeout(callback, ms);
  }) as typeof setTimeout;
  try {
    const pending = store.refreshReceitas();
    await Promise.resolve();
    expire();
    await pending;
    gate = null;
    rows.receitas = [row("fresh")];
    await store.refreshReceitas();
    release();
    await Promise.resolve();
    expect(store.getReceitas()[0].id).toBe("fresh");
    expect(reads).toHaveLength(2);
  } finally {
    globalThis.setTimeout = nativeTimeout;
    release();
  }
});

// Exercise the actual Dashboard calculations; only unrelated widgets and session shell are stubbed.
mock.module("@/lib/store", () => ({ ...store, useBootstrap: () => true }));
mock.module("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => options,
  Link: ({ children }: any) => <span>{children}</span>,
  useNavigate: () => () => {},
}));
mock.module("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "pt" } }),
  Trans: () => null,
}));
mock.module("@/lib/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "A" } }, loading: false, profile: null }),
}));
mock.module("@/lib/biometric-login", () => ({
  isLoginBioBridgeAvailable: () => false,
  isLoginBioEnabled: () => false,
  isLoginBioInProgress: () => false,
  isLoginBioUnlockRequired: () => false,
}));
mock.module("@/lib/use-mes-referencia", () => ({
  useMesReferenciaRef: () => React.useState({ mes: 9, ano: 2026 }),
}));
mock.module("@/lib/recorrencias", () => ({ useRecorrencias: () => [] }));
mock.module("@/components/AuthGate", () => ({ AuthGate: ({ children }: any) => <>{children}</> }));
mock.module("@/components/MobileShell", () => ({
  MobileShell: ({ children }: any) => <>{children}</>,
}));
mock.module("@/components/MobileMonthSummary", () => ({
  MobileMonthSummary: ({ mes, receitas, despesas, onNext }: any) => (
    <div>
      <output data-testid="dashboard-month">{mes}</output>
      <output data-testid="dashboard-income">{receitas}</output>
      <output data-testid="dashboard-expense">{despesas}</output>
      <button onClick={onNext}>Next dashboard month</button>
    </div>
  ),
}));
for (const name of [
  "CalendarioFinanceiro",
  "TransactionAvatar",
  "FluxoCaixaChart",
  "DashboardCartoesInsights",
  "SmartLimiteCard",
  "SmartMonthSummaryCard",
  "AvisoWhatsAppBanner",
  "AvisoTrialExpirandoBanner",
  "UpgradeCardsList",
  "NotificationBell",
  "DashboardAlertasBloco",
  "DashboardDicasBloco",
  "AdSlot",
  "DashboardSaudeFinanceiraCard",
  "DashboardDiagnosticoMensalCard",
  "RadarEconomicoCard",
  "AdminMasterBadge",
  "BrandLoader",
]) {
  mock.module(`@/components/${name}`, () => ({ [name]: () => null }));
}
for (const name of [
  "RadarEconomicoInteligenteCard",
  "EconomicMonthImpactCard",
  "PrimeirosPassosCard",
]) {
  mock.module(`@/components/dashboard/${name}`, () => ({ [name]: () => null }));
}
mock.module("@/components/app-v2", () => ({
  AppModuleBanner: () => null,
  AppEmptyStateVisual: () => null,
  AppActionCard: () => null,
}));
const { Route: DashboardRoute } = await import("../src/routes/app");
test("actual Dashboard updates from realtime and keeps October income outside September totals", async () => {
  // Seed one expense so Dashboard renders its financial summary rather than onboarding.
  rows.gastos = [row("seed")];
  await store.refreshGastos();
  const Dashboard = (DashboardRoute as any).component;
  const ui = render(<Dashboard />);
  stop = startFinancialRealtimeSync("actor", "A");
  rows.receitas = [row("income September"), row("income October", "A", 10)];
  rows.gastos.push(row("new WhatsApp expense"));
  event("receitas");
  event("gastos");
  await waitFor(() => expect(ui.getByTestId("dashboard-income").textContent).toBe("50"));
  expect(ui.getByTestId("dashboard-expense").textContent).toBe("100");
  expect(ui.getByTestId("dashboard-month").textContent).toBe("9");
  fireEvent.click(ui.getByRole("button", { name: "Next dashboard month" }));
  expect(ui.getByTestId("dashboard-month").textContent).toBe("10");
  expect(ui.getByTestId("dashboard-income").textContent).toBe("50");
  expect(ui.getByTestId("dashboard-expense").textContent).toBe("0");
});

test("event during an independent route SELECT performs a fresh SELECT after it", async () => {
  let release!: () => void;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  const routeRead = store.refreshReceitas();
  await Promise.resolve();
  stop = startFinancialRealtimeSync("actor", "A");
  rows.receitas = [row("after-route-read")];
  event("receitas");
  await settle();
  gate = null;
  release();
  await routeRead;
  await waitFor(() => expect(store.getReceitas()[0]?.id).toBe("after-route-read"));
  expect(reads).toHaveLength(2);
});
