import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bell, CalendarClock, CalendarDays, Check, CreditCard, Pencil, Plus, Repeat, RotateCcw, X } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PremiumCard } from "@/components/ui/premium-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  createAgendaFn,
  listAgendaFn,
  listAgendaSourcesFn,
  setAgendaStatusFn,
  updateAgendaFn,
} from "@/lib/agenda.functions";
import { DEFAULT_TZ, localParts, localToUtc } from "@/lib/agenda/datetime";
import { bucketOf, type AgendaBucket } from "@/lib/agenda/buckets";

export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda e lembretes — Gasto Inteligente" },
      {
        name: "description",
        content: "Seus compromissos e lembretes financeiros, os mesmos no site e no WhatsApp do Gasto Inteligente.",
      },
      { property: "og:title", content: "Agenda e lembretes — Gasto Inteligente" },
      { property: "og:description", content: "Compromissos e lembretes do site e do WhatsApp num só lugar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgendaPage,
});

type Item = Awaited<ReturnType<typeof listAgendaFn>>["items"][number];
type Sources = Awaited<ReturnType<typeof listAgendaSourcesFn>>;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const TABS: Array<{ key: AgendaBucket; label: string }> = [
  { key: "hoje", label: "Hoje" },
  { key: "amanha", label: "Amanhã" },
  { key: "semana", label: "Esta semana" },
  { key: "proximos", label: "Próximos" },
  { key: "concluidos", label: "Concluídos" },
  { key: "cancelados", label: "Cancelados" },
];

const FREQ_LABEL: Record<string, string> = { diaria: "Todo dia", semanal: "Toda semana", mensal: "Todo mês", anual: "Todo ano" };

function AgendaPage() {
  const list = useServerFn(listAgendaFn);
  const setStatus = useServerFn(setAgendaStatusFn);
  const [items, setItems] = useState<Item[] | null>(null);
  const [tab, setTab] = useState<AgendaBucket>("hoje");
  const [editing, setEditing] = useState<Item | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await list({ headers: await authHeaders() });
      setItems(r.items);
    } catch {
      setItems((cur) => cur ?? []);
      toast.error("Não foi possível carregar a agenda.");
    }
  }, [list]);

  useEffect(() => {
    void load();
    // Mesma agenda do WhatsApp: mudanças feitas lá chegam aqui na hora.
    const ch = supabase
      .channel("agenda_items_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "agenda_items" }, () => void load())
      .subscribe();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(ch);
    };
  }, [load]);

  const grouped = useMemo(() => {
    const now = new Date();
    const g: Record<AgendaBucket, Item[]> = { hoje: [], amanha: [], semana: [], proximos: [], concluidos: [], cancelados: [] };
    for (const it of items ?? []) {
      const when = it.starts_at ?? (it.due_iso ? localToUtc(
        { y: +it.due_iso.slice(0, 4), m: +it.due_iso.slice(5, 7), d: +it.due_iso.slice(8, 10) },
        { h: 9, mi: 0 },
        it.timezone,
      ).toISOString() : null);
      g[bucketOf(it.status, when, now, it.timezone || DEFAULT_TZ)].push(it);
    }
    return g;
  }, [items]);

  async function act(it: Item, action: "concluir" | "cancelar" | "reativar") {
    try {
      const r = await setStatus({ data: { id: it.id, action }, headers: await authHeaders() });
      toast.success(
        action === "cancelar" ? "Item cancelado." : action === "reativar" ? "Item reativado." : r?.advanced ? "Feito! Próxima ocorrência agendada." : "Concluído!",
      );
      await load();
    } catch (e) {
      toast.error((e as Error).message || "Não foi possível salvar.");
    }
  }

  const visible = grouped[tab];

  return (
    <MobileShell>
      <header className="pt-2 animate-rise">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Agenda do GI</p>
            <h1 className="mt-0.5 text-[26px] font-bold leading-tight tracking-tight">Agenda e lembretes</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A mesma agenda do WhatsApp. Diga lá <em>“me lembra amanhã às 9 de pagar a internet”</em> e aparece aqui.
            </p>
          </div>
          <Button onClick={() => setEditing("new")} className="shrink-0 gap-1.5">
            <Plus className="h-4 w-4" /> Novo
          </Button>
        </div>
      </header>

      <div className="mt-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Período">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              tab === t.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent",
            )}
          >
            {t.label}
            {items && grouped[t.key].length > 0 && <span className="ml-1.5 opacity-80">{grouped[t.key].length}</span>}
          </button>
        ))}
      </div>

      <section className="mt-3 space-y-2">
        {items === null ? (
          <>
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="Nada por aqui"
            description={tab === "concluidos" || tab === "cancelados" ? "Nenhum item nesta lista." : "Crie um lembrete aqui ou pelo WhatsApp."}
          />
        ) : (
          visible.map((it) => (
            <PremiumCard key={it.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {it.source_type ? <CreditCard className="h-5 w-5" /> : it.kind === "compromisso" ? <CalendarClock className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate font-semibold", it.status !== "ativo" && "text-muted-foreground line-through")}>{it.titulo}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{it.when_label}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-semibold text-muted-foreground">
                    <span className="rounded-full bg-muted px-2 py-0.5">{it.kind === "compromisso" ? "Compromisso" : "Lembrete"}</span>
                    {it.recurrence_freq && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                        <Repeat className="h-3 w-3" /> {FREQ_LABEL[it.recurrence_freq]}
                      </span>
                    )}
                    {it.origem === "whatsapp" && <span className="rounded-full bg-muted px-2 py-0.5">Criado no WhatsApp</span>}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-1.5">
                {it.status === "ativo" ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(it)} className="h-8 gap-1">
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => act(it, "cancelar")} className="h-8 gap-1">
                      <X className="h-3.5 w-3.5" /> Cancelar
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => act(it, "concluir")} className="h-8 gap-1">
                      <Check className="h-3.5 w-3.5" /> Concluir
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => act(it, "reativar")} className="h-8 gap-1">
                    <RotateCcw className="h-3.5 w-3.5" /> Reativar
                  </Button>
                )}
              </div>
            </PremiumCard>
          ))
        )}
      </section>

      {editing && (
        <AgendaDialog
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </MobileShell>
  );
}

function toLocalInputs(iso: string | null, tz: string): { date: string; time: string } {
  if (!iso) return { date: "", time: "09:00" };
  const p = localParts(new Date(iso), tz);
  return {
    date: `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
    time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
  };
}

function AgendaDialog({ item, onClose, onSaved }: { item: Item | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const create = useServerFn(createAgendaFn);
  const update = useServerFn(updateAgendaFn);
  const sourcesFn = useServerFn(listAgendaSourcesFn);
  const tz = item?.timezone || DEFAULT_TZ;
  const init = toLocalInputs(item?.starts_at ?? null, tz);
  const [kind, setKind] = useState<"lembrete" | "compromisso">((item?.kind as "lembrete") ?? "lembrete");
  const [titulo, setTitulo] = useState(item?.titulo ?? "");
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [freq, setFreq] = useState<string>(item?.recurrence_freq ?? "none");
  const [vinculo, setVinculo] = useState<string>("none"); // "tipo:id"
  const [dias, setDias] = useState<number>(item?.aviso_dias_antes ?? 3);
  const [sources, setSources] = useState<Sources | null>(null);
  const [saving, setSaving] = useState(false);
  const isFin = item ? !!item.source_type : vinculo !== "none";

  useEffect(() => {
    if (item) return;
    void (async () => {
      try {
        setSources(await sourcesFn({ headers: await authHeaders() }));
      } catch {
        /* vínculo é opcional */
      }
    })();
  }, [item, sourcesFn]);

  async function save() {
    if (!titulo.trim() && !(vinculo !== "none")) return toast.error("Informe um título.");
    let startsAt: string | null = null;
    if (!isFin) {
      if (!date || !time) return toast.error("Informe data e horário.");
      const [y, m, d] = date.split("-").map(Number);
      const [h, mi] = time.split(":").map(Number);
      startsAt = localToUtc({ y, m, d }, { h, mi }, tz).toISOString();
    }
    setSaving(true);
    try {
      const headers = await authHeaders();
      const recurrence_freq = freq === "none" ? null : (freq as "diaria");
      if (item) {
        await update({
          data: {
            id: item.id,
            patch: {
              titulo: titulo.trim(),
              kind,
              ...(isFin ? { aviso_dias_antes: dias } : { starts_at: startsAt, recurrence_freq }),
            },
          },
          headers,
        });
      } else {
        const [st, sid] = vinculo === "none" ? [null, null] : vinculo.split(":");
        const nomeFonte =
          st && sources
            ? [...sources.contas, ...sources.cartoes, ...sources.recorrencias].find((s) => s.id === sid)?.nome
            : undefined;
        await create({
          data: {
            kind,
            titulo: titulo.trim() || (st === "cartao" ? `Fatura ${nomeFonte}` : (nomeFonte ?? "")),
            starts_at: startsAt,
            timezone: tz,
            recurrence_freq: isFin ? null : recurrence_freq,
            source_type: (st as "cartao") ?? null,
            source_id: sid ?? null,
            aviso_dias_antes: isFin ? dias : null,
          },
          headers,
        });
      }
      toast.success("Salvo! Já aparece também no WhatsApp.");
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? "Editar item" : "Novo item na agenda"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(["lembrete", "compromisso"] as const).map((k) => (
              <Button key={k} type="button" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>
                {k === "lembrete" ? "🔔 Lembrete" : "📅 Compromisso"}
              </Button>
            ))}
          </div>
          {!item && (
            <div className="space-y-1.5">
              <Label>Vincular a item financeiro (opcional)</Label>
              <Select value={vinculo} onValueChange={setVinculo}>
                <SelectTrigger>
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum (lembrete livre)</SelectItem>
                  {sources?.cartoes.map((s) => (
                    <SelectItem key={s.id} value={`cartao:${s.id}`}>💳 Fatura {s.nome}</SelectItem>
                  ))}
                  {sources?.contas.map((s) => (
                    <SelectItem key={s.id} value={`conta_a_pagar:${s.id}`}>🧾 {s.nome}</SelectItem>
                  ))}
                  {sources?.recorrencias.map((s) => (
                    <SelectItem key={s.id} value={`recorrencia:${s.id}`}>🔁 {s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ag-titulo">Título</Label>
            <Input id="ag-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} placeholder={isFin ? "Opcional" : "Ex.: Dentista"} />
          </div>
          {isFin ? (
            <div className="space-y-1.5">
              <Label htmlFor="ag-dias">Avisar quantos dias antes do vencimento?</Label>
              <Input id="ag-dias" type="number" min={0} max={60} value={dias} onChange={(e) => setDias(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} />
              <p className="text-xs text-muted-foreground">Valor e vencimento são conferidos de novo na hora do aviso.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ag-data">Data</Label>
                  <Input id="ag-data" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ag-hora">Horário</Label>
                  <Input id="ag-hora" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Repetir</Label>
                <Select value={freq} onValueChange={setFreq}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não repetir</SelectItem>
                    <SelectItem value="diaria">Todo dia</SelectItem>
                    <SelectItem value="semanal">Toda semana</SelectItem>
                    <SelectItem value="mensal">Todo mês</SelectItem>
                    <SelectItem value="anual">Todo ano</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Voltar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
