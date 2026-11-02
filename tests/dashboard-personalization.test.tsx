import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");
const { PersonalizedDashboard, DashboardBlock } = await import("../src/components/dashboard/PersonalizedDashboard");
const { dashboardLayoutKey } = await import("../src/lib/dashboard-layout");
afterEach(() => { cleanup(); localStorage.clear(); });
function View({ userId = "a" }: { userId?: string }) {
  return <PersonalizedDashboard key={userId} userId={userId}>
    <DashboardBlock id="radar"><p>Fluxo financeiro</p></DashboardBlock>
    <DashboardBlock id="economia"><p>Indicadores</p></DashboardBlock>
  </PersonalizedDashboard>;
}
test("hide, reorder and save survive remount; cancel discards draft", async () => {
  const view = render(<View />);
  fireEvent.click(view.getByRole("button", { name: "Personalizar Dashboard" }));
  fireEvent.click(view.getByRole("checkbox", { name: "Fluxo de caixa e resumo" }));
  fireEvent.click(view.getByRole("button", { name: "Cancelar" }));
  expect(view.getByText("Fluxo financeiro")).toBeTruthy();
  expect(localStorage.getItem(dashboardLayoutKey("a"))).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Personalizar Dashboard" }));
  fireEvent.click(view.getByRole("button", { name: "Descer Fluxo de caixa e resumo" }));
  fireEvent.click(view.getByRole("checkbox", { name: "Fluxo de caixa e resumo" }));
  fireEvent.click(view.getByRole("button", { name: "Salvar" }));
  expect(view.queryByText("Fluxo financeiro")).toBeNull();
  expect(JSON.parse(localStorage.getItem(dashboardLayoutKey("a"))!).order[0]).toBe("economia");
  view.unmount();
  const reopened = render(<View />);
  await waitFor(() => expect(reopened.queryByText("Fluxo financeiro")).toBeNull());
  reopened.rerender(<View userId="b" />);
  expect(reopened.getByText("Fluxo financeiro")).toBeTruthy();
});
test("restore is explicit and leaves another account untouched", () => {
  localStorage.setItem(dashboardLayoutKey("a"), JSON.stringify({ version: 1, order: ["economia", "radar"], hidden: ["radar"] }));
  localStorage.setItem(dashboardLayoutKey("b"), "untouched");
  const view = render(<View />);
  fireEvent.click(view.getByRole("button", { name: "Personalizar Dashboard" }));
  fireEvent.click(view.getByRole("button", { name: "Restaurar padrão" }));
  fireEvent.click(view.getByRole("button", { name: "Salvar" }));
  expect(view.getByText("Fluxo financeiro")).toBeTruthy();
  expect(localStorage.getItem(dashboardLayoutKey("b"))).toBe("untouched");
});
