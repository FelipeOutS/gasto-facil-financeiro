import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Users, Plus, Mail, Copy, Check, Trash2, Pencil, UserPlus, Shield, Eye, Edit3 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  ACCESS_LEVEL_INFO,
  STATUS_LABEL,
  buildInviteUrl,
  createInvite,
  listIncomingConnections,
  listOutgoingConnections,
  removeConnection,
  type AccessLevel,
  type ConnectedAccount,
} from "@/lib/connected-accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { MobileShell } from "@/components/MobileShell";
import { cn } from "@/lib/utils";
import { sendTransactionalEmail } from "@/lib/email/send";

async function sendInviteEmail(to: string, token: string, inviterName: string | null, accessLevel: AccessLevel) {
  await sendTransactionalEmail({
    templateName: "connected-account-invite",
    recipientEmail: to,
    idempotencyKey: `invite-${token}`,
    templateData: {
      inviterName: inviterName || undefined,
      accessLevel,
      inviteUrl: buildInviteUrl(token),
    },
  });
}

export const Route = createFileRoute("/contas-conectadas")({
  head: () => ({ meta: [{ title: "Contas conectadas — Gasto Inteligente" }] }),
  component: ContasConectadasPage,
});

function ContasConectadasPage() {
  const { user } = useAuth();
  const [outgoing, setOutgoing] = useState<ConnectedAccount[]>([]);
  const [incoming, setIncoming] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);

  async function refresh() {
    if (!user) return;
    setLoading(true);
    try {
      const [out, inc] = await Promise.all([
        listOutgoingConnections(user.id),
        listIncomingConnections(user.id, user.email ?? ""),
      ]);
      setOutgoing(out);
      setIncoming(inc.filter((c) => c.viewer_user_id !== user.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar contas conectadas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [user?.id]);

  async function handleRemove(id: string) {
    if (!user) return;
    if (!confirm("Remover esta conexão? A pessoa perderá o acesso imediatamente.")) return;
    try {
      await removeConnection(id, user.id);
      toast.success("Conexão removida.");
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover.");
    }
  }

  return (
    <MobileShell wide>
    <div className="mx-auto w-full max-w-5xl space-y-8 py-6 lg:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Contas conectadas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Convide outra pessoa por e-mail e acompanhe a conta dela com autorização.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Conectar nova conta
        </Button>
      </header>

      {/* Contas que EU acompanho */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Contas que você acompanha
        </h2>
        {loading ? (
          <div className="rounded-2xl border border-border/60 bg-card/40 p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : outgoing.length === 0 ? (
          <EmptyState onInvite={() => setInviteOpen(true)} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {outgoing.map((c) => (
              <ConnectionCard
                key={c.id}
                account={c}
                onRemove={() => handleRemove(c.id)}
                onShare={() => setShareToken(c.invite_token)}
                showShare={c.status === "pending"}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Quem tem acesso à MINHA conta */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Quem pode ver minha conta
        </h2>
        {incoming.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card/40 p-6 text-sm text-muted-foreground">
            Ninguém tem acesso à sua conta no momento.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {incoming.map((c) => (
              <ConnectionCard
                key={c.id}
                account={c}
                incoming
                onRemove={() => handleRemove(c.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        viewerUserId={user?.id ?? ""}
        onCreated={(token) => { setInviteOpen(false); setShareToken(token); void refresh(); }}
      />

      <ShareInviteDialog token={shareToken} onClose={() => setShareToken(null)} />
    </div>
    </MobileShell>
  );
}

/* ============================== Components ============================== */

function EmptyState({ onInvite }: { onInvite: () => void }) {
  return (
    <div className="rounded-3xl border border-border/60 bg-gradient-to-br from-card to-card/40 p-8 text-center shadow-sm">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand-on-soft">
        <Users className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-lg font-bold">Conecte outra conta ao seu controle financeiro</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Convide uma pessoa pelo e-mail e acompanhe as informações financeiras dela com autorização.
      </p>
      <Button onClick={onInvite} className="mt-5 gap-2">
        <Plus className="h-4 w-4" /> Conectar nova conta
      </Button>
      <p className="mx-auto mt-4 max-w-md rounded-xl bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        A outra pessoa precisa aceitar o convite antes que você possa visualizar os dados.
      </p>
    </div>
  );
}

function ConnectionCard({
  account,
  incoming = false,
  onRemove,
  onShare,
  showShare = false,
}: {
  account: ConnectedAccount;
  incoming?: boolean;
  onRemove: () => void;
  onShare?: () => void;
  showShare?: boolean;
}) {
  const access = ACCESS_LEVEL_INFO[account.access_level];
  const statusTone =
    account.status === "accepted"
      ? "bg-emerald-500/15 text-emerald-600"
      : account.status === "pending"
      ? "bg-amber-500/15 text-amber-600"
      : "bg-muted text-muted-foreground";
  return (
    <li className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand-on-soft">
          <UserPlus className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {account.nickname || account.invited_email}
          </p>
          <p className="truncate text-xs text-muted-foreground">{account.invited_email}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", statusTone)}>
              {STATUS_LABEL[account.status]}
            </span>
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {access.title}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {showShare && onShare && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onShare}>
            <Copy className="h-3.5 w-3.5" /> Link do convite
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-destructive hover:text-destructive" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" /> {incoming ? "Remover acesso" : "Remover conexão"}
        </Button>
      </div>
    </li>
  );
}

function InviteDialog({
  open, onOpenChange, viewerUserId, onCreated,
}: { open: boolean; onOpenChange: (v: boolean) => void; viewerUserId: string; onCreated: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [level, setLevel] = useState<AccessLevel>("view");
  const [submitting, setSubmitting] = useState(false);

  function reset() { setEmail(""); setNickname(""); setLevel("view"); }

  async function submit() {
    if (!viewerUserId) return;
    setSubmitting(true);
    try {
      const created = await createInvite({ viewerUserId, invitedEmail: email, nickname, accessLevel: level });
      toast.success("Convite criado! Compartilhe o link com a pessoa.");
      reset();
      onCreated(created.invite_token);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar o convite.");
    } finally { setSubmitting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Conectar nova conta</DialogTitle>
          <DialogDescription>Envie um convite para acompanhar a conta de outra pessoa.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ic-email">E-mail da pessoa</Label>
            <Input id="ic-email" type="email" placeholder="exemplo@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ic-nick">Nome ou apelido <span className="text-xs text-muted-foreground">(opcional)</span></Label>
            <Input id="ic-nick" placeholder="Ex: Filho, Esposa, Sócio, Empresa…" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Tipo de acesso</Label>
            <div className="grid gap-2">
              {(["view", "view_create", "admin"] as AccessLevel[]).map((opt) => {
                const info = ACCESS_LEVEL_INFO[opt];
                const Icon = opt === "view" ? Eye : opt === "view_create" ? Edit3 : Shield;
                const active = level === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setLevel(opt)}
                    className={cn(
                      "group flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all",
                      active ? "border-brand bg-brand-soft/40 ring-1 ring-brand" : "border-border hover:bg-accent/30",
                    )}
                  >
                    <span className={cn("mt-0.5 grid h-9 w-9 place-items-center rounded-lg", active ? "bg-brand text-primary-foreground" : "bg-muted text-muted-foreground")}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-semibold">{info.title}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{info.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={submitting || !email}>
            <Mail className="mr-1.5 h-4 w-4" /> {submitting ? "Enviando…" : "Enviar convite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareInviteDialog({ token, onClose }: { token: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = token ? buildInviteUrl(token) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast.success("Link copiado!");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  return (
    <Dialog open={!!token} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Convite criado com sucesso</DialogTitle>
          <DialogDescription>
            Envie este link para a pessoa por WhatsApp, e-mail ou outro canal. A conexão só será ativada após ela aceitar.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs break-all">{url}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
          <Button onClick={copy} className="gap-1.5">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiado" : "Copiar link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
