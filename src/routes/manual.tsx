import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { GastoForm } from "@/components/GastoForm";
import { addGasto, findPossibleDuplicate } from "@/lib/store";
import { toast } from "sonner";
import { useState } from "react";
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

export const Route = createFileRoute("/manual")({
  head: () => ({ meta: [{ title: "Cadastrar manualmente — Gasto Inteligente" }] }),
  component: Manual,
});

function Manual() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<null | (() => void)>(null);

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/adicionar"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Manual</p>
          <h1 className="text-2xl font-bold tracking-tight">Novo gasto</h1>
        </div>
      </header>

      <div className="mt-5">
        <GastoForm
          onSubmit={(data) => {
            const dup = findPossibleDuplicate(data.valor, data.data, data.estabelecimento);
            const save = () => {
              addGasto(data);
              toast.success("Gasto registrado. ✅");
              navigate({ to: "/" });
            };
            if (dup) {
              setPending(() => save);
            } else {
              save();
            }
          }}
        />
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Possível gasto duplicado</AlertDialogTitle>
            <AlertDialogDescription>
              Esse gasto parece já ter sido cadastrado. Deseja salvar mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                pending?.();
                setPending(null);
              }}
            >
              Salvar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}
