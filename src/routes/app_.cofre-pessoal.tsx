import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Shield,
  LockKeyhole,
  Search,
  Plus,
  Star,
  StarOff,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  Pencil,
  ArrowLeft,
  KeyRound,
  Sparkles,
  AlertTriangle,
  Check,
  Lock,
  ExternalLink,
  Home,
  ChevronRight,
  ArrowUpDown,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  createMasterKey,
  unlockMasterKey,
} from "@/lib/vault/crypto";
import {
  fetchVaultSettings,
  saveVaultSettings,
  fetchEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  decryptOne,
  type VaultEntryRow,
  type DecryptedEntry,
} from "@/lib/vault/service";
import { evaluateStrength, generateStrongPassword, type Strength } from "@/lib/vault/strength";
import { useVaultKey, setMasterKey } from "@/lib/vault/use-vault";

export const Route = createFileRoute("/app_/cofre-pessoal")({
  head: () => ({
    meta: [{ title: "Cofre Pessoal — Gasto Inteligente" }],
  }),
  component: CofrePessoalPage,
});

const CATEGORIAS = [
  { id: "todos", label: "Todos" },
  { id: "bancos", label: "Bancos" },
  { id: "redes", label: "Redes sociais" },
  { id: "emails", label: "E-mails" },
  { id: "trabalho", label: "Trabalho" },
  { id: "assinaturas", label: "Assinaturas" },
  { id: "lojas", label: "Lojas" },
  { id: "outros", label: "Outros" },
] as const;

type CategoriaId = (typeof CATEGORIAS)[number]["id"];

function CofrePessoalPage() {
  const { user } = useAuth();
  const { isUnlocked, masterKey, lock } = useVaultKey();
  const [bootstrapState, setBootstrapState] = useState<"loading" | "needs_setup" | "needs_unlock" | "ready">("loading");
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof fetchVaultSettings>>>(null);

  useEffect(() => {
    if (!user) return;
    fetchVaultSettings(user.id)
      .then((s) => {
        setSettings(s);
        if (!s) setBootstrapState("needs_setup");
        else if (!isUnlocked) setBootstrapState("needs_unlock");
        else setBootstrapState("ready");
      })
      .catch((e) => {
        toast.error("Falha ao carregar cofre", { description: e.message });
        setBootstrapState("needs_setup");
      });
  }, [user, isUnlocked]);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-8">
      <div className="mx-auto w-full max-w-5xl px-4 pb-8 pt-4 lg:px-8 lg:pt-8">
        {bootstrapState === "loading" && (
          <div className="grid place-items-center py-24 text-muted-foreground">
            <LockKeyhole className="mb-3 h-8 w-8 animate-pulse" />
            <p className="text-sm">Carregando seu cofre…</p>
          </div>
        )}
        {bootstrapState === "needs_setup" && (
          <SetupView
            userId={user.id}
            onReady={async (s) => {
              setSettings(s);
              setBootstrapState("ready");
            }}
          />
        )}
        {bootstrapState === "needs_unlock" && settings && (
          <UnlockView
            settings={settings}
            onUnlocked={() => setBootstrapState("ready")}
          />
        )}
        {bootstrapState === "ready" && masterKey && (
          <VaultMain userId={user.id} masterKey={masterKey} onLock={lock} hint={settings?.hint ?? null} />
        )}
      </div>
    </div>
  );
}

// ===== Header reutilizável =====
function PageHeader({
  title,
  subtitle,
  crumbs,
  onBack,
  actions,
}: {
  title: string;
  subtitle?: string;
  crumbs: { label: string; to?: string }[];
  onBack?: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 animate-fade-in">
      {/* Breadcrumb + atalho dashboard */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <nav aria-label="breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <Link to="/" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent/40 hover:text-foreground">
            <Home className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1 truncate">
              <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
              {c.to ? (
                <Link to={c.to} className="truncate rounded-md px-1.5 py-0.5 hover:bg-accent/40 hover:text-foreground">
                  {c.label}
                </Link>
              ) : (
                <span className="truncate px-1.5 py-0.5 font-medium text-foreground">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
        <Link
          to="/"
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground sm:inline-flex"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao Dashboard
        </Link>
      </div>

      <div className="flex items-start gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground active:scale-95"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand-on-soft">
              <Shield className="h-5 w-5" />
            </span>
            <h1 className="truncate text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
          </div>
          {subtitle && <p className="mt-1.5 text-sm leading-snug text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="hidden shrink-0 items-center gap-2 sm:flex">{actions}</div>}
      </div>
      {actions && <div className="mt-3 flex flex-wrap items-center gap-2 sm:hidden">{actions}</div>}
    </header>
  );
}

// Compat: alguns sub-componentes ainda chamam HeaderHero
function HeaderHero({ subtitle }: { subtitle: string }) {
  return <PageHeader title="Cofre Pessoal" subtitle={subtitle} crumbs={[{ label: "Cofre Pessoal" }]} />;
}

// ===== Setup (criar senha mestra) =====
function SetupView({ userId, onReady }: { userId: string; onReady: (s: Awaited<ReturnType<typeof fetchVaultSettings>>) => void }) {
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [hint, setHint] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (pwd.length < 8) {
      toast.error("Senha mestra muito curta", { description: "Use pelo menos 8 caracteres." });
      return;
    }
    if (pwd !== pwd2) {
      toast.error("As senhas não conferem");
      return;
    }
    setBusy(true);
    try {
      const built = await createMasterKey(pwd);
      await saveVaultSettings({
        user_id: userId,
        salt: built.salt,
        verifier: built.verifier,
        verifier_iv: built.verifier_iv,
        iterations: built.iterations,
        hint: hint || null,
      });
      setMasterKey(built.key);
      toast.success("Cofre criado e desbloqueado");
      onReady({
        user_id: userId,
        salt: built.salt,
        verifier: built.verifier,
        verifier_iv: built.verifier_iv,
        iterations: built.iterations,
        hint: hint || null,
      });
    } catch (e) {
      toast.error("Não foi possível criar o cofre", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <HeaderHero subtitle="Crie a senha mestra que vai proteger seus logins e dados sensíveis." />
      <Card className="mx-auto max-w-md p-6">
        <div className="mb-5 flex items-center gap-3 rounded-xl bg-warning/10 p-3 text-warning-foreground/90">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
          <p className="text-xs leading-snug">
            A senha mestra <strong>não pode ser recuperada</strong>. Se você esquecê-la, não conseguiremos abrir seu cofre. Guarde em local seguro.
          </p>
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vault-pwd">Senha mestra</Label>
            <div className="relative">
              <Input
                id="vault-pwd"
                type={show ? "text" : "password"}
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vault-pwd2">Confirmar senha</Label>
            <Input
              id="vault-pwd2"
              type={show ? "text" : "password"}
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vault-hint">Dica (opcional)</Label>
            <Input
              id="vault-hint"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="Ex.: meu time favorito + ano"
            />
            <p className="text-[11px] text-muted-foreground">Não escreva a senha aqui. Use apenas uma pista.</p>
          </div>
          <Button onClick={handleCreate} disabled={busy} className="w-full">
            <KeyRound className="h-4 w-4" /> {busy ? "Criando…" : "Criar cofre"}
          </Button>
        </div>
      </Card>
    </>
  );
}

// ===== Unlock =====
function UnlockView({
  settings,
  onUnlocked,
}: {
  settings: NonNullable<Awaited<ReturnType<typeof fetchVaultSettings>>>;
  onUnlocked: () => void;
}) {
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleUnlock() {
    if (!pwd) return;
    setBusy(true);
    try {
      const key = await unlockMasterKey(pwd, settings);
      if (!key) {
        toast.error("Senha mestra incorreta");
        return;
      }
      setMasterKey(key);
      onUnlocked();
    } finally {
      setBusy(false);
      setPwd("");
    }
  }

  return (
    <>
      <HeaderHero subtitle="Digite sua senha mestra para acessar seus logins e dados sensíveis." />
      <Card className="mx-auto max-w-md p-6">
        <div className="mb-5 grid place-items-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand-on-soft">
            <Lock className="h-7 w-7" />
          </span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleUnlock();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="unlock-pwd">Senha mestra</Label>
            <div className="relative">
              <Input
                id="unlock-pwd"
                type={show ? "text" : "password"}
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                autoFocus
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {settings.hint && (
              <p className="text-[11px] text-muted-foreground">
                <span className="font-medium">Dica:</span> {settings.hint}
              </p>
            )}
          </div>
          <Button type="submit" disabled={busy || !pwd} className="w-full">
            <KeyRound className="h-4 w-4" /> {busy ? "Desbloqueando…" : "Desbloquear cofre"}
          </Button>
        </form>
      </Card>
    </>
  );
}

// ===== Main vault =====
type View = { kind: "list" } | { kind: "create" } | { kind: "edit"; entry: DecryptedEntry } | { kind: "detail"; entry: DecryptedEntry };

function VaultMain({
  userId,
  masterKey,
  onLock,
  hint,
}: {
  userId: string;
  masterKey: CryptoKey;
  onLock: () => void;
  hint: string | null;
}) {
  const [entries, setEntries] = useState<VaultEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<CategoriaId>("todos");
  const [onlyFav, setOnlyFav] = useState(false);
  const [strengthFilter, setStrengthFilter] = useState<"todas" | Strength>("todas");
  const [sort, setSort] = useState<"recent" | "az" | "fav" | "updated" | "weak">("fav");
  const [view, setView] = useState<View>({ kind: "list" });

  async function reload() {
    setLoading(true);
    try {
      setEntries(await fetchEntries(userId));
    } catch (e) {
      toast.error("Falha ao listar acessos", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const stats = useMemo(() => {
    const total = entries.length;
    const fortes = entries.filter((e) => e.password_strength === "forte").length;
    const fracas = entries.filter((e) => e.password_strength === "fraca").length;
    const favs = entries.filter((e) => e.favorite).length;
    const last = entries
      .map((e) => e.updated_at)
      .sort()
      .pop();
    return { total, fortes, fracas, favs, last };
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const weakOrder: Record<string, number> = { fraca: 0, media: 1, forte: 2 };
    const list = entries.filter((e) => {
      if (cat !== "todos" && e.category !== cat) return false;
      if (onlyFav && !e.favorite) return false;
      if (strengthFilter !== "todas" && e.password_strength !== strengthFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        (e.site ?? "").toLowerCase().includes(q)
      );
    });
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sort === "az") return a.name.localeCompare(b.name);
      if (sort === "recent") return b.created_at.localeCompare(a.created_at);
      if (sort === "updated") return b.updated_at.localeCompare(a.updated_at);
      if (sort === "weak") return (weakOrder[a.password_strength] ?? 9) - (weakOrder[b.password_strength] ?? 9);
      // fav primeiro, depois nome
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [entries, query, cat, onlyFav, strengthFilter, sort]);

  if (view.kind === "create") {
    return (
      <>
        <PageHeader
          title="Novo acesso"
          subtitle="Salve um login, senha ou informação importante no seu cofre."
          crumbs={[{ label: "Cofre Pessoal", to: "/app/cofre-pessoal" }, { label: "Novo acesso" }]}
          onBack={() => setView({ kind: "list" })}
        />
        <EntryForm
          onCancel={() => setView({ kind: "list" })}
          onSubmit={async (data) => {
            await createEntry({ ...data, user_id: userId, key: masterKey });
            toast.success("Acesso salvo no cofre");
            await reload();
            setView({ kind: "list" });
          }}
        />
      </>
    );
  }
  if (view.kind === "edit") {
    return (
      <>
        <PageHeader
          title="Editar acesso"
          subtitle="Atualize as informações salvas neste acesso."
          crumbs={[
            { label: "Cofre Pessoal", to: "/app/cofre-pessoal" },
            { label: view.entry.name, to: undefined },
            { label: "Editar" },
          ]}
          onBack={() => setView({ kind: "detail", entry: view.entry })}
        />
        <EntryForm
          initial={view.entry}
          submitLabel="Salvar alterações"
          onCancel={() => setView({ kind: "detail", entry: view.entry })}
          onSubmit={async (data) => {
            await updateEntry({
              id: view.entry.id,
              ...data,
              key: masterKey,
              previousPassword: view.entry.secret.password,
            });
            toast.success("Acesso atualizado");
            await reload();
            const fresh = await fetchEntries(userId);
            const updated = fresh.find((x) => x.id === view.entry.id);
            if (updated) {
              const dec = await decryptOne(masterKey, updated);
              setView({ kind: "detail", entry: dec });
            } else {
              setView({ kind: "list" });
            }
          }}
        />
      </>
    );
  }
  if (view.kind === "detail") {
    return (
      <DetailView
        entry={view.entry}
        onBack={() => setView({ kind: "list" })}
        onEdit={() => setView({ kind: "edit", entry: view.entry })}
        onDelete={async () => {
          if (!confirm(`Excluir "${view.entry.name}"? Esta ação não pode ser desfeita.`)) return;
          await deleteEntry(view.entry.id);
          toast.success("Acesso excluído");
          await reload();
          setView({ kind: "list" });
        }}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Cofre Pessoal"
        subtitle="Organize logins, senhas e informações importantes em um só lugar."
        crumbs={[{ label: "Cofre Pessoal" }]}
        actions={
          <>
            <Button
              onClick={() => setView({ kind: "create" })}
              className="bg-brand-grad font-semibold shadow-md shadow-brand/20"
            >
              <Plus className="h-4 w-4" /> Adicionar acesso
            </Button>
            <Button variant="outline" onClick={onLock} title="Bloquear cofre">
              <Lock className="h-4 w-4" /> Bloquear cofre
            </Button>
          </>
        }
      />

      <Card className="mb-5 flex items-start gap-3 border-brand/30 bg-brand-soft/30 p-4 shadow-sm animate-fade-in">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-on-soft ring-1 ring-brand/30">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 text-xs leading-relaxed text-foreground/90">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Área protegida</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Proteção ativa
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">
            Seus dados sensíveis ficam protegidos com criptografia e só aparecem quando você autorizar.
          </p>
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Acessos salvos" value={stats.total} />
        <StatCard label="Favoritos" value={stats.favs} />
        <StatCard label="Senhas fortes" value={stats.fortes} tone="success" />
        <StatCard label="Senhas fracas" value={stats.fracas} tone="warning" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, usuário, categoria ou site"
            className="h-10 pl-9"
          />
        </div>
        <div className="relative">
          <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="h-10 appearance-none rounded-md border border-input bg-card pl-8 pr-3 text-xs font-medium text-foreground transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Ordenar"
          >
            <option value="fav">Favoritos primeiro</option>
            <option value="recent">Mais recentes</option>
            <option value="updated">Última alteração</option>
            <option value="az">A–Z</option>
            <option value="weak">Senhas fracas primeiro</option>
          </select>
        </div>
      </div>

      <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-2">
        <button
          onClick={() => setOnlyFav((v) => !v)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            onlyFav
              ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
              : "border-border bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground",
          )}
        >
          <Star className={cn("h-3.5 w-3.5", onlyFav && "fill-amber-400 text-amber-400")} />
          Favoritos
        </button>
        <span className="mx-1 w-px shrink-0 self-stretch bg-border" />
        {CATEGORIAS.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              cat === c.id
                ? "border-brand bg-brand-soft text-brand-on-soft"
                : "border-border bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-2">
        <span className="shrink-0 self-center pr-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Força
        </span>
        {([
          { id: "todas", label: "Todas" },
          { id: "forte", label: "Fortes" },
          { id: "media", label: "Médias" },
          { id: "fraca", label: "Fracas" },
        ] as const).map((s) => (
          <button
            key={s.id}
            onClick={() => setStrengthFilter(s.id as typeof strengthFilter)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              strengthFilter === s.id
                ? s.id === "forte"
                  ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                  : s.id === "media"
                  ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
                  : s.id === "fraca"
                  ? "border-red-500/60 bg-red-500/15 text-red-300"
                  : "border-brand bg-brand-soft text-brand-on-soft"
                : "border-border bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>


      {loading ? (
        <div className="grid place-items-center py-12 text-sm text-muted-foreground">Carregando acessos…</div>
      ) : filtered.length === 0 ? (
        <EmptyState onAdd={() => setView({ kind: "create" })} hasAny={entries.length > 0} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((e) => (
            <EntryCard
              key={e.id}
              row={e}
              masterKey={masterKey}
              onOpen={async () => {
                const dec = await decryptOne(masterKey, e);
                setView({ kind: "detail", entry: dec });
              }}
              onToggleFav={async () => {
                const dec = await decryptOne(masterKey, e);
                await updateEntry({
                  id: e.id,
                  name: e.name,
                  category: e.category,
                  site: e.site,
                  favorite: !e.favorite,
                  secret: dec.secret,
                  key: masterKey,
                  previousPassword: dec.secret.password,
                });
                await reload();
              }}
            />
          ))}
        </ul>
      )}

      {hint && entries.length > 0 && (
        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          Dica da senha mestra: <span className="font-medium">{hint}</span>
        </p>
      )}
    </>
  );
}

function StatCard({ label, value, tone, small }: { label: string; value: number | string; tone?: "success" | "warning"; small?: boolean }) {
  return (
    <Card className="p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-bold tabular-nums",
          small ? "text-base" : "text-2xl",
          tone === "success" && "text-emerald-400",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
    </Card>
  );
}

function EmptyState({ onAdd, hasAny }: { onAdd: () => void; hasAny: boolean }) {
  return (
    <Card className="grid place-items-center gap-3 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-on-soft">
        <Shield className="h-6 w-6" />
      </span>
      <div>
        <p className="font-semibold">{hasAny ? "Nenhum acesso encontrado" : "Seu cofre está vazio"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasAny ? "Ajuste o filtro ou a busca." : "Comece adicionando seu primeiro login."}
        </p>
      </div>
      {!hasAny && (
        <Button onClick={onAdd}>
          <Plus className="h-4 w-4" /> Adicionar acesso
        </Button>
      )}
    </Card>
  );
}

function strengthBadge(s: Strength) {
  if (s === "forte") return <Badge className="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">Forte</Badge>;
  if (s === "media") return <Badge className="bg-amber-500/15 text-amber-400 hover:bg-amber-500/15">Média</Badge>;
  if (s === "fraca") return <Badge className="bg-red-500/15 text-red-400 hover:bg-red-500/15">Fraca</Badge>;
  return <Badge variant="secondary">—</Badge>;
}

function categoryLabel(id: string) {
  return CATEGORIAS.find((c) => c.id === id)?.label ?? id;
}

function maskUsername(u: string): string {
  if (!u) return "—";
  if (u.includes("@")) {
    const [n, d] = u.split("@");
    const head = n.slice(0, 2);
    return `${head}${"•".repeat(Math.max(0, n.length - 2))}@${d}`;
  }
  return `${u.slice(0, 2)}${"•".repeat(Math.max(0, u.length - 2))}`;
}

async function copyWithToast(text: string, label: string, sensitive = false) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`, {
      description: sensitive ? "Por segurança, limpe sua área de transferência depois de usar." : undefined,
    });
  } catch {
    toast.error("Não foi possível copiar");
  }
}

function EntryCard({
  row,
  masterKey,
  onOpen,
  onToggleFav,
}: {
  row: VaultEntryRow;
  masterKey: CryptoKey;
  onOpen: () => void;
  onToggleFav: () => void;
}) {
  const [maskedUser, setMaskedUser] = useState<string>("•••");
  useEffect(() => {
    let alive = true;
    decryptOne(masterKey, row)
      .then((d) => {
        if (alive) setMaskedUser(maskUsername(d.secret.username ?? ""));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [row, masterKey]);

  async function handleCopyUser() {
    const dec = await decryptOne(masterKey, row);
    await copyWithToast(dec.secret.username ?? "", "Usuário");
  }
  async function handleCopyPwd() {
    const dec = await decryptOne(masterKey, row);
    await copyWithToast(dec.secret.password ?? "", "Senha", true);
  }

  return (
    <li>
      <Card className="group flex items-center gap-3 p-3.5">
        <button
          onClick={onOpen}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-card-elevated text-foreground ring-1 ring-border/60"
          aria-label="Abrir detalhes"
        >
          <Shield className="h-5 w-5" />
        </button>
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{row.name}</p>
            {row.favorite && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
          </div>
          <p className="truncate text-xs text-muted-foreground">{maskedUser}</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{categoryLabel(row.category)}</Badge>
            {strengthBadge(row.password_strength)}
          </div>
        </button>
        <div className="flex flex-col gap-1">
          <Button size="icon" variant="ghost" onClick={onToggleFav} title="Favoritar" className="h-8 w-8">
            {row.favorite ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> : <StarOff className="h-4 w-4" />}
          </Button>
          <Button size="icon" variant="ghost" onClick={handleCopyUser} title="Copiar usuário" className="h-8 w-8">
            <Copy className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={handleCopyPwd} title="Copiar senha" className="h-8 w-8">
            <KeyRound className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </li>
  );
}

// ===== Detail =====
function DetailView({
  entry,
  onBack,
  onEdit,
  onDelete,
}: {
  entry: DecryptedEntry;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showPwd, setShowPwd] = useState(false);
  return (
    <>
      <PageHeader
        title={entry.name}
        crumbs={[
          { label: "Cofre Pessoal", to: "/app/cofre-pessoal" },
          { label: "Detalhes do acesso" },
        ]}
        onBack={onBack}
        subtitle="Visualize, copie ou edite as informações deste acesso com segurança."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="outline">{categoryLabel(entry.category)}</Badge>
        {strengthBadge(entry.password_strength)}
        {entry.favorite && (
          <Badge className="border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/10">
            <Star className="mr-1 h-3 w-3 fill-amber-400 text-amber-400" /> Favorito
          </Badge>
        )}
      </div>


      <Card className="space-y-5 p-5">
        <Field label="Usuário ou e-mail" value={entry.secret.username ?? ""} copyLabel="Usuário" />
        <div>
          <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">Senha</Label>
          <div className="mt-1.5 flex items-center gap-2">
            <Input
              readOnly
              type={showPwd ? "text" : "password"}
              value={entry.secret.password ?? ""}
              className="font-mono"
            />
            <Button size="icon" variant="outline" onClick={() => setShowPwd((s) => !s)} title="Mostrar/ocultar">
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => copyWithToast(entry.secret.password ?? "", "Senha", true)}
              title="Copiar senha"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {entry.site && (
          <Field
            label="Site / aplicativo"
            value={entry.site}
            copyLabel="Site"
            trailing={
              <a
                href={/^https?:\/\//.test(entry.site) ? entry.site : `https://${entry.site}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> abrir
              </a>
            }
          />
        )}
        {entry.secret.notes && (
          <div>
            <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">Observações</Label>
            <p className="mt-1.5 whitespace-pre-wrap rounded-md border border-border bg-card-elevated p-3 text-sm">
              {entry.secret.notes}
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>
            <p className="text-[10px] uppercase tracking-widest">Última alteração da senha</p>
            <p className="mt-0.5 font-medium text-foreground">
              {entry.password_updated_at ? new Date(entry.password_updated_at).toLocaleString("pt-BR") : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest">Criado em</p>
            <p className="mt-0.5 font-medium text-foreground">{new Date(entry.created_at).toLocaleDateString("pt-BR")}</p>
          </div>
        </div>
      </Card>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onEdit}>
          <Pencil className="h-4 w-4" /> Editar
        </Button>
        <Button variant="outline" onClick={() => copyWithToast(entry.secret.password ?? "", "Senha", true)}>
          <Copy className="h-4 w-4" /> Copiar senha
        </Button>
        <Button variant="destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" /> Excluir
        </Button>
      </div>
    </>
  );
}

function Field({ label, value, copyLabel, trailing }: { label: string; value: string; copyLabel: string; trailing?: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</Label>
      <div className="mt-1.5 flex items-center gap-2">
        <Input readOnly value={value} />
        <Button size="icon" variant="outline" onClick={() => copyWithToast(value, copyLabel)} title={`Copiar ${copyLabel.toLowerCase()}`}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      {trailing && <div className="mt-1.5">{trailing}</div>}
    </div>
  );
}

// ===== Form (create/edit) =====
function EntryForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: DecryptedEntry;
  onSubmit: (data: {
    name: string;
    category: string;
    site?: string | null;
    favorite?: boolean;
    secret: { username?: string; password?: string; notes?: string };
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<string>(initial?.category ?? "outros");
  const [site, setSite] = useState(initial?.site ?? "");
  const [favorite, setFavorite] = useState(initial?.favorite ?? false);
  const [username, setUsername] = useState(initial?.secret.username ?? "");
  const [password, setPassword] = useState(initial?.secret.password ?? "");
  const [notes, setNotes] = useState(initial?.secret.notes ?? "");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const strength = evaluateStrength(password);
  const pwdRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!name.trim()) {
      toast.error("Informe o nome do acesso");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        category,
        site: site.trim() || null,
        favorite,
        secret: { username, password, notes },
      });
    } catch (e) {
      toast.error("Falha ao salvar", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function fillStrong() {
    const p = generateStrongPassword(18);
    setPassword(p);
    setShowPwd(true);
    setTimeout(() => pwdRef.current?.focus(), 0);
    toast.success("Senha forte gerada");
  }

  const formCategorias = CATEGORIAS.filter((c) => c.id !== "todos");

  return (
    <div className="space-y-4">
      {/* Bloco 1: Identificação */}
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand-on-soft text-xs font-bold">1</span>
          <h2 className="text-sm font-semibold">Identificação do acesso</h2>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-name">Nome do acesso</Label>
          <Input id="f-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Instagram pessoal" autoFocus />
        </div>
        <div className="space-y-2">
          <Label>Categoria</Label>
          <div className="flex flex-wrap gap-2">
            {formCategorias.map((c) => {
              const selected = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  aria-pressed={selected}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all active:scale-[0.97]",
                    selected
                      ? "border-brand bg-brand-soft text-brand-on-soft shadow-[0_0_0_1px_hsl(var(--brand)/0.4)]"
                      : "border-border bg-card text-muted-foreground hover:border-brand/40 hover:text-foreground",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-site">Site ou aplicativo</Label>
          <Input id="f-site" value={site} onChange={(e) => setSite(e.target.value)} placeholder="exemplo.com.br" inputMode="url" />
        </div>
      </Card>

      {/* Bloco 2: Login */}
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand-on-soft text-xs font-bold">2</span>
          <h2 className="text-sm font-semibold">Dados de login</h2>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-user">Usuário, e-mail ou telefone</Label>
          <Input id="f-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" placeholder="seu@email.com" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="f-pwd">Senha</Label>
            <button type="button" onClick={fillStrong} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              <Sparkles className="h-3 w-3" /> Gerar senha forte
            </button>
          </div>
          <div className="relative">
            <Input
              ref={pwdRef}
              id="f-pwd"
              type={showPwd ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-20 font-mono"
              autoComplete="new-password"
              placeholder="••••••••"
            />
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                aria-label={showPwd ? "Ocultar senha" : "Mostrar senha"}
                className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:text-foreground"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => copyWithToast(password, "Senha", true)}
                aria-label="Copiar senha"
                className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
          {password && (
            <div className="flex items-center gap-2 pt-1">
              {strengthBadge(strength)}
              <p className="text-[11px] text-muted-foreground">
                {strength === "forte" ? "Boa! Sua senha está bem protegida." : strength === "media" ? "Pode melhorar adicionando símbolos e mais caracteres." : "Use 12+ caracteres, com números e símbolos."}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Bloco 3: Observações & favorito */}
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand-on-soft text-xs font-bold">3</span>
          <h2 className="text-sm font-semibold">Segurança e observações</h2>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-notes">Observações privadas</Label>
          <Textarea
            id="f-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Códigos de recuperação, perguntas secretas, anotações…"
          />
          <p className="text-[11px] text-muted-foreground">
            As observações também são criptografadas. Não escreva aqui o que não quiser proteger.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFavorite((v) => !v)}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors",
            favorite ? "border-amber-400/60 bg-amber-400/5" : "border-border bg-card hover:bg-accent/30",
          )}
        >
          <div className="flex items-center gap-2.5">
            <Star className={cn("h-4 w-4", favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
            <div>
              <p className="text-sm font-medium">Marcar como favorito</p>
              <p className="text-[11px] text-muted-foreground">Aparece no topo da lista do cofre.</p>
            </div>
          </div>
          <span
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
              favorite ? "bg-amber-400" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform",
                favorite ? "translate-x-4" : "translate-x-0.5",
              )}
            />
          </span>
        </button>
      </Card>

      {/* Ações */}
      <div className="sticky bottom-2 z-10 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={busy} className="sm:w-auto">
          Cancelar
        </Button>
        <Button
          onClick={submit}
          disabled={busy || !name.trim()}
          size="lg"
          className="h-12 w-full bg-gradient-to-r from-brand to-brand/80 text-base font-semibold shadow-lg shadow-brand/20 hover:from-brand hover:to-brand/90 sm:w-auto sm:px-8"
        >
          <Check className="h-4 w-4" /> {busy ? "Salvando…" : "Salvar acesso"}
        </Button>
      </div>
    </div>
  );
}
