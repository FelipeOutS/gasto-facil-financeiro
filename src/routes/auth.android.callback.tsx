import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { validateAndroidOAuthReturn } from "@/lib/android-oauth";
import { saveSecureSession } from "@/lib/secure-session";

export const Route = createFileRoute("/auth/android/callback")({
  component: AndroidAuthCallback,
  head: () => ({
    meta: [
      { title: "Concluir login — Gasto Inteligente" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
});

function AndroidAuthCallback() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Validando seu acesso…");
  useEffect(() => {
    let canceled = false;
    async function finish() {
      // The existing Supabase SDK consumes the fragment; never log or forward tokens.
      const status = await validateAndroidOAuthReturn(
        supabase.auth,
        !!window.AndroidBiometric,
        () => window.history.replaceState(null, "", window.location.pathname),
      );
      if (canceled) return;
      if (status === "invalid-session") {
        setMessage("Não foi possível concluir o login. Volte ao aplicativo e tente novamente.");
        return;
      }
      if (status === "browser") {
        setMessage(
          "O retorno ao aplicativo não foi concluído. Abra o Gasto Inteligente e tente novamente.",
        );
        return;
      }
      if (status === "invalid-user") {
        setMessage("Não foi possível validar seu acesso. Entre novamente.");
        return;
      }
      const { data } = await supabase.auth.getSession();
      await saveSecureSession(data.session);
      if (canceled) return;
      // Keep the unlocked in-memory session; the fragment was already removed.
      void navigate({ to: "/app", replace: true });
    }
    void finish().catch(() => {
      window.history.replaceState(null, "", window.location.pathname);
      if (!canceled)
        setMessage("Não foi possível conectar. Volte ao aplicativo e tente novamente.");
    });
    return () => {
      canceled = true;
    };
  }, [navigate]);
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Concluir login</h1>
        <p role="status">{message}</p>
        <Link to="/login" className="underline">
          Voltar para entrar
        </Link>
      </div>
    </main>
  );
}
