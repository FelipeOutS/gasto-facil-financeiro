import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, cleanup, fireEvent, act, waitFor } = await import("@testing-library/react");
let pathname = "/app";
const navigations: string[] = [];
let commit = true;
mock.module("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname }),
  Link: ({ to, onClick, preload, activeOptions, children, ...props }: any) => (
    <a
      href={to}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) {
          navigations.push(to);
          if (commit) pathname = to;
        }
        e.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));
mock.module("@/lib/contas-alertas", () => ({ useAlertaContas: () => "nenhum" }));
mock.module("@/lib/product-analytics", () => ({
  PRODUCT_EVENTS: { navClick: "nav_click" },
  trackProductEvent: () => {},
}));
mock.module("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const { BottomNav, mobileTabIndex, MOBILE_TABS } = await import("../src/components/BottomNav");
beforeEach(() => {
  pathname = "/app";
  commit = true;
  navigations.length = 0;
  Object.defineProperty(window, "innerHeight", { value: 800, writable: true, configurable: true });
});
afterEach(cleanup);
test("Dashboard aponta /app e / público não fica ativo", () => {
  const ui = render(<BottomNav />);
  expect(ui.getByLabelText("items.dashboard").getAttribute("href")).toBe("/app");
  expect(mobileTabIndex("/")).toBe(-1);
});
for (const [path, index] of [
  ["/app", 0],
  ["/app/", 0],
  ["/gastos", 1],
  ["/gastos/123", 1],
  ["/renda/nova", 2],
  ["/cartoes/123", 3],
  ["/app/mais", 4],
  ["/app/mais/", 4],
  ["/gastos-extra", -1],
  ["/app/perfil", -1],
] as const) {
  test(`estado ativo: ${path}`, () => expect(mobileTabIndex(path)).toBe(index));
}
test("cada aba recebe um clique e uma navegação", () => {
  const ui = render(<BottomNav />);
  for (const item of MOBILE_TABS) {
    fireEvent.click(ui.getByLabelText(`items.${item.labelKey}`));
    ui.rerender(<BottomNav />);
    expect(navigations.at(-1)).toBe(item.to);
    expect(ui.getByLabelText(`items.${item.labelKey}`).getAttribute("aria-current")).toBe("page");
  }
  expect(navigations).toHaveLength(5);
});
test("rota lenta/falha não deixa estado otimista preso nem bloqueia nova tentativa", () => {
  commit = false;
  const ui = render(<BottomNav />);
  fireEvent.click(ui.getByLabelText("items.gastos"));
  ui.rerender(<BottomNav />);
  expect(ui.getByLabelText("items.dashboard").getAttribute("aria-current")).toBe("page");
  expect(ui.getByLabelText("items.gastos").getAttribute("aria-current")).toBeNull();
  fireEvent.click(ui.getByLabelText("items.gastos"));
  expect(navigations).toEqual(["/gastos", "/gastos"]);
});
test("tocar Gastos em detalhe navega ao índice em uma ação", () => {
  pathname = "/gastos/123";
  const ui = render(<BottomNav />);
  fireEvent.click(ui.getByLabelText("items.gastos"));
  expect(pathname).toBe("/gastos");
  expect(navigations).toHaveLength(1);
});
test("voltar/avançar/refresh seguem localização sem estado otimista", () => {
  const ui = render(<BottomNav />);
  for (const next of ["/gastos", "/renda", "/gastos", "/renda", "/app"]) {
    pathname = next;
    ui.rerender(<BottomNav />);
    expect(ui.container.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(next);
  }
  ui.unmount();
  const refreshed = render(<BottomNav />);
  expect(refreshed.getByLabelText("items.dashboard").getAttribute("aria-current")).toBe("page");
});
test("indicador é único e muda por transform; não há controles interativos aninhados", () => {
  const ui = render(<BottomNav />);
  const indicator = ui.container.querySelector(".mobile-nav-indicator") as HTMLElement;
  pathname = "/cartoes";
  ui.rerender(<BottomNav />);
  expect(ui.container.querySelector(".mobile-nav-indicator")).toBe(indicator);
  expect(indicator.style.transform).toContain("300%");
  expect(ui.container.querySelector("a button, button a")).toBeNull();
  expect(ui.container.querySelectorAll("a")).toHaveLength(5);
});
test("teclado por adjustResize oculta a barra e fechar restaura sem toque extra", async () => {
  const ui = render(
    <>
      <input aria-label="search" />
      <BottomNav />
    </>,
  );
  const input = ui.getByLabelText("search");
  await act(async () => {
    input.focus();
    window.innerHeight = 490;
    window.dispatchEvent(new Event("resize"));
  });
  await waitFor(() => expect(ui.container.querySelector("nav")?.hidden).toBe(true));
  await act(async () => {
    window.innerHeight = 800;
    window.dispatchEvent(new Event("resize"));
  });
  await waitFor(() => expect(ui.container.querySelector("nav")?.hidden).toBe(false));
  fireEvent.click(ui.getByLabelText("items.gastos"));
  expect(navigations).toEqual(["/gastos"]);
});
test("scroll sem input não esconde a navegação", async () => {
  const ui = render(<BottomNav />);
  await act(async () => {
    window.innerHeight = 600;
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));
  });
  expect(ui.container.querySelector("nav")?.hidden).toBe(false);
});
