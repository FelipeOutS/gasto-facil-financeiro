import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Sparkles, Send, Trash2, Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toastFromError } from "@/lib/premium-error";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";
import { sendChatMessage, getChatHistory, clearChatHistory } from "@/lib/finance-ai.functions";
import { requireOnline } from "@/lib/use-online-status";
import { confirmAsync } from "@/components/ConfirmDialog";

export const Route = createFileRoute("/gasto-ai")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  head: () => {
    const t = i18n.getFixedT(i18n.language, "misc");
    return {
      meta: [{ title: t("ai.metaTitle") }, { name: "description", content: t("ai.metaDesc") }],
    };
  },
  component: GastoAIPage,
});

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; created_at: string };

function GastoAIPage() {
  const { t } = useTranslation("misc");
  const SUGESTOES = useMemo(() => t("ai.suggestions", { returnObjects: true }) as string[], [t]);
  const { user, profile } = useAuth();
  const { q: seededQ } = Route.useSearch();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Seed input from ?q= (vem do card "Perguntar para a IA" do Dashboard)
  useEffect(() => {
    if (seededQ && !input) setInput(seededQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seededQ]);

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
      toast.error(t("ai.toastTooLong"));
      return;
    }
    if (!(await requireOnline())) return;
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
      toastFromError(e, t("ai.toastError"));
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
    const ok = await confirmAsync({ title: t("ai.confirmClear"), destructive: true });
    if (!ok) return;
    if (!(await requireOnline())) return;
    try {
      await clearFn();
      setMessages([]);
      toast.success(t("ai.toastCleared"));
    } catch {
      toast.error(t("ai.toastClearError"));
    }
  }

  const empty = !loadingHistory && messages.length === 0;
  const userName = profile?.nome ?? profile?.responsavel_nome;

  return (
    <MobileShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-6 pt-4 sm:px-6 lg:pt-8">
        <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-amber-400/30 to-primary/30 ring-1 ring-primary/20">
              <Sparkles className="h-5 w-5 text-primary" />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t("ai.title")}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("ai.subtitle")}</p>
            </div>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClear} className="rounded-full">
              <Trash2 className="mr-2 h-4 w-4" />
              {t("ai.clear")}
            </Button>
          )}
        </header>

        {/* Sugestões rápidas — sempre visíveis no topo */}
        <div className="mb-3 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SUGESTOES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={sending}
              onClick={() => void handleSend(s)}
              className="shrink-0 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground/80 transition-all hover:border-primary/40 hover:bg-accent/50 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex flex-col overflow-hidden rounded-3xl border border-border/60 bg-card/70 shadow-card backdrop-blur-sm">
          <div ref={scrollRef} className="h-[58vh] overflow-y-auto px-3 py-4 sm:px-5 sm:py-5">
            {loadingHistory ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("ai.loading")}
              </div>
            ) : empty ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-on-soft">
                  <Bot className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{t("ai.emptyTitle")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("ai.emptyDesc")}</p>
                </div>
              </div>
            ) : (
              <ul className="space-y-4">
                {messages.map((m) => (
                  <li
                    key={m.id}
                    className={cn(
                      "flex items-end gap-2",
                      m.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    {m.role === "assistant" && (
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-400/30 to-primary/30 ring-1 ring-primary/20">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                      </span>
                    )}
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm",
                        m.role === "user"
                          ? "rounded-br-md bg-brand-grad text-primary-foreground"
                          : "rounded-bl-md border border-border/40 bg-card text-foreground",
                      )}
                    >
                      {m.role === "assistant" ? (
                        <div className="ai-markdown text-sm leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      )}
                    </div>
                    {m.role === "user" && (
                      <UserAvatar
                        url={profile?.avatar_url}
                        name={userName}
                        email={user?.email}
                        size={28}
                      />
                    )}
                  </li>
                ))}
                {sending && (
                  <li className="flex items-end justify-start gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-400/30 to-primary/30 ring-1 ring-primary/20">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                    </span>
                    <div className="rounded-2xl rounded-bl-md border border-border/40 bg-card px-3.5 py-2.5 text-sm text-muted-foreground">
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

          {/* Input fixo na base do bloco do chat */}
          <div className="sticky bottom-0 border-t border-border/60 bg-card/95 p-3 backdrop-blur-md sm:p-4">
            <form onSubmit={onSubmit} className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("ai.placeholder")}
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
                aria-label={t("ai.send")}
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
            <p className="mt-2 text-[11px] text-muted-foreground">{t("ai.disclaimer")}</p>
          </div>
        </div>
      </div>
    </MobileShell>
  );
}
