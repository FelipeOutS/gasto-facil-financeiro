/**
 * Seletor de conta ativa — exibe a conta atual com avatar/iniciais e abre
 * um menu com as contas conectadas que o usuário pode acessar.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Users, Eye, Pencil, Shield } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveAccount } from "@/lib/active-account";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const LEVEL_ICON = {
  view: Eye,
  view_create: Pencil,
  admin: Shield,
} as const;

function initials(text: string): string {
  const parts = text
    .trim()
    .split(/[\s@.]+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[1][0] : "";
  return (a + b).toUpperCase();
}

export function ConnectedAccountSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation("dashboard");
  const { user, profile } = useAuth();
  const { connections, isOwnAccount, activeConnection, switchTo } = useActiveAccount();
  const [open, setOpen] = useState(false);

  // Sem conexões aceitas: não mostra (mantém sidebar limpa).
  if (connections.length === 0) return null;

  const ownName = profile?.nome || user?.email?.split("@")[0] || t("switcher.minhaConta");
  const currentLabel = isOwnAccount
    ? t("switcher.minhaConta")
    : activeConnection?.nickname || activeConnection?.email || t("switcher.contaConectada");
  const currentInitials = isOwnAccount
    ? initials(ownName)
    : initials(activeConnection?.nickname || activeConnection?.email || "?");

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl border border-border/60 bg-card/60 px-2.5 py-2 text-left transition-all hover:bg-card/90",
            !isOwnAccount && "border-amber-400/50 bg-amber-500/10 hover:bg-amber-500/15",
            className,
          )}
        >
          <span
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white",
              isOwnAccount ? "bg-brand" : "bg-amber-500",
            )}
          >
            {currentInitials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {isOwnAccount ? t("switcher.voce") : t("switcher.vendoContaDe")}
            </p>
            <p className="truncate text-xs font-semibold">{currentLabel}</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2 text-xs">
          <Users className="h-3.5 w-3.5" /> {t("switcher.trocarConta")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void switchTo(null)} className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-[10px] font-bold text-white">
            {initials(ownName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{t("switcher.minhaConta")}</p>
            <p className="truncate text-[11px] text-muted-foreground">{user?.email ?? ""}</p>
          </div>
          {isOwnAccount && <Check className="h-4 w-4 text-brand" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {t("switcher.queVoceAcompanha")}
        </DropdownMenuLabel>
        {connections.map((c) => {
          const Icon = LEVEL_ICON[c.accessLevel];
          const active = activeConnection?.ownerId === c.ownerId;
          return (
            <DropdownMenuItem
              key={c.ownerId}
              onClick={() => void switchTo(c.ownerId)}
              className="flex items-center gap-2"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                {initials(c.nickname || c.email)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.nickname || c.email}</p>
                <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                  <Icon className="h-3 w-3" /> {t(`switcher.level.${c.accessLevel}`)}
                </p>
              </div>
              {active && <Check className="h-4 w-4 text-brand" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
