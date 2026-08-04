import { supabase } from "@/integrations/supabase/client";

export type StatusContaReceber = "pendente" | "parcial" | "recebido" | "atrasado" | "cancelado";

export type TipoRecebimento =
  | "cliente"
  | "venda"
  | "freelance"
  | "salario"
  | "aluguel"
  | "reembolso"
  | "outro";

export const TIPOS_RECEBIMENTO: Array<{ id: TipoRecebimento; label: string }> = [
  { id: "cliente", label: "Cliente" },
  { id: "venda", label: "Venda" },
  { id: "freelance", label: "Freelance / Serviço" },
  { id: "salario", label: "Salário" },
  { id: "aluguel", label: "Aluguel" },
  { id: "reembolso", label: "Reembolso" },
  { id: "outro", label: "Outro" },
];

export type FormaRecebimento = "pix" | "boleto" | "transferencia" | "dinheiro" | "cartao" | "outro";

export const FORMAS_RECEBIMENTO: Array<{ id: FormaRecebimento; label: string }> = [
  { id: "pix", label: "PIX" },
  { id: "boleto", label: "Boleto" },
  { id: "transferencia", label: "Transferência" },
  { id: "dinheiro", label: "Dinheiro" },
  { id: "cartao", label: "Cartão" },
  { id: "outro", label: "Outro" },
];

export type ContaReceber = {
  id: string;
  user_id: string;
  titulo: string;
  pagador_nome: string | null;
  tipo_recebimento: TipoRecebimento | string;
  valor_total: number;
  valor_recebido: number;
  valor_restante: number;
  data_prevista: string; // YYYY-MM-DD
  data_recebimento: string | null;
  status: StatusContaReceber | string;
  categoria: string | null;
  forma_recebimento: FormaRecebimento | string | null;
  observacao: string | null;
  origem: string | null;
  cliente_id: string | null;
  created_at: string;
  updated_at: string;
};

export type NovaContaReceberInput = {
  titulo: string;
  pagador_nome?: string | null;
  tipo_recebimento: TipoRecebimento | string;
  valor_total: number;
  data_prevista: string;
  categoria?: string | null;
  forma_recebimento?: FormaRecebimento | string | null;
  observacao?: string | null;
  cliente_id?: string | null;
};

export type EditarContaReceberInput = Partial<NovaContaReceberInput>;

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Calcula o status efetivo (atrasado se vencido e ainda há saldo) */
export function statusEfetivo(
  c: Pick<ContaReceber, "status" | "valor_restante" | "data_prevista">,
): StatusContaReceber {
  if (c.status === "recebido" || c.status === "cancelado") return c.status as StatusContaReceber;
  if (Number(c.valor_restante) <= 0) return "recebido";
  const hoje = todayISO();
  if (c.data_prevista < hoje) return "atrasado";
  if (c.status === "parcial") return "parcial";
  return "pendente";
}

export async function listarContasReceber(userId: string): Promise<ContaReceber[]> {
  const { data, error } = await supabase
    .from("contas_a_receber")
    .select("*")
    .eq("user_id", userId)
    .order("data_prevista", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ContaReceber[];
}

export async function criarContaReceber(
  userId: string,
  input: NovaContaReceberInput,
): Promise<ContaReceber> {
  const valor = Number(input.valor_total) || 0;
  const payload = {
    user_id: userId,
    titulo: input.titulo.trim(),
    pagador_nome: input.pagador_nome?.trim() || null,
    tipo_recebimento: input.tipo_recebimento,
    valor_total: valor,
    valor_recebido: 0,
    valor_restante: valor,
    data_prevista: input.data_prevista,
    status: "pendente" as StatusContaReceber,
    categoria: input.categoria?.trim() || null,
    forma_recebimento: input.forma_recebimento || null,
    observacao: input.observacao?.trim() || null,
    origem: "manual",
    cliente_id: input.cliente_id ?? null,
  };
  const { data, error } = await supabase.from("contas_a_receber").insert(payload).select().single();
  if (error) throw error;
  return data as ContaReceber;
}

export async function atualizarContaReceber(
  id: string,
  fields: EditarContaReceberInput,
): Promise<ContaReceber> {
  const patch: Record<string, unknown> = {};
  if (fields.titulo !== undefined) patch.titulo = fields.titulo.trim();
  if (fields.pagador_nome !== undefined)
    patch.pagador_nome = fields.pagador_nome?.toString().trim() || null;
  if (fields.tipo_recebimento !== undefined) patch.tipo_recebimento = fields.tipo_recebimento;
  if (fields.data_prevista !== undefined) patch.data_prevista = fields.data_prevista;
  if (fields.categoria !== undefined) patch.categoria = fields.categoria?.toString().trim() || null;
  if (fields.forma_recebimento !== undefined)
    patch.forma_recebimento = fields.forma_recebimento || null;
  if (fields.observacao !== undefined)
    patch.observacao = fields.observacao?.toString().trim() || null;
  if (fields.cliente_id !== undefined) patch.cliente_id = fields.cliente_id ?? null;

  if (fields.valor_total !== undefined) {
    // Buscar para recalcular restante
    const { data: cur, error: e1 } = await supabase
      .from("contas_a_receber")
      .select("valor_recebido")
      .eq("id", id)
      .single();
    if (e1) throw e1;
    const novoTotal = Number(fields.valor_total) || 0;
    const recebido = Number((cur as { valor_recebido: number } | null)?.valor_recebido ?? 0);
    patch.valor_total = novoTotal;
    patch.valor_restante = Math.max(0, novoTotal - recebido);
    if (recebido <= 0) patch.status = "pendente";
    else if (recebido >= novoTotal) {
      patch.status = "recebido";
      patch.valor_restante = 0;
    } else {
      patch.status = "parcial";
    }
  }

  const { data, error } = await supabase
    .from("contas_a_receber")
    .update(patch as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as ContaReceber;
}

export async function excluirContaReceber(id: string): Promise<void> {
  const { error } = await supabase.from("contas_a_receber").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Marca como recebida (ou parcial). Se valor_recebido_agora não for informado,
 * marca como totalmente recebida.
 */
export async function marcarRecebida(
  id: string,
  options?: {
    valor_recebido_agora?: number;
    data_recebimento?: string;
    forma_recebimento?: FormaRecebimento | string | null;
  },
): Promise<ContaReceber> {
  const { data: cur, error: e1 } = await supabase
    .from("contas_a_receber")
    .select("valor_total,valor_recebido,forma_recebimento")
    .eq("id", id)
    .single();
  if (e1) throw e1;
  const total = Number((cur as { valor_total: number } | null)?.valor_total ?? 0);
  const jaRecebido = Number((cur as { valor_recebido: number } | null)?.valor_recebido ?? 0);
  const recebidoAgora =
    options?.valor_recebido_agora !== undefined
      ? Number(options.valor_recebido_agora) || 0
      : Math.max(0, total - jaRecebido);
  const novoRecebido = Math.min(total, jaRecebido + recebidoAgora);
  const novoRestante = Math.max(0, total - novoRecebido);
  const status: StatusContaReceber = novoRestante <= 0 ? "recebido" : "parcial";

  const patch: Record<string, unknown> = {
    valor_recebido: novoRecebido,
    valor_restante: novoRestante,
    status,
    data_recebimento: status === "recebido" ? (options?.data_recebimento ?? todayISO()) : null,
  };
  if (options?.forma_recebimento !== undefined) patch.forma_recebimento = options.forma_recebimento;

  const { data, error } = await supabase
    .from("contas_a_receber")
    .update(patch as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as ContaReceber;
}

export async function desmarcarRecebida(id: string): Promise<ContaReceber> {
  const { data: cur, error: e1 } = await supabase
    .from("contas_a_receber")
    .select("valor_total")
    .eq("id", id)
    .single();
  if (e1) throw e1;
  const total = Number((cur as { valor_total: number } | null)?.valor_total ?? 0);
  const { data, error } = await supabase
    .from("contas_a_receber")
    .update({
      valor_recebido: 0,
      valor_restante: total,
      data_recebimento: null,
      status: "pendente",
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as ContaReceber;
}

export async function cancelarContaReceber(id: string): Promise<ContaReceber> {
  const { data, error } = await supabase
    .from("contas_a_receber")
    .update({ status: "cancelado" })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as ContaReceber;
}

export type ResumoContasReceber = {
  total: number;
  totalPrevisto: number;
  totalRecebido: number;
  totalPendente: number;
  totalAtrasado: number;
  countPendentes: number;
  countAtrasadas: number;
  countRecebidas: number;
  proxima: ContaReceber | null;
  diasParaProxima: number | null;
};

export function calcularResumo(lista: ContaReceber[]): ResumoContasReceber {
  let totalPrevisto = 0;
  let totalRecebido = 0;
  let totalPendente = 0;
  let totalAtrasado = 0;
  let countPendentes = 0;
  let countAtrasadas = 0;
  let countRecebidas = 0;
  const hoje = todayISO();

  const ativas = lista.filter((c) => c.status !== "cancelado");
  for (const c of ativas) {
    totalPrevisto += Number(c.valor_total) || 0;
    totalRecebido += Number(c.valor_recebido) || 0;
    const eff = statusEfetivo(c);
    if (eff === "recebido") countRecebidas++;
    else {
      const restante = Number(c.valor_restante) || 0;
      if (eff === "atrasado") {
        totalAtrasado += restante;
        countAtrasadas++;
      } else {
        totalPendente += restante;
        countPendentes++;
      }
    }
  }

  const futuras = ativas
    .filter((c) => statusEfetivo(c) !== "recebido")
    .sort((a, b) => a.data_prevista.localeCompare(b.data_prevista));
  const proxima = futuras[0] ?? null;
  let diasParaProxima: number | null = null;
  if (proxima) {
    const d1 = new Date(hoje + "T00:00:00");
    const d2 = new Date(proxima.data_prevista + "T00:00:00");
    diasParaProxima = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  }

  return {
    total: ativas.length,
    totalPrevisto,
    totalRecebido,
    totalPendente,
    totalAtrasado,
    countPendentes,
    countAtrasadas,
    countRecebidas,
    proxima,
    diasParaProxima,
  };
}
