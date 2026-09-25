import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Receita } from "../src/lib/types";

GlobalRegistrator.register();
const React = await import("react");
const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");

const addReceita = mock(async (..._args: unknown[]) => {});
const updateReceita = mock((..._args: unknown[]) => {});
mock.module("@/lib/active-account", () => ({
  useActiveAccount: () => ({ activeOwnerId: "user-1", canCreate: true }),
}));
mock.module("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
mock.module("@/lib/use-plan", () => ({
  usePlan: () => ({ plan: "pessoal_premium", isAdminMaster: false }),
}));
mock.module("@/lib/clientes", () => ({ useClientes: () => ({ ativos: [] }) }));
mock.module("@/lib/store", () => ({
  useStore: (selector: () => unknown) => selector(),
  getReceitas: () => [],
  addReceita,
  updateReceita,
}));
mock.module("@/lib/use-online-status", () => ({
  isOnline: () => true,
  requireOnline: async () => true,
}));
mock.module("@/lib/offline/offline-income-queue", () => ({
  enqueueIncome: mock(async () => {}),
}));
mock.module("@/components/ClienteSelect", () => ({ ClienteSelect: () => null }));
mock.module("@/components/RecurrenceEditor", () => ({ RecurrenceEditor: () => null }));
mock.module("sonner", () => ({ toast: { error: mock(() => {}), success: mock(() => {}) } }));

const labels: Record<string, string> = {
  salario: "Salário",
  freelance: "Freelance",
  comissao: "Comissão",
  venda: "Venda",
  reembolso: "Reembolso",
  pix: "Pix recebido",
  bonus: "Bônus",
  outros: "Outros",
};
mock.module("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key.startsWith("tipo.") ? labels[key.slice(5)] : key === "dialog.fields.tipo" ? "Tipo" : key,
    i18n: { language: "pt-BR" },
  }),
  Trans: () => null,
}));
mock.module("@/i18n", () => ({ default: { t: (key: string) => key } }));

const { ReceitaForm } = await import("../src/components/renda/ReceitaForm");

afterEach(() => {
  cleanup();
  addReceita.mockClear();
  updateReceita.mockClear();
});

test("nova renda começa em Salário e expõe todas as opções nativas", () => {
  const ui = render(<ReceitaForm mode="create" onDone={() => {}} onCancel={() => {}} />);
  const select = ui.getByLabelText("Tipo") as HTMLSelectElement;
  expect(select.tagName).toBe("SELECT");
  expect(select.value).toBe("salario");
  expect(Array.from(select.options, (option) => option.textContent)).toEqual(Object.values(labels));
});

test.each(["freelance", "comissao", "venda", "reembolso", "pix", "bonus", "outros"])(
  "permite escolher %s",
  (tipo) => {
    const ui = render(<ReceitaForm mode="create" onDone={() => {}} onCancel={() => {}} />);
    const select = ui.getByLabelText("Tipo") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: tipo } });
    expect(select.value).toBe(tipo);
  },
);

test("nova renda envia o tipo escolhido para addReceita", async () => {
  const ui = render(<ReceitaForm mode="create" preset={{ recorrente: false }} onDone={() => {}} onCancel={() => {}} />);
  fireEvent.change(ui.getByLabelText("Tipo"), { target: { value: "freelance" } });
  const inputs = ui.container.querySelectorAll("input");
  fireEvent.change(inputs[0], { target: { value: "Projeto" } });
  fireEvent.change(inputs[1], { target: { value: "100,00" } });
  fireEvent.click(ui.getByRole("button", { name: "dialog.save" }));
  await waitFor(() => expect(addReceita).toHaveBeenCalledTimes(1));
  expect(addReceita.mock.calls[0]?.[0]).toMatchObject({ tipo: "freelance" });
});

test("edição mostra o tipo salvo e envia a alteração para updateReceita", async () => {
  const receita = {
    id: "receita-1",
    descricao: "Venda antiga",
    valor: 50,
    data: "2026-09-24",
    tipo: "venda",
    recorrente: false,
    clienteId: null,
  } as Receita;
  const ui = render(<ReceitaForm mode="edit" receita={receita} onDone={() => {}} onCancel={() => {}} />);
  const select = ui.getByLabelText("Tipo") as HTMLSelectElement;
  expect(select.value).toBe("venda");
  fireEvent.change(select, { target: { value: "bonus" } });
  fireEvent.click(ui.getByRole("button", { name: "dialog.saveEdit" }));
  await waitFor(() => expect(updateReceita).toHaveBeenCalledTimes(1));
  expect(updateReceita.mock.calls[0]?.[1]).toMatchObject({ tipo: "bonus" });
});
