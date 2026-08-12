/**
 * Editor de recorrência compartilhado (Gastos, Receitas, Contas a pagar).
 * Garante que a MESMA UI/prévia usada em Contas a pagar renderiza em Gastos.
 *
 * Roda via: bun test tests/recorrencia-editor-ui.test.tsx
 */
import { describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const React = await import("react");
const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
const { RecurrenceEditor } = await import("../src/components/RecurrenceEditor");
const { resolveOccurrenceCount } = await import("../src/lib/recurrence-date");

type End = import("../src/lib/recurrence-date").RecurrenceEnd;

function setup(interval: number, unit: string, end: End, start = "2026-08-10") {
  cleanup();
  function Harness() {
    const [rule, setRule] = React.useState({ interval, unit: unit as never });
    const [e, setE] = React.useState<End>(end);
    return React.createElement(RecurrenceEditor, {
      startDate: start,
      rule,
      onRuleChange: setRule,
      end: e,
      onEndChange: setE,
    });
  }
  return render(React.createElement(Harness));
}

describe("RecurrenceEditor — prévia visível", () => {
  it("a cada 4 meses / 6 ocorrências mostra as 4 primeiras datas + restante", () => {
    setup(4, "mes", { mode: "count", count: 6 });
    for (const d of ["10/08/2026", "10/12/2026", "10/04/2027", "10/08/2027"]) {
      expect(screen.getByText(d)).toBeTruthy();
    }
    expect(screen.queryByText("10/09/2026")).toBeNull();
    // i18n não é inicializado no ambiente de teste: a chave crua confirma o "+ N".
    expect(screen.getByText("recurrence.preview.more")).toBeTruthy();
  });

  it("intervalos dinâmicos 2/3/5/7 meses, 15 dias, 2 semanas, 2 anos", () => {
    const cases: [number, string, string[]][] = [
      [2, "mes", ["10/08/2026", "10/10/2026", "10/12/2026"]],
      [3, "mes", ["10/08/2026", "10/11/2026", "10/02/2027"]],
      [5, "mes", ["10/08/2026", "10/01/2027", "10/06/2027"]],
      [7, "mes", ["10/08/2026", "10/03/2027", "10/10/2027"]],
      [15, "dia", ["10/08/2026", "25/08/2026", "09/09/2026"]],
      [2, "semana", ["10/08/2026", "24/08/2026", "07/09/2026"]],
      [2, "ano", ["10/08/2026", "10/08/2028", "10/08/2030"]],
    ];
    for (const [interval, unit, dates] of cases) {
      setup(interval, unit, { mode: "count", count: 6 });
      for (const d of dates) expect(screen.getByText(d)).toBeTruthy();
    }
  });

  it("fim de mês (31/01) sem duplicar regras", () => {
    setup(1, "mes", { mode: "count", count: 4 }, "2027-01-31");
    for (const d of ["31/01/2027", "28/02/2027", "31/03/2027", "30/04/2027"]) {
      expect(screen.getByText(d)).toBeTruthy();
    }
  });

  it("29/02 anual", () => {
    setup(1, "ano", { mode: "count", count: 3 }, "2028-02-29");
    for (const d of ["29/02/2028", "28/02/2029", "28/02/2030"]) {
      expect(screen.getByText(d)).toBeTruthy();
    }
  });

  it("atalho não é a única opção: intervalo aceita digitação livre (18)", () => {
    setup(1, "mes", { mode: "count", count: 3 });
    const input = screen.getByLabelText("recurrence.intervalAria") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "18" } });
    fireEvent.blur(input);
    expect(screen.getByText("10/02/2028")).toBeTruthy();
  });

  it("término por data e sem data final coexistem com a contagem", () => {
    expect(
      resolveOccurrenceCount(
        "2026-08-10",
        { interval: 4, unit: "mes" },
        {
          mode: "until",
          until: "2027-08-31",
        },
      ),
    ).toBe(4);
    expect(
      resolveOccurrenceCount("2026-08-10", { interval: 4, unit: "mes" }, { mode: "forever" }),
    ).toBeGreaterThan(1);
  });
});
