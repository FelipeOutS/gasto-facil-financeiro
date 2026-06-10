import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Trash2, Loader2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { deleteMyAccount } from "@/lib/account.functions";

type Step = "confirm" | "type" | "deleting";

export function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("confirm");
  const [text, setText] = useState("");

  useEffect(() => {
    if (!open) {
      setStep("confirm");
      setText("");
    }
  }, [open]);

  async function handleFinalDelete() {
    if (text !== "EXCLUIR") return;
    setStep("deleting");
    try {
      await deleteMyAccount({ data: { confirmationText: "EXCLUIR" } });
      try {
        await signOut();
      } catch {
        // ignore — usuário já foi excluído
      }
      try {
        if (typeof window !== "undefined") {
          window.localStorage.clear();
          window.sessionStorage.clear();
        }
      } catch {
        // ignore
      }
      toast.success("Sua conta foi excluída com sucesso.");
      onOpenChange(false);
      void navigate({ to: "/login" });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Erro ao excluir conta.";
      toast.error(msg);
      setStep("type");
    }
  }

  if (step === "confirm") {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Excluir minha conta
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                Essa ação é permanente. Ao excluir sua conta, você perderá o
                acesso aos seus dados, planos, gastos, cartões, contas,
                investimentos, metas, relatórios e demais informações
                cadastradas.
              </span>
              <span className="block rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                Essa ação não poderá ser desfeita.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setStep("type");
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // step === "type" || "deleting"
  const deleting = step === "deleting";
  const enabled = text === "EXCLUIR" && !deleting;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (deleting) return; // não fechar enquanto exclui
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Confirmação final
          </DialogTitle>
          <DialogDescription>
            Para confirmar, digite{" "}
            <span className="font-mono font-semibold text-destructive">
              EXCLUIR
            </span>{" "}
            no campo abaixo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="confirm-delete">Digite EXCLUIR</Label>
          <Input
            id="confirm-delete"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="EXCLUIR"
            autoComplete="off"
            disabled={deleting}
            className="font-mono"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleFinalDelete}
            disabled={!enabled}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Excluindo...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir conta permanentemente
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Card "Zona de risco" reutilizável: mostra um aviso e o botão que abre
 * o fluxo de exclusão de conta.
 */
export function ZonaDeRiscoCard() {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-destructive">
            Zona de risco
          </p>
          <h3 className="mt-1 text-sm font-semibold">Excluir minha conta</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Remove definitivamente seus dados do app. Essa ação não pode ser
            desfeita.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            className="mt-3 rounded-xl border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Excluir minha conta
          </Button>
        </div>
      </div>
      <DeleteAccountDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}
