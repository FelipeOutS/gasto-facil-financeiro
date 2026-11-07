import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, cleanup, fireEvent, act } = await import("@testing-library/react");
const error = mock(() => {});
mock.module("sonner", () => ({ toast: { error } }));
mock.module("@/components/ui/switch", () => ({ Switch: ({ checked, onCheckedChange, ...props }: any) =>
  <button {...props} role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} /> }));
const { AndroidNavigationSetting } = await import("../src/components/AndroidNavigationSetting");
afterEach(() => { cleanup(); delete window.AndroidSystemUi; error.mockClear(); });
test("não aparece no navegador ou APK antigo", () => {
  expect(render(<AndroidNavigationSetting />).container.innerHTML).toBe("");
});
test("aguarda confirmação nativa e bloqueia cliques repetidos", () => {
  const save = mock(() => {});
  window.AndroidSystemUi = { getNavigationHidden: () => false, setNavigationHidden: save };
  const ui = render(<AndroidNavigationSetting />);
  const button = ui.getByRole("switch") as HTMLButtonElement;
  fireEvent.click(button);
  fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(1);
  expect(button.getAttribute("aria-checked")).toBe("false");
  expect(button.disabled).toBe(true);
  act(() => window.dispatchEvent(new CustomEvent("android-navigation-preference", { detail: { saved: true, hidden: true } })));
  expect(button.getAttribute("aria-checked")).toBe("true");
  expect(button.disabled).toBe(false);
});
test("falha mantém preferência anterior e permite tentar novamente", () => {
  window.AndroidSystemUi = { getNavigationHidden: () => true, setNavigationHidden: () => {} };
  const ui = render(<AndroidNavigationSetting />);
  const button = ui.getByRole("switch") as HTMLButtonElement;
  fireEvent.click(button);
  act(() => window.dispatchEvent(new CustomEvent("android-navigation-preference", { detail: { saved: false, hidden: true } })));
  expect(button.getAttribute("aria-checked")).toBe("true");
  expect(button.disabled).toBe(false);
  expect(error).toHaveBeenCalledTimes(1);
});
