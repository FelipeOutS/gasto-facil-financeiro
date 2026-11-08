import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, cleanup } = await import("@testing-library/react");
const getCartoes = mock(() => []);
mock.module("@/lib/store", () => ({
  getCartoes,
  getCategoriaById: () => undefined,
  getGastos: () => [],
}));
const translate = (key: string) => key;
const i18next = await import("react-i18next");
mock.module("react-i18next", () => ({ ...i18next, useTranslation: () => ({ t: translate }) }));
const { GastosExportDialog } = await import("../src/components/GastosExportDialog");
afterEach(() => { cleanup(); getCartoes.mockClear(); });

test("exportação fechada não prepara dados; abre com dados atuais e recalcula ao reabrir", () => {
  const props = { open: false, onOpenChange: () => {}, filtrados: [], doPeriodo: [], periodLabel: "Novembro" };
  const ui = render(<GastosExportDialog {...props} />);
  ui.rerender(<GastosExportDialog {...props} filtrados={[]} />);
  expect(getCartoes).toHaveBeenCalledTimes(0);
  ui.rerender(<GastosExportDialog {...props} open />);
  expect(getCartoes).toHaveBeenCalledTimes(1);
  ui.rerender(<GastosExportDialog {...props} />);
  ui.rerender(<GastosExportDialog {...props} filtrados={[]} />);
  expect(getCartoes).toHaveBeenCalledTimes(1);
  ui.rerender(<GastosExportDialog {...props} open />);
  expect(getCartoes).toHaveBeenCalledTimes(2);
});
