import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Pencil, ImageOff } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GastoForm } from "@/components/GastoForm";
import { addGasto, findPossibleDuplicate } from "@/lib/store";
import { formatBRL, parseBRLInput, todayISO } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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

export const Route = createFileRoute("/confirmar")({
  head: () => ({ meta: [{ title: "Confirmar gasto — Gasto Fácil" }] }),
  component: Confirmar,
});

function Confirmar() {
  const navigate = useNavigate();
  const [imagem, setImagem] = useState<string | undefined>();

  // Identified value (could come from OCR — empty for MVP)
  const [valorIdentificado, setValorIdentificado] = useState<string>("");
  const [editing, setEditing] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<null | (() => void)>(null);

  useEffect(() => {
    const img = sessionStorage.getItem("gf:pendingImage") ?? undefined;
    setImagem(img);
  }, []);

  const valor = parseBRLInput(valorIdentificado);

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
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Revise e confirme</p>
          <h1 className="text-xl font-bold tracking-tight">Confirmar gasto</h1>
        </div>
      </header>

      {/* Image preview */}
      <div className="mt-4 overflow-hidden rounded-3xl border border-border bg-card">
        {imagem ? (
          <img
            src={imagem}
            alt="Comprovante enviado"
            className="max-h-64 w-full object-contain bg-card-elevated"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
            <ImageOff className="h-6 w-6" />
            <p className="text-sm">Nenhuma imagem anexada</p>
          </div>
        )}
      </div>

      {/* Identified value */}
      <div className="mt-5 rounded-3xl border border-border bg-card p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Valor identificado
        </p>

        <div className="mt-2 flex items-center gap-3">
          {editing ? (
            <div className="flex flex-1 items-baseline gap-2">
              <span className="text-2xl font-bold text-muted-foreground">R$</span>
              <Input
                autoFocus
                inputMode="decimal"
                placeholder="0,00"
                value={valorIdentificado}
                onChange={(e) => {
                  setValorIdentificado(e.target.value);
                  setConfirmed(false);
                }}
                className="num h-14 border-0 bg-transparent p-0 text-4xl font-extrabold tracking-tight !ring-0 focus-visible:!ring-0"
              />
            </div>
          ) : (
            <p className="num flex-1 text-4xl font-extrabold tracking-tight">{formatBRL(valor)}</p>
          )}
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card-elevated text-muted-foreground hover:text-foreground"
            aria-label="Editar valor"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>

        {confirmed ? (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-success">
            <Check className="h-4 w-4" />
            Valor confirmado
          </p>
        ) : (
          <Button
            type="button"
            disabled={valor <= 0}
            onClick={() => {
              setConfirmed(true);
              setEditing(false);
            }}
            className="mt-4 h-11 w-full rounded-xl"
          >
            Confirmar valor
          </Button>
        )}
      </div>

      {/* Form (only after value confirmed) */}
      <div
        className={cn(
          "mt-5 transition-opacity",
          !confirmed && "pointer-events-none opacity-50",
        )}
      >
        <GastoForm
          initial={{
            valor,
            data: todayISO(),
            imagemUrl: imagem,
          }}
          onSubmit={(data) => {
            const dup = findPossibleDuplicate(data.valor, data.data, data.estabelecimento);
            const save = () => {
              addGasto(data);
              sessionStorage.removeItem("gf:pendingImage");
              toast.success("Gasto salvo!");
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
