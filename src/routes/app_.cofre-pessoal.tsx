import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  enableSecureScreen,
  disableSecureScreen,
} from "@/lib/android-security";
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
  Download,
  Settings as SettingsIcon,
  Info,
  Loader2,
  Fingerprint,
  Delete as Backspace,
  ShieldAlert,
  Activity,
  RefreshCw,
  Clock,
  Repeat,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { useAuth } from "@/lib/auth-context";
import { usePlan } from "@/lib/use-plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  rotateMasterKey,
  buildEncryptedBackup,
  type VaultEntryRow,
  type DecryptedEntry,
  type VaultSettingsRow,
} from "@/lib/vault/service";
import { evaluateStrength, generateStrongPassword, type Strength } from "@/lib/vault/strength";
import {
  useVaultKey,
  setMasterKey,
  getCachedSecret,
  setCachedSecret,
  evictCached,
  clearSecretCache,
} from "@/lib/vault/use-vault";
import { CompanyLogo } from "@/components/vault/CompanyLogo";
import { extractDomain } from "@/lib/brand/resolver";
import { confirmAsync } from "@/components/ConfirmDialog";
import {
  getQuickUnlock,
  disableQuickUnlock,
  enableBiometricUnlock,
  unlockWithBiometric,
  isPlatformAuthenticatorAvailable,
  biometricUnavailableReason,
  type QuickUnlockRecord,
} from "@/lib/vault/quick-unlock";
import {
  getServerPinStatus,
  enableServerPin,
  disableServerPin,
  unlockWithServerPin,
  type ServerPinStatus,
} from "@/lib/vault/server-pin";

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

// =====================================================================
// Página principal
// =====================================================================
function CofrePessoalPage() {
  const { user } = useAuth();
  const { can, isAdminMaster, loading: planLoading } = usePlan();
  const { isUnlocked, masterKey, lock } = useVaultKey();
  const [bootstrapState, setBootstrapState] = useState<"loading" | "needs_setup" | "needs_unlock" | "ready">("loading");
  const [settings, setSettings] = useState<VaultSettingsRow | null>(null);

  // Etapa 14 — Gate premium do Cofre Pessoal.
  // hasAccess: usuário tem a feature liberada no plano (ou é Admin Master).
  // Para usuários sem acesso, decidimos entre:
  //  - Bloqueio total (não tem settings = nunca usou o Cofre): tela de upgrade.
  //  - Modo transição (já tem settings = já configurou o Cofre): banner + leitura.
  // Não tocamos em criptografia, PIN, biometria nem dados existentes.
  const hasAccess = isAdminMaster || can("cofre_pessoal");

  // Ativa/Desativa bloqueio de print no Android WebView enquanto o usuário
  // estiver dentro do Cofre Pessoal (inclui setup, unlock, lista e detalhes).
  useEffect(() => {
    enableSecureScreen();
    return () => {
      disableSecureScreen();
    };
  }, []);

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
        toast.error(i18n.t("cofre:errors.loadFailed"));
        setBootstrapState("needs_setup");
      });
  }, [user, isUnlocked]);

  if (!user) return null;

  // Aguarda carregamento do plano para evitar flash de bloqueio.
  if (planLoading || bootstrapState === "loading") {
    return (
      <div className="min-h-screen min-h-dvh bg-background pb-[calc(112px+env(safe-area-inset-bottom))] lg:pb-12">
        <div className="mx-auto w-full max-w-5xl px-4 pb-8 pt-4 lg:px-8 lg:pt-8">
          <BootLoading />
        </div>
      </div>
    );
  }

  // Usuário sem acesso e SEM dados salvos: bloqueio total com upgrade.
  if (!hasAccess && !settings) {
    return (
      <div className="min-h-screen min-h-dvh bg-background pb-[calc(112px+env(safe-area-inset-bottom))] lg:pb-12">
        <div className="mx-auto w-full max-w-5xl px-4 pb-8 pt-4 lg:px-8 lg:pt-8">
          <CofrePremiumGate />
        </div>
      </div>
    );
  }

  // Usuário sem acesso mas COM dados salvos: modo transição (banner + acesso de leitura).
  const showTransitionBanner = !hasAccess && !!settings;
  const isVaultReadOnly = !hasAccess && !!settings;

  return (
    <div className="min-h-screen min-h-dvh bg-background pb-[calc(112px+env(safe-area-inset-bottom))] lg:pb-12">
      <div className="mx-auto w-full max-w-5xl px-4 pb-8 pt-4 lg:px-8 lg:pt-8">
        {showTransitionBanner && <CofreTransitionBanner />}
        {bootstrapState === "needs_setup" && hasAccess && (
          <SetupView
            userId={user.id}
            onReady={(s) => {
              setSettings(s);
              setBootstrapState("ready");
            }}
          />
        )}
        {bootstrapState === "needs_unlock" && settings && (
          <UnlockView
            userId={user.id}
            userLabel={user.email ?? user.id}
            settings={settings}
            onUnlocked={() => setBootstrapState("ready")}
          />
        )}
        {bootstrapState === "ready" && masterKey && settings && (
          <VaultMain
            userId={user.id}
            masterKey={masterKey}
            onLock={lock}
            settings={settings}
            onSettingsChanged={setSettings}
            readOnly={isVaultReadOnly}
          />
        )}
      </div>
    </div>
  );
}

function CofrePremiumGate() {
  const { t } = useTranslation("cofre");
  return (
    <div className="mx-auto max-w-xl space-y-5 py-12 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Lock className="h-8 w-8" aria-hidden />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{t("gate.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("gate.description")}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild>
          <Link to="/meu-plano">
            <Sparkles className="mr-1 h-4 w-4" />
            {t("gate.cta")}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/">{t("gate.back")}</Link>
        </Button>
      </div>
    </div>
  );
}

function CofreTransitionBanner() {
  const { t } = useTranslation("cofre");
  return (
    <div className="mb-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm">
      <div className="mb-1 flex items-center gap-2 text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-wide">{t("transition.badge")}</span>
      </div>
      <p className="font-semibold">{t("transition.title")}</p>
      <p className="mt-1 text-muted-foreground">{t("transition.description")}</p>
      <div className="mt-3">
        <Button asChild size="sm">
          <Link to="/meu-plano">
            <Sparkles className="mr-1 h-4 w-4" />
            {t("transition.cta")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function CofreReadOnlyNotice() {
  const { t } = useTranslation("cofre");
  return (
    <Card className="mb-4 flex items-start gap-3 border-amber-400/40 bg-amber-500/10 p-4 text-sm">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-300">
        <Lock className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-300">
          {t("readOnly.badge")}
        </p>
        <p className="mt-0.5 font-semibold">{t("readOnly.title")}</p>
        <p className="mt-1 text-muted-foreground">{t("readOnly.description")}</p>
        <div className="mt-3">
          <Button asChild size="sm">
            <Link to="/meu-plano">
              <Sparkles className="mr-1 h-4 w-4" />
              {t("readOnly.cta")}
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

function BootLoading() {
  return (
    <div className="space-y-4 py-12">
      <div className="grid place-items-center text-muted-foreground">
        <LockKeyhole className="mb-3 h-8 w-8 animate-pulse" />
        <p className="text-sm">Carregando seu cofre…</p>
      </div>
      <div className="mx-auto max-w-3xl space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// Header reutilizável
// =====================================================================
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
function HeaderHero({ subtitle }: { subtitle: string }) {
  return <PageHeader title="Cofre Pessoal" subtitle={subtitle} crumbs={[{ label: "Cofre Pessoal" }]} />;
}

// =====================================================================
// Setup (criar senha mestra)
// =====================================================================
function SetupView({ userId, onReady }: { userId: string; onReady: (s: VaultSettingsRow) => void }) {
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [hint, setHint] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const strength = evaluateStrength(pwd);

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
      const row: VaultSettingsRow = {
        user_id: userId,
        salt: built.salt,
        verifier: built.verifier,
        verifier_iv: built.verifier_iv,
        iterations: built.iterations,
        hint: hint || null,
      };
      await saveVaultSettings(row);
      setMasterKey(built.key);
      toast.success("Cofre criado e desbloqueado");
      onReady(row);
    } catch (e) {
      toast.error(i18n.t("cofre:errors.createFailed"));
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
                className="pr-10 font-mono"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={show ? "Ocultar" : "Mostrar"}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {pwd && (
              <div className="flex items-center gap-2 pt-0.5">
                {strengthBadge(strength)}
                <p className="text-[11px] text-muted-foreground">
                  {strength === "forte" ? "Excelente!" : strength === "media" ? "Boa, mas pode melhorar." : "Use 12+ caracteres, números e símbolos."}
                </p>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vault-pwd2">Confirmar senha</Label>
            <Input
              id="vault-pwd2"
              type={show ? "text" : "password"}
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              className="font-mono"
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
          <Button
            onClick={handleCreate}
            disabled={busy}
            className="h-12 w-full bg-brand text-brand-foreground text-base font-semibold shadow-md hover:bg-brand/90"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {busy ? "Criando…" : "Criar cofre"}
          </Button>
        </div>
      </Card>
    </>
  );
}

// =====================================================================
// Unlock (com proteção contra tentativas)
// =====================================================================
function UnlockView({
  userId,
  userLabel,
  settings,
  onUnlocked,
}: {
  userId: string;
  userLabel: string;
  settings: VaultSettingsRow;
  onUnlocked: () => void;
}) {
  const [bio, setBio] = useState<QuickUnlockRecord | null>(() => getQuickUnlock(userId));
  const [serverPin, setServerPin] = useState<ServerPinStatus | null>(null);
  const [mode, setMode] = useState<"pin" | "bio" | "master">("master");
  const [pwd, setPwd] = useState("");
  const [pin, setPin] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [now, setNow] = useState(Date.now());

  // Carrega status do PIN global da conta e define modo inicial preferido
  useEffect(() => {
    let alive = true;
    getServerPinStatus(userId)
      .then((s) => {
        if (!alive) return;
        setServerPin(s);
        if (s.configured && !s.lockedUntil) setMode("pin");
        else if (bio) setMode("bio");
      })
      .catch(() => {
        if (alive && bio) setMode("bio");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (cooldownUntil <= now) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [cooldownUntil, now]);

  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const isCoolingDown = cooldownLeft > 0;

  async function handleUnlock() {
    if (!pwd || isCoolingDown) return;
    setBusy(true);
    try {
      const key = await unlockMasterKey(pwd, settings);
      if (!key) {
        const next = fails + 1;
        setFails(next);
        setPwd("");
        if (next >= 3) {
          const delay = Math.min(60, 2 ** (next - 2)) * 1000;
          setCooldownUntil(Date.now() + delay);
          toast.error("Senha mestra incorreta", {
            description: `Muitas tentativas. Aguarde ${Math.ceil(delay / 1000)}s antes de tentar novamente.`,
          });
        } else {
          toast.error("Senha mestra incorreta");
        }
        return;
      }
      setMasterKey(key);
      setFails(0);
      onUnlocked();
    } finally {
      setBusy(false);
    }
  }

  async function handlePinUnlock(value: string) {
    if (busy) return;
    setBusy(true);
    try {
      const key = await unlockWithServerPin(userId, value);
      setMasterKey(key);
      setPin("");
      onUnlocked();
    } catch (e) {
      setPin("");
      toast.error(i18n.t("cofre:errors.unlockFailed"));
      // Recarrega status para refletir bloqueio
      try {
        const s = await getServerPinStatus(userId);
        setServerPin(s);
        if (s.lockedUntil) setMode("master");
      } catch {}
    } finally {
      setBusy(false);
    }
  }

  async function handleBiometricUnlock() {
    if (busy) return;
    setBusy(true);
    try {
      const key = await unlockWithBiometric(userId);
      setMasterKey(key);
      onUnlocked();
    } catch (e) {
      toast.error(i18n.t("cofre:errors.biometricFailed"));
    } finally {
      setBusy(false);
    }
  }

  // PIN: dispara ao completar 6 dígitos
  useEffect(() => {
    if (mode !== "pin") return;
    if (pin.length === 6) handlePinUnlock(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, mode]);

  const hasServerPin = !!serverPin?.configured && !serverPin?.lockedUntil;
  const subtitle = mode === "pin"
    ? "Use o PIN cadastrado na sua conta para abrir o Cofre."
    : mode === "bio"
    ? "Use sua biometria para abrir o cofre."
    : "Digite sua senha mestra para acessar seus logins e dados sensíveis.";

  return (
    <>
      <HeaderHero subtitle={subtitle} />
      <Card className="mx-auto max-w-md p-6">
        <div className="mb-5 grid place-items-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand-on-soft">
            {mode === "bio" ? (
              <Fingerprint className="h-7 w-7" />
            ) : (
              <Lock className="h-7 w-7" />
            )}
          </span>
        </div>

        {mode === "pin" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-center block">PIN da sua conta</Label>
              <PinDots length={6} value={pin} />
            </div>
            <PinPad
              disabled={busy}
              onDigit={(d) => setPin((p) => (p.length >= 6 ? p : p + d))}
              onBackspace={() => setPin((p) => p.slice(0, -1))}
            />
            <div className="flex flex-col gap-1">
              {bio && (
                <button
                  type="button"
                  onClick={() => { setMode("bio"); setPin(""); }}
                  className="block w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Usar biometria
                </button>
              )}
              <button
                type="button"
                onClick={() => { setMode("master"); setPin(""); }}
                className="block w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Usar senha mestra
              </button>
            </div>
          </div>
        )}

        {mode === "bio" && (
          <div className="space-y-4">
            <Button
              type="button"
              onClick={handleBiometricUnlock}
              disabled={busy}
              className="h-12 w-full bg-brand text-brand-foreground text-base font-semibold shadow-md hover:bg-brand/90"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
              {busy ? "Autenticando…" : "Desbloquear com biometria"}
            </Button>
            <div className="flex flex-col gap-1">
              {hasServerPin && (
                <button
                  type="button"
                  onClick={() => setMode("pin")}
                  className="block w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Usar PIN da conta
                </button>
              )}
              <button
                type="button"
                onClick={() => setMode("master")}
                className="block w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Usar senha mestra
              </button>
            </div>
          </div>
        )}

        {mode === "master" && (
          <form
            onSubmit={(e) => { e.preventDefault(); handleUnlock(); }}
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
                  className="pr-10 font-mono"
                  disabled={isCoolingDown}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={show ? "Ocultar" : "Mostrar"}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {settings.hint && (
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-medium">Dica:</span> {settings.hint}
                </p>
              )}
              {isCoolingDown && (
                <p className="text-[11px] text-amber-400">
                  Muitas tentativas. Aguarde {cooldownLeft}s antes de tentar novamente.
                </p>
              )}
            </div>
            <Button
              type="submit"
              disabled={busy || !pwd || isCoolingDown}
              className="h-12 w-full bg-brand text-brand-foreground text-base font-semibold shadow-md hover:bg-brand/90"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {busy ? "Desbloqueando…" : isCoolingDown ? `Aguarde ${cooldownLeft}s` : "Desbloquear cofre"}
            </Button>
            {(hasServerPin || bio) && (
              <div className="flex flex-col gap-1">
                {hasServerPin && (
                  <button
                    type="button"
                    onClick={() => setMode("pin")}
                    className="block w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Usar PIN da conta
                  </button>
                )}
                {bio && (
                  <button
                    type="button"
                    onClick={() => setMode("bio")}
                    className="block w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Usar biometria
                  </button>
                )}
              </div>
            )}
          </form>
        )}
      </Card>
      <span className="sr-only">{userLabel}</span>
    </>
  );
}

// Componentes auxiliares para PIN
function PinDots({ length, value }: { length: number; value: string }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length }).map((_, i) => {
        const filled = i < value.length;
        return (
          <span
            key={i}
            className={cn(
              "h-3.5 w-3.5 rounded-full border transition-colors",
              filled ? "border-brand bg-brand" : "border-border bg-transparent",
            )}
          />
        );
      })}
    </div>
  );
}

function PinPad({
  disabled,
  onDigit,
  onBackspace,
}: {
  disabled?: boolean;
  onDigit: (d: string) => void;
  onBackspace: () => void;
}) {
  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {digits.map((d) => (
        <button
          key={d}
          type="button"
          disabled={disabled}
          onClick={() => onDigit(d)}
          className="h-14 rounded-xl border border-border bg-card text-xl font-semibold tabular-nums text-foreground transition-colors hover:bg-accent/40 active:scale-[0.98] disabled:opacity-50"
        >
          {d}
        </button>
      ))}
      <span />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onDigit("0")}
        className="h-14 rounded-xl border border-border bg-card text-xl font-semibold tabular-nums text-foreground transition-colors hover:bg-accent/40 active:scale-[0.98] disabled:opacity-50"
      >
        0
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onBackspace}
        className="grid h-14 place-items-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-accent/40 active:scale-[0.98] disabled:opacity-50"
        aria-label="Apagar"
      >
        <Backspace className="h-5 w-5" />
      </button>
    </div>
  );
}

// =====================================================================
// Views internas
// =====================================================================
type View =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; entry: DecryptedEntry }
  | { kind: "detail"; entry: DecryptedEntry }
  | { kind: "change_master" }
  | { kind: "backup" }
  | { kind: "quick_unlock" }
  | { kind: "health" };

function VaultMain({
  userId,
  masterKey,
  onLock,
  settings,
  onSettingsChanged,
  readOnly = false,
}: {
  userId: string;
  masterKey: CryptoKey;
  onLock: () => void;
  settings: VaultSettingsRow;
  onSettingsChanged: (s: VaultSettingsRow) => void;
  readOnly?: boolean;
}) {
  const { t: tCofre } = useTranslation("cofre");
  const [entries, setEntries] = useState<VaultEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [cat, setCat] = useState<CategoriaId>("todos");
  const [onlyFav, setOnlyFav] = useState(false);
  const [strengthFilter, setStrengthFilter] = useState<"todas" | Strength>("todas");
  const [sort, setSort] = useState<"recent" | "az" | "fav" | "updated" | "weak">("fav");
  const [view, setView] = useState<View>({ kind: "list" });

  // Debounce de busca
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 150);
    return () => window.clearTimeout(t);
  }, [query]);

  // Decifrar tudo em memória uma vez para alimentar busca + cache
  const reloadDecryptCache = useCallback(async (rows: VaultEntryRow[]) => {
    await Promise.all(
      rows.map(async (r) => {
        if (getCachedSecret(r.id)) return;
        try {
          const dec = await decryptOne(masterKey, r);
          setCachedSecret(r.id, dec.secret);
        } catch {
          // ignora um item falho
        }
      }),
    );
  }, [masterKey]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchEntries(userId);
      setEntries(rows);
      void reloadDecryptCache(rows);
    } catch (e) {
      toast.error(i18n.t("cofre:errors.listAccessFailed"));
    } finally {
      setLoading(false);
    }
  }, [userId, reloadDecryptCache]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const stats = useMemo(() => {
    const total = entries.length;
    const fortes = entries.filter((e) => e.password_strength === "forte").length;
    const fracas = entries.filter((e) => e.password_strength === "fraca").length;
    const favs = entries.filter((e) => e.favorite).length;
    return { total, fortes, fracas, favs };
  }, [entries]);

  const filtered = useMemo(() => {
    const q = debouncedQuery;
    const weakOrder: Record<string, number> = { fraca: 0, media: 1, forte: 2 };
    const list = entries.filter((e) => {
      if (cat !== "todos" && e.category !== cat) return false;
      if (onlyFav && !e.favorite) return false;
      if (strengthFilter !== "todas" && e.password_strength !== strengthFilter) return false;
      if (!q) return true;
      const sec = getCachedSecret(e.id);
      const hay = [
        e.name,
        e.category,
        e.site ?? "",
        sec?.username ?? "",
        sec?.notes ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sort === "az") return a.name.localeCompare(b.name);
      if (sort === "recent") return b.created_at.localeCompare(a.created_at);
      if (sort === "updated") return b.updated_at.localeCompare(a.updated_at);
      if (sort === "weak") return (weakOrder[a.password_strength] ?? 9) - (weakOrder[b.password_strength] ?? 9);
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [entries, debouncedQuery, cat, onlyFav, strengthFilter, sort]);

  // ===== Sub-views =====
  // Etapa 15 — Em modo somente leitura, redireciona views de escrita para a lista.
  // Defesa em profundidade: além de esconder os botões, neutraliza a renderização.
  const WRITE_VIEWS: View["kind"][] = ["create", "edit", "change_master", "quick_unlock"];
  if (readOnly && WRITE_VIEWS.includes(view.kind)) {
    toast.error(tCofre("readOnly.lockedAction"));
    setView({ kind: "list" });
    return null;
  }
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
            { label: view.entry.name },
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
            evictCached(view.entry.id);
            setCachedSecret(view.entry.id, data.secret);
            toast.success("Acesso atualizado");
            await reload();
            const fresh = await fetchEntries(userId);
            const updated = fresh.find((x) => x.id === view.entry.id);
            if (updated) {
              const dec = await decryptOne(masterKey, updated);
              setCachedSecret(updated.id, dec.secret);
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
        onDeleted={async () => {
          evictCached(view.entry.id);
          await reload();
          setView({ kind: "list" });
        }}
        readOnly={readOnly}
      />
    );
  }
  if (view.kind === "change_master") {
    return (
      <ChangeMasterView
        userId={userId}
        currentKey={masterKey}
        currentSettings={settings}
        onBack={() => setView({ kind: "list" })}
        onChanged={(newSettings) => {
          onSettingsChanged(newSettings);
          clearSecretCache();
          // Invalida desbloqueio rápido — a chave mestra mudou
          disableQuickUnlock(userId);
          // Força novo unlock para usar a nova senha
          setMasterKey(null);
          toast.success("Senha mestra alterada. Faça o desbloqueio com a nova senha.");
        }}
      />
    );
  }
  if (view.kind === "backup") {
    return (
      <BackupView
        userId={userId}
        settings={settings}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }
  if (view.kind === "quick_unlock") {
    return (
      <QuickUnlockSettingsView
        userId={userId}
        userLabel={settings.hint ?? "Cofre Pessoal"}
        settings={settings}
        masterKey={masterKey}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }
  if (view.kind === "health") {
    return (
      <HealthView
        entries={entries}
        onBack={() => setView({ kind: "list" })}
        onOpenEntry={(entry) => setView({ kind: "detail", entry })}
        masterKey={masterKey}
      />
    );
  }

  // ===== Lista =====
  return (
    <>
      <PageHeader
        title="Cofre Pessoal"
        subtitle="Organize logins, senhas e informações importantes em um só lugar."
        crumbs={[{ label: "Cofre Pessoal" }]}
        actions={
          <>
            {!readOnly && (
              <Button
                onClick={() => setView({ kind: "create" })}
                className="bg-brand text-brand-foreground font-semibold shadow-md hover:bg-brand/90"
              >
                <Plus className="h-4 w-4" /> Adicionar acesso
              </Button>
            )}
            <Button variant="outline" onClick={onLock} title="Bloquear cofre">
              <Lock className="h-4 w-4" /> Bloquear
            </Button>
          </>
        }
      />

      {readOnly && <CofreReadOnlyNotice />}

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
            Seus dados são criptografados no seu dispositivo. O cofre se bloqueia sozinho por inatividade ou ao deixar o app em segundo plano.
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
            placeholder="Buscar por nome, usuário, e-mail, site, categoria…"
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
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i}>
              <Card className="flex items-center gap-3 p-3.5">
                <Skeleton className="h-12 w-12 rounded-xl" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : filtered.length === 0 ? (
        entries.length === 0 ? (
          readOnly ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              {tCofre("readOnly.createBlocked")}
            </Card>
          ) : (
            <EmptyVault onAdd={() => setView({ kind: "create" })} />
          )
        ) : (
          <NoResults onClear={() => { setQuery(""); setCat("todos"); setOnlyFav(false); setStrengthFilter("todas"); }} />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((e) => (
            <EntryCard
              key={e.id}
              row={e}
              masterKey={masterKey}
              onOpen={async () => {
                const dec = await decryptOne(masterKey, e);
                setCachedSecret(e.id, dec.secret);
                setView({ kind: "detail", entry: dec });
              }}
              onToggleFav={async () => {
                // Etapa 15 — defesa em profundidade: bloqueia escrita mesmo se UI for burlada.
                if (readOnly) {
                  toast.error(tCofre("readOnly.lockedAction"));
                  return;
                }
                const sec = getCachedSecret(e.id) ?? (await decryptOne(masterKey, e)).secret;
                await updateEntry({
                  id: e.id,
                  name: e.name,
                  category: e.category,
                  site: e.site,
                  favorite: !e.favorite,
                  secret: sec,
                  key: masterKey,
                  previousPassword: sec.password,
                });
                await reload();
              }}
            />
          ))}
        </ul>
      )}

      {/* Ações secundárias */}
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          type="button"
          onClick={() => setView({ kind: "health" })}
          className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:bg-accent/40"
        >
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand-on-soft">
            <Activity className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Saúde do cofre</p>
            <p className="truncate text-[11px] text-muted-foreground">
              Verifica senhas vazadas, repetidas e antigas.
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setView({ kind: "quick_unlock" })}
            className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:bg-accent/40"
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand-on-soft">
              <Fingerprint className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Desbloqueio rápido</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {getQuickUnlock(userId)
                  ? "Biometria ativa neste dispositivo"
                  : "Configure PIN ou biometria"}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            onClick={() => setView({ kind: "change_master" })}
            className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:bg-accent/40"
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand-on-soft">
              <SettingsIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Alterar senha mestra</p>
              <p className="truncate text-[11px] text-muted-foreground">Troca a senha que protege o cofre.</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setView({ kind: "backup" })}
          className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:bg-accent/40"
        >
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand-on-soft">
            <Download className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Exportar backup criptografado</p>
            <p className="truncate text-[11px] text-muted-foreground">Baixa um arquivo .json com seus dados cifrados.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      <Card className="mt-3 flex items-start gap-3 border-border/60 bg-card/60 p-4 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        <div>
          <p className="font-medium text-foreground">Preenchimento automático</p>
          <p className="mt-1 leading-relaxed">
            Por enquanto, o Cofre Pessoal permite copiar e abrir seus acessos com segurança. O preenchimento direto no teclado do celular (estilo Bitwarden/1Password) exige um aplicativo nativo ou extensão, e está sendo avaliado para uma versão futura.
          </p>
        </div>
      </Card>

      {settings.hint && entries.length > 0 && (
        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Dica da senha mestra: <span className="font-medium">{settings.hint}</span>
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

function EmptyVault({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="grid place-items-center gap-3 py-14 text-center animate-fade-in">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand-on-soft">
        <Shield className="h-7 w-7" />
      </span>
      <div>
        <p className="font-semibold">Seu cofre está vazio</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Adicione seu primeiro acesso para começar a organizar suas senhas com segurança.
        </p>
      </div>
      <Button onClick={onAdd} className="bg-brand text-brand-foreground hover:bg-brand/90">
        <Plus className="h-4 w-4" /> Adicionar primeiro acesso
      </Button>
    </Card>
  );
}

function NoResults({ onClear }: { onClear: () => void }) {
  return (
    <Card className="grid place-items-center gap-3 py-12 text-center animate-fade-in">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <Search className="h-6 w-6" />
      </span>
      <div>
        <p className="font-semibold">Nenhum resultado</p>
        <p className="mt-1 text-xs text-muted-foreground">Tente outra busca ou limpe os filtros.</p>
      </div>
      <Button variant="outline" onClick={onClear}>Limpar filtros</Button>
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

// ====== Copy helpers (com feedback + auto-clear de clipboard) ======
const CLIPBOARD_CLEAR_MS = 20_000;
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
function scheduleClipboardClear(originalText: string) {
  window.setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText();
      if (current === originalText) {
        await navigator.clipboard.writeText("");
      }
    } catch {
      // WebView/iOS pode não permitir leitura — ignora silenciosamente
    }
  }, CLIPBOARD_CLEAR_MS);
}
async function copyWithToast(text: string, label: string, sensitive = false) {
  const ok = await copyToClipboard(text);
  if (!ok) {
    toast.error(i18n.t("cofre:errors.copyFailed"));
    return false;
  }
  if (sensitive) {
    toast.success(`${label} copiada`, {
      description: "Por segurança, será removida da área de transferência em alguns segundos.",
    });
    scheduleClipboardClear(text);
  } else {
    toast.success(`${label} copiado`);
  }
  return true;
}

/** Botão com feedback de check verde por 1s após copiar */
function CopyButton({
  value,
  label,
  sensitive,
  size = "icon",
  className,
  variant = "outline",
  children,
}: {
  value: string;
  label: string;
  sensitive?: boolean;
  size?: "icon" | "sm" | "default";
  className?: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
  children?: React.ReactNode;
}) {
  const [done, setDone] = useState(false);
  const timerRef = useRef<number | null>(null);
  return (
    <Button
      size={size as never}
      variant={variant as never}
      className={cn("transition-all", done && "border-emerald-500/60 text-emerald-400", className)}
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyWithToast(value, label, sensitive);
        if (ok) {
          setDone(true);
          if (timerRef.current) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => setDone(false), 1000);
        }
      }}
      title={`Copiar ${label.toLowerCase()}`}
      type="button"
    >
      {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {children}
    </Button>
  );
}

// =====================================================================
// EntryCard
// =====================================================================
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
  const [maskedUser, setMaskedUser] = useState<string>(() => {
    const sec = getCachedSecret(row.id);
    return sec ? maskUsername(sec.username ?? "") : "•••";
  });

  useEffect(() => {
    let alive = true;
    const sec = getCachedSecret(row.id);
    if (sec) {
      setMaskedUser(maskUsername(sec.username ?? ""));
      return () => { alive = false; };
    }
    decryptOne(masterKey, row)
      .then((d) => {
        if (!alive) return;
        setCachedSecret(row.id, d.secret);
        setMaskedUser(maskUsername(d.secret.username ?? ""));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [row, masterKey]);

  async function getSecret() {
    const cached = getCachedSecret(row.id);
    if (cached) return cached;
    const dec = await decryptOne(masterKey, row);
    setCachedSecret(row.id, dec.secret);
    return dec.secret;
  }

  return (
    <li>
      <Card className="group flex items-center gap-3 p-3.5 transition-colors hover:bg-accent/20">
        <button
          onClick={onOpen}
          className="shrink-0 rounded-xl outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-brand"
          aria-label="Abrir detalhes"
          type="button"
        >
          <CompanyLogo site={row.site} name={row.name} />
        </button>
        <button onClick={onOpen} className="min-w-0 flex-1 text-left" type="button">
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
          <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); onToggleFav(); }} title="Favoritar" className="h-8 w-8" type="button">
            {row.favorite ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> : <StarOff className="h-4 w-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            type="button"
            title="Copiar usuário"
            onClick={async (e) => {
              e.stopPropagation();
              const sec = await getSecret();
              await copyWithToast(sec.username ?? "", "Usuário");
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            type="button"
            title="Copiar senha"
            onClick={async (e) => {
              e.stopPropagation();
              const sec = await getSecret();
              await copyWithToast(sec.password ?? "", "Senha", true);
            }}
          >
            <KeyRound className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </li>
  );
}

// =====================================================================
// Detail (com auto-hide e inline delete)
// =====================================================================
const PWD_AUTO_HIDE_MS = 20_000;

function DetailView({
  entry,
  onBack,
  onEdit,
  onDeleted,
  readOnly = false,
}: {
  entry: DecryptedEntry;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  readOnly?: boolean;
}) {
  const [showPwd, setShowPwd] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!showPwd) {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      return;
    }
    hideTimerRef.current = window.setTimeout(() => setShowPwd(false), PWD_AUTO_HIDE_MS);
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [showPwd]);

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      await deleteEntry(entry.id);
      toast.success("Acesso excluído");
      onDeleted();
    } catch (e) {
      toast.error(i18n.t("cofre:errors.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

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
      <Card className="mb-4 flex items-center gap-3 p-4">
        <CompanyLogo site={entry.site} name={entry.name} className="h-14 w-14" rounded="2xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{entry.name}</p>
          {entry.site && (
            <p className="truncate text-xs text-muted-foreground">{extractDomain(entry.site) ?? entry.site}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{categoryLabel(entry.category)}</Badge>
            {strengthBadge(entry.password_strength)}
            {entry.favorite && (
              <Badge className="border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/10">
                <Star className="mr-1 h-3 w-3 fill-amber-400 text-amber-400" /> Favorito
              </Badge>
            )}
          </div>
        </div>
      </Card>

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
            <Button size="icon" variant="outline" onClick={() => setShowPwd((s) => !s)} title="Mostrar/ocultar" type="button">
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <CopyButton value={entry.secret.password ?? ""} label="Senha" sensitive />
          </div>
          {showPwd && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              A senha será ocultada automaticamente em alguns segundos.
            </p>
          )}
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
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Abrir site
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

      {/* Ações: confirmação inline para exclusão (sem window.confirm) */}
      <div className="mt-4">
        {!confirmingDelete ? (
          <div className="flex flex-wrap gap-2">
            {!readOnly && (
              <Button onClick={onEdit} className="bg-brand text-brand-foreground hover:bg-brand/90">
                <Pencil className="h-4 w-4" /> Editar
              </Button>
            )}
            <CopyButton value={entry.secret.password ?? ""} label="Senha" sensitive variant="outline" size="default">
              <span className="ml-1.5">Copiar senha</span>
            </CopyButton>
            <Button variant="outline" onClick={() => setConfirmingDelete(true)} className="text-red-400 hover:text-red-300">
              <Trash2 className="h-4 w-4" /> Excluir
            </Button>
          </div>
        ) : (
          <Card className="border-red-500/40 bg-red-500/5 p-4 animate-fade-in">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-500/15 text-red-400">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Excluir “{entry.name}”?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Esta ação não pode ser desfeita. O acesso será removido do seu cofre.
                </p>
                <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                    Cancelar
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleConfirmDelete}
                    disabled={deleting}
                  >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    {deleting ? "Excluindo…" : "Excluir definitivamente"}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}
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
        <CopyButton value={value} label={copyLabel} />
      </div>
      {trailing && <div className="mt-1.5">{trailing}</div>}
    </div>
  );
}

// =====================================================================
// Form (create/edit)
// =====================================================================
function EntryForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: DecryptedEntry;
  submitLabel?: string;
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
    if (busy) return;
    if (!name.trim()) {
      toast.error("Informe o nome do acesso");
      return;
    }
    setBusy(true);
    try {
      const rawSite = site.trim();
      const cleanSite = rawSite ? (extractDomain(rawSite) ?? rawSite) : null;
      await onSubmit({
        name: name.trim(),
        category,
        site: cleanSite,
        favorite,
        secret: { username, password, notes },
      });
    } catch (e) {
      toast.error(i18n.t("cofre:errors.saveFailed"));
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
          <div className="flex items-center gap-3">
            <CompanyLogo site={site || null} name={name || site || "?"} className="h-12 w-12" />
            <div className="min-w-0 flex-1">
              <Input id="f-site" value={site} onChange={(e) => setSite(e.target.value)} placeholder="exemplo.com.br ou https://exemplo.com" inputMode="url" />
              {site && extractDomain(site) && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Salvaremos como <span className="font-medium text-foreground">{extractDomain(site)}</span> para buscar o logo automaticamente.
                </p>
              )}
            </div>
          </div>
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
              onFocus={(e) => {
                // Em telas pequenas, sobe o campo quando o teclado abrir
                setTimeout(() => e.currentTarget?.scrollIntoView?.({ block: "center", behavior: "smooth" }), 200);
              }}
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

      {/* Bloco 3: Segurança e observações */}
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

      {/* Barra de ações: SEMPRE visível, sólida, com safe-area */}
      <div
        className="sticky bottom-0 z-20 -mx-4 mt-2 border-t border-border bg-background px-4 py-3 lg:-mx-8 lg:px-8"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
            className="h-11 sm:h-10 sm:w-auto"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy || !name.trim()}
            className="h-12 w-full bg-brand text-brand-foreground text-base font-semibold shadow-lg shadow-brand/25 ring-1 ring-brand/40 transition-transform hover:bg-brand/90 active:scale-[0.98] disabled:opacity-60 sm:h-11 sm:w-auto sm:px-8"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" /> {submitLabel ?? "Salvar acesso"}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Alterar senha mestra
// =====================================================================
function ChangeMasterView({
  userId,
  currentKey,
  currentSettings,
  onBack,
  onChanged,
}: {
  userId: string;
  currentKey: CryptoKey;
  currentSettings: VaultSettingsRow;
  onBack: () => void;
  onChanged: (s: VaultSettingsRow) => void;
}) {
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [hint, setHint] = useState(currentSettings.hint ?? "");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const strength = evaluateStrength(newPwd);

  async function submit() {
    if (busy) return;
    if (newPwd.length < 8) {
      toast.error("A nova senha deve ter pelo menos 8 caracteres");
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error("As novas senhas não conferem");
      return;
    }
    setBusy(true);
    try {
      // Valida senha atual
      const verify = await unlockMasterKey(oldPwd, currentSettings);
      if (!verify) {
        toast.error("Senha mestra atual incorreta");
        setBusy(false);
        return;
      }
      await rotateMasterKey({
        userId,
        currentKey,
        newPassword: newPwd,
        hint: hint || null,
      });
      const fresh = await fetchVaultSettings(userId);
      if (fresh) onChanged(fresh);
    } catch (e) {
      toast.error(i18n.t("cofre:errors.masterPasswordFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Alterar senha mestra"
        subtitle="Troque a senha que protege seu cofre. Todos os acessos serão recriptografados com a nova senha."
        crumbs={[{ label: "Cofre Pessoal", to: "/app/cofre-pessoal" }, { label: "Alterar senha mestra" }]}
        onBack={onBack}
      />

      <Card className="mb-4 flex items-start gap-3 border-amber-500/40 bg-amber-500/5 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <p className="text-xs leading-relaxed text-foreground/90">
          Se você esquecer a nova senha mestra, <strong>não será possível recuperar os dados do cofre</strong>. Guarde a nova senha em local seguro antes de continuar.
        </p>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="cm-old">Senha mestra atual</Label>
          <div className="relative">
            <Input
              id="cm-old"
              type={show ? "text" : "password"}
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              className="pr-10 font-mono"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={show ? "Ocultar" : "Mostrar"}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cm-new">Nova senha mestra</Label>
          <Input
            id="cm-new"
            type={show ? "text" : "password"}
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            className="font-mono"
            autoComplete="new-password"
            placeholder="Mínimo 8 caracteres"
          />
          {newPwd && (
            <div className="flex items-center gap-2 pt-0.5">
              {strengthBadge(strength)}
              <p className="text-[11px] text-muted-foreground">
                {strength === "forte" ? "Excelente!" : strength === "media" ? "Pode melhorar." : "Use 12+ caracteres, números e símbolos."}
              </p>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cm-conf">Confirmar nova senha</Label>
          <Input
            id="cm-conf"
            type={show ? "text" : "password"}
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            className="font-mono"
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cm-hint">Dica (opcional)</Label>
          <Input
            id="cm-hint"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="Ex.: meu time favorito + ano"
          />
        </div>
      </Card>

      <div
        className="sticky bottom-0 z-20 -mx-4 mt-2 border-t border-border bg-background px-4 py-3 lg:-mx-8 lg:px-8"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button type="button" variant="outline" onClick={onBack} disabled={busy} className="h-11 sm:h-10 sm:w-auto">
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy || !oldPwd || !newPwd || !confirmPwd}
            className="h-12 w-full bg-brand text-brand-foreground text-base font-semibold shadow-lg shadow-brand/25 ring-1 ring-brand/40 hover:bg-brand/90 sm:h-11 sm:w-auto sm:px-8"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {busy ? "Alterando…" : "Alterar senha mestra"}
          </Button>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// Export (backup criptografado)
// =====================================================================
function BackupView({
  userId,
  settings,
  onBack,
}: {
  userId: string;
  settings: VaultSettingsRow;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    try {
      const json = await buildEncryptedBackup({ userId, settings });
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `cofre-pessoal-backup-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Backup exportado");
    } catch (e) {
      toast.error(i18n.t("cofre:errors.exportFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Backup criptografado"
        subtitle="Baixe um arquivo .json com todos os seus acessos ainda cifrados."
        crumbs={[{ label: "Cofre Pessoal", to: "/app/cofre-pessoal" }, { label: "Backup" }]}
        onBack={onBack}
      />
      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3 rounded-xl bg-brand-soft/40 p-3 text-foreground/90">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-on-soft" />
          <div className="text-xs leading-relaxed">
            <p className="font-medium text-foreground">As senhas continuam protegidas</p>
            <p className="mt-1 text-muted-foreground">
              O arquivo é exportado com os dados <strong>já criptografados</strong>. Para abrir o backup no futuro, será necessária a senha mestra atual.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl bg-amber-500/10 p-3 text-foreground/90">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="text-xs leading-relaxed">
            <p className="font-medium text-foreground">A restauração ainda não está disponível</p>
            <p className="mt-1 text-muted-foreground">
              Você pode guardar o arquivo agora como cópia de segurança. A função de restaurar a partir do backup será liberada em uma versão futura.
            </p>
          </div>
        </div>

        <Button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="h-12 w-full bg-brand text-brand-foreground text-base font-semibold shadow-md hover:bg-brand/90"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {busy ? "Gerando…" : "Exportar backup criptografado"}
        </Button>
      </Card>
    </>
  );
}

// =====================================================================
// Desbloqueio rápido (PIN + biometria)
// =====================================================================
function QuickUnlockSettingsView({
  userId,
  userLabel,
  settings,
  masterKey,
  onBack,
}: {
  userId: string;
  userLabel: string;
  settings: VaultSettingsRow;
  masterKey: CryptoKey;
  onBack: () => void;
}) {
  const [rec, setRec] = useState<QuickUnlockRecord | null>(() => getQuickUnlock(userId));
  const [pinStatus, setPinStatus] = useState<ServerPinStatus | null>(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  // Painel ativo dentro do card de PIN
  // "none" | "setup" (sem PIN) | "change" (alterar) | "forgot" (esqueci)
  type Panel = "none" | "setup" | "change" | "forgot";
  const [panel, setPanel] = useState<Panel>("none");
  const [stage, setStage] = useState<"verify" | "set" | "confirm">("verify");
  const [masterPwd, setMasterPwd] = useState("");
  const [showMaster, setShowMaster] = useState(false);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");

  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(setBioAvailable);
    getServerPinStatus(userId).then(setPinStatus).catch(() => setPinStatus(null));
  }, [userId]);

  function refresh() {
    setRec(getQuickUnlock(userId));
    getServerPinStatus(userId).then(setPinStatus).catch(() => setPinStatus(null));
  }

  function resetPanel() {
    setPanel("none");
    setStage("verify");
    setMasterPwd("");
    setPin("");
    setPinConfirm("");
    setShowMaster(false);
  }

  function openSetup() {
    resetPanel();
    setPanel("setup");
    setStage("set");
  }
  function openChange() {
    resetPanel();
    setPanel("change");
    setStage("verify");
  }
  function openForgot() {
    resetPanel();
    setPanel("forgot");
    setStage("verify");
  }

  async function handleVerifyMaster() {
    if (!masterPwd) {
      toast.error("Digite a senha mestra");
      return;
    }
    setBusy(true);
    try {
      const k = await unlockMasterKey(masterPwd, settings);
      if (!k) {
        toast.error("Senha mestra incorreta");
        return;
      }
      setStage("set");
    } finally {
      setMasterPwd("");
      setShowMaster(false);
      setBusy(false);
    }
  }

  async function handleSavePin() {
    if (pin.length < 4) {
      toast.error("O PIN deve ter ao menos 4 dígitos");
      return;
    }
    if (pin !== pinConfirm) {
      toast.error("Os PINs digitados não conferem");
      return;
    }
    setBusy(true);
    try {
      await enableServerPin(pin, masterKey);
      toast.success(panel === "setup" ? "PIN configurado" : "PIN alterado com sucesso");
      resetPanel();
      refresh();
    } catch (e) {
      toast.error(i18n.t("cofre:errors.quickUnlockFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleEnableBiometric() {
    setBusy(true);
    try {
      await enableBiometricUnlock(userId, userLabel, masterKey);
      toast.success("Biometria ativada com sucesso neste dispositivo.");
      refresh();
    } catch (e) {
      toast.error(i18n.t("cofre:errors.biometricFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemovePin() {
    if (!(await confirmAsync({ title: "Remover o PIN da sua conta?", description: "Você precisará da senha mestra para entrar em todos os dispositivos.", destructive: true, confirmText: "Remover PIN" }))) return;
    setBusy(true);
    try {
      await disableServerPin();
      resetPanel();
      refresh();
      toast.success("PIN removido da conta");
    } catch (e) {
      toast.error(i18n.t("cofre:errors.removePinFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveBio() {
    if (!(await confirmAsync({ title: "Remover a biometria deste dispositivo?", destructive: true, confirmText: "Remover biometria" }))) return;
    disableQuickUnlock(userId);
    refresh();
    toast.success("Biometria removida deste dispositivo");
  }

  const hasPin = pinStatus?.configured ?? false;
  const hasBio = rec?.kind === "webauthn" || rec?.kind === "android-bio";

  return (
    <>
      <PageHeader
        title="Desbloqueio rápido"
        subtitle="Use um PIN curto ou sua biometria para abrir o cofre sem digitar a senha mestra toda vez."
        crumbs={[{ label: "Cofre Pessoal", to: "/app/cofre-pessoal" }, { label: "Desbloqueio rápido" }]}
        onBack={onBack}
      />

      <Card className="mb-4 flex items-start gap-3 border-border/60 bg-card/60 p-4 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        <div>
          <p className="font-medium text-foreground">Como isso funciona</p>
          <p className="mt-1">
            Seu PIN é usado apenas para desbloqueio rápido neste dispositivo. Por segurança, ele <strong>não pode ser visualizado</strong>, apenas alterado. Sua senha mestra continua sendo a única forma de criar o cofre — a chave do cofre fica guardada cifrada localmente e só é aberta com o PIN ou biometria.
          </p>
        </div>
      </Card>

      {/* ============ CARD: PIN rápido ============ */}
      <Card className="mb-4 p-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid h-10 w-10 place-items-center rounded-lg",
              hasPin ? "bg-emerald-500/15 text-emerald-400" : "bg-brand-soft text-brand-on-soft",
            )}
          >
            <KeyRound className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">PIN rápido</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {hasPin
                ? `Ativo na sua conta${pinStatus?.updatedAt ? ` desde ${new Date(pinStatus.updatedAt).toLocaleDateString("pt-BR")}` : ""}`
                : "4 a 8 dígitos numéricos. Recomendado: 6."}
            </p>
          </div>
          {hasPin && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> PIN configurado
            </span>
          )}
        </div>

        {/* Status + ações principais quando há PIN */}
        {hasPin && panel === "none" && (
          <>
            <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              Por segurança, não exibimos o PIN cadastrado. Você pode alterá-lo ou removê-lo a qualquer momento.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                onClick={openChange}
                className="h-11 bg-brand text-brand-foreground font-semibold hover:bg-brand/90"
              >
                <KeyRound className="h-4 w-4" /> Alterar PIN
              </Button>
              <Button type="button" variant="outline" onClick={handleRemovePin} className="h-11">
                <Trash2 className="h-4 w-4" /> Remover PIN
              </Button>
            </div>
            <button
              type="button"
              onClick={openForgot}
              className="mt-3 text-[12px] font-medium text-brand underline-offset-4 hover:underline"
            >
              Esqueci meu PIN
            </button>
          </>
        )}

        {/* Botão de configurar quando não há PIN */}
        {!hasPin && panel === "none" && (
          <Button
            type="button"
            onClick={openSetup}
            className="mt-3 h-11 w-full bg-brand text-brand-foreground font-semibold hover:bg-brand/90"
          >
            Configurar PIN
          </Button>
        )}

        {/* Painel inline (setup / change / forgot) */}
        {panel !== "none" && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            {panel === "forgot" && stage === "verify" && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-[11px] text-foreground/90">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p>
                  Por segurança, não exibimos o PIN cadastrado. Confirme sua senha mestra para criar um novo PIN.
                </p>
              </div>
            )}

            {/* Verificação de senha mestra */}
            {(panel === "change" || panel === "forgot") && stage === "verify" && (
              <>
                <Label>Senha mestra</Label>
                <div className="relative">
                  <Input
                    type={showMaster ? "text" : "password"}
                    value={masterPwd}
                    onChange={(e) => setMasterPwd(e.target.value)}
                    placeholder="Digite a senha mestra"
                    autoFocus
                    className="h-12 pr-11"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy) {
                        e.preventDefault();
                        void handleVerifyMaster();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowMaster((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:bg-accent"
                    aria-label={showMaster ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showMaster ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={resetPanel} disabled={busy}>
                    Cancelar
                  </Button>
                  <Button
                    className="flex-1 bg-brand text-brand-foreground hover:bg-brand/90"
                    disabled={busy || !masterPwd}
                    onClick={handleVerifyMaster}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Confirmar
                  </Button>
                </div>
              </>
            )}

            {/* Novo PIN */}
            {stage === "set" && (
              <>
                <Label>{panel === "setup" ? "Crie um PIN" : "Crie um novo PIN"}</Label>
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  className="h-12 text-center text-xl tracking-[0.5em] font-mono"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={resetPanel}>
                    Cancelar
                  </Button>
                  <Button
                    className="flex-1 bg-brand text-brand-foreground hover:bg-brand/90"
                    disabled={pin.length < 4}
                    onClick={() => setStage("confirm")}
                  >
                    Continuar
                  </Button>
                </div>
              </>
            )}

            {/* Confirmar PIN */}
            {stage === "confirm" && (
              <>
                <Label>Confirme o PIN</Label>
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  className="h-12 text-center text-xl tracking-[0.5em] font-mono"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => { setPinConfirm(""); setStage("set"); }}>
                    Voltar
                  </Button>
                  <Button
                    className="flex-1 bg-brand text-brand-foreground hover:bg-brand/90"
                    disabled={busy || pinConfirm.length < 4}
                    onClick={handleSavePin}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {panel === "setup" ? "Ativar PIN" : "Salvar novo PIN"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Card>

      {/* ============ CARD: Biometria ============ */}
      <Card className="mb-4 p-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid h-10 w-10 place-items-center rounded-lg",
              hasBio ? "bg-emerald-500/15 text-emerald-400" : "bg-brand-soft text-brand-on-soft",
            )}
          >
            <Fingerprint className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Biometria / Face ID</p>
            <p className="text-[11px] text-muted-foreground">
              {hasBio
                ? `Ativa neste dispositivo desde ${new Date(rec!.createdAt).toLocaleDateString("pt-BR")}`
                : bioAvailable
                ? "Usa a biometria nativa deste aparelho quando disponível."
                : "Indisponível neste dispositivo ou navegador."}
            </p>
          </div>
          {hasBio && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Biometria ativa
            </span>
          )}
        </div>
        {hasBio ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleRemoveBio}
            className="mt-3 h-11 w-full"
          >
            <Trash2 className="h-4 w-4" /> Remover biometria
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleEnableBiometric}
            disabled={busy || !bioAvailable}
            className="mt-3 h-11 w-full bg-brand text-brand-foreground font-semibold hover:bg-brand/90"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
            Configurar biometria
          </Button>
        )}
      </Card>

      {/* ============ CARD: Segurança ============ */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand-on-soft">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Segurança</p>
            <p className="text-[11px] text-muted-foreground">Proteções automáticas do desbloqueio rápido.</p>
          </div>
        </div>
        <ul className="mt-3 space-y-2 text-[12px] text-muted-foreground">
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span>O PIN <strong>nunca</strong> é salvo em texto puro — apenas a chave do cofre cifrada por uma derivação PBKDF2 do seu PIN.</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span>Após <strong>5 tentativas incorretas</strong>, o desbloqueio rápido é desativado automaticamente. Use a senha mestra para configurar novamente.</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span>O PIN vale somente neste dispositivo/navegador — não é sincronizado.</span>
          </li>
        </ul>
      </Card>
    </>
  );
}

// =====================================================================
// Saúde do cofre (HIBP + reutilizadas + antigas + fracas)
// =====================================================================
function HealthView({
  entries,
  masterKey,
  onBack,
  onOpenEntry,
}: {
  entries: VaultEntryRow[];
  masterKey: CryptoKey;
  onBack: () => void;
  onOpenEntry: (entry: DecryptedEntry) => void;
}) {
  const [report, setReport] = useState<import("@/lib/vault/health").HealthReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const runScan = useCallback(async () => {
    setScanning(true);
    setProgress(null);
    try {
      const { analyzeVault } = await import("@/lib/vault/health");
      // Garante secrets descifrados
      const enriched: import("@/lib/vault/health").EntryForHealth[] = [];
      for (const r of entries) {
        try {
          let sec = getCachedSecret(r.id);
          if (!sec) {
            const dec = await decryptOne(masterKey, r);
            setCachedSecret(r.id, dec.secret);
            sec = dec.secret;
          }
          enriched.push({
            id: r.id,
            name: r.name,
            category: r.category,
            site: r.site,
            updated_at: r.updated_at,
            password_strength: r.password_strength,
            password: sec?.password ?? "",
          });
        } catch {
          // skip
        }
      }
      const rep = await analyzeVault(enriched, (done, total) =>
        setProgress({ done, total }),
      );
      setReport(rep);
    } catch (e) {
      toast.error(i18n.t("cofre:errors.analysisFailed"));
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, [entries, masterKey]);

  async function openEntry(id: string) {
    const row = entries.find((e) => e.id === id);
    if (!row) return;
    try {
      const dec = await decryptOne(masterKey, row);
      onOpenEntry(dec);
    } catch (e) {
      toast.error(i18n.t("cofre:errors.openAccessFailed"));
    }
  }

  const score = useMemo(() => {
    if (!report) return null;
    const total = Math.max(1, report.total);
    const problems =
      report.weak.length +
      report.pwned.length +
      report.reused.reduce((a, g) => a + g.entries.length, 0) +
      report.old.length;
    const ratio = Math.max(0, 1 - problems / (total * 2));
    return Math.round(ratio * 100);
  }, [report]);

  return (
    <>
      <PageHeader
        title="Saúde do cofre"
        subtitle="Detecta senhas vazadas em vazamentos públicos (via HIBP), repetidas em mais de um acesso, antigas e fracas."
        crumbs={[{ label: "Cofre Pessoal", to: "/app/cofre-pessoal" }, { label: "Saúde do cofre" }]}
        onBack={onBack}
        actions={
          <Button
            onClick={runScan}
            disabled={scanning || entries.length === 0}
            className="bg-brand text-brand-foreground font-semibold hover:bg-brand/90"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {report ? "Analisar novamente" : "Iniciar análise"}
          </Button>
        }
      />

      <Card className="mb-5 flex items-start gap-3 border-brand/30 bg-brand-soft/30 p-4 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-on-soft" />
        <div>
          <p className="text-sm font-semibold text-foreground">Verificação privada</p>
          <p className="mt-1 text-muted-foreground">
            A checagem usa o protocolo k-anonymity do Have I Been Pwned: somente os primeiros 5 caracteres do hash SHA-1 da senha saem do seu dispositivo — a senha em si <strong>nunca é enviada</strong>.
          </p>
        </div>
      </Card>

      {entries.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Adicione acessos ao cofre para analisar a saúde das senhas.
        </Card>
      )}

      {scanning && (
        <Card className="mb-4 flex items-center gap-3 p-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-brand" />
          <span>
            Analisando senhas{progress ? ` (${progress.done}/${progress.total})` : "…"}
          </span>
        </Card>
      )}

      {report && !scanning && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ScoreCard score={score ?? 0} />
            <StatCard label="Senhas vazadas" value={report.pwned.length} tone={report.pwned.length ? "warning" : "success"} />
            <StatCard
              label="Repetidas"
              value={report.reused.reduce((a, g) => a + g.entries.length, 0)}
              tone={report.reused.length ? "warning" : "success"}
            />
            <StatCard label="Antigas (1+ ano)" value={report.old.length} tone={report.old.length ? "warning" : "success"} />
          </div>

          {report.pwnedFailed > 0 && (
            <Card className="mb-4 flex items-start gap-3 border-amber-500/30 bg-amber-500/10 p-3 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-foreground/90">
                Não foi possível verificar {report.pwnedFailed} {report.pwnedFailed === 1 ? "senha" : "senhas"} contra a base de vazamentos (problema de rede). Tente novamente em instantes.
              </p>
            </Card>
          )}

          <HealthSection
            icon={<ShieldAlert className="h-4 w-4" />}
            tone="danger"
            title="Senhas vazadas em violações públicas"
            empty="Nenhuma senha do cofre apareceu em vazamentos conhecidos."
            items={report.pwned.map((p) => ({
              id: p.entry.id,
              name: p.entry.name,
              site: p.entry.site ?? undefined,
              meta: `Encontrada em ${p.count.toLocaleString("pt-BR")} ${p.count === 1 ? "vazamento" : "vazamentos"}`,
            }))}
            onOpen={openEntry}
          />

          <HealthSection
            icon={<Repeat className="h-4 w-4" />}
            tone="warning"
            title="Senhas reutilizadas em mais de um acesso"
            empty="Cada acesso tem uma senha única — ótimo!"
            items={report.reused.flatMap((g) =>
              g.entries.map((e) => ({
                id: e.id,
                name: e.name,
                site: e.site ?? undefined,
                meta: `Compartilhada com ${g.entries.length - 1} outro${g.entries.length - 1 === 1 ? "" : "s"} acesso${g.entries.length - 1 === 1 ? "" : "s"}`,
              })),
            )}
            onOpen={openEntry}
          />

          <HealthSection
            icon={<AlertTriangle className="h-4 w-4" />}
            tone="warning"
            title="Senhas fracas"
            empty="Nenhuma senha fraca identificada."
            items={report.weak.map((e) => ({
              id: e.id,
              name: e.name,
              site: e.site ?? undefined,
              meta: "Considere gerar uma senha mais forte",
            }))}
            onOpen={openEntry}
          />

          <HealthSection
            icon={<Clock className="h-4 w-4" />}
            tone="muted"
            title="Senhas antigas (sem alteração há mais de 1 ano)"
            empty="Todas as senhas foram atualizadas no último ano."
            items={report.old.map((e) => ({
              id: e.id,
              name: e.name,
              site: e.site ?? undefined,
              meta: `Atualizada em ${new Date(e.updated_at).toLocaleDateString("pt-BR")}`,
            }))}
            onOpen={openEntry}
          />
        </>
      )}

      {!report && !scanning && entries.length > 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Toque em <strong className="text-foreground">Iniciar análise</strong> para verificar a saúde das suas senhas.
        </Card>
      )}
    </>
  );
}

function ScoreCard({ score }: { score: number }) {
  const tone =
    score >= 85 ? "success" : score >= 60 ? "warning" : "danger";
  const color =
    tone === "success"
      ? "text-emerald-400"
      : tone === "warning"
      ? "text-amber-400"
      : "text-rose-400";
  return (
    <Card className="p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pontuação</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", color)}>{score}<span className="text-sm text-muted-foreground">/100</span></p>
    </Card>
  );
}

function HealthSection({
  icon,
  title,
  empty,
  items,
  tone,
  onOpen,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  tone: "danger" | "warning" | "muted";
  items: { id: string; name: string; site?: string; meta: string }[];
  onOpen: (id: string) => void;
}) {
  const accent =
    tone === "danger"
      ? "text-rose-400 bg-rose-500/10 ring-rose-500/30"
      : tone === "warning"
      ? "text-amber-400 bg-amber-500/10 ring-amber-500/30"
      : "text-muted-foreground bg-muted/30 ring-border";
  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className={cn("grid h-7 w-7 place-items-center rounded-lg ring-1", accent)}>
          {icon}
        </span>
        <p className="text-sm font-semibold">{title}</p>
        <span className="ml-auto rounded-full bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it) => (
            <li key={`${title}-${it.id}-${it.meta}`}>
              <button
                type="button"
                onClick={() => onOpen(it.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {it.site ? `${it.site} · ` : ""}{it.meta}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
