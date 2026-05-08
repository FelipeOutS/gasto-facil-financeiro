import { createFileRoute } from "@tanstack/react-router";
import { PublicLanding } from "@/components/landing/PublicLanding";

export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      { title: "Gasto Inteligente — Controle financeiro simples, visual e inteligente" },
      {
        name: "description",
        content:
          "Organize gastos, cartões, contas, metas, renda e investimentos em um só lugar.",
      },
    ],
  }),
  component: PublicLanding,
});
