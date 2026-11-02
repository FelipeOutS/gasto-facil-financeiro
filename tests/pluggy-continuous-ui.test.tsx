import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, cleanup, waitFor, fireEvent } = await import("@testing-library/react");
import type { ContinuousState } from "../src/lib/pluggy/continuous.functions";
let writes: Record<string, unknown>[] = [];
const base: ContinuousState = {
  released: false,
  schemaReady: true,
  accounts: [{ account_id: "a", name: "MP", type: "BANK" }],
  categories: [],
  history: [],
  policies: [
    {
      account_id: "a",
      enabled: true,
      kinds: ["interest"],
      categoria_id: null,
      max_transaction: 10,
      max_daily_amount: 20,
      max_daily_count: 2,
      revision: 1,
      expires_at: "2026-12-01",
    },
  ],
};
let state = structuredClone(base);
const call = async ({ data }: { data: Record<string, unknown> }) => {
  if (data.action !== "status") writes.push(data);
  return structuredClone(state);
};
mock.module("@tanstack/react-start", () => ({ useServerFn: () => call }));
mock.module("@/lib/pluggy/continuous.functions", () => ({ pluggyContinuous: call }));
mock.module("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
const { PluggyContinuous } = await import("@/components/PluggyContinuous");
const original = globalThis.confirm;
afterEach(() => {
  cleanup();
  writes = [];
  state = structuredClone(base);
  globalThis.confirm = original;
});
test("blocked release prevents new activation but preserves pause", async () => {
  const ui = render(<PluggyContinuous />);
  await waitFor(() => expect(ui.getByText("Pausar agora")).toBeTruthy());
  expect((ui.getByText("Confirmar política") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(ui.getByText("Pausar agora"));
  await waitFor(() =>
    expect(writes[0]).toMatchObject({
      action: "set",
      enabled: false,
      kinds: ["interest"],
      maxTransaction: 10,
    }),
  );
});
test("invalid draft limits do not prevent withdrawing saved consent", async () => {
  state.released = true;
  const ui = render(<PluggyContinuous />);
  await waitFor(() => expect(ui.getByLabelText("Por movimentação (R$)")).toBeTruthy());
  fireEvent.change(ui.getByLabelText("Por movimentação (R$)"), { target: { value: "0" } });
  fireEvent.click(ui.getByText("Pausar agora"));
  await waitFor(() => expect(writes[0]).toMatchObject({ enabled: false, maxTransaction: 10 }));
});
test("declining consent does not save policy", async () => {
  state.released = true;
  globalThis.confirm = () => false;
  const ui = render(<PluggyContinuous />);
  await waitFor(() => expect(ui.getByText("Confirmar política")).toBeTruthy());
  fireEvent.click(ui.getByText("Confirmar política"));
  expect(writes).toHaveLength(0);
});
