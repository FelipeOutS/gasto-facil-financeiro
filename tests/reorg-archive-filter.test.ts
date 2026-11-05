import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  REORG_ARCHIVE_SCHEMA_DEPLOYED,
  REORG_ARCHIVED_TABLES,
  reorgAtivoFilter,
  reorgAtivos,
} from "@/server/reorg-archive-filter";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("registros arquivados pela limpeza total", () => {
  it("toda leitura/atualização do servidor nas tabelas arquivadas aplica o filtro", () => {
    const files = [...walk("src/server"), "src/lib/pluggy/settlements.functions.ts"];
    const tables = REORG_ARCHIVED_TABLES.join("|");
    const re = new RegExp(`([\\w.$]+)\\s*\\.from\\("(${tables})"\\)\\s*\\.(select|update)\\(`, "g");
    const faltando: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(re)) {
        const antes = src.slice(Math.max(0, m.index! - 12), m.index!);
        if (!antes.endsWith("reorgAtivos(")) faltando.push(`${f}:${m[2]}`);
      }
    }
    expect(faltando).toEqual([]);
  });

  it("filtra arquivados quando a coluna existir e é no-op enquanto não existir", () => {
    expect(reorgAtivoFilter(true)).toEqual(["reorg_archived_at", "is", "null"]);
    expect(reorgAtivoFilter(false)).toEqual(["id", "not.is", "null"]);
    expect(REORG_ARCHIVE_SCHEMA_DEPLOYED).toBe(false);
    const calls: unknown[] = [];
    const q = { is: (c: string, v: null) => (calls.push([c, v]), q) };
    expect(reorgAtivos(q, false)).toBe(q);
    expect(calls).toEqual([]);
    reorgAtivos(q, true);
    expect(calls).toEqual([["reorg_archived_at", null]]);
  });
});
