import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
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
  Users,
  BarChart3,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import {
  formatarCnpj,
  limparCnpj,
  MSG_CNPJ_INVALIDO,
  validarCnpj,
} from "@/lib/cnpj";
import type { EmpresaConsultada } from "@/lib/empresa";
import {
  alternarAtivoFornecedor,
  atualizarFornecedor,
  existeFornecedorComCnpj,
  listarFornecedores,
  removerFornecedor,
  salvarFornecedorManual,
  salvarFornecedorPorCnpj,
  type Fornecedor,
} from "@/lib/fornecedores";
import { consultarCnpj } from "@/server/cnpj.functions";

export const Route = createFileRoute("/fornecedores")({
  head: () => ({
    meta: [
      { title: "Fornecedores — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Cadastre fornecedores por CNPJ e organize melhor seus gastos empresariais.",
      },
    ],
  }),
  component: FornecedoresPage,
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
  if (d.length <= 12)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function FornecedoresPage() {
  const { user } = useAuth();
  const consultarFn = useServerFn(consultarCnpj);

  const [list, setList] = useState<Fornecedor[]>([]);
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
  const [editando, setEditando] = useState<Fornecedor | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editApelido, setEditApelido] = useState("");
  const [editTelefone, setEditTelefone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editObs, setEditObs] = useState("");
  const [salvandoEdit, setSalvandoEdit] = useState(false);

  // Remover
  const [confirmarRemover, setConfirmarRemover] = useState<Fornecedor | null>(
    null,
  );
  const [removendo, setRemovendo] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelado = false;
    setLoading(true);
    void (async () => {
      try {
        const itens = await listarFornecedores(user.id);
        if (!cancelado) setList(itens);
      } catch {
        if (!cancelado) toast.error("Não conseguimos carregar seus fornecedores.");
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [user?.id]);

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
    // Verifica duplicidade antes de gastar requisição.
    const jaExiste = await existeFornecedorComCnpj(user.id, limpo);
    if (jaExiste) {
      toast.error("Este fornecedor já está cadastrado na sua conta.");
      return;
    }
    setErroCnpj(null);
    setConsultando(true);
    setResp(null);
    try {
      const r = (await consultarFn({ data: { cnpj: limpo } })) as ConsultaResp;
      setResp(r);
      if (!r.success && r.message) {
        toast.error(r.message);
      } else if (r.success && r.stale && r.message) {
        toast.warning(r.message);
      }
    } catch (err) {
      console.error("[fornecedores] erro na consulta:", err);
      toast.error(
        "Não conseguimos consultar este CNPJ agora. Tente novamente em alguns minutos.",
      );
    } finally {
      setConsultando(false);
    }
  }

  async function salvarPorCnpj() {
    if (!user?.id || !resp?.company) return;
    setSalvando(true);
    try {
      const fetchedAt = new Date().toISOString();
      const novo = await salvarFornecedorPorCnpj(
        user.id,
        resp.company,
        resp.source,
        fetchedAt,
        {
          apelido: apelidoCnpj,
          telefone: telefoneCnpj,
          email: emailCnpj,
          observacoes: obsCnpj,
        },
      );
      setList((prev) => ordenar([novo, ...prev]));
      toast.success("Fornecedor cadastrado.");
      setNovoAberto(false);
      limparCnpjForm();
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "";
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        toast.error("Este fornecedor já está cadastrado na sua conta.");
      } else {
        toast.error("Não conseguimos salvar agora. Tente novamente.");
      }
    } finally {
      setSalvando(false);
    }
  }

  async function salvarManual() {
    if (!user?.id) return;
    const nome = manNome.trim();
    if (nome.length < 2) {
      toast.error("Informe o nome do fornecedor.");
      return;
    }
    setSalvando(true);
    try {
      const novo = await salvarFornecedorManual(user.id, {
        nome,
        apelido: manApelido,
        telefone: manTelefone,
        email: manEmail,
        observacoes: manObs,
      });
      setList((prev) => ordenar([novo, ...prev]));
      toast.success("Fornecedor cadastrado.");
      setNovoAberto(false);
      limparManualForm();
    } catch {
      toast.error("Não conseguimos salvar agora. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  function abrirEdicao(f: Fornecedor) {
    setEditando(f);
    setEditNome(f.nome);
    setEditApelido(f.apelido ?? "");
    setEditTelefone(f.telefone ?? "");
    setEditEmail(f.email ?? "");
    setEditObs(f.observacoes ?? "");
  }

  async function salvarEdicao() {
    if (!editando) return;
    if (editNome.trim().length < 2) {
      toast.error("Informe o nome do fornecedor.");
      return;
    }
    setSalvandoEdit(true);
    try {
      const atualizado = await atualizarFornecedor(editando.id, {
        nome: editNome,
        apelido: editApelido,
        telefone: editTelefone,
        email: editEmail,
        observacoes: editObs,
      });
      setList((prev) =>
        ordenar(prev.map((x) => (x.id === atualizado.id ? atualizado : x))),
      );
      toast.success("Fornecedor atualizado.");
      setEditando(null);
    } catch {
      toast.error("Não conseguimos atualizar agora. Tente novamente.");
    } finally {
      setSalvandoEdit(false);
    }
  }

  async function alternarAtivo(f: Fornecedor) {
    try {
      await alternarAtivoFornecedor(f.id, !f.ativo);
      setList((prev) =>
        ordenar(prev.map((x) => (x.id === f.id ? { ...x, ativo: !f.ativo } : x))),
      );
      toast.success(f.ativo ? "Fornecedor desativado." : "Fornecedor ativado.");
    } catch {
      toast.error("Não conseguimos atualizar agora.");
    }
  }

  async function remover() {
    if (!confirmarRemover) return;
    setRemovendo(true);
    try {
      await removerFornecedor(confirmarRemover.id);
      setList((prev) => prev.filter((x) => x.id !== confirmarRemover.id));
      toast.success("Fornecedor removido.");
      setConfirmarRemover(null);
    } catch {
      toast.error("Não conseguimos remover agora.");
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
          Empresa Inteligente
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold">Fornecedores</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Cadastre fornecedores por CNPJ e organize melhor seus gastos
                empresariais.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="outline" className="gap-2">
              <Link to="/fornecedores/relatorio">
                <BarChart3 className="h-4 w-4" />
                <span className="hidden sm:inline">Relatório</span>
              </Link>
            </Button>
            <Button onClick={abrirNovo} className="gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Novo</span>
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
            {list.map((f) => (
              <FornecedorItem
                key={f.id}
                f={f}
                onEditar={() => abrirEdicao(f)}
                onAlternar={() => void alternarAtivo(f)}
                onRemover={() => setConfirmarRemover(f)}
              />
            ))}
          </ul>
        )}
      </main>

      {/* Diálogo: novo fornecedor */}
      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo fornecedor</DialogTitle>
            <DialogDescription>
              Cadastre por CNPJ para preencher os dados automaticamente ou
              adicione manualmente.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "cnpj" | "manual")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="cnpj">Por CNPJ</TabsTrigger>
              <TabsTrigger value="manual">Manualmente</TabsTrigger>
            </TabsList>

            <TabsContent value="cnpj" className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="forn-cnpj">CNPJ</Label>
                <div className="flex gap-2">
                  <Input
                    id="forn-cnpj"
                    inputMode="numeric"
                    placeholder="00.000.000/0000-00"
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
                    Buscar
                  </Button>
                </div>
                {erroCnpj && (
                  <p className="text-xs text-destructive">{erroCnpj}</p>
                )}
              </div>

              {resp?.company && (
                <div className="rounded-xl border bg-muted/30 p-3 text-sm">
                  <p className="font-semibold">{resp.company.razaoSocial}</p>
                  {resp.company.nomeFantasia && (
                    <p className="text-muted-foreground">
                      {resp.company.nomeFantasia}
                    </p>
                  )}
                  <p className="mt-1 font-mono text-xs tabular-nums">
                    {resp.company.cnpjFormatado}
                  </p>
                  {resp.company.endereco.municipio && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {resp.company.endereco.municipio}
                      {resp.company.endereco.uf
                        ? `/${resp.company.endereco.uf}`
                        : ""}
                    </p>
                  )}
                  {resp.company.situacaoCadastral && (
                    <Badge variant="secondary" className="mt-2">
                      {resp.company.situacaoCadastral}
                    </Badge>
                  )}

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="forn-apelido" className="text-xs">
                        Apelido (opcional)
                      </Label>
                      <Input
                        id="forn-apelido"
                        value={apelidoCnpj}
                        onChange={(e) => setApelidoCnpj(e.target.value)}
                        placeholder="Como você chama no dia a dia"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="forn-tel" className="text-xs">
                        Telefone (opcional)
                      </Label>
                      <Input
                        id="forn-tel"
                        value={telefoneCnpj}
                        onChange={(e) => setTelefoneCnpj(e.target.value)}
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor="forn-email" className="text-xs">
                        E-mail (opcional)
                      </Label>
                      <Input
                        id="forn-email"
                        type="email"
                        value={emailCnpj}
                        onChange={(e) => setEmailCnpj(e.target.value)}
                        placeholder="contato@fornecedor.com"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor="forn-obs" className="text-xs">
                        Observações (opcional)
                      </Label>
                      <Textarea
                        id="forn-obs"
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
                <Button
                  variant="ghost"
                  onClick={() => setNovoAberto(false)}
                  disabled={salvando}
                >
                  Cancelar
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
                  Salvar fornecedor
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="manual" className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="man-nome">Nome do fornecedor *</Label>
                <Input
                  id="man-nome"
                  value={manNome}
                  onChange={(e) => setManNome(e.target.value)}
                  placeholder="Ex.: João Eletricista"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="man-apelido">Apelido (opcional)</Label>
                  <Input
                    id="man-apelido"
                    value={manApelido}
                    onChange={(e) => setManApelido(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="man-tel">Telefone (opcional)</Label>
                  <Input
                    id="man-tel"
                    value={manTelefone}
                    onChange={(e) => setManTelefone(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="man-email">E-mail (opcional)</Label>
                  <Input
                    id="man-email"
                    type="email"
                    value={manEmail}
                    onChange={(e) => setManEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="man-obs">Observações (opcional)</Label>
                  <Textarea
                    id="man-obs"
                    rows={2}
                    value={manObs}
                    onChange={(e) => setManObs(e.target.value)}
                  />
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setNovoAberto(false)}
                  disabled={salvando}
                >
                  Cancelar
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
                  Salvar fornecedor
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
            <DialogTitle>Editar fornecedor</DialogTitle>
            <DialogDescription>
              Atualize os dados de contato e observações.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-nome">Nome *</Label>
              <Input
                id="edit-nome"
                value={editNome}
                onChange={(e) => setEditNome(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-apelido">Apelido</Label>
                <Input
                  id="edit-apelido"
                  value={editApelido}
                  onChange={(e) => setEditApelido(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-tel">Telefone</Label>
                <Input
                  id="edit-tel"
                  value={editTelefone}
                  onChange={(e) => setEditTelefone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-email">E-mail</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-obs">Observações</Label>
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
            <Button
              variant="ghost"
              onClick={() => setEditando(null)}
              disabled={salvandoEdit}
            >
              Cancelar
            </Button>
            <Button onClick={() => void salvarEdicao()} disabled={salvandoEdit}>
              {salvandoEdit ? "Salvando…" : "Salvar alterações"}
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
            <AlertDialogTitle>Remover fornecedor?</AlertDialogTitle>
            <AlertDialogDescription>
              Este fornecedor será apagado da sua conta. Essa ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removendo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void remover();
              }}
              disabled={removendo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removendo ? "Removendo…" : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

function ordenar(arr: Fornecedor[]): Fornecedor[] {
  return [...arr].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

function EmptyState({ onNovo }: { onNovo: () => void }) {
  return (
    <section className="rounded-2xl border border-dashed bg-card/40 p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Building2 className="h-6 w-6" />
      </div>
      <h2 className="mt-3 text-base font-semibold">
        Nenhum fornecedor cadastrado
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Comece pelo CNPJ para preencher os dados automaticamente, ou cadastre
        manualmente.
      </p>
      <Button onClick={onNovo} className="mt-4 gap-2">
        <Plus className="h-4 w-4" />
        Cadastrar fornecedor
      </Button>
    </section>
  );
}

function FornecedorItem({
  f,
  onEditar,
  onAlternar,
  onRemover,
}: {
  f: Fornecedor;
  onEditar: () => void;
  onAlternar: () => void;
  onRemover: () => void;
}) {
  const cidadeUf = [f.municipio, f.uf].filter(Boolean).join("/");
  return (
    <li
      className={cn(
        "rounded-2xl border bg-card p-4 shadow-sm transition-opacity",
        !f.ativo && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">
              {f.apelido || f.nome_fantasia || f.nome}
            </p>
            {!f.ativo && (
              <Badge variant="secondary" className="text-[10px]">
                Inativo
              </Badge>
            )}
            {f.situacao_cadastral && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  f.situacao_cadastral.toLowerCase().includes("ativ")
                    ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                    : "border-amber-500/40 text-amber-700 dark:text-amber-400",
                )}
              >
                {f.situacao_cadastral}
              </Badge>
            )}
          </div>
          {f.apelido && f.nome !== f.apelido && (
            <p className="truncate text-xs text-muted-foreground">{f.nome}</p>
          )}
          {f.cnpj && (
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatarCnpj(f.cnpj)}
            </p>
          )}
          {cidadeUf && (
            <p className="mt-0.5 text-xs text-muted-foreground">{cidadeUf}</p>
          )}
          {(f.telefone || f.email) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {f.telefone}
              {f.telefone && f.email ? " · " : ""}
              {f.email}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={onEditar}
            aria-label="Editar"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onAlternar}
            aria-label={f.ativo ? "Desativar" : "Ativar"}
          >
            {f.ativo ? (
              <PowerOff className="h-4 w-4" />
            ) : (
              <Power className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onRemover}
            aria-label="Remover"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </li>
  );
}
