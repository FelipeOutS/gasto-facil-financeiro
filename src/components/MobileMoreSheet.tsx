import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Lock, LogOut, Sparkles, UserRound, Languages } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { UserAvatar } from "@/components/UserAvatar";
import { NAV_GROUPS, filterVisibleGroups, type NavLeaf } from "@/lib/nav-groups";
import { PREMIUM_ROUTE_RULES } from "@/lib/premium-routes";
import { PLAN_LABEL } from "@/lib/plans";
import { useAuth } from "@/lib/auth-context";
import { usePlan } from "@/lib/use-plan";
import { cn } from "@/lib/utils";

const ROUTE_RULE = Object.fromEntries(PREMIUM_ROUTE_RULES.map((r) => [r.path, r]));

const PERSONAL_ITEMS: NavLeaf[] = [
  { to: "/app/perfil", labelKey: "perfilMobile", descKey: "perfilMobile", icon: UserRound },
  { to: "/app/idioma", labelKey: "idioma", descKey: "idioma", icon: Languages },
];

export function MobileMoreSheet({ trigger }: { trigger: ReactNode }) {
  const { t } = useTranslation("nav");
  const { user, profile, signOut } = useAuth();
  const { plan, can, isTrialActive, trialDaysLeft, isAdminMaster } = usePlan();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);


  const groups = useMemo(
    () =>
      filterVisibleGroups(
        NAV_GROUPS.filter((g) => !g.adminMasterOnly || isAdminMaster),
        can,
        isAdminMaster,
      ),
    [isAdminMaster, can],
  );

  function getRule(item: NavLeaf) {
    return (
      ROUTE_RULE[item.to] ??
      (item.feature ? { feature: item.feature, path: item.to, title: "" } : null)
    );
  }
  function isLocked(item: NavLeaf) {
    if (isAdminMaster) return false;
    const rule = getRule(item);
    return rule ? !can(rule.feature) : false;
  }

  const displayName =
    profile?.nome ||
    profile?.responsavel_nome ||
    profile?.nome_fantasia ||
    user?.email?.split("@")[0] ||
    t("header.fallbackUser");

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      try {
        await signOut();
      } catch {
        /* noop */
      }
    } finally {
      setOpen(false);
      if (typeof window !== "undefined") window.location.href = "/login";
    }
  }

  function renderItem(item: NavLeaf) {
    const Icon = item.icon;
    const locked = isLocked(item);
    return (
      <Link
        key={item.to}
        to={locked ? "/meu-plano" : item.to}
        preload="intent"
        preloadDelay={0}
        onClick={() => setOpen(false)}
        className={cn(
          "group flex min-h-11 items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-left transition-colors active:scale-[0.99]",
          locked ? "opacity-75 hover:bg-muted/40" : "hover:bg-muted/60",
        )}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-card-elevated text-foreground ring-1 ring-border/60">
          <Icon className="h-4.5 w-4.5" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[13.5px] font-semibold leading-tight">
            <span className="truncate">{t(`items.${item.labelKey}`)}</span>
            {locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="left" className="w-[min(86vw,360px)] overflow-y-auto p-0">
        {/* Bloco de marca */}
        <div className="border-b border-border/60 bg-background px-4 pb-3 pt-5">
          <BrandMark variant="sidebar" className="h-6" />
          <p className="mt-1 text-[11px] font-medium text-muted-foreground">
            Seu controle financeiro em um só lugar
          </p>
        </div>

        <SheetHeader className="border-b border-border/60 px-4 py-4 text-left">
          <SheetTitle className="sr-only">{t("more.title")}</SheetTitle>
          <SheetDescription className="sr-only">{t("more.description")}</SheetDescription>
          <Link
            to="/app/perfil"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3"
          >
            <UserAvatar url={profile?.avatar_url} name={displayName} email={user?.email} size={44} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold leading-tight">{displayName}</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{user?.email}</span>
            </span>
          </Link>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-card-elevated px-3 py-2">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("more.currentPlan")}
              </p>
              <p className="mt-0.5 truncate text-xs font-semibold">{PLAN_LABEL[plan]}</p>
            </div>
            {isTrialActive && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[9px] font-semibold text-warning">
                <Sparkles className="h-2.5 w-2.5" />
                {t("more.trial", { days: trialDaysLeft })}
              </span>
            )}
          </div>
        </SheetHeader>

        <nav className="px-3 pb-6 pt-2">
          {groups.map((group) => (
            <div key={group.id} className="mt-3 first:mt-0">
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t(group.labelKey)}
              </p>
              <div className="flex flex-col gap-0.5">{group.items.map(renderItem)}</div>
            </div>
          ))}

          <div className="mt-3">
            <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("groups.conta")}
            </p>
            <div className="flex flex-col gap-0.5">{PERSONAL_ITEMS.map(renderItem)}</div>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 active:scale-[0.99] disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            {t("more.signOut")}
          </button>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
