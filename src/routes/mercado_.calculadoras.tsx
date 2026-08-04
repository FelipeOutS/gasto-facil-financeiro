import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Home,
  Plus,
  Trash2,
  Scale,
  Calculator,
  ShoppingBasket,
  TrendingDown,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Money } from "@/components/Money";
import { MercadoBanner } from "@/components/mercado/shell/MercadoBanner";
import bannerComunitario from "@/assets/mercado/banner-comunitario.jpg";
import bannerComunitarioWebp from "@/assets/mercado/banner-comunitario.webp";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/mercado_/calculadoras")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:meta.calculadorasTitle", { lng: i18n.language }) }],
  }),
  component: CalculadorasPage,
});

type Unit = "g" | "kg" | "ml" | "L" | "un";
type UnitGroup = "mass" | "volume" | "unit";

const UNITS: Unit[] = ["g", "kg", "ml", "L", "un"];

function unitGroup(u: Unit): UnitGroup {
  if (u === "g" || u === "kg") return "mass";
  if (u === "ml" || u === "L") return "volume";
  return "unit";
}

function baseUnitLabel(g: UnitGroup): "kg" | "L" | "un" {
  return g === "mass" ? "kg" : g === "volume" ? "L" : "un";
}

// Convert a quantity in unit u into the canonical base unit of its group.
function toBase(qty: number, u: Unit): number {
  switch (u) {
    case "g":
      return qty / 1000;
    case "kg":
      return qty;
    case "ml":
      return qty / 1000;
    case "L":
      return qty;
    case "un":
      return qty;
  }
}

function parseNumber(value: string): number | undefined {
  if (!value) return undefined;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function CalculadorasPage() {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();

  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("calculators.back")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("calculators.home")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight tracking-tight line-clamp-2 md:text-3xl">
            {t("calculators.title")}
          </h1>
          <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground md:text-base">
            {t("calculators.subtitle")}
          </p>
        </div>
        <span className="hidden h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60 md:grid">
          <Calculator className="h-6 w-6" />
        </span>
      </header>

      <div className="mt-4">
        <MercadoBanner
          tone="community"
          title={t("calculatorsV2.banner.title")}
          subtitle={t("calculatorsV2.banner.subtitle")}
          imageSrc={bannerComunitario}
          imageSrcWebp={bannerComunitarioWebp}
        />
      </div>

      <div className="mt-4 rounded-2xl border border-border/60 bg-card-elevated/60 p-3">
        <p className="text-sm font-semibold text-foreground">{t("calculatorsV2.intro.title")}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
          {t("calculatorsV2.intro.description")}
        </p>
      </div>

      <section className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CompareCard />
        <EstimateCard />
      </section>

      <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          to="/mercado/carrinho"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground shadow-card transition-all hover:bg-card-elevated active:scale-[0.98]"
        >
          {t("calculatorsV2.cta.goToCart")}
        </Link>
        <Link
          to="/mercado/listas/nova"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
        >
          {t("calculatorsV2.cta.createList")}
        </Link>
      </section>

      <p className="mt-4 rounded-2xl border border-border/60 bg-card-elevated/60 p-3 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
        💡 {t("calculatorsV2.tips.lowestPrice")} {t("calculatorsV2.tips.validity")}
      </p>
    </MobileShell>
  );
}

// ----------------- Compare price by unit -----------------

type ProductInput = {
  name: string;
  price: string;
  quantity: string;
  unit: Unit;
};

function emptyProduct(unit: Unit = "kg"): ProductInput {
  return { name: "", price: "", quantity: "", unit };
}

function CompareCard() {
  const { t } = useTranslation("mercado");
  const [a, setA] = useState<ProductInput>(() => emptyProduct("kg"));
  const [b, setB] = useState<ProductInput>(() => emptyProduct("kg"));

  const result = useMemo(() => computeCompare(a, b), [a, b]);

  return (
    <article className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
          <Scale className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold md:text-lg">{t("calculators.compare.title")}</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
            {t("calculators.compare.subtitle")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ProductFields
          label={t("calculators.compare.productA")}
          value={a}
          onChange={setA}
          idPrefix="prod-a"
        />
        <ProductFields
          label={t("calculators.compare.productB")}
          value={b}
          onChange={setB}
          idPrefix="prod-b"
        />
      </div>

      <CompareResult result={result} a={a} b={b} />
    </article>
  );
}

function ProductFields({
  label,
  value,
  onChange,
  idPrefix,
}: {
  label: string;
  value: ProductInput;
  onChange: (next: ProductInput) => void;
  idPrefix: string;
}) {
  const { t } = useTranslation("mercado");
  return (
    <div className="rounded-2xl border border-border/60 bg-card-elevated/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2.5">
        <div>
          <label htmlFor={`${idPrefix}-name`} className="sr-only">
            {t("calculators.compare.name")}
          </label>
          <input
            id={`${idPrefix}-name`}
            type="text"
            maxLength={60}
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder={t("calculators.compare.namePlaceholder")}
            className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label
              htmlFor={`${idPrefix}-price`}
              className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {t("calculators.compare.price")}
            </label>
            <input
              id={`${idPrefix}-price`}
              type="text"
              inputMode="decimal"
              maxLength={12}
              value={value.price}
              onChange={(e) =>
                onChange({ ...value, price: e.target.value.replace(/[^\d.,]/g, "") })
              }
              placeholder="0,00"
              className="mt-1.5 w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-qty`}
              className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {t("calculators.compare.quantity")}
            </label>
            <input
              id={`${idPrefix}-qty`}
              type="text"
              inputMode="decimal"
              maxLength={10}
              value={value.quantity}
              onChange={(e) =>
                onChange({ ...value, quantity: e.target.value.replace(/[^\d.,]/g, "") })
              }
              placeholder="0"
              className="mt-1.5 w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-unit`}
            className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {t("calculators.compare.unit")}
          </label>
          <select
            id={`${idPrefix}-unit`}
            value={value.unit}
            onChange={(e) => onChange({ ...value, unit: e.target.value as Unit })}
            className="mt-1.5 w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-base text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`calculators.compare.units.${u}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

type CompareResultData =
  | { kind: "incomplete" }
  | { kind: "incompatible" }
  | {
      kind: "ready";
      group: UnitGroup;
      baseLabel: "kg" | "L" | "un";
      priceA: number;
      priceB: number;
      winner: "A" | "B" | "tie";
      diff: number;
      percent: number;
    };

function computeCompare(a: ProductInput, b: ProductInput): CompareResultData {
  const pa = parseNumber(a.price);
  const qa = parseNumber(a.quantity);
  const pb = parseNumber(b.price);
  const qb = parseNumber(b.quantity);
  if (pa === undefined || qa === undefined || pb === undefined || qb === undefined) {
    return { kind: "incomplete" };
  }
  if (pa <= 0 || qa <= 0 || pb <= 0 || qb <= 0) return { kind: "incomplete" };
  const ga = unitGroup(a.unit);
  const gb = unitGroup(b.unit);
  if (ga !== gb) return { kind: "incompatible" };
  const baseA = toBase(qa, a.unit);
  const baseB = toBase(qb, b.unit);
  if (baseA <= 0 || baseB <= 0) return { kind: "incomplete" };
  const priceA = pa / baseA;
  const priceB = pb / baseB;
  const diff = Math.abs(priceA - priceB);
  const cheaper = Math.min(priceA, priceB);
  const moreExpensive = Math.max(priceA, priceB);
  const percent = moreExpensive === 0 ? 0 : Math.round((diff / moreExpensive) * 100);
  const winner: "A" | "B" | "tie" = percent < 1 ? "tie" : priceA < priceB ? "A" : "B";
  return {
    kind: "ready",
    group: ga,
    baseLabel: baseUnitLabel(ga),
    priceA,
    priceB,
    winner,
    diff,
    percent,
  };
}

function CompareResult({
  result,
  a,
  b,
}: {
  result: CompareResultData;
  a: ProductInput;
  b: ProductInput;
}) {
  const { t } = useTranslation("mercado");

  if (result.kind === "incomplete") {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card-elevated/40 p-4 text-center">
        <p className="text-sm text-muted-foreground">{t("calculators.compare.fillBoth")}</p>
      </div>
    );
  }

  if (result.kind === "incompatible") {
    return (
      <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-center">
        <p className="text-sm font-medium text-warning">
          {t("calculators.compare.incompatibleUnits")}
        </p>
      </div>
    );
  }

  const nameA = a.name.trim() || t("calculators.compare.productAFallback");
  const nameB = b.name.trim() || t("calculators.compare.productBFallback");
  const unitLabel = result.baseLabel;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <UnitPriceTile
          name={nameA}
          price={result.priceA}
          unit={unitLabel}
          highlight={result.winner === "A"}
        />
        <UnitPriceTile
          name={nameB}
          price={result.priceB}
          unit={unitLabel}
          highlight={result.winner === "B"}
        />
      </div>
      <div
        className={cn(
          "rounded-2xl p-4 text-center ring-1",
          result.winner === "tie"
            ? "bg-card-elevated text-foreground ring-border/60"
            : "bg-success/10 text-success ring-success/30",
        )}
      >
        <p className="text-sm font-semibold">
          {result.winner === "tie"
            ? t("calculators.compare.samePrice", { unit: unitLabel })
            : t("calculators.compare.bestOption", {
                name: result.winner === "A" ? nameA : nameB,
                percent: result.percent,
                unit: unitLabel,
              })}
        </p>
        {result.winner !== "tie" && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            {t("calculators.compare.cheaperBy", {
              amount: formatBRL(result.diff),
              unit: unitLabel,
            })}
          </p>
        )}
      </div>
    </div>
  );
}

function UnitPriceTile({
  name,
  price,
  unit,
  highlight,
}: {
  name: string;
  price: number;
  unit: string;
  highlight: boolean;
}) {
  const { t } = useTranslation("mercado");
  return (
    <div
      className={cn(
        "rounded-2xl border p-3 transition-colors",
        highlight ? "border-success/40 bg-success/10" : "border-border/60 bg-card-elevated/60",
      )}
    >
      <p className="truncate text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {name}
      </p>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
        {t("calculators.compare.unitPrice", { unit })}
      </p>
      <p
        className={cn(
          "mt-1 truncate text-lg font-bold tabular-nums",
          highlight ? "text-success" : "text-foreground",
        )}
      >
        <Money value={price} />
      </p>
    </div>
  );
}

function formatBRL(n: number): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
  } catch {
    return `R$ ${n.toFixed(2)}`;
  }
}

// ----------------- Estimate (temporary list) -----------------

type EstimateItem = {
  id: string;
  name: string;
  value: number;
  quantity: number;
};

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `est_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function EstimateCard() {
  const { t } = useTranslation("mercado");
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [budget, setBudget] = useState("");

  const total = useMemo(() => items.reduce((acc, it) => acc + it.value * it.quantity, 0), [items]);
  const budgetNum = parseNumber(budget);
  const hasBudget = budgetNum !== undefined && budgetNum > 0;
  const over = hasBudget && total > (budgetNum as number);
  const diff = hasBudget ? Math.abs(total - (budgetNum as number)) : 0;

  function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("calculators.estimate.requiredName"));
      return;
    }
    const v = parseNumber(value) ?? 0;
    const q = parseNumber(quantity) ?? 1;
    setItems((cur) => [...cur, { id: genId(), name: trimmed, value: v, quantity: q > 0 ? q : 1 }]);
    setName("");
    setValue("");
    setQuantity("1");
  }

  function handleRemove(id: string) {
    setItems((cur) => cur.filter((it) => it.id !== id));
  }

  return (
    <article className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
          <ShoppingBasket className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold md:text-lg">{t("calculators.estimate.title")}</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
            {t("calculators.estimate.subtitle")}
          </p>
        </div>
      </div>

      <form onSubmit={handleAdd} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label
            htmlFor="est-name"
            className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {t("calculators.estimate.itemName")}
          </label>
          <input
            id="est-name"
            type="text"
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("calculators.estimate.itemPlaceholder")}
            className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div>
          <label
            htmlFor="est-value"
            className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {t("calculators.estimate.value")}
          </label>
          <input
            id="est-value"
            type="text"
            inputMode="decimal"
            maxLength={12}
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="0,00"
            className="mt-1.5 w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div>
          <label
            htmlFor="est-qty"
            className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {t("calculators.estimate.quantity")}
          </label>
          <input
            id="est-qty"
            type="text"
            inputMode="decimal"
            maxLength={8}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^\d.,]/g, ""))}
            className="mt-1.5 w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-base text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div className="sm:col-span-2 flex justify-end">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-5 py-3 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            {t("calculators.estimate.add")}
          </button>
        </div>
      </form>

      <div>
        <label
          htmlFor="est-budget"
          className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
        >
          {t("calculators.estimate.budget")}
        </label>
        <input
          id="est-budget"
          type="text"
          inputMode="decimal"
          maxLength={12}
          value={budget}
          onChange={(e) => setBudget(e.target.value.replace(/[^\d.,]/g, ""))}
          placeholder={t("calculators.estimate.budgetPlaceholder")}
          className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card-elevated/40 p-4 text-center">
          <p className="text-sm text-muted-foreground">{t("calculators.estimate.empty")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card-elevated/60 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{it.name}</p>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {it.quantity} · <Money value={it.value * it.quantity} />
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(it.id)}
                aria-label={t("calculators.estimate.remove")}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive transition-colors hover:bg-destructive/15 active:scale-95"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border/60 bg-card-elevated/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("calculators.estimate.total")}
          </p>
          <p className="mt-0.5 truncate text-lg font-bold tabular-nums text-foreground">
            <Money value={total} />
          </p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card-elevated/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("calculators.estimate.items")}
          </p>
          <p className="mt-0.5 truncate text-lg font-bold tabular-nums text-foreground">
            {items.length}
          </p>
        </div>
      </div>

      {hasBudget && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-2xl p-4 ring-1",
            over
              ? "bg-warning/10 text-warning ring-warning/30"
              : "bg-success/10 text-success ring-success/30",
          )}
        >
          <TrendingDown className={cn("h-5 w-5 shrink-0", over && "rotate-180")} />
          <p className="text-sm font-medium">
            {over
              ? t("calculators.estimate.overBudget", { amount: formatBRL(diff) })
              : t("calculators.estimate.withinBudget")}
          </p>
        </div>
      )}
    </article>
  );
}
