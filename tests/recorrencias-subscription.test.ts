import { expect, test, mock } from "bun:test";

let cleanup: (() => void) | undefined;
let updates = 0;
const react = { ...(await import("react")) };
mock.module("react", () => ({
  ...react,
  useState: () => [
    0,
    () => {
      updates++;
    },
  ],
  useEffect: (effect: () => () => void) => {
    cleanup = effect();
  },
}));
mock.module("@/integrations/supabase/client", () => ({ supabase: {} }));
mock.module("@/lib/logos", () => ({ hasMerchantLogo: () => false }));
mock.module("@/lib/categories", () => ({ suggestCategoryFromText: () => undefined }));
mock.module("@/lib/store", () => ({
  getGastos: () => [],
  getCartoes: () => [],
  useStore: () => {},
  addGasto: () => {},
}));

const { useRecorrencias, hydrateRecorrencias } = await import("../src/lib/recorrencias");

test("desmontar o consumidor remove sua assinatura de atualizações", async () => {
  useRecorrencias();
  await hydrateRecorrencias(null);
  expect(updates).toBe(1);
  cleanup!();
  await hydrateRecorrencias(null);
  expect(updates).toBe(1);
  // A new screen still subscribes normally after the previous one was removed.
  useRecorrencias();
  await hydrateRecorrencias(null);
  expect(updates).toBe(2);
  cleanup!();
});
