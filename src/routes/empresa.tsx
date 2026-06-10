import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { toastFromError, friendlyError } from "@/lib/premium-error";
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
import { consultarCnpj } from "@/lib/cnpj.functions";
import i18n from "@/i18n";

export const Route = createFileRoute("/empresa")({
  head: () => {
    const t = i18n.getFixedT(null, "empresa");
    return {
      meta: [
        { title: t("meta.title") },
        { name: "description", content: t("meta.description") },
        { property: "og:title", content: t("meta.ogTitle") },
        { property: "og:description", content: t("meta.ogDescription") },
      ],
    };
  },
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

function formatarData(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleDateString(locale);
  } catch {
    return "—";
  }
}

function formatarDataHora(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleString(locale, {
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

function EmpresaPage() {
  const { t, i18n: i18nInst } = useTranslation("empresa");
  const localeCode = i18nInst.language?.startsWith("en") ? "en-US" : "pt-BR";
  const { user } = useAuth();
  const consultarFn = useServerFn(consultarCnpj);

  const rotuloFonte = (source: string | null | undefined): string => {
    if (!source) return "—";
    if (source === "brasilapi") return t("sources.brasilapi");
    if (source === "cnpjws") return t("sources.cnpjws");
    if (source === "cache") return t("sources.cache");
    return source;
  };

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
        toast.error(friendlyError(r.message, r.message));
      } else if (r.success && r.stale && r.message) {
        toast.warning(r.message);
      }
    } catch (err) {
      console.error("[empresa] erro na consulta:", err);
      toastFromError(err, t("toasts.consultError"));
      setResp({
        success: false,
        source: null,
        stale: false,
        company: null,
        message: t("toasts.consultError"),
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
        toast.success(t("toasts.updated"));
      } else {
        const nova = await salvarMinhaEmpresa(
          user.id,
          resp.company,
          resp.source,
          fetchedAt,
        );
        setEmpresa(nova);
        toast.success(t("toasts.saved"));
      }
      limparConsulta();
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "";
      if (msg.includes("user_companies_user_unique")) {
        toast.error(t("toasts.duplicate"));
      } else {
        toast.error(t("toasts.saveError"));
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
      toast.success(t("toasts.removed"));
    } catch {
      toast.error(t("toasts.removeError"));
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
            <h1 className="text-2xl font-semibold">{t("header.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("header.subtitle")}
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
            t={t}
            localeCode={localeCode}
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
            t={t}
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
            t={t}
            localeCode={localeCode}
            rotuloFonte={rotuloFonte}
          />
        )}

        <GrupoAtalhos titulo={t("groups.cadastro")}>
          <AtalhoCard
            to="/fornecedores"
            titulo={t("shortcuts.fornecedores.title")}
            descricao={t("shortcuts.fornecedores.desc")}
            cta={t("shortcuts.fornecedores.cta")}
          />
          <AtalhoCard
            to="/clientes"
            titulo={t("shortcuts.clientes.title")}
            descricao={t("shortcuts.clientes.desc")}
            cta={t("shortcuts.clientes.cta")}
          />
        </GrupoAtalhos>

        <GrupoAtalhos titulo={t("groups.relatorios")}>
          <AtalhoCard
            to="/fornecedores/relatorio"
            titulo={t("shortcuts.fornecedoresRelatorio.title")}
            descricao={t("shortcuts.fornecedoresRelatorio.desc")}
            cta={t("shortcuts.fornecedoresRelatorio.cta")}
          />
          <AtalhoCard
            to="/clientes/relatorio"
            titulo={t("shortcuts.clientesRelatorio.title")}
            descricao={t("shortcuts.clientesRelatorio.desc")}
            cta={t("shortcuts.clientesRelatorio.cta")}
          />
        </GrupoAtalhos>

        <GrupoAtalhos titulo={t("groups.contador")}>
          <AtalhoCard
            to="/contador"
            titulo={t("shortcuts.contador.title")}
            descricao={t("shortcuts.contador.desc")}
            cta={t("shortcuts.contador.cta")}
          />
        </GrupoAtalhos>

        <section className="rounded-2xl border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t("about.title")}</p>
          <p className="mt-1">{t("about.body")}</p>
        </section>
      </main>

      <AlertDialog open={confirmarRemover} onOpenChange={setConfirmarRemover}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("remove.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("remove.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removendo}>
              {t("remove.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void remover();
              }}
              disabled={removendo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removendo ? t("remove.loading") : t("remove.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

type TFn = ReturnType<typeof useTranslation>["t"];

function EmpresaSalvaCard({
  empresa,
  onAtualizar,
  onAlterar,
  onRemover,
  consultando,
  t,
  localeCode,
}: {
  empresa: MinhaEmpresa;
  onAtualizar: () => void;
  onAlterar: () => void;
  onRemover: () => void;
  consultando: boolean;
  t: TFn;
  localeCode: string;
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

  const atividade = empresa.cnae_principal_descricao
    ? `${empresa.cnae_principal_descricao}${
        empresa.cnae_principal_codigo
          ? t("saved.cnaeSuffix", { code: empresa.cnae_principal_codigo })
          : ""
      }`
    : "—";

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {t("saved.title")}
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
          label={t("saved.activity")}
          value={atividade}
        />
        <InfoLinha
          icon={<MapPin className="h-4 w-4" />}
          label={t("saved.address")}
          value={endereco || "—"}
        />
      </dl>

      <p className="mt-4 text-[11px] text-muted-foreground">
        {t("saved.lastUpdate", {
          when: formatarDataHora(
            empresa.cnpj_cache_fetched_at ?? empresa.updated_at,
            localeCode,
          ),
        })}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onAtualizar} disabled={consultando} className="gap-2">
          {consultando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("saved.actions.update")}
        </Button>
        <Button onClick={onAlterar} variant="outline" className="gap-2">
          <FileSearch className="h-4 w-4" />
          {t("saved.actions.change")}
        </Button>
        <Button
          onClick={onRemover}
          variant="ghost"
          className="gap-2 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          {t("saved.actions.remove")}
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

function BuscaCard({
  cnpjInput,
  onChange,
  onBuscar,
  consultando,
  erroCampo,
  podeBuscar,
  mostrandoPreview,
  t,
}: {
  cnpjInput: string;
  onChange: (v: string) => void;
  onBuscar: () => void;
  consultando: boolean;
  erroCampo: string | null;
  podeBuscar: boolean;
  mostrandoPreview: boolean;
  t: TFn;
}) {
  if (mostrandoPreview) return null;
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold">{t("search.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("search.subtitle")}</p>

      <div className="mt-4 space-y-2">
        <Label htmlFor="cnpj-input" className="text-sm">
          {t("search.label")}
        </Label>
        <Input
          id="cnpj-input"
          inputMode="numeric"
          autoComplete="off"
          maxLength={18}
          placeholder={t("search.placeholder")}
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
        {t("search.submit")}
      </Button>
    </section>
  );
}

function ResultadoConsulta({
  resp,
  modoAtualizar,
  salvando,
  onSalvar,
  onBuscarOutro,
  onCancelar,
  t,
  localeCode,
  rotuloFonte,
}: {
  resp: ConsultaResp;
  modoAtualizar: boolean;
  salvando: boolean;
  onSalvar: () => void;
  onBuscarOutro: () => void;
  onCancelar: () => void;
  t: TFn;
  localeCode: string;
  rotuloFonte: (source: string | null | undefined) => string;
}) {
  if (!resp.company) {
    const msg = resp.message ?? "";
    const heading = msg.includes("inválido") || msg.toLowerCase().includes("invalid")
      ? t("result.errors.invalid")
      : msg.includes("encontramos") || msg.toLowerCase().includes("not found")
        ? t("result.errors.notFound")
        : t("result.errors.generic");
    return (
      <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">{heading}</p>
            <p className="mt-1 text-xs text-destructive/80">
              {resp.message ?? t("result.errors.fallback")}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={onCancelar} size="sm" variant="outline">
            {t("result.cancel")}
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
    c.endereco.cep ? t("result.fields.cep", { cep: c.endereco.cep }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const atividade = c.cnaePrincipalDescricao
    ? `${c.cnaePrincipalDescricao}${
        c.cnaePrincipalCodigo
          ? t("saved.cnaeSuffix", { code: c.cnaePrincipalCodigo })
          : ""
      }`
    : "—";

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t("result.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("result.subtitle")}
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
              {t("result.badgeStale")}
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3 w-3" />
              {resp.source === "cache"
                ? t("result.badgeCache")
                : t("result.badgeFresh")}
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
        <InfoBloco label={t("result.fields.cnpj")} value={c.cnpjFormatado} mono />
        <InfoBloco label={t("result.fields.razaoSocial")} value={c.razaoSocial ?? "—"} />
        {c.nomeFantasia && (
          <InfoBloco label={t("result.fields.nomeFantasia")} value={c.nomeFantasia} />
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoBloco
            label={t("result.fields.situacao")}
            value={c.situacaoCadastral ?? "—"}
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          />
          <InfoBloco
            label={t("result.fields.abertura")}
            value={formatarData(c.dataAbertura, localeCode)}
            icon={<Calendar className="h-3.5 w-3.5" />}
          />
          <InfoBloco label={t("result.fields.porte")} value={c.porte ?? "—"} />
          <InfoBloco
            label={t("result.fields.natureza")}
            value={c.naturezaJuridica ?? "—"}
            icon={<ScrollText className="h-3.5 w-3.5" />}
          />
        </div>
        <InfoBloco
          label={t("result.fields.atividade")}
          value={atividade}
          icon={<Briefcase className="h-3.5 w-3.5" />}
        />
        <InfoBloco
          label={t("result.fields.endereco")}
          value={endereco || "—"}
          icon={<MapPin className="h-3.5 w-3.5" />}
        />
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        {t("result.source", { source: rotuloFonte(resp.source) })}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onSalvar} disabled={salvando} className="gap-2">
          {salvando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {modoAtualizar
            ? t("result.updateCompany")
            : t("result.saveAsCompany")}
        </Button>
        <Button onClick={onBuscarOutro} variant="outline">
          {t("result.searchOther")}
        </Button>
        <Button onClick={onCancelar} variant="ghost">
          {t("result.cancel")}
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

function GrupoAtalhos({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function AtalhoCard({
  to,
  titulo,
  descricao,
  cta,
}: {
  to: string;
  titulo: string;
  descricao: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      className="flex h-full flex-col justify-between gap-2 rounded-2xl border bg-card p-4 transition-colors hover:bg-accent/40"
    >
      <div>
        <p className="text-sm font-semibold">{titulo}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>
      </div>
      <span className="text-xs font-medium text-primary">{cta} →</span>
    </Link>
  );
}
