import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
const React = await import("react");
const { cleanup, render, waitFor } = await import("@testing-library/react");

let user: { id: string } | null = { id: "authenticated-user" };
const getSubscription = mock(async () => {
  throw new Error("A consulta de assinatura não deveria ocorrer na prévia local");
});
mock.module("@/lib/auth-context", () => ({
  useAuth: () => ({ user, loading: false }),
}));
mock.module("@/lib/local-dev-preview", () => ({
  isLocalDevPreview: () => true,
}));
mock.module("@/lib/subscription.functions", () => ({
  getCurrentUserSubscription: getSubscription,
}));
mock.module("@/integrations/supabase/client", () => ({ supabase: {} }));

const { usePlan } = await import("../src/lib/use-plan");
let observed: ReturnType<typeof usePlan>;
function Probe() {
  observed = usePlan();
  return null;
}

afterEach(() => {
  cleanup();
  getSubscription.mockClear();
});

test("sessão real usa snapshot somente em memória e não consulta assinatura", async () => {
  user = { id: "authenticated-user" };
  render(<Probe />);
  await waitFor(() => expect(observed.active).toBe(true));
  expect(observed.plan).toBe("pessoal_premium");
  expect(observed.error).toBeNull();
  expect(getSubscription).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});

test("sem usuário autenticado, prévia não libera acesso", async () => {
  user = null;
  render(<Probe />);
  await waitFor(() => expect(observed.loading).toBe(false));
  expect(observed.active).toBe(false);
  expect(getSubscription).not.toHaveBeenCalled();
});
