/**
 * "Minha Empresa" — CRUD sobre user_companies.
 *
 * Snapshot dos dados públicos do CNPJ (vindos de cnpj_cache via server
 * function consultarCnpj) associado ao usuário. MVP: uma empresa por
 * usuário (constraint UNIQUE(user_id)).
 */
import { supabase } from "@/integrations/supabase/client";

/** Cópia client-safe do EmpresaConsultada retornado por consultarCnpj. */
export interface EmpresaConsultada {
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

export interface MinhaEmpresa {
  id: string;
  user_id: string;
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
  cnpj_cache_fetched_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLS =
  "id, user_id, cnpj, razao_social, nome_fantasia, situacao_cadastral, cnae_principal_codigo, cnae_principal_descricao, logradouro, numero, complemento, bairro, cep, municipio, uf, data_abertura, porte, natureza_juridica, source, cnpj_cache_fetched_at, created_at, updated_at";

/** Retorna a empresa cadastrada do usuário, ou null se não houver. */
export async function getMinhaEmpresa(userId: string): Promise<MinhaEmpresa | null> {
  const { data, error } = await supabase
    .from("user_companies")
    .select(COLS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[empresa] erro lendo empresa:", error.message);
    throw error;
  }
  return (data as MinhaEmpresa | null) ?? null;
}

/**
 * Salva (cria) a empresa do usuário a partir de um EmpresaConsultada já consultado.
 * Falha se já existir uma empresa para o usuário (constraint UNIQUE).
 */
export async function salvarMinhaEmpresa(
  userId: string,
  company: EmpresaConsultada,
  source: string | null,
  fetchedAt: string | null,
): Promise<MinhaEmpresa> {
  const payload = {
    user_id: userId,
    cnpj: company.cnpj,
    razao_social: company.razaoSocial,
    nome_fantasia: company.nomeFantasia,
    situacao_cadastral: company.situacaoCadastral,
    cnae_principal_codigo: company.cnaePrincipalCodigo,
    cnae_principal_descricao: company.cnaePrincipalDescricao,
    logradouro: company.endereco.logradouro,
    numero: company.endereco.numero,
    complemento: company.endereco.complemento,
    bairro: company.endereco.bairro,
    cep: company.endereco.cep,
    municipio: company.endereco.municipio,
    uf: company.endereco.uf,
    data_abertura: company.dataAbertura,
    porte: company.porte,
    natureza_juridica: company.naturezaJuridica,
    source,
    cnpj_cache_fetched_at: fetchedAt,
  };
  const { data, error } = await supabase
    .from("user_companies")
    .insert(payload)
    .select(COLS)
    .single();
  if (error) {
    console.error("[empresa] erro salvando empresa:", error.message);
    throw error;
  }
  return data as MinhaEmpresa;
}

/** Atualiza os dados da empresa do usuário a partir de um EmpresaConsultada. */
export async function atualizarMinhaEmpresa(
  id: string,
  company: EmpresaConsultada,
  source: string | null,
  fetchedAt: string | null,
): Promise<MinhaEmpresa> {
  const payload = {
    cnpj: company.cnpj,
    razao_social: company.razaoSocial,
    nome_fantasia: company.nomeFantasia,
    situacao_cadastral: company.situacaoCadastral,
    cnae_principal_codigo: company.cnaePrincipalCodigo,
    cnae_principal_descricao: company.cnaePrincipalDescricao,
    logradouro: company.endereco.logradouro,
    numero: company.endereco.numero,
    complemento: company.endereco.complemento,
    bairro: company.endereco.bairro,
    cep: company.endereco.cep,
    municipio: company.endereco.municipio,
    uf: company.endereco.uf,
    data_abertura: company.dataAbertura,
    porte: company.porte,
    natureza_juridica: company.naturezaJuridica,
    source,
    cnpj_cache_fetched_at: fetchedAt,
  };
  const { data, error } = await supabase
    .from("user_companies")
    .update(payload)
    .eq("id", id)
    .select(COLS)
    .single();
  if (error) {
    console.error("[empresa] erro atualizando empresa:", error.message);
    throw error;
  }
  return data as MinhaEmpresa;
}

/** Remove a empresa do usuário. */
export async function removerMinhaEmpresa(id: string): Promise<void> {
  const { error } = await supabase.from("user_companies").delete().eq("id", id);
  if (error) {
    console.error("[empresa] erro removendo empresa:", error.message);
    throw error;
  }
}
