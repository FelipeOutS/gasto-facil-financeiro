export async function addGastoAwait(input: unknown, owner: string, id: string, actor: string) {
  return save("expense", input, owner, id, actor);
}
export async function addReceitaAwait(input: unknown, owner: string, id: string, actor: string) {
  return save("income", input, owner, id, actor);
}
async function save(type: string, input: unknown, owner: string, id: string, actor: string) {
  const w = window as any;
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (w.deny || w.networkFailure)
    return { ok: false, error: w.deny ? "permission denied" : "network failure" };
  w.writes.push({ type, input, owner, id, actor });
  return { ok: true };
}
