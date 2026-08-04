import { createFileRoute } from "@tanstack/react-router";
import { PublicLanding } from "@/components/landing/PublicLanding";

export const Route = createFileRoute("/")({
  component: () => <PublicLanding />,

  head: () => ({
    title: "Gasto Inteligente - Seu Controle Financeiro via WhatsApp",
    meta: [
      {
        name: "description",
        content:
          "Gerencie suas finanças de forma simples e rápida pelo WhatsApp. O Gasto Inteligente ajuda você a controlar gastos, faturas e boletos em um só lugar.",
      },
      { property: "og:title", content: "Gasto Inteligente - Controle Financeiro via WhatsApp" },
      {
        property: "og:description",
        content:
          "Simplifique seu controle financeiro com inteligência artificial direto no seu WhatsApp.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
