import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Substituto de `window.confirm` baseado em React/Radix AlertDialog.
 *
 * Motivo: `window.confirm` é inconsistente dentro do Android WebView
 * (algumas builds não abrem o diálogo ou retornam `false` imediatamente).
 * Esse helper resolve uma Promise<boolean> a partir de um diálogo
 * renderizado pelo Host montado uma única vez no __root.
 *
 * Uso:
 *   const ok = await confirmAsync({ title: "Excluir?", description: "..." });
 *   if (!ok) return;
 */

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

type ConfirmRequest = ConfirmOptions & { resolve: (v: boolean) => void };

let listener: ((req: ConfirmRequest) => void) | null = null;

export function confirmAsync(options: ConfirmOptions): Promise<boolean> {
  // Fallback de segurança: se o Host ainda não montou (SSR / boot),
  // cai no `window.confirm` para não engolir a ação silenciosamente.
  if (!listener) {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const msg = options.description
        ? `${options.title}\n\n${options.description}`
        : options.title;
      return Promise.resolve(window.confirm(msg));
    }
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    listener!({ ...options, resolve });
  });
}

export function ConfirmDialogHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    listener = (r) => setReq(r);
    return () => {
      listener = null;
    };
  }, []);

  function close(v: boolean) {
    if (req) {
      req.resolve(v);
      setReq(null);
    }
  }

  return (
    <AlertDialog open={!!req} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{req?.title}</AlertDialogTitle>
          {req?.description ? (
            <AlertDialogDescription className="whitespace-pre-line">
              {req.description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>
            {req?.cancelText ?? "Cancelar"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => close(true)}
            className={
              req?.destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {req?.confirmText ?? "Confirmar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
