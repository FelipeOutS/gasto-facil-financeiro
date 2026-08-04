import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Plus,
  Trash2,
  User as UserIcon,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
  PieChart,
  Check,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { CategoryIcon } from "@/components/CategoryIcon";
import { ZonaDeRiscoCard } from "@/components/DeleteAccountDialog";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { useAccent, ACCENTS } from "@/lib/accent";
import {
  addCategoria,
  deleteCategoria,
  getCategorias,
  getLimite,
  setLimite,
  useBootstrap,
  useStore,
} from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ICON_MAP } from "@/lib/categories";
import { formatBRL, parseBRLInput } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const COLOR_OPTIONS = [
  { name: "Verde", hex: "#34d399" },
  { name: "Laranja", hex: "#fb923c" },
  { name: "Rosa", hex: "#f472b6" },
  { name: "Roxo", hex: "#a78bfa" },
  { name: "Amarelo", hex: "#fde047" },
  { name: "Azul", hex: "#60a5fa" },
  { name: "Vermelho", hex: "#f87171" },
  { name: "Cinza", hex: "#94a3b8" },
  { name: "Magenta", hex: "#e879f9" },
  { name: "Marrom", hex: "#b08968" },
];

const ICON_OPTIONS = Object.keys(ICON_MAP);

export const Route = createFileRoute("/categorias")({
  head: () => ({ meta: [{ title: "Ajustes — Gasto Inteligente" }] }),
  component: CategoriasPage,
});

function CategoriasPage() {
  const { t } = useTranslation("categorias");
  const ready = useBootstrap();
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  const categorias = useStore(() => getCategorias());
  const customCount = categorias.filter((c) => c.criadaPeloUsuario).length;
  const today = new Date();
  const mes = today.getMonth() + 1;
  const ano = today.getFullYear();
  const limiteTotal = useStore(() => getLimite("total", mes, ano));
  const [limiteStr, setLimiteStr] = useState(
    limiteTotal ? String(limiteTotal).replace(".", ",") : "",
  );

  // New category dialog state
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [iconName, setIconName] = useState<string>("ShoppingBag");
  const [colorHex, setColorHex] = useState<string>(COLOR_OPTIONS[0].hex);

  if (!ready) return <PageSkeleton />;

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/app"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label={t("header.back")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("header.eyebrow")}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{t("header.title")}</h1>
        </div>
      </header>

      {/* Minha conta */}
      <Link
        to="/conta"
        className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-card-elevated"
      >
        <span className="grid h-9 w-9 place-items-center rounded-full bg-card-elevated">
          <UserIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("account.title")}</p>
          <p className="truncate text-xs text-muted-foreground">{t("account.subtitle")}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      {/* Atalho para Orçamento (especialmente útil no mobile) */}
      <Link
        to="/orcamento"
        className="mt-2 flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-card-elevated lg:hidden"
      >
        <span className="grid h-9 w-9 place-items-center rounded-full bg-card-elevated">
          <PieChart className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("budgetShortcut.title")}</p>
          <p className="truncate text-xs text-muted-foreground">{t("budgetShortcut.subtitle")}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      {/* Aparência */}
      <section className="mt-5 rounded-3xl border border-border bg-card p-5 animate-rise">
        <h2 className="text-sm font-semibold">{t("appearance.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("appearance.desc")}</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(
            [
              { id: "light", labelKey: "light", Icon: Sun },
              { id: "dark", labelKey: "dark", Icon: Moon },
              { id: "system", labelKey: "system", Icon: Monitor },
            ] as { id: ThemeChoice; labelKey: "light" | "dark" | "system"; Icon: typeof Sun }[]
          ).map(({ id, labelKey, Icon }) => {
            const active = theme === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                className={cn(
                  "flex flex-col items-center justify-center gap-1.5 rounded-2xl border px-3 py-3 text-xs font-medium transition-all card-press",
                  active
                    ? "border-brand bg-brand-soft text-brand-on-soft shadow-card"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={active}
              >
                <Icon className={cn("h-4 w-4", active && "text-brand")} />
                {t(`appearance.themes.${labelKey}`)}
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium text-foreground">{t("appearance.accentTitle")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("appearance.accentDesc")}</p>
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
            {ACCENTS.map((a) => {
              const active = accent === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAccent(a.id)}
                  className={cn(
                    "card-press group relative flex flex-col items-center gap-1.5 rounded-2xl border p-2 transition-all",
                    active
                      ? "border-brand bg-brand-soft shadow-card"
                      : "border-border bg-card hover:bg-card-elevated hover:border-brand/40",
                  )}
                  aria-pressed={active}
                  aria-label={a.label}
                >
                  <span
                    className={cn(
                      "relative grid h-8 w-8 place-items-center rounded-full ring-2 ring-offset-2 ring-offset-card transition-all",
                      active ? "ring-foreground/70 scale-105 animate-pop" : "ring-transparent",
                    )}
                    style={{ background: a.swatch }}
                  >
                    {active && (
                      <Check
                        className="h-4 w-4 drop-shadow-sm"
                        style={{ color: a.fgLight === "oklch(0.985 0 0)" ? "#fff" : "#111" }}
                        strokeWidth={3}
                      />
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-medium",
                      active ? "text-brand-on-soft" : "text-muted-foreground",
                    )}
                  >
                    {a.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Limite mensal */}
      <section className="mt-5 rounded-3xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">{t("limit.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("limit.desc")}</p>
        <div className="mt-3 flex gap-2">
          <div className="flex flex-1 items-baseline gap-2 rounded-xl bg-card-elevated px-3">
            <span className="text-sm font-semibold text-muted-foreground">R$</span>
            <Input
              inputMode="decimal"
              value={limiteStr}
              onChange={(e) => setLimiteStr(e.target.value)}
              placeholder={t("limit.placeholder")}
              className="num h-11 border-0 bg-transparent p-0 text-lg font-semibold !ring-0 focus-visible:!ring-0"
            />
          </div>
          <Button
            type="button"
            onClick={() => {
              const v = parseBRLInput(limiteStr);
              setLimite("total", v, mes, ano);
              toast.success(
                v > 0 ? t("limit.savedToast", { value: formatBRL(v) }) : t("limit.removedToast"),
              );
            }}
            className="h-11 rounded-xl"
          >
            {t("limit.save")}
          </Button>
        </div>
      </section>

      {/* Categorias */}
      <section className="mt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("categories.title")}</h2>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 rounded-full">
                <Plus className="mr-1 h-4 w-4" />
                {t("categories.new")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("categories.dialogTitle")}</DialogTitle>
                <DialogDescription>{t("categories.dialogDesc")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">{t("categories.name")}</Label>
                  <Input
                    placeholder={t("categories.namePlaceholder")}
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="mt-1 h-11 bg-card-elevated"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("categories.color")}</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {COLOR_OPTIONS.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => setColorHex(c.hex)}
                        className={cn(
                          "h-8 w-8 rounded-full border-2 transition-all",
                          colorHex === c.hex ? "border-foreground scale-110" : "border-transparent",
                        )}
                        style={{ background: c.hex }}
                        aria-label={t(`colors.${c.name}` as const, { defaultValue: c.name })}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("categories.icon")}</Label>
                  <div className="mt-2 grid grid-cols-6 gap-2">
                    {ICON_OPTIONS.map((name) => {
                      const Icon = ICON_MAP[name];
                      const active = name === iconName;
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setIconName(name)}
                          className={cn(
                            "grid h-10 w-10 place-items-center rounded-xl border transition-all",
                            active
                              ? "border-foreground/50 bg-card-elevated"
                              : "border-border bg-card",
                          )}
                          style={active ? { color: colorHex } : undefined}
                        >
                          <Icon className="h-4 w-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("categories.cancel")}
                </Button>
                <Button
                  disabled={!nome.trim()}
                  onClick={() => {
                    addCategoria({
                      nome: nome.trim(),
                      iconName,
                      colorHex,
                    });
                    toast.success(t("categories.createdToast"));
                    setNome("");
                    setOpen(false);
                  }}
                >
                  {t("categories.create")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {customCount === 0 && (
          <div className="mt-3 rounded-2xl border border-dashed border-border bg-card-elevated/40 p-4">
            <p className="text-sm font-semibold">{t("onboarding.title")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.description")}</p>
            <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(["create", "use", "track"] as const).map((key, idx) => (
                <li
                  key={key}
                  className="flex items-start gap-2 rounded-2xl border border-border/60 bg-card/50 p-2.5 text-[12px]"
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    {idx + 1}
                  </span>
                  <span className="leading-tight">{t(`onboarding.steps.${key}`)}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex flex-col items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-10 rounded-full"
                onClick={() => setOpen(true)}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("onboarding.cta")}
              </Button>
              <p className="max-w-xs text-center text-[11px] text-muted-foreground">
                {t("onboarding.helper")}
              </p>
            </div>
          </div>
        )}

        <ul className="mt-3 space-y-2">
          {categorias.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
            >
              <CategoryIcon categoria={c} />
              <span className="flex-1 truncate text-sm font-medium">{c.nome}</span>
              {c.criadaPeloUsuario && (
                <button
                  onClick={() => {
                    deleteCategoria(c.id);
                    toast.success(t("categories.deletedToast"));
                  }}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t("categories.deleteAria")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ===== Conta e privacidade ===== */}
      <section className="mt-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {t("privacy.eyebrow")}
        </p>
        <ZonaDeRiscoCard />
      </section>
    </MobileShell>
  );
}
