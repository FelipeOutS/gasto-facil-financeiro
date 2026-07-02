/**
 * WA-PIX-UX-01 — Tela autenticada de cópia da chave Pix.
 *
 * Fluxo:
 *  - O usuário chega por um link enviado no WhatsApp: /pix/copiar/<TOKEN>.
 *  - Sem sessão → redireciona para /login e volta.
 *  - Com sessão → chama revealPixKey (server function autenticada) que
 *    consome o token uma única vez e devolve a chave completa.
 *  - Botão "Copiar chave Pix" usa Clipboard API dentro de gesto do usuário.
 *
 * A chave nunca aparece na URL nem em logs; a página só a mantém em memória.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Check, ArrowLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { revealPixKey } from "@/lib/pix-reveal.functions";

export const Route = createFileRoute("/pix/copiar/$token")({
  head: () => ({
    meta: [
      { title: "Copiar chave Pix — Gasto Inteligente" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: CopiarPixPage,
});

type RevealState =
  | { status: "loading" }
  | { status: "ok"; nome: string; chave: string; tipoLabel: string }
  | { status: "expired" }
  | { status: "error" };

const TIPO_LABEL: Record<string, string> = {
  telefone: "Celular",
  celular: "Celular",
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  aleatoria: "Chave aleatória",
};

function CopiarPixPage() {
  const { token } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const reveal = useServerFn(revealPixKey);

  const [state, setState] = useState<RevealState>({ status: "loading" });
  const [copied, setCopied] = useState(false);

  // Redireciona para login preservando o destino.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const redirect = `/pix/copiar/${encodeURIComponent(token)}`;
      void navigate({
        to: "/login",
        search: { redirect } as never,
        replace: true,
      });
    }
  }, [authLoading, user, token, navigate]);

  // Consome o token exatamente uma vez após autenticar.
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await reveal({ data: { token } });
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "expired" });
          return;
        }
        setState({
          status: "ok",
          nome: res.nome,
          chave: res.chave,
          tipoLabel: TIPO_LABEL[res.tipo] ?? res.tipo,
        });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, token]);

  async function handleCopy(chave: string) {
    try {
      await navigator.clipboard.writeText(chave);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: seleciona texto para cópia manual
      const el = document.getElementById("pix-chave-plain");
      if (el instanceof HTMLElement) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Copiar chave Pix</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === "loading" && (
            <p className="text-sm text-muted-foreground">Carregando chave…</p>
          )}

          {state.status === "ok" && (
            <>
              <div>
                <p className="text-sm text-muted-foreground">Favorecido</p>
                <p className="text-base font-medium">{state.nome}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Chave Pix ({state.tipoLabel})
                </p>
                <p
                  id="pix-chave-plain"
                  className="text-base font-mono break-all select-all"
                >
                  {state.chave}
                </p>
              </div>
              <Button
                className="w-full"
                onClick={() => void handleCopy(state.chave)}
              >
                {copied ? (
                  <>
                    <Check className="mr-2" /> Copiada!
                  </>
                ) : (
                  <>
                    <Copy className="mr-2" /> Copiar chave Pix
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Este link é de uso único. Se precisar copiar de novo, peça a
                chave outra vez no WhatsApp.
              </p>
            </>
          )}

          {state.status === "expired" && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <ShieldAlert className="mt-0.5 shrink-0" />
                <p>
                  Este link expirou ou já foi usado. Para copiar novamente,
                  peça pelo WhatsApp: <em>"qual a chave Pix do [nome]?"</em>
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void navigate({ to: "/" })}
              >
                <ArrowLeft className="mr-2" /> Voltar
              </Button>
            </div>
          )}

          {state.status === "error" && (
            <p className="text-sm text-destructive">
              Não consegui carregar a chave agora. Tente de novo daqui a pouco.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
