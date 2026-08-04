import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable/index";
import { traduzirErroAuth } from "@/lib/auth-messages";

interface Props {
  label: string;
  separatorText: string;
}

export function GoogleAuthButton({ label, separatorText }: Props) {
  const [loading, setLoading] = useState(false);

  async function handle() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(traduzirErroAuth(result.error.message ?? "Falha ao entrar com Google"));
        setLoading(false);
        return;
      }
      if (result.redirected) return;
      window.location.href = "/";
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao entrar com Google";
      toast.error(traduzirErroAuth(msg));
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={handle}
        disabled={loading}
        className="h-12 w-full rounded-xl border-border/70 bg-background text-base font-semibold shadow-sm transition-transform active:scale-[0.98] hover:bg-muted/40"
      >
        <GoogleIcon className="mr-2 h-5 w-5" />
        {loading ? "Conectando…" : label}
      </Button>
      <div className="relative flex items-center">
        <span className="h-px flex-1 bg-border/70" />
        <span className="px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {separatorText}
        </span>
        <span className="h-px flex-1 bg-border/70" />
      </div>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1-3.31 0-6-2.74-6-6.1S8.69 5.9 12 5.9c1.88 0 3.14.8 3.86 1.49l2.64-2.55C16.93 3.36 14.7 2.4 12 2.4 6.84 2.4 2.7 6.55 2.7 12.1S6.84 21.8 12 21.8c6.93 0 9.42-4.86 9.42-7.4 0-.5-.05-.88-.12-1.27H12z"
      />
      <path
        fill="#34A853"
        d="M3.88 7.45l3.2 2.35C7.95 7.86 9.83 5.9 12 5.9c1.88 0 3.14.8 3.86 1.49l2.64-2.55C16.93 3.36 14.7 2.4 12 2.4 8.27 2.4 5.05 4.5 3.88 7.45z"
        opacity="0"
      />
      <path
        fill="#4285F4"
        d="M21.3 12.27c0-.7-.06-1.22-.2-1.77H12v3.34h5.32c-.11.88-.7 2.2-2 3.08l3.08 2.39c1.84-1.7 2.9-4.21 2.9-7.04z"
      />
      <path
        fill="#FBBC05"
        d="M6.7 14.3a6.07 6.07 0 0 1-.33-1.95c0-.68.12-1.34.32-1.95L3.5 7.96A9.7 9.7 0 0 0 2.4 12.35c0 1.57.38 3.05 1.05 4.39L6.7 14.3z"
      />
      <path
        fill="#34A853"
        d="M12 21.6c2.7 0 4.96-.89 6.62-2.42l-3.08-2.39c-.83.58-1.95.99-3.54.99-2.71 0-5.01-1.78-5.83-4.25L3 16.06C4.66 19.36 8.07 21.6 12 21.6z"
      />
    </svg>
  );
}
