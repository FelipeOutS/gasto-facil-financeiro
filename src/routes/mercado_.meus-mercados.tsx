import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Home,
  MapPin,
  Info,
  Plus,
  Star,
  Pencil,
  Trash2,
  Save,
  X,
  Store,
} from "lucide-react";
import { NearbyMarkets } from "@/components/mercado/NearbyMarkets";
import { useState } from "react";
import { toast } from "sonner";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { confirmAsync } from "@/components/ConfirmDialog";
import {
  useMercadosLocais,
  addMercadoLocal,
  updateMercadoLocal,
  removeMercadoLocal,
  toggleMercadoFavorito,
  type MercadoLocal,
  type MercadoLocalInput,
} from "@/lib/mercado/mercados-store";

export const Route = createFileRoute("/mercado_/meus-mercados")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:meusMercados.metaTitle", { lng: i18n.language }) }],
  }),
  component: MeusMercadosPage,
});

type FormState = MercadoLocalInput;

const EMPTY_FORM: FormState = {
  nome: "",
  cep: "",
  endereco: "",
  bairro: "",
  cidade: "",
  uf: "",
  observacao: "",
  favorito: false,
};

function maskCep(v: string): string {
  const digits = v.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function MeusMercadosPage() {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();
  const mercados = useMercadosLocais();

  const [mode, setMode] = useState<"list" | "new" | { edit: string }>("list");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setMode("new");
  }

  function openEdit(m: MercadoLocal) {
    setForm({
      nome: m.nome,
      cep: m.cep ?? "",
      endereco: m.endereco ?? "",
      bairro: m.bairro ?? "",
      cidade: m.cidade ?? "",
      uf: m.uf ?? "",
      observacao: m.observacao ?? "",
      favorito: m.favorito ?? false,
    });
    setMode({ edit: m.id });
  }

  function cancel() {
    setMode("list");
    setForm(EMPTY_FORM);
  }

  function save() {
    const nome = (form.nome ?? "").trim();
    if (!nome) {
      toast.error(t("meusMercados.toast.nameRequired"));
      return;
    }
    if (mode === "new") {
      const created = addMercadoLocal(form);
      if (!created) {
        toast.error(t("meusMercados.toast.nameRequired"));
        return;
      }
      toast.success(t("meusMercados.toast.added"));
    } else if (typeof mode === "object" && "edit" in mode) {
      const updated = updateMercadoLocal(mode.edit, form);
      if (!updated) {
        toast.error(t("meusMercados.toast.nameRequired"));
        return;
      }
      toast.success(t("meusMercados.toast.updated"));
    }
    setMode("list");
    setForm(EMPTY_FORM);
  }

  async function handleRemove(m: MercadoLocal) {
    const ok = await confirmAsync({ title: t("meusMercados.confirmRemove"), destructive: true });
    if (!ok) return;
    const success = removeMercadoLocal(m.id);
    if (success) toast.success(t("meusMercados.toast.removed"));
  }

  function handleToggleFav(m: MercadoLocal) {
    const next = toggleMercadoFavorito(m.id);
    if (!next) return;
    toast.success(
      next.favorito
        ? t("meusMercados.toast.favOn")
        : t("meusMercados.toast.favOff"),
    );
  }

  const isNew = mode === "new";
  const editingId = typeof mode === "object" && "edit" in mode ? mode.edit : null;

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
            {t("meusMercados.localNotice")}
          </p>
        </div>
      </header>

      <section className="mt-4 rounded-3xl border border-border/60 bg-card-elevated p-4 shadow-card md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card text-brand ring-1 ring-border/60">
            <Info className="h-4 w-4" />
          </span>
          <p className="min-w-0 text-sm leading-snug text-foreground md:text-[15px]">
            {t("meusMercados.infoCard")}
          </p>
        </div>
      </section>

      <section className="mt-4">
        <NearbyMarkets />
      </section>



      {mode === "list" && (
        <div className="mt-5 flex items-center justify-between gap-3">
          <h2 className="truncate text-base font-semibold md:text-lg">
            {t("meusMercados.list.title")}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({t("meusMercados.list.count", { count: mercados.length })})
            </span>
          </h2>
          <Button
            type="button"
            onClick={openNew}
            className="min-h-11 rounded-full font-semibold"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t("meusMercados.addCta")}</span>
            <span className="sm:hidden">{t("meusMercados.addCtaShort")}</span>
          </Button>
        </div>
      )}

      {isNew && (
        <div className="mt-5">
          <MercadoForm
            title={t("meusMercados.newFormTitle")}
            form={form}
            setForm={setForm}
            onSave={save}
            onCancel={cancel}
            saveLabel={t("meusMercados.save")}
          />
        </div>
      )}

      {mercados.length === 0 && mode === "list" && (
        <div className="mt-5">
          <EmptyState
            icon={<Store className="h-6 w-6" />}
            title={t("meusMercados.empty.title")}
            description={t("meusMercados.empty.desc")}
            ctaLabel={t("meusMercados.emptyCta")}
            onCta={openNew}
            variant="premium"
          />
        </div>
      )}

      {mercados.length > 0 && (
        <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {mercados.map((m) =>
            editingId === m.id ? (
              <div key={m.id} className="md:col-span-2 xl:col-span-3">
                <MercadoForm
                  title={t("meusMercados.editingTitle")}
                  form={form}
                  setForm={setForm}
                  onSave={save}
                  onCancel={cancel}
                  saveLabel={t("meusMercados.saveEdit")}
                />
              </div>
            ) : (
              <MercadoCard
                key={m.id}
                m={m}
                onEdit={() => openEdit(m)}
                onRemove={() => handleRemove(m)}
                onToggleFav={() => handleToggleFav(m)}
                t={t}
              />
            ),
          )}
        </section>
      )}
    </MobileShell>
  );
}

function MercadoCard({
  m,
  onEdit,
  onRemove,
  onToggleFav,
  t,
}: {
  m: MercadoLocal;
  onEdit: () => void;
  onRemove: () => void;
  onToggleFav: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const linha = [m.endereco, m.bairro].filter(Boolean).join(" • ");
  const cidadeUf = [m.cidade, m.uf].filter(Boolean).join(" / ");

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
          <Store className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate text-base font-semibold md:text-lg">
              {m.nome}
            </h3>
            {m.favorito && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400"
                aria-label={t("meusMercados.card.favorite")}
              >
                <Star className="h-3 w-3 fill-current" />
                {t("meusMercados.card.favorite")}
              </span>
            )}
          </div>
          {(linha || cidadeUf) && (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {[linha, cidadeUf].filter(Boolean).join(" — ")}
            </p>
          )}
          {m.cep && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {t("meusMercados.fields.cep")}: {maskCep(m.cep)}
            </p>
          )}
          {m.observacao && (
            <p className="mt-2 line-clamp-3 text-sm text-foreground/90">
              {m.observacao}
            </p>
          )}
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToggleFav}
          className="min-h-11 rounded-full"
          aria-label={
            m.favorito
              ? t("meusMercados.card.unmarkFavorite")
              : t("meusMercados.card.markFavorite")
          }
        >
          <Star
            className={`h-4 w-4 ${m.favorito ? "fill-current text-amber-500" : ""}`}
          />
          {m.favorito
            ? t("meusMercados.card.unmarkFavorite")
            : t("meusMercados.card.markFavorite")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onEdit}
          className="min-h-11 rounded-full"
        >
          <Pencil className="h-4 w-4" />
          {t("meusMercados.card.edit")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRemove}
          className="min-h-11 rounded-full text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          {t("meusMercados.card.remove")}
        </Button>
      </div>
    </article>
  );
}

function MercadoForm({
  title,
  form,
  setForm,
  onSave,
  onCancel,
  saveLabel,
}: {
  title: string;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  const { t } = useTranslation("mercado");

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5"
    >
      <h3 className="text-base font-semibold md:text-lg">{title}</h3>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="mkt-nome">
            {t("meusMercados.fields.name")}{" "}
            <span className="text-destructive">*</span>
          </Label>
          <Input
            id="mkt-nome"
            value={form.nome ?? ""}
            onChange={(e) => update("nome", e.target.value)}
            placeholder={t("meusMercados.fields.namePlaceholder")}
            autoComplete="off"
            className="mt-1"
            required
          />
        </div>

        <div>
          <Label htmlFor="mkt-cep">{t("meusMercados.fields.cep")}</Label>
          <Input
            id="mkt-cep"
            value={maskCep(form.cep ?? "")}
            onChange={(e) => update("cep", e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder={t("meusMercados.fields.cepPlaceholder")}
            inputMode="numeric"
            autoComplete="off"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="mkt-uf">{t("meusMercados.fields.uf")}</Label>
          <Input
            id="mkt-uf"
            value={form.uf ?? ""}
            onChange={(e) =>
              update(
                "uf",
                e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase(),
              )
            }
            placeholder={t("meusMercados.fields.ufPlaceholder")}
            maxLength={2}
            autoComplete="off"
            className="mt-1"
          />
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="mkt-endereco">
            {t("meusMercados.fields.address")}
          </Label>
          <Input
            id="mkt-endereco"
            value={form.endereco ?? ""}
            onChange={(e) => update("endereco", e.target.value)}
            placeholder={t("meusMercados.fields.addressPlaceholder")}
            autoComplete="off"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="mkt-bairro">
            {t("meusMercados.fields.neighborhood")}
          </Label>
          <Input
            id="mkt-bairro"
            value={form.bairro ?? ""}
            onChange={(e) => update("bairro", e.target.value)}
            placeholder={t("meusMercados.fields.neighborhoodPlaceholder")}
            autoComplete="off"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="mkt-cidade">{t("meusMercados.fields.city")}</Label>
          <Input
            id="mkt-cidade"
            value={form.cidade ?? ""}
            onChange={(e) => update("cidade", e.target.value)}
            placeholder={t("meusMercados.fields.cityPlaceholder")}
            autoComplete="off"
            className="mt-1"
          />
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="mkt-obs">{t("meusMercados.fields.note")}</Label>
          <Textarea
            id="mkt-obs"
            value={form.observacao ?? ""}
            onChange={(e) => update("observacao", e.target.value)}
            placeholder={t("meusMercados.fields.notePlaceholder")}
            className="mt-1 min-h-[80px]"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" className="min-h-11 rounded-full font-semibold">
          <Save className="h-4 w-4" />
          {saveLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="min-h-11 rounded-full"
        >
          <X className="h-4 w-4" />
          {t("meusMercados.cancel")}
        </Button>
      </div>
    </form>
  );
}
