import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ImageUp,
  Loader2,
  RefreshCcw,
  Sparkles,
  X,
  Check,
  PencilLine,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { GastoForm } from "@/components/GastoForm";
import {
  addGasto,
  findPossibleDuplicate,
  getCategorias,
  useStore,
  type NovoGastoInput,
} from "@/lib/store";
import { todayISO } from "@/lib/format";
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
import type { FormaPagamento } from "@/lib/types";
import { useSubscriptionGuard } from "@/lib/subscription-guard";

export const Route = createFileRoute("/confirmar")({
  head: () => ({ meta: [{ title: "Confirmar gasto — Gasto Inteligente" }] }),
  component: Confirmar,
});

type Step = "upload" | "analisando" | "revisao" | "erro" | "sucesso";

type AIResult = {
  valor: number | null;
  valoresEncontrados: number[];
  data: string | null;
  descricao: string | null;
  categoriaSugerida: string | null;
  formaPagamento: FormaPagamento | null;
  confianca: "alta" | "media" | "baixa";
  observacao: string | null;
};

function Confirmar() {
  const navigate = useNavigate();
  const categorias = useStore(() => getCategorias());

  const [imagem, setImagem] = useState<string | undefined>();
  const [step, setStep] = useState<Step>("upload");
  const [erro, setErro] = useState<string>("");
  const [result, setResult] = useState<AIResult | null>(null);
  const [overrideValor, setOverrideValor] = useState<number | null>(null);
  const [pending, setPending] = useState<null | (() => void)>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Recupera imagem vinda da tela /adicionar (se houver) — só uma vez.
  useEffect(() => {
    const img = sessionStorage.getItem("gf:pendingImage") ?? undefined;
    if (img) {
      setImagem(img);
      sessionStorage.removeItem("gf:pendingImage");
    }
  }, []);

  function onPickFile(file?: File | null) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast.error("Use uma imagem PNG, JPG ou WEBP.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Imagem muito grande. Tente uma menor que 8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImagem(String(reader.result));
      setResult(null);
      setOverrideValor(null);
      setStep("upload");
    };
    reader.readAsDataURL(file);
  }

  async function analisar() {
    if (!imagem) return;
    setStep("analisando");
    setErro("");
    try {
      const resp = await fetch("/api/ocr-gasto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: imagem }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErro(data?.error ?? "Não consegui ler tudo dessa imagem.");
        setStep("erro");
        return;
      }
      setResult(data as AIResult);
      setStep("revisao");
    } catch (err) {
      console.error(err);
      setErro("Não consegui conectar agora. Tenta de novo em instantes.");
      setStep("erro");
    }
  }

  // Mapeia categoria sugerida pela IA para o id real existente no store.
  const categoriaIdSugerida = useMemo(() => {
    if (!result?.categoriaSugerida) return undefined;
    const found = categorias.find((c) => c.id === result.categoriaSugerida);
    return found?.id;
  }, [result, categorias]);

  const valorEscolhido = overrideValor ?? result?.valor ?? null;

  const initialForm: Partial<NovoGastoInput> | undefined = result
    ? {
        valor: valorEscolhido ?? 0,
        data: result.data ?? todayISO(),
        descricao: result.descricao ?? "",
        estabelecimento: result.descricao ?? "",
        categoriaId: categoriaIdSugerida,
        formaPagamento: result.formaPagamento ?? "pix",
        observacao: result.observacao ?? undefined,
        imagemUrl: imagem,
      }
    : undefined;

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
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Leitura por imagem
          </p>
          <h1 className="text-xl font-bold tracking-tight">
            {step === "sucesso" ? "Pronto!" : "Comprovante"}
          </h1>
        </div>
      </header>

      {/* SUCESSO */}
      {step === "sucesso" && (
        <div className="mt-8 rounded-3xl border border-border bg-card p-6 text-center animate-rise">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success animate-pop">
            <Check className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">Pronto, gasto salvo!</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Já coloquei esse gasto no seu histórico.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => navigate({ to: "/gastos" })} className="rounded-xl card-press">
              Ver em Gastos
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setImagem(undefined);
                setResult(null);
                setOverrideValor(null);
                setStep("upload");
              }}
              className="rounded-xl card-press"
            >
              Adicionar outro
            </Button>
          </div>
        </div>
      )}

      {/* UPLOAD / ANÁLISE */}
      {(step === "upload" || step === "analisando" || step === "erro") && (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            Manda o print que eu tento adiantar pra você. A IA ajuda, mas quem manda é você.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0])}
          />

          <div className="mt-4 overflow-hidden rounded-3xl border border-border bg-card">
            {imagem ? (
              <div className="relative">
                <img
                  src={imagem}
                  alt="Comprovante enviado"
                  className="max-h-72 w-full object-contain bg-card-elevated"
                />
                <button
                  type="button"
                  onClick={() => {
                    setImagem(undefined);
                    setResult(null);
                    setOverrideValor(null);
                    setStep("upload");
                  }}
                  className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  aria-label="Remover imagem"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 p-10 text-muted-foreground hover:bg-card-elevated transition-colors"
              >
                <ImageUp className="h-7 w-7" />
                <p className="text-sm font-medium text-foreground">
                  Toque para enviar uma imagem
                </p>
                <p className="text-xs">PNG, JPG ou WEBP</p>
              </button>
            )}
          </div>

          {step === "analisando" && (
            <div className="mt-4 rounded-2xl border border-border bg-card p-5 text-center animate-rise">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-on-soft animate-breathe">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
              <p className="mt-3 font-semibold">Lendo seu comprovante...</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Estou procurando valor, data e descrição. Você confere tudo antes de salvar.
              </p>
              <div className="mt-4 mx-auto flex max-w-xs items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand animate-pulse-soft" />
                <span>Detectando valores</span>
                <span className="mx-1 text-border">·</span>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand/60 animate-pulse-soft" style={{ animationDelay: "0.3s" }} />
                <span>Lendo data</span>
                <span className="mx-1 text-border">·</span>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand/40 animate-pulse-soft" style={{ animationDelay: "0.6s" }} />
                <span>Categoria</span>
              </div>
            </div>
          )}

          {step === "erro" && (
            <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 animate-fade-in">
              <p className="font-semibold">Não consegui ler tudo dessa imagem</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {erro ||
                  "Pode acontecer com prints cortados, imagem tremida ou comprovante com pouco contraste. Você ainda pode preencher manualmente."}
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl"
                >
                  <RefreshCcw className="mr-1.5 h-4 w-4" />
                  Tentar outra imagem
                </Button>
                <Button asChild className="rounded-xl">
                  <Link to="/manual">
                    <PencilLine className="mr-1.5 h-4 w-4" />
                    Preencher manualmente
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {step === "upload" && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={analisar}
                disabled={!imagem}
                className="h-12 flex-1 rounded-2xl text-base font-semibold"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Analisar imagem
              </Button>
              {!imagem && (
                <Button
                  asChild
                  variant="outline"
                  className="h-12 rounded-2xl text-base font-semibold"
                >
                  <Link to="/manual">Preencher manualmente</Link>
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {/* REVISÃO */}
      {step === "revisao" && result && (
        <div className="mt-4 space-y-4 animate-rise">
          <div className="rounded-3xl border border-border bg-card p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-brand-on-soft animate-pop">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold">
                  {result.valoresEncontrados.length > 1
                    ? "Encontrei alguns valores"
                    : "Encontrei um valor"}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {result.valoresEncontrados.length > 1
                    ? "Escolha qual deles é o valor principal do gasto."
                    : "Confere se está certo antes de salvar."}
                </p>
              </div>
              <ConfiancaBadge nivel={result.confianca} />
            </div>

            {imagem && (
              <img
                src={imagem}
                alt="Comprovante"
                className="mt-3 max-h-40 w-full rounded-2xl object-contain bg-card-elevated"
              />
            )}

            {result.valoresEncontrados.length > 1 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Valores encontrados — toque para usar
                </p>
                <div className="mt-2 flex flex-wrap gap-2 stagger">
                  {result.valoresEncontrados.map((v, idx) => {
                    const ativo =
                      (overrideValor ?? result.valor ?? -1) === v;
                    return (
                      <button
                        key={`${v}-${idx}`}
                        type="button"
                        onClick={() => setOverrideValor(v)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-semibold transition-all animate-fade-in",
                          ativo
                            ? "border-brand bg-brand/10 text-brand"
                            : "border-border bg-card-elevated hover:border-brand/40",
                        )}
                      >
                        {new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        }).format(v)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {result.observacao && (
              <p className="mt-3 rounded-xl bg-card-elevated px-3 py-2 text-xs text-muted-foreground">
                💬 {result.observacao}
              </p>
            )}
          </div>

          <GastoForm
            key={`${valorEscolhido ?? 0}-${result.data ?? ""}`}
            initial={initialForm}
            submitLabel="Salvar gasto"
            onSubmit={(data) => {
              const dup = findPossibleDuplicate(
                data.valor,
                data.data,
                data.estabelecimento,
              );
              const save = () => {
                if (!canWrite) {
                  requireSubscription("Para adicionar gastos, escolha um plano ativo.");
                  return;
                }
                addGasto(data);
                toast.success("Pronto, gasto salvo!");
                setStep("sucesso");
              };
              if (dup) {
                setPending(() => save);
              } else {
                save();
              }
            }}
          />

          <p className="text-center text-xs text-muted-foreground">
            Dá uma conferida e salva quando quiser.
          </p>
        </div>
      )}

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

function ConfiancaBadge({ nivel }: { nivel: "alta" | "media" | "baixa" }) {
  const map = {
    alta: { label: "Confiança alta", cls: "bg-success/15 text-success" },
    media: { label: "Confiança média", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
    baixa: { label: "Confiança baixa", cls: "bg-destructive/15 text-destructive" },
  } as const;
  const it = map[nivel];
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", it.cls)}>
      {it.label}
    </span>
  );
}
