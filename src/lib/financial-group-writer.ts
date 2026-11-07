export const FINANCIAL_GROUP_WRITER_AUTHORIZED = false;
export type FinancialGroupKind = "manual" | "installments" | "recurrence" | "csv" | "pdf" | "image";
export type FinancialGroupRequest = { ownerId: string; operationId: string; generation: number; kind: FinancialGroupKind; rows: {table: "gastos" | "receitas"; row: Record<string,unknown>}[] };
export interface FinancialGroupRpc { rpc(name: string, args: Record<string,unknown>): PromiseLike<{data: unknown; error: {message: string} | null}> }
/** Caller retains immutable operation/generation/payload across transport retries. SQL revalidates all authority. */
export async function writeFinancialGroup(db: FinancialGroupRpc, request: FinancialGroupRequest) {
  if (!Number.isSafeInteger(request.generation) || request.generation < 0 || !request.rows.length) throw new Error("invalid_financial_group");
  const {data,error} = await db.rpc("financial_group_write", {p_owner:request.ownerId,p_operation:request.operationId,p_generation:request.generation,p_kind:request.kind,p_rows:request.rows});
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object") throw new Error("invalid_financial_group_response");
  const status = Reflect.get(data,"status"); const rows = Reflect.get(data,"rows");
  if ((status !== "committed" && status !== "replay") || !Array.isArray(rows) || Reflect.get(data,"operationId") !== request.operationId) throw new Error("invalid_financial_group_response");
  return {status,rows};
}