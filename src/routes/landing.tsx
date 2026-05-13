import { createFileRoute } from "@tanstack/react-router";
import { PublicLanding } from "@/components/landing/PublicLanding";

// Landing pública: acessível tanto para usuários deslogados quanto logados.
// Não usa AuthGate — mostra sempre a landing institucional do Gasto Inteligente.
export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      { title: "Conheça o Gasto Inteligente — Recursos, planos e diferenciais" },
      {
        name: "description",
        content:
          "Conheça o Gasto Inteligente: gastos, cartões, contas, metas, renda, investimentos e recursos para MEI e empresa em um só lugar.",
      },
      { property: "og:title", content: "Conheça o Gasto Inteligente — Recursos, planos e diferenciais" },
      { property: "og:description", content: "Conheça os recursos do Gasto Inteligente para pessoa física, MEI e empresa." },
      { property: "og:url", content: "https://gastointeligente.com.br/landing" },
      { property: "og:image", content: "https://gastointeligente.com.br/og-gasto-inteligente.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Conheça o Gasto Inteligente" },
      { name: "twitter:description", content: "Recursos, planos e diferenciais do Gasto Inteligente." },
      { name: "twitter:image", content: "https://gastointeligente.com.br/og-gasto-inteligente.png" },
    ],
    links: [{ rel: "canonical", href: "https://gastointeligente.com.br/landing" }],
  }),
  component: LandingPage,
});

function LandingPage() {
  return <PublicLanding />;
}
