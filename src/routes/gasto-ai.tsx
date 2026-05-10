import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Send, Trash2, Bot, User as UserIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  sendChatMessage,
  getChatHistory,
  clearChatHistory,
} from "@/lib/finance-ai.functions";

export const Route = createFileRoute("/gasto-ai")({
  head: () => ({
    meta: [
      { title: "Gasto Inteligente AI — Assistente financeiro com IA" },
      {
        name: "description",
        content:
          "Converse com a IA sobre seus gastos, metas e organização financeira em linguagem simples.",
      },
    ],
  }),
  component: GastoAIPage,
});

const SUGESTOES = [
  "Como foi meu mês até agora?",
  "Onde eu mais gastei?",
  "Tenho alguma conta vencendo?",
  "Como posso economizar essa semana?",
  "Me dê um resumo simples das minhas finanças",
  "Me ajude a organizar minhas metas",
  "Estou gastando muito em alguma categoria?",
];

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; created_at: string };

function GastoAIPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sendFn = useServerFn(sendChatMessage);
  const historyFn = useServerFn(getChatHistory);
  const clearFn = useServerFn(clearChatHistory);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await historyFn();
        if (cancelled) return;
        setMessages(res.messages as ChatMessage[]);
      } catch (e) {
        console.error("[gasto-ai] load history", e);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyFn]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (trimmed.length > 1500) {
      toast.error("Mensagem muito longa. Tente algo mais curto.");
      return;
    }
    setSending(true);
    const optimistic: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    try {
      const res = await sendFn({ data: { message: trimmed } });
      setMessages((prev) => [
        ...prev,
        {
          id: res.assistantMessageId ?? `a-${Date.now()}`,
          role: "assistant",
          content: res.reply,
          created_at: res.createdAt,
        },
      ]);
    } catch (e: any) {
      const msg =
        typeof e?.message === "string" && e.message
          ? e.message
          : "Não consegui responder agora. Tente novamente em alguns instantes.";
      toast.error(msg);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void handleSend(input);
  }

  async function handleClear() {
    if (!confirm("Apagar todo o histórico desta conversa?")) return;
    try {
      await clearFn();
      setMessages([]);
      toast.success("Histórico apagado.");
    } catch {
      toast.error("Não consegui limpar o histórico.");
    }
  }

  const empty = !loadingHistory && messages.length === 0;

  return (
    <MobileShell>
      <div className="mx-auto w-full max-w-3xl px-4 pb-6 pt-4 sm:px-6 lg:pt-8">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-amber-400/30 to-primary/30 ring-1 ring-primary/20">
              <Sparkles className="h-5 w-5 text-primary" />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Gasto Inteligente AI</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Pergunte sobre seus gastos, metas, contas e organização financeira.
              </p>
            </div>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClear} className="rounded-full">
              <Trash2 className="mr-2 h-4 w-4" />
              Limpar conversa
            </Button>
          )}
        </header>

        <div className="rounded-3xl border border-border/60 bg-card/70 shadow-card backdrop-blur-sm">
          <div
            ref={scrollRef}
            className="h-[58vh] overflow-y-auto px-3 py-4 sm:px-5 sm:py-5"
          >
            {loadingHistory ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Carregando conversa…
              </div>
            ) : empty ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-on-soft">
                  <Bot className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Bora olhar seu financeiro juntos?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Escolha uma sugestão abaixo ou escreva sua pergunta.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="space-y-3">
                {messages.map((m) => (
                  <li
                    key={m.id}
                    className={cn(
                      "flex gap-2",
                      m.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    {m.role === "assistant" && (
                      <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-on-soft">
                        <Bot className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <div
                      className={cn(
                        "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
                        m.role === "user"
                          ? "bg-brand-grad text-primary-foreground"
                          : "bg-accent/40 text-foreground",
                      )}
                    >
                      {m.content}
                    </div>
                    {m.role === "user" && (
                      <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                        <UserIcon className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </li>
                ))}
                {sending && (
                  <li className="flex justify-start gap-2">
                    <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-on-soft">
                      <Bot className="h-3.5 w-3.5" />
                    </span>
                    <div className="rounded-2xl bg-accent/40 px-3.5 py-2.5 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
                      </span>
                    </div>
                  </li>
                )}
              </ul>
            )}
          </div>

          <div className="border-t border-border/60 p-3 sm:p-4">
            {messages.length === 0 && !loadingHistory && (
              <div className="mb-3 flex flex-wrap gap-2">
                {SUGESTOES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={sending}
                    onClick={() => void handleSend(s)}
                    className="rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground/80 transition-colors hover:border-border hover:bg-accent/40 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={onSubmit} className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Pergunte algo sobre seus gastos, metas, contas…"
                rows={1}
                maxLength={1500}
                disabled={sending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend(input);
                  }
                }}
                className="max-h-32 min-h-[44px] resize-none rounded-2xl bg-background"
              />
              <Button
                type="submit"
                disabled={sending || !input.trim()}
                className="h-11 w-11 shrink-0 rounded-2xl bg-brand-grad p-0"
                aria-label="Enviar"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
            <p className="mt-2 text-[11px] text-muted-foreground">
              A IA usa apenas seus dados financeiros e nunca compartilha com outros usuários. Respostas
              são orientações gerais — não constituem recomendação de investimento.
            </p>
          </div>
        </div>
      </div>
    </MobileShell>
  );
}
