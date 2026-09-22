import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandMark } from "../src/components/BrandMark";
import { BrandLoader } from "../src/components/BrandLoader";

for (const [variant, name] of [
  ["full", "logo-gasto-inteligente-completo"],
  ["login", "logo-gasto-inteligente-login"],
  ["sidebar", "logo-gasto-inteligente-sidebar"],
  ["symbol", "icone-gasto-inteligente"],
] as const) {
  test(`marca oficial ${variant} acompanha os dois temas`, () => {
    const html = renderToStaticMarkup(<BrandMark variant={variant} />);
    expect(html).toContain(`${name}-light.svg`);
    expect(html).toContain(`${name}-dark.svg`);
    expect(html).not.toContain(".png");
  });
}
test("superfície pública clara não herda logo branco do tema escuro", () => {
  const html = renderToStaticMarkup(<BrandMark variant="full" appearance="light" />);
  expect(html).toContain("completo-light.svg");
  expect(html).not.toContain("completo-dark.svg");
});
test("backdrop nativo usa símbolo, mensagem discreta e nenhum controle de biometria", () => {
  const html = renderToStaticMarkup(<BrandLoader message="Confirme sua identidade no Android." />);
  expect(html).toContain("icone-gasto-inteligente-dark.svg");
  expect(html).toContain("icone-gasto-inteligente-light.svg");
  expect(html).toContain('role="status"');
  expect(html).not.toContain("<button");
  expect(html).not.toContain("Fingerprint");
});
