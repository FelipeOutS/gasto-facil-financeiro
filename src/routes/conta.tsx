import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, LogOut, User as UserIcon, Mail } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/conta")({
  head: () => ({ meta: [{ title: "Minha conta — Gasto Fácil" }] }),
  component: ContaPage,
});

function ContaPage() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await signOut();
    void navigate({ to: "/login" });
  }

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/categorias"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight">Minha conta</h1>
      </header>

      <section className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-card-elevated">
            <UserIcon className="h-5 w-5 text-foreground" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">
              {profile?.nome ?? "Usuário"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {user?.email}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-4 space-y-2">
        <InfoLine icon={<UserIcon className="h-4 w-4" />} label="Nome" value={profile?.nome ?? "—"} />
        <InfoLine icon={<Mail className="h-4 w-4" />} label="E-mail" value={user?.email ?? "—"} />
      </section>

      <p className="mt-6 text-xs text-muted-foreground">
        Em breve você poderá editar seu nome, alterar a senha e gerenciar suas preferências.
      </p>

      <div className="mt-auto pt-8">
        <Button
          variant="outline"
          size="lg"
          onClick={handleLogout}
          className="h-12 w-full rounded-2xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sair da conta
        </Button>
      </div>
    </MobileShell>
  );
}

function InfoLine({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-card-elevated text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
