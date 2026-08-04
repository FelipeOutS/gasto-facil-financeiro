import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Save, ShieldCheck, User as UserIcon, Building2, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth-context";
import {
  isValidCPF,
  isValidCNPJ,
  maskCPF,
  maskCNPJ,
  maskTelefone,
  onlyDigits,
  type TipoCadastro,
} from "@/lib/profile-utils";
import { cn } from "@/lib/utils";
import { AvatarUpload } from "@/components/AvatarUpload";

export const Route = createFileRoute("/perfil")({
  head: () => ({ meta: [{ title: "Meu perfil — Gasto Inteligente" }] }),
  component: PerfilPage,
});

type FormState = {
  tipo_cadastro: TipoCadastro;
  nome: string;
  cpf: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  responsavel_nome: string;
  telefone: string;
};

const EMPTY: FormState = {
  tipo_cadastro: null,
  nome: "",
  cpf: "",
  cnpj: "",
  razao_social: "",
  nome_fantasia: "",
  responsavel_nome: "",
  telefone: "",
};

function PerfilPage() {
  const { t } = useTranslation("perfil");
  const { profile, user, updateProfile, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        tipo_cadastro: (profile.tipo_cadastro as TipoCadastro) ?? null,
        nome: profile.nome ?? "",
        cpf: profile.cpf ? maskCPF(profile.cpf) : "",
        cnpj: profile.cnpj ? maskCNPJ(profile.cnpj) : "",
        razao_social: profile.razao_social ?? "",
        nome_fantasia: profile.nome_fantasia ?? "",
        responsavel_nome: profile.responsavel_nome ?? "",
        telefone: profile.telefone ? maskTelefone(profile.telefone) : "",
      });
    }
  }, [profile]);

  const tipo = form.tipo_cadastro;
  const tipoLabel = (k: TipoCadastro) => (k ? t(`tipo.${k}`) : t("tipo.naoDefinido"));

  const erroValidacao = useMemo<string | null>(() => {
    if (!tipo) return null;
    if (tipo === "pessoa_fisica") {
      if (!form.nome.trim()) return t("validation.nome");
      if (form.cpf && !isValidCPF(form.cpf)) return t("validation.cpf");
    }
    if (tipo === "mei") {
      if (!form.responsavel_nome.trim() && !form.nome.trim()) return t("validation.responsavel");
      if (form.cnpj && !isValidCNPJ(form.cnpj)) return t("validation.cnpj");
    }
    if (tipo === "empresa") {
      if (!form.razao_social.trim()) return t("validation.razao");
      if (form.cnpj && !isValidCNPJ(form.cnpj)) return t("validation.cnpj");
    }
    return null;
  }, [tipo, form, t]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tipo) {
      toast.error(t("validation.chooseTipo"));
      return;
    }
    if (erroValidacao) {
      toast.error(erroValidacao);
      return;
    }
    setSaving(true);
    const payload = {
      tipo_cadastro: tipo,
      nome:
        tipo === "empresa"
          ? form.responsavel_nome.trim() || form.nome.trim() || null
          : form.nome.trim() || null,
      cpf: tipo === "pessoa_fisica" && form.cpf ? onlyDigits(form.cpf) : null,
      cnpj: tipo !== "pessoa_fisica" && form.cnpj ? onlyDigits(form.cnpj) : null,
      razao_social: tipo === "empresa" ? form.razao_social.trim() || null : null,
      nome_fantasia: tipo !== "pessoa_fisica" ? form.nome_fantasia.trim() || null : null,
      responsavel_nome: tipo !== "pessoa_fisica" ? form.responsavel_nome.trim() || null : null,
      telefone: form.telefone ? onlyDigits(form.telefone) : null,
    };
    const { error } = await updateProfile(payload);
    setSaving(false);
    if (error) {
      toast.error(t("toasts.saveError"));
      return;
    }
    toast.success(t("toasts.saved"));
    void navigate({ to: "/conta" });
  }

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/conta"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card"
          aria-label={t("back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="mt-5 space-y-5 animate-fade-in">
        {/* Foto de perfil */}
        <section className="rounded-3xl border border-border bg-card p-4 shadow-card">
          <h2 className="text-sm font-semibold">{t("avatar.title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("avatar.desc")}</p>
          <div className="mt-4">
            <AvatarUpload />
          </div>
        </section>

        {/* Tipo de cadastro */}
        <section className="rounded-3xl border border-border bg-card p-4 shadow-card">
          <h2 className="text-sm font-semibold">{t("tipo.title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("tipo.subtitle")}</p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <TipoCard
              icon={<UserIcon className="h-4 w-4" />}
              label={t("tipo.pessoa_fisica")}
              description={t("tipo.pessoa_fisicaDesc")}
              selected={tipo === "pessoa_fisica"}
              onClick={() => setForm((f) => ({ ...f, tipo_cadastro: "pessoa_fisica" }))}
            />
            <TipoCard
              icon={<Briefcase className="h-4 w-4" />}
              label={t("tipo.mei")}
              description={t("tipo.meiDesc")}
              selected={tipo === "mei"}
              onClick={() => setForm((f) => ({ ...f, tipo_cadastro: "mei" }))}
            />
            <TipoCard
              icon={<Building2 className="h-4 w-4" />}
              label={t("tipo.empresa")}
              description={t("tipo.empresaDesc")}
              selected={tipo === "empresa"}
              onClick={() => setForm((f) => ({ ...f, tipo_cadastro: "empresa" }))}
            />
          </div>
        </section>

        {/* Campos por tipo */}
        {tipo && (
          <section className="rounded-3xl border border-border bg-card p-4 shadow-card space-y-3">
            <h2 className="text-sm font-semibold">
              {t("data.sectionTitle", { tipo: tipoLabel(tipo).toLowerCase() })}
            </h2>

            {tipo === "pessoa_fisica" && (
              <>
                <Field label={t("data.nome")} required>
                  <Input
                    value={form.nome}
                    onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                    placeholder={t("data.nomePlaceholder")}
                  />
                </Field>
                <Field label={t("data.cpf")}>
                  <Input
                    inputMode="numeric"
                    value={form.cpf}
                    onChange={(e) => setForm((f) => ({ ...f, cpf: maskCPF(e.target.value) }))}
                    placeholder="000.000.000-00"
                    aria-invalid={Boolean(form.cpf) && !isValidCPF(form.cpf)}
                  />
                </Field>
              </>
            )}

            {tipo === "mei" && (
              <>
                <Field label={t("data.responsavelNome")} required>
                  <Input
                    value={form.responsavel_nome}
                    onChange={(e) => setForm((f) => ({ ...f, responsavel_nome: e.target.value }))}
                    placeholder={t("data.responsavelPlaceholderMEI")}
                  />
                </Field>
                <Field label={t("data.nomeFantasia")}>
                  <Input
                    value={form.nome_fantasia}
                    onChange={(e) => setForm((f) => ({ ...f, nome_fantasia: e.target.value }))}
                    placeholder={t("data.optional")}
                  />
                </Field>
                <Field label={t("data.cnpj")}>
                  <Input
                    inputMode="numeric"
                    value={form.cnpj}
                    onChange={(e) => setForm((f) => ({ ...f, cnpj: maskCNPJ(e.target.value) }))}
                    placeholder="00.000.000/0000-00"
                    aria-invalid={Boolean(form.cnpj) && !isValidCNPJ(form.cnpj)}
                  />
                </Field>
              </>
            )}

            {tipo === "empresa" && (
              <>
                <Field label={t("data.razaoSocial")} required>
                  <Input
                    value={form.razao_social}
                    onChange={(e) => setForm((f) => ({ ...f, razao_social: e.target.value }))}
                    placeholder={t("data.razaoPlaceholder")}
                  />
                </Field>
                <Field label={t("data.nomeFantasia")}>
                  <Input
                    value={form.nome_fantasia}
                    onChange={(e) => setForm((f) => ({ ...f, nome_fantasia: e.target.value }))}
                    placeholder={t("data.optional")}
                  />
                </Field>
                <Field label={t("data.responsavelNomeOpt")}>
                  <Input
                    value={form.responsavel_nome}
                    onChange={(e) => setForm((f) => ({ ...f, responsavel_nome: e.target.value }))}
                    placeholder={t("data.responsavelPlaceholderEmpresa")}
                  />
                </Field>
                <Field label={t("data.cnpj")}>
                  <Input
                    inputMode="numeric"
                    value={form.cnpj}
                    onChange={(e) => setForm((f) => ({ ...f, cnpj: maskCNPJ(e.target.value) }))}
                    placeholder="00.000.000/0000-00"
                    aria-invalid={Boolean(form.cnpj) && !isValidCNPJ(form.cnpj)}
                  />
                </Field>
              </>
            )}

            <Field label={t("data.email")}>
              <Input value={user?.email ?? ""} disabled />
            </Field>

            <Field label={t("data.telefone")}>
              <Input
                inputMode="numeric"
                value={form.telefone}
                onChange={(e) => setForm((f) => ({ ...f, telefone: maskTelefone(e.target.value) }))}
                placeholder={t("data.telefonePlaceholder")}
              />
            </Field>

            <p className="flex items-start gap-2 rounded-2xl bg-muted/40 p-3 text-[11px] leading-snug text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none" />
              {t("data.privacy")}
            </p>

            {erroValidacao && (
              <p className="text-xs font-medium text-destructive">{erroValidacao}</p>
            )}
          </section>
        )}

        <div className="sticky bottom-[calc(80px+env(safe-area-inset-bottom))] lg:static lg:bottom-auto">
          <Button
            type="submit"
            size="lg"
            disabled={!tipo || saving || loading}
            className="h-12 w-full rounded-2xl text-base font-semibold"
          >
            <Save className="mr-2 h-4 w-4" />
            {saving ? t("actions.saving") : t("actions.save")}
          </Button>
        </div>
      </form>
    </MobileShell>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function TipoCard({
  icon,
  label,
  description,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition-all",
        selected
          ? "border-primary bg-primary/10 shadow-card"
          : "border-border bg-card-elevated hover:border-primary/40",
      )}
    >
      <span
        className={cn(
          "grid h-8 w-8 place-items-center rounded-full",
          selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {icon}
      </span>
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-[11px] text-muted-foreground">{description}</span>
    </button>
  );
}
