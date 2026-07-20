import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /pt/qualquer/coisa → /qualquer/coisa?lang=pt
 * /pt → /?lang=pt
 * URLs prefixadas existem para SEO/compartilhamento; internamente o app usa
 * o search param `?lang=` para o idioma.
 */
export const Route = createFileRoute("/pt/$")({
  beforeLoad: ({ params }) => {
    const splat = (params as { _splat?: string })._splat ?? "";
    const target = splat ? `/${splat}` : "/";
    throw redirect({ to: target, search: { lang: "pt" } as never, replace: true });
  },
});
