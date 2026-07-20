import { createFileRoute } from "@tanstack/react-router";
import { PublicLanding } from "@/components/landing/PublicLanding";

/**
 * Rota raiz `/` — SEMPRE pública.
 *
 * Renderiza a landing page tanto para visitantes deslogados quanto para
 * usuários com sessão ativa. Nenhum guard, biometria ou redirect condicional
 * intercepta esta rota. O dashboard privado vive em `/app` (protegido pelo
 * AuthGate).
 */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gasto Inteligente — Controle financeiro simples, visual e inteligente" },
      {
        name: "description",
        content:
          "Organize gastos, cartões, contas, metas e renda em um só lugar — para pessoa física, MEI e empresa.",
      },
      { property: "og:title", content: "Gasto Inteligente — Controle financeiro simples, visual e inteligente" },
      { property: "og:description", content: "Organize gastos, cartões, contas, metas e renda em um só lugar." },
      { property: "og:url", content: "https://gastointeligente.com.br/" },
      { property: "og:image", content: "https://gastointeligente.com.br/og-gasto-inteligente.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Gasto Inteligente — controle financeiro simples, visual e inteligente" },
      { name: "twitter:image", content: "https://gastointeligente.com.br/og-gasto-inteligente.png" },
    ],
    links: [
      { rel: "canonical", href: "https://gastointeligente.com.br/" },
    ],
  }),
  component: PublicHome,
});

function PublicHome() {
  return <PublicLanding />;
}
