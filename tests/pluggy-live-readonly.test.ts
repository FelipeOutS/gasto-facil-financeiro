import { describe, expect, it } from "vitest";
import {
  assertConnectorAllowed,
  isLiveConnectorAllowedName,
  isPluggyAllowed,
  PLUGGY_LIVE_READONLY_AUTHORIZED,
} from "@/lib/pluggy/rules";
import { readFileSync } from "node:fs";

const FELIPE = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";
const MICHAEL = "47df50ce-df1e-4c54-8fae-0ffb5105478d";

describe("Pluggy conexão real somente leitura", () => {
  it("trava de conexão real permanece desligada até aprovação do SQL", () => {
    expect(PLUGGY_LIVE_READONLY_AUTHORIZED).toBe(false);
  });

  it("com a trava desligada, banco real é recusado", () => {
    expect(() => assertConnectorAllowed({ id: 201, name: "Nubank", isSandbox: false })).toThrow("pluggy_conector_nao_sandbox");
  });

  it("com a trava liberada, só Nubank e Mercado Pago reais passam", () => {
    expect(() => assertConnectorAllowed({ id: 201, name: "Nubank", isSandbox: false }, "sandbox", true)).not.toThrow();
    expect(() => assertConnectorAllowed({ id: 202, name: "Mercado Pago", isSandbox: false }, "sandbox", true)).not.toThrow();
    expect(() => assertConnectorAllowed({ id: 203, name: "Itaú", isSandbox: false }, "sandbox", true)).toThrow("pluggy_instituicao_nao_permitida");
    expect(() => assertConnectorAllowed({ id: 204, name: "Nubank", isSandbox: null }, "sandbox", true)).toThrow("pluggy_conector_ambiente_indefinido");
    expect(() => assertConnectorAllowed({ id: 2, name: "Pluggy Bank", isSandbox: true }, "sandbox", true)).not.toThrow();
  });

  it("nomes parecidos não passam", () => {
    expect(isLiveConnectorAllowedName("Nubank Empresas")).toBe(true);
    expect(isLiveConnectorAllowedName("Nubankx")).toBe(false);
    expect(isLiveConnectorAllowedName("Mercado")).toBe(false);
  });

  it("apenas Felipe e Michael com papel owner usam a integração", () => {
    expect(isPluggyAllowed(FELIPE, ["owner"])).toBe(true);
    expect(isPluggyAllowed(MICHAEL, ["owner"])).toBe(true);
    expect(isPluggyAllowed(FELIPE, ["admin"])).toBe(false);
    expect(isPluggyAllowed("00000000-0000-0000-0000-000000000000", ["owner"])).toBe(false);
  });

  it("SQL candidato não toca gravação financeira e mantém Sandbox nas importações", () => {
    const sql = readFileSync("docs/migrations-candidate/pluggy-live-readonly.sql", "utf8");
    expect(sql).not.toMatch(/pluggy_import_apply|pluggy_assert_financial_release|pluggy_link_card/);
    expect(sql).not.toMatch(/\b(gastos|receitas|cartoes)\b/);
    expect(sql).toContain(FELIPE);
    expect(sql).toContain(MICHAEL);
  });
});
