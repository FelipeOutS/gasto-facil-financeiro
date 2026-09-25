import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, fireEvent, waitFor, cleanup } = await import("@testing-library/react");
let requests: any[] = [];
let errors: string[] = [];
let complete: (value: any) => void;
let reject: (error: Error) => void;
const empty = () => [];
const noop = () => {};
mock.module("@/lib/api-fetch", () => ({
  apiFetch: () => {
    throw Error("Unexpected network");
  },
}));
mock.module("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: noop },
  useTranslation: () => ({ t: (key: string) => key }),
}));
mock.module("@/lib/premium-errors", () => ({
  usePremiumApiGate: () => ({ state: { open: false }, onOpenChange: noop }),
}));
mock.module("@/components/PremiumLockModal", () => ({ PremiumLockModal: () => null }));
mock.module("sonner", () => ({
  toast: { error: (text: string) => errors.push(text), warning: noop },
}));
mock.module("@/lib/store", () => ({
  importExtratoPersistido: (input: any) => {
    requests.push(input);
    return new Promise((resolve, fail) => {
      complete = resolve;
      reject = fail;
    });
  },
  findDuplicateGastoAdvanced: noop,
  findDuplicateReceitaAdvanced: noop,
  findDuplicateTransferenciaAdvanced: noop,
  normalizeDescricao: (s: string) => s.toLowerCase().trim(),
  getCartoes: empty,
  getCategorias: empty,
  getGastos: empty,
  getReceitas: empty,
  getTransferenciasInternas: empty,
  useStore: noop,
}));
const Wrapper = ({ children }: any) => <div>{children}</div>;
mock.module("@/components/ui/dialog", () => ({
  Dialog: Wrapper,
  DialogContent: Wrapper,
  DialogHeader: Wrapper,
  DialogTitle: Wrapper,
  DialogDescription: Wrapper,
}));
mock.module("@/components/ui/select", () => ({
  Select: Wrapper,
  SelectContent: () => null,
  SelectItem: Wrapper,
  SelectTrigger: Wrapper,
  SelectValue: () => null,
}));
const { ImportExtratoDialog } = await import("../src/components/ImportExtratoDialog");
beforeEach(() => {
  requests = [];
  errors = [];
});
afterEach(cleanup);
async function review() {
  const ui = render(<ImportExtratoDialog open onOpenChange={noop} />);
  const csv =
    "Data;Descricao;Valor\n20/09/2026;Compra supermercado;-42\n20/09/2026;Salário;100\n20/09/2026;Transferência entre contas;-20\n";
  const file = new File([csv], "extrato.csv", { type: "text/csv" });
  fireEvent.change(ui.container.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
  fireEvent.click(ui.getByRole("button", { name: "Analisar arquivo" }));
  await waitFor(() => expect(ui.getByRole("button", { name: "Selecionar todos" })).toBeTruthy());
  fireEvent.click(ui.getByRole("button", { name: "Selecionar todos" }));
  return ui;
}
test("real dialog routes each movement correctly and shows success only after persisted response", async () => {
  const ui = await review();
  fireEvent.click(ui.getByRole("button", { name: "Importar 3 lançamentos" }));
  expect(requests).toHaveLength(1);
  expect(requests[0].gastos).toHaveLength(1);
  expect(requests[0].receitas).toHaveLength(1);
  expect(requests[0].transferencias).toHaveLength(1);
  expect(requests[0].gastos[0].descricao).toBe("Compra supermercado");
  expect(ui.queryByText("Importação concluída")).toBeNull();
  expect(
    (ui.getByRole("button", { name: "Confirmando importação…" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  // Database skipped two duplicate rows: count must come from confirmation, not selection.
  complete({
    gastos: [{ valor: 42 }],
    receitas: [],
    transferencias: [],
    extrato: { qtdDuplicadasIgnoradas: 2 },
    duplicados: 2,
  });
  await waitFor(() => expect(ui.getByText("1 lançamentos adicionados")).toBeTruthy());
  expect(ui.getByText("2 duplicados ignorados")).toBeTruthy();
});
test("failed persistence never concludes and retry retains batch ID", async () => {
  const ui = await review();
  fireEvent.click(ui.getByRole("button", { name: "Importar 3 lançamentos" }));
  reject(Error("INSERT failed"));
  await waitFor(() => expect(errors).toContain("Não foi possível confirmar a importação."));
  expect(ui.queryByText("Importação concluída")).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "Importar 3 lançamentos" }));
  expect(requests).toHaveLength(2);
  expect(requests[1].batchId).toBe(requests[0].batchId);
  complete({
    gastos: [{ valor: 42 }],
    receitas: [{ valor: 100 }],
    transferencias: [{ valor: 20 }],
    extrato: { qtdDuplicadasIgnoradas: 0 },
    duplicados: 0,
  });
  await waitFor(() => expect(ui.getByText("3 lançamentos adicionados")).toBeTruthy());
});
