import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, cleanup, waitFor, fireEvent } = await import("@testing-library/react");
let state = { enabled: false, released: false, schemaReady: true };
let writes: unknown[] = [];
const call = async ({ data }: { data: { action: string; enabled?: boolean } }) => {
  if (data.action === "set") { writes.push(data); state = { ...state, enabled: !!data.enabled }; }
  return { ...state };
};
mock.module("@tanstack/react-start", () => ({ useServerFn: () => call }));
mock.module("@/lib/pluggy/automatic.functions", () => ({ pluggyAutomatic: call }));
mock.module("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
const { PluggyAutomatic } = await import("@/components/PluggyAutomatic");
const originalConfirm = globalThis.confirm;
afterEach(() => { cleanup(); writes = []; globalThis.confirm = originalConfirm; });
test("release blocked cannot enable automatic import", async () => {
  state = { enabled: false, released: false, schemaReady: true };
  const ui = render(<PluggyAutomatic />);
  await waitFor(() => expect(ui.getByText("Ativação bloqueada até a liberação desta etapa.")).toBeTruthy());
  const toggle = ui.getByRole("switch") as HTMLButtonElement;
  expect(toggle.disabled).toBe(true);
  fireEvent.click(toggle);
  expect(writes).toHaveLength(0);
});
test("revoked release still permits withdrawing existing consent", async () => {
  state = { enabled: true, released: false, schemaReady: true };
  const ui = render(<PluggyAutomatic />);
  await waitFor(() => expect(ui.getByRole("switch").getAttribute("aria-checked")).toBe("true"));
  fireEvent.click(ui.getByRole("switch"));
  await waitFor(() => expect(writes).toEqual([{ action: "set", enabled: false, confirmed: true }]));
});
test("declining explicit consent sends no write", async () => {
  state = { enabled: false, released: true, schemaReady: true };
  globalThis.confirm = () => false;
  const ui = render(<PluggyAutomatic />);
  await waitFor(() => expect((ui.getByRole("switch") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(ui.getByRole("switch"));
  expect(writes).toHaveLength(0);
});
