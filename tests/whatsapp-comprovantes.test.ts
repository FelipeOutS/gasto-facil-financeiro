/**
 * Fase WA-G5A — leitura de comprovante pelo WhatsApp.
 * Mock do OCR via __setOcrExtractorForTests para não chamar a rede.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, gastosInserts } from "./_whatsapp-fake";
import type { ParsedExpense } from "../src/lib/whatsappParser";

const {
  processarMensagemWhatsApp,
  buscarSessaoComprovanteAtiva,
  __setExpenseParserForTests,
  __setWhatsAppAuditObserverForTests,
} = await import(
  "../src/server/whatsapp.server"
);
const { __setOcrExtractorForTests } = await import(
  "../src/server/ocr-comprovante.server"
);

const tel = "5511999998888";

// Imagem fake = data URL mínima válida; o OCR mock ignora o conteúdo.
function fakeImage(hash = "img-abc-1") {
  return {
    base64: "data:image/jpeg;base64,/9j/AAAA",
    mimeType: "image/jpeg",
    sha256: hash,
  };
}

// Configura o OCR mock para devolver `result` na próxima chamada.
function mockOcr(result: Partial<{
  valor: number | null;
  descricao: string | null;
  data: string | null;
  categoriaSugerida: string | null;
  formaPagamento: string | null;
  confianca: "alta" | "media" | "baixa";
}>) {
  __setOcrExtractorForTests(async () => ({
    ok: true,
    data: {
      valor: result.valor ?? null,
      valoresEncontrados: result.valor ? [result.valor] : [],
      data: result.data ?? null,
      descricao: result.descricao ?? null,
      categoriaSugerida: result.categoriaSugerida ?? null,
      formaPagamento: result.formaPagamento ?? null,
      confianca: result.confianca ?? "alta",
      observacao: null,
    },
  }));
}

beforeEach(() => {
  resetState();
  __setOcrExtractorForTests(null);
  __setExpenseParserForTests(null);
  __setWhatsAppAuditObserverForTests(null);
});

// ---------------------------------------------------------------------
test("Imagem com leitura completa gera resumo e NÃO cria gasto", async () => {
  mockOcr({
    valor: 48.9,
    descricao: "Mercado Assaí",
    data: "2026-06-22",
    categoriaSugerida: "mercado",
    formaPagamento: "pix",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "",
    external_id: "img-1",
    image: fakeImage(),
  });
  expect(r.resposta).toContain("Li esta nota");
  expect(r.resposta).toContain("Mercado Assaí");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 48,90");
  expect(state.pendingRow?.status).toBe("img_aguardando_confirmacao");
  expect(gastosInserts()).toHaveLength(0);
});

test("Confirmação com 'sim' cria UM único gasto via WhatsApp", async () => {
  mockOcr({
    valor: 30,
    descricao: "Uber",
    data: null, // sem data no OCR → usa hoje, sem confirmação extra
    categoriaSugerida: "transporte",
    formaPagamento: "credito",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-c1", image: fakeImage("h-c1"),
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "img-c1-yes",
  });
  expect(r.status).toBe("salva");
  const inserts = gastosInserts();
  expect(inserts).toHaveLength(1);
  expect(inserts[0].row.origem).toBe("whatsapp");
  expect(Number(inserts[0].row.valor)).toBe(30);
  expect(inserts[0].row.descricao).toBe("Uber");
});

test("Resposta 'não' não cria gasto e encerra a sessão de imagem", async () => {
  mockOcr({ valor: 12, descricao: "Padaria", data: "2026-06-22" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-n1", image: fakeImage("h-n1"),
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "não", external_id: "img-n1-no",
  });
  expect(r.status).toBe("cancelada");
  expect(gastosInserts()).toHaveLength(0);
});

test("'cancelar' limpa a sessão de imagem sem criar gasto", async () => {
  mockOcr({ valor: 12, descricao: "Padaria", data: "2026-06-22" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-x1", image: fakeImage("h-x1"),
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "cancelar", external_id: "img-x1-cancel",
  });
  expect(r.status).toBe("cancelada");
  expect(gastosInserts()).toHaveLength(0);
  expect(state.pendingRow).toBeNull();
});

test("Imagem ilegível não cria gasto e pede foto mais nítida", async () => {
  mockOcr({ valor: null, descricao: null });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-i1", image: fakeImage("h-i1"),
  });
  expect(r.resposta).toContain("Não consegui ler esta nota");
  expect(gastosInserts()).toHaveLength(0);
});

test("Só valor identificado → pergunta a descrição", async () => {
  mockOcr({ valor: 25.5, descricao: null });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-v1", image: fakeImage("h-v1"),
  });
  expect(r.resposta).toContain("Consegui identificar o valor");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 25,50");
  expect(state.pendingRow?.status).toBe("img_aguardando_descricao");
});

test("Só descrição identificada → pergunta o valor", async () => {
  mockOcr({ valor: null, descricao: "iFood" });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-d1", image: fakeImage("h-d1"),
  });
  expect(r.resposta).toContain("iFood");
  expect(r.resposta.toLowerCase()).toContain("qual foi o valor");
  expect(state.pendingRow?.status).toBe("img_aguardando_valor");
});

test("Ajuste de valor refaz o resumo com o novo valor", async () => {
  mockOcr({
    valor: 99, descricao: "Mercado", data: "2026-06-22",
    categoriaSugerida: "mercado", formaPagamento: "pix",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-aj1", image: fakeImage("h-aj1"),
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "valor 52,90", external_id: "img-aj1-v",
  });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 52,90");
  expect(r.resposta).toContain("Li esta nota");
});

test("Ajuste de descrição via fluxo 'alterar descrição' → resumo atualizado", async () => {
  mockOcr({ valor: 30, descricao: "Padaria", data: "2026-06-22", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-aj2", image: fakeImage("h-aj2"),
  });
  const ask = await processarMensagemWhatsApp({
    telefone: tel, texto: "alterar descrição", external_id: "img-aj2-a",
  });
  expect(ask.resposta).toContain("Qual descrição");
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "Padaria Central", external_id: "img-aj2-b",
  });
  expect(r.resposta).toContain("Padaria Central");
});

test("Ajuste de categoria usa apenas categoria existente do usuário", async () => {
  mockOcr({
    valor: 30, descricao: "Uber", data: "2026-06-22",
    categoriaSugerida: "outros", formaPagamento: "pix",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-aj3", image: fakeImage("h-aj3"),
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "categoria Transporte", external_id: "img-aj3-c",
  });
  expect(r.resposta).toContain("Transporte");
});

test("Ajuste de data com 'ontem' atualiza o resumo", async () => {
  mockOcr({ valor: 30, descricao: "Uber", data: "2026-06-22", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-aj4", image: fakeImage("h-aj4"),
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "data ontem", external_id: "img-aj4-d",
  });
  expect(r.resposta).toContain("Ontem");
});

test("Sem forma de pagamento detectada → 'sim' pergunta como pagou antes de salvar", async () => {
  mockOcr({ valor: 30, descricao: "Uber", data: null, categoriaSugerida: "transporte", formaPagamento: null });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-p1", image: fakeImage("h-p1"),
  });
  const pre = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "img-p1-yes",
  });
  expect(pre.resposta).toContain("Como você pagou");
  expect(gastosInserts()).toHaveLength(0);
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "pix", external_id: "img-p1-pix",
  });
  expect(r.status).toBe("salva");
  expect(gastosInserts()).toHaveLength(1);
  expect(gastosInserts()[0].row.forma_pagamento).toBe("pix");
});

test("Imagem durante sessão de gasto pendente NÃO interrompe o fluxo", async () => {
  // Inicia sessão de gasto sem valor
  const start = await processarMensagemWhatsApp({
    telefone: tel, texto: "registrar gasto", external_id: "gx-1",
  });
  expect(start.resposta.toLowerCase()).toContain("gasto");
  expect(state.pendingRow?.status).toBe("aguardando_descricao_e_valor_gasto");
  // Imagem chega agora → orienta a cancelar antes
  mockOcr({ valor: 50, descricao: "Uber" });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-gx", image: fakeImage("h-gx"),
  });
  expect(r.resposta).toContain("lançamento em andamento");
  expect(gastosInserts()).toHaveLength(0);
  expect(state.pendingRow?.status).toBe("aguardando_descricao_e_valor_gasto");
});

test("Imagem durante sessão de receita pendente NÃO interrompe o fluxo", async () => {
  await processarMensagemWhatsApp({
    telefone: tel, texto: "Quero lançar uma renda", external_id: "rx-1",
  });
  expect(state.pendingRow?.status).toBe("rec_aguardando_tipo");
  mockOcr({ valor: 50, descricao: "Uber" });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-rx", image: fakeImage("h-rx"),
  });
  expect(r.resposta).toContain("lançamento em andamento");
  expect(state.pendingRow?.status).toBe("rec_aguardando_tipo");
});

test("Imagem duplicada (mesmo hash) já salva NÃO cria segundo gasto", async () => {
  mockOcr({ valor: 30, descricao: "Uber", categoriaSugerida: "transporte", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-dup1", image: fakeImage("dup-h"),
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "img-dup1-yes",
  });
  expect(gastosInserts()).toHaveLength(1);

  // Reenviar a mesma imagem (mesmo hash). Deve ser detectada como duplicada.
  mockOcr({ valor: 30, descricao: "Uber", categoriaSugerida: "transporte", formaPagamento: "pix" });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-dup2", image: fakeImage("dup-h"),
  });
  expect(r.status).toBe("duplicada");
  expect(gastosInserts()).toHaveLength(1);
});

test("'alterar valor' pede o novo valor e depois aceita o ajuste", async () => {
  mockOcr({ valor: 99, descricao: "Mercado", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-av", image: fakeImage("h-av"),
  });
  const ask = await processarMensagemWhatsApp({
    telefone: tel, texto: "alterar valor", external_id: "img-av-q",
  });
  expect(ask.resposta).toContain("Qual valor");
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "75,00", external_id: "img-av-v",
  });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 75,00");
});

// =====================================================================
// WA-G5A.2 — confirmação melhorada
// =====================================================================

test("Descrição em CAIXA ALTA é formatada com capitalização normal", async () => {
  mockOcr({
    valor: 50,
    descricao: "EXPEDITO ALVES DE LIMA ME",
    data: null,
    categoriaSugerida: "alimentacao",
    formaPagamento: "pix",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-tc1", image: fakeImage("h-tc1"),
  });
  expect(r.resposta).toContain("Expedito Alves de Lima ME");
  expect(r.resposta).not.toContain("EXPEDITO ALVES");
});

test("OCR com CRÉDITO sugere Cartão de crédito no resumo", async () => {
  mockOcr({
    valor: 80, descricao: "Padaria", data: null,
    categoriaSugerida: "alimentacao", formaPagamento: "credito",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-fp-c", image: fakeImage("h-fp-c"),
  });
  expect(r.resposta).toContain("Pagamento: Cartão de crédito");
});

test("OCR com PIX sugere Pix no resumo e não pergunta forma de pagamento", async () => {
  mockOcr({
    valor: 25, descricao: "Lanchonete", data: null,
    categoriaSugerida: "alimentacao", formaPagamento: "pix",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-fp-p", image: fakeImage("h-fp-p"),
  });
  expect(state.pendingRow?.parsed.formaPagamento).toBe("pix");
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "img-fp-p-yes",
  });
  expect(r.status).toBe("salva");
  expect(r.resposta).not.toContain("Como você pagou");
});

test("Data antiga (>30 dias) → pergunta usar nota ou hoje antes de salvar", async () => {
  mockOcr({
    valor: 40, descricao: "Mercado", data: "2020-01-15",
    categoriaSugerida: "mercado", formaPagamento: "pix",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-dt1", image: fakeImage("h-dt1"),
  });
  const pre = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "img-dt1-yes",
  });
  expect(pre.resposta).toContain("A nota indica a data 15/01/2020");
  expect(gastosInserts()).toHaveLength(0);
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "usar data da nota", external_id: "img-dt1-keep",
  });
  expect(r.status).toBe("salva");
  expect(gastosInserts()[0].row.data).toBe("2020-01-15");
});

test("Data antiga + 'usar hoje' grava com a data de hoje", async () => {
  mockOcr({
    valor: 41, descricao: "Mercado", data: "2020-01-15",
    categoriaSugerida: "mercado", formaPagamento: "pix",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-dt2", image: fakeImage("h-dt2"),
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "img-dt2-yes",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "usar hoje", external_id: "img-dt2-hoje",
  });
  expect(r.status).toBe("salva");
  expect(gastosInserts()[0].row.data).not.toBe("2020-01-15");
});

test("Data futura → pergunta confirmação antes de salvar", async () => {
  mockOcr({
    valor: 30, descricao: "Padaria", data: "2099-12-25",
    categoriaSugerida: "alimentacao", formaPagamento: "pix",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-dtf", image: fakeImage("h-dtf"),
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "img-dtf-yes",
  });
  expect(r.resposta).toContain("A nota indica a data 25/12/2099");
  expect(gastosInserts()).toHaveLength(0);
});

test("Categoria sem confiança NÃO vira Outros automaticamente", async () => {
  mockOcr({
    valor: 60, descricao: "Loja Diversa", data: null,
    categoriaSugerida: null, formaPagamento: "pix",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-cat1", image: fakeImage("h-cat1"),
  });
  expect(r.resposta).toContain("Categoria: Não identificada");
  const pre = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "img-cat1-yes",
  });
  expect(pre.resposta).toContain("Em qual categoria");
  expect(gastosInserts()).toHaveLength(0);
  const r2 = await processarMensagemWhatsApp({
    telefone: tel, texto: "Mercado", external_id: "img-cat1-mer",
  });
  expect(r2.status).toBe("salva");
  expect(gastosInserts()[0].row.categoria_id).toBe("cat-mer");
});

test("Categoria com confiança baixa NÃO é assumida sem o usuário escolher", async () => {
  mockOcr({
    valor: 60, descricao: "Loja X", data: null,
    categoriaSugerida: "outros", confianca: "baixa", formaPagamento: "pix",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-cat2", image: fakeImage("h-cat2"),
  });
  expect(r.resposta).toContain("Categoria: Não identificada");
});

test("Ajuste manual de pagamento via 'pagamento pix' atualiza o resumo", async () => {
  mockOcr({
    valor: 70, descricao: "Restaurante", data: null,
    categoriaSugerida: "alimentacao", formaPagamento: "credito",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-fp-aj", image: fakeImage("h-fp-aj"),
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "pagamento pix", external_id: "img-fp-aj-v",
  });
  expect(r.resposta).toContain("Pagamento: Pix");
  expect(r.resposta).not.toContain("Pagamento: Cartão de crédito");
});

test("'alterar pagamento' pede a nova forma e aceita o ajuste", async () => {
  mockOcr({
    valor: 70, descricao: "Padaria", data: null,
    categoriaSugerida: "alimentacao", formaPagamento: "credito",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "img-fp-aj2", image: fakeImage("h-fp-aj2"),
  });
  const ask = await processarMensagemWhatsApp({
    telefone: tel, texto: "alterar pagamento", external_id: "img-fp-aj2-q",
  });
  expect(ask.resposta).toContain("Qual forma de pagamento");
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "débito", external_id: "img-fp-aj2-v",
  });
  expect(r.resposta).toContain("Pagamento: Cartão de débito");
});

// =====================================================================
// WA-G5A.3 — comando "categoria" durante sessão + numérico + data incerta
// =====================================================================

test("'categoria' sozinho durante o resumo NÃO inicia novo gasto", async () => {
  mockOcr({
    valor: 50, descricao: "Padaria", data: "2026-06-22",
    categoriaSugerida: "alimentacao", formaPagamento: "pix",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a3-1", image: fakeImage("g5a3-h1"),
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "categoria", external_id: "g5a3-1-cat",
  });
  expect(r.resposta).toContain("Qual categoria você quer usar");
  expect(r.resposta).not.toContain("Qual foi o valor de");
  expect(state.pendingRow?.status).toBe("img_aguardando_ajuste");
  // dados originais preservados na sessão
  expect(state.pendingRow?.parsed.valor).toBe(50);
  expect(state.pendingRow?.parsed.descricao).toBe("Padaria");
});

test("Aceita 'editar categoria' e 'trocar categoria' como pedido de ajuste", async () => {
  mockOcr({ valor: 50, descricao: "Padaria", data: "2026-06-22", categoriaSugerida: "alimentacao", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a3-2", image: fakeImage("g5a3-h2"),
  });
  const a = await processarMensagemWhatsApp({
    telefone: tel, texto: "editar categoria", external_id: "g5a3-2a",
  });
  expect(a.resposta).toContain("Qual categoria você quer usar");
  // restart session
  await processarMensagemWhatsApp({
    telefone: tel, texto: "cancelar", external_id: "g5a3-2c",
  });
  mockOcr({ valor: 50, descricao: "Padaria", data: "2026-06-22", categoriaSugerida: "alimentacao", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a3-2b", image: fakeImage("g5a3-h2b"),
  });
  const b = await processarMensagemWhatsApp({
    telefone: tel, texto: "Trocar Categoria", external_id: "g5a3-2bx",
  });
  expect(b.resposta).toContain("Qual categoria você quer usar");
});

test("Escolha de categoria por número atualiza o resumo", async () => {
  mockOcr({ valor: 50, descricao: "Padaria", data: "2026-06-22", categoriaSugerida: "alimentacao", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a3-3", image: fakeImage("g5a3-h3"),
  });
  const ask = await processarMensagemWhatsApp({
    telefone: tel, texto: "categoria", external_id: "g5a3-3-ask",
  });
  // lista numerada
  expect(ask.resposta).toMatch(/1\.\s+Outros/);
  expect(ask.resposta).toMatch(/3\.\s+Transporte/);
  // user picks "3" → Transporte
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "3", external_id: "g5a3-3-pick",
  });
  expect(r.resposta).toContain("Categoria: Transporte");
  expect(r.resposta).toContain("Li esta nota");
});

test("Escolha de categoria por nome durante o ajuste atualiza o resumo", async () => {
  mockOcr({ valor: 50, descricao: "Padaria", data: "2026-06-22", categoriaSugerida: "alimentacao", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a3-4", image: fakeImage("g5a3-h4"),
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "categoria", external_id: "g5a3-4-ask",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "Transporte", external_id: "g5a3-4-pick",
  });
  expect(r.resposta).toContain("Categoria: Transporte");
});

test("Data com confiança baixa NÃO é salva automaticamente — pergunta antes", async () => {
  mockOcr({
    valor: 40, descricao: "Lanchonete", data: "2026-06-20",
    categoriaSugerida: "alimentacao", confianca: "baixa", formaPagamento: "pix",
  });
  const r1 = await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a3-d1", image: fakeImage("g5a3-d1h"),
  });
  // resumo mostra "Não confirmada"
  expect(r1.resposta).toContain("Data da nota: Não confirmada");
  // user precisa primeiro escolher categoria (sem confiança) e depois data
  const r2 = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "g5a3-d1-yes",
  });
  expect(r2.resposta).toContain("Em qual categoria");
  await processarMensagemWhatsApp({
    telefone: tel, texto: "Mercado", external_id: "g5a3-d1-cat",
  });
  // agora pergunta de data incerta
  expect(state.pendingRow?.status).toBe("img_aguardando_data_confirmacao");
  const r3 = await processarMensagemWhatsApp({
    telefone: tel, texto: "usar hoje", external_id: "g5a3-d1-hoje",
  });
  expect(r3.status).toBe("salva");
  expect(gastosInserts()[0].row.data).not.toBe("2026-06-20");
});

test("E2E produção: comando 'categoria' em sessão de comprovante não cai no parser de gasto", async () => {
  mockOcr({
    valor: 48.9,
    descricao: "EXPEDITO ALVES DE LIMA ME",
    data: null,
    categoriaSugerida: "mercado",
    formaPagamento: "pix",
  });
  const resumo = await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a31-img", image: fakeImage("g5a31-h"),
  });
  expect(resumo.resposta).toContain("Li esta nota");
  expect(state.pendingRow?.parsed.kind).toBe("imagem_comprovante");
  expect(state.pendingRow?.status).toBe("img_aguardando_confirmacao");

  const ask = await processarMensagemWhatsApp({
    telefone: tel, texto: "categoria", external_id: "g5a31-cat",
  });
  expect(ask.resposta).toContain("Claro. Qual categoria você quer usar?");
  expect(ask.resposta).toMatch(/1\.\s+Outros/);
  expect(ask.resposta).toMatch(/3\.\s+Transporte/);
  expect(ask.resposta).not.toContain("Qual foi o valor de Categoria");
  expect(state.inserts.some((i) => i.table === "whatsapp_messages" && i.row.status === "aguardando_descricao_e_valor_gasto")).toBe(false);
  expect(gastosInserts()).toHaveLength(0);

  const selected = await processarMensagemWhatsApp({
    telefone: tel, texto: "3", external_id: "g5a31-cat-3",
  });
  expect(selected.resposta).toContain("Li esta nota");
  expect(selected.resposta).toContain("Expedito Alves de Lima ME");
  expect(selected.resposta.replace(/\u00a0/g, " ")).toContain("R$ 48,90");
  expect(selected.resposta).toContain("Pagamento: Pix");
  expect(selected.resposta).toContain("Categoria: Transporte");
  expect(gastosInserts()).toHaveLength(0);
});

test("Integração realista: cancelar → imagem → comandos de ajuste ficam no comprovante", async () => {
  async function startReceipt(externalPrefix: string) {
    await processarMensagemWhatsApp({
      telefone: tel, texto: "cancelar", external_id: `${externalPrefix}-cancel`,
    });
    mockOcr({
      valor: 48.9,
      descricao: "EXPEDITO ALVES DE LIMA ME",
      data: null,
      categoriaSugerida: "mercado",
      formaPagamento: "pix",
    });
    const resumo = await processarMensagemWhatsApp({
      telefone: tel, texto: "", external_id: `${externalPrefix}-img`, image: fakeImage(`${externalPrefix}-h`),
    });
    expect(resumo.resposta).toContain("Li esta nota");
    const lookup = await buscarSessaoComprovanteAtiva("u1", tel);
    expect(lookup.sessionFoundByKind).toBe(true);
    expect(lookup.sessao?.session.kind).toBe("imagem_comprovante");
    return lookup;
  }

  const commands = [
    ["categoria", "Qual categoria você quer usar"],
    ["valor", "Qual valor devo usar"],
    ["data", "Qual data devo usar"],
    ["pagamento", "Qual forma de pagamento devo usar"],
    ["descrição", "Qual descrição devo usar"],
    ["alterar categoria", "Qual categoria você quer usar"],
  ] as const;

  for (const [idx, [cmd, expected]] of commands.entries()) {
    resetState();
    __setExpenseParserForTests(null);
    const events: Array<Record<string, unknown>> = [];
    __setWhatsAppAuditObserverForTests((event) => events.push(event));
    await startReceipt(`audit-${idx}`);
    let expenseParserCalled = false;
    __setExpenseParserForTests((message, cartoes) => {
      expenseParserCalled = true;
      return {
        nome: message,
        valor: 0,
        data: new Date().toISOString().slice(0, 10),
        formaPagamento: "credito",
        mensagemOriginal: message,
        confianca: 0,
        notas: [],
      } as ParsedExpense;
    });

    const response = await processarMensagemWhatsApp({
      telefone: tel, texto: cmd, external_id: `audit-${idx}-cmd`,
    });
    expect(response.resposta).toContain(expected);
    expect(expenseParserCalled).toBe(false);
    expect(events.some((e) => e.event === "wa_session_lookup" && e.receiptSessionFoundByKind === true)).toBe(true);
    expect(events.some((e) => e.event === "wa_route_decision" && e.routedTo === "receipt_handler")).toBe(true);
    expect(events.some((e) => e.event === "wa_route_decision" && e.routedTo === "expense_parser")).toBe(false);

    if (cmd === "categoria") {
      const selected = await processarMensagemWhatsApp({
        telefone: tel, texto: "3", external_id: `audit-${idx}-cat-3`,
      });
      expect(selected.resposta).toContain("Li esta nota");
      expect(selected.resposta).toContain("Categoria: Transporte");
    }
  }
  __setExpenseParserForTests(null);
  __setWhatsAppAuditObserverForTests(null);
});

test("Comandos reservados de comprovante são priorizados mesmo se status salvo vier como pendente", async () => {
  mockOcr({ valor: 50, descricao: "Padaria", data: null, categoriaSugerida: "alimentacao", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a31-lost-img", image: fakeImage("g5a31-lost-h"),
  });
  const receiptInsert = [...state.inserts].reverse().find((i) => i.table === "whatsapp_messages");
  if (receiptInsert) receiptInsert.row.status = "pendente";
  if (state.pendingRow) state.pendingRow.status = "pendente";

  const commands = [
    ["categoria", "Qual categoria você quer usar"],
    ["valor", "Qual valor devo usar"],
    ["descrição", "Qual descrição devo usar"],
    ["data", "Qual data devo usar"],
    ["pagamento", "Qual forma de pagamento devo usar"],
  ] as const;

  for (const [cmd, expected] of commands) {
    const r = await processarMensagemWhatsApp({
      telefone: tel, texto: cmd, external_id: `g5a31-res-${cmd}`,
    });
    expect(r.resposta).toContain(expected);
    expect(r.resposta).not.toContain("Qual foi o valor de Categoria");
    expect(state.inserts.some((i) => i.table === "whatsapp_messages" && i.row.texto === cmd && i.row.status === "aguardando_descricao_e_valor_gasto")).toBe(false);
    const latest = [...state.inserts].reverse().find((i) => i.table === "whatsapp_messages");
    if (latest) latest.row.status = "pendente";
    if (state.pendingRow) state.pendingRow.status = "pendente";
  }
});

test("Query real por parsed.kind encontra comprovante com status fora de PENDING_STATES", async () => {
  mockOcr({ valor: 48.9, descricao: "Padaria", data: null, categoriaSugerida: "mercado", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a32-kind-img", image: fakeImage("g5a32-kind-h"),
  });
  const receiptInsert = [...state.inserts].reverse().find((i) => i.table === "whatsapp_messages");
  if (receiptInsert) receiptInsert.row.status = "pendente";
  if (state.pendingRow) state.pendingRow.status = "pendente";

  const lookup = await buscarSessaoComprovanteAtiva("u1", tel);
  expect(lookup.sessionFoundByStatus).toBe(false);
  expect(lookup.sessionFoundByKind).toBe(true);
  expect(lookup.sessao?.status).toBe("pendente");
  expect(lookup.sessao?.session.kind).toBe("imagem_comprovante");

  __setExpenseParserForTests(() => {
    throw new Error("parseWhatsAppExpenseMessage não deveria ser chamado");
  });
  const ask = await processarMensagemWhatsApp({
    telefone: tel, texto: "categoria", external_id: "g5a32-kind-cat",
  });
  expect(ask.resposta).toContain("Claro. Qual categoria você quer usar?");
  expect(ask.resposta).not.toContain("Qual foi o valor de Categoria");
  expect(gastosInserts()).toHaveLength(0);
});

test("valor, data, pagamento e descrição com comprovante ativo não criam sessão de gasto", async () => {
  for (const [cmd, expected] of [
    ["valor", "Qual valor devo usar"],
    ["data", "Qual data devo usar"],
    ["pagamento", "Qual forma de pagamento devo usar"],
    ["descrição", "Qual descrição devo usar"],
  ] as const) {
    resetState();
    mockOcr({ valor: 35, descricao: "Loja", data: null, categoriaSugerida: "mercado", formaPagamento: "pix" });
    await processarMensagemWhatsApp({
      telefone: tel, texto: "", external_id: `g5a32-${cmd}-img`, image: fakeImage(`g5a32-${cmd}-h`),
    });
    const receiptInsert = [...state.inserts].reverse().find((i) => i.table === "whatsapp_messages");
    if (receiptInsert) receiptInsert.row.status = "pendente";
    if (state.pendingRow) state.pendingRow.status = "pendente";

    __setExpenseParserForTests(() => {
      throw new Error(`parseWhatsAppExpenseMessage não deveria ser chamado para ${cmd}`);
    });
    const res = await processarMensagemWhatsApp({
      telefone: tel, texto: cmd, external_id: `g5a32-${cmd}-cmd`,
    });
    expect(res.resposta).toContain(expected);
    expect(state.inserts.some((i) => i.table === "whatsapp_messages" && i.row.texto === cmd && i.row.status === "aguardando_descricao_e_valor_gasto")).toBe(false);
    expect(gastosInserts()).toHaveLength(0);
  }
});

test("Sessão de comprovante finalizada ou cancelada não bloqueia novo gasto", async () => {
  mockOcr({ valor: 12, descricao: "Padaria", data: null, categoriaSugerida: "mercado", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a32-final-img", image: fakeImage("g5a32-final-h"),
  });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "g5a32-final-sim" });
  const afterSaved = await processarMensagemWhatsApp({
    telefone: tel, texto: "Uber 20", external_id: "g5a32-after-saved",
  });
  expect(afterSaved.resposta).not.toContain("Li esta nota");
  expect(afterSaved.resposta).toContain("Como você pagou");

  resetState();
  mockOcr({ valor: 12, descricao: "Padaria", data: null, categoriaSugerida: "mercado", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a32-cancel-img", image: fakeImage("g5a32-cancel-h"),
  });
  await processarMensagemWhatsApp({ telefone: tel, texto: "cancelar", external_id: "g5a32-cancel" });
  const afterCancel = await processarMensagemWhatsApp({
    telefone: tel, texto: "Uber 21", external_id: "g5a32-after-cancel",
  });
  expect(afterCancel.resposta).not.toContain("Li esta nota");
  expect(afterCancel.resposta).toContain("Como você pagou");
});

test("Cancelar encerra sessão de comprovante e depois 'categoria' volta ao fluxo normal", async () => {
  mockOcr({ valor: 22, descricao: "Loja", data: null, categoriaSugerida: "mercado", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a31-cancel-img", image: fakeImage("g5a31-cancel-h"),
  });
  const cancel = await processarMensagemWhatsApp({
    telefone: tel, texto: "cancelar", external_id: "g5a31-cancel",
  });
  expect(cancel.status).toBe("cancelada");
  expect(state.pendingRow).toBeNull();
  const after = await processarMensagemWhatsApp({
    telefone: tel, texto: "categoria", external_id: "g5a31-after-cancel",
  });
  expect(after.resposta).toContain("Qual foi o valor de Categoria");
});

// ============================================================
// WA-G5A.4 — Instrumentação de criação/recuperação de sessão
// ============================================================

test("WA-G5A.4: criação da sessão de comprovante dispara wa_receipt_session_created e readback positivo", async () => {
  resetState();
  type Ev = { event: string } & Record<string, unknown>;
  const events: Ev[] = [];
  __setWhatsAppAuditObserverForTests((e) => events.push(e as Ev));
  try {
    mockOcr({ valor: 30, descricao: "MERCADO X", data: null, categoriaSugerida: "mercado", formaPagamento: "pix" });
    await processarMensagemWhatsApp({
      telefone: tel, texto: "", external_id: "g5a4-create", image: fakeImage("g5a4-create-h"),
    });
    const created = events.find((e) => e.event === "wa_receipt_session_created");
    expect(created).toBeDefined();
    expect(created!.persistedRowFound).toBe(true);
    expect(created!.persistedKindPath).toBe("parsed.kind");
    expect(created!.persistedPhoneStartsWith55).toBe(true);
  } finally {
    __setWhatsAppAuditObserverForTests(null);
  }
});

test("WA-G5A.4: 'categoria' após foto encontra a sessão e roteia para receipt_handler com storedKindPath", async () => {
  resetState();
  type Ev = { event: string } & Record<string, unknown>;
  const events: Ev[] = [];
  mockOcr({ valor: 30, descricao: "MERCADO X", data: null, categoriaSugerida: "mercado", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a4-cat-img", image: fakeImage("g5a4-cat-h"),
  });
  __setWhatsAppAuditObserverForTests((e) => events.push(e as Ev));
  try {
    await processarMensagemWhatsApp({
      telefone: tel, texto: "categoria", external_id: "g5a4-cat-msg",
    });
    const trace = events.find((e) => e.event === "wa_receipt_session_trace");
    expect(trace).toBeDefined();
    expect(trace!.routeChosen).toBe("receipt_handler");
    expect(trace!.storedKindPath).toBe("parsed.kind");
    expect(trace!.receiptSessionFoundByStatus || trace!.receiptSessionFoundByKind).toBe(true);
  } finally {
    __setWhatsAppAuditObserverForTests(null);
  }
});

test("WA-G5A.4: buscarSessaoComprovanteAtiva expõe storedKindPath e flags de auditoria", async () => {
  resetState();
  mockOcr({ valor: 40, descricao: "Loja", data: null, categoriaSugerida: "mercado", formaPagamento: "pix" });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "", external_id: "g5a4-lookup", image: fakeImage("g5a4-lookup-h"),
  });
  const lookup = await buscarSessaoComprovanteAtiva("u1", tel);
  expect(lookup.sessao).not.toBeNull();
  expect(lookup.storedKindPath).toBe("parsed.kind");
  expect(lookup.sessionFoundByFallbackQuery).toBe(false);
  // Auditoria nunca expõe campos sensíveis: lookup só carrega flags
  // estruturais (status, recebida_em, parsed.kind) — não há telefone bruto,
  // imagem, texto, OCR, valor financeiro ou token no payload.
  const keys = Object.keys(lookup);
  expect(keys.sort()).toEqual([
    "sessao", "sessionFoundByFallbackQuery", "sessionFoundByKind",
    "sessionFoundByStatus", "storedKindPath",
  ]);
});
