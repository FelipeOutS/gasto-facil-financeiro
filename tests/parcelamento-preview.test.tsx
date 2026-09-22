import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...router,
  Link: (p: any) => React.createElement("a", { href: "#" }, p.children),
}));
const { GastoForm } = await import("../src/components/GastoForm");
afterEach(cleanup);
const setup = (valor = 100) =>
  render(
    <GastoForm
      initial={{
        valor,
        tipoGasto: "parcelado",
        totalParcelas: 3,
        categoriaId: "outros",
        data: "2026-09-21",
      }}
      onSubmit={() => {}}
    />,
  );
test("actual form shows remainder instead of three identical rounded installments", () => {
  setup();
  expect(screen.getByText(/1x de.*33,34.*\+.*2x de.*33,33/)).toBeTruthy();
});
test("editing draft total and count updates real preview", () => {
  setup();
  fireEvent.change(screen.getByDisplayValue("100,00"), { target: { value: "10,00" } });
  expect(screen.getByText(/1x de.*3,34.*\+.*2x de.*3,33/)).toBeTruthy();
  fireEvent.change(screen.getByDisplayValue("3"), { target: { value: "4" } });
  expect(screen.getByText(/4x de.*2,50/)).toBeTruthy();
});
test("total smaller than installment count in cents is blocked before submission", () => {
  const ui = setup(0.01);
  expect(screen.getByText(/pelo menos R\$ 0,01 por parcela/)).toBeTruthy();
  expect((ui.container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
    true,
  );
});
