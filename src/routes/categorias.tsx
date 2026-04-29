import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Plus, Trash2, User as UserIcon, ChevronRight, Sun, Moon, Monitor, PieChart, Check } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { CategoryIcon } from "@/components/CategoryIcon";
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
  head: () => ({ meta: [{ title: "Ajustes — Gasto Fácil" }] }),
  component: CategoriasPage,
});

function CategoriasPage() {
  const ready = useBootstrap();
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  const categorias = useStore(() => getCategorias());
  const today = new Date();
  const mes = today.getMonth() + 1;
  const ano = today.getFullYear();
  const limiteTotal = useStore(() => getLimite("total", mes, ano));
  const [limiteStr, setLimiteStr] = useState(limiteTotal ? String(limiteTotal).replace(".", ",") : "");

  // New category dialog state
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [iconName, setIconName] = useState<string>("ShoppingBag");
  const [colorHex, setColorHex] = useState<string>(COLOR_OPTIONS[0].hex);

  if (!ready) return <MobileShell><div /></MobileShell>;

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Ajustes</p>
          <h1 className="text-2xl font-bold tracking-tight">Categorias e limites</h1>
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
          <p className="text-sm font-medium">Minha conta</p>
          <p className="truncate text-xs text-muted-foreground">Perfil, sair da conta</p>
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
          <p className="text-sm font-medium">Orçamento mensal</p>
          <p className="truncate text-xs text-muted-foreground">
            Limites por categoria e progresso
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      {/* Aparência */}
      <section className="mt-5 rounded-3xl border border-border bg-card p-5 animate-rise">
        <h2 className="text-sm font-semibold">Aparência</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Escolha como o app deve aparecer pra você.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {([
            { id: "light", label: "Claro", Icon: Sun },
            { id: "dark", label: "Escuro", Icon: Moon },
            { id: "system", label: "Sistema", Icon: Monitor },
          ] as { id: ThemeChoice; label: string; Icon: typeof Sun }[]).map(
            ({ id, label, Icon }) => {
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
                  {label}
                </button>
              );
            },
          )}
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium text-foreground">Cor de destaque</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Muda botões, ícones, gráficos, tabs ativas e dá um leve toque da cor no fundo do app.
          </p>
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
        <h2 className="text-sm font-semibold">Limite mensal total</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Receba avisos quando se aproximar ou ultrapassar.
        </p>
        <div className="mt-3 flex gap-2">
          <div className="flex flex-1 items-baseline gap-2 rounded-xl bg-card-elevated px-3">
            <span className="text-sm font-semibold text-muted-foreground">R$</span>
            <Input
              inputMode="decimal"
              value={limiteStr}
              onChange={(e) => setLimiteStr(e.target.value)}
              placeholder="0,00"
              className="num h-11 border-0 bg-transparent p-0 text-lg font-semibold !ring-0 focus-visible:!ring-0"
            />
          </div>
          <Button
            type="button"
            onClick={() => {
              const v = parseBRLInput(limiteStr);
              setLimite("total", v, mes, ano);
              toast.success(v > 0 ? `Limite de ${formatBRL(v)} salvo. ✅` : "Limite removido.");
            }}
            className="h-11 rounded-xl"
          >
            Salvar
          </Button>
        </div>
      </section>

      {/* Categorias */}
      <section className="mt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Suas categorias</h2>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 rounded-full">
                <Plus className="mr-1 h-4 w-4" />
                Nova
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova categoria</DialogTitle>
                <DialogDescription>Personalize ícone e cor.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Nome</Label>
                  <Input
                    placeholder="Ex.: Cuidados pessoais"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="mt-1 h-11 bg-card-elevated"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Cor</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {COLOR_OPTIONS.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => setColorHex(c.hex)}
                        className={cn(
                          "h-8 w-8 rounded-full border-2 transition-all",
                          colorHex === c.hex
                            ? "border-foreground scale-110"
                            : "border-transparent",
                        )}
                        style={{ background: c.hex }}
                        aria-label={c.name}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Ícone</Label>
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
                  Cancelar
                </Button>
                <Button
                  disabled={!nome.trim()}
                  onClick={() => {
                    addCategoria({
                      nome: nome.trim(),
                      iconName,
                      colorHex,
                    });
                    toast.success("Categoria criada. 🎨");
                    setNome("");
                    setOpen(false);
                  }}
                >
                  Criar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

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
                    toast.success("Categoria removida.");
                  }}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Excluir categoria"
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
