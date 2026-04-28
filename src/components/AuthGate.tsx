import { useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { Wallet } from "lucide-react";

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!loading && !session && !redirecting) {
      setRedirecting(true);
      void navigate({ to: "/login" });
    }
  }, [loading, session, redirecting, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-card animate-pop">
            <Wallet className="h-6 w-6 text-foreground" />
          </span>
          <p className="text-sm text-muted-foreground">Preparando tudo…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) {
      void navigate({ to: "/" });
    }
  }, [loading, session, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground animate-fade-in">Só um instante…</p>
      </div>
    );
  }

  return <>{children}</>;
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background px-5 py-10">
      <div className="mx-auto flex w-full max-w-sm flex-col animate-fade-in">
        <Link to="/" className="mx-auto flex items-center gap-2">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-card shadow-elevated">
            <Wallet className="h-5 w-5 text-foreground" />
          </span>
          <span className="text-lg font-extrabold tracking-tight">Gasto Fácil</span>
        </Link>

        <div className="mt-8">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>

        <div className="mt-6">{children}</div>

        {footer && <div className="mt-6 text-center text-sm">{footer}</div>}
      </div>
    </div>
  );
}
