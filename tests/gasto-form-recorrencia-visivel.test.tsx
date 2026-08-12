/**
 * Garante que o formulário REAL usado pela rota /manual (GastoForm) mostra
 * Único / Parcelado / Recorrente SEM precisar abrir "Mais detalhes",
 * e que ao escolher Recorrente o editor compartilhado aparece com a prévia.
 *
 * Roda via: bun test tests/gasto-form-recorrencia-visivel.test.tsx
 */
import { describe, expect, it, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const React = await import("react");
const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
const RouterMod = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...RouterMod,
  Link: (props: Record<string, unknown>) =>
    React.createElement("a", { href: "#" }, props.children as never),
}));
const { GastoForm } = await import("../src/components/GastoForm");

function setup() {
  cleanup();
  return render(React.createElement(GastoForm, { onSubmit: () => {} }));
}

describe("GastoForm — tipo de gasto fora de 'Mais detalhes'", () => {
  it("mostra Único / Parcelado / Recorrente no fluxo principal", () => {
    setup();
    expect(screen.getByText("form.tipoGasto")).toBeTruthy();
    expect(screen.getByText("form.tipoUnico")).toBeTruthy();
    expect(screen.getByText("form.tipoParcelado")).toBeTruthy();
    expect(screen.getByText("form.tipoRecorrente")).toBeTruthy();
    // "Mais detalhes" continua fechado
    expect(screen.queryByText("form.descricao")).toBeNull();
  });

  it("ao selecionar Recorrente exibe o editor compartilhado com prévia", () => {
    setup();
    fireEvent.click(screen.getByText("form.tipoRecorrente"));
    expect(screen.getByText("recurrence.everyLabel")).toBeTruthy();
    expect(screen.getByText("recurrence.end.label")).toBeTruthy();
    expect(screen.getByText("recurrence.preview.title")).toBeTruthy();
  });

  it("ao selecionar Parcelado exibe parcelas e não a recorrência", () => {
    setup();
    fireEvent.click(screen.getByText("form.tipoParcelado"));
    expect(screen.getByText("form.parcelas")).toBeTruthy();
    expect(screen.queryByText("recurrence.everyLabel")).toBeNull();
  });
});
