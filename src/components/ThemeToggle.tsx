import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  variant?: "icon" | "full";
};

export function ThemeToggle({ className, variant = "full" }: Props) {
  const { resolved, setTheme } = useTheme();
  const isDark = resolved === "dark";
  const label = isDark ? "Modo claro" : "Modo escuro";
  const Icon = isDark ? Sun : Moon;

  const toggle = () => setTheme(isDark ? "light" : "dark");

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        title={label}
        aria-label={label}
        className={cn(
          "inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
          className,
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
        className,
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}
