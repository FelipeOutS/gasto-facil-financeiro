import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Home,
  BadgePercent,
  Camera,
  Plus,
  Info,
  Trash2,
  Save,
  Loader2,
  AlertTriangle,
  X,
  Filter,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { formatBRL } from "@/lib/format";
import { apiFetch } from "@/lib/api-fetch";

export const Route = createFileRoute("/mercado_/preco-comunitario")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:communityPrices.title", { lng: i18n.language, defaultValue: "Preço Comunitário" }) }],
  }),
  component: PrecoComunitarioPage,
});

type CommunityPrice = {
  id: string;
  user_id: string;
  product_name: string;
  category: string | null;
  price: number;
  unit: string | null;
  market_name: string;
  source: "flyer" | "store" | "receipt" | "manual";
  seen_at: string;
  valid_until: string | null;
  city: string | null;
  neighborhood: string | null;
  notes: string | null;
  confidence: number | null;
  status: string;
  created_at: string;
};

type DetectedItem = {
  productName: string;
  price: number | null;
  unit: string | null;
  category: string | null;
  marketName: string | null;
  validUntil: string | null;
  notes: string | null;
  confidence: number | null;
};

type ReviewItem = DetectedItem & { id: string; include: boolean };

const TABLE = "community_market_prices" as const;
const SOURCE_LABEL: Record<string, string> = {
  flyer: "Panfleto",
  store: "Loja",
  receipt: "Cupom",
  manual: "Manual",
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

function PrecoComunitarioPage() {
  const { t } = useTranslation("mercado");
  const { user } = useAuth();
  const [items, setItems] = useState<CommunityPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProduct, setFilterProduct] = useState("");
  const [filterMarket, setFilterMarket] = useState("");

  // Scan state
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanMarket, setScanMarket] = useState("");
  const [review, setReview] = useState<ReviewItem[] | null>(null);

  // Manual state
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    productName: "",
    price: "",
    unit: "",
    category: "",
    marketName: "",
    source: "manual" as "flyer" | "store" | "receipt" | "manual",
    seenAt: new Date().toISOString().slice(0, 10),
    validUntil: "",
    city: "",
    neighborhood: "",
    notes: "",
  });

  async function reload() {
    setLoading(true);
    const { data, error } = await (supabase.from(TABLE as never) as any)
      .select("*")
      .eq("status", "active")
      .order("seen_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("[preco-comunitario] load", error.message);
      toast.error("Não foi possível carregar os preços.");
    } else {
      setItems((data ?? []) as CommunityPrice[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filterProduct && !it.product_name.toLowerCase().includes(filterProduct.toLowerCase())) return false;
      if (filterMarket && !it.market_name.toLowerCase().includes(filterMarket.toLowerCase())) return false;
      return true;
    });
  }, [items, filterProduct, filterMarket]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(file.type)) {
      toast.error("Use JPG, PNG ou WEBP.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Imagem muito grande. Máx. 10 MB.");
      return;
    }
    setScanLoading(true);
    try {
      const imageBase64 = await fileToBase64(file);
      const res = await apiFetch("/api/mercado-flyer-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, marketName: scanMarket || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.message || json?.error || "Não foi possível ler o panfleto.");
        return;
      }
      const detected: DetectedItem[] = json.items ?? [];
      if (!detected.length) {
        toast.info("Não conseguimos identificar preços nessa imagem. Tente uma foto mais nítida.");
        return;
      }
      setReview(
        detected.map((d, idx) => ({
          ...d,
          id: `r-${idx}-${Date.now()}`,
          include: true,
          marketName: d.marketName || scanMarket || null,
        })),
      );
    } catch (err) {
      console.error("[preco-comunitario] scan", err);
      toast.error("Erro ao enviar imagem.");
    } finally {
      setScanLoading(false);
    }
  }

  async function saveReview() {
    if (!user || !review) return;
    const toSave = review.filter((r) => r.include);
    if (!toSave.length) {
      toast.error("Selecione ao menos um item.");
      return;
    }
    const missing = toSave.filter((r) => !r.productName.trim() || r.price == null || r.price <= 0 || !(r.marketName?.trim()));
    if (missing.length) {
      toast.error("Preencha produto, preço e mercado nos itens marcados.");
      return;
    }
    const rows = toSave.map((r) => ({
      user_id: user.id,
      product_name: r.productName.trim(),
      normalized_product_name: r.productName.trim().toLowerCase(),
      category: r.category,
      price: r.price,
      unit: r.unit,
      market_name: r.marketName!.trim(),
      source: "flyer",
      seen_at: new Date().toISOString().slice(0, 10),
      valid_until: r.validUntil,
      notes: r.notes,
      confidence: r.confidence,
    }));
    const { error } = await (supabase.from(TABLE as never) as any).insert(rows);
    if (error) {
      console.error("[preco-comunitario] insert", error.message);
      toast.error("Não foi possível salvar.");
      return;
    }
    toast.success(`${rows.length} preço(s) salvo(s).`);
    setReview(null);
    setScanMarket("");
    reload();
  }

  async function saveManual() {
    if (!user) return;
    const price = Number(manualForm.price.replace(",", "."));
    if (!manualForm.productName.trim() || !manualForm.marketName.trim() || !Number.isFinite(price) || price <= 0) {
      toast.error("Preencha produto, mercado e preço.");
      return;
    }
    const { error } = await (supabase.from(TABLE as never) as any).insert({
      user_id: user.id,
      product_name: manualForm.productName.trim(),
      normalized_product_name: manualForm.productName.trim().toLowerCase(),
      category: manualForm.category || null,
      price,
      unit: manualForm.unit || null,
      market_name: manualForm.marketName.trim(),
      source: manualForm.source,
      seen_at: manualForm.seenAt || new Date().toISOString().slice(0, 10),
      valid_until: manualForm.validUntil || null,
      city: manualForm.city || null,
      neighborhood: manualForm.neighborhood || null,
      notes: manualForm.notes || null,
    });
    if (error) {
      console.error("[preco-comunitario] manual insert", error.message);
      toast.error("Não foi possível salvar.");
      return;
    }
    toast.success("Preço salvo.");
    setManualOpen(false);
    setManualForm((f) => ({ ...f, productName: "", price: "", notes: "" }));
    reload();
  }

  async function removeItem(id: string) {
    const { error } = await (supabase.from(TABLE as never) as any).delete().eq("id", id);
    if (error) {
      toast.error("Não foi possível remover.");
      return;
    }
    setItems((curr) => curr.filter((it) => it.id !== id));
  }

  return (
    <MobileShell wide>
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar">
          <Link to="/mercado"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <Button asChild variant="ghost" size="icon" aria-label="Início">
          <Link to="/"><Home className="h-5 w-5" /></Link>
        </Button>
      </div>

      <header className="mt-2 flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
          <BadgePercent className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Preço Comunitário</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Leia panfletos por foto ou registre preços manualmente. A leitura é assistida — sempre revise antes de salvar.
          </p>
        </div>
      </header>

      <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-300/50 bg-amber-50/60 p-3 text-[13px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Os preços são informados por usuários e podem mudar sem aviso. Sempre confirme no mercado antes de comprar.</p>
      </div>

      {/* Ações */}
      <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Camera className="h-4 w-4" /> Ler panfleto por foto</h2>
          <p className="mt-1 text-xs text-muted-foreground">A IA tenta identificar produtos, preços e validade. Você revisa antes de salvar.</p>
          <Label htmlFor="scanMarket" className="mt-3 block text-xs">Mercado (opcional)</Label>
          <Input id="scanMarket" value={scanMarket} onChange={(e) => setScanMarket(e.target.value)} placeholder="Ex.: Assaí, Atacadão" />
          <input ref={fileRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp" capture="environment" className="hidden" onChange={onPickFile} />
          <Button className="mt-3 w-full min-h-11" onClick={() => fileRef.current?.click()} disabled={scanLoading}>
            {scanLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lendo imagem…</> : <><Camera className="mr-2 h-4 w-4" /> Escolher imagem</>}
          </Button>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4" /> Informar manualmente</h2>
          <p className="mt-1 text-xs text-muted-foreground">Sem panfleto? Cadastre o preço que você viu na loja.</p>
          <Button className="mt-3 w-full min-h-11" variant="secondary" onClick={() => setManualOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Novo preço manual
          </Button>
        </div>
      </section>

      {/* Filtros */}
      <section className="mt-5 rounded-2xl border border-border/60 bg-card p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Filter className="h-3.5 w-3.5" /> Filtros
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input placeholder="Filtrar por produto" value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)} />
          <Input placeholder="Filtrar por mercado" value={filterMarket} onChange={(e) => setFilterMarket(e.target.value)} />
        </div>
      </section>

      {/* Lista */}
      <section className="mt-4">
        {loading ? (
          <div className="grid place-items-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nenhum preço por aqui ainda"
            description="Use “Ler panfleto por foto” ou cadastre manualmente para começar."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {filtered.map((it) => (
              <li key={it.id} className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{it.product_name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {it.market_name}{it.unit ? ` · ${it.unit}` : ""}{it.category ? ` · ${it.category}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold text-brand">{formatBRL(it.price)}</p>
                    <span className="mt-0.5 inline-flex rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-on-soft">
                      {SOURCE_LABEL[it.source] ?? it.source}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Visto em {new Date(it.seen_at).toLocaleDateString("pt-BR")}{it.valid_until ? ` · válido até ${new Date(it.valid_until).toLocaleDateString("pt-BR")}` : ""}</span>
                  {user?.id === it.user_id && (
                    <button type="button" onClick={() => removeItem(it.id)} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Remover">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {it.notes && <p className="mt-1 text-[11px] text-muted-foreground">{it.notes}</p>}
                <p className="mt-2 text-[10px] italic text-muted-foreground">Confira no mercado antes de comprar.</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Review dialog */}
      <Dialog open={review !== null} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Revisar itens detectados</DialogTitle>
            <DialogDescription>
              Revise os itens antes de salvar. A leitura automática pode confundir nomes, preços ou unidades.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-amber-300/40 bg-amber-50/50 p-2 text-[12px] text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Edite o que estiver errado, desmarque o que não deseja salvar e confirme apenas os itens corretos.</span>
          </div>
          <ul className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {review?.map((r, idx) => (
              <li key={r.id} className={`rounded-xl border p-3 ${r.include ? "border-border" : "border-dashed border-muted opacity-60"}`}>
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={r.include}
                      onChange={(e) => setReview((cur) => cur!.map((x, i) => i === idx ? { ...x, include: e.target.checked } : x))}
                    />
                    Incluir
                  </label>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setReview((cur) => cur!.filter((_, i) => i !== idx))}
                    aria-label="Remover item"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Produto</Label>
                    <Input value={r.productName} onChange={(e) => setReview((cur) => cur!.map((x, i) => i === idx ? { ...x, productName: e.target.value } : x))} />
                  </div>
                  <div>
                    <Label className="text-xs">Preço (R$)</Label>
                    <Input
                      inputMode="decimal"
                      value={r.price ?? ""}
                      onChange={(e) => {
                        const v = e.target.value.replace(",", ".");
                        const n = v === "" ? null : Number(v);
                        setReview((cur) => cur!.map((x, i) => i === idx ? { ...x, price: Number.isFinite(n as number) ? (n as number) : null } : x));
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Unidade</Label>
                    <Input value={r.unit ?? ""} onChange={(e) => setReview((cur) => cur!.map((x, i) => i === idx ? { ...x, unit: e.target.value || null } : x))} placeholder="un, kg, L…" />
                  </div>
                  <div>
                    <Label className="text-xs">Mercado</Label>
                    <Input value={r.marketName ?? ""} onChange={(e) => setReview((cur) => cur!.map((x, i) => i === idx ? { ...x, marketName: e.target.value || null } : x))} />
                  </div>
                  <div>
                    <Label className="text-xs">Categoria</Label>
                    <Input value={r.category ?? ""} onChange={(e) => setReview((cur) => cur!.map((x, i) => i === idx ? { ...x, category: e.target.value || null } : x))} />
                  </div>
                  <div>
                    <Label className="text-xs">Válido até</Label>
                    <Input type="date" value={r.validUntil ?? ""} onChange={(e) => setReview((cur) => cur!.map((x, i) => i === idx ? { ...x, validUntil: e.target.value || null } : x))} />
                  </div>
                </div>
                {r.notes && <p className="mt-2 text-[11px] text-muted-foreground">{r.notes}</p>}
              </li>
            ))}
          </ul>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setReview(null)}>Cancelar</Button>
            <Button onClick={saveReview}><Save className="mr-2 h-4 w-4" /> Salvar preços revisados</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual dialog */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo preço manual</DialogTitle>
            <DialogDescription>Informe um preço que você viu no mercado, cupom ou panfleto.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="text-xs">Produto *</Label>
              <Input value={manualForm.productName} onChange={(e) => setManualForm((f) => ({ ...f, productName: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Preço (R$) *</Label>
              <Input inputMode="decimal" value={manualForm.price} onChange={(e) => setManualForm((f) => ({ ...f, price: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Unidade</Label>
              <Input value={manualForm.unit} onChange={(e) => setManualForm((f) => ({ ...f, unit: e.target.value }))} placeholder="un, kg, L…" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Mercado *</Label>
              <Input value={manualForm.marketName} onChange={(e) => setManualForm((f) => ({ ...f, marketName: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Categoria</Label>
              <Input value={manualForm.category} onChange={(e) => setManualForm((f) => ({ ...f, category: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Origem</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={manualForm.source}
                onChange={(e) => setManualForm((f) => ({ ...f, source: e.target.value as typeof f.source }))}
              >
                <option value="manual">Manual</option>
                <option value="flyer">Panfleto</option>
                <option value="store">Loja</option>
                <option value="receipt">Cupom</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Data em que viu</Label>
              <Input type="date" value={manualForm.seenAt} onChange={(e) => setManualForm((f) => ({ ...f, seenAt: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Validade da promoção</Label>
              <Input type="date" value={manualForm.validUntil} onChange={(e) => setManualForm((f) => ({ ...f, validUntil: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Cidade</Label>
              <Input value={manualForm.city} onChange={(e) => setManualForm((f) => ({ ...f, city: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Bairro</Label>
              <Input value={manualForm.neighborhood} onChange={(e) => setManualForm((f) => ({ ...f, neighborhood: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Observação</Label>
              <Textarea rows={2} value={manualForm.notes} onChange={(e) => setManualForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Ex.: leve 3 pague 2, no clube…" />
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setManualOpen(false)}>Cancelar</Button>
            <Button onClick={saveManual}><Save className="mr-2 h-4 w-4" /> Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </MobileShell>
  );
}
