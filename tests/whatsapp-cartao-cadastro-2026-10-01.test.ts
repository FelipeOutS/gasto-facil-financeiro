/**
 * 01/10/2026 — Cadastro de cartão pelo WhatsApp (Flow + conversa).
 * Mesma validação do site, criação pelo servidor, duplicidade, idempotência,
 * retomada do gasto e competência da fatura.
 */
import { test, expect, beforeEach, afterEach, describe, setSystemTime } from "bun:test";
import { resetState, gastosInserts, setupWhatsAppFakeMocks, state } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { replyIdToTexto, buildInteractiveFromReply } = await import(
  "../src/server/whatsapp-interactive.server"
);
const V = await import("../src/lib/cartao-validacao");
const { detectarIntencaoCadastroCartao } = await import(
  "../src/server/whatsapp-cartao-cadastro.server"
);
const { criarCartaoViaWhatsApp } = await import("../src/server/cartao-cadastro.server");
const { CARD_FLOW_JSON } = await import("../src/server/whatsapp-cartao-flow");

const tel = "5511999997777";
let seq = 0;
const send = (texto: string, telefone = tel) =>
  processarMensagemWhatsApp({ telefone, texto, external_id: `cc-${++seq}` });
const tap = (id: string) => send(replyIdToTexto(id, ""));
const flowReply = (data: Record<string, unknown>, telefone = tel, external_id = `cc-${++seq}`) =>
  processarMensagemWhatsApp({
    telefone,
    texto: "",
    external_id,
    flowReply: { responseJson: JSON.stringify(data) },
  });
const cartoesInseridos = () => state.inserts.filter((i) => i.table === "cartoes");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tokenDe = (out: any): string =>
  out.graphInteractive.action.parameters.flow_token as string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prefillDe = (out: any) => out.graphInteractive.action.parameters.flow_action_payload.data;

async function conversaCompleta(nome = "Nubank") {
  await send("cadastrar cartão");
  await send(nome);
  await send("R$ 5.000,00");
  await send("25");
  return send("5");
}

beforeEach(() => {
  delete process.env.WHATSAPP_CARD_FLOW_ID;
  delete process.env.WHATSAPP_CARD_FLOW_MODE;
  resetState({ cartoes: [] });
});
afterEach(() => {
  delete process.env.WHATSAPP_CARD_FLOW_ID;
  setSystemTime();
});

describe("validação compartilhada", () => {
  test("limite: formatos aceitos", () => {
    for (const s of ["5000", "5000,00", "5.000", "5.000,00", "R$ 5.000", "R$ 5.000,00"]) {
      expect(V.validarLimiteCartao(s)).toEqual({ ok: true, valor: 5000 });
    }
    expect(V.validarLimiteCartao("0,01")).toEqual({ ok: true, valor: 0.01 });
  });
  test("site/WhatsApp/Flow rejeitam zero, negativo e inválido", () => {
    for (const s of ["0", "0,00", "R$ 0,00", "-10", "abc", "5.00.0", ""]) {
      expect(V.validarLimiteCartao(s).ok).toBe(false);
    }
    // Mesma função usada pelo formulário do site (CartaoForm → validarCartao).
    expect(
      V.validarCartao({ nome: "Nubank", limite: "0,00", diaFechamento: 25, diaVencimento: 5 }).ok,
    ).toBe(false);
  });
  test("dias 1–31 e nome sem número de cartão", () => {
    expect(V.validarDiaCartao("25", "fechamento").ok).toBe(true);
    expect(V.validarDiaCartao("31", "vencimento").ok).toBe(true);
    for (const d of ["0", "32", "dia x", "-1"]) expect(V.validarDiaCartao(d, "fechamento").ok).toBe(false);
    expect(V.validarNomeCartao("5555 4444 3333 2222").ok).toBe(false);
    expect(V.validarNomeCartao("").ok).toBe(false);
  });
  test("duplicidade: caixa/acento iguais, Nubank PJ é diferente", () => {
    const lista = [{ nome: "Mercado Pago" }, { nome: "Nubank" }];
    expect(V.encontrarCartaoDuplicado("MERCADO PAGO", lista)).toBeTruthy();
    expect(V.encontrarCartaoDuplicado("mércado pago", lista)).toBeTruthy();
    expect(V.encontrarCartaoDuplicado("Nubank PJ", lista)).toBeUndefined();
  });
  test("detecção de intenção", () => {
    for (const t of ["cadastrar cartão", "adicionar cartão", "novo cartão", "quero cadastrar um cartão"]) {
      expect(detectarIntencaoCadastroCartao(t)).toEqual({});
    }
    expect(detectarIntencaoCadastroCartao("cadastrar meu Nubank")).toEqual({ nome: "Nubank" });
    expect(detectarIntencaoCadastroCartao("cadastrar meu gasto")).toBeNull();
    expect(detectarIntencaoCadastroCartao("registrar gasto")).toBeNull();
  });
});

describe("conversa (sem flow_id)", () => {
  test("1/2. menu e texto iniciam o mesmo fluxo", async () => {
    const a = await tap("cartoes_cadastrar");
    expect(a.status).toBe("cartao_cadastro");
    expect(a.resposta).toContain("Vamos cadastrar seu cartão 💳");
    expect(a.resposta).toContain("Qual o nome do cartão?");
    resetState({ cartoes: [] });
    const b = await send("cadastrar cartão");
    expect(b.resposta).toContain("Qual o nome do cartão?");
  });

  test("3. nome na frase pré-preenche e pula para o limite", async () => {
    const r = await send("cadastrar meu Nubank");
    expect(r.resposta).toContain("Qual o limite total do Nubank?");
  });

  test("5-8/12/13/14. coleta → confirmação → nada salvo antes → Cadastrar cria 1", async () => {
    const r = await conversaCompleta();
    expect(r.resposta).toContain("Confere pra mim? 👀");
    expect(r.resposta).toContain("💳 Cartão: Nubank");
    expect(r.resposta).toMatch(/Limite: R\$\s?5\.000,00/);
    expect(r.resposta).toContain("📅 Fecha: dia 25");
    expect(r.resposta).toContain("🗓️ Vence: dia 5");
    const ir = buildInteractiveFromReply(r.resposta);
    expect(ir?.type).toBe("button");
    expect(ir && "buttons" in ir ? ir.buttons.map((b) => b.id) : []).toEqual([
      "card_reg_confirm",
      "card_reg_adjust",
      "card_reg_cancel",
    ]);
    expect(cartoesInseridos()).toHaveLength(0);
    const ok = await tap("card_reg_confirm");
    expect(ok.status).toBe("cartao_salvo");
    expect(ok.resposta).toContain("Cartão cadastrado com sucesso 💳✅");
    expect(ok.resposta).toContain("Quer lançar um gasto nesse cartão agora?");
    expect(cartoesInseridos()).toHaveLength(1);
    const row = cartoesInseridos()[0].row;
    expect(row).toMatchObject({
      user_id: "u1",
      nome: "Nubank",
      limite_total: 5000,
      dia_fechamento: 25,
      dia_vencimento: 5,
    });
    expect(Object.keys(row)).not.toContain("numero");
    expect(Object.keys(row)).not.toContain("cvv");
  });

  test("9/10/11. limite, fechamento e vencimento inválidos pedem de novo", async () => {
    await send("cadastrar cartão");
    await send("Nubank");
    expect((await send("0,00")).resposta).toContain("maior que R$ 0,00");
    expect((await send("abc")).resposta).toContain("Não entendi o limite");
    await send("0,01");
    expect((await send("32")).resposta).toContain("entre 1 e 31");
    await send("25");
    expect((await send("0")).resposta).toContain("entre 1 e 31");
    const r = await send("5");
    expect(r.resposta).toContain("Confere pra mim?");
    expect(r.resposta).toMatch(/R\$\s?0,01/);
    expect(cartoesInseridos()).toHaveLength(0);
  });

  test("15. Cancelar não cria cartão", async () => {
    await conversaCompleta();
    const r = await tap("card_reg_cancel");
    expect(r.status).toBe("cancelada");
    expect(r.resposta).toContain("não cadastrei o cartão");
    expect(cartoesInseridos()).toHaveLength(0);
  });

  test("16. duplicidade: oferece usar existente / alterar nome / cancelar", async () => {
    resetState({ cartoes: [{ id: "c-mp", nome: "Mercado Pago", user_id: "u1" }] });
    const r = await conversaCompleta("mercado pago");
    expect(r.resposta).toContain("Você já tem um cartão chamado Mercado Pago. 💳");
    const ir = buildInteractiveFromReply(r.resposta);
    expect(ir && "buttons" in ir ? ir.buttons.map((b) => b.id) : []).toEqual([
      "card_dup_use",
      "card_dup_rename",
      "card_reg_cancel",
    ]);
    const renomear = await tap("card_dup_rename");
    expect(renomear.resposta).toContain("Qual o nome do cartão?");
    const conf = await send("Mercado Pago PJ");
    expect(conf.resposta).toContain("💳 Cartão: Mercado Pago PJ");
    await tap("card_reg_confirm");
    expect(cartoesInseridos()).toHaveLength(1);
  });

  test("Nubank PJ não é bloqueado por Nubank", async () => {
    resetState({ cartoes: [{ id: "c-nu", nome: "Nubank", user_id: "u1" }] });
    const r = await conversaCompleta("Nubank PJ");
    expect(r.resposta).toContain("Confere pra mim?");
  });

  test("18. duplo toque em Cadastrar cria 1 cartão", async () => {
    await conversaCompleta();
    await tap("card_reg_confirm");
    const again = await tap("card_reg_confirm");
    expect(again.resposta).toContain("já foi cadastrado");
    expect(cartoesInseridos()).toHaveLength(1);
  });

  test("Ajustar por conversa: muda um campo e preserva os outros", async () => {
    await conversaCompleta();
    const a = await tap("card_reg_adjust");
    expect(a.resposta).toContain("Qual dado do cartão você quer ajustar?");
    expect(buildInteractiveFromReply(a.resposta)?.type).toBe("list");
    expect((await tap("card_edit_limite")).resposta).toContain("Qual o limite total");
    const r = await send("8.000");
    expect(r.resposta).toContain("💳 Cartão: Nubank");
    expect(r.resposta).toMatch(/R\$\s?8\.000,00/);
    expect(r.resposta).toContain("dia 25");
    expect(r.resposta).toContain("dia 5");
    expect(cartoesInseridos()).toHaveLength(0);
  });

  test("26. pós-cadastro → Agora não", async () => {
    await conversaCompleta();
    await tap("card_reg_confirm");
    const r = await tap("card_reg_later");
    expect(r.resposta).toContain("Combinado!");
    expect(gastosInserts()).toHaveLength(0);
  });

  test("25/28. pós-cadastro → Lançar gasto usa o cartão novo sem perguntar", async () => {
    await conversaCompleta();
    await tap("card_reg_confirm");
    const p = await tap("card_reg_spend");
    expect(p.resposta).toContain("Me conta o gasto e o valor");
    const c = await send("Mercado 50");
    expect(c.status).toBe("aguardando_confirmacao");
    expect(c.resposta).not.toContain("Qual cartão você usou");
    expect(c.resposta).toContain("Cartão: Nubank");
    await tap("expense_confirm");
    expect(gastosInserts()).toHaveLength(1);
    expect(gastosInserts()[0].row.cartao_id).toBe(cartoesInseridos()[0].row.id);
  });

  test("27/28. próximo gasto no crédito usa o único cartão automaticamente", async () => {
    await conversaCompleta();
    await tap("card_reg_confirm");
    await tap("card_reg_later");
    await send("Gastei 15 no mercado");
    const r = await tap("payment_credit");
    expect(r.resposta.startsWith("Certo! Vou usar seu cartão Nubank. 💳")).toBe(true);
  });

  test("31. fallback conversacional quando não há flow_id", async () => {
    const r = await send("cadastrar cartão");
    expect(r.graphInteractive).toBeUndefined();
    expect(r.resposta).toContain("Qual o nome do cartão?");
  });
});

describe("regras do servidor", () => {
  test("6. plano gratuito não ultrapassa o limite de cartões", async () => {
    resetState({ cartoes: [{ id: "c-1", nome: "Inter", user_id: "u1" }], cartoesQuota: 1 });
    await conversaCompleta();
    const r = await tap("card_reg_confirm");
    expect(r.resposta).toContain("permite apenas 1 cartão");
    expect(cartoesInseridos()).toHaveLength(0);
  });

  test("sem recurso Cartões no plano → não cria", async () => {
    resetState({ cartoes: [], featureAccess: false });
    await conversaCompleta();
    const r = await tap("card_reg_confirm");
    expect(r.resposta).toContain("não inclui o cadastro de cartões");
    expect(cartoesInseridos()).toHaveLength(0);
  });

  test("7. servidor não cria cartão para outro usuário", async () => {
    // O vínculo do número é do u1; pedido em nome do u2 é recusado.
    const r = await criarCartaoViaWhatsApp({
      userId: "u2",
      telefone: tel,
      requestKey: "k1",
      dados: { nome: "Nubank", limite: "100", diaFechamento: 1, diaVencimento: 10 },
    });
    expect(r.status).toBe("sem_vinculo");
    expect(cartoesInseridos()).toHaveLength(0);
  });

  test("19/20. cartão aparece só para o usuário correto", async () => {
    await conversaCompleta();
    await tap("card_reg_confirm");
    const meus = state.cartoesData.filter((c) => c.user_id === "u1");
    const outros = state.cartoesData.filter((c) => c.user_id === "u2");
    expect(meus).toHaveLength(1);
    expect(outros).toHaveLength(0);
  });

  test("idempotência do servidor: mesmo pedido → ja_criado", async () => {
    const args = {
      userId: "u1",
      telefone: tel,
      requestKey: "k-idem",
      dados: { nome: "Itaú", limite: "100", diaFechamento: 1, diaVencimento: 10 },
    };
    expect((await criarCartaoViaWhatsApp(args)).status).toBe("criado");
    expect((await criarCartaoViaWhatsApp(args)).status).toBe("ja_criado");
    expect(cartoesInseridos()).toHaveLength(1);
  });

  test("5. cartão antigo com limite zero continua legível", async () => {
    resetState({ cartoes: [{ id: "c-z", nome: "Antigo", user_id: "u1", limite_total: 0 }] });
    const { carregarCartoes } = await import("../src/server/whatsapp.server");
    const l = await carregarCartoes("u1");
    expect(l[0]).toMatchObject({ nome: "Antigo", limiteTotal: 0 });
  });
});

describe("WhatsApp Flow (com flow_id)", () => {
  beforeEach(() => {
    process.env.WHATSAPP_CARD_FLOW_ID = "1234567890123";
  });

  test("abre o Flow; texto de fallback = cadastro por conversa", async () => {
    const r = await send("cadastrar cartão");
    expect(r.graphInteractive?.type).toBe("flow");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (r.graphInteractive as any).action.parameters;
    expect(p.flow_id).toBe("1234567890123");
    expect(p.flow_action).toBe("navigate");
    expect(p.flow_token).toMatch(/^[a-f0-9]{32}$/);
    expect(r.resposta).toContain("Não consegui abrir o formulário agora.");
    // Fallback conversacional funciona mesmo com o Flow enviado.
    expect((await send("Nubank")).resposta).toContain("Qual o limite total");
  });

  test("3. nome na frase vai pré-preenchido no Flow", async () => {
    const r = await send("cadastrar meu Nubank");
    expect(prefillDe(r).nome).toBe("Nubank");
  });

  test("4/12/13/14. submissão válida → confirmação, nada salvo → Cadastrar cria 1", async () => {
    const r = await send("cadastrar cartão");
    const c = await flowReply({
      flow_token: tokenDe(r),
      nome: "Nubank",
      limite: "5.000,00",
      fechamento: "25",
      vencimento: "5",
    });
    expect(c.resposta).toContain("Confere pra mim? 👀");
    expect(cartoesInseridos()).toHaveLength(0);
    await tap("card_reg_confirm");
    expect(cartoesInseridos()).toHaveLength(1);
  });

  test("3. Flow rejeita limite zero e reabre com os outros campos", async () => {
    const r = await send("cadastrar cartão");
    const c = await flowReply({
      flow_token: tokenDe(r),
      nome: "Nubank",
      limite: "0,00",
      fechamento: "25",
      vencimento: "5",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((c.graphInteractive as any).body.text).toContain("maior que R$ 0,00");
    expect(prefillDe(c)).toMatchObject({ nome: "Nubank", limite: "", fechamento: "25", vencimento: "5" });
    expect(cartoesInseridos()).toHaveLength(0);
  });

  test("10/11. Ajustar reabre o Flow com os quatro campos preenchidos", async () => {
    const r = await send("cadastrar cartão");
    await flowReply({ flow_token: tokenDe(r), nome: "Nubank", limite: "5000", fechamento: "25", vencimento: "5" });
    const a = await tap("card_reg_adjust");
    expect(prefillDe(a)).toEqual({ nome: "Nubank", limite: "5.000,00", fechamento: "25", vencimento: "5" });
    const c = await flowReply({
      flow_token: tokenDe(a),
      nome: "Nubank",
      limite: "5.000,00",
      fechamento: "20",
      vencimento: "5",
    });
    expect(c.resposta).toContain("📅 Fecha: dia 20");
    expect(c.resposta).toContain("💳 Cartão: Nubank");
    expect(cartoesInseridos()).toHaveLength(0);
  });

  test("17. replay da Meta (mesmo id) não duplica", async () => {
    const r = await send("cadastrar cartão");
    const data = { flow_token: tokenDe(r), nome: "Nubank", limite: "5000", fechamento: "25", vencimento: "5" };
    await flowReply(data, tel, "wamid-flow-1");
    const again = await flowReply(data, tel, "wamid-flow-1");
    expect(again.status).toBe("duplicada");
    await tap("card_reg_confirm");
    await tap("card_reg_confirm");
    expect(cartoesInseridos()).toHaveLength(1);
  });

  test("8. flow_token de outro número é recusado", async () => {
    const r = await send("cadastrar cartão");
    const c = await flowReply(
      { flow_token: tokenDe(r), nome: "Nubank", limite: "5000", fechamento: "25", vencimento: "5" },
      "5511988880000",
    );
    expect(c.resposta).toContain("expirou ou não é mais válido");
    expect(cartoesInseridos()).toHaveLength(0);
  });

  test("token desconhecido é recusado", async () => {
    await send("cadastrar cartão");
    const c = await flowReply({ flow_token: "f".repeat(32), nome: "X", limite: "1", fechamento: "1", vencimento: "1" });
    expect(c.resposta).toContain("expirou");
  });

  test("9. flow_token vencido (> 2h) é recusado", async () => {
    setSystemTime(new Date("2026-10-01T10:00:00Z"));
    const r = await processarMensagemWhatsApp({
      telefone: tel,
      texto: "cadastrar cartão",
      external_id: `cc-${++seq}`,
      recebida_em: "2026-10-01T10:00:00Z",
    });
    setSystemTime(new Date("2026-10-01T12:30:00Z"));
    const c = await flowReply({ flow_token: tokenDe(r), nome: "Nubank", limite: "5000", fechamento: "25", vencimento: "5" });
    expect(c.resposta).toContain("expirou");
    expect(cartoesInseridos()).toHaveLength(0);
  });

  test("32. abrir o Flow usa o sender rastreado (objeto interactive pronto)", async () => {
    const r = await send("cadastrar cartão");
    // A rota envia `graphInteractive` por sendWhatsAppInteractiveReply,
    // que registra o envio no rastreio de saída (source reply_interactive).
    expect(r.graphInteractive).toBeDefined();
    expect(JSON.stringify(r.graphInteractive)).not.toMatch(/saldo|cpf|renda/i);
  });

  test("JSON do Flow pede só os quatro campos", () => {
    const names = CARD_FLOW_JSON.screens[0].layout.children
      .filter((c) => c.type === "TextInput")
      .map((c) => (c as { name: string }).name);
    expect(names).toEqual(["nome", "limite", "fechamento", "vencimento"]);
  });
});

describe("cadastro durante um gasto", () => {
  beforeEach(() => resetState({ cartoes: [{ id: "c-in", nome: "Inter", user_id: "u1", dia_fechamento: 10, dia_vencimento: 20 }] }));
  test("21-23/29. cartão citado não existe → cadastrar → retoma o gasto (antes do fechamento)", async () => {
    setSystemTime(new Date("2026-09-20T15:00:00Z"));
    const g = await send("Gastei 89,90 na farmácia no cartão Nubank");
    expect(g.resposta).toContain("Não encontrei um cartão Nubank cadastrado. 💳");
    const ir = buildInteractiveFromReply(g.resposta);
    expect(ir && "buttons" in ir ? ir.buttons.map((b) => b.id) : []).toEqual([
      "card_new_register",
      "card_new_continue",
      "expense_cancel",
    ]);
    const c = await tap("card_new_register");
    expect(c.resposta).toContain("Vamos cadastrar o cartão Nubank");
    expect(c.resposta).toContain("Qual o limite total do Nubank?");
    await send("5000");
    await send("25");
    await send("5");
    const ok = await tap("card_reg_confirm");
    expect(ok.status).toBe("aguardando_confirmacao");
    expect(ok.resposta).toContain("Cartão Nubank cadastrado ✅");
    expect(ok.resposta).toMatch(/terminar seu gasto de R\$\s?89,90/);
    expect(ok.resposta).toContain("Fatura: Outubro/2026");
    expect(gastosInserts()).toHaveLength(0);
    await tap("expense_confirm");
    expect(gastosInserts()).toHaveLength(1);
    const row = gastosInserts()[0].row;
    expect(row.valor).toBe(89.9);
    expect(row.cartao_id).toBe(cartoesInseridos()[0].row.id);
    expect(row.fatura_competencia).toBe("2026-10");
  });

  test("30. depois do fechamento → fatura do mês seguinte", async () => {
    setSystemTime(new Date("2026-09-30T15:00:00Z"));
    await send("Gastei 89,90 na farmácia no cartão Nubank");
    await tap("card_new_register");
    await send("5000");
    await send("25");
    await send("5");
    const ok = await tap("card_reg_confirm");
    expect(ok.resposta).toContain("Fatura: Novembro/2026");
    await tap("expense_confirm");
    expect(gastosInserts()[0].row.fatura_competencia).toBe("2026-11");
  });

  test("24. continuar sem cadastrar mantém o fluxo atual", async () => {
    await send("Gastei 89,90 na farmácia no cartão Nubank");
    const r = await tap("card_new_continue");
    expect(cartoesInseridos()).toHaveLength(0);
    expect(r.status).not.toBe("cartao_cadastro");
  });

  test("cancelar durante o cadastro não cria cartão nem gasto", async () => {
    await send("Gastei 89,90 na farmácia no cartão Nubank");
    await tap("card_new_register");
    const r = await tap("card_reg_cancel");
    expect(r.resposta).toContain("nem registrei o gasto");
    expect(cartoesInseridos()).toHaveLength(0);
    expect(gastosInserts()).toHaveLength(0);
  });
});
