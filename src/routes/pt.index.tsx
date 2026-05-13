import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/pt/")({
  beforeLoad: () => {
    throw redirect({ to: "/landing", search: { lang: "pt" } as never, replace: true });
  },
});
