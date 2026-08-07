import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
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
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useRoles } from "@/lib/use-roles";
import {
  displayCPF,
  displayCNPJ,
  getVocab,
  maskTelefone,
  type TipoCadastro,
} from "@/lib/profile-utils";
import i18n from "@/i18n";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";
import { z } from "zod";

const accountSearchSchema = z.object({
  from: z.enum(["ajustes", "outros"]).optional(),
});

export const Route = createFileRoute("/conta")({
  validateSearch: accountSearchSchema,
  head: () => {
    const t = i18n.getFixedT(null, "account");
    return { meta: [{ title: t("meta.title") }] };
  },
  component: ContaPage,
});

function ContaPage() {
  const { t } = useTranslation("account");
  const { user, profile, signOut } = useAuth();
  const { isOwner, isAdmin } = useRoles();
  const navigate = useNavigate();
  const { from } = useSearch({ from: "/conta" });

  async function handleLogout() {
    await signOut();
    void navigate({ to: "/" });
  }

  const tipo = (profile?.tipo_cadastro as TipoCadastro) ?? null;
  const vocab = getVocab(tipo);

  const tipoLabel = tipo ? t(`tipo.${tipo}` as const) : t("tipo.naoDefinido");

  const nomeExibicao =
    tipo === "empresa"
      ? profile?.razao_social || profile?.nome_fantasia || profile?.nome || t("dash")
      : profile?.nome || profile?.responsavel_nome || t("defaultUser");

  const backTo = from === "ajustes" ? "/app/ajustes" : "/app";

  return (
    <MobileShell>
      <SettingsPageHeader title={t("title")} backTo={backTo} className="mb-0" />


      <section className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center gap-3">
          <UserAvatar url={profile?.avatar_url} name={nomeExibicao} email={user?.email} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{nomeExibicao}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {isOwner && (
              <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                {t("fullAccess")}
              </span>
            )}
            {!isOwner && isAdmin && (
              <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                {t("admin")}
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
          <p className="text-sm font-semibold">{t("completeProfile")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("completeProfileDesc")}</p>
          <Button asChild size="sm" className="mt-3 rounded-xl">
            <Link to="/perfil">{t("completeBtn")}</Link>
          </Button>
        </section>
      )}

      <section className="mt-4 space-y-2">
        <InfoLine
          icon={<IdCard className="h-4 w-4" />}
          label={t("fields.type")}
          value={tipoLabel}
        />
        {tipo === "pessoa_fisica" && (
          <InfoLine
            icon={<UserIcon className="h-4 w-4" />}
            label={t("fields.fullName")}
            value={profile?.nome ?? t("dash")}
          />
        )}
        {tipo === "mei" && (
          <>
            <InfoLine
              icon={<UserIcon className="h-4 w-4" />}
              label={t("fields.responsible")}
              value={profile?.responsavel_nome ?? t("dash")}
            />
            {profile?.nome_fantasia && (
              <InfoLine
                icon={<Briefcase className="h-4 w-4" />}
                label={t("fields.fantasyName")}
                value={profile.nome_fantasia}
              />
            )}
          </>
        )}
        {tipo === "empresa" && (
          <>
            <InfoLine
              icon={<Building2 className="h-4 w-4" />}
              label={t("fields.razaoSocial")}
              value={profile?.razao_social ?? t("dash")}
            />
            {profile?.nome_fantasia && (
              <InfoLine
                icon={<Briefcase className="h-4 w-4" />}
                label={t("fields.fantasyName")}
                value={profile.nome_fantasia}
              />
            )}
            {profile?.responsavel_nome && (
              <InfoLine
                icon={<UserIcon className="h-4 w-4" />}
                label={t("fields.responsible")}
                value={profile.responsavel_nome}
              />
            )}
          </>
        )}
        {tipo === "pessoa_fisica" && profile?.cpf && (
          <InfoLine
            icon={<IdCard className="h-4 w-4" />}
            label={t("fields.cpf")}
            value={displayCPF(profile.cpf)}
          />
        )}
        {(tipo === "mei" || tipo === "empresa") && profile?.cnpj && (
          <InfoLine
            icon={<IdCard className="h-4 w-4" />}
            label={t("fields.cnpj")}
            value={displayCNPJ(profile.cnpj)}
          />
        )}
        <InfoLine
          icon={<Mail className="h-4 w-4" />}
          label={t("fields.email")}
          value={user?.email ?? t("dash")}
        />
        {profile?.telefone && (
          <InfoLine
            icon={<Phone className="h-4 w-4" />}
            label={t("fields.phone")}
            value={maskTelefone(profile.telefone)}
          />
        )}
      </section>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button asChild variant="outline" size="lg" className="h-11 w-full rounded-2xl">
          <Link to="/perfil">
            <Pencil className="mr-2 h-4 w-4" />
            {t("actions.edit")}
          </Link>
        </Button>
        <Button asChild size="lg" className="h-11 w-full rounded-2xl">
          <Link to="/meu-plano">
            <Sparkles className="mr-2 h-4 w-4" />
            {t("actions.myPlan")}
          </Link>
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Button asChild variant="outline" size="lg" className="h-11 w-full rounded-2xl">
          <Link to="/onboarding">
            <Settings2 className="mr-2 h-4 w-4" />
            {t("actions.redoOnboarding")}
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="h-11 w-full rounded-2xl">
          <Link to="/conta/seguranca">
            <IdCard className="mr-2 h-4 w-4" />
            {t("actions.security")}
          </Link>
        </Button>
      </div>

      <LanguageSection />

      <div className="mt-auto pt-8">
        <Button
          variant="outline"
          size="lg"
          onClick={handleLogout}
          className="h-12 w-full rounded-2xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t("actions.logout")}
        </Button>
      </div>
    </MobileShell>
  );
}

function LanguageSection() {
  const { t } = useTranslation("account");
  return (
    <section className="mt-4 rounded-3xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t("language.title")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("language.description")}</p>
        </div>
        <LanguageSwitcher variant="ghost-dark" align="end" />
      </div>
    </section>
  );
}

function InfoLine({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
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
