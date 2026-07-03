import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { usePlan } from "@/lib/use-plan";
import { MobileShell } from "@/components/MobileShell";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Gate de tela: só renderiza children se o usuário logado for Admin Master.
 * - Enquanto carrega a sessão: mostra placeholder neutro.
 * - Não logado: redireciona para /login.
 * - Logado mas não admin: mostra "Acesso restrito" + redirect para /app.
 */
export function AdminMasterGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { isAdminMaster } = usePlan();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      void navigate({ to: "/login", replace: true });
      return;
    }
    if (!isAdminMaster) {
      const timer = setTimeout(() => {
        void navigate({ to: "/app", replace: true });
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [loading, user, isAdminMaster, navigate]);

  if (loading || !user) {
    return (
      <MobileShell>
        <div className="py-16 text-center text-sm text-muted-foreground">Carregando…</div>
      </MobileShell>
    );
  }

  if (!isAdminMaster) {
    return (
      <MobileShell>
        <div className="mt-12 flex flex-col items-center text-center">
          <Ban className="h-10 w-10 text-destructive" />
          <h1 className="mt-3 text-xl font-bold">Acesso restrito</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta área é exclusiva do administrador master.
          </p>
          <Button className="mt-4" onClick={() => navigate({ to: "/app", replace: true })}>
            Voltar ao Dashboard
          </Button>
        </div>
      </MobileShell>
    );
  }

  return <>{children}</>;
}
