import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Home,
  MapPin,
  Plus,
  Info,
  Star,
  Pencil,
  Trash2,
  Store,
  X,
  Check,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { cn } from "@/lib/utils";
import {
  addMercadoLocal,
  removeMercadoLocal,
  toggleMercadoFavorito,
  updateMercadoLocal,
  useMercadosLocais,
  type MercadoLocal,
} from "@/lib/mercado/mercados-store";

export const Route = createFileRoute("/mercado_/meus-mercados")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:meusMercados.metaTitle", { lng: i18n.language }) }],
  }),
  component: MeusMercadosPage,
});

type FormMode = { kind: "closed" } | { kind: "new" } | { kind: "edit"; id: string };

type FormState = {
  nome: string;
  endereco: string;
  bairro: string;
  cidade: string;
  observacao: string;
};

const EMPTY_FORM: FormState = {
  nome: "",
  endereco: "",
  bairro: "",
  cidade: "",
  observacao: "",
};

function MeusMercadosPage() {
  const { t, i18n: i18nInst } = useTranslation("mercado");
  const navigate = useNavigate();
  const mercados = useMercadosLocais();

  const [mode, setMode] = useState<FormMode>({ kind: "closed" });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18nInst.language || "pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    [i18nInst.language],
  );

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/mercado" });
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setMode({ kind: "new" });
  }

  function openEdit(m: MercadoLocal) {
    setForm({
      nome: m.nome,
      endereco: m.endereco ?? "",
      bairro: m.bairro ?? "",
      cidade: m.cidade ?? "",
      observacao: m.observacao ?? "",
    });
    setMode({ kind: "edit", id: m.id });
  }

  function closeForm() {
    setMode({ kind: "closed" });
    setForm(EMPTY_FORM);
  }

  function handleSave() {
    const nome = form.nome.trim();
    if (!nome) {
      toast.error(t("meusMercados.toast.nameRequired"));
      return;
    }
    const payload = {
      nome,
      endereco: form.endereco,
      bairro: form.bairro,
      cidade: form.cidade,
      observacao: form.observacao,
    };
    if (mode.kind === "edit") {
      const updated = updateMercadoLocal(mode.id, payload);
      if (updated) toast.success(t("meusMercados.toast.updated"));
    } else {
      const created = addMercadoLocal(payload);
      if (created) toast.success(t("meusMercados.toast.added"));
    }
    closeForm();
  }

  function handleRemove(m: MercadoLocal) {
    if (typeof window === "undefined") return;
    const ok = window.confirm(t("meusMercados.confirmRemove"));
    if (!ok) return;
    if (removeMercadoLocal(m.id)) {
      toast.success(t("meusMercados.toast.removed"));
      if (mode.kind === "edit" && mode.id === m.id) closeForm();
    }
  }

  function handleToggleFav(m: MercadoLocal) {
    const next = toggleMercadoFavorito(m.id);
    if (next) {
      toast.success(
        next.favorito
          ? t("meusMercados.toast.favOn")
          : t("meusMercados.toast.favOff"),
      );
    }
  }

  const isEmpty = mercados.length === 0;
  const formOpen = mode.kind !== "closed";

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("meusMercados.back")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("meusMercados.home")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
              <MapPin className="h-4 w-4" />
            </span>
            <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
              {t("meusMercados.title")}
            </h1>
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground md:text-base">
            {t("meusMercados.subtitle")}
          </p>
        </div>
      </header>

      <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card-elevated text-brand ring-1 ring-border/60">
            <Info className="h-4 w-4" />
          </span>
          <p className="text-sm leading-snug text-foreground md:text-[15px]">
            {t("meusMercados.localNotice")}
          </p>
        </div>
      </section>

      <section className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold md:text-lg">
            {t("meusMercados.list.title")}
          </h2>
          {!isEmpty && (
            <p className="text-[12px] text-muted-foreground">
              {t("meusMercados.list.count", { count: mercados.length })}
            </p>
          )}
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-4 text-sm font-semibold text-primary-foreground shadow-elevated active:scale-[0.99]"
          >
            <Plus className="h-4 w-4" />
            {t("meusMercados.addCta")}
          </button>
        )}
      </section>

      {formOpen && (
        <MercadoForm
          mode={mode}
          form={form}
          setForm={setForm}
          onCancel={closeForm}
          onSave={handleSave}
          t={t}
        />
      )}

      {isEmpty ? (
        <EmptyState t={t} onAdd={openNew} formOpen={formOpen} />
      ) : (
        <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {mercados.map((m) => (
            <MercadoCard
              key={m.id}
              m={m}
              t={t}
              dateFormatter={dateFormatter}
              onEdit={() => openEdit(m)}
              onRemove={() => handleRemove(m)}
              onToggleFav={() => handleToggleFav(m)}
              isEditing={mode.kind === "edit" && mode.id === m.id}
            />
          ))}
        </section>
      )}
    </MobileShell>
  );
}

function EmptyState({
  t,
  onAdd,
  formOpen,
}: {
  t: (k: string) => string;
  onAdd: () => void;
  formOpen: boolean;
}) {
  return (
    <section className="mt-5 grid place-items-center rounded-3xl border border-dashed border-border/60 bg-card p-8 text-center shadow-card">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
        <Store className="h-6 w-6" />
      </span>
      <h2 className="mt-3 text-base font-semibold md:text-lg">
        {t("meusMercados.empty.title")}
      </h2>
      <p className="mt-1 max-w-md text-sm leading-snug text-muted-foreground">
        {t("meusMercados.empty.desc")}
      </p>
      {!formOpen && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-5 text-sm font-semibold text-primary-foreground shadow-elevated active:scale-[0.99]"
        >
          <Plus className="h-4 w-4" />
          {t("meusMercados.addCta")}
        </button>
      )}
    </section>
  );
}

function MercadoForm({
  mode,
  form,
  setForm,
  onCancel,
  onSave,
  t,
}: {
  mode: FormMode;
  form: FormState;
  setForm: (next: FormState) => void;
  onCancel: () => void;
  onSave: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const isEdit = mode.kind === "edit";
  return (
    <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold md:text-lg">
          {isEdit ? t("meusMercados.editingTitle") : t("meusMercados.newFormTitle")}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("meusMercados.cancel")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form
        className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <Field
          className="md:col-span-2"
          label={t("meusMercados.fields.name")}
          required
          requiredLabel={t("meusMercados.fields.required")}
        >
          <input
            type="text"
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            placeholder={t("meusMercados.fields.namePlaceholder")}
            autoFocus
            className="h-11 w-full rounded-2xl border border-border bg-card-elevated px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </Field>
        <Field label={t("meusMercados.fields.address")} className="md:col-span-2">
          <input
            type="text"
            value={form.endereco}
            onChange={(e) => setForm({ ...form, endereco: e.target.value })}
            placeholder={t("meusMercados.fields.addressPlaceholder")}
            className="h-11 w-full rounded-2xl border border-border bg-card-elevated px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </Field>
        <Field label={t("meusMercados.fields.neighborhood")}>
          <input
            type="text"
            value={form.bairro}
            onChange={(e) => setForm({ ...form, bairro: e.target.value })}
            placeholder={t("meusMercados.fields.neighborhoodPlaceholder")}
            className="h-11 w-full rounded-2xl border border-border bg-card-elevated px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </Field>
        <Field label={t("meusMercados.fields.city")}>
          <input
            type="text"
            value={form.cidade}
            onChange={(e) => setForm({ ...form, cidade: e.target.value })}
            placeholder={t("meusMercados.fields.cityPlaceholder")}
            className="h-11 w-full rounded-2xl border border-border bg-card-elevated px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </Field>
        <Field label={t("meusMercados.fields.note")} className="md:col-span-2">
          <textarea
            value={form.observacao}
            onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            placeholder={t("meusMercados.fields.notePlaceholder")}
            rows={3}
            className="min-h-[88px] w-full rounded-2xl border border-border bg-card-elevated px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </Field>

        <div className="md:col-span-2 mt-1 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-card-elevated"
          >
            {t("meusMercados.cancel")}
          </button>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-5 text-sm font-semibold text-primary-foreground shadow-elevated active:scale-[0.99]"
          >
            <Check className="h-4 w-4" />
            {isEdit ? t("meusMercados.saveEdit") : t("meusMercados.save")}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  required,
  requiredLabel,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  requiredLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5 min-w-0", className)}>
      <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
        {required && (
          <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-destructive">
            {requiredLabel}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function MercadoCard({
  m,
  t,
  dateFormatter,
  onEdit,
  onRemove,
  onToggleFav,
  isEditing,
}: {
  m: MercadoLocal;
  t: (k: string, opts?: Record<string, unknown>) => string;
  dateFormatter: Intl.DateTimeFormat;
  onEdit: () => void;
  onRemove: () => void;
  onToggleFav: () => void;
  isEditing: boolean;
}) {
  const localizacao = [m.endereco, m.bairro, m.cidade].filter(Boolean).join(" · ");
  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-3xl border bg-card p-4 shadow-card md:p-5",
        isEditing ? "border-brand/50 ring-1 ring-brand/30" : "border-border/60",
      )}
    >
      <header className="flex items-start gap-3 min-w-0">
        <span
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 ring-border/60",
            m.favorito
              ? "bg-warning/10 text-warning"
              : "bg-brand-soft text-brand",
          )}
        >
          <Store className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold md:text-lg">{m.nome}</h3>
            {m.favorito && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-warning">
                <Star className="h-3 w-3" />
                {t("meusMercados.card.favorite")}
              </span>
            )}
          </div>
          {localizacao && (
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {localizacao}
            </p>
          )}
        </div>
      </header>

      {m.observacao && (
        <p className="rounded-2xl bg-card-elevated px-3 py-2 text-[13px] leading-snug text-foreground">
          {m.observacao}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        {t("meusMercados.card.createdAt", {
          date: dateFormatter.format(new Date(m.criadoEm)),
        })}
      </p>

      <div className="mt-auto flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onToggleFav}
          aria-label={
            m.favorito
              ? t("meusMercados.card.unmarkFavorite")
              : t("meusMercados.card.markFavorite")
          }
          className={cn(
            "inline-flex h-10 items-center justify-center gap-1.5 rounded-2xl border px-3 text-[12px] font-semibold transition-colors active:scale-[0.99]",
            m.favorito
              ? "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15"
              : "border-border bg-card text-foreground hover:bg-card-elevated",
          )}
        >
          <Star className={cn("h-4 w-4", m.favorito && "fill-current")} />
          {m.favorito
            ? t("meusMercados.card.unmarkFavorite")
            : t("meusMercados.card.markFavorite")}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-2xl border border-border bg-card px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-card-elevated active:scale-[0.99]"
        >
          <Pencil className="h-4 w-4" />
          {t("meusMercados.card.edit")}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 text-[12px] font-semibold text-destructive transition-colors hover:bg-destructive/10 active:scale-[0.99]"
        >
          <Trash2 className="h-4 w-4" />
          {t("meusMercados.card.remove")}
        </button>
      </div>
    </article>
  );
}
