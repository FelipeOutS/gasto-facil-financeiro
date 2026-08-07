import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/app_/ajustes")({
  head: () => ({ meta: [{ title: "Ajustes — Gasto Inteligente" }] }),
  component: AjustesLayout,
});

function AjustesLayout() {
  return (
    <div data-testid="settings-layout">
      <Outlet />
    </div>
  );
}
