export type ImportRow = Record<string,unknown>;
/** Stable manifest must be retained by the caller after timeout. Deleted rows are proof of persistence, not permission to revive them. */
export async function commitFinancialImport(rows: ImportRow[], read: ()=>Promise<{rows:ImportRow[];error?:string}>, insert: ()=>Promise<{error?:string}>) {
  const same = (actual: ImportRow[]) => rows.length===actual.length && rows.every(row=>{
    const found=actual.find(saved=>saved.id===row.id);
    return found && Object.entries(row).every(([key,value])=>JSON.stringify(found[key]??null)===JSON.stringify(value??null));
  });
  const before=await read();
  if(before.error) throw new Error(before.error);
  if(before.rows.length) { if(!same(before.rows)) throw new Error("financial_import_manifest_conflict"); return {replay:true}; }
  const written=await insert();
  if(!written.error) return {replay:false};
  const after=await read();
  if(!after.error && same(after.rows)) return {replay:true};
  throw new Error(written.error);
}