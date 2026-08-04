/**
 * WA-F3.3-Fix-UX — ack visual ao ajustar categoria durante
 * parc_aguardando_confirmacao.
 *
 * Garante que, ao receber "categoria <nome>" com nome reconhecido:
 *   1. a sessão recebe manualCategoria* e categorySelectionSource="manual";
 *   2. a resposta começa com "✓ Categoria atualizada para <Nome>.";
 *   3. a prévia segue re-renderizada com "Categoria: <Nome>";
 *   4. o status permanece "aguardando_confirmacao" (sessão persistida
 *      como parc_aguardando_confirmacao no DB);
 *   5. nenhum gasto é gravado.
 *
 * E, ao receber "categoria <nome>" com nome NÃO reconhecido:
 *   - a sessão NÃO é alterada (sem manualCategoria*) e nenhum gasto é
 *     gravado.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import "./_whatsapp-fake";
import { resetState, state, gastosInserts } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

function msg(texto: string, externalId = "e-1") {
  return {
    external_id: externalId,
    telefone: "5511999998888",
    texto,
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
  };
}

function nubank(diaFechamento = 1) {
  return {
    id: "c-nu",
    nome: "Nubank",
    banco: "Nubank",
    limite_total: 0,
    dia_fechamento: diaFechamento,
    dia_vencimento: 10,
    cor: "#000",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function ultimaSessaoParsed(): Record<string, unknown> | null {
  return (state.pendingRow?.parsed as Record<string, unknown> | undefined) ?? null;
}

function ultimaSessaoStatus(): string | null {
  return state.pendingRow?.status ?? null;
}

describe("WA-F3.3-Fix-UX — ack de categoria no parcelamento", () => {
  beforeEach(() => resetState({ cartoes: [nubank()] }));

  it("categoria reconhecida: atualiza sessão + ack + preview + status", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const out = await processarMensagemWhatsApp(msg("categoria Mercado", "e-2"));

    // (1) status mantém-se em aguardando_confirmacao
    expect(out.status).toBe("aguardando_confirmacao");

    // (2) ack prefixa a prévia
    expect(out.resposta.startsWith("✓ Categoria atualizada para Mercado.")).toBe(true);

    // (3) preview re-renderizado contém a categoria nova
    expect(out.resposta).toContain("Categoria: Mercado");

    // (4) sessão persistida com manualCategoria*
    const parsed = ultimaSessaoParsed() as {
      manualCategoriaId?: string;
      manualCategoriaLabel?: string;
      categorySelectionSource?: string;
    } | null;
    expect(parsed?.manualCategoriaId).toBe("cat-mer");
    expect(parsed?.manualCategoriaLabel).toBe("Mercado");
    expect(parsed?.categorySelectionSource).toBe("manual");
    expect(ultimaSessaoStatus()).toBe("parc_aguardando_confirmacao");

    // (5) nenhuma escrita financeira
    expect(gastosInserts().length).toBe(0);
  });

  it("ack é one-shot: não vaza para a próxima prévia", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    await processarMensagemWhatsApp(msg("categoria Mercado", "e-2"));
    // Reenvia comando de categoria; nova prévia também tem ack, mas
    // ack anterior já foi consumido (não duplica).
    const out = await processarMensagemWhatsApp(msg("categoria Saúde", "e-3"));
    expect(out.status).toBe("aguardando_confirmacao");
    expect(out.resposta.startsWith("✓ Categoria atualizada para Saúde.")).toBe(true);
    // não deve conter "Mercado" no ack (apenas no body se acaso aparecer
    // como nome de categoria — confere que ack é exatamente o novo).
    const firstLine = out.resposta.split("\n")[0];
    expect(firstLine).toBe("✓ Categoria atualizada para Saúde.");
    expect(out.resposta).toContain("Categoria: Saúde");
    expect(gastosInserts().length).toBe(0);
  });

  it("categoria inexistente: sessão não é alterada e nada é gravado", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const out = await processarMensagemWhatsApp(msg("categoria Petshop123Inexistente", "e-2"));

    // Resposta orienta o usuário e NÃO contém ack falso.
    expect(out.resposta.toLowerCase()).toContain("não encontrei");
    expect(out.resposta.startsWith("✓ Categoria atualizada")).toBe(false);

    // Sessão segue sem manualCategoria*.
    const parsed = ultimaSessaoParsed() as {
      manualCategoriaId?: string;
      manualCategoriaLabel?: string;
      categorySelectionSource?: string;
    } | null;
    expect(parsed?.manualCategoriaId).toBeUndefined();
    expect(parsed?.manualCategoriaLabel).toBeUndefined();
    expect(parsed?.categorySelectionSource).not.toBe("manual");

    expect(gastosInserts().length).toBe(0);
  });
});
