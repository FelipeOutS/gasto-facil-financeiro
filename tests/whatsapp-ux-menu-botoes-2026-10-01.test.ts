/**
 * 01/10/2026 — UX do WhatsApp: emojis nos botões, menu principal em lista,
 * submenus, escolha de cartão e fallback. Botão/lista/texto passam pelo
 * mesmo texto canônico (replyIdToTexto) e pelo mesmo pipeline.
 */
import { test, expect, beforeEach, describe } from "bun:test";
import { resetState, gastosInserts, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { replyIdToTexto, buildInteractiveFromReply, toGraphInteractive } = await import(
  "../src/server/whatsapp-interactive.server"
);

const tel = "5511999996666";
let seq = 0;
const send = (texto: string) =>
  processarMensagemWhatsApp({ telefone: tel, texto, external_id: `ux-${++seq}` });
const tap = (id: string, title = "") => send(replyIdToTexto(id, title));

beforeEach(() => resetState({}));

const inicio = () => send("Gastei 12,60 no Uber em dinheiro");

describe("confirmação com emojis", () => {
  test("1-3. botões ✅ ✏️ ❌ e IDs estáveis", async () => {
    const r = await inicio();
    const ir = buildInteractiveFromReply(r.resposta);
    if (ir?.type !== "button") throw new Error("esperava botões");
    expect(ir.buttons).toEqual([
      { id: "expense_confirm", title: "✅ Confirmar" },
      { id: "expense_adjust", title: "✏️ Ajustar" },
      { id: "expense_cancel", title: "❌ Cancelar" },
    ]);
    expect(ir.body).not.toContain("Escolha uma opção");
  });
  test("4. ID funciona mesmo com título diferente", async () => {
    await inicio();
    const r = await tap("expense_confirm", "qualquer coisa");
    expect(r.status).toBe("salva");
    expect(gastosInserts()).toHaveLength(1);
  });
  test("cancelar por ID não salva", async () => {
    await inicio();
    expect((await tap("expense_cancel", "❌ Cancelar")).status).toBe("cancelada");
    expect(gastosInserts()).toHaveLength(0);
  });
  test("22. fallback textual com emojis e números", async () => {
    const r = await inicio();
    expect(r.resposta).toContain("Escolha uma opção:\n1. ✅ Confirmar\n2. ✏️ Ajustar\n3. ❌ Cancelar");
    expect((await send("1")).status).toBe("salva");
  });
});

describe("ajustar", () => {
  test("5. lista com emojis", async () => {
    await inicio();
    const r = await tap("expense_adjust");
    const ir = buildInteractiveFromReply(r.resposta);
    if (ir?.type !== "list") throw new Error("esperava lista");
    expect(ir.rows.map((x) => x.title)).toEqual([
      "💬 Descrição", "🏷️ Categoria", "💰 Valor", "📅 Data", "💳 Pagamento",
    ]);
  });
  test("6/8/9. descrição, valor e data mostram 'Atualizei' e voltam à confirmação", async () => {
    await inicio();
    await tap("expense_adjust");
    await tap("expense_edit_description");
    let r = await send("Uber trabalho");
    expect(r.resposta.startsWith("Atualizei a descrição 👍")).toBe(true);
    expect(buildInteractiveFromReply(r.resposta)?.type).toBe("button");
    await tap("expense_adjust");
    await tap("expense_edit_value");
    r = await send("13,20");
    expect(r.resposta.startsWith("Atualizei o valor 👍")).toBe(true);
    await tap("expense_adjust");
    await tap("expense_edit_date");
    r = await send("ontem");
    expect(r.resposta.startsWith("Atualizei a data 👍")).toBe(true);
    expect(gastosInserts()).toHaveLength(0);
  });
  test("7. categoria volta à confirmação", async () => {
    await inicio();
    await tap("expense_adjust");
    await tap("expense_edit_category");
    expect((await send("1")).status).toBe("aguardando_confirmacao");
  });
  test("10. pagamento em lista com emojis", async () => {
    await inicio();
    await tap("expense_adjust");
    const r = await tap("expense_edit_payment");
    const ir = buildInteractiveFromReply(r.resposta);
    if (ir?.type !== "list") throw new Error("esperava lista");
    expect(ir.rows.map((x) => x.title)).toEqual(["💠 Pix", "💵 Dinheiro", "🏦 Débito", "💳 Cartão de crédito"]);
    expect((await tap("payment_pix")).status).toBe("aguardando_confirmacao");
  });
});

describe("menu", () => {
  test("11/20. 'menu' abre lista 'Ver menu' com 8 opções", async () => {
    const r = await send("menu");
    const ir = buildInteractiveFromReply(r.resposta);
    if (ir?.type !== "list") throw new Error("esperava lista");
    expect(ir.body).toBe("Como posso te ajudar? 👇");
    expect(ir.buttonText).toBe("Ver menu");
    expect(ir.rows.map((x) => x.id)).toEqual([
      "menu_gastos", "menu_cartoes", "menu_contas", "menu_receitas",
      "menu_planejamento", "menu_resumos", "menu_ajuda", "menu_comandos",
    ]);
    // Fallback textual continua numerado.
    expect(r.resposta).toContain("1. Gastos");
  });

  const grupos: Array<[string, string[]]> = [
    ["menu_gastos", ["gastos_registrar", "gastos_mes", "gastos_semana", "gastos_consultar"]],
    ["menu_cartoes", ["cartoes_cadastrar", "cartoes_fatura", "cartoes_proxima", "cartoes_futuras", "cartoes_limite"]],
    ["menu_contas", ["contas_nova", "contas_proximas", "contas_recorrentes", "contas_atrasadas"]],
    ["menu_receitas", ["receitas_registrar", "receitas_mes"]],
    ["menu_planejamento", ["plan_metas", "plan_orcamento"]],
    ["menu_resumos", ["resumo_hoje", "resumo_semana", "resumo_mes"]],
  ];
  for (const [menuId, ids] of grupos) {
    test(`12-17. ${menuId} abre submenu e cada ação responde`, async () => {
      const r = await tap(menuId);
      const ir = buildInteractiveFromReply(r.resposta);
      if (ir?.type !== "list") throw new Error("esperava lista");
      expect(ir.rows.map((x) => x.id)).toEqual(ids);
      for (const id of ids) {
        resetState({});
        const a = await tap(id);
        expect(a.resposta.length).toBeGreaterThan(0);
        expect(a.resposta).not.toMatch(/Qual foi o valor de/);
      }
    });
  }
  test("18/19. ajuda e comandos", async () => {
    expect((await tap("menu_ajuda")).resposta).toContain("exemplos");
    resetState({});
    expect((await tap("menu_comandos")).resposta).toContain("Comandos rápidos");
  });
  test("21. texto natural continua funcionando", async () => {
    for (const t of ["quanto gastei hoje?", "minha fatura", "meus gastos", "minhas metas", "próximas contas"]) {
      resetState({});
      expect((await send(t)).status).toBe("consulta");
    }
    resetState({});
    const c = await send("cadastrar cartão");
    // 01/10/2026 — agora inicia o cadastro pelo WhatsApp (Flow ou conversa).
    expect(c.status).toBe("cartao_cadastro");
    expect(c.resposta).toContain("Qual o nome do cartão?");
    expect(gastosInserts()).toHaveLength(0);
  });
});

describe("cartão e fatura", () => {
  const body = (n: number) =>
    `Certo! Qual cartão você usou? 💳\n${Array.from({ length: n }, (_, i) => `• Cartão ${i + 1} •••• 000${i}`).join("\n")}\n\nResponda com o nome do cartão ou escolha uma opção acima.`;
  test("2-3 cartões → botões; 4+ → lista; ID devolve o rótulo", () => {
    const b = buildInteractiveFromReply(body(2));
    expect(b?.type).toBe("button");
    if (b?.type === "button") {
      expect(b.buttons[0].title.startsWith("💳 ")).toBe(true);
      expect(replyIdToTexto(b.buttons[0].id)).toBe("Cartão 1 •••• 0000");
    }
    expect(buildInteractiveFromReply(body(4))?.type).toBe("list");
  });
  test("fatura com 📅 / 🗓️", () => {
    const ir = buildInteractiveFromReply(
      'Em qual fatura essa compra vai cair?\n"fatura de outubro de 2026" ou "fatura de novembro de 2026"',
    );
    if (ir?.type !== "button") throw new Error("esperava botões");
    expect(ir.buttons.map((b) => b.title)).toEqual(["📅 Outubro", "📅 Novembro", "🗓️ Outro mês"]);
    expect(ir.buttons[0].id).toBe("fatura_comp:2026-10");
  });
  test("Graph API respeita limites (≤3 botões, títulos ≤20)", () => {
    const g = toGraphInteractive(buildInteractiveFromReply(body(3))!) as any;
    expect(g.action.buttons.length).toBe(3);
    for (const b of g.action.buttons) expect(b.reply.title.length).toBeLessThanOrEqual(20);
  });
});

describe("escolha de cartão — fluxo completo", () => {
  const dois = [
    { id: "c-mp", nome: "Mercado Pago", user_id: "u1", ultimos_digitos: "4321" },
    { id: "c-nu", nome: "Nubank", user_id: "u1", ultimos_digitos: "1234" },
  ];
  const quatro = [
    ...dois,
    { id: "c-it", nome: "Itaú", user_id: "u1", ultimos_digitos: "5555" },
    { id: "c-c6", nome: "C6", user_id: "u1", ultimos_digitos: "6666" },
  ];

  async function escolher(cartoes: any[], nome: string, tipo: "button" | "list") {
    resetState({ cartoes });
    const q = await send("Mercado 50 no crédito");
    const ir = buildInteractiveFromReply(q.resposta);
    expect(ir?.type).toBe(tipo);
    const opcoes = ir!.type === "button" ? ir!.buttons : (ir as any).rows;
    expect(opcoes).toHaveLength(cartoes.length);
    const alvo = opcoes.find((o: any) => o.title.includes(nome));
    expect(alvo.id.startsWith("card_pick:")).toBe(true);
    const conf = await tap(alvo.id, "título ignorado");
    expect(conf.status).toBe("aguardando_confirmacao");
    expect(conf.resposta).toContain(nome);
    expect(gastosInserts()).toHaveLength(0);
    const s = await tap("expense_confirm");
    expect(s.status).toBe("salva");
    const g = gastosInserts();
    expect(g).toHaveLength(1);
    return g[0].row;
  }

  test("2 cartões: tocar Mercado Pago vincula Mercado Pago", async () => {
    const row = await escolher(dois, "Mercado Pago", "button");
    expect(row.cartao_id).toBe("c-mp");
  });
  test("2 cartões: tocar Nubank vincula Nubank", async () => {
    const row = await escolher(dois, "Nubank", "button");
    expect(row.cartao_id).toBe("c-nu");
  });
  test("4 cartões: lista funciona igual", async () => {
    const row = await escolher(quatro, "Mercado Pago", "list");
    expect(row.cartao_id).toBe("c-mp");
  });
  test("menu → Cartões pelo ID abre o submenu de cartões", async () => {
    resetState({});
    const m = buildInteractiveFromReply((await send("menu")).resposta);
    if (m?.type !== "list") throw new Error("esperava lista");
    const id = m.rows.find((r) => r.id === "menu_cartoes")!.id;
    const sub = buildInteractiveFromReply((await tap(id, "x")).resposta);
    if (sub?.type !== "list") throw new Error("esperava lista");
    expect(sub.rows.map((r) => r.id)).toContain("cartoes_fatura");
  });
});
