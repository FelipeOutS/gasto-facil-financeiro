import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Trash2,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { CategoryIcon } from "@/components/CategoryIcon";
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
import { SettingsPageHeader } from "@/components/SettingsPageHeader";

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

export const Route = createFileRoute("/app/ajustes/preferencias-financeiras")({
  head: () => ({ meta: [{ title: "Preferências financeiras — Gasto Inteligente" }] }),
  component: PreferenciasFinanceirasPage,
});

function PreferenciasFinanceirasPage() {
  const { t } = useTranslation("categorias");
  const ready = useBootstrap();
  const categorias = useStore(() => getCategorias());
  const customCount = categorias.filter((c) => c.criadaPeloUsuario).length;
  const today = new Date();
  const mes = today.getMonth() + 1;
  const ano = today.getFullYear();
  const limiteTotal = useStore(() => getLimite("total", mes, ano));
  const [limiteStr, setLimiteStr] = useState(
    limiteTotal ? String(limiteTotal).replace(".", ",") : "",
  );

  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [iconName, setIconName] = useState<string>("ShoppingBag");
  const [colorHex, setColorHex] = useState<string>(COLOR_OPTIONS[0].hex);

  if (!ready) return <PageSkeleton />;

  return (
    <MobileShell>
      <SettingsPageHeader 
        title="Preferências financeiras" 
        description="Categorias, limites e organização das suas finanças." 
      />

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
    </MobileShell>
  );
}
