import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");

// Bun não entende imports `?url` do Vite: cada asset local vira o próprio caminho.
for (const path of [
  "bradesco", "banco-do-brasil", "inter", "itau-unibanco", "c6-bank", "caixa",
  "santander", "mercado-pago", "nubank", "picpay", "will-bank", "neon", "atacadao", "assai-atacadista",
]) {
  const url = `/public/logos/bancos/${path}.svg?url`;
  mock.module(url, () => ({ default: url.replace(/\?url$/, "") }));
}
for (const path of [
  "mercado-pago-simbolo", "santander-simbolo", "bradesco-simbolo",
  "banco-do-brasil-simbolo", "c6-simbolo",
]) {
  const url = `/public/logos/bancos/compact/${path}.svg?url`;
  mock.module(url, () => ({ default: url.replace(/\?url$/, "") }));
}
for (const path of [
  "mercadopago-branco", "banco-inter", "logo-santander", "Banco_Bradesco",
  "logo-caixa", "Logo_C6_Bank", "banco-do-brasil-novo",
]) {
  const url = `/public/logos/bancos/${path}.svg?url`;
  mock.module(url, () => ({ default: url.replace(/\?url$/, "") }));
}
for (const path of [
  "banco-do-brasil-mark", "mercado-pago-wordmark", "nubank-mark",
]) {
  const url = `/public/logos/bancos/card/${path}.svg?url`;
  mock.module(url, () => ({ default: url.replace(/\?url$/, "") }));
}
for (const path of [
  "adobe", "amazon", "apple", "cobasi", "coursera", "google", "ifood",
  "mercado-livre", "microsoft", "netflix", "spotify", "totalpass",
  "uber-eats", "uber", "youtube",
]) {
  const url = `/public/logos/empresas/${path}.svg?url`;
  mock.module(url, () => ({ default: url.replace(/\?url$/, "") }));
}

const { getBankLogo } = await import("@/lib/logos");
const { BrandLogo } = await import("@/components/BrandLogo");
const { getCardIdentity } = await import("@/lib/card-identity");
const { EMISSORES_CARTAO_PADRAO } = await import("@/lib/types");

describe("Identidade textual do cartão", () => {
  test.each([
    ["Nubank", "Nubank", "Nubank", null],
    ["Roxinho pessoal", "Nubank", "Roxinho pessoal", "Nubank"],
    ["Mercado Pago", "Mercado Pago", null, null],
    ["Principal", "Mercado Pago", "Principal", "Mercado Pago"],
    ["Itaú", "Itaú", null, null],
    ["Cartão salário", "Itaú", "Cartão salário", "Itaú"],
  ])("%s / %s exibe apenas papéis distintos", (name, bank, primary, secondary) => {
    const identity = getCardIdentity(name, bank);
    expect(identity.primary).toBe(primary);
    expect(identity.secondary).toBe(secondary);
    expect(identity.accessibleName).toContain(bank);
  });

  test("ignora acentos, caixa, espaços e aliases exatos sem engolir apelidos", () => {
    expect(getCardIdentity("  mercado   pago ", "Mercado Pago").wordmarkOnly).toBe(true);
    expect(getCardIdentity("Itau Unibanco", "Itaú").secondary).toBeNull();
    expect(getCardIdentity("Nu Pagamentos", "Nubank").secondary).toBeNull();
    expect(getCardIdentity("Cartão Nubank", "Nubank").secondary).toBe("Nubank");
    expect(getCardIdentity("Principal", "MP").accessibleName).toBe("Principal, Mercado Pago");
  });
});

describe("Identidade visual dos bancos", () => {
  test("todos os bancos locais e aliases resolvem um asset da marca", () => {
    for (const [slug, names] of [
      ["nubank", ["Nubank", "Nu", "Nu Pagamentos"]],
      ["mercadopago-branco", ["Mercado Pago", "MercadoPago", "MP"]],
      ["banco-inter", ["Banco Inter", "Inter"]],
      ["banco-itau", ["Itaú", "Itau", "Itaú Unibanco", "Itau Unibanco", "Banco Itaú", "Banco Itau"]],
      ["logo-santander", ["Santander"]],
      ["Banco_Bradesco", ["Bradesco"]],
      ["logo-caixa", ["Caixa", "CEF"]],
      ["banco-do-brasil", ["Banco do Brasil", "BB"]],
      ["picpay", ["PicPay"]],
      ["neon", ["Neon"]],
      ["Logo_C6_Bank", ["C6", "C6 Bank"]],
      ["will-bank", ["Will", "Will Bank"]],
      ["atacadao", ["Atacadão", "Atacadao", "Cartão Atacadão", "Cartao Atacadao"]],
      ["assai-atacadista", ["Assaí", "Assai", "Assaí Atacadista", "Assai Atacadista", "Cartão Assaí", "Cartao Assai"]],
    ] as const) {
      for (const name of names) {
        const result = getBankLogo(name);
        expect(result.slug).toBe(slug);
        expect(result.logoUrl).toStartWith("/public/logos/bancos/");
        expect(result.cardMark?.url).toStartWith("/public/logos/bancos/");
      }
    }
  });

  test("nomes desconhecidos não herdam aliases curtos por substring", () => {
    for (const name of ["Banco Xyz Inexistente", "Banco Nuvem", "Banco Simples"]) {
      expect(getBankLogo(name).logoUrl).toBeNull();
    }
  });

  test("badge preserva cor e proporção, fica centralizado e decorativo", () => {
    const markup = renderToStaticMarkup(
      createElement(BrandLogo, {
        name: "Mercado Pago",
        variant: "bank",
        bankPresentation: "badge",
      }),
    );
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("mercado-pago-simbolo.svg");
    expect(markup).toContain("object-contain");
    expect(markup).toContain("object-center");
    expect(markup).not.toContain("bank-logo-mono");
    expect(markup).not.toContain("object-left");
    const cardMarkup = renderToStaticMarkup(
      createElement(BrandLogo, { name: "Mercado Pago", variant: "bank", bankPresentation: "card", bankCardTone: "light" }),
    );
    expect(cardMarkup).toContain("mercado-pago-wordmark.svg");
    expect(cardMarkup).toContain("brightness-0 invert");
    expect(cardMarkup).not.toContain("bg-white");
    expect(cardMarkup).not.toContain("ring-1");
    const lightCardMarkup = renderToStaticMarkup(
      createElement(BrandLogo, { name: "Itaú", variant: "bank", bankPresentation: "card", bankCardTone: "dark" }),
    );
    expect(lightCardMarkup).toContain("itau-unibanco.svg");
    expect(lightCardMarkup).toContain("brightness-0");
    expect(lightCardMarkup).not.toContain("brightness-0 invert");
    expect(lightCardMarkup).not.toContain("itau-mark.png");
    const darkCardMarkup = renderToStaticMarkup(
      createElement(BrandLogo, { name: "Banco Itau", variant: "bank", bankPresentation: "card", bankCardTone: "light" }),
    );
    expect(darkCardMarkup).toContain("itau-unibanco.svg");
    expect(darkCardMarkup).toContain("brightness-0 invert");
    expect(darkCardMarkup).not.toContain("itau-mark.png");
    expect(getBankLogo("Itaú").cardMark?.url).toBe(getBankLogo("Itaú").logoUrl);
    expect(getBankLogo("Itaú").cardMark?.shape).toBe("wordmark");
  });

  test("Itaú usa o SVG fornecido sem alterar sua geometria nas apresentações", async () => {
    const svg = await Bun.file(new URL("../public/logos/bancos/itau-unibanco.svg", import.meta.url)).text();
    expect(svg).toContain('viewBox="-.041 -.072 128.131 128.154"');
    expect(svg).toContain('<g fill="#ff6101">');
    expect((svg.match(/<path\b/g) ?? []).length).toBeGreaterThan(1);
    const badge = renderToStaticMarkup(createElement(BrandLogo, {
      name: "Itaú Unibanco", variant: "bank", bankPresentation: "badge",
    }));
    expect(badge).toContain("itau-unibanco.svg");
    expect(badge).not.toContain("brightness-0");
  });

  test("emissores de varejo têm opção local e assinatura colorida no card e nas listas", async () => {
    for (const [name, asset] of [["Atacadão", "atacadao.svg"], ["Assaí Atacadista", "assai-atacadista.svg"]] as const) {
      expect(EMISSORES_CARTAO_PADRAO.some((option) => option.nome === name)).toBe(true);
      const resolved = getBankLogo(name);
      expect(resolved.logoUrl).toContain(asset);
      expect(resolved.cardMark?.url).toBe(resolved.logoUrl);
      expect(resolved.cardMark?.colorMode).toBe("original");
      for (const presentation of ["badge", "tiny", "card"] as const) {
        const markup = renderToStaticMarkup(createElement(BrandLogo, {
          name, variant: "bank", bankPresentation: presentation, bankCardTone: "light",
        }));
        expect(markup).toContain(asset);
        expect(markup).toContain("<img");
        expect(markup).not.toContain("brightness-0");
      }
      const svg = await Bun.file(new URL(`../public/logos/bancos/${asset}`, import.meta.url)).text();
      expect(svg).toContain("<svg");
      expect((svg.match(/<path\b/g) ?? []).length).toBeGreaterThan(1);
    }
  });

  test("banco desconhecido mantém uma inicial no slot sem imagem quebrada", () => {
    const markup = renderToStaticMarkup(
      createElement(BrandLogo, {
        name: "Banco Xyz Inexistente",
        variant: "bank",
        bankPresentation: "badge",
      }),
    );
    expect(markup).toContain(">B</span>");
    expect(markup).not.toContain("<img");
    const cardMarkup = renderToStaticMarkup(createElement(BrandLogo, {
      name: "Banco Xyz Inexistente", variant: "bank", bankPresentation: "card", bankCardTone: "light",
    }));
    expect(cardMarkup).toContain(">B</span>");
    expect(cardMarkup).not.toContain("<img");
  });

  test("marcas de cartão usam uma associação explícita para os 12 bancos", () => {
    expect(getBankLogo("Mercado Pago").cardMark?.url).toContain("mercado-pago-wordmark.svg");
    expect(getBankLogo("Banco do Brasil").cardMark?.url).toContain("banco-do-brasil-mark.svg");
    expect(getBankLogo("Nubank").cardMark?.url).toContain("nubank-mark.svg");
    for (const name of ["Nubank", "Mercado Pago", "Inter", "Itaú", "Santander", "Bradesco", "Caixa", "Banco do Brasil", "PicPay", "Neon", "C6 Bank", "Will Bank"]) {
      expect(getBankLogo(name).cardMark).not.toBeNull();
      expect(getBankLogo(name).cardMark?.shape).toMatch(/^(symbol|wordmark)$/);
    }
  });

  test("Mercado Pago usa a assinatura branca completa, com somente o viewBox recortado", async () => {
    const source = await Bun.file(new URL("../public/logos/bancos/mercadopago-branco.svg", import.meta.url)).text();
    const card = await Bun.file(new URL("../public/logos/bancos/card/mercado-pago-wordmark.svg", import.meta.url)).text();
    expect(card.replace('viewBox="130 112 790 201"', 'viewBox="0 0 1048.82 425.2"')).toBe(source);
    expect((card.match(/<path\b/g) ?? []).length).toBeGreaterThan(10);
    expect(card).not.toContain("<rect");
  });

  test("símbolos recortados preservam os caminhos vetoriais originais", async () => {
    for (const [cardPath, sourcePath] of [
      ["card/nubank-mark.svg", "nubank.svg"],
      ["card/banco-do-brasil-mark.svg", "banco-do-brasil.svg"],
      ["compact/santander-simbolo.svg", "santander.svg"],
      ["compact/bradesco-simbolo.svg", "bradesco.svg"],
      ["compact/c6-simbolo.svg", "c6-bank.svg"],
    ]) {
      const card = await Bun.file(new URL(`../public/logos/bancos/${cardPath}`, import.meta.url)).text();
      const source = await Bun.file(new URL(`../public/logos/bancos/${sourcePath}`, import.meta.url)).text();
      const paths = (svg: string) => [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((match) => match[1]);
      const sourcePaths = paths(source);
      expect(paths(card).length).toBeGreaterThan(0);
      for (const path of paths(card)) expect(sourcePaths).toContain(path);
    }
  });

  test("Neon mantém o asset original sem monocromatizar sua superfície", () => {
    const resolved = getBankLogo("Neon");
    expect(resolved.cardMark?.url).toBe(resolved.logoUrl);
    expect(resolved.cardMark?.colorMode).toBe("original");
    const markup = renderToStaticMarkup(createElement(BrandLogo, {
      name: "Neon", variant: "bank", bankPresentation: "card", bankCardTone: "light",
    }));
    expect(markup).toContain("neon.svg");
    expect(markup).not.toContain("brightness-0");
  });

  test("falha do símbolo compacto tenta o logo local completo", async () => {
    const initial = renderToStaticMarkup(
      createElement(BrandLogo, {
        name: "Mercado Pago",
        variant: "bank",
        bankPresentation: "badge",
      }),
    );
    expect(initial).toContain("mercado-pago-simbolo.svg");
    const { container } = render(
      createElement(BrandLogo, {
        name: "Mercado Pago",
        variant: "bank",
        bankPresentation: "badge",
      }),
    );
    const image = container.querySelector("img");
    if (image?.getAttribute("src")?.includes("mercado-pago-simbolo.svg")) {
      fireEvent.error(image);
    }
    await waitFor(() => {
      expect(container.querySelector("img")?.getAttribute("src")).toContain("mercado-pago.svg");
    });
    cleanup();
  });

  test("botão Ver fatura mantém alvo de toque e contraste por superfície", async () => {
    const src = await Bun.file(new URL("../src/routes/cartoes.index.tsx", import.meta.url)).text();
    expect(src).toContain("inline-flex h-11 items-center");
    expect(src).toContain('theme.logoTone === "dark" ? "border-black/30 bg-black/10');
  });
});
