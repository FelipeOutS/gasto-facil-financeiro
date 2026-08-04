import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { toastFromError, friendlyError } from "@/lib/premium-error";
import {
  Building2,
  Search,
  Plus,
  Trash2,
  Power,
  PowerOff,
  Pencil,
  Loader2,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Contact,
  BarChart3,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { extractDomain } from "@/lib/brand/resolver";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { formatarCnpj, limparCnpj, MSG_CNPJ_INVALIDO, validarCnpj } from "@/lib/cnpj";
import type { EmpresaConsultada } from "@/lib/empresa";
import {
  alternarAtivoCliente,
  atualizarCliente,
  existeClienteComCnpj,
  listarClientes,
  removerCliente,
  salvarClienteManual,
  salvarClientePorCnpj,
  type Cliente,
} from "@/lib/clientes";
import { consultarCnpj } from "@/lib/cnpj.functions";

export const Route = createFileRoute("/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes — Gasto Inteligente" },
      {
        name: "description",
        content: "Cadastre clientes por CNPJ e organize melhor suas receitas empresariais.",
      },
    ],
  }),
  component: ClientesPage,
});

interface ConsultaResp {
  success: boolean;
  source: "brasilapi" | "cnpjws" | "cache" | null;
  stale: boolean;
  company: EmpresaConsultada | null;
  message?: string;
}

function aplicarMascaraCnpj(v: string): string {
  const d = limparCnpj(v).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function ClientesPage() {
  const { t } = useTranslation("clientes");
  const { user } = useAuth();
  const consultarFn = useServerFn(consultarCnpj);

  const [list, setList] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);

  const [novoAberto, setNovoAberto] = useState(false);
  const [tab, setTab] = useState<"cnpj" | "manual">("cnpj");

  // CNPJ form state
  const [cnpjInput, setCnpjInput] = useState("");
  const [erroCnpj, setErroCnpj] = useState<string | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [resp, setResp] = useState<ConsultaResp | null>(null);
  const [apelidoCnpj, setApelidoCnpj] = useState("");
  const [telefoneCnpj, setTelefoneCnpj] = useState("");
  const [emailCnpj, setEmailCnpj] = useState("");
  const [obsCnpj, setObsCnpj] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Manual form state
  const [manNome, setManNome] = useState("");
  const [manApelido, setManApelido] = useState("");
  const [manTelefone, setManTelefone] = useState("");
  const [manEmail, setManEmail] = useState("");
  const [manObs, setManObs] = useState("");

  // Edit
  const [editando, setEditando] = useState<Cliente | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editApelido, setEditApelido] = useState("");
  const [editTelefone, setEditTelefone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editObs, setEditObs] = useState("");
  const [salvandoEdit, setSalvandoEdit] = useState(false);

  // Remover
  const [confirmarRemover, setConfirmarRemover] = useState<Cliente | null>(null);
  const [removendo, setRemovendo] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelado = false;
    setLoading(true);
    void (async () => {
      try {
        const itens = await listarClientes(user.id);
        if (!cancelado) setList(itens);
      } catch {
        if (!cancelado) toast.error(t("toasts.loadError"));
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [user?.id, t]);

  const cnpjValido = useMemo(() => validarCnpj(cnpjInput), [cnpjInput]);

  function limparCnpjForm() {
    setCnpjInput("");
    setErroCnpj(null);
    setResp(null);
    setApelidoCnpj("");
    setTelefoneCnpj("");
    setEmailCnpj("");
    setObsCnpj("");
  }

  function limparManualForm() {
    setManNome("");
    setManApelido("");
    setManTelefone("");
    setManEmail("");
    setManObs("");
  }

  function abrirNovo() {
    limparCnpjForm();
    limparManualForm();
    setTab("cnpj");
    setNovoAberto(true);
  }

  async function consultar() {
    if (!user?.id) return;
    const limpo = limparCnpj(cnpjInput);
    if (!validarCnpj(limpo)) {
      setErroCnpj(MSG_CNPJ_INVALIDO);
      return;
    }
    const jaExiste = await existeClienteComCnpj(user.id, limpo);
    if (jaExiste) {
      toast.error(t("toasts.duplicate"));
      return;
    }
    setErroCnpj(null);
    setConsultando(true);
    setResp(null);
    try {
      const r = (await consultarFn({ data: { cnpj: limpo } })) as ConsultaResp;
      setResp(r);
      if (!r.success && r.message) {
        toast.error(friendlyError(r.message, r.message));
      } else if (r.success && r.stale && r.message) {
        toast.warning(r.message);
      }
    } catch (err) {
      console.error("[clientes] erro na consulta:", err);
      toastFromError(err, t("toasts.cnpjError"));
    } finally {
      setConsultando(false);
    }
  }

  async function salvarPorCnpj() {
    if (!user?.id || !resp?.company) return;
    setSalvando(true);
    try {
      const fetchedAt = new Date().toISOString();
      const novo = await salvarClientePorCnpj(user.id, resp.company, resp.source, fetchedAt, {
        apelido: apelidoCnpj,
        telefone: telefoneCnpj,
        email: emailCnpj,
        observacoes: obsCnpj,
      });
      setList((prev) => ordenar([novo, ...prev]));
      toast.success(t("toasts.saved"));
      setNovoAberto(false);
      limparCnpjForm();
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "";
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        toast.error(t("toasts.duplicate"));
      } else {
        toast.error(t("toasts.saveError"));
      }
    } finally {
      setSalvando(false);
    }
  }

  async function salvarManual() {
    if (!user?.id) return;
    const nome = manNome.trim();
    if (nome.length < 2) {
      toast.error(t("toasts.nameRequired"));
      return;
    }
    setSalvando(true);
    try {
      const novo = await salvarClienteManual(user.id, {
        nome,
        apelido: manApelido,
        telefone: manTelefone,
        email: manEmail,
        observacoes: manObs,
      });
      setList((prev) => ordenar([novo, ...prev]));
      toast.success(t("toasts.saved"));
      setNovoAberto(false);
      limparManualForm();
    } catch {
      toast.error(t("toasts.saveError"));
    } finally {
      setSalvando(false);
    }
  }

  function abrirEdicao(c: Cliente) {
    setEditando(c);
    setEditNome(c.nome);
    setEditApelido(c.apelido ?? "");
    setEditTelefone(c.telefone ?? "");
    setEditEmail(c.email ?? "");
    setEditObs(c.observacoes ?? "");
  }

  async function salvarEdicao() {
    if (!editando) return;
    if (editNome.trim().length < 2) {
      toast.error(t("toasts.nameRequired"));
      return;
    }
    setSalvandoEdit(true);
    try {
      const atualizado = await atualizarCliente(editando.id, {
        nome: editNome,
        apelido: editApelido,
        telefone: editTelefone,
        email: editEmail,
        observacoes: editObs,
      });
      setList((prev) => ordenar(prev.map((x) => (x.id === atualizado.id ? atualizado : x))));
      toast.success(t("toasts.updated"));
      setEditando(null);
    } catch {
      toast.error(t("toasts.updateError"));
    } finally {
      setSalvandoEdit(false);
    }
  }

  async function alternarAtivo(c: Cliente) {
    try {
      await alternarAtivoCliente(c.id, !c.ativo);
      setList((prev) => ordenar(prev.map((x) => (x.id === c.id ? { ...x, ativo: !c.ativo } : x))));
      toast.success(c.ativo ? t("toasts.deactivated") : t("toasts.activated"));
    } catch {
      toast.error(t("toasts.toggleError"));
    }
  }

  async function remover() {
    if (!confirmarRemover) return;
    setRemovendo(true);
    try {
      await removerCliente(confirmarRemover.id);
      setList((prev) => prev.filter((x) => x.id !== confirmarRemover.id));
      toast.success(t("toasts.removed"));
      setConfirmarRemover(null);
    } catch {
      toast.error(t("toasts.removeError"));
    } finally {
      setRemovendo(false);
    }
  }

  return (
    <MobileShell>
      <header className="pt-4">
        <Link
          to="/empresa"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("header.back")}
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Contact className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold">{t("header.title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("header.subtitle")}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="outline" className="gap-2">
              <Link to="/clientes/relatorio">
                <BarChart3 className="h-4 w-4" />
                <span className="hidden sm:inline">{t("header.report")}</span>
              </Link>
            </Button>
            <Button onClick={abrirNovo} className="gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t("header.new")}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mt-6 space-y-3">
        {loading ? (
          <>
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </>
        ) : list.length === 0 ? (
          <EmptyState onNovo={abrirNovo} />
        ) : (
          <ul className="space-y-3">
            {list.map((c) => (
              <ClienteItem
                key={c.id}
                c={c}
                onEditar={() => abrirEdicao(c)}
                onAlternar={() => void alternarAtivo(c)}
                onRemover={() => setConfirmarRemover(c)}
              />
            ))}
          </ul>
        )}
      </main>

      {/* Diálogo: novo cliente */}
      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("dialog.newTitle")}</DialogTitle>
            <DialogDescription>{t("dialog.newDesc")}</DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "cnpj" | "manual")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="cnpj">{t("dialog.tabCnpj")}</TabsTrigger>
              <TabsTrigger value="manual">{t("dialog.tabManual")}</TabsTrigger>
            </TabsList>

            <TabsContent value="cnpj" className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="cli-cnpj">{t("dialog.cnpj")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="cli-cnpj"
                    inputMode="numeric"
                    placeholder={t("dialog.cnpjPlaceholder")}
                    value={cnpjInput}
                    onChange={(e) => {
                      setCnpjInput(aplicarMascaraCnpj(e.target.value));
                      if (erroCnpj) setErroCnpj(null);
                    }}
                  />
                  <Button
                    type="button"
                    onClick={() => void consultar()}
                    disabled={!cnpjValido || consultando}
                    className="gap-2"
                  >
                    {consultando ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    {t("dialog.search")}
                  </Button>
                </div>
                {erroCnpj && <p className="text-xs text-destructive">{erroCnpj}</p>}
              </div>

              {resp?.company && (
                <div className="rounded-xl border bg-muted/30 p-3 text-sm">
                  <p className="font-semibold">{resp.company.razaoSocial}</p>
                  {resp.company.nomeFantasia && (
                    <p className="text-muted-foreground">{resp.company.nomeFantasia}</p>
                  )}
                  <p className="mt-1 font-mono text-xs tabular-nums">
                    {resp.company.cnpjFormatado}
                  </p>
                  {resp.company.endereco.municipio && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {resp.company.endereco.municipio}
                      {resp.company.endereco.uf ? `/${resp.company.endereco.uf}` : ""}
                    </p>
                  )}
                  {resp.company.situacaoCadastral && (
                    <Badge variant="secondary" className="mt-2">
                      {resp.company.situacaoCadastral}
                    </Badge>
                  )}

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="cli-apelido" className="text-xs">
                        {t("cnpjFields.apelido")}
                      </Label>
                      <Input
                        id="cli-apelido"
                        value={apelidoCnpj}
                        onChange={(e) => setApelidoCnpj(e.target.value)}
                        placeholder={t("cnpjFields.apelidoPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cli-tel" className="text-xs">
                        {t("cnpjFields.telefone")}
                      </Label>
                      <Input
                        id="cli-tel"
                        value={telefoneCnpj}
                        onChange={(e) => setTelefoneCnpj(e.target.value)}
                        placeholder={t("cnpjFields.telefonePlaceholder")}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor="cli-email" className="text-xs">
                        {t("cnpjFields.email")}
                      </Label>
                      <Input
                        id="cli-email"
                        type="email"
                        value={emailCnpj}
                        onChange={(e) => setEmailCnpj(e.target.value)}
                        placeholder={t("cnpjFields.emailPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor="cli-obs" className="text-xs">
                        {t("cnpjFields.obs")}
                      </Label>
                      <Textarea
                        id="cli-obs"
                        rows={2}
                        value={obsCnpj}
                        onChange={(e) => setObsCnpj(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {resp && !resp.success && resp.message && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <p>{resp.message}</p>
                </div>
              )}

              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="ghost" onClick={() => setNovoAberto(false)} disabled={salvando}>
                  {t("dialog.cancel")}
                </Button>
                <Button
                  onClick={() => void salvarPorCnpj()}
                  disabled={!resp?.company || salvando}
                  className="gap-2"
                >
                  {salvando ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {t("dialog.save")}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="manual" className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="man-nome">{t("manual.nome")}</Label>
                <Input
                  id="man-nome"
                  value={manNome}
                  onChange={(e) => setManNome(e.target.value)}
                  placeholder={t("manual.nomePlaceholder")}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="man-apelido">{t("manual.apelido")}</Label>
                  <Input
                    id="man-apelido"
                    value={manApelido}
                    onChange={(e) => setManApelido(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="man-tel">{t("manual.telefone")}</Label>
                  <Input
                    id="man-tel"
                    value={manTelefone}
                    onChange={(e) => setManTelefone(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="man-email">{t("manual.email")}</Label>
                  <Input
                    id="man-email"
                    type="email"
                    value={manEmail}
                    onChange={(e) => setManEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="man-obs">{t("manual.obs")}</Label>
                  <Textarea
                    id="man-obs"
                    rows={2}
                    value={manObs}
                    onChange={(e) => setManObs(e.target.value)}
                  />
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="ghost" onClick={() => setNovoAberto(false)} disabled={salvando}>
                  {t("dialog.cancel")}
                </Button>
                <Button
                  onClick={() => void salvarManual()}
                  disabled={salvando || manNome.trim().length < 2}
                  className="gap-2"
                >
                  {salvando ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {t("dialog.save")}
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Diálogo: edição */}
      <Dialog
        open={!!editando}
        onOpenChange={(v) => {
          if (!v) setEditando(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("edit.title")}</DialogTitle>
            <DialogDescription>{t("edit.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-nome">{t("edit.nome")}</Label>
              <Input
                id="edit-nome"
                value={editNome}
                onChange={(e) => setEditNome(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-apelido">{t("edit.apelido")}</Label>
                <Input
                  id="edit-apelido"
                  value={editApelido}
                  onChange={(e) => setEditApelido(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-tel">{t("edit.telefone")}</Label>
                <Input
                  id="edit-tel"
                  value={editTelefone}
                  onChange={(e) => setEditTelefone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-email">{t("edit.email")}</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-obs">{t("edit.obs")}</Label>
                <Textarea
                  id="edit-obs"
                  rows={2}
                  value={editObs}
                  onChange={(e) => setEditObs(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setEditando(null)} disabled={salvandoEdit}>
              {t("edit.cancel")}
            </Button>
            <Button onClick={() => void salvarEdicao()} disabled={salvandoEdit}>
              {salvandoEdit ? t("edit.saving") : t("edit.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmarRemover}
        onOpenChange={(v) => {
          if (!v) setConfirmarRemover(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("remove.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("remove.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removendo}>{t("remove.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void remover();
              }}
              disabled={removendo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removendo ? t("remove.removing") : t("remove.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

function ordenar(arr: Cliente[]): Cliente[] {
  return [...arr].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

function EmptyState({ onNovo }: { onNovo: () => void }) {
  const { t } = useTranslation("clientes");
  return (
    <section className="rounded-2xl border border-dashed bg-card/40 p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Building2 className="h-6 w-6" />
      </div>
      <h2 className="mt-3 text-base font-semibold">{t("empty.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("empty.subtitle")}</p>
      <Button onClick={onNovo} className="mt-4 gap-2">
        <Plus className="h-4 w-4" />
        {t("empty.cta")}
      </Button>
    </section>
  );
}

function ClienteItem({
  c,
  onEditar,
  onAlternar,
  onRemover,
}: {
  c: Cliente;
  onEditar: () => void;
  onAlternar: () => void;
  onRemover: () => void;
}) {
  const { t } = useTranslation("clientes");
  const cidadeUf = [c.municipio, c.uf].filter(Boolean).join("/");
  return (
    <li
      className={cn(
        "rounded-2xl border bg-card p-4 shadow-sm transition-opacity",
        !c.ativo && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <BrandLogo
            name={c.apelido || c.nome_fantasia || c.nome || "?"}
            domain={extractDomain(c.email ?? null)}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold">
                {c.apelido || c.nome_fantasia || c.nome}
              </p>
              {!c.ativo && (
                <Badge variant="secondary" className="text-[10px]">
                  {t("card.inactive")}
                </Badge>
              )}
              {c.situacao_cadastral && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    c.situacao_cadastral.toLowerCase().includes("ativ")
                      ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                      : "border-amber-500/40 text-amber-700 dark:text-amber-400",
                  )}
                >
                  {c.situacao_cadastral}
                </Badge>
              )}
            </div>
            {c.apelido && c.nome !== c.apelido && (
              <p className="truncate text-xs text-muted-foreground">{c.nome}</p>
            )}
            {c.cnpj && (
              <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                {formatarCnpj(c.cnpj)}
              </p>
            )}
            {cidadeUf && <p className="mt-0.5 text-xs text-muted-foreground">{cidadeUf}</p>}
            {(c.telefone || c.email) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {c.telefone}
                {c.telefone && c.email ? " · " : ""}
                {c.email}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" onClick={onEditar} aria-label={t("card.editAria")}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onAlternar}
            aria-label={c.ativo ? t("card.deactivate") : t("card.activate")}
          >
            {c.ativo ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onRemover}
            aria-label={t("card.removeAria")}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </li>
  );
}
