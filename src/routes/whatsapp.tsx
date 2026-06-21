import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { isAdminMasterEmail } from "@/lib/plans";
import {
  ArrowLeft,
  Copy,
  Check,
  MessageCircle,
  Plus,
  Trash2,
  Send,
  Shield,
  AlertTriangle,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { confirmAsync } from "@/components/ConfirmDialog";
import { toastFromError } from "@/lib/premium-error";
import { refreshGastos } from "@/lib/store";
import { ExternalLink } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getWhatsAppConfigStatus, upsertWhatsAppLink, deleteWhatsAppLink, confirmWhatsAppLinkConsent } from "@/lib/whatsapp.functions";
import {
  whatsappAdminCheckRegistration,
  whatsappAdminGetOpsChecklist,
  whatsappAdminCheckCanaryReadiness,
  whatsappAdminAuditRealRegistrationState,
  whatsappAdminClassifyRegisterStrategy,
  whatsappAdminRegisterNumber,
  whatsappAdminCheckCategoriaResolution,
} from "@/lib/whatsapp-admin.functions";

import { parseWhatsAppExpenseMessage } from "@/lib/whatsappParser";
import { suggestCategoryFromText, DEFAULT_CATEGORIES } from "@/lib/categories";
import { FORMAS_PAGAMENTO } from "@/lib/types";
import {
  getOfficialWhatsAppNumber,
  formatWhatsAppNumberShort,
  getOfficialWhatsAppDeepLink,
} from "@/lib/whatsapp-config";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { supabase as _supabase } from "@/integrations/supabase/client";
// As tabelas whatsapp_* foram criadas após a regeneração de tipos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = _supabase as any;

export const Route = createFileRoute("/whatsapp")({
  head: () => ({
    meta: [
      { title: "Gastos via WhatsApp — Gasto Inteligente" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: WhatsAppPageGuarded,
});

function WhatsAppPageGuarded() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <MobileShell>
        <div className="py-10 text-center text-sm text-muted-foreground">Carregando…</div>
      </MobileShell>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  // O bloqueio por plano (feature "whatsapp") é feito pelo AuthGate.
  // Aqui apenas garantimos que o usuário esteja logado.
  return <WhatsAppPage />;
}

type Link = {
  id: string;
  telefone: string;
  ativo: boolean;
  ultimo_uso: string | null;
  created_at: string;
  opt_in_em: string | null;
  opt_in_version: string | null;
  revogado_em: string | null;
};

type Message = {
  id: string;
  telefone: string;
  texto: string;
  status: string;
  gasto_id: string | null;
  confianca: number | null;
  recebida_em: string;
  resposta_sugerida: string | null;
  erro: string | null;
};

function maskTel(t: string) {
  const d = t.replace(/\D/g, "");
  if (d.length <= 4) return "***";
  return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ****-${d.slice(-4)}`;
}

const STATUS_STYLES: Record<string, string> = {
  salva: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
  aguardando_confirmacao: "border-indigo-500/40 text-indigo-300 bg-indigo-500/10",
  cancelada: "border-zinc-500/40 text-zinc-400 bg-zinc-500/10",
  sem_pendencia: "border-zinc-500/40 text-zinc-400 bg-zinc-500/10",
  pendente: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  duplicada: "border-sky-500/40 text-sky-400 bg-sky-500/10",
  sem_vinculo: "border-rose-500/40 text-rose-400 bg-rose-500/10",
  sem_consentimento: "border-rose-500/40 text-rose-400 bg-rose-500/10",
  sem_plano: "border-rose-500/40 text-rose-400 bg-rose-500/10",
  erro: "border-rose-500/40 text-rose-400 bg-rose-500/10",
  valor_invalido: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  recebida: "border-border text-muted-foreground bg-card",
  gasto_excluido: "border-zinc-500/40 text-zinc-400 bg-zinc-500/10",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status] ?? STATUS_STYLES.recebida}>
      {status}
    </Badge>
  );
}

/**
 * Normaliza telefone brasileiro para o formato E.164 sem o +.
 * Aceita variações como "(11) 99999-8888", "11999998888", "5511999998888".
 * - Garante prefixo 55 (Brasil).
 * - Garante o nono dígito (celular) quando faltar.
 */
function normTel(raw: string): string {
  let d = raw.replace(/\D/g, "");
  // Remove zeros à esquerda
  d = d.replace(/^0+/, "");
  // Já vem com 55
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    if (d.length === 12) {
      // 55 + DDD(2) + 8 dígitos -> insere 9
      d = `${d.slice(0, 4)}9${d.slice(4)}`;
    }
    return d;
  }
  // 10 dígitos: DDD + 8 -> adiciona 55 e 9
  if (d.length === 10) return `55${d.slice(0, 2)}9${d.slice(2)}`;
  // 11 dígitos: DDD + 9 dígitos
  if (d.length === 11) return `55${d}`;
  return d;
}

/** Código de ativação determinístico baseado no id do vínculo. */
function activationCode(linkId: string): string {
  let h = 0;
  for (let i = 0; i < linkId.length; i++) h = (h * 31 + linkId.charCodeAt(i)) >>> 0;
  const num = (h % 900000) + 100000;
  return `ATIVAR ${num}`;
}

// Número oficial do WhatsApp do Gasto Inteligente (canal de lançamento de
// gastos, NÃO de suporte). Lido do helper centralizado.
const WHATSAPP_NUMERO_OFICIAL = getOfficialWhatsAppNumber();
const WHATSAPP_NUMERO_OFICIAL_DISPLAY = formatWhatsAppNumberShort();
const WHATSAPP_DEEPLINK = getOfficialWhatsAppDeepLink();
// "Modo teste" agora depende apenas da ativação do webhook real (controlada
// pelo backend via WHATSAPP_ENABLED + secrets). Como esta tela é client-side,
// mantemos o flag visual amarrado à presença do número oficial.
const MODO_TESTE = WHATSAPP_NUMERO_OFICIAL.trim().length === 0;

function WhatsAppPage() {
  const { user } = useAuth();
  const isAdmin = isAdminMasterEmail(user?.email);

  const [links, setLinks] = useState<Link[]>([]);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [novoTel, setNovoTel] = useState("");
  const [adding, setAdding] = useState(false);
  const [aceitouOptIn, setAceitouOptIn] = useState(false);
  const [testTexto, setTestTexto] = useState(
    "gastei R$ 48,90 no mercado hoje no Nubank",
  );
  const [testando, setTestando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const upsertLinkFn = useServerFn(upsertWhatsAppLink);
  const deleteLinkFn = useServerFn(deleteWhatsAppLink);

  // URL pública estável usada na configuração do painel da Meta.
  // Sempre o domínio publicado, nunca preview/localhost.
  const PUBLIC_WEBHOOK_URL =
    "https://gastointeligente.com.br/api/public/whatsapp/expense";
  // Verify Token NÃO vive no frontend. Configure-o em Secrets (WHATSAPP_VERIFY_TOKEN)
  // e use o mesmo valor no painel da Meta. Nunca exibido na UI nem retornado por server fn.

  const webhookUrl = useMemo(() => {
    // Em ambiente de preview, usamos a origem atual para teste local;
    // mas a URL exibida para colar na Meta é sempre a pública.
    if (typeof window === "undefined") return PUBLIC_WEBHOOK_URL;
    const origin = window.location.origin;
    if (origin.includes("lovable.app") && origin.includes("preview")) {
      return PUBLIC_WEBHOOK_URL;
    }
    return `${origin}/api/public/whatsapp/expense`;
  }, []);

  async function copyToClipboardSafe(value: string): Promise<boolean> {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // fallthrough to legacy method
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  // Status dos secrets do WhatsApp (apenas booleans, nunca os valores).
  const fetchConfigStatus = useServerFn(getWhatsAppConfigStatus);

  // ===== WA-D — Preflight read-only (controle TEMPORÁRIO; remover após WA-D) =====
  const runPreflightFn = useServerFn(whatsappAdminCheckRegistration);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightResult, setPreflightResult] = useState<{
    token_para_waba: "ok" | "falhou";
    numero_oficial_na_waba: "ok" | "falhou";
    app_inscrito_na_waba: "ok" | "falhou";
    webhook_handshake: "ok" | "falhou";
    numero_ja_registrado: "sim" | "nao" | "desconhecido";
    pronto_para_register: "sim" | "nao";
    access_token_lido_pelo_backend: "sim" | "nao";
    access_token_hash_prefix: string;
    meta_token_http_status: number | string;
    meta_waba_http_status: number | string;
    meta_phone_http_status: number | string;
    meta_subscribed_apps_http_status: number | string;
    meta_error_code: number | null;
    meta_error_subcode: number | null;
    erro_categoria: string;
  } | null>(null);
  async function executarPreflight() {
    setPreflightLoading(true);
    try {
      const r = await runPreflightFn();
      setPreflightResult({
        token_para_waba: r.token_para_waba,
        numero_oficial_na_waba: r.numero_oficial_na_waba,
        app_inscrito_na_waba: r.app_inscrito_na_waba,
        webhook_handshake: r.webhook_handshake,
        numero_ja_registrado: r.numero_ja_registrado,
        pronto_para_register: r.pronto_para_register,
        access_token_lido_pelo_backend: r.access_token_lido_pelo_backend,
        access_token_hash_prefix: r.access_token_hash_prefix,
        meta_token_http_status: r.meta_token_http_status,
        meta_waba_http_status: r.meta_waba_http_status,
        meta_phone_http_status: r.meta_phone_http_status,
        meta_subscribed_apps_http_status: r.meta_subscribed_apps_http_status,
        meta_error_code: r.meta_error_code,
        meta_error_subcode: r.meta_error_subcode,
        erro_categoria: r.erro_categoria,
      });
    } catch {
      toast.error("Falha ao executar preflight.");
    } finally {
      setPreflightLoading(false);
    }
  }

  // ===== WA-E1 — Checklist operacional Admin Master =====
  const opsChecklistFn = useServerFn(whatsappAdminGetOpsChecklist);
  const [opsChecklist, setOpsChecklist] = useState<{
    numero_registrado: "ok" | "falhou";
    app_inscrito_na_waba: "ok" | "falhou";
    webhook_configurado: "ok" | "falhou";
    modo_canario_preparado: "ok" | "falhou";
    modo_canario_ativo: "sim" | "nao";
    processamento_real_ativo: "sim" | "nao";
  } | null>(null);
  const [opsChecklistLoading, setOpsChecklistLoading] = useState(false);
  async function carregarOpsChecklist() {
    setOpsChecklistLoading(true);
    try {
      const r = await opsChecklistFn();
      setOpsChecklist(r);
    } catch {
      toast.error("Falha ao carregar checklist.");
    } finally {
      setOpsChecklistLoading(false);
    }
  }

  // ===== WA-E1.1 — Prontidão canário do Admin Master =====
  const canaryReadinessFn = useServerFn(whatsappAdminCheckCanaryReadiness);
  const [canaryReadiness, setCanaryReadiness] = useState<{
    admin_canary_phone_ready: "ok" | "falhou";
    admin_link_ativo: "ok" | "falhou";
    admin_opt_in_valido: "ok" | "falhou";
    admin_email_autorizado: "ok" | "falhou";
  } | null>(null);
  const [canaryReadinessLoading, setCanaryReadinessLoading] = useState(false);
  async function carregarCanaryReadiness() {
    setCanaryReadinessLoading(true);
    try {
      const r = await canaryReadinessFn();
      setCanaryReadiness(r);
    } finally {
      setCanaryReadinessLoading(false);
    }
  }

  // ===== WA-Cat — Diagnóstico de resolução de categoria (temporário) =====
  const categoriaCheckFn = useServerFn(whatsappAdminCheckCategoriaResolution);
  const [categoriaCheck, setCategoriaCheck] = useState<{
    categoria_alimentacao_disponivel: "sim" | "nao";
    categoria_resolvida_para_padaria: "alimentacao" | "fallback_mercado" | "outra";
  } | null>(null);
  const [categoriaCheckLoading, setCategoriaCheckLoading] = useState(false);
  async function carregarCategoriaCheck() {
    setCategoriaCheckLoading(true);
    try {
      const r = await categoriaCheckFn();
      setCategoriaCheck(r);
    } catch {
      toast.error("Falha ao verificar resolução de categoria.");
    } finally {
      setCategoriaCheckLoading(false);
    }
  }

  // ===== WA-E2.audit — Auditoria read-only do estado real do número =====
  const auditRealStateFn = useServerFn(whatsappAdminAuditRealRegistrationState);
  const [auditRealState, setAuditRealState] = useState<{
    numero_meta_encontrado: "sim" | "nao";
    numero_verificado_na_meta: "sim" | "nao" | "desconhecido";
    numero_registrado_cloud_api: "sim" | "nao" | "desconhecido";
    numero_apto_para_conversa_whatsapp: "sim" | "nao" | "desconhecido";
    plataforma_do_numero: "cloud_api" | "outro" | "desconhecido";
    status_de_registro_confiavel: "sim" | "nao";
    acao_recomendada: "registrar_cloud_api" | "migrar_para_cloud_api" | "revisar_meta" | "aguardar" | "nenhuma";
    tipo_plataforma_meta: "cloud_api" | "on_premise" | "coexistence" | "nao_informado" | "outro";
    status_numero_meta: "connected" | "disconnected" | "pendente" | "nao_informado" | "outro";
    verificacao_numero_meta: "verificado" | "nao_verificado" | "desconhecido";
    nome_exibicao_meta: "aprovado" | "pendente" | "reprovado" | "desconhecido";
    id_do_erro_meta_corresponde_ao_phone_number_id_atual: "sim" | "nao";
    phone_number_id_atual_esta_na_waba_oficial: "sim" | "nao";
  } | null>(null);
  const [auditRealStateLoading, setAuditRealStateLoading] = useState(false);
  async function auditarStatusRealDoNumero() {
    setAuditRealStateLoading(true);
    try {
      const r = await auditRealStateFn();
      setAuditRealState(r);
    } catch {
      toast.error("Falha ao auditar status real do número.");
    } finally {
      setAuditRealStateLoading(false);
    }
  }

  // ===== WA-E2.register — Estratégia + execução do POST /register =====
  const classifyStrategyFn = useServerFn(whatsappAdminClassifyRegisterStrategy);
  const registerNumberFn = useServerFn(whatsappAdminRegisterNumber);
  const [registerStrategy, setRegisterStrategy] = useState<
    "registro_direto_cloud_api" | "migracao_manual_necessaria" | "estado_desconhecido" | null
  >(null);
  const [registerStrategyLoading, setRegisterStrategyLoading] = useState(false);
  const [registerConfirm1, setRegisterConfirm1] = useState("");
  const [registerConfirm2, setRegisterConfirm2] = useState("");
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerResult, setRegisterResult] = useState<{
    registro_cloud_api_executado: "sim" | "nao";
    registro_http_status: 200 | "outro";
    meta_error_code: number | null;
    meta_error_subcode: number | null;
    numero_registrado_cloud_api: "sim" | "nao" | "desconhecido";
    numero_apto_para_conversa_whatsapp: "sim" | "nao" | "desconhecido";
    tipo_plataforma_meta:
      | "cloud_api"
      | "on_premise"
      | "coexistence"
      | "nao_informado"
      | "outro";
    status_numero_meta:
      | "connected"
      | "disconnected"
      | "pendente"
      | "nao_informado"
      | "outro";
    acao_recomendada:
      | "nenhuma"
      | "revisar_meta"
      | "migrar_para_cloud_api"
      | "aguardar"
      | "registrar_cloud_api";
  } | null>(null);

  async function classificarEstrategiaRegistro() {
    setRegisterStrategyLoading(true);
    try {
      const r = await classifyStrategyFn();
      setRegisterStrategy(r.estrategia_registro);
    } catch {
      toast.error("Falha ao classificar estratégia.");
    } finally {
      setRegisterStrategyLoading(false);
    }
  }

  async function executarRegistroCloudApi() {
    if (registerConfirm1 !== "REGISTRAR-CLOUD-API" || registerConfirm2 !== "11918539158") {
      toast.error("Confirmações não conferem.");
      return;
    }
    setRegisterLoading(true);
    try {
      const r = await registerNumberFn({
        data: { confirm1: "REGISTRAR-CLOUD-API", confirm2: "11918539158" },
      });
      setRegisterResult({
        registro_cloud_api_executado: r.registro_cloud_api_executado,
        registro_http_status: r.registro_http_status,
        meta_error_code: r.meta_error_code,
        meta_error_subcode: r.meta_error_subcode,
        numero_registrado_cloud_api: r.numero_registrado_cloud_api,
        numero_apto_para_conversa_whatsapp: r.numero_apto_para_conversa_whatsapp,
        tipo_plataforma_meta: r.tipo_plataforma_meta,
        status_numero_meta: r.status_numero_meta,
        acao_recomendada: r.acao_recomendada,
      });
      if (r.ok) toast.success("Registro Cloud API executado.");
      else toast.error("Registro não autorizado ou rejeitado pela Meta.");
    } catch {
      toast.error("Falha ao executar registro.");
    } finally {
      setRegisterLoading(false);
      setRegisterConfirm1("");
      setRegisterConfirm2("");
    }
  }

  // ===== Re-confirmação de consentimento LGPD (vínculo existente) =====
  const confirmConsentFn = useServerFn(confirmWhatsAppLinkConsent);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentResult, setConsentResult] = useState<"ok" | "falhou" | null>(null);
  async function confirmarConsentimento() {
    if (!consentChecked) {
      toast.error("Marque o consentimento antes de confirmar.");
      return;
    }
    setConsentLoading(true);
    try {
      const r = await confirmConsentFn({
        data: {
          aceitou: true,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : undefined,
        },
      });
      setConsentResult(r.consentimento_atualizado);
      if (r.consentimento_atualizado === "ok") {
        toast.success("Consentimento atualizado.");
        await refresh();
      } else {
        toast.error("Não foi possível atualizar o consentimento.");
      }
    } catch {
      setConsentResult("falhou");
      toast.error("Falha ao atualizar consentimento.");
    } finally {
      setConsentLoading(false);
    }
  }
  const [configStatus, setConfigStatus] = useState<{
    access_token: boolean;
    phone_number_id: boolean;
    business_account_id: boolean;
    verify_token: boolean;
    enabled: boolean;
    canary_enabled: boolean;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    fetchConfigStatus()
      .then((s) => {
        if (alive) setConfigStatus(s);
      })
      .catch(() => {
        if (alive) setConfigStatus(null);
      });
    return () => {
      alive = false;
    };
  }, [fetchConfigStatus]);

  async function refresh() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLinks([]);
        setMsgs([]);
        return;
      }
      const [linksRes, msgsRes] = await Promise.all([
        supabase
          .from("whatsapp_links")
          .select("id, telefone, ativo, ultimo_uso, created_at, opt_in_em, opt_in_version, revogado_em")
          .order("created_at", { ascending: false }),
        supabase
          .from("whatsapp_messages")
          .select(
            "id, telefone, texto, status, gasto_id, confianca, recebida_em, resposta_sugerida, erro",
          )
          .order("recebida_em", { ascending: false })
          .limit(50),
      ]);
      if (linksRes.error) throw new Error(linksRes.error.message);
      if (msgsRes.error) throw new Error(msgsRes.error.message);
      setLinks((linksRes.data ?? []) as Link[]);
      setMsgs((msgsRes.data ?? []) as Message[]);
    } catch (e) {
      toastFromError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function adicionar() {
    if (!novoTel.trim()) return;
    if (!aceitouOptIn) {
      toast.error(
        "Para usar o lançamento por WhatsApp, você precisa aceitar o consentimento de uso desse canal.",
      );
      return;
    }
    const tel = normTel(novoTel);
    if (tel.length < 8) {
      toast.error("Telefone inválido");
      return;
    }
    setAdding(true);
    try {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : undefined;
      await upsertLinkFn({
        data: {
          telefone: tel,
          ativo: true,
          aceitou_opt_in: true,
          user_agent: ua,
        },
      });
      toast.success("Número vinculado com consentimento registrado.");
      setNovoTel("");
      setAceitouOptIn(false);
      await refresh();
    } catch (e) {
      toastFromError(e);
    } finally {
      setAdding(false);
    }
  }

  async function excluir(id: string) {
    if (
      !(await confirmAsync({
        title: "Desvincular WhatsApp",
        description:
          "Você está revogando o consentimento de uso do WhatsApp. Mensagens enviadas a partir desse número deixarão de criar gastos. Tem certeza?",
        confirmText: "Desvincular e revogar",
      }))
    )
      return;
    try {
      await deleteLinkFn({ data: { id } });
      toast.success("Consentimento revogado. Número desvinculado.");
      await refresh();
    } catch (e) {
      toastFromError(e);
    }
  }

  async function testarWebhook() {
    if (links.length === 0) {
      toast.error("Vincule pelo menos um número primeiro");
      return;
    }
    setTestando(true);
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone: links[0].telefone,
          texto: testTexto,
          external_id: `test-${Date.now()}`,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error ?? "Falha no teste");
      const first = out.results?.[0];
      const status = first?.status ?? "ok";
      if (status === "salva" && first?.gasto_id) {
        toast.success(`Gasto salvo (id ${String(first.gasto_id).slice(0, 8)})`);
      } else {
        toast.success(`Status: ${status}`);
      }
      // Invalida cache de gastos para que /gastos e dashboard reflitam o novo registro.
      await Promise.all([refresh(), refreshGastos()]);
    } catch (e) {
      toastFromError(e);
    } finally {
      setTestando(false);
    }
  }

  async function copiarUrl() {
    const ok = await copyToClipboardSafe(webhookUrl);
    if (ok) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } else {
      toast.error("Não foi possível copiar. Selecione manualmente.");
    }
  }

  const [limpando, setLimpando] = useState(false);
  async function limparDuplicados() {
    if (!(await confirmAsync({ title: "Remover duplicados", description: "Manter apenas o gasto mais antigo de cada grupo de duplicados criados via WhatsApp?", confirmText: "Manter o mais antigo" }))) return;
    setLimpando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada");
      const { data, error } = await supabase
        .from("gastos")
        .select("id, descricao, valor, data, cartao_id, created_at")
        .eq("user_id", user.id)
        .eq("origem", "whatsapp")
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      const buckets = new Map<string, string[]>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const g of (data as any[]) ?? []) {
        const key = [
          (g.descricao ?? "").toLowerCase().trim(),
          Number(g.valor).toFixed(2),
          g.data,
          g.cartao_id ?? "",
        ].join("|");
        const arr = buckets.get(key) ?? [];
        arr.push(g.id);
        buckets.set(key, arr);
      }
      const idsParaApagar: string[] = [];
      for (const ids of buckets.values()) {
        if (ids.length > 1) idsParaApagar.push(...ids.slice(1)); // mantém o 1º (mais antigo)
      }
      if (idsParaApagar.length === 0) {
        toast.info("Nenhum duplicado encontrado.");
        return;
      }
      // Desvincular as whatsapp_messages que apontavam para os ids apagados
      await supabase
        .from("whatsapp_messages")
        .update({ gasto_id: null })
        .in("gasto_id", idsParaApagar);
      const { error: delErr } = await supabase
        .from("gastos")
        .delete()
        .in("id", idsParaApagar);
      if (delErr) throw new Error(delErr.message);
      toast.success(`${idsParaApagar.length} duplicado(s) removido(s).`);
      await Promise.all([refresh(), refreshGastos()]);
    } catch (e) {
      toastFromError(e);
    } finally {
      setLimpando(false);
    }
  }

  // Status global da integração (linguagem amigável para o usuário final).
  // Enquanto o processamento real estiver desligado no backend
  // (WHATSAPP_ENABLED !== "true"), nunca mostrar "Ativo".
  const ultimaMsg = msgs[0];
  const processamentoRealAtivo = configStatus?.enabled === true;
  const integracaoStatus = MODO_TESTE
    ? { label: "Em configuração", cls: "border-amber-500/40 text-amber-300" }
    : !processamentoRealAtivo
      ? {
          label: "Configurado — teste de mensagens ainda desativado",
          cls: "border-amber-500/40 text-amber-300",
        }
      : links.length === 0
        ? { label: "Não configurado", cls: "border-border text-muted-foreground" }
        : ultimaMsg
          ? { label: "Ativo", cls: "border-emerald-500/40 text-emerald-400" }
          : { label: "Aguardando primeira mensagem", cls: "border-sky-500/40 text-sky-400" };

  return (
    <MobileShell>
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* Header */}
        <header className="flex items-start gap-3">
          <Link
            to="/adicionar"
            className="grid h-9 w-9 place-items-center rounded-full bg-card border border-border hover:bg-card-elevated mt-0.5"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400">
                <MessageCircle className="h-4 w-4" />
              </span>
              <h1 className="text-xl font-semibold">Lance gastos pelo WhatsApp</h1>
              {MODO_TESTE && (
                <Badge variant="outline" className="border-amber-500/40 text-amber-300 bg-amber-500/10 text-[10px] uppercase tracking-wide">
                  Modo teste
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1.5">
              Envie uma mensagem simples e o Gasto Inteligente identifica valor, categoria,
              data e forma de pagamento para você confirmar antes de salvar.
            </p>
          </div>
          <Button variant="outline" size="icon" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </header>

        {/* Número oficial — canal de lançamento de gastos (NÃO é suporte) */}
        {!MODO_TESTE && (
          <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400">
                <MessageCircle className="h-5 w-5" />
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-emerald-300">
                  Número oficial para enviar gastos
                </h2>
                <p className="text-lg font-semibold mt-0.5 num tracking-wide">
                  {WHATSAPP_NUMERO_OFICIAL_DISPLAY}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Depois de vincular seu WhatsApp à sua conta, envie mensagens como:
                  <span className="block mt-1 font-mono text-foreground/90">
                    “Mercado 45,90” · “Uber 32,50 transporte” · “Almoço 28”
                  </span>
                </p>
              </div>
            </div>
            <a
              href={WHATSAPP_DEEPLINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              <MessageCircle className="h-4 w-4" />
              Abrir conversa para enviar gasto
              <ExternalLink className="h-3.5 w-3.5 opacity-80" />
            </a>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-200 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-300" />
              <p>
                Esse WhatsApp é exclusivo para lançamento de gastos. Ele
                <strong> não é canal de suporte ou atendimento</strong>.
              </p>
            </div>
          </section>
        )}



        {/* Aviso de modo teste */}
        {MODO_TESTE && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-100 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-300" />
            <div className="space-y-1.5">
              <p className="font-semibold text-amber-300 text-sm">Modo teste</p>
              <p>
                O número oficial do Gasto Inteligente ainda está em configuração. Por enquanto,
                você pode conhecer o funcionamento e testar a interpretação das mensagens
                pelo simulador abaixo.
              </p>
              <p className="text-amber-200/90">
                Nenhum gasto é salvo sem a sua confirmação.
              </p>
            </div>
          </div>
        )}

        {/* Seu WhatsApp — vínculo */}
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h2 className="text-base font-semibold">Seu WhatsApp</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {links.length === 0
                  ? "Cadastre o número que você usa no WhatsApp para vincular à sua conta."
                  : "Número vinculado à sua conta. Você pode alterar ou remover quando quiser."}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={novoTel}
              onChange={(e) => setNovoTel(e.target.value)}
              placeholder="(11) 99999-8888"
              inputMode="tel"
              className="flex-1"
            />
            <Button
              onClick={adicionar}
              disabled={adding || !novoTel.trim() || !aceitouOptIn}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              <Plus className="h-4 w-4 mr-1" /> {links.length === 0 ? "Vincular WhatsApp" : "Adicionar outro"}
            </Button>
          </div>

          {/* Consentimento LGPD — obrigatório */}
          <label
            htmlFor="wa-opt-in"
            className="flex items-start gap-2.5 rounded-lg border border-border bg-card-elevated p-3 text-xs cursor-pointer select-none"
          >
            <input
              id="wa-opt-in"
              type="checkbox"
              checked={aceitouOptIn}
              onChange={(e) => setAceitouOptIn(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
            />
            <span className="space-y-1.5 leading-relaxed">
              <span className="block text-foreground">
                Concordo em vincular meu WhatsApp ao Gasto Inteligente para enviar mensagens
                de lançamento de gastos. Entendo que esse canal é{" "}
                <strong>exclusivo para registrar despesas</strong> e{" "}
                <strong>não é suporte/atendimento</strong>.
              </span>
              <span className="block text-muted-foreground">
                As mensagens enviadas podem conter dados financeiros e serão usadas para
                interpretar e registrar seus gastos no app. Você pode desvincular seu número
                a qualquer momento. Veja mais na{" "}
                <Link
                  to="/privacidade"
                  className="underline underline-offset-2 text-emerald-300 hover:text-emerald-200"
                >
                  Política de Privacidade
                </Link>
                .
              </span>
            </span>
          </label>


          {/* Re-confirmação de consentimento LGPD em vínculo já existente */}
          {links.some((l) => l.ativo && (!l.opt_in_em || l.revogado_em)) && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
              <p className="text-sm font-semibold text-amber-300">
                Confirme seu consentimento para continuar usando o WhatsApp para lançar gastos.
              </p>
              <p className="text-xs text-amber-200/90 leading-relaxed">
                Seu número já está vinculado, mas o consentimento de uso do canal precisa ser
                reconfirmado para seguir com o lançamento de gastos por WhatsApp. Nenhuma
                mensagem é enviada e seu telefone não é alterado.
              </p>
              <label className="flex items-start gap-2 text-xs text-amber-100/95 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5 accent-amber-400"
                />
                <span>
                  Autorizo o uso do meu WhatsApp vinculado como canal para lançar gastos no
                  Gasto Inteligente, conforme a{" "}
                  <Link
                    to="/privacidade"
                    className="underline underline-offset-2 text-amber-200 hover:text-amber-100"
                  >
                    Política de Privacidade
                  </Link>
                  .
                </span>
              </label>
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  type="button"
                  size="sm"
                  onClick={confirmarConsentimento}
                  disabled={!consentChecked || consentLoading}
                  className="bg-amber-500 hover:bg-amber-400 text-amber-950"
                >
                  {consentLoading ? "Confirmando..." : "Confirmar consentimento"}
                </Button>
                {consentResult && (
                  <pre className="rounded-md bg-card-elevated px-2 py-1 text-[11px] font-mono">
{`consentimento_atualizado: ${consentResult}`}
                  </pre>
                )}
              </div>
            </div>
          )}


          {links.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground">
              Você ainda não vinculou nenhum número.
            </p>
          )}

          <ul className="space-y-2">
            {links.map((l) => {
              const codigo = activationCode(l.id);
              return (
                <li key={l.id} className="rounded-xl bg-card-elevated px-3 py-3 text-sm space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium num">{maskTel(l.telefone)}</p>
                        {MODO_TESTE ? (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-300 bg-amber-500/10 text-[10px]">
                            Aguardando ativação
                          </Badge>
                        ) : l.ativo ? (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 bg-emerald-500/10 text-[10px]">
                            Ativo
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-zinc-500/40 text-zinc-300 text-[10px]">
                            Inativo
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Vinculado em {new Date(l.created_at).toLocaleDateString("pt-BR")}
                        {l.ultimo_uso ? ` · Última mensagem ${new Date(l.ultimo_uso).toLocaleDateString("pt-BR")}` : " · Sem uso ainda"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => excluir(l.id)}
                      className="shrink-0 rounded-md p-2 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10"
                      aria-label="Remover número"
                      title="Remover número"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="rounded-lg border border-dashed border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1">
                    <p className="text-[11px] text-muted-foreground">Código de ativação</p>
                    <p className="font-mono text-base font-semibold text-emerald-300 tracking-wide">{codigo}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {MODO_TESTE
                        ? "Quando o número oficial do Gasto Inteligente estiver ativo, você enviará esse código por WhatsApp para finalizar a ativação."
                        : "Envie esse código pelo WhatsApp para o número oficial do Gasto Inteligente para concluir a ativação."}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Simulador */}
        <SimuladorCard
          texto={testTexto}
          onTextoChange={setTestTexto}
          onTestar={testarWebhook}
          testando={testando}
          podeTestar={links.length > 0}
          modoTeste={MODO_TESTE}
        />

        {/* Como vai funcionar quando estiver ativo */}
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-emerald-300">
            <Sparkles className="h-4 w-4" />
            Como vai funcionar quando estiver ativo
          </h2>
          <ol className="space-y-2 text-sm text-foreground/90">
            {[
              "Você envia um gasto pelo WhatsApp.",
              "O bot entende as informações principais.",
              "Ele mostra um resumo do gasto.",
              "Você responde sim ou não.",
              "O gasto só é salvo depois da sua confirmação.",
            ].map((passo, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-semibold">
                  {i + 1}
                </span>
                <span className="text-xs sm:text-sm text-muted-foreground">{passo}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Histórico (apenas se houver mensagens) */}
        {msgs.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Mensagens recebidas</h2>
              <Badge variant="outline" className={integracaoStatus.cls}>
                {integracaoStatus.label}
              </Badge>
            </div>
            <ul className="space-y-2">
              {msgs.slice(0, 8).map((m) => (
                <li key={m.id} className="rounded-lg bg-card-elevated p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground num">
                      {maskTel(m.telefone)} · {new Date(m.recebida_em).toLocaleString("pt-BR")}
                    </span>
                    <StatusBadge status={m.status} />
                  </div>
                  <p className="text-xs">{m.texto}</p>
                  {m.resposta_sugerida && (
                    <p className="text-[11px] text-muted-foreground border-l-2 border-emerald-500/40 pl-2 whitespace-pre-line">
                      {m.resposta_sugerida}
                    </p>
                  )}
                  {m.erro && (
                    <p className="text-[11px] text-rose-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {m.erro}
                    </p>
                  )}
                  <MessageActions msg={m} onChanged={refresh} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ============== ÁREA TÉCNICA — APENAS ADMIN MASTER ============== */}
        {isAdmin && (
          <>
            <div className="pt-4 border-t border-border/60">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Área técnica (Admin Master)
              </p>
            </div>

            {/* WA-D — Preflight read-only (TEMPORÁRIO; remover após WA-D) */}
            <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-amber-300">
                  WA-D · Preflight (somente leitura)
                </h2>
                <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                  temporário
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Executa apenas verificações de leitura na Meta. Não envia mensagens, não
                registra o número e não expõe credenciais.
              </p>
              <Button
                type="button"
                onClick={executarPreflight}
                disabled={preflightLoading}
                className="w-full sm:w-auto bg-amber-500/90 hover:bg-amber-500 text-black"
              >
                {preflightLoading ? "Executando..." : "Executar preflight (somente leitura)"}
              </Button>
              {preflightResult && (
                <pre className="rounded-lg bg-card-elevated p-3 text-[11px] font-mono leading-relaxed whitespace-pre overflow-x-auto">
{`token_para_waba: ${preflightResult.token_para_waba}
numero_oficial_na_waba: ${preflightResult.numero_oficial_na_waba}
app_inscrito_na_waba: ${preflightResult.app_inscrito_na_waba}
webhook_handshake: ${preflightResult.webhook_handshake}
numero_ja_registrado: ${preflightResult.numero_ja_registrado}
pronto_para_register: ${preflightResult.pronto_para_register}
access_token_lido_pelo_backend: ${preflightResult.access_token_lido_pelo_backend}
access_token_hash_prefix: ${preflightResult.access_token_hash_prefix}
meta_token_http_status: ${preflightResult.meta_token_http_status}
meta_waba_http_status: ${preflightResult.meta_waba_http_status}
meta_phone_http_status: ${preflightResult.meta_phone_http_status}
meta_subscribed_apps_http_status: ${preflightResult.meta_subscribed_apps_http_status}
meta_error_code: ${preflightResult.meta_error_code ?? "null"}
meta_error_subcode: ${preflightResult.meta_error_subcode ?? "null"}
erro_categoria: ${preflightResult.erro_categoria}`}
                </pre>
              )}

              {/* WA-E1 — Checklist operacional Admin Master */}
              <div className="pt-2 border-t border-amber-500/20 space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={carregarOpsChecklist}
                  disabled={opsChecklistLoading}
                  className="text-xs"
                >
                  {opsChecklistLoading ? "Carregando..." : "Atualizar checklist técnico"}
                </Button>
                {opsChecklist && (
                  <pre className="rounded-lg bg-card-elevated p-3 text-[11px] font-mono leading-relaxed whitespace-pre overflow-x-auto">
{`numero_registrado: ${opsChecklist.numero_registrado}
app_inscrito_na_waba: ${opsChecklist.app_inscrito_na_waba}
webhook_configurado: ${opsChecklist.webhook_configurado}
modo_canario_preparado: ${opsChecklist.modo_canario_preparado}
modo_canario_ativo: ${opsChecklist.modo_canario_ativo}
processamento_real_ativo: ${opsChecklist.processamento_real_ativo}`}
                  </pre>
                )}
              </div>

              {/* WA-E1.1 — Prontidão canário do Admin Master */}
              <div className="pt-2 border-t border-amber-500/20 space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={carregarCanaryReadiness}
                  disabled={canaryReadinessLoading}
                  className="text-xs"
                >
                  {canaryReadinessLoading
                    ? "Verificando..."
                    : "Verificar prontidão do canário (Admin Master)"}
                </Button>
                {canaryReadiness && (
                  <pre className="rounded-lg bg-card-elevated p-3 text-[11px] font-mono leading-relaxed whitespace-pre overflow-x-auto">
{`admin_canary_phone_ready: ${canaryReadiness.admin_canary_phone_ready}
admin_link_ativo: ${canaryReadiness.admin_link_ativo}
admin_opt_in_valido: ${canaryReadiness.admin_opt_in_valido}
admin_email_autorizado: ${canaryReadiness.admin_email_autorizado}`}
                  </pre>
                )}
              </div>

              {/* WA-Cat — Diagnóstico temporário de resolução de categoria (Admin Master) */}
              <div className="pt-2 border-t border-amber-500/20 space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={carregarCategoriaCheck}
                  disabled={categoriaCheckLoading}
                  className="text-xs"
                >
                  {categoriaCheckLoading
                    ? "Verificando..."
                    : "Verificar resolução de categoria (Padaria)"}
                </Button>
                {categoriaCheck && (
                  <pre className="rounded-lg bg-card-elevated p-3 text-[11px] font-mono leading-relaxed whitespace-pre overflow-x-auto">
{`categoria_alimentacao_disponivel: ${categoriaCheck.categoria_alimentacao_disponivel}
categoria_resolvida_para_padaria: ${categoriaCheck.categoria_resolvida_para_padaria}`}
                  </pre>
                )}
              </div>



              {/* WA-E2.audit — Auditoria read-only do estado real do número (Admin Master) */}
              <div className="pt-2 border-t border-amber-500/20 space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={auditarStatusRealDoNumero}
                  disabled={auditRealStateLoading}
                  className="text-xs"
                >
                  {auditRealStateLoading ? "Auditando..." : "Auditar status real do número"}
                </Button>
                {auditRealState && (
                  <pre className="rounded-lg bg-card-elevated p-3 text-[11px] font-mono leading-relaxed whitespace-pre overflow-x-auto">
{`numero_meta_encontrado: ${auditRealState.numero_meta_encontrado}
numero_verificado_na_meta: ${auditRealState.numero_verificado_na_meta}
numero_registrado_cloud_api: ${auditRealState.numero_registrado_cloud_api}
numero_apto_para_conversa_whatsapp: ${auditRealState.numero_apto_para_conversa_whatsapp}
plataforma_do_numero: ${auditRealState.plataforma_do_numero}
status_de_registro_confiavel: ${auditRealState.status_de_registro_confiavel}
acao_recomendada: ${auditRealState.acao_recomendada}
tipo_plataforma_meta: ${auditRealState.tipo_plataforma_meta}
status_numero_meta: ${auditRealState.status_numero_meta}
verificacao_numero_meta: ${auditRealState.verificacao_numero_meta}
nome_exibicao_meta: ${auditRealState.nome_exibicao_meta}
id_do_erro_meta_corresponde_ao_phone_number_id_atual: ${auditRealState.id_do_erro_meta_corresponde_ao_phone_number_id_atual}
phone_number_id_atual_esta_na_waba_oficial: ${auditRealState.phone_number_id_atual_esta_na_waba_oficial}`}
                  </pre>
                )}
              </div>

              {/* WA-E2.register — Estratégia + execução do POST /register */}
              <div className="pt-2 border-t border-amber-500/20 space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={classificarEstrategiaRegistro}
                  disabled={registerStrategyLoading}
                  className="text-xs"
                >
                  {registerStrategyLoading
                    ? "Classificando..."
                    : "Classificar estratégia de registro"}
                </Button>
                {registerStrategy && (
                  <pre className="rounded-lg bg-card-elevated p-3 text-[11px] font-mono leading-relaxed whitespace-pre overflow-x-auto">
{`estrategia_registro: ${registerStrategy}`}
                  </pre>
                )}

                {/* Registro Cloud API já concluído — trava operacional ativa (WHATSAPP_REGISTER_LOCK). */}
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Registro na Cloud API já concluído. Execução de novo /register
                  está travada operacionalmente. Auditoria, preflight, checklist
                  técnico e prontidão do canário continuam disponíveis em
                  modo read-only.
                </p>

                {registerResult && (
                  <pre className="rounded-lg bg-card-elevated p-3 text-[11px] font-mono leading-relaxed whitespace-pre overflow-x-auto">
{`registro_cloud_api_executado: ${registerResult.registro_cloud_api_executado}
registro_http_status: ${registerResult.registro_http_status}
meta_error_code: ${registerResult.meta_error_code ?? "null"}
meta_error_subcode: ${registerResult.meta_error_subcode ?? "null"}
numero_registrado_cloud_api: ${registerResult.numero_registrado_cloud_api}
numero_apto_para_conversa_whatsapp: ${registerResult.numero_apto_para_conversa_whatsapp}
status_numero_meta: ${registerResult.status_numero_meta}
acao_recomendada: ${registerResult.acao_recomendada}`}
                  </pre>
                )}
              </div>
            </section>



            {/* Status técnico + secrets */}
            <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                  Status da integração
                </h2>
                <Badge variant="outline" className={integracaoStatus.cls}>
                  {integracaoStatus.label}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-card-elevated p-2.5">
                  <p className="text-muted-foreground">Última mensagem</p>
                  <p className="mt-0.5 font-medium num">
                    {ultimaMsg ? new Date(ultimaMsg.recebida_em).toLocaleString("pt-BR") : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-card-elevated p-2.5">
                  <p className="text-muted-foreground">Números vinculados</p>
                  <p className="mt-0.5 font-medium num">{links.length}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Secrets do servidor
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                  {[
                    { key: "access_token", label: "WHATSAPP_ACCESS_TOKEN" },
                    { key: "phone_number_id", label: "WHATSAPP_PHONE_NUMBER_ID" },
                    { key: "business_account_id", label: "WHATSAPP_BUSINESS_ACCOUNT_ID" },
                    { key: "verify_token", label: "WHATSAPP_VERIFY_TOKEN" },
                  ].map((row) => {
                    const ok = configStatus
                      ? configStatus[row.key as keyof typeof configStatus]
                      : null;
                    return (
                      <li key={row.key} className="flex items-center justify-between gap-2 rounded-lg bg-card-elevated px-2.5 py-2">
                        <span className="font-mono text-[11px] truncate">{row.label}</span>
                        {ok === null ? (
                          <Badge variant="outline" className="border-border text-muted-foreground text-[10px]">verificando…</Badge>
                        ) : ok ? (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[10px]">Configurado</Badge>
                        ) : (
                          <Badge variant="outline" className="border-rose-500/40 text-rose-400 text-[10px]">Pendente</Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {configStatus && !configStatus.access_token && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <p>Configure o secret <span className="font-mono">WHATSAPP_ACCESS_TOKEN</span> para ativar o envio real.</p>
                  </div>
                )}
              </div>
            </section>

            {/* Webhook URL + Verify Token */}
            <section className="rounded-2xl border border-border bg-card p-4 space-y-4">
              <div>
                <h2 className="text-sm font-semibold">Configurar na Meta (WhatsApp Cloud API)</h2>
                <p className="text-[11px] text-muted-foreground mt-1">
                  No painel da Meta, abra seu app de WhatsApp → Configuration → Webhook → Edit. Cole os dois campos abaixo.
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Callback URL</p>
                <div className="flex items-center gap-2 rounded-lg bg-card-elevated px-3 py-2 text-xs font-mono break-all">
                  <span className="flex-1">{webhookUrl}</span>
                  <button type="button" onClick={copiarUrl} className="shrink-0 rounded-md p-1.5 hover:bg-border" aria-label="Copiar URL">
                    {copiado ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Verify Token</p>
                <div className="rounded-lg bg-card-elevated px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
                  Por segurança, o Verify Token não é exibido aqui. Configure-o diretamente no
                  painel seguro de Secrets (chave <span className="font-mono">WHATSAPP_VERIFY_TOKEN</span>)
                  e use exatamente o mesmo valor no campo <span className="font-mono">Verify token</span> da Meta.
                </div>
              </div>

              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3 space-y-1.5 text-[11px] text-muted-foreground">
                <p className="font-medium text-emerald-400">Passo a passo</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Cole a Callback URL no campo <span className="font-mono">Callback URL</span> da Meta.</li>
                  <li>Cole o Verify Token no campo <span className="font-mono">Verify token</span>.</li>
                  <li>Clique em <span className="font-medium">Verify and save</span>.</li>
                  <li>Em <span className="font-medium">Webhook fields</span>, assine <span className="font-mono">messages</span>.</li>
                </ol>
              </div>

              <Button
                variant="outline"
                onClick={limparDuplicados}
                disabled={limpando}
                className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10 w-full sm:w-auto"
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                {limpando ? "Limpando..." : "Limpar duplicados"}
              </Button>
            </section>
          </>
        )}

        {/* Aviso de segurança (substitui o bloco antigo de Histórico já reposicionado) */}

        {/* Aviso de segurança */}
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-3 text-[11px] text-muted-foreground flex items-start gap-2">
          <Shield className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
          <p>
            Nunca envie número completo do cartão, CVV, senha ou dados bancários sensíveis. Use apenas nome do gasto, valor, categoria, cartão e data.
          </p>
        </div>
      </div>
    </MobileShell>
  );
}

function MessageActions({ msg, onChanged }: { msg: Message; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function verEmGastos() {
    if (!msg.gasto_id) return;
    const { data, error } = await supabase
      .from("gastos")
      .select("id")
      .eq("id", msg.gasto_id)
      .maybeSingle();
    if (error || !data) {
      toast.error("Esse gasto não foi encontrado. Você pode reprocessar a mensagem.");
      await supabase
        .from("whatsapp_messages")
        .update({ status: "gasto_excluido", gasto_id: null, resposta_sugerida: "Gasto não encontrado." })
        .eq("id", msg.id);
      await onChanged();
      return;
    }
    window.location.href = `/gastos?highlight=${msg.gasto_id}`;
  }

  async function excluirGasto() {
    if (!msg.gasto_id) return;
    if (!(await confirmAsync({ title: "Excluir gasto?", description: "Essa ação também atualizará cartões, faturas, dashboard e relatórios.", destructive: true, confirmText: "Excluir" }))) return;
    setBusy("delete-gasto");
    try {
      const { error: delErr } = await supabase.from("gastos").delete().eq("id", msg.gasto_id);
      if (delErr) throw new Error(delErr.message);
      await supabase
        .from("contas_a_pagar")
        .update({ status: "pendente", data_pagamento: null, gasto_id: null })
        .eq("gasto_id", msg.gasto_id);
      await supabase
        .from("whatsapp_messages")
        .update({ status: "gasto_excluido", gasto_id: null, resposta_sugerida: "Gasto excluído pelo usuário." })
        .eq("id", msg.id);
      toast.success("Gasto excluído. Tudo recalculado.");
      await Promise.all([onChanged(), refreshGastos()]);
    } catch (e) {
      toastFromError(e);
    } finally {
      setBusy(null);
    }
  }

  async function reprocessar() {
    setBusy("reproc");
    try {
      await supabase.from("whatsapp_messages").delete().eq("id", msg.id);
      const res = await fetch(`${window.location.origin}/api/public/whatsapp/expense`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone: msg.telefone,
          texto: msg.texto,
          external_id: `reproc-${Date.now()}`,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error ?? "Falha ao reprocessar");
      toast.success(`Status: ${out.results?.[0]?.status ?? "ok"}`);
      await Promise.all([onChanged(), refreshGastos()]);
    } catch (e) {
      toastFromError(e);
    } finally {
      setBusy(null);
    }
  }

  async function excluirLog() {
    if (!(await confirmAsync({ title: "Excluir registro?", description: "Excluir apenas o registro desta mensagem. O gasto não será removido.", destructive: true, confirmText: "Excluir registro" }))) return;
    setBusy("delete-log");
    try {
      const { error } = await supabase.from("whatsapp_messages").delete().eq("id", msg.id);
      if (error) throw new Error(error.message);
      toast.success("Log removido.");
      await onChanged();
    } catch (e) {
      toastFromError(e);
    } finally {
      setBusy(null);
    }
  }

  const isSalva = msg.status === "salva" && !!msg.gasto_id;
  const isExcluido = msg.status === "gasto_excluido";
  const isDuplicada = msg.status === "duplicada";
  const podeReproc = isExcluido || isDuplicada || msg.status === "pendente" || msg.status === "erro" || msg.status === "valor_invalido";

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {isSalva && (
        <>
          <Button size="sm" variant="outline" onClick={verEmGastos} className="h-7 text-[11px]">
            <ExternalLink className="h-3 w-3 mr-1" /> Ver em Gastos
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={excluirGasto}
            disabled={busy === "delete-gasto"}
            className="h-7 text-[11px] border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
          >
            <Trash2 className="h-3 w-3 mr-1" /> Excluir gasto
          </Button>
        </>
      )}
      {isDuplicada && msg.gasto_id && (
        <Button size="sm" variant="outline" onClick={verEmGastos} className="h-7 text-[11px]">
          <ExternalLink className="h-3 w-3 mr-1" /> Ver gasto existente
        </Button>
      )}
      {podeReproc && (
        <Button size="sm" variant="outline" onClick={reprocessar} disabled={busy === "reproc"} className="h-7 text-[11px]">
          <RefreshCw className="h-3 w-3 mr-1" /> Reprocessar
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={excluirLog}
        disabled={busy === "delete-log"}
        className="h-7 text-[11px] text-muted-foreground hover:text-rose-300"
      >
        Excluir log
      </Button>
    </div>
  );
}

// =====================================================================
// Simulador de lançamento — preview local + botão de teste
// =====================================================================
const EXEMPLOS_SIMULADOR = [
  "Gastei R$ 35,90 no mercado hoje no cartão Nubank",
  "Paguei R$ 18 no Pix ontem com lanche",
  "Uber R$ 27 no crédito",
  "Comprei remédio R$ 42,50 no débito",
];

function SimuladorCard({
  texto,
  onTextoChange,
  onTestar,
  testando,
  podeTestar,
  modoTeste,
}: {
  texto: string;
  onTextoChange: (s: string) => void;
  onTestar: () => void;
  testando: boolean;
  podeTestar: boolean;
  modoTeste: boolean;
}) {
  const preview = useMemo(() => {
    const t = texto.trim();
    if (!t) return null;
    try {
      return parseWhatsAppExpenseMessage(t, []);
    } catch {
      return null;
    }
  }, [texto]);

  const categoriaLabel = useMemo(() => {
    if (!preview) return null;
    const key =
      suggestCategoryFromText(preview.categoriaSugestao || preview.nome) || "outros";
    const cat = DEFAULT_CATEGORIES.find((c) => c.id === key);
    return cat?.nome ?? "Outros";
  }, [preview]);

  const formaLabel = useMemo(() => {
    if (!preview) return null;
    const f = FORMAS_PAGAMENTO.find((x) => x.id === preview.formaPagamento);
    return f?.label ?? preview.formaPagamento;
  }, [preview]);

  const dataLabel = useMemo(() => {
    if (!preview) return null;
    const hoje = new Date();
    const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    if (preview.data === hojeIso) return "Hoje";
    return new Date(preview.data + "T00:00:00").toLocaleDateString("pt-BR");
  }, [preview]);

  const valorOK = !!preview && preview.valor > 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Send className="h-4 w-4 text-emerald-400" />
            Simulador de lançamento
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Digite uma mensagem como se fosse pelo WhatsApp e veja como o Gasto
            Inteligente entende o que você escreveu.
          </p>
        </div>
        {modoTeste && (
          <Badge variant="outline" className="border-amber-500/40 text-amber-300 bg-amber-500/10 text-[10px]">
            Apenas simulação
          </Badge>
        )}
      </div>

      <Textarea
        value={texto}
        onChange={(e) => onTextoChange(e.target.value)}
        placeholder="Ex.: Gastei R$ 35,90 no mercado hoje no cartão Nubank"
        className="min-h-[80px] bg-card-elevated text-sm"
      />

      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">Exemplos para testar:</p>
        <div className="flex flex-wrap gap-1.5">
          {EXEMPLOS_SIMULADOR.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => onTextoChange(ex)}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-card-elevated hover:text-foreground transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {preview && valorOK && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2 animate-fade-in">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-emerald-300 font-medium uppercase tracking-wide flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Resultado da simulação
            </p>
            <Badge variant="outline" className="border-amber-500/40 text-amber-300 bg-amber-500/10 text-[10px]">
              Aguardando confirmação
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-card-elevated px-2.5 py-2">
              <p className="text-muted-foreground text-[11px]">Valor</p>
              <p className="mt-0.5 font-semibold num">
                {preview.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
            </div>
            <div className="rounded-lg bg-card-elevated px-2.5 py-2">
              <p className="text-muted-foreground text-[11px]">Categoria</p>
              <p className="mt-0.5 font-medium">{categoriaLabel}</p>
            </div>
            <div className="rounded-lg bg-card-elevated px-2.5 py-2">
              <p className="text-muted-foreground text-[11px]">Data</p>
              <p className="mt-0.5 font-medium">{dataLabel}</p>
            </div>
            <div className="rounded-lg bg-card-elevated px-2.5 py-2">
              <p className="text-muted-foreground text-[11px]">Forma de pagamento</p>
              <p className="mt-0.5 font-medium">{formaLabel}</p>
            </div>
            {preview.cartaoNomeDetectado && (
              <div className="col-span-2 rounded-lg bg-card-elevated px-2.5 py-2">
                <p className="text-muted-foreground text-[11px]">Cartão</p>
                <p className="mt-0.5 font-medium">{preview.cartaoNomeDetectado}</p>
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground border-t border-border/60 pt-2">
            Nada foi salvo. {modoTeste
              ? "Quando o número oficial estiver ativo, você confirmaria com um \"sim\" no WhatsApp."
              : "Para salvar de verdade, envie a mensagem pelo WhatsApp e responda \"sim\"."}
          </p>
        </div>
      )}

      {preview && !valorOK && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
          Não consegui identificar o valor da mensagem. Tente algo como "R$ 35,90".
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          onClick={onTestar}
          disabled={testando || !podeTestar || !valorOK}
          className="bg-emerald-500 hover:bg-emerald-600 text-white flex-1 sm:flex-initial"
        >
          {testando ? "Testando..." : "Testar mensagem"}
        </Button>
        {!podeTestar && (
          <p className="text-[11px] text-muted-foreground self-center">
            Vincule seu WhatsApp acima para usar o teste.
          </p>
        )}
      </div>
    </section>
  );
}
