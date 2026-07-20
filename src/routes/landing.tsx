import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Rota legada: /landing agora é apenas um redirect 301-like para "/".
 * A landing pública vive na raiz "/" (ver src/routes/index.tsx → IndexGate).
 * Mantida para não quebrar links externos antigos.
 */
export const Route = createFileRoute("/landing")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/", search: search as never, replace: true });
  },
});
