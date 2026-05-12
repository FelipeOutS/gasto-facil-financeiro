import { createFileRoute } from "@tanstack/react-router";
import { PublicLanding } from "@/components/landing/PublicLanding";

// Landing pública: acessível tanto para usuários deslogados quanto logados.
// Não usa AuthGate — mostra sempre a landing institucional do Gasto Inteligente.
export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      { title: "Gasto Inteligente — Controle financeiro simples, visual e inteligente" },
      {
        name: "description",
        content:
          "Conheça o Gasto Inteligente: gastos, cartões, contas, metas, renda, investimentos e recursos para MEI e empresa em um só lugar.",
      },
      { property: "og:title", content: "Gasto Inteligente" },
      { property: "og:description", content: "Organize gastos, contas, cartões, clientes, fornecedores e relatórios em um só lugar." },
      { property: "og:image", content: "https://gastointeligente.com.br/og-gasto-inteligente.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Gasto Inteligente" },
      { name: "twitter:description", content: "Organize gastos, contas, cartões, clientes, fornecedores e relatórios em um só lugar." },
      { name: "twitter:image", content: "https://gastointeligente.com.br/og-gasto-inteligente.png" },
    ],
    links: [{ rel: "canonical", href: "https://gastointeligente.com.br/" }],
  }),
  component: LandingPage,
});

function LandingPage() {
  return <PublicLanding />;
}
