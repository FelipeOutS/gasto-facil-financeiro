import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/en/$")({
  beforeLoad: ({ params }) => {
    const splat = (params as { _splat?: string })._splat ?? "";
    const target = splat ? `/${splat}` : "/";
    throw redirect({ to: target, search: { lang: "en" } as never, replace: true });
  },
});
