// Diagnóstico SOMENTE LEITURA para "GI, exclua tudo" enquanto o executor
// reversível não está instalado. Nunca grava, nunca cria código/sessão.
// O userId vem exclusivamente do vínculo WhatsApp resolvido no servidor.
import { reorgAtivos } from "./reorg-archive-filter";

const LIMIT = 5000;
type Row = Record<string, unknown>;
export type DiagReader = (table: string, cols: string, apply: (q: any) => any) => Promise<Row[] | null>;

export function supabaseDiagReader(client: any, userId: string): DiagReader {
  return async (table, cols, apply) => {
    try {
      const { data, error } = await apply(client.from(table).select(cols).eq("user_id", userId)).limit(LIMIT + 1);
      if (error || !Array.isArray(data) || data.length > LIMIT) return null;
      return data as Row[];
    } catch { return null; }
  };
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const sum = (rows: Row[], col: string) => rows.reduce((s, r) => s + (Number(r[col]) || 0), 0);
const line = (label: string, rows: Row[] | null, col?: string) =>
  rows === null ? `• ${label}: não foi possível consultar` : `• ${label}: ${rows.length}${col ? ` (${brl(sum(rows, col))})` : ""}`;

export async function buildReorganizationDiagnostic(read: DiagReader): Promise<string> {
  // soft-delete-exceção: diagnóstico separa explicitamente ativos e já excluídos.
  const [gA, gD, rA, rD, cp, cr, fat, rec] = await Promise.all([
    read("gastos", "valor,cartao_id,recorrencia_id,parcela_atual", (q) => q.is("deleted_at", null)),
    read("gastos", "valor", (q) => q.not("deleted_at", "is", null)),
    read("receitas", "valor,recorrencia_id", (q) => q.is("deleted_at", null)),
    read("receitas", "valor", (q) => q.not("deleted_at", "is", null)),
    read("contas_a_pagar", "valor", (q) => reorgAtivos(q)),
    read("contas_a_receber", "valor_total", (q) => reorgAtivos(q)),
    read("faturas_cartao", "status", (q) => reorgAtivos(q)),
    read("recorrencias", "valor", (q) => reorgAtivos(q)),
  ]);
  const sub = (rows: Row[] | null, f: (r: Row) => boolean) => (rows === null ? null : rows.filter(f));
  return [
    "Diagnóstico somente leitura dos SEUS registros (não é a prévia definitiva da limpeza reversível):",
    line("Gastos ativos", gA, "valor"),
    line("  dos quais em cartão", sub(gA, (r) => r.cartao_id != null), "valor"),
    line("  dos quais parcelados", sub(gA, (r) => r.parcela_atual != null), "valor"),
    line("  dos quais recorrentes", sub(gA, (r) => r.recorrencia_id != null), "valor"),
    line("Gastos já excluídos", gD, "valor"),
    line("Receitas ativas", rA, "valor"),
    line("  das quais recorrentes", sub(rA, (r) => r.recorrencia_id != null), "valor"),
    line("Receitas já excluídas", rD, "valor"),
    line("Contas a pagar", cp, "valor"),
    line("Contas a receber", cr, "valor_total"),
    line("Faturas de cartão", fat),
    line("Regras de recorrência", rec, "valor"),
    "A limpeza e a restauração por WhatsApp continuam bloqueadas. Nada foi alterado e nenhum código de confirmação foi gerado.",
  ].join("\n");
}
