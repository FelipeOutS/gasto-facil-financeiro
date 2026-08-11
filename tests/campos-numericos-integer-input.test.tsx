/**
 * Campos numéricos — digitação livre + validação só no blur.
 * Cobre a causa raiz do bug: clamp/coerção a cada tecla.
 *
 * Roda via: bun test tests/campos-numericos-integer-input.test.tsx
 */
import { describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const React = await import("react");
const { render, screen, fireEvent } = await import("@testing-library/react");
const { IntegerInput } = await import("../src/components/ui/integer-input");

function setup(props: { min: number; max: number; fallback?: number; initial: number }) {
  function Harness() {
    const [v, setV] = React.useState(props.initial);
    return React.createElement(
      "div",
      null,
      React.createElement(IntegerInput, {
        "aria-label": "campo",
        min: props.min,
        max: props.max,
        fallback: props.fallback,
        value: v,
        onValueChange: setV,
      }),
      React.createElement("output", { "data-testid": "valor" }, String(v)),
    );
  }
  render(React.createElement(Harness));
  const input = screen.getByLabelText("campo") as HTMLInputElement;
  const out = () => screen.getByTestId("valor").textContent;

  function type(text: string) {
    fireEvent.change(input, { target: { value: "" } });
    for (const ch of text) {
      fireEvent.change(input, { target: { value: input.value + ch } });
    }
  }
  const blur = () => fireEvent.blur(input);
  return { input, out, type, blur };
}

describe("IntegerInput — dia do cartão (1..31)", () => {
  it("permite digitar 24 sem o sistema alterar o valor", async () => {
    const { input, out, type, blur } = setup({ min: 1, max: 31, initial: 1 });
    type("2");
    expect(input.value).toBe("2");
    type("24");
    expect(input.value).toBe("24");
    blur();
    expect(input.value).toBe("24");
    expect(out()).toBe("24");
  });

  it("aceita todos os dias válidos", async () => {
    for (const d of [1, 2, 6, 9, 10, 11, 12, 15, 19, 20, 21, 24, 25, 29, 30, 31]) {
      const { input, out, type, blur } = setup({ min: 1, max: 31, initial: 1 });
      type(String(d));
      expect(input.value).toBe(String(d));
      blur();
      expect(out()).toBe(String(d));
    }
  });

  it("campo pode ficar vazio durante a edição", async () => {
    const { input, type } = setup({ min: 1, max: 31, initial: 31 });
    type("");
    expect(input.value).toBe("");
  });

  it("vazio no blur cai no fallback do campo", async () => {
    const { input, out, type, blur } = setup({
      min: 1,
      max: 31,
      fallback: 10,
      initial: 24,
    });
    type("");
    blur();
    expect(input.value).toBe("10");
    expect(out()).toBe("10");
  });

  it("rejeita 0, 32 e 99 no blur (clamp para a faixa)", async () => {
    for (const [entrada, esperado] of [
      ["0", "1"],
      ["32", "31"],
      ["99", "31"],
    ] as const) {
      const { input, type, blur } = setup({ min: 1, max: 31, initial: 5 });
      type(entrada);
      blur();
      expect(input.value).toBe(esperado);
    }
  });

  it("ignora caracteres não numéricos", async () => {
    const { input, type } = setup({ min: 1, max: 31, initial: 1 });
    type("2a4");
    expect(input.value).toBe("24");
  });
});

describe("IntegerInput — recorrência em meses (1..60)", () => {
  it("aceita 6 meses (caso reportado) e 1..12", async () => {
    for (let m = 1; m <= 12; m++) {
      const { input, out, type, blur } = setup({ min: 1, max: 60, fallback: 12, initial: 12 });
      type(String(m));
      expect(input.value).toBe(String(m));
      blur();
      expect(out()).toBe(String(m));
    }
  });

  it("não usa faixa de dia do mês: 60 meses é válido", async () => {
    const { input, type, blur } = setup({ min: 1, max: 60, initial: 12 });
    type("60");
    blur();
    expect(input.value).toBe("60");
  });
});

describe("IntegerInput — parcelas (2..36)", () => {
  it("permite digitar 6 parcelas e limita acima de 36 só no blur", async () => {
    const { input, type, blur } = setup({ min: 2, max: 36, fallback: 2, initial: 2 });
    type("6");
    expect(input.value).toBe("6");
    blur();
    expect(input.value).toBe("6");
    type("99");
    expect(input.value).toBe("99");
    blur();
    expect(input.value).toBe("36");
  });
});
