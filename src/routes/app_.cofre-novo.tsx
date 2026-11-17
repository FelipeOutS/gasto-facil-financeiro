import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, Check, ChevronRight, Copy, Download, Eye, EyeOff, Fingerprint, KeyRound, Loader2, Lock,
  Pencil, Plus, Search, ShieldCheck, Smartphone, Sparkles, Trash2, TriangleAlert, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/MobileShell";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { evaluateStrength, generateStrongPassword } from "@/lib/vault/strength";
import { deviceLabel, evaluate, passkeyAvailable, registerPasskey } from "@/lib/vault/v2/passkey";
import { legacyEntryCount, supabaseVaultStore } from "@/lib/vault/v2/supabase-store";
import * as V from "@/lib/vault/v2/service";

export const Route = createFileRoute("/app_/cofre-novo")({
  head: () => ({
    meta: [
      { title: "Cofre Pessoal — Gasto Inteligente" },
      { name: "description", content: "Guarde senhas com Face ID, Touch ID e chave de recuperação, sem senha mestra." },
      { property: "og:title", content: "Cofre Pessoal — Gasto Inteligente" },
      { property: "og:description", content: "Cofre de senhas sem senha mestra, com biometria e recuperação." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CofreNovoPage,
});

const CATEGORIAS = ["Bancos", "E-mail", "Redes sociais", "Trabalho", "Compras", "Governo", "Outros"];
const EMPTY: V.Secret = { title: "", username: "", password: "", url: "", category: "Outros", notes: "" };
type Item = { id: string; updated_at: string; secret: V.Secret };
type Phase = "loading" | "error" | "setup" | "locked" | "open";

const errMsg = (e: unknown) => {
  const m = e instanceof Error ? e.message : "";
  if (m === "cancelado" || /NotAllowed|abort/i.test(m)) return "Ação cancelada no aparelho.";
  if (m === "prf_nao_suportado") return "Este navegador não permite usar a biometria para abrir o Cofre. Use a chave de recuperação.";
  if (m === "passkey_indisponivel") return "Biometria indisponível neste navegador.";
  if (m === "aparelho_nao_autorizado") return "Este aparelho não está autorizado ou foi revogado.";
  if (m === "chave_invalida" || m === "chave_recuperacao_invalida") return "Chave não confere. Confira e tente de novo.";
  if (m === "manter_recuperacao") return "Mantenha sempre uma chave de recuperação ativa.";
  return "Não foi possível concluir. Tente de novo.";
};

function CofreNovoPage() {
  const { user } = useAuth();
  const store = useMemo(() => (user ? supabaseVaultStore(user.id) : null), [user]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [vault, setVault] = useState<V.Vault | null>(null);
  const [slots, setSlots] = useState<V.Slot[]>([]);
  const [legacy, setLegacy] = useState<number | null>(null);
  const dekRef = useRef<CryptoKey | null>(null);
  const [items, setItems] = useState<Item[]>([]);

  const load = useCallback(async () => {
    if (!store || !user) return;
    setPhase("loading");
    try {
      legacyEntryCount(user.id).then((n) => (n === null ? new Promise<number | null>((r) => setTimeout(() => legacyEntryCount(user.id).then(r), 1500)) : n)).then(setLegacy);
      const v = await store.getVault();
      const s = v ? await store.listSlots(v.id) : [];
      setVault(v); setSlots(s);
      setPhase(v && V.isConfigured(s) ? "locked" : "setup");
    } catch { setPhase("error"); }
  }, [store, user]);
  useEffect(() => { load(); }, [load]);

  const lock = useCallback(() => { dekRef.current = null; setItems([]); setPhase((p) => (p === "open" ? "locked" : p)); }, []);
  const refresh = useCallback(async () => {
    if (!store || !vault || !dekRef.current) return;
    setItems(await V.readEntries(store, vault, dekRef.current));
    setSlots(await store.listSlots(vault.id));
  }, [store, vault]);
  const opened = async (v: V.Vault, dek: CryptoKey) => {
    dekRef.current = dek; setVault(v); setPhase("open");
    if (store) { setItems(await V.readEntries(store, v, dek)); setSlots(await store.listSlots(v.id)); }
  };

  // bloqueio automático por inatividade e ao sair da aba
  useEffect(() => {
    if (phase !== "open") return;
    const ms = (vault?.auto_lock_minutes ?? 5) * 60_000;
    let t = setTimeout(lock, ms);
    const bump = () => { clearTimeout(t); t = setTimeout(lock, ms); };
    let hiddenAt = 0;
    const vis = () => { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 60_000) lock(); };
    const evs = ["pointerdown", "keydown", "scroll"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    document.addEventListener("visibilitychange", vis);
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, bump)); document.removeEventListener("visibilitychange", vis); };
  }, [phase, vault, lock]);

  return (
    <MobileShell>
      <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-24 pt-2">
        <SettingsPageHeader title="Cofre Pessoal" description="Sem senha mestra: abre com Face ID, Touch ID ou chave de recuperação." backTo="/app" />
        {phase === "loading" && <Skeleton className="h-48 w-full rounded-2xl" />}
        {phase === "error" && (
          <Card className="space-y-3 p-6 text-center">
            <TriangleAlert className="mx-auto h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">Não foi possível carregar o Cofre agora.</p>
            <Button variant="outline" onClick={load}>Tentar de novo</Button>
          </Card>
        )}
        {phase === "setup" && store && user && <Setup store={store} userLabel={user.email ?? ""} userId={user.id} onDone={opened} />}
        {phase === "locked" && store && vault && <Unlock store={store} vault={vault} slots={slots} onOpen={(d) => opened(vault, d)} />}
        {phase === "open" && store && vault && dekRef.current && (
          <OpenVault store={store} vault={vault} dek={dekRef.current} items={items} slots={slots} userId={user!.id} onChange={refresh} onLock={lock} />
        )}
        <LegacyCard count={legacy} />
      </div>
    </MobileShell>
  );
}

function LegacyCard({ count }: { count: number | null }) {
  return (
    <Card className="flex items-center gap-4 border-dashed bg-muted/40 p-4">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-muted"><Archive className="h-5 w-5 text-muted-foreground" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Cofre anterior — {count === null ? "não foi possível consultar" : `${count} registros`}</p>
        <p className="text-xs text-muted-foreground">Preservado sem alterações. Abre só com a senha mestra antiga.</p>
      </div>
      <Button asChild variant="ghost" size="sm"><Link to="/app/cofre-pessoal">Abrir <ChevronRight className="ml-1 h-4 w-4" /></Link></Button>
    </Card>
  );
}

function Setup({ store, userId, userLabel, onDone }: { store: V.VaultStore; userId: string; userLabel: string; onDone: (v: V.Vault, d: CryptoKey) => void }) {
  const [step, setStep] = useState<"intro" | "device" | "key" | "confirm">("intro");
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof V.setupVault>> | null>(null);
  const [withPasskey, setWithPasskey] = useState(false);
  const [typed, setTyped] = useState("");
  const [saved, setSaved] = useState(false);

  const prepare = async (usePasskey: boolean) => {
    setBusy(true);
    try {
      const label = deviceLabel();
      const p = usePasskey ? { ...(await registerPasskey(userId, userLabel)), label } : null;
      setPrepared(await V.setupVault(store, p)); setWithPasskey(!!p); setStep("key");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const lastGroup = prepared?.recoveryKey.split("-").pop() ?? "";
  const finish = async () => {
    if (!prepared) return;
    setBusy(true);
    try { await prepared.commit(); toast.success("Cofre pronto."); onDone(prepared.vault, prepared.dek); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const steps = ["intro", "device", "key", "confirm"] as const;

  return (
    <Card className="space-y-5 p-6">
      <div className="flex gap-1.5" aria-hidden>{steps.map((s, i) => <div key={s} className={cn("h-1 flex-1 rounded-full transition-colors", i <= steps.indexOf(step) ? "bg-primary" : "bg-muted")} />)}</div>
      {step === "intro" && (
        <div className="space-y-4 animate-in fade-in">
          <ShieldCheck className="h-8 w-8 text-primary" />
          <h2 className="text-xl font-semibold">Seu novo Cofre, sem senha mestra</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Abre com Face ID ou Touch ID nos aparelhos que você autorizar.</li>
            <li>• Uma chave de recuperação abre em qualquer aparelho, se você perder os outros.</li>
            <li>• Tudo é embaralhado no seu aparelho. Nem o administrador consegue ler.</li>
          </ul>
          <Button className="w-full" onClick={() => setStep("device")}>Começar</Button>
        </div>
      )}
      {step === "device" && (
        <div className="space-y-4 animate-in fade-in">
          <Fingerprint className="h-8 w-8 text-primary" />
          <h2 className="text-xl font-semibold">Autorizar este aparelho</h2>
          <p className="text-sm text-muted-foreground">Vamos criar uma passkey em {deviceLabel()}. O Cofre só aceita se o aparelho entregar a chave segura da biometria.</p>
          <Button className="w-full" disabled={busy || !passkeyAvailable()} onClick={() => prepare(true)}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Fingerprint className="mr-2 h-4 w-4" />}Usar Face ID / Touch ID
          </Button>
          <Button variant="ghost" className="w-full" disabled={busy} onClick={() => prepare(false)}>Continuar só com chave de recuperação</Button>
        </div>
      )}
      {step === "key" && prepared && (
        <div className="space-y-4 animate-in fade-in">
          <KeyRound className="h-8 w-8 text-primary" />
          <h2 className="text-xl font-semibold">Sua chave de recuperação</h2>
          <p className="text-sm text-muted-foreground">Guarde fora deste aparelho (app Senhas, papel em local seguro). Ela aparece só agora e não é enviada ao servidor.</p>
          <code className="block select-all break-all rounded-xl bg-muted p-4 text-center font-mono text-sm tracking-wider">{prepared.recoveryKey}</code>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { navigator.clipboard.writeText(prepared.recoveryKey); toast.success("Copiada. Cole num lugar seguro."); }}><Copy className="mr-2 h-4 w-4" />Copiar</Button>
            <Button variant="outline" className="flex-1" onClick={() => download(`chave-recuperacao-cofre.txt`, `Chave de recuperação do Cofre — Gasto Inteligente\n\n${prepared.recoveryKey}\n`)}><Download className="mr-2 h-4 w-4" />Baixar</Button>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={saved} onChange={(e) => setSaved(e.target.checked)} />Guardei a chave. Sei que, sem ela e sem aparelhos autorizados, ninguém consegue abrir o Cofre.</label>
          <Button className="w-full" disabled={!saved} onClick={() => setStep("confirm")}>Continuar</Button>
        </div>
      )}
      {step === "confirm" && prepared && (
        <div className="space-y-4 animate-in fade-in">
          <h2 className="text-xl font-semibold">Confirme a chave</h2>
          <Label htmlFor="last">Digite o último grupo da chave</Label>
          <Input id="last" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} className="font-mono tracking-widest" maxLength={4} />
          <Button className="w-full" disabled={busy || typed !== lastGroup} onClick={finish}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ativar Cofre{withPasskey ? " com biometria" : ""}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setStep("key")}>Ver a chave de novo</Button>
        </div>
      )}
    </Card>
  );
}

function Unlock({ store, vault, slots, onOpen }: { store: V.VaultStore; vault: V.Vault; slots: V.Slot[]; onOpen: (d: CryptoKey) => void }) {
  const [busy, setBusy] = useState(false);
  const [showRec, setShowRec] = useState(false);
  const [rec, setRec] = useState("");
  const pks = V.activeSlots(slots).filter((s) => s.kind === "passkey_prf");
  const bio = async () => {
    setBusy(true);
    try {
      const got = await evaluate(pks.map((s) => ({ credentialId: s.credential_id!, prfSalt: s.prf_salt! })));
      onOpen(await V.unlockWithPasskey(store, vault, got, deviceLabel()));
    } catch (e) { toast.error(errMsg(e)); setShowRec(true); } finally { setBusy(false); }
  };
  const recover = async () => {
    setBusy(true);
    try { onOpen(await V.unlockWithRecovery(store, vault, rec, deviceLabel())); toast.success("Cofre aberto. Autorize este aparelho em Aparelhos."); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); setRec(""); }
  };
  return (
    <Card className="space-y-5 p-6 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10"><Lock className="h-6 w-6 text-primary" /></div>
      <div><h2 className="text-lg font-semibold">Meu cofre</h2><p className="text-sm text-muted-foreground">Bloqueado</p></div>
      {pks.length > 0 && (
        <Button className="w-full" size="lg" disabled={busy} onClick={bio}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Fingerprint className="mr-2 h-5 w-5" />}Abrir com Face ID / Touch ID
        </Button>
      )}
      {showRec || pks.length === 0 ? (
        <form className="space-y-2 text-left" onSubmit={(e) => { e.preventDefault(); recover(); }}>
          <Label htmlFor="rec">Chave de recuperação</Label>
          <Input id="rec" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-…" value={rec} onChange={(e) => setRec(e.target.value)} className="font-mono" />
          <Button type="submit" variant="outline" className="w-full" disabled={busy || rec.replace(/[^0-9a-z]/gi, "").length < 52}>Abrir com chave de recuperação</Button>
        </form>
      ) : (
        <Button variant="link" size="sm" onClick={() => setShowRec(true)}>Usar chave de recuperação</Button>
      )}
    </Card>
  );
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

const STRENGTH = { fraca: ["Fraca", "bg-destructive", "w-1/3"], media: ["Média", "bg-warning", "w-2/3"], forte: ["Forte", "bg-success", "w-full"], unknown: ["", "bg-muted", "w-0"] } as const;

function OpenVault({ store, vault, dek, items, slots, userId, onChange, onLock }: {
  store: V.VaultStore; vault: V.Vault; dek: CryptoKey; items: Item[]; slots: V.Slot[]; userId: string; onChange: () => Promise<void>; onLock: () => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id?: string; s: V.Secret } | null>(null);
  const [del, setDel] = useState<Item | null>(null);
  const [devices, setDevices] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const list = items.filter((i) => (!cat || i.secret.category === cat) && `${i.secret.title} ${i.secret.username} ${i.secret.url}`.toLowerCase().includes(q.toLowerCase()));
  const copy = (t: string, what: string) => { navigator.clipboard.writeText(t); toast.success(`${what} copiado`); setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 30_000); };
  const save = async () => {
    if (!editing?.s.title.trim()) return toast.error("Dê um nome à credencial.");
    try { await V.saveEntry(store, vault, dek, editing.s, editing.id); setEditing(null); await onChange(); toast.success("Salvo"); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async () => {
    if (!del) return;
    try { await store.deleteEntry(del.id); setDel(null); await onChange(); toast.success("Credencial excluída"); } catch (e) { toast.error(errMsg(e)); }
  };
  const exportBackup = async () => {
    const rows = await store.listEntries(vault.id);
    const recovery = V.activeSlots(slots).filter((s) => s.kind === "recovery").map((s) => s.envelope);
    download(`cofre-v2-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: "gi-vault-v2", vault_id: vault.id, recovery_envelopes: recovery, entries: rows.map(({ id, iv, ciphertext, updated_at }) => ({ id, iv, ciphertext, updated_at })) }, null, 2));
    store.logEvent(vault.id, "backup_exported", deviceLabel());
    toast.success("Backup criptografado baixado. Abre com a chave de recuperação.");
  };
  const st = STRENGTH[evaluateStrength(editing?.s.password ?? "")];

  return (
    <div className="space-y-4 animate-in fade-in">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10"><ShieldCheck className="h-5 w-5 text-primary" /></div>
        <div className="min-w-0 flex-1"><p className="font-semibold">Meu cofre</p><p className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? "credencial" : "credenciais"} · bloqueia após {vault.auto_lock_minutes} min sem uso</p></div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <Button variant="outline" size="sm" onClick={() => setDevices(true)}><Smartphone className="mr-1.5 h-4 w-4" />Aparelhos</Button>
        <Button variant="outline" size="sm" onClick={exportBackup}><Download className="mr-1.5 h-4 w-4" />Backup</Button>
        <Button size="sm" variant="secondary" onClick={onLock}><Lock className="mr-1.5 h-4 w-4" />Bloquear</Button>
        </div>
      </Card>
      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Pesquisar" placeholder="Pesquisar" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Button onClick={() => setEditing({ s: { ...EMPTY } })}><Plus className="mr-1.5 h-4 w-4" />Nova</Button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[null, ...CATEGORIAS].map((c) => <Button key={c ?? "all"} size="sm" variant={cat === c ? "default" : "outline"} className="shrink-0 rounded-full" onClick={() => setCat(c)}>{c ?? "Todas"}</Button>)}
      </div>
      {list.length === 0 ? (
        <Card className="space-y-2 p-8 text-center"><KeyRound className="mx-auto h-6 w-6 text-muted-foreground" /><p className="text-sm text-muted-foreground">{items.length ? "Nada encontrado." : "Nenhuma credencial ainda. Toque em Nova."}</p></Card>
      ) : (
        <ul className="space-y-2">
          {list.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><p className="truncate font-medium">{i.secret.title}</p><Badge variant="secondary" className="shrink-0">{i.secret.category}</Badge></div>
                <p className="truncate text-sm text-muted-foreground">{i.secret.username || "—"}</p>
                <p className="break-all font-mono text-sm">{shown.has(i.id) ? i.secret.password : "••••••••"}</p>
              </div>
              <div className="-ml-2 flex shrink-0 items-center sm:ml-0">
              <Button size="icon" variant="ghost" aria-label="Mostrar ou ocultar senha" onClick={() => setShown((s) => { const n = new Set(s); n.has(i.id) ? n.delete(i.id) : n.add(i.id); return n; })}>{shown.has(i.id) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
              <Button size="icon" variant="ghost" aria-label="Copiar usuário" disabled={!i.secret.username} onClick={() => copy(i.secret.username, "Usuário")}><Copy className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label="Copiar senha" onClick={() => copy(i.secret.password, "Senha")}><KeyRound className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEditing({ id: i.id, s: { ...i.secret } })}><Pencil className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => setDel(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar credencial" : "Nova credencial"}</DialogTitle><DialogDescription>Tudo é embaralhado neste aparelho antes de ser salvo.</DialogDescription></DialogHeader>
          {editing && (
            <div className="space-y-3">
              {(["title", "username", "url"] as const).map((f) => (
                <div key={f} className="space-y-1"><Label htmlFor={f}>{{ title: "Nome", username: "Usuário ou e-mail", url: "Site" }[f]}</Label>
                  <Input id={f} value={editing.s[f]} onChange={(e) => setEditing({ ...editing, s: { ...editing.s, [f]: e.target.value } })} /></div>
              ))}
              <div className="space-y-1"><Label htmlFor="pw">Senha</Label>
                <div className="flex gap-2"><Input id="pw" className="font-mono" value={editing.s.password} onChange={(e) => setEditing({ ...editing, s: { ...editing.s, password: e.target.value } })} />
                  <Button type="button" variant="outline" size="icon" aria-label="Gerar senha forte" onClick={() => setEditing({ ...editing, s: { ...editing.s, password: generateStrongPassword(20) } })}><Wand2 className="h-4 w-4" /></Button></div>
                <div className="h-1 rounded-full bg-muted"><div className={cn("h-1 rounded-full transition-all", st[1], st[2])} /></div>
                <p className="text-xs text-muted-foreground">{st[0] && `Força: ${st[0]}`}</p>
              </div>
              <div className="space-y-1"><Label>Categoria</Label>
                <div className="flex flex-wrap gap-1.5">{CATEGORIAS.map((c) => <Button key={c} type="button" size="sm" variant={editing.s.category === c ? "default" : "outline"} className="rounded-full" onClick={() => setEditing({ ...editing, s: { ...editing.s, category: c } })}>{c}</Button>)}</div></div>
              <div className="space-y-1"><Label htmlFor="notes">Observações</Label><Textarea id="notes" value={editing.s.notes} onChange={(e) => setEditing({ ...editing, s: { ...editing.s, notes: e.target.value } })} /></div>
            </div>
          )}
          <DialogFooter><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={save}><Check className="mr-1.5 h-4 w-4" />Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Excluir "{del?.secret.title}"?</AlertDialogTitle><AlertDialogDescription>A credencial sai do Cofre novo. Isso não afeta o Cofre anterior.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={remove}>Excluir</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Devices open={devices} onOpenChange={setDevices} store={store} vault={vault} dek={dek} slots={slots} userId={userId} onChange={onChange} />
    </div>
  );
}

function Devices({ open, onOpenChange, store, vault, dek, slots, userId, onChange }: {
  open: boolean; onOpenChange: (o: boolean) => void; store: V.VaultStore; vault: V.Vault; dek: CryptoKey; slots: V.Slot[]; userId: string; onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<{ key: string; commit: () => Promise<void> } | null>(null);
  const act = V.activeSlots(slots);
  const add = async () => {
    setBusy(true);
    try { const label = deviceLabel(); await V.addPasskey(store, vault, dek, { ...(await registerPasskey(userId, label)), label }); await onChange(); toast.success("Aparelho autorizado"); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const revoke = async (s: V.Slot) => {
    try { await V.revokeSlot(store, vault, s); await onChange(); toast.success("Aparelho revogado"); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setNewKey(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Aparelhos e recuperação</DialogTitle><DialogDescription>Quem pode abrir o seu Cofre.</DialogDescription></DialogHeader>
        <ul className="space-y-2">
          {act.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl border p-3">
              {s.kind === "recovery" ? <KeyRound className="h-4 w-4 text-primary" /> : <Fingerprint className="h-4 w-4 text-primary" />}
              <div className="flex-1 text-sm"><p className="font-medium">{s.device_label}</p><p className="text-xs text-muted-foreground">{s.last_used_at ? `Usado em ${new Date(s.last_used_at).toLocaleString("pt-BR")}` : "Ainda não usado"}</p></div>
              {s.kind !== "recovery" && <Button size="sm" variant="ghost" onClick={() => revoke(s)}>Revogar</Button>}
            </li>
          ))}
        </ul>
        {newKey ? (
          <div className="space-y-2 rounded-xl bg-muted p-3">
            <p className="text-sm font-medium">Nova chave de recuperação</p>
            <code className="block select-all break-all font-mono text-sm">{newKey.key}</code>
            <p className="text-xs text-muted-foreground">Ao confirmar, a chave antiga deixa de funcionar.</p>
            <Button size="sm" className="w-full" onClick={async () => { await newKey.commit(); setNewKey(null); await onChange(); toast.success("Chave de recuperação trocada"); }}>Guardei, trocar chave</Button>
          </div>
        ) : null}
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={async () => setNewKey(await V.rotateRecovery(store, vault, dek))}><Sparkles className="mr-1.5 h-4 w-4" />Nova chave de recuperação</Button>
          <Button disabled={busy || !passkeyAvailable()} onClick={add}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}Autorizar este aparelho</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
