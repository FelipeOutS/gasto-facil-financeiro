import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LogOut, ShieldCheck, X } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { clearLoginBio, isLoginBioEnabled } from "@/lib/biometric-login";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/confirmar-saida")({
  head: () => ({ meta: [{ title: "Sair da conta — Gasto Inteligente" }] }),
  component: ConfirmarSaidaPage,
});

type Action = "keep" | "remove" | null;

function ConfirmarSaidaPage() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState<Action>(null);

  async function performSignOut(keepBio: boolean, which: Action) {
    if (busy) return;
    setBusy(which);
    try {
      if (!keepBio) {
        try {
          clearLoginBio();
        } catch {
          /* ignore */
        }
      }
      try {
        await signOut();
      } catch {
        /* mesmo se falhar a chamada remota, seguimos para login */
      }
    } finally {
      void navigate({ to: "/login", replace: true });
    }
  }

  function handleCancel() {
    if (busy) return;
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      void navigate({ to: "/", replace: true });
    }
  }

  // Se a biometria não estiver ativada, esta tela não deveria abrir.
  // Por segurança, oferecemos saída direta.
  const bioEnabled = isLoginBioEnabled();

  return (
    <MobileShell>
      <header className="pt-3">
        <h1 className="text-2xl font-bold tracking-tight">Sair da conta</h1>
        <p className="mt-2 text-sm leading-snug text-muted-foreground">
          {bioEnabled
            ? "Deseja manter a entrada por biometria neste dispositivo?"
            : "Confirme se deseja sair da sua conta."}
        </p>
      </header>

      <section className="mt-6 space-y-3">
        {bioEnabled && (
          <button
            type="button"
            onClick={() => void performSignOut(true, "keep")}
            disabled={busy !== null}
            className={cn(
              "flex min-h-[60px] w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors active:scale-[0.99] disabled:opacity-60",
            )}
          >
            <ShieldCheck className="h-4 w-4" />
            {busy === "keep" ? "Saindo…" : "Manter biometria e sair"}
          </button>
        )}

        <button
          type="button"
          onClick={() => void performSignOut(false, "remove")}
          disabled={busy !== null}
          className={cn(
            "flex min-h-[60px] w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive transition-colors active:scale-[0.99] disabled:opacity-60",
          )}
        >
          <LogOut className="h-4 w-4" />
          {busy === "remove"
            ? "Saindo…"
            : bioEnabled
              ? "Remover biometria e sair"
              : "Sair da conta"}
        </button>

        <button
          type="button"
          onClick={handleCancel}
          disabled={busy !== null}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-muted-foreground transition-colors active:scale-[0.99] disabled:opacity-60"
        >
          <X className="h-4 w-4" />
          Cancelar
        </button>
      </section>
    </MobileShell>
  );
}
