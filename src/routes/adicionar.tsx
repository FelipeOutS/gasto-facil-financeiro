import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Camera, ImageUp, PencilLine, ArrowLeft } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/adicionar")({
  head: () => ({ meta: [{ title: "Adicionar gasto — Gasto Fácil" }] }),
  component: Adicionar,
});

function Adicionar() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  function pickImage(camera: boolean) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (camera) input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        sessionStorage.setItem("gf:pendingImage", dataUrl);
        navigate({ to: "/confirmar" });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Novo</p>
          <h1 className="text-2xl font-bold tracking-tight">Adicionar gasto</h1>
        </div>
      </header>

      <p className="mt-3 text-sm text-muted-foreground">
        Escolha como quer registrar. A leitura por imagem identifica os dados, mas você sempre confirma antes de salvar.
      </p>

      <div className="mt-6 space-y-3">
        <button
          onClick={() => pickImage(true)}
          disabled={busy}
          className="group flex w-full items-center gap-4 rounded-3xl border border-border bg-card p-5 text-left shadow-card transition-all hover:bg-card-elevated active:scale-[0.99] disabled:opacity-60"
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-cat-besteiras/15 text-[var(--cat-besteiras)]">
            <Camera className="h-6 w-6" />
          </span>
          <span className="flex-1">
            <span className="block text-base font-semibold">Tirar foto</span>
            <span className="block text-xs text-muted-foreground">Comprovante, nota, recibo</span>
          </span>
        </button>

        <button
          onClick={() => pickImage(false)}
          disabled={busy}
          className="group flex w-full items-center gap-4 rounded-3xl border border-border bg-card p-5 text-left shadow-card transition-all hover:bg-card-elevated active:scale-[0.99] disabled:opacity-60"
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-cat-roupas/15 text-[var(--cat-roupas)]">
            <ImageUp className="h-6 w-6" />
          </span>
          <span className="flex-1">
            <span className="block text-base font-semibold">Enviar print da galeria</span>
            <span className="block text-xs text-muted-foreground">Pix, boleto, fatura, screenshot</span>
          </span>
        </button>

        <Link
          to="/manual"
          className="group flex w-full items-center gap-4 rounded-3xl border border-border bg-card p-5 text-left shadow-card transition-all hover:bg-card-elevated active:scale-[0.99]"
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-cat-mercado/15 text-[var(--cat-mercado)]">
            <PencilLine className="h-6 w-6" />
          </span>
          <span className="flex-1">
            <span className="block text-base font-semibold">Cadastrar manualmente</span>
            <span className="block text-xs text-muted-foreground">Digite os dados do gasto</span>
          </span>
        </Link>
      </div>

      <div className="mt-8 rounded-2xl border border-dashed border-border bg-card/40 p-4 text-xs text-muted-foreground">
        💡 Dica: a leitura automática por foto/print está sendo ativada. Por enquanto, os campos vêm em branco para você revisar e preencher rapidamente.
      </div>

      <div className="mt-6">
        <Button asChild variant="outline" className="w-full">
          <Link to="/">Cancelar</Link>
        </Button>
      </div>
    </MobileShell>
  );
}
