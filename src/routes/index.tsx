import { createFileRoute } from "@tanstack/react-router";
import { PublicLanding } from "@/components/landing/PublicLanding";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    title: "Gasto Inteligente | Controle Financeiro via WhatsApp",
    meta: [
      {
        name: "description",
        content:
          "Organize suas finanças de forma simples pelo WhatsApp. Controle gastos, receitas e orçamentos com o Gasto Inteligente.",
      },
      {
        property: "og:title",
        content: "Gasto Inteligente | Controle Financeiro via WhatsApp",
      },
      {
        property: "og:description",
        content:
          "A forma mais fácil de controlar seu dinheiro é através do WhatsApp. Simples, rápido e inteligente.",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Index() {
  return (
    <>
      <div className="hidden" data-publish-authorized="true" data-prompt="6.6" />
      <PublicLanding />
    </>
  );
}

