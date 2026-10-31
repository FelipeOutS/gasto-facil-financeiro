/** Never presents truncated/failed reads as complete administrative totals. */
export async function readAllAdminRows<T>(read: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: unknown; count: number | null;
}>) {
  const rows: T[] = [];
  let expected: number | null = null;
  for (let page = 0; page < 1000; page++) {
    const result = await read(rows.length, rows.length + 499);
    if (result.error || !result.data || result.count === null) throw new Error("Consulta administrativa incompleta. Tente novamente.");
    if (expected !== null && result.count !== expected) throw new Error("Os dados mudaram durante a consulta. Atualize o painel.");
    expected = result.count;
    rows.push(...result.data);
    if (rows.length === expected) return { data: rows, error: null };
    if (!result.data.length || rows.length > expected) throw new Error("Paginação administrativa inconsistente.");
  }
  throw new Error("Volume administrativo excedeu o limite seguro de consulta.");
}
