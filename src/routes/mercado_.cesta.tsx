import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Home,
  PackageCheck,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  ShoppingBasket,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { confirmAsync } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { MercadoBanner } from "@/components/mercado/shell/MercadoBanner";
import bannerCesta from "@/assets/mercado/hero-home.jpg";
import {
  type CestaTipo,
  type MercadoCestaPadrao,
  addCestaPadrao,
  addItemCesta,
  computeCestaTotal,
  gerarListaAPartirDaCesta,
  removeCestaPadrao,
  removeItemCesta,
  updateCestaPadrao,
  updateItemCesta,
  useCestasPadrao,
} from "@/lib/mercado/cesta-store";

export const Route = createFileRoute("/mercado_/cesta")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:cesta.metaTitle", { lng: i18n.language }) }],
  }),
  component: CestaPadraoPage,
});

const TIPOS: CestaTipo[] = [
  "compraMes",
  "reposicao",
  "limpeza",
  "farmacia",
  "churrasco",
  "outros",
];

function CestaPadraoPage() {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();
  const cestas = useCestasPadrao();

  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  function handleGenerate(c: MercadoCestaPadrao) {
    if (c.itens.length === 0) {
      toast.error(t("cesta.toasts.emptyItems"));
      return;
    }
    const lista = gerarListaAPartirDaCesta(c.id);
    if (!lista) {
      toast.error(t("cesta.toasts.generateError"));
      return;
    }
    toast.success(t("cesta.toasts.generated", { name: c.nome }));
    void navigate({ to: "/mercado/listas/$id", params: { id: lista.id } });
  }

  async function handleDelete(c: MercadoCestaPadrao) {
    const ok = await confirmAsync({ title: t("cesta.confirm.delete", { name: c.nome }), destructive: true });
    if (!ok) return;
    removeCestaPadrao(c.id);
    if (expandedId === c.id) setExpandedId(null);
    toast.success(t("cesta.toasts.deleted"));
  }

  return (
    <MobileShell wide>
      <header className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-11 min-w-11 items-center gap-1.5 rounded-2xl border border-border/60 bg-card px-3 text-sm font-medium text-foreground shadow-card transition-colors hover:bg-card-elevated"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{t("cesta.back")}</span>
        </button>
        <button
          type="button"
          onClick={() => void navigate({ to: "/app" })}
          className="inline-flex h-11 min-w-11 items-center gap-1.5 rounded-2xl border border-border/60 bg-card px-3 text-sm font-medium text-foreground shadow-card transition-colors hover:bg-card-elevated"
        >
          <Home className="h-4 w-4" />
          <span className="hidden sm:inline">{t("cesta.home")}</span>
        </button>
      </header>

      <div className="mt-4">
        <MercadoBanner
          title={t("basketV2.banner.title")}
          subtitle={t("basketV2.banner.subtitle")}
          imageSrc={bannerCesta}
          tone="pantry"
        />
      </div>

      <section className="mt-5 flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
          <PackageCheck className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t("cesta.title")}</h1>
          <p className="mt-1 text-sm leading-snug text-muted-foreground md:text-base">
            {t("cesta.subtitle")}
          </p>
        </div>
      </section>

      <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card-elevated text-brand ring-1 ring-border/60">
            <Info className="h-4 w-4" />
          </span>
          <p className="min-w-0 text-sm leading-snug text-foreground md:text-[15px]">
            {t("cesta.intro")}
          </p>
        </div>
      </section>

      {cestas.length === 0 && !showCreate ? (
        <EmptyState onCreate={() => setShowCreate(true)} />
      ) : (
        <div className="mt-5 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground md:text-lg">
            {t("cesta.yourBaskets", { count: cestas.length })}
          </h2>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-brand-grad px-4 text-sm font-semibold text-primary-foreground shadow-elevated transition-opacity hover:opacity-95"
          >
            <Plus className="h-4 w-4" />
            {t("cesta.newBasket")}
          </button>
        </div>
      )}

      {showCreate && (
        <CreateForm
          onCancel={() => setShowCreate(false)}
          onCreated={(c) => {
            setShowCreate(false);
            setExpandedId(c.id);
          }}
        />
      )}

      {cestas.length > 0 && (
        <section className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cestas.map((c) => (
            <BasketCard
              key={c.id}
              cesta={c}
              expanded={expandedId === c.id}
              onToggle={() => setExpandedId((cur) => (cur === c.id ? null : c.id))}
              onGenerate={() => handleGenerate(c)}
              onDelete={() => handleDelete(c)}
            />
          ))}
        </section>
      )}
    </MobileShell>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();
  return (
    <section className="mt-5 rounded-3xl border border-dashed border-border/60 bg-card p-6 text-center shadow-card md:p-8">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand">
        <ShoppingBasket className="h-7 w-7" />
      </span>
      <h2 className="mt-3 text-lg font-semibold text-foreground">{t("basketV2.empty.title")}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm leading-snug text-muted-foreground">
        {t("basketV2.empty.description")}
      </p>
      <ol className="mx-auto mt-4 grid max-w-xl grid-cols-1 gap-2 text-left sm:grid-cols-3">
        {(["add", "reuse", "compare"] as const).map((k, i) => (
          <li
            key={k}
            className="flex items-start gap-2 rounded-2xl border border-border/60 bg-card-elevated p-3"
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">
              {i + 1}
            </span>
            <p className="text-[12px] leading-snug text-foreground">
              {t(`basketV2.steps.${k}`)}
            </p>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-brand-grad px-4 text-sm font-semibold text-primary-foreground shadow-elevated transition-opacity hover:opacity-95"
        >
          <Plus className="h-4 w-4" />
          {t("basketV2.empty.addProduct")}
        </button>
        <button
          type="button"
          onClick={() => void navigate({ to: "/mercado/listas/nova" })}
          className="inline-flex h-11 items-center gap-1.5 rounded-2xl border border-border/60 bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-card-elevated"
        >
          {t("basketV2.empty.createList")}
        </button>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">{t("basketV2.helper")}</p>
    </section>
  );
}

function CreateForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (c: MercadoCestaPadrao) => void;
}) {
  const { t } = useTranslation("mercado");
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<CestaTipo>("compraMes");
  const [descricao, setDescricao] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = nome.trim();
    if (!n) {
      toast.error(t("cesta.form.errors.nameRequired"));
      return;
    }
    const c = addCestaPadrao({ nome: n, tipo, descricao: descricao.trim() || undefined });
    toast.success(t("cesta.toasts.created", { name: c.nome }));
    setNome("");
    setDescricao("");
    onCreated(c);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5"
    >
      <h3 className="text-base font-semibold text-foreground md:text-lg">
        {t("cesta.form.title")}
      </h3>
      <div className="mt-3 grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("cesta.form.nameLabel")}
          </span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={t("cesta.form.namePlaceholder")}
            className="h-11 rounded-xl border border-border/60 bg-card-elevated px-3 text-sm text-foreground outline-none transition-colors focus:border-brand"
            maxLength={60}
          />
        </label>

        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("cesta.form.typeLabel")}
          </span>
          <div className="flex flex-wrap gap-2">
            {TIPOS.map((tp) => (
              <button
                key={tp}
                type="button"
                onClick={() => setTipo(tp)}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-3 text-xs font-medium transition-colors",
                  tipo === tp
                    ? "border-transparent bg-brand-grad text-primary-foreground"
                    : "border-border/60 bg-card-elevated text-foreground hover:bg-card",
                )}
              >
                {t(`cesta.types.${tp}`)}
              </button>
            ))}
          </div>
        </div>

        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("cesta.form.descriptionLabel")}
          </span>
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder={t("cesta.form.descriptionPlaceholder")}
            rows={2}
            className="min-h-[44px] resize-none rounded-xl border border-border/60 bg-card-elevated px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-brand"
            maxLength={160}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-11 items-center rounded-2xl border border-border/60 bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-card-elevated"
        >
          {t("cesta.form.cancel")}
        </button>
        <button
          type="submit"
          className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-brand-grad px-4 text-sm font-semibold text-primary-foreground shadow-elevated transition-opacity hover:opacity-95"
        >
          <Plus className="h-4 w-4" />
          {t("cesta.form.submit")}
        </button>
      </div>
    </form>
  );
}

function BasketCard({
  cesta,
  expanded,
  onToggle,
  onGenerate,
  onDelete,
}: {
  cesta: MercadoCestaPadrao;
  expanded: boolean;
  onToggle: () => void;
  onGenerate: () => void;
  onDelete: () => void;
}) {
  const { t, i18n: i18nInst } = useTranslation("mercado");
  const total = useMemo(() => computeCestaTotal(cesta), [cesta]);
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18nInst.language === "en" ? "en-US" : "pt-BR", {
        day: "2-digit",
        month: "short",
      }),
    [i18nInst.language],
  );

  return (
    <article className="flex flex-col gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
          <ShoppingBasket className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground md:text-base">
            {cesta.nome}
          </h3>
          <p className="mt-0.5 truncate text-[11px] uppercase tracking-wider text-muted-foreground md:text-xs">
            {t(`cesta.types.${cesta.tipo}`)}
          </p>
        </div>
      </header>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-card-elevated px-2 py-2">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("cesta.card.items")}
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
            {cesta.itens.length}
          </dd>
        </div>
        <div className="rounded-2xl bg-card-elevated px-2 py-2">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("cesta.card.estimated")}
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
            {formatBRL(total)}
          </dd>
        </div>
        <div className="rounded-2xl bg-card-elevated px-2 py-2">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("cesta.card.updated")}
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
            {dateFmt.format(new Date(cesta.atualizadoEm))}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-border/60 bg-card-elevated px-3 text-sm font-medium text-foreground transition-colors hover:bg-card"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-4 w-4" />
              {t("cesta.card.close")}
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              {t("cesta.card.openEdit")}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onGenerate}
          className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-brand-grad px-3 text-sm font-semibold text-primary-foreground shadow-elevated transition-opacity hover:opacity-95"
        >
          {t("cesta.card.generate")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("cesta.card.delete")}
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-border/60 bg-card text-destructive transition-colors hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {expanded && <EditPanel cesta={cesta} />}
    </article>
  );
}

function EditPanel({ cesta }: { cesta: MercadoCestaPadrao }) {
  const { t } = useTranslation("mercado");
  const [nome, setNome] = useState(cesta.nome);
  const [tipo, setTipo] = useState<CestaTipo>(cesta.tipo);
  const [descricao, setDescricao] = useState(cesta.descricao ?? "");

  // Add item form
  const [itemNome, setItemNome] = useState("");
  const [itemQtd, setItemQtd] = useState("1");
  const [itemUnidade, setItemUnidade] = useState("");
  const [itemPreco, setItemPreco] = useState("");

  function saveMeta() {
    updateCestaPadrao(cesta.id, {
      nome: nome.trim() || cesta.nome,
      tipo,
      descricao: descricao.trim() || undefined,
    });
    toast.success(t("cesta.toasts.saved"));
  }

  function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    const n = itemNome.trim();
    if (!n) {
      toast.error(t("cesta.form.errors.itemNameRequired"));
      return;
    }
    const qtd = Number(itemQtd.replace(",", "."));
    const preco = itemPreco ? Number(itemPreco.replace(",", ".")) : undefined;
    const created = addItemCesta(cesta.id, {
      nome: n,
      quantidade: Number.isFinite(qtd) && qtd > 0 ? qtd : 1,
      unidade: itemUnidade.trim() || undefined,
      precoEstimado:
        preco !== undefined && Number.isFinite(preco) && preco > 0 ? preco : undefined,
    });
    if (created) {
      setItemNome("");
      setItemQtd("1");
      setItemUnidade("");
      setItemPreco("");
    }
  }

  const previewQtd = Math.max(Number(itemQtd.replace(",", ".")) || 0, 0);
  const previewPreco = Math.max(Number(itemPreco.replace(",", ".")) || 0, 0);
  const previewSubtotal = previewQtd * previewPreco;

  return (
    <div className="mt-1 grid gap-4 border-t border-border/60 pt-4">
      {/* Meta */}
      <div className="grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("cesta.form.nameLabel")}
          </span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="h-11 rounded-xl border border-border/60 bg-card-elevated px-3 text-sm text-foreground outline-none transition-colors focus:border-brand"
            maxLength={60}
          />
        </label>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("cesta.form.typeLabel")}
          </span>
          <div className="flex flex-wrap gap-2">
            {TIPOS.map((tp) => (
              <button
                key={tp}
                type="button"
                onClick={() => setTipo(tp)}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-3 text-xs font-medium transition-colors",
                  tipo === tp
                    ? "border-transparent bg-brand-grad text-primary-foreground"
                    : "border-border/60 bg-card-elevated text-foreground hover:bg-card",
                )}
              >
                {t(`cesta.types.${tp}`)}
              </button>
            ))}
          </div>
        </div>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("cesta.form.descriptionLabel")}
          </span>
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={2}
            className="min-h-[44px] resize-none rounded-xl border border-border/60 bg-card-elevated px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-brand"
            maxLength={160}
          />
        </label>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={saveMeta}
            className="inline-flex h-10 items-center rounded-2xl border border-border/60 bg-card-elevated px-4 text-xs font-semibold text-foreground transition-colors hover:bg-card"
          >
            {t("cesta.form.saveMeta")}
          </button>
        </div>
      </div>

      {/* Items list */}
      <div>
        <h4 className="text-sm font-semibold text-foreground">{t("cesta.items.title")}</h4>
        {cesta.itens.length === 0 ? (
          <p className="mt-2 rounded-2xl bg-card-elevated px-3 py-3 text-xs text-muted-foreground">
            {t("cesta.items.empty")}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60">
            {cesta.itens.map((it) => (
              <ItemRow key={it.id} cestaId={cesta.id} item={it} />
            ))}
          </ul>
        )}
      </div>

      {/* Add item */}
      <form
        onSubmit={handleAddItem}
        className="grid gap-3 rounded-2xl border border-border/60 bg-card-elevated p-3"
      >
        <h4 className="text-sm font-semibold text-foreground">{t("cesta.addItem.title")}</h4>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t("cesta.addItem.hint")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("cesta.addItem.nameLabel")}
            </span>
            <input
              value={itemNome}
              onChange={(e) => setItemNome(e.target.value)}
              placeholder={t("cesta.addItem.namePlaceholder")}
              className="h-11 rounded-xl border border-border/60 bg-card px-3 text-sm text-foreground outline-none transition-colors focus:border-brand"
              maxLength={60}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("cesta.addItem.qtyLabel")}
            </span>
            <input
              value={itemQtd}
              onChange={(e) => setItemQtd(e.target.value)}
              inputMode="decimal"
              className="h-11 rounded-xl border border-border/60 bg-card px-3 text-sm tabular-nums text-foreground outline-none transition-colors focus:border-brand"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("cesta.addItem.unitLabel")}
            </span>
            <input
              value={itemUnidade}
              onChange={(e) => setItemUnidade(e.target.value)}
              placeholder={t("cesta.addItem.unitPlaceholder")}
              className="h-11 rounded-xl border border-border/60 bg-card px-3 text-sm text-foreground outline-none transition-colors focus:border-brand"
              maxLength={12}
            />
          </label>
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("cesta.addItem.unitPriceLabel")}
            </span>
            <input
              value={itemPreco}
              onChange={(e) => setItemPreco(e.target.value)}
              inputMode="decimal"
              placeholder={t("cesta.addItem.unitPricePlaceholder")}
              className="h-11 rounded-xl border border-border/60 bg-card px-3 text-sm tabular-nums text-foreground outline-none transition-colors focus:border-brand"
            />
          </label>
        </div>
        {previewQtd > 0 && previewPreco > 0 && (
          <p className="rounded-xl bg-brand-soft px-3 py-2 text-xs font-medium text-brand-on-soft">
            {previewQtd} × {formatBRL(previewPreco)} ={" "}
            <span className="font-semibold tabular-nums">{formatBRL(previewSubtotal)}</span>
          </p>
        )}
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-brand-grad px-4 text-sm font-semibold text-primary-foreground shadow-elevated transition-opacity hover:opacity-95"
        >
          <Plus className="h-4 w-4" />
          {t("cesta.addItem.submit")}
        </button>
      </form>
    </div>
  );
}

function ItemRow({
  cestaId,
  item,
}: {
  cestaId: string;
  item: MercadoCestaPadrao["itens"][number];
}) {
  const { t } = useTranslation("mercado");
  const [qtd, setQtd] = useState(String(item.quantidade));
  const [preco, setPreco] = useState(item.precoEstimado != null ? String(item.precoEstimado) : "");

  const subtotal = (Number(preco.replace(",", ".")) || 0) * (Number(qtd.replace(",", ".")) || 0);

  function commit() {
    const q = Number(qtd.replace(",", "."));
    const p = preco ? Number(preco.replace(",", ".")) : undefined;
    updateItemCesta(cestaId, item.id, {
      quantidade: Number.isFinite(q) && q > 0 ? q : item.quantidade,
      precoEstimado:
        p !== undefined && Number.isFinite(p) && p > 0 ? p : preco === "" ? undefined : item.precoEstimado,
    });
  }

  return (
    <li className="flex flex-col gap-2 bg-card p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.nome}</p>
        {item.unidade && (
          <p className="text-[11px] text-muted-foreground">{item.unidade}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span>{t("cesta.items.qty")}</span>
          <input
            value={qtd}
            onChange={(e) => setQtd(e.target.value)}
            onBlur={commit}
            inputMode="decimal"
            className="h-9 w-16 rounded-lg border border-border/60 bg-card-elevated px-2 text-sm tabular-nums text-foreground outline-none focus:border-brand"
          />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span>{t("cesta.items.price")}</span>
          <input
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            onBlur={commit}
            inputMode="decimal"
            placeholder="0"
            className="h-9 w-20 rounded-lg border border-border/60 bg-card-elevated px-2 text-sm tabular-nums text-foreground outline-none focus:border-brand"
          />
        </label>
        <span className="min-w-[72px] text-right text-sm font-semibold tabular-nums text-foreground">
          {formatBRL(subtotal)}
        </span>
        <button
          type="button"
          onClick={() => removeItemCesta(cestaId, item.id)}
          aria-label={t("cesta.items.remove")}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card-elevated text-destructive transition-colors hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
