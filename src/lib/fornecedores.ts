/**
 * Fornecedores — CRUD sobre public.fornecedores.
 *
 * Cada usuário tem sua própria lista de fornecedores. CNPJ é opcional
 * (fornecedor pessoa física, prestador informal, estrangeiro etc.).
 * Quando há CNPJ, ele é único por usuário (índice parcial no banco).
 */
import { supabase } from "@/integrations/supabase/client";
import type { EmpresaConsultada } from "@/lib/empresa";

export interface Fornecedor {
  id: string;
  user_id: string;
  cnpj: string | null;
  nome: string;
  apelido: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao_cadastral: string | null;
  cnae_principal_codigo: string | null;
  cnae_principal_descricao: string | null;
  telefone: string | null;
  email: string | null;
  observacoes: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  municipio: string | null;
  uf: string | null;
  ativo: boolean;
  source: string | null;
  cnpj_cache_fetched_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLS =
  "id, user_id, cnpj, nome, apelido, razao_social, nome_fantasia, situacao_cadastral, cnae_principal_codigo, cnae_principal_descricao, telefone, email, observacoes, logradouro, numero, complemento, bairro, cep, municipio, uf, ativo, source, cnpj_cache_fetched_at, created_at, updated_at";

export async function listarFornecedores(userId: string): Promise<Fornecedor[]> {
  const { data, error } = await supabase
    .from("fornecedores")
    .select(COLS)
    .eq("user_id", userId)
    .order("ativo", { ascending: false })
    .order("nome", { ascending: true });
  if (error) {
    console.error("[fornecedores] erro listando:", error.message);
    throw error;
  }
  return (data as Fornecedor[]) ?? [];
}

export interface NovoFornecedorManual {
  nome: string;
  apelido?: string | null;
  telefone?: string | null;
  email?: string | null;
  observacoes?: string | null;
}

export async function salvarFornecedorManual(
  userId: string,
  input: NovoFornecedorManual,
): Promise<Fornecedor> {
  const payload = {
    user_id: userId,
    nome: input.nome.trim(),
    apelido: input.apelido?.trim() || null,
    telefone: input.telefone?.trim() || null,
    email: input.email?.trim() || null,
    observacoes: input.observacoes?.trim() || null,
  };
  const { data, error } = await supabase.from("fornecedores").insert(payload).select(COLS).single();
  if (error) throw error;
  return data as Fornecedor;
}

export async function salvarFornecedorPorCnpj(
  userId: string,
  company: EmpresaConsultada,
  source: string | null,
  fetchedAt: string | null,
  extras?: {
    telefone?: string | null;
    email?: string | null;
    observacoes?: string | null;
    apelido?: string | null;
  },
): Promise<Fornecedor> {
  const payload = {
    user_id: userId,
    cnpj: company.cnpj,
    nome: company.nomeFantasia || company.razaoSocial || "Fornecedor",
    apelido: extras?.apelido?.trim() || null,
    razao_social: company.razaoSocial,
    nome_fantasia: company.nomeFantasia,
    situacao_cadastral: company.situacaoCadastral,
    cnae_principal_codigo: company.cnaePrincipalCodigo,
    cnae_principal_descricao: company.cnaePrincipalDescricao,
    telefone: extras?.telefone?.trim() || null,
    email: extras?.email?.trim() || null,
    observacoes: extras?.observacoes?.trim() || null,
    logradouro: company.endereco.logradouro,
    numero: company.endereco.numero,
    complemento: company.endereco.complemento,
    bairro: company.endereco.bairro,
    cep: company.endereco.cep,
    municipio: company.endereco.municipio,
    uf: company.endereco.uf,
    source,
    cnpj_cache_fetched_at: fetchedAt,
  };
  const { data, error } = await supabase.from("fornecedores").insert(payload).select(COLS).single();
  if (error) throw error;
  return data as Fornecedor;
}

export interface EdicaoFornecedor {
  nome?: string;
  apelido?: string | null;
  telefone?: string | null;
  email?: string | null;
  observacoes?: string | null;
}

export async function atualizarFornecedor(
  id: string,
  patch: EdicaoFornecedor,
): Promise<Fornecedor> {
  const payload: {
    nome?: string;
    apelido?: string | null;
    telefone?: string | null;
    email?: string | null;
    observacoes?: string | null;
  } = {};
  if (patch.nome !== undefined) payload.nome = patch.nome.trim();
  if (patch.apelido !== undefined) payload.apelido = patch.apelido?.trim() || null;
  if (patch.telefone !== undefined) payload.telefone = patch.telefone?.trim() || null;
  if (patch.email !== undefined) payload.email = patch.email?.trim() || null;
  if (patch.observacoes !== undefined) payload.observacoes = patch.observacoes?.trim() || null;
  const { data, error } = await supabase
    .from("fornecedores")
    .update(payload)
    .eq("id", id)
    .select(COLS)
    .single();
  if (error) throw error;
  return data as Fornecedor;
}

export async function alternarAtivoFornecedor(id: string, ativo: boolean): Promise<void> {
  const { error } = await supabase.from("fornecedores").update({ ativo }).eq("id", id);
  if (error) throw error;
}

export async function removerFornecedor(id: string): Promise<void> {
  const { error } = await supabase.from("fornecedores").delete().eq("id", id);
  if (error) throw error;
}

export async function existeFornecedorComCnpj(userId: string, cnpj: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("fornecedores")
    .select("id")
    .eq("user_id", userId)
    .eq("cnpj", cnpj)
    .maybeSingle();
  if (error) {
    console.error("[fornecedores] erro checando duplicidade:", error.message);
    return false;
  }
  return !!data;
}

// ============================================================
// Hook simples para componentes (lista + map por id)
// ============================================================
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

interface UseFornecedoresResult {
  fornecedores: Fornecedor[];
  ativos: Fornecedor[];
  porId: Record<string, Fornecedor>;
  loading: boolean;
  reload: () => void;
}

/**
 * Carrega os fornecedores do usuário autenticado. Não é cache global —
 * cada chamada faz uma leitura ao montar e expõe a função `reload`.
 */
export function useFornecedores(): UseFornecedoresResult {
  const { user } = useAuth();
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!user?.id) {
      setFornecedores([]);
      return;
    }
    let cancelado = false;
    setLoading(true);
    void listarFornecedores(user.id)
      .then((rows) => {
        if (!cancelado) setFornecedores(rows);
      })
      .catch(() => {
        if (!cancelado) setFornecedores([]);
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [user?.id, tick]);

  const ativos = fornecedores.filter((f) => f.ativo);
  const porId: Record<string, Fornecedor> = {};
  for (const f of fornecedores) porId[f.id] = f;

  return {
    fornecedores,
    ativos,
    porId,
    loading,
    reload: () => setTick((t) => t + 1),
  };
}
