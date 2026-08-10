import { ArrowLeft } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

interface SettingsPageHeaderProps {
  title: string;
  description?: string;
  backTo?: string;
  className?: string;
}

export function SettingsPageHeader({
  title,
  description,
  backTo = "/app/ajustes",
  className,
}: SettingsPageHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className={cn("flex items-center gap-3 pt-2 mb-6", className)}>
      <button
        onClick={() => navigate({ to: backTo as never })}
        className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </header>
  );
}
