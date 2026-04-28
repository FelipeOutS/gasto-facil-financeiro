import { Check, Circle } from "lucide-react";
import { avaliarSenha } from "@/lib/auth-messages";
import { cn } from "@/lib/utils";

type Props = { senha: string; className?: string };

export function PasswordChecklist({ senha, className }: Props) {
  const regras = avaliarSenha(senha);
  return (
    <ul
      className={cn(
        "space-y-1.5 rounded-xl border border-border/60 bg-card/40 p-3 text-xs",
        className,
      )}
      aria-live="polite"
    >
      <li className="mb-1 text-muted-foreground">Sua senha precisa ter:</li>
      {regras.map((r) => (
        <li
          key={r.id}
          className={cn(
            "flex items-center gap-2 transition-all duration-300",
            r.ok ? "text-emerald-400" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded-full transition-all duration-300",
              r.ok ? "bg-emerald-500/20 scale-100" : "bg-muted/40 scale-90",
            )}
          >
            {r.ok ? (
              <Check className="h-3 w-3 animate-scale-in" strokeWidth={3} />
            ) : (
              <Circle className="h-2 w-2 opacity-50" />
            )}
          </span>
          <span className={cn(r.ok && "line-through decoration-emerald-500/40")}>{r.label}</span>
        </li>
      ))}
    </ul>
  );
}
