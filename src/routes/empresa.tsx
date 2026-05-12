import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Building2,
  Search,
  RefreshCw,
  Trash2,
  AlertCircle,
  CheckCircle2,
  MapPin,
  Calendar,
  Briefcase,
  ScrollText,
  FileSearch,
  Loader2,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import {
  formatarCnpj,
  limparCnpj,
  MSG_CNPJ_INVALIDO,
  validarCnpj,
} from "@/lib/cnpj";
import {
  atualizarMinhaEmpresa,
  getMinhaEmpresa,
  removerMinhaEmpresa,
  salvarMinhaEmpresa,
  type EmpresaConsultada,
  type MinhaEmpresa,
} from "@/lib/empresa";
import { consultarCnpj } from "@/server/cnpj.functions";

export const Route = createFileRoute("/empresa")({
  head: () => ({
    meta: [
      { title: "Empresa Inteligente — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Consulte seu CNPJ e mantenha os dados da sua empresa organizados no Gasto Inteligente.",
      },
      {
        property: "og:title",
        content: "Empresa Inteligente — Gasto Inteligente",
      },
      {
        property: "og:description",
        content:
          "Para MEI e empresas: cadastre os dados da sua empresa pelo CNPJ.",
      },
    ],
  }),
  component: EmpresaPage,
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

function formatarData(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function rotuloFonte(source: string | null | undefined): string {
  if (!source) return "—";
  if (source === "brasilapi") return "Receita Federal (via BrasilAPI)";
  if (source === "cnpjws") return "Receita Federal (via CNPJ.ws)";
  if (source === "cache") return "Última consulta salva";
  return source;
}

function EmpresaPage() {
  const { user } = useAuth();
  const consultarFn = useServerFn(consultarCnpj);

  const [empresa, setEmpresa] = useState<MinhaEmpresa | null>(null);
  const [loadingEmpresa, setLoadingEmpresa] = useState(true);

  const [cnpjInput, setCnpjInput] = useState("");
  const [erroCampo, setErroCampo] = useState<string | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [resp, setResp] = useState<ConsultaResp | null>(null);
  const [modoAtualizar, setModoAtualizar] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [confirmarRemover, setConfirmarRemover] = useState(false);
  const [removendo, setRemovendo] = useState(false);

  // Carrega empresa salva do usuário.
  useEffect(() => {
    if (!user?.id) return;
    let cancelado = false;
    setLoadingEmpresa(true);
    void (async () => {
      try {
        const e = await getMinhaEmpresa(user.id);
        if (!cancelado) setEmpresa(e);
      } catch {
        if (!cancelado) setEmpresa(null);
      } finally {
        if (!cancelado) setLoadingEmpresa(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [user?.id]);

  const cnpjValido = useMemo(() => validarCnpj(cnpjInput), [cnpjInput]);

  function limparConsulta() {
    setResp(null);
    setModoAtualizar(false);
    setCnpjInput("");
    setErroCampo(null);
  }

  async function consultar(cnpjBruto: string, atualizar = false) {
    const limpo = limparCnpj(cnpjBruto);
    if (!validarCnpj(limpo)) {
      setErroCampo(MSG_CNPJ_INVALIDO);
      return;
    }
    setErroCampo(null);
    setConsultando(true);
    setResp(null);
    setModoAtualizar(atualizar);
    try {
      const r = (await consultarFn({ data: { cnpj: limpo } })) as ConsultaResp;
      setResp(r);
      if (!r.success && r.message) {
        toast.error(r.message);
      } else if (r.success && r.stale && r.message) {
        toast.warning(r.message);
      }
    } catch (err) {
      console.error("[empresa] erro na consulta:", err);
      toast.error(
        "Não conseguimos consultar este CNPJ agora. Tente novamente em alguns minutos.",
      );
      setResp({
        success: false,
        source: null,
        stale: false,
        company: null,
        message:
          "Não conseguimos consultar este CNPJ agora. Tente novamente em alguns minutos.",
      });
    } finally {
      setConsultando(false);
    }
  }

  async function salvar() {
    if (!user?.id || !resp?.company) return;
    setSalvando(true);
    try {
      const fetchedAt = new Date().toISOString();
      if (modoAtualizar && empresa) {
        const atualizada = await atualizarMinhaEmpresa(
          empresa.id,
          resp.company,
          resp.source,
          fetchedAt,
        );
        setEmpresa(atualizada);
        toast.success("Dados da empresa atualizados.");
      } else {
        const nova = await salvarMinhaEmpresa(
          user.id,
          resp.company,
          resp.source,
          fetchedAt,
        );
        setEmpresa(nova);
        toast.success("Empresa salva como sua empresa.");
      }
      limparConsulta();
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "";
      if (msg.includes("user_companies_user_unique")) {
        toast.error("Você já tem uma empresa cadastrada. Use 'Atualizar dados'.");
      } else {
        toast.error("Não conseguimos salvar agora. Tente novamente.");
      }
    } finally {
      setSalvando(false);
    }
  }

  async function remover() {
    if (!empresa) return;
    setRemovendo(true);
    try {
      await removerMinhaEmpresa(empresa.id);
      setEmpresa(null);
      toast.success("Empresa removida.");
    } catch {
      toast.error("Não conseguimos remover agora. Tente novamente.");
    } finally {
      setRemovendo(false);
      setConfirmarRemover(false);
    }
  }

  function alterar() {
    limparConsulta();
    setEmpresa(null);
  }

  function atualizarDoCnpj() {
    if (!empresa) return;
    setCnpjInput(formatarCnpj(empresa.cnpj));
    void consultar(empresa.cnpj, true);
  }

  return (
    <MobileShell>
      <header className="pt-4">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">Empresa Inteligente</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Consulte seu CNPJ e mantenha os dados da sua empresa organizados
              no Gasto Inteligente.
            </p>
          </div>
        </div>
      </header>

      <main className="mt-6 space-y-4">
        {loadingEmpresa ? (
          <div className="rounded-2xl border bg-card p-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-3/4" />
          </div>
        ) : empresa && !resp ? (
          <EmpresaSalvaCard
            empresa={empresa}
            onAtualizar={atualizarDoCnpj}
            onAlterar={alterar}
            onRemover={() => setConfirmarRemover(true)}
            consultando={consultando}
          />
        ) : (
          <BuscaCard
            cnpjInput={cnpjInput}
            onChange={(v) => {
              setCnpjInput(aplicarMascaraCnpj(v));
              if (erroCampo) setErroCampo(null);
            }}
            onBuscar={() => void consultar(cnpjInput, false)}
            consultando={consultando}
            erroCampo={erroCampo}
            podeBuscar={cnpjValido}
            mostrandoPreview={!!resp?.company}
          />
        )}

        {resp && (
          <ResultadoConsulta
            resp={resp}
            modoAtualizar={modoAtualizar}
            salvando={salvando}
            onSalvar={() => void salvar()}
            onBuscarOutro={limparConsulta}
            onCancelar={limparConsulta}
          />
        )}

        <GrupoAtalhos titulo="Cadastro">
          <AtalhoCard
            to="/fornecedores"
            titulo="Fornecedores"
            descricao="Cadastre fornecedores por CNPJ e organize melhor seus gastos empresariais."
            cta="Abrir"
          />
          <AtalhoCard
            to="/clientes"
            titulo="Clientes"
            descricao="Cadastre clientes por CNPJ e prepare seus relatórios de receitas."
            cta="Abrir"
          />
        </GrupoAtalhos>

        <GrupoAtalhos titulo="Relatórios">
          <AtalhoCard
            to="/fornecedores/relatorio"
            titulo="Relatório por fornecedor"
            descricao="Acompanhe quanto você movimenta com cada fornecedor."
            cta="Ver relatório"
          />
          <AtalhoCard
            to="/clientes/relatorio"
            titulo="Relatório por cliente"
            descricao="Veja de quais clientes sua empresa mais recebeu e o que ainda está em aberto."
            cta="Ver relatório"
          />
        </GrupoAtalhos>

        <GrupoAtalhos titulo="Contador">
          <AtalhoCard
            to="/contador"
            titulo="Pacote para Contador"
            descricao="Gere um resumo mensal com receitas, despesas, clientes, fornecedores e pendências."
            cta="Gerar pacote"
          />
        </GrupoAtalhos>

        <section className="rounded-2xl border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Sobre a consulta</p>
          <p className="mt-1">
            Buscamos os dados públicos da empresa diretamente em fontes oficiais
            ligadas à Receita Federal. Nenhum dado é salvo na sua conta sem que
            você confirme.
          </p>
        </section>
      </main>

      <AlertDialog open={confirmarRemover} onOpenChange={setConfirmarRemover}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              Os dados da sua empresa serão apagados do Gasto Inteligente. Você
              pode cadastrar novamente quando quiser.
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

// ============================================================
// Empresa salva
// ============================================================

function EmpresaSalvaCard({
  empresa,
  onAtualizar,
  onAlterar,
  onRemover,
  consultando,
}: {
  empresa: MinhaEmpresa;
  onAtualizar: () => void;
  onAlterar: () => void;
  onRemover: () => void;
  consultando: boolean;
}) {
  const endereco = [
    empresa.logradouro,
    empresa.numero,
    empresa.bairro,
    empresa.municipio && empresa.uf
      ? `${empresa.municipio}/${empresa.uf}`
      : empresa.municipio || empresa.uf,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Minha Empresa
          </h2>
          <p className="mt-1 truncate text-lg font-semibold">
            {empresa.razao_social ?? "—"}
          </p>
          {empresa.nome_fantasia && (
            <p className="truncate text-sm text-muted-foreground">
              {empresa.nome_fantasia}
            </p>
          )}
          <p className="mt-2 font-mono text-sm tabular-nums">
            {formatarCnpj(empresa.cnpj)}
          </p>
        </div>
        {empresa.situacao_cadastral && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
              empresa.situacao_cadastral.toLowerCase().includes("ativ")
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
            )}
          >
            <CheckCircle2 className="h-3 w-3" />
            {empresa.situacao_cadastral}
          </span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <InfoLinha
          icon={<Briefcase className="h-4 w-4" />}
          label="Atividade principal"
          value={
            empresa.cnae_principal_descricao
              ? `${empresa.cnae_principal_descricao}${empresa.cnae_principal_codigo ? ` (CNAE ${empresa.cnae_principal_codigo})` : ""}`
              : "—"
          }
        />
        <InfoLinha
          icon={<MapPin className="h-4 w-4" />}
          label="Endereço"
          value={endereco || "—"}
        />
      </dl>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Última atualização dos dados:{" "}
        {formatarDataHora(empresa.cnpj_cache_fetched_at ?? empresa.updated_at)}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onAtualizar} disabled={consultando} className="gap-2">
          {consultando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Atualizar dados do CNPJ
        </Button>
        <Button onClick={onAlterar} variant="outline" className="gap-2">
          <FileSearch className="h-4 w-4" />
          Alterar empresa
        </Button>
        <Button
          onClick={onRemover}
          variant="ghost"
          className="gap-2 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          Remover empresa
        </Button>
      </div>
    </section>
  );
}

function InfoLinha({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-sm">{value}</p>
      </div>
    </div>
  );
}

// ============================================================
// Card de busca
// ============================================================

function BuscaCard({
  cnpjInput,
  onChange,
  onBuscar,
  consultando,
  erroCampo,
  podeBuscar,
  mostrandoPreview,
}: {
  cnpjInput: string;
  onChange: (v: string) => void;
  onBuscar: () => void;
  consultando: boolean;
  erroCampo: string | null;
  podeBuscar: boolean;
  mostrandoPreview: boolean;
}) {
  if (mostrandoPreview) return null;
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold">Minha Empresa</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Digite seu CNPJ para buscar os dados públicos da empresa
        automaticamente.
      </p>

      <div className="mt-4 space-y-2">
        <Label htmlFor="cnpj-input" className="text-sm">
          CNPJ
        </Label>
        <Input
          id="cnpj-input"
          inputMode="numeric"
          autoComplete="off"
          maxLength={18}
          placeholder="00.000.000/0000-00"
          value={cnpjInput}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && podeBuscar && !consultando) {
              e.preventDefault();
              onBuscar();
            }
          }}
          aria-invalid={!!erroCampo}
          className={cn(erroCampo && "border-destructive focus-visible:ring-destructive")}
        />
        {erroCampo && (
          <p className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            {erroCampo}
          </p>
        )}
      </div>

      <Button
        onClick={onBuscar}
        disabled={!podeBuscar || consultando}
        className="mt-4 w-full gap-2 sm:w-auto"
      >
        {consultando ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Search className="h-4 w-4" />
        )}
        Buscar CNPJ
      </Button>
    </section>
  );
}

// ============================================================
// Resultado da consulta (preview antes de salvar)
// ============================================================

function ResultadoConsulta({
  resp,
  modoAtualizar,
  salvando,
  onSalvar,
  onBuscarOutro,
  onCancelar,
}: {
  resp: ConsultaResp;
  modoAtualizar: boolean;
  salvando: boolean;
  onSalvar: () => void;
  onBuscarOutro: () => void;
  onCancelar: () => void;
}) {
  // Sem empresa e sem cache → erro total.
  if (!resp.company) {
    return (
      <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">
              {resp.message?.includes("inválido")
                ? "CNPJ inválido"
                : resp.message?.includes("encontramos")
                  ? "Empresa não encontrada"
                  : "Não foi possível consultar"}
            </p>
            <p className="mt-1 text-xs text-destructive/80">
              {resp.message ??
                "Não conseguimos consultar este CNPJ agora. Tente novamente em alguns minutos."}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={onCancelar} size="sm" variant="outline">
            Cancelar
          </Button>
        </div>
      </section>
    );
  }

  const c = resp.company;
  const endereco = [
    [c.endereco.logradouro, c.endereco.numero].filter(Boolean).join(", "),
    c.endereco.complemento,
    c.endereco.bairro,
    c.endereco.municipio && c.endereco.uf
      ? `${c.endereco.municipio}/${c.endereco.uf}`
      : c.endereco.municipio || c.endereco.uf,
    c.endereco.cep ? `CEP ${c.endereco.cep}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Dados encontrados</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Confira os dados antes de salvar como sua empresa.
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
            resp.stale
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          )}
        >
          {resp.stale ? (
            <>
              <AlertCircle className="h-3 w-3" />
              Última informação disponível
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3 w-3" />
              {resp.source === "cache" ? "Do cache (atualizado)" : "Atualizado agora"}
            </>
          )}
        </span>
      </div>

      {resp.stale && resp.message && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{resp.message}</span>
        </div>
      )}

      <div className="mt-4 space-y-3 text-sm">
        <InfoBloco label="CNPJ" value={c.cnpjFormatado} mono />
        <InfoBloco label="Razão social" value={c.razaoSocial ?? "—"} />
        {c.nomeFantasia && (
          <InfoBloco label="Nome fantasia" value={c.nomeFantasia} />
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoBloco
            label="Situação cadastral"
            value={c.situacaoCadastral ?? "—"}
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          />
          <InfoBloco
            label="Data de abertura"
            value={formatarData(c.dataAbertura)}
            icon={<Calendar className="h-3.5 w-3.5" />}
          />
          <InfoBloco label="Porte" value={c.porte ?? "—"} />
          <InfoBloco
            label="Natureza jurídica"
            value={c.naturezaJuridica ?? "—"}
            icon={<ScrollText className="h-3.5 w-3.5" />}
          />
        </div>
        <InfoBloco
          label="Atividade principal"
          value={
            c.cnaePrincipalDescricao
              ? `${c.cnaePrincipalDescricao}${c.cnaePrincipalCodigo ? ` (CNAE ${c.cnaePrincipalCodigo})` : ""}`
              : "—"
          }
          icon={<Briefcase className="h-3.5 w-3.5" />}
        />
        <InfoBloco
          label="Endereço"
          value={endereco || "—"}
          icon={<MapPin className="h-3.5 w-3.5" />}
        />
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Fonte: {rotuloFonte(resp.source)}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onSalvar} disabled={salvando} className="gap-2">
          {salvando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {modoAtualizar ? "Atualizar minha empresa" : "Salvar como minha empresa"}
        </Button>
        <Button onClick={onBuscarOutro} variant="outline">
          Buscar outro CNPJ
        </Button>
        <Button onClick={onCancelar} variant="ghost">
          Cancelar
        </Button>
      </div>
    </section>
  );
}

function InfoBloco({
  label,
  value,
  mono,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={cn("mt-0.5", mono && "font-mono tabular-nums")}>{value}</p>
    </div>
  );
}
