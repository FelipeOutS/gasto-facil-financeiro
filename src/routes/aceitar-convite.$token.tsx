import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, X, LogIn } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { acceptInviteByToken, fetchInviteByToken, refuseInviteByToken, ACCESS_LEVEL_INFO, type ConnectedAccount } from "@/lib/connected-accounts";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/aceitar-convite/$token")({
  head: () => ({ meta: [{ title: "Aceitar convite — Gasto Inteligente" }] }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<ConnectedAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    (async () => {
      try {
        const data = await fetchInviteByToken(token);
        setInvite(data);
      } catch {
        setInvite(null);
      } finally { setLoading(false); }
    })();
  }, [token, authLoading, user?.id]);

  async function accept() {
    if (!user || !invite) return;
    setWorking(true);
    try {
      await acceptInviteByToken(token, user.id);
      toast.success("Convite aceito! A pessoa agora pode acompanhar sua conta.");
      navigate({ to: "/contas-conectadas" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível aceitar.");
    } finally { setWorking(false); }
  }

  async function refuse() {
    setWorking(true);
    try {
      await refuseInviteByToken(token);
      toast.success("Convite recusado.");
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao recusar.");
    } finally { setWorking(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex justify-center"><BrandMark className="h-10 w-auto" /></div>
        <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-lg">
          {loading ? (
            <p className="text-center text-sm text-muted-foreground">Carregando convite…</p>
          ) : !invite ? (
            <div className="text-center">
              <h1 className="text-lg font-bold">Convite não encontrado</h1>
              <p className="mt-2 text-sm text-muted-foreground">O link pode ter expirado ou já foi utilizado.</p>
              <Button asChild className="mt-4"><Link to="/">Ir para o início</Link></Button>
            </div>
          ) : invite.status !== "pending" ? (
            <div className="text-center">
              <h1 className="text-lg font-bold">Convite já respondido</h1>
              <p className="mt-2 text-sm text-muted-foreground">Este convite não está mais pendente.</p>
              <Button asChild className="mt-4"><Link to="/">Voltar</Link></Button>
            </div>
          ) : !user ? (
            <div className="text-center">
              <h1 className="text-lg font-bold">Você foi convidado a conectar sua conta</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Para aceitar, faça login com o e-mail <strong>{invite.invited_email}</strong>.
              </p>
              <Button asChild className="mt-4 gap-1.5">
                <Link to="/login"><LogIn className="h-4 w-4" /> Fazer login</Link>
              </Button>
            </div>
          ) : user.email?.toLowerCase().trim() !== invite.invited_email.toLowerCase().trim() ? (
            <div className="text-center">
              <h1 className="text-lg font-bold">Conta diferente</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Este convite é para <strong>{invite.invited_email}</strong>. Faça login com esse e-mail para aceitar.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-bold">Você foi convidado a conectar sua conta</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Ao aceitar, a pessoa que convidou poderá acompanhar suas informações financeiras conforme o nível abaixo. Você pode remover o acesso a qualquer momento.
              </p>
              <div className="mt-4 rounded-xl border border-border/60 bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nível de acesso</p>
                <p className="mt-1 text-sm font-semibold">{ACCESS_LEVEL_INFO[invite.access_level].title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{ACCESS_LEVEL_INFO[invite.access_level].description}</p>
              </div>
              <div className="mt-5 flex gap-2">
                <Button variant="outline" className="flex-1 gap-1.5" disabled={working} onClick={refuse}>
                  <X className="h-4 w-4" /> Recusar
                </Button>
                <Button className="flex-1 gap-1.5" disabled={working} onClick={accept}>
                  <Check className="h-4 w-4" /> Aceitar
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
