import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  tipoCadastroLabel,
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

  const erroValidacao = useMemo<string | null>(() => {
    if (!tipo) return null; // pode salvar parcial sem tipo? Exigimos tipo só ao salvar.
    if (tipo === "pessoa_fisica") {
      if (!form.nome.trim()) return "Preencha seu nome completo.";
      if (form.cpf && !isValidCPF(form.cpf)) return "CPF inválido. Confira os números digitados.";
    }
    if (tipo === "mei") {
      if (!form.responsavel_nome.trim() && !form.nome.trim())
        return "Preencha o nome do responsável.";
      if (form.cnpj && !isValidCNPJ(form.cnpj))
        return "CNPJ inválido. Confira os números digitados.";
    }
    if (tipo === "empresa") {
      if (!form.razao_social.trim()) return "Preencha a razão social.";
      if (form.cnpj && !isValidCNPJ(form.cnpj))
        return "CNPJ inválido. Confira os números digitados.";
    }
    return null;
  }, [tipo, form]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tipo) {
      toast.error("Escolha um tipo de cadastro para continuar.");
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
      nome_fantasia:
        tipo !== "pessoa_fisica" ? form.nome_fantasia.trim() || null : null,
      responsavel_nome:
        tipo !== "pessoa_fisica" ? form.responsavel_nome.trim() || null : null,
      telefone: form.telefone ? onlyDigits(form.telefone) : null,
    };
    const { error } = await updateProfile(payload);
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar agora. Tente novamente.");
      return;
    }
    toast.success("Perfil atualizado com sucesso! 🎉");
    void navigate({ to: "/conta" });
  }

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/conta"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Meu perfil</h1>
          <p className="text-xs text-muted-foreground">
            Personalize sua experiência escolhendo seu tipo de cadastro.
          </p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="mt-5 space-y-5 animate-fade-in">
        {/* Foto de perfil */}
        <section className="rounded-3xl border border-border bg-card p-4 shadow-card">
          <h2 className="text-sm font-semibold">Foto de perfil</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Aparece no menu, na sua conta e nas mensagens do chat.
          </p>
          <div className="mt-4">
            <AvatarUpload />
          </div>
        </section>

        {/* Tipo de cadastro */}
        <section className="rounded-3xl border border-border bg-card p-4 shadow-card">
          <h2 className="text-sm font-semibold">Tipo de cadastro</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Escolha a opção que melhor descreve você.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <TipoCard
              icon={<UserIcon className="h-4 w-4" />}
              label="Pessoa física"
              description="Uso pessoal, com CPF"
              selected={tipo === "pessoa_fisica"}
              onClick={() => setForm((f) => ({ ...f, tipo_cadastro: "pessoa_fisica" }))}
            />
            <TipoCard
              icon={<Briefcase className="h-4 w-4" />}
              label="MEI"
              description="Microempreendedor, com CNPJ"
              selected={tipo === "mei"}
              onClick={() => setForm((f) => ({ ...f, tipo_cadastro: "mei" }))}
            />
            <TipoCard
              icon={<Building2 className="h-4 w-4" />}
              label="Empresa"
              description="Empresa com CNPJ"
              selected={tipo === "empresa"}
              onClick={() => setForm((f) => ({ ...f, tipo_cadastro: "empresa" }))}
            />
          </div>
        </section>

        {/* Campos por tipo */}
        {tipo && (
          <section className="rounded-3xl border border-border bg-card p-4 shadow-card space-y-3">
            <h2 className="text-sm font-semibold">
              Dados do {tipoCadastroLabel(tipo).toLowerCase()}
            </h2>

            {tipo === "pessoa_fisica" && (
              <>
                <Field label="Nome completo" required>
                  <Input
                    value={form.nome}
                    onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                    placeholder="Como aparece nos documentos"
                  />
                </Field>
                <Field label="CPF">
                  <Input
                    inputMode="numeric"
                    value={form.cpf}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, cpf: maskCPF(e.target.value) }))
                    }
                    placeholder="000.000.000-00"
                    aria-invalid={Boolean(form.cpf) && !isValidCPF(form.cpf)}
                  />
                </Field>
              </>
            )}

            {tipo === "mei" && (
              <>
                <Field label="Nome completo do responsável" required>
                  <Input
                    value={form.responsavel_nome}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, responsavel_nome: e.target.value }))
                    }
                    placeholder="Quem assina pelo MEI"
                  />
                </Field>
                <Field label="Nome fantasia">
                  <Input
                    value={form.nome_fantasia}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, nome_fantasia: e.target.value }))
                    }
                    placeholder="Opcional"
                  />
                </Field>
                <Field label="CNPJ">
                  <Input
                    inputMode="numeric"
                    value={form.cnpj}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, cnpj: maskCNPJ(e.target.value) }))
                    }
                    placeholder="00.000.000/0000-00"
                    aria-invalid={Boolean(form.cnpj) && !isValidCNPJ(form.cnpj)}
                  />
                </Field>
              </>
            )}

            {tipo === "empresa" && (
              <>
                <Field label="Razão social" required>
                  <Input
                    value={form.razao_social}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, razao_social: e.target.value }))
                    }
                    placeholder="Nome registrado da empresa"
                  />
                </Field>
                <Field label="Nome fantasia">
                  <Input
                    value={form.nome_fantasia}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, nome_fantasia: e.target.value }))
                    }
                    placeholder="Opcional"
                  />
                </Field>
                <Field label="Nome do responsável">
                  <Input
                    value={form.responsavel_nome}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, responsavel_nome: e.target.value }))
                    }
                    placeholder="Quem responde pela empresa"
                  />
                </Field>
                <Field label="CNPJ">
                  <Input
                    inputMode="numeric"
                    value={form.cnpj}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, cnpj: maskCNPJ(e.target.value) }))
                    }
                    placeholder="00.000.000/0000-00"
                    aria-invalid={Boolean(form.cnpj) && !isValidCNPJ(form.cnpj)}
                  />
                </Field>
              </>
            )}

            <Field label="E-mail">
              <Input value={user?.email ?? ""} disabled />
            </Field>

            <Field label="Telefone">
              <Input
                inputMode="numeric"
                value={form.telefone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, telefone: maskTelefone(e.target.value) }))
                }
                placeholder="(11) 90000-0000"
              />
            </Field>

            <p className="flex items-start gap-2 rounded-2xl bg-muted/40 p-3 text-[11px] leading-snug text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none" />
              Esses dados são usados apenas para identificar seu perfil no app e
              personalizar sua experiência.
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
            {saving ? "Salvando…" : "Salvar perfil"}
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
