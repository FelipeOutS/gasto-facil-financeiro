/**
 * WA-C7 — Operações de banco para favorecidos (reuso da tabela `fornecedores`).
 *
 * Toda query inclui filtro explícito por `user_id` (defesa em profundidade
 * sobre a RLS, padrão WA-C5.1). Nada de Pix/CPF/CNPJ/telefone nos logs —
 * apenas IDs UUID, tipo da chave, contagem e flags booleanas.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import type { PixKeyType } from "./whatsapp-pix-parser";

// Re-export como `any` para preservar a interface fluida do supabase-js
// e evitar fricção de tipos nos chamadores. Direct import garante que o
// `mock.module(...)` dos testes substitua a referência sem precisar de
// Proxy de live-binding.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = _supabaseAdmin;

export type FavorecidoRow = {
  id: string;
  user_id: string;
  nome: string;
  apelido: string | null;
  pix_key: string | null;
  pix_key_type: PixKeyType | null;
};

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Busca favorecidos do usuário cujo `nome` OU `apelido` casa (substring,
 * case/acento-insensitive) com o termo. Limit 10 — desambiguação humana.
 */
export async function findFavorecidosByNome(
  userId: string,
  termo: string,
): Promise<FavorecidoRow[]> {
  const n = norm(termo);
  if (!userId || !n) return [];
  const { data, error } = await supabaseAdmin
    .from("fornecedores")
    .select("id, user_id, nome, apelido, pix_key, pix_key_type")
    .eq("user_id", userId)
    .eq("ativo", true);
  if (error || !Array.isArray(data)) return [];
  const rows = data as FavorecidoRow[];
  // Match em memória: substring no nome OU apelido normalizados.
  const matches = rows.filter((r) => {
    const nn = norm(r.nome);
    const na = norm(r.apelido ?? "");
    return nn.includes(n) || (na.length > 0 && na.includes(n));
  });
  // Prioriza match exato.
  matches.sort((a, b) => {
    const aExact = norm(a.nome) === n || norm(a.apelido ?? "") === n;
    const bExact = norm(b.nome) === n || norm(b.apelido ?? "") === n;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
  return matches.slice(0, 10);
}

export type CreateFavorecidoInput = {
  userId: string;
  nome: string;
  pixKey?: string | null;
  pixKeyType?: PixKeyType | null;
};

export async function createFavorecido(
  input: CreateFavorecidoInput,
): Promise<FavorecidoRow | null> {
  const { data, error } = await supabaseAdmin
    .from("fornecedores")
    .insert({
      user_id: input.userId,
      nome: input.nome.trim(),
      pix_key: input.pixKey ?? null,
      pix_key_type: input.pixKeyType ?? null,
      ativo: true,
      source: "whatsapp",
    })
    .select("id, user_id, nome, apelido, pix_key, pix_key_type")
    .maybeSingle();
  if (error || !data) return null;
  return data as FavorecidoRow;
}

export async function updateFavorecidoPix(
  userId: string,
  favorecidoId: string,
  pixKey: string,
  pixKeyType: PixKeyType,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("fornecedores")
    .update({ pix_key: pixKey, pix_key_type: pixKeyType })
    .eq("id", favorecidoId)
    .eq("user_id", userId) // defesa em profundidade
    .select("id")
    .maybeSingle();
  return !error && !!data;
}

/**
 * Busca um favorecido do usuário pela chave Pix normalizada. Comparação
 * feita em memória (case-insensitive) para não depender de igualdade
 * exata em nível de banco. Escopo estrito por `user_id` — nunca retorna
 * favorecido de outro usuário.
 */
export async function findFavorecidoByPixKey(
  userId: string,
  pixKey: string,
): Promise<FavorecidoRow | null> {
  const key = (pixKey ?? "").trim().toLowerCase();
  if (!userId || !key) return null;
  const { data, error } = await supabaseAdmin
    .from("fornecedores")
    .select("id, user_id, nome, apelido, pix_key, pix_key_type")
    .eq("user_id", userId)
    .eq("ativo", true);
  if (error || !Array.isArray(data)) return null;
  const rows = data as FavorecidoRow[];
  const match = rows.find(
    (r) => (r.pix_key ?? "").trim().toLowerCase() === key,
  );
  return match ?? null;
}

/**
 * Rotula o tipo de chave para exibição ao usuário.
 */
export function rotuloTipoPix(t: PixKeyType): string {
  switch (t) {
    case "email":
      return "e-mail";
    case "telefone":
      // WA-Q-PixInline-UX: exibir "Celular" em vez de "telefone".
      return "Celular";
    case "cpf":
      return "CPF";
    case "cnpj":
      return "CNPJ";
    case "aleatoria":
      return "chave aleatória";
    default:
      return "chave";
  }
}
