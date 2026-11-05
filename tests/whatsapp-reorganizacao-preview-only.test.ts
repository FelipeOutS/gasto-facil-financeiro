import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  runReorganization,
  previewOnlyReply,
  WHATSAPP_REORGANIZACAO_PREVIEW_ONLY,
  WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED,
  type ReorganizationStore,
} from "@/server/whatsapp-reorganizacao.server";

function store() {
  const s = {
    authorize: vi.fn(async () => true),
    prepare: vi.fn(async () => ({ status: "preview", mode: "full", expenses: 15, incomes: 14, totalExpenses: 26842.17, totalIncomes: 44020, operationId: "op", code: "123456", expiresAt: "x", complete: true, leftOut: [] })),
    confirm: vi.fn(async () => ({ status: "applied" })),
    cancel: vi.fn(async () => ({ status: "cancelled" })),
    status: vi.fn(async () => ({ status: "none" })),
    restore: vi.fn(async () => ({ status: "restored" })),
    confirmRestore: vi.fn(async () => ({ status: "restored" })),
    prepareRestore: vi.fn(async () => ({ status: "restore_preview" })),
    resolveLastApplied: vi.fn(async () => "op"),
  };
  return s as unknown as ReorganizationStore & typeof s;
}
const base = { userId: "u", phone: "5511", externalId: "m", localDate: "2026-11-04", pendingSession: false };

describe("trava somente prévia da limpeza por WhatsApp", () => {
  it("vem ligada e a liberação geral continua desligada", () => {
    expect(WHATSAPP_REORGANIZACAO_PREVIEW_ONLY).toBe(true);
    expect(WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED).toBe(false);
  });
  it("'GI, exclua tudo' mostra a prévia", async () => {
    const s = store();
    const r = await runReorganization({ ...base, text: "GI, exclua todos os meus gastos e receitas. Quero zerar meu histórico financeiro." }, s, { previewOnly: true });
    expect(s.prepare).toHaveBeenCalledTimes(1);
    expect(r).toContain("15 gastos");
  });
  it.each(["APAGAR 123456", "APAGAR 3f1c2a4e-1111-2222-3333-444455556666 123456", "apagar um dois três quatro cinco seis", "RESTAURAR 3f1c2a4e-1111-2222-3333-444455556666 123456", "restaurar última limpeza"])(
    "não executa nem restaura com '%s'", async (text) => {
      const s = store();
      const r = await runReorganization({ ...base, text }, s, { previewOnly: true });
      expect(r).toBe(previewOnlyReply);
      expect(s.confirm).not.toHaveBeenCalled();
      expect(s.confirmRestore).not.toHaveBeenCalled();
      expect(s.prepareRestore).not.toHaveBeenCalled();
    });
  it("o despacho de produção sempre passa a trava", () => {
    const src = readFileSync("src/server/whatsapp-reorganization-dispatch.server.ts", "utf8");
    expect(src).toContain("{previewOnly:WHATSAPP_REORGANIZACAO_PREVIEW_ONLY}");
  });
});
