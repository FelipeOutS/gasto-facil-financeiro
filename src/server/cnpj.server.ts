/**
 * Empresa Inteligente — consulta de CNPJ com cache, fallback e normalização.
 *
 * Server-only. Nunca importar do código de cliente.
 *
 * Fontes:
 *  - BrasilAPI (primária)
 *  - CNPJ.ws (fallback)
 *
 * Cache em public.cnpj_cache via service role. TTL padrão: 30 dias.
 *
 * Política:
 *  - CNPJ é dado público (RFB); cache é compartilhado entre usuários.
 *  - QSA/quadro de sócios não é exposto nem persistido em campos próprios
 *    (fica apenas no raw_payload para uso futuro).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { limparCnpj, validarCnpj } from "@/lib/cnpj";

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const FETCH_TIMEOUT_MS = 5000;

export interface CompanyDTO {
  cnpj: string;
  cnpjFormatado: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  situacaoCadastral: string | null;
  cnaePrincipalCodigo: string | null;
  cnaePrincipalDescricao: string | null;
  endereco: {
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cep: string | null;
    municipio: string | null;
    uf: string | null;
  };
  dataAbertura: string | null;
  porte: string | null;
  naturezaJuridica: string | null;
}

export interface CnpjResult {
  success: boolean;
  source: "brasilapi" | "cnpjws" | "cache" | null;
  stale: boolean;
  company: CompanyDTO | null;
  message?: string;
}

interface CacheRow {
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao_cadastral: string | null;
  cnae_principal_codigo: string | null;
  cnae_principal_descricao: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  municipio: string | null;
  uf: string | null;
  data_abertura: string | null;
  porte: string | null;
  natureza_juridica: string | null;
  source: string | null;
  fetched_at: string;
  expires_at: string;
}

function formatCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function dtoFromRow(row: CacheRow): CompanyDTO {
  return {
    cnpj: row.cnpj,
    cnpjFormatado: formatCnpj(row.cnpj),
    razaoSocial: row.razao_social,
    nomeFantasia: row.nome_fantasia,
    situacaoCadastral: row.situacao_cadastral,
    cnaePrincipalCodigo: row.cnae_principal_codigo,
    cnaePrincipalDescricao: row.cnae_principal_descricao,
    endereco: {
      logradouro: row.logradouro,
      numero: row.numero,
      complemento: row.complemento,
      bairro: row.bairro,
      cep: row.cep,
      municipio: row.municipio,
      uf: row.uf,
    },
    dataAbertura: row.data_abertura,
    porte: row.porte,
    naturezaJuridica: row.natureza_juridica,
  };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// BrasilAPI
// ============================================================
// https://brasilapi.com.br/api/cnpj/v1/{cnpj}
interface BrasilApiPayload {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  descricao_situacao_cadastral?: string;
  situacao_cadastral?: string | number;
  cnae_fiscal?: string | number;
  cnae_fiscal_descricao?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  municipio?: string;
  uf?: string;
  data_inicio_atividade?: string;
  porte?: string;
  descricao_porte?: string;
  natureza_juridica?: string;
  descricao_natureza_juridica?: string;
}

async function fetchBrasilApi(cnpj: string): Promise<CacheRow | null> {
  const url = `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`;
  console.info(`[cnpj] BrasilAPI: consultando ${cnpj}`);
  const res = await fetchWithTimeout(url);
  console.info(`[cnpj] BrasilAPI status HTTP: ${res.status}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[cnpj] BrasilAPI falhou (${res.status}): ${body.slice(0, 300)}`);
    return null;
  }
  const data = (await res.json()) as BrasilApiPayload;
  const now = new Date();
  return {
    cnpj,
    razao_social: asString(data.razao_social),
    nome_fantasia: asString(data.nome_fantasia),
    situacao_cadastral: asString(data.descricao_situacao_cadastral ?? data.situacao_cadastral),
    cnae_principal_codigo: asString(data.cnae_fiscal),
    cnae_principal_descricao: asString(data.cnae_fiscal_descricao),
    logradouro: asString(data.logradouro),
    numero: asString(data.numero),
    complemento: asString(data.complemento),
    bairro: asString(data.bairro),
    cep: asString(data.cep),
    municipio: asString(data.municipio),
    uf: asString(data.uf),
    data_abertura: asString(data.data_inicio_atividade),
    porte: asString(data.descricao_porte ?? data.porte),
    natureza_juridica: asString(data.descricao_natureza_juridica ?? data.natureza_juridica),
    source: "brasilapi",
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
  };
}

// ============================================================
// CNPJ.ws (fallback)
// ============================================================
// https://publica.cnpj.ws/cnpj/{cnpj}
interface CnpjWsAtividade {
  id?: string;
  subclasse?: string;
  descricao?: string;
}
interface CnpjWsEstabelecimento {
  cnpj?: string;
  tipo_logradouro?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  cidade?: { nome?: string };
  estado?: { sigla?: string };
  data_inicio_atividade?: string;
  situacao_cadastral?: string;
  atividade_principal?: CnpjWsAtividade;
  nome_fantasia?: string;
}
interface CnpjWsPayload {
  razao_social?: string;
  estabelecimento?: CnpjWsEstabelecimento;
  porte?: { descricao?: string };
  natureza_juridica?: { descricao?: string };
}

async function fetchCnpjWs(cnpj: string): Promise<CacheRow | null> {
  const url = `https://publica.cnpj.ws/cnpj/${cnpj}`;
  console.info(`[cnpj] CNPJ.ws: consultando ${cnpj}`);
  const res = await fetchWithTimeout(url);
  console.info(`[cnpj] CNPJ.ws status HTTP: ${res.status}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[cnpj] CNPJ.ws falhou (${res.status}): ${body.slice(0, 300)}`);
    return null;
  }
  const data = (await res.json()) as CnpjWsPayload;
  const est = data.estabelecimento ?? {};
  const logradouroFull = [est.tipo_logradouro, est.logradouro].filter(Boolean).join(" ").trim();
  const now = new Date();
  return {
    cnpj,
    razao_social: asString(data.razao_social),
    nome_fantasia: asString(est.nome_fantasia),
    situacao_cadastral: asString(est.situacao_cadastral),
    cnae_principal_codigo: asString(
      est.atividade_principal?.subclasse ?? est.atividade_principal?.id,
    ),
    cnae_principal_descricao: asString(est.atividade_principal?.descricao),
    logradouro: asString(logradouroFull),
    numero: asString(est.numero),
    complemento: asString(est.complemento),
    bairro: asString(est.bairro),
    cep: asString(est.cep),
    municipio: asString(est.cidade?.nome),
    uf: asString(est.estado?.sigla),
    data_abertura: asString(est.data_inicio_atividade),
    porte: asString(data.porte?.descricao),
    natureza_juridica: asString(data.natureza_juridica?.descricao),
    source: "cnpjws",
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
  };
}

// ============================================================
// Cache
// ============================================================

async function readCache(cnpj: string): Promise<CacheRow | null> {
  console.info(`[cnpj] lendo cache para ${cnpj}`);
  const { data, error } = await supabaseAdmin
    .from("cnpj_cache")
    .select(
      "cnpj, razao_social, nome_fantasia, situacao_cadastral, cnae_principal_codigo, cnae_principal_descricao, logradouro, numero, complemento, bairro, cep, municipio, uf, data_abertura, porte, natureza_juridica, source, fetched_at, expires_at",
    )
    .eq("cnpj", cnpj)
    .maybeSingle();
  if (error) {
    console.error("[cnpj] erro lendo cache:", error.message);
    return null;
  }
  return (data as CacheRow | null) ?? null;
}

async function persistCache(row: CacheRow, rawPayload: unknown): Promise<void> {
  console.info(`[cnpj] gravando cache de ${row.cnpj} (fonte=${row.source})`);
  const { error } = await supabaseAdmin
    .from("cnpj_cache")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert({ ...row, raw_payload: rawPayload } as any, {
      onConflict: "cnpj",
    });
  if (error) console.error("[cnpj] erro gravando cache:", error.message);
  else console.info("[cnpj] cache gravado com sucesso");
}

function isFresh(row: CacheRow): boolean {
  const exp = new Date(row.expires_at).getTime();
  return Number.isFinite(exp) && Date.now() < exp;
}

// ============================================================
// Orquestração
// ============================================================

export async function consultarCnpjInterno(cnpjInput: string): Promise<CnpjResult> {
  const cnpj = limparCnpj(cnpjInput);
  console.info(`[cnpj] início da consulta para "${cnpjInput}" → ${cnpj}`);

  if (!validarCnpj(cnpj)) {
    console.info("[cnpj] CNPJ inválido — não consultará API externa");
    return {
      success: false,
      source: null,
      stale: false,
      company: null,
      message: "CNPJ inválido. Confira os números e tente novamente.",
    };
  }

  const cached = await readCache(cnpj);
  if (cached && isFresh(cached)) {
    console.info(`[cnpj] cache fresco encontrado (fonte=${cached.source})`);
    return {
      success: true,
      source: "cache",
      stale: false,
      company: dtoFromRow(cached),
    };
  }
  if (cached) console.info("[cnpj] cache vencido; buscando fontes externas");

  // BrasilAPI (primária)
  let row: CacheRow | null = null;
  let rawForCache: unknown = null;
  try {
    row = await fetchBrasilApi(cnpj);
    if (row) rawForCache = { source: "brasilapi", fetched_at: row.fetched_at };
  } catch (err) {
    console.error("[cnpj] exceção na BrasilAPI:", (err as Error).message);
  }

  // Fallback CNPJ.ws
  if (!row) {
    console.info("[cnpj] tentando fallback CNPJ.ws");
    try {
      row = await fetchCnpjWs(cnpj);
      if (row) rawForCache = { source: "cnpjws", fetched_at: row.fetched_at };
    } catch (err) {
      console.error("[cnpj] exceção no CNPJ.ws:", (err as Error).message);
    }
  }

  if (row) {
    await persistCache(row, rawForCache ?? {});
    const company = dtoFromRow(row);
    console.info(
      `[cnpj] retornando dados frescos (fonte=${row.source}, razao=${company.razaoSocial ?? "-"})`,
    );
    return {
      success: true,
      source: row.source === "cnpjws" ? "cnpjws" : "brasilapi",
      stale: false,
      company,
    };
  }

  // Ambas falharam — degrade para cache vencido, se existir.
  if (cached) {
    console.warn("[cnpj] APIs falharam; retornando cache vencido (stale)");
    return {
      success: true,
      source: "cache",
      stale: true,
      company: dtoFromRow(cached),
      message: "Não conseguimos atualizar os dados agora. Exibindo a última informação disponível.",
    };
  }

  console.error("[cnpj] falha total — sem cache para fallback");
  return {
    success: false,
    source: null,
    stale: false,
    company: null,
    message: "Não conseguimos consultar este CNPJ agora. Tente novamente em alguns minutos.",
  };
}
