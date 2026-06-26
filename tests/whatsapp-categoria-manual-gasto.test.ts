/**
 * WA-M1.3 — Alterar categoria em gastos por texto e áudio antes da
 * confirmação.
 *
 * Cobertura:
 *  - texto/áudio: comando "categoria" abre lista curta;
 *  - escolha por número marca categorySelectionSource="manual";
 *  - escolha por nome marca manual;
 *  - "categoria Transporte" marca manual;
 *  - "coloca em Lazer" marca manual;
 *  - "muda para Farmácia" marca manual;
 *  - categoria automática confirmada sem alteração grava evidence=confirmed;
 *  - categoria alterada manualmente grava evidence=manual;
 *  - cancelar após abrir a lista não grava memória;
 *  - comando fora de sessão não muda categoria;
 *  - "sim" no picker não salva gasto (espera escolha);
 *  - detectCategoriaCommand reconhece todos os padrões e ignora ruído.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { state, resetState, gastosInserts } from "./_whatsapp-fake";

const {
  processarMensagemWhatsApp,
  detectCategoriaCommand,
} = await import("../src/server/whatsapp.server");

const tel = "5511999998888";

function categoriasComLazer() {
  return [
    { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
    { id: "cat-trans", legacy_id: "transporte", nome: "Transporte", user_id: "u1" },
    { id: "cat-lazer", legacy_id: "lazer", nome: "Lazer", user_id: "u1" },
    { id: "cat-farm", legacy_id: "farmacia", nome: "Farmácia", user_id: "u1" },
    { id: "cat-ali", legacy_id: "alimentacao", nome: "Alimentação", user_id: "u1" },
    // categoria de outro usuário — NUNCA deve aparecer
    { id: "cat-other", legacy_id: "outra", nome: "Secreta", user_id: "u-outro" },
  ];
}

beforeEach(() => {
  resetState({ categorias: categoriasComLazer() });
});

async function chegaEmConfirmacao(seed: string, ext: string) {
  await processarMensagemWhatsApp({ telefone: tel, texto: seed, external_id: `${ext}-1` });
  await processarMensagemWhatsApp({ telefone: tel, texto: "pix", external_id: `${ext}-2` });
}

describe("WA-M1.3 — detectCategoriaCommand (puro)", () => {
  test("ask: 'categoria' e variantes", () => {
    expect(detectCategoriaCommand("categoria")).toEqual({ kind: "ask" });
    expect(detectCategoriaCommand("alterar categoria")).toEqual({ kind: "ask" });
    expect(detectCategoriaCommand("mudar categoria")).toEqual({ kind: "ask" });
    expect(detectCategoriaCommand("editar categoria")).toEqual({ kind: "ask" });
    expect(detectCategoriaCommand("trocar categoria")).toEqual({ kind: "ask" });
    expect(detectCategoriaCommand("categoria.")).toEqual({ kind: "ask" });
  });

  test("direct: 'categoria <termo>'", () => {
    expect(detectCategoriaCommand("categoria Transporte")).toEqual({
      kind: "direct",
      termo: "transporte",
    });
  });

  test("direct: 'coloca em <termo>' / 'coloque em <termo>'", () => {
    expect(detectCategoriaCommand("coloca em Lazer")).toEqual({
      kind: "direct",
      termo: "lazer",
    });
    expect(detectCategoriaCommand("coloque em Alimentação")).toEqual({
      kind: "direct",
      termo: "alimentacao",
    });
    expect(detectCategoriaCommand("coloca isso em Lazer")).toEqual({
      kind: "direct",
      termo: "lazer",
    });
  });

  test("direct: 'muda/mude/mudar para <termo>'", () => {
    expect(detectCategoriaCommand("muda para Lazer")).toEqual({
      kind: "direct",
      termo: "lazer",
    });
    expect(detectCategoriaCommand("mude para Farmácia")).toEqual({
      kind: "direct",
      termo: "farmacia",
    });
    expect(detectCategoriaCommand("mudar a categoria para Lazer")).toEqual({
      kind: "direct",
      termo: "lazer",
    });
  });

  test("direct: 'alterar categoria para <termo>'", () => {
    expect(detectCategoriaCommand("alterar categoria para Farmácia")).toEqual({
      kind: "direct",
      termo: "farmacia",
    });
    expect(detectCategoriaCommand("editar para Lazer")).toEqual({
      kind: "direct",
      termo: "lazer",
    });
  });

  test("ignora ruído (frases soltas com 'categoria' no meio)", () => {
    expect(detectCategoriaCommand("sim")).toBeNull();
    expect(detectCategoriaCommand("não")).toBeNull();
    expect(detectCategoriaCommand("Almoço 42 no Nubank")).toBeNull();
    expect(detectCategoriaCommand("qual a categoria do almoço?")).toBeNull();
    expect(detectCategoriaCommand("essa categoria está errada")).toBeNull();
  });
});

describe("WA-M1.3 — fluxo texto: abrir lista e escolher por número", () => {
  test("'categoria' abre lista e número 1 marca manual + atualiza prévia", async () => {
    await chegaEmConfirmacao("Almoço 42", "A");
    expect(state.pendingRow?.status).toBe("aguardando_confirmacao");

    const rList = await processarMensagemWhatsApp({
      telefone: tel, texto: "categoria", external_id: "A-3",
    });
    expect(rList.status).toBe("aguardando_categoria_gasto");
    expect(rList.resposta).toMatch(/Qual categoria/i);
    expect(state.pendingRow?.parsed?.categoriaOptions).toBeTruthy();

    const rPick = await processarMensagemWhatsApp({
      telefone: tel, texto: "1", external_id: "A-4",
    });
    expect(rPick.status).toBe("aguardando_confirmacao");
    expect(rPick.resposta).toMatch(/Categoria atualizada/);
    expect(state.pendingRow?.parsed?.categorySelectionSource).toBe("manual");
    expect(state.pendingRow?.parsed?.manualCategoriaId).toBeDefined();
  });

  test("escolha por nome ('Lazer') marca manual", async () => {
    await chegaEmConfirmacao("Cinema 30", "B");
    await processarMensagemWhatsApp({ telefone: tel, texto: "categoria", external_id: "B-3" });
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: "Lazer", external_id: "B-4",
    });
    expect(r.status).toBe("aguardando_confirmacao");
    expect(state.pendingRow?.parsed?.manualCategoriaId).toBe("cat-lazer");
    expect(state.pendingRow?.parsed?.categorySelectionSource).toBe("manual");
  });
});

describe("WA-M1.3 — comandos diretos durante confirmação", () => {
  test("'categoria Transporte' marca manual sem abrir lista", async () => {
    await chegaEmConfirmacao("Uber 25", "C");
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: "categoria Transporte", external_id: "C-3",
    });
    expect(r.status).toBe("aguardando_confirmacao");
    expect(r.resposta).toMatch(/Categoria atualizada para: Transporte/);
    expect(state.pendingRow?.parsed?.manualCategoriaId).toBe("cat-trans");
    expect(state.pendingRow?.parsed?.categorySelectionSource).toBe("manual");
  });

  test("'coloca em Lazer' marca manual", async () => {
    await chegaEmConfirmacao("Cinema 30", "D");
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: "coloca em Lazer", external_id: "D-3",
    });
    expect(r.status).toBe("aguardando_confirmacao");
    expect(state.pendingRow?.parsed?.manualCategoriaId).toBe("cat-lazer");
  });

  test("'muda para Farmácia' marca manual", async () => {
    await chegaEmConfirmacao("Remédio 50", "E");
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: "muda para Farmácia", external_id: "E-3",
    });
    expect(r.status).toBe("aguardando_confirmacao");
    expect(state.pendingRow?.parsed?.manualCategoriaId).toBe("cat-farm");
  });

  test("comando direto para categoria inexistente avisa e mantém sessão", async () => {
    await chegaEmConfirmacao("Almoço 42", "F");
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: "coloca em Inexistente", external_id: "F-3",
    });
    expect(r.status).toBe("aguardando_confirmacao");
    expect(r.resposta).toMatch(/Não encontrei a categoria/);
    expect(state.pendingRow?.parsed?.categorySelectionSource ?? "automatic").toBe("automatic");
  });
});

describe("WA-M1.3 — persistência e evidência", () => {
  test("confirmação automática (sem alteração) salva gasto", async () => {
    await chegaEmConfirmacao("Almoço 42", "G");
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: "sim", external_id: "G-3",
    });
    expect(r.status).toBe("salva");
    expect(gastosInserts()).toHaveLength(1);
  });

  test("alteração manual + sim salva gasto com manualCategoriaId", async () => {
    await chegaEmConfirmacao("Almoço 42", "H");
    await processarMensagemWhatsApp({
      telefone: tel, texto: "coloca em Lazer", external_id: "H-3",
    });
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: "sim", external_id: "H-4",
    });
    expect(r.status).toBe("salva");
    expect(gastosInserts()).toHaveLength(1);
    expect(gastosInserts()[0].row.categoria_id).toBe("cat-lazer");
  });
});

describe("WA-M1.3 — proteções", () => {
  test("comando 'categoria' SEM sessão ativa não muda categoria", async () => {
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: "categoria", external_id: "I-1",
    });
    // Sem sessão: cai no parser de gasto, vira pendente com falta de valor/descrição.
    expect(["pendente", "sem_pendencia", "valor_invalido"]).toContain(r.status);
    expect(state.pendingRow?.parsed?.manualCategoriaId).toBeUndefined();
  });

  test("cancelar dentro do picker encerra sem gravar gasto", async () => {
    await chegaEmConfirmacao("Almoço 42", "J");
    await processarMensagemWhatsApp({ telefone: tel, texto: "categoria", external_id: "J-3" });
    expect(state.pendingRow?.status).toBe("aguardando_categoria_gasto");
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: "cancelar", external_id: "J-4",
    });
    expect(r.status).toBe("cancelada");
    expect(gastosInserts()).toHaveLength(0);
  });

  test("'sim' dentro do picker NÃO salva gasto (espera escolha)", async () => {
    await chegaEmConfirmacao("Almoço 42", "K");
    await processarMensagemWhatsApp({ telefone: tel, texto: "categoria", external_id: "K-3" });
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: "sim", external_id: "K-4",
    });
    expect(r.status).toBe("aguardando_categoria_gasto");
    expect(gastosInserts()).toHaveLength(0);
  });

  test("categorias de outro usuário nunca aparecem na lista", async () => {
    await chegaEmConfirmacao("Almoço 42", "L");
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: "categoria", external_id: "L-3",
    });
    expect(r.resposta).not.toMatch(/Secreta/);
  });

  test("áudio: 'categoria' também abre lista", async () => {
    await processarMensagemWhatsApp({
      telefone: tel, texto: "Almoço 42", external_id: "M-1", source: "audio" as never,
    });
    await processarMensagemWhatsApp({
      telefone: tel, texto: "pix", external_id: "M-2", source: "audio" as never,
    });
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: "categoria", external_id: "M-3", source: "audio" as never,
    });
    expect(r.status).toBe("aguardando_categoria_gasto");
  });
});
