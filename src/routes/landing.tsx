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
    ],
    links: [{ rel: "canonical", href: "https://gastointeligente.com.br/" }],
  }),
  component: LandingPage,
});

function LandingPage() {
  return <PublicLanding />;
}
