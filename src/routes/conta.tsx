import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  LogOut,
  User as UserIcon,
  Mail,
  Pencil,
  IdCard,
  Phone,
  Building2,
  Briefcase,
  Sparkles,
  Settings2,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useRoles } from "@/lib/use-roles";
import {
  displayCPF,
  displayCNPJ,
  getVocab,
  maskTelefone,
  tipoCadastroLabel,
  type TipoCadastro,
} from "@/lib/profile-utils";

export const Route = createFileRoute("/conta")({
  head: () => ({ meta: [{ title: "Minha conta — Gasto Inteligente" }] }),
  component: ContaPage,
});

function ContaPage() {
  const { user, profile, signOut } = useAuth();
  const { isOwner, isAdmin } = useRoles();
  const navigate = useNavigate();

  async function handleLogout() {
    await signOut();
    void navigate({ to: "/login" });
  }

  const tipo = (profile?.tipo_cadastro as TipoCadastro) ?? null;
  const vocab = getVocab(tipo);

  const nomeExibicao =
    tipo === "empresa"
      ? profile?.razao_social || profile?.nome_fantasia || profile?.nome || "—"
      : profile?.nome || profile?.responsavel_nome || "Usuário";

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
            {tipo === "empresa" ? (
              <Building2 className="h-5 w-5 text-foreground" />
            ) : tipo === "mei" ? (
              <Briefcase className="h-5 w-5 text-foreground" />
            ) : (
              <UserIcon className="h-5 w-5 text-foreground" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{nomeExibicao}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {isOwner && (
              <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                Acesso total
              </span>
            )}
            {!isOwner && isAdmin && (
              <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                Admin
              </span>
            )}
            {vocab.tagLabel && (
              <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                {vocab.tagLabel}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Aviso para completar perfil (usuários antigos) */}
      {!tipo && (
        <section className="mt-4 rounded-3xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-semibold">Complete seu perfil</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Personalize sua experiência escolhendo entre Pessoa física, MEI ou Empresa.
          </p>
          <Button asChild size="sm" className="mt-3 rounded-xl">
            <Link to="/perfil">Completar perfil</Link>
          </Button>
        </section>
      )}

      <section className="mt-4 space-y-2">
        <InfoLine
          icon={<IdCard className="h-4 w-4" />}
          label="Tipo de cadastro"
          value={tipoCadastroLabel(tipo)}
        />
        {tipo === "pessoa_fisica" && (
          <InfoLine
            icon={<UserIcon className="h-4 w-4" />}
            label="Nome completo"
            value={profile?.nome ?? "—"}
          />
        )}
        {tipo === "mei" && (
          <>
            <InfoLine
              icon={<UserIcon className="h-4 w-4" />}
              label="Responsável"
              value={profile?.responsavel_nome ?? "—"}
            />
            {profile?.nome_fantasia && (
              <InfoLine
                icon={<Briefcase className="h-4 w-4" />}
                label="Nome fantasia"
                value={profile.nome_fantasia}
              />
            )}
          </>
        )}
        {tipo === "empresa" && (
          <>
            <InfoLine
              icon={<Building2 className="h-4 w-4" />}
              label="Razão social"
              value={profile?.razao_social ?? "—"}
            />
            {profile?.nome_fantasia && (
              <InfoLine
                icon={<Briefcase className="h-4 w-4" />}
                label="Nome fantasia"
                value={profile.nome_fantasia}
              />
            )}
            {profile?.responsavel_nome && (
              <InfoLine
                icon={<UserIcon className="h-4 w-4" />}
                label="Responsável"
                value={profile.responsavel_nome}
              />
            )}
          </>
        )}
        {tipo === "pessoa_fisica" && profile?.cpf && (
          <InfoLine
            icon={<IdCard className="h-4 w-4" />}
            label="CPF"
            value={displayCPF(profile.cpf)}
          />
        )}
        {(tipo === "mei" || tipo === "empresa") && profile?.cnpj && (
          <InfoLine
            icon={<IdCard className="h-4 w-4" />}
            label="CNPJ"
            value={displayCNPJ(profile.cnpj)}
          />
        )}
        <InfoLine icon={<Mail className="h-4 w-4" />} label="E-mail" value={user?.email ?? "—"} />
        {profile?.telefone && (
          <InfoLine
            icon={<Phone className="h-4 w-4" />}
            label="Telefone"
            value={maskTelefone(profile.telefone)}
          />
        )}
      </section>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button asChild variant="outline" size="lg" className="h-11 w-full rounded-2xl">
          <Link to="/perfil">
            <Pencil className="mr-2 h-4 w-4" />
            Editar perfil
          </Link>
        </Button>
        <Button asChild size="lg" className="h-11 w-full rounded-2xl">
          <Link to="/meu-plano">
            <Sparkles className="mr-2 h-4 w-4" />
            Meu plano
          </Link>
        </Button>
      </div>

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
