import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation, Trans } from "react-i18next";
import { Check, X, LogIn } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  acceptInviteByToken,
  fetchInviteByToken,
  refuseInviteByToken,
  ACCESS_LEVEL_INFO,
  type ConnectedAccount,
} from "@/lib/connected-accounts";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import i18n from "@/i18n";

export const Route = createFileRoute("/aceitar-convite/$token")({
  head: () => ({ meta: [{ title: i18n.getFixedT(i18n.language, "misc")("invite.metaTitle") }] }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation("misc");
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
      } finally {
        setLoading(false);
      }
    })();
  }, [token, authLoading, user?.id]);

  async function accept() {
    if (!user || !invite) return;
    setWorking(true);
    try {
      await acceptInviteByToken(token, user.id);
      toast.success(t("invite.toastAccepted"));
      navigate({ to: "/contas-conectadas" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("invite.toastAcceptError"));
    } finally {
      setWorking(false);
    }
  }

  async function refuse() {
    setWorking(true);
    try {
      await refuseInviteByToken(token);
      toast.success(t("invite.toastRefused"));
      navigate({ to: "/app" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("invite.toastRefuseError"));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandMark variant="login" className="h-10 w-auto" />
        </div>
        <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-lg">
          {loading ? (
            <p className="text-center text-sm text-muted-foreground">{t("invite.loading")}</p>
          ) : !invite ? (
            <div className="text-center">
              <h1 className="text-lg font-bold">{t("invite.notFound.title")}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t("invite.notFound.desc")}</p>
              <Button asChild className="mt-4">
                <Link to="/">{t("invite.notFound.home")}</Link>
              </Button>
            </div>
          ) : invite.status !== "pending" ? (
            <div className="text-center">
              <h1 className="text-lg font-bold">{t("invite.already.title")}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t("invite.already.desc")}</p>
              <Button asChild className="mt-4">
                <Link to="/">{t("invite.already.back")}</Link>
              </Button>
            </div>
          ) : !user ? (
            <div className="text-center">
              <h1 className="text-lg font-bold">{t("invite.needLogin.title")}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                <Trans
                  i18nKey="invite.needLogin.desc"
                  ns="misc"
                  values={{ email: invite.invited_email }}
                  components={{ strong: <strong /> }}
                />
              </p>
              <Button asChild className="mt-4 gap-1.5">
                <Link to="/login">
                  <LogIn className="h-4 w-4" /> {t("invite.needLogin.cta")}
                </Link>
              </Button>
            </div>
          ) : user.email?.toLowerCase().trim() !== invite.invited_email.toLowerCase().trim() ? (
            <div className="text-center">
              <h1 className="text-lg font-bold">{t("invite.wrongAccount.title")}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                <Trans
                  i18nKey="invite.wrongAccount.desc"
                  ns="misc"
                  values={{ email: invite.invited_email }}
                  components={{ strong: <strong /> }}
                />
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-bold">{t("invite.review.title")}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t("invite.review.desc")}</p>
              <div className="mt-4 rounded-xl border border-border/60 bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("invite.review.level")}
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {ACCESS_LEVEL_INFO[invite.access_level].title}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {ACCESS_LEVEL_INFO[invite.access_level].description}
                </p>
              </div>
              <div className="mt-5 flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 gap-1.5"
                  disabled={working}
                  onClick={refuse}
                >
                  <X className="h-4 w-4" /> {t("invite.review.refuse")}
                </Button>
                <Button className="flex-1 gap-1.5" disabled={working} onClick={accept}>
                  <Check className="h-4 w-4" /> {t("invite.review.accept")}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
