import { createFileRoute } from "@tanstack/react-router";
import { PublicLanding } from "@/components/landing/PublicLanding";

export const Route = createFileRoute("/")({
  head: () => ({
    title: "Gasto Inteligente — Controle Financeiro Pessoal e Inteligente",
    meta: [
      {
        name: "description",
        content: "Organize sua vida financeira com o Gasto Inteligente. Controle de gastos, faturas de cartão, metas e relatórios avançados em um só lugar.",
      },
      { property: "og:title", content: "Gasto Inteligente — Controle Financeiro Inteligente" },
      { property: "og:description", content: "Sua vida financeira mais leve com controle automático de gastos, metas e faturas." },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PublicLanding,
});

