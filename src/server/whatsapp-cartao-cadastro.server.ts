/**
 * Cadastro de cartão pelo WhatsApp — máquina de estados.
 *
 * Caminhos: WhatsApp Flow (quando há flow_id configurado) ou conversa
 * (Nome → Limite → Fechamento → Vencimento → Confirmação). Os dois usam a
 * mesma validação (`@/lib/cartao-validacao`), a mesma criação pelo
 * servidor (`criarCartaoViaWhatsApp`), a mesma duplicidade e a mesma
 * idempotência. Nada é salvo antes de "✅ Cadastrar".
 *
 * Estado guardado como sessão em `whatsapp_messages` (parsed.kind =
 * "cartao_cadastro"), válida por até 2 horas e ligada a usuário + número.
 */
import { randomBytes, randomUUID } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  encontrarCartaoDuplicado,
  validarDiaCartao,
  validarLimiteCartao,
  validarNomeCartao,
} from "@/lib/cartao-validacao";
import { criarCartaoViaWhatsApp, type CartaoCriado } from "./cartao-cadastro.server";
import { buildCardFlowInteractive, cardFlowConfig, parseCardFlowResponse } from "./whatsapp-cartao-flow";
import { MC, type DadosParciais } from "./whatsapp-cartao-messages";

export const CARD_REG_KIND = "cartao_cadastro";
export const CARD_REG_TTL_MS = 2 * 60 * 60 * 1000;

type Campo = "nome" | "limite" | "fechamento" | "vencimento";
const CAMPOS: Campo[] = ["nome", "limite", "fechamento", "vencimento"];

export const CARD_REG_ACTIVE_STATES = [
  "cartao_cad_coleta",
  "cartao_cad_confirmacao",
  "cartao_cad_duplicado",
  "cartao_cad_pos",
  "cartao_cad_pos_gasto",
] as const;
type CardState = (typeof CARD_REG_ACTIVE_STATES)[number];

/** Gasto pendente preservado durante o cadastro (cópia da sessão de gasto). */
export type GastoPendente = { nome: string; valor: number } & Record<string, unknown>;

export type CardRegSession = {
  kind: typeof CARD_REG_KIND;
  requestKey: string;
  flowToken?: string;
  campo?: Campo | "ajuste" | null;
  /** Ajuste de um campo só: depois de responder, volta à confirmação. */
  ajustando?: boolean;
  dados: DadosParciais;
  gastoPendente?: GastoPendente;
  cartaoId?: string;
  cartaoNome?: string;
};

export type CardOutcome = {
  status: "cartao_cadastro" | "cartao_salvo" | "cancelada" | string;
  resposta: string;
  graphInteractive?: { [key: string]: Json | undefined };
  [k: string]: unknown;
};

export type CardRegDeps = {
  userId: string;
  telefone: string;
  externalId: string | null;
  texto: string;
  recebidaEm: string;
  cartoes: Array<{ id: string; nome: string }>;
  /** Formata "R$ 89,90 em Farmácia" para o gasto pendente. */
  resumoGasto: (g: GastoPendente) => string;
  /** Retoma o gasto pendente já com o cartão escolhido, até a confirmação. */
  retomarGasto: (g: GastoPendente, cartao: CartaoCriado | { id: string; nome: string }, prefixo: string) => Promise<CardOutcome>;
  /** Começa um gasto novo no cartão; null se faltar descrição/valor. */
  iniciarGastoComCartao: (texto: string, cartao: { id: string; nome: string }) => Promise<CardOutcome | null>;
};

type Ativo = { id: string; status: CardState; session: CardRegSession };

// ---------- persistência ----------

export async function buscarCadastroCartaoAtivo(userId: string, telefone: string): Promise<Ativo | null> {
  const desde = new Date(Date.now() - CARD_REG_TTL_MS).toISOString();
  const { data } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id, status, parsed, recebida_em")
    .eq("user_id", userId)
    .eq("telefone", telefone)
    .eq("parsed->>kind", CARD_REG_KIND)
    .gte("recebida_em", desde)
    .order("recebida_em", { ascending: false })
    .limit(10);
  const rows = (Array.isArray(data) ? data : []) as Array<{
    id: string;
    status: string;
    parsed: CardRegSession;
    recebida_em: string;
  }>;
  const ativo = rows
    .filter((r) => (CARD_REG_ACTIVE_STATES as readonly string[]).includes(r.status))
    .sort((a, b) => Date.parse(b.recebida_em) - Date.parse(a.recebida_em))[0];
  if (!ativo || ativo.parsed?.kind !== CARD_REG_KIND) return null;
  return { id: ativo.id, status: ativo.status as CardState, session: ativo.parsed };
}

export async function fecharCadastroCartao(userId: string, telefone: string, motivo = "cancelada") {
  await supabaseAdmin
    .from("whatsapp_messages")
    .update({ status: motivo })
    .eq("user_id", userId)
    .eq("telefone", telefone)
    .eq("parsed->>kind", CARD_REG_KIND)
    .in("status", [...CARD_REG_ACTIVE_STATES]);
}

async function marcar(id: string, status: string) {
  await supabaseAdmin.from("whatsapp_messages").update({ status }).eq("id", id);
}

async function gravar(deps: CardRegDeps, status: string, s: CardRegSession, resposta: string) {
  const { error } = await supabaseAdmin.from("whatsapp_messages").insert({
    user_id: deps.userId,
    external_id: deps.externalId,
    telefone: deps.telefone,
    texto: deps.texto.slice(0, 500),
    recebida_em: deps.recebidaEm,
    status,
    parsed: s as unknown as Json,
    resposta_sugerida: resposta,
  });
  return !error;
}

/** Fecha o estado atual e grava o próximo. */
async function transitar(
  deps: CardRegDeps,
  ativo: Ativo | null,
  status: CardState | "cartao_cad_concluido" | "cancelada",
  s: CardRegSession,
  out: CardOutcome,
): Promise<CardOutcome> {
  if (ativo) await marcar(ativo.id, "expirada");
  await gravar(deps, status, s, out.resposta);
  return out;
}

// ---------- detecção ----------

const ENTIDADES_NAO_CARTAO =
  /^(gasto|gastos|receita|receitas|conta|contas|meta|metas|despesa|despesas|pagamento|pix|boleto|lembrete|orcamento|orçamento)\b/i;

/** "cadastrar cartão", "novo cartão", "cadastrar meu Nubank" → {nome?}. */
export function detectarIntencaoCadastroCartao(texto: string): { nome?: string } | null {
  const t = (texto ?? "").trim().replace(/[.!?]+$/, "").trim();
  if (!t || t.length > 80) return null;
  const CART = "cart(?:ão|ao|ões|oes)";
  const novo = new RegExp(`^(?:um\\s+)?novo\\s+${CART}(?:\\s+(.+))?$`, "i").exec(t);
  if (novo) return nomeDe(novo[1]);
  const m = new RegExp(
    `^(?:eu\\s+)?(?:quero|queria|preciso|vou|pode|posso)?\\s*(?:cadastrar|adicionar|criar|incluir|registrar)\\s+(?:(um|uma|o|meu|minha)\\s+)?(?:novo\\s+)?(.*)$`,
    "i",
  ).exec(t);
  if (!m) return null;
  const artigo = (m[1] ?? "").toLowerCase();
  const resto = (m[2] ?? "").trim();
  const comCartao = new RegExp(`^${CART}(?:\\s+de\\s+cr[eé]dito)?(?:\\s+(?:do|da|de|no|na))?(?:\\s+(.+))?$`, "i").exec(resto);
  if (comCartao) return nomeDe(comCartao[1]);
  if ((artigo === "meu" || artigo === "minha") && resto && !ENTIDADES_NAO_CARTAO.test(resto)) {
    if (/\d/.test(resto) || resto.split(/\s+/).length > 3) return null;
    return nomeDe(resto);
  }
  return null;
}

function nomeDe(raw: string | undefined): { nome?: string } {
  const r = (raw ?? "").trim();
  if (!r) return {};
  const v = validarNomeCartao(r.charAt(0).toUpperCase() + r.slice(1));
  return v.ok ? { nome: v.valor } : {};
}

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const isCancel = (t: string) =>
  /^(3|cancelar|cancela|cancelado|nao|n|deixa pra la|deixa para la|parar|sair)$/.test(t);

function proximoCampo(d: DadosParciais): Campo | null {
  for (const c of CAMPOS) if (d[c] === undefined) return c;
  return null;
}

function completo(d: DadosParciais): d is Required<DadosParciais> {
  return proximoCampo(d) === null;
}

// ---------- coleta / Flow ----------

/** Abre o Flow (se configurado) ou pergunta o próximo campo por conversa. */
async function pedirDados(
  deps: CardRegDeps,
  ativo: Ativo | null,
  s: CardRegSession,
  intro: string,
  opts: { perguntaFallback?: string } = {},
): Promise<CardOutcome> {
  const campo = s.campo === "ajuste" ? "ajuste" : (s.campo ?? proximoCampo(s.dados) ?? "nome");
  const pergunta = opts.perguntaFallback ?? (campo === "ajuste" ? MC.perguntaAjuste() : MC.pergunta(campo, s.dados));
  const next: CardRegSession = { ...s, campo };
  const cfg = cardFlowConfig();
  if (cfg) {
    next.flowToken = randomBytes(16).toString("hex");
    const graphInteractive = buildCardFlowInteractive({
      flowId: cfg.flowId,
      flowToken: next.flowToken,
      body: intro,
      prefill: next.dados,
      draft: cfg.draft,
    });
    // `resposta` só é enviada se o Flow não abrir → cadastro por conversa.
    const resposta = `${MC.flowFalhou()}\n\n${pergunta}`;
    return transitar(deps, ativo, "cartao_cad_coleta", next, {
      status: "cartao_cadastro",
      resposta,
      graphInteractive,
    });
  }
  next.flowToken = undefined;
  const resposta = intro ? `${intro}\n\n${pergunta}` : pergunta;
  return transitar(deps, ativo, "cartao_cad_coleta", next, { status: "cartao_cadastro", resposta });
}

/** Dados completos → duplicidade → confirmação (nada é salvo aqui). */
async function irParaConfirmacao(deps: CardRegDeps, ativo: Ativo | null, s: CardRegSession, prefixo = "") {
  const d = s.dados as Required<DadosParciais>;
  const next: CardRegSession = { ...s, campo: null, ajustando: false };
  const dup = encontrarCartaoDuplicado(d.nome, deps.cartoes);
  if (dup) {
    return transitar(deps, ativo, "cartao_cad_duplicado", next, {
      status: "cartao_cadastro",
      resposta: prefixo + MC.duplicado(dup.nome),
    });
  }
  return transitar(deps, ativo, "cartao_cad_confirmacao", next, {
    status: "cartao_cadastro",
    resposta: prefixo + MC.confirmacao(d),
  });
}

function validarCampo(campo: Campo, valor: unknown) {
  if (campo === "nome") return validarNomeCartao(valor);
  if (campo === "limite") return validarLimiteCartao(valor);
  return validarDiaCartao(valor, campo);
}

// ---------- criação ----------

async function cadastrar(deps: CardRegDeps, ativo: Ativo, s: CardRegSession): Promise<CardOutcome> {
  const d = s.dados as Required<DadosParciais>;
  const r = await criarCartaoViaWhatsApp({
    userId: deps.userId,
    telefone: deps.telefone,
    requestKey: s.requestKey,
    dados: { nome: d.nome, limite: d.limite, diaFechamento: d.fechamento, diaVencimento: d.vencimento },
  });
  if (r.status === "duplicado") {
    return transitar(deps, ativo, "cartao_cad_duplicado", s, {
      status: "cartao_cadastro",
      resposta: MC.duplicado(r.existente.nome),
    });
  }
  if (r.status === "invalido") {
    const campo = CAMPOS.find((c) => r.erros[c]) ?? "nome";
    const dados = { ...s.dados, [campo]: undefined };
    return pedirDados(deps, ativo, { ...s, dados, campo, ajustando: true }, r.erros[campo] ?? "");
  }
  if (r.status === "limite_plano" || r.status === "sem_permissao" || r.status === "sem_vinculo") {
    const resposta =
      r.status === "limite_plano" ? MC.limitePlano() : r.status === "sem_permissao" ? MC.semPermissao() : MC.semVinculo();
    return transitar(deps, ativo, "cancelada", s, { status: "cancelada", resposta });
  }
  if (r.status === "erro") {
    return { status: "cartao_cadastro", resposta: MC.erroSalvar() };
  }
  const cartao = r.cartao;
  const done: CardRegSession = { ...s, cartaoId: cartao.id, cartaoNome: cartao.nome };
  const dadosFinais = {
    nome: cartao.nome,
    limite: cartao.limiteTotal,
    fechamento: cartao.diaFechamento,
    vencimento: cartao.diaVencimento,
  };
  if (s.gastoPendente) {
    // Retoma o gasto: a sessão de gasto nova carrega o external_id.
    await marcar(ativo.id, "cartao_cad_concluido");
    const out = await deps.retomarGasto(
      s.gastoPendente,
      cartao,
      MC.cadastradoRetomando(cartao.nome, deps.resumoGasto(s.gastoPendente)) + "\n\n",
    );
    return { ...out, cartaoCriado: r.status === "criado" };
  }
  const resposta = `${MC.cadastrado(dadosFinais)}\n\n${MC.perguntaLancarGasto()}`;
  const out = await transitar(deps, ativo, "cartao_cad_pos", done, { status: "cartao_salvo", resposta });
  return { ...out, cartaoCriado: r.status === "criado" };
}

// ---------- entrada principal ----------

export type CardRegInput = CardRegDeps & {
  flowResponseJson?: string;
  /** Sessão de gasto aguardando confirmação com cartão não cadastrado. */
  sessaoGastoNaoCadastrado?: { id: string; session: GastoPendente & { cartaoDigitado?: string } } | null;
  /** Há outra sessão pendente (gasto, conta...)? Então não inicia por texto. */
  temOutraSessao: boolean;
};

export async function tratarCadastroCartao(inp: CardRegInput): Promise<CardOutcome | null> {
  const deps: CardRegDeps = inp;
  const ativo = await buscarCadastroCartaoAtivo(inp.userId, inp.telefone);

  // 1. Conclusão do Flow.
  if (inp.flowResponseJson !== undefined) {
    const resp = parseCardFlowResponse(inp.flowResponseJson);
    if (!resp || !ativo || !ativo.session.flowToken || ativo.session.flowToken !== resp.flow_token) {
      return { status: "cartao_cadastro", resposta: MC.flowInvalido() };
    }
    if (ativo.status !== "cartao_cad_coleta") {
      // Reenvio depois de já ter avançado: só mostra o estado atual.
      return { status: "cartao_cadastro", resposta: MC.flowInvalido() };
    }
    const s = ativo.session;
    const dados: DadosParciais = { ...s.dados };
    const entrada: Record<Campo, unknown> = {
      nome: resp.nome,
      limite: resp.limite,
      fechamento: resp.fechamento,
      vencimento: resp.vencimento,
    };
    const erros: string[] = [];
    for (const c of CAMPOS) {
      const v = validarCampo(c, entrada[c]);
      if (v.ok) (dados as Record<string, unknown>)[c] = v.valor;
      else {
        (dados as Record<string, unknown>)[c] = undefined;
        erros.push(v.erro);
      }
    }
    if (erros.length) {
      return pedirDados(deps, ativo, { ...s, dados, campo: null }, erros.join("\n"));
    }
    return irParaConfirmacao(deps, ativo, { ...s, dados, flowToken: undefined });
  }

  const t = norm(inp.texto);

  // 2. Cadastro durante um gasto com cartão não cadastrado.
  if (!ativo && inp.sessaoGastoNaoCadastrado) {
    if (/^(1|cadastrar|cadastrar cartao|cadastrar o cartao|cadastrar cartao agora|cadastrar agora)$/.test(t)) {
      const g = inp.sessaoGastoNaoCadastrado;
      await marcar(g.id, "expirada");
      const s: CardRegSession = {
        kind: CARD_REG_KIND,
        requestKey: randomUUID(),
        dados: {},
        gastoPendente: g.session,
      };
      const nome = g.session.cartaoDigitado ? nomeDe(g.session.cartaoDigitado).nome : undefined;
      if (nome) s.dados.nome = nome;
      return pedirDados(deps, null, s, MC.introComGasto(nome, deps.resumoGasto(g.session)));
    }
    return null;
  }

  // 3. Início por menu/texto.
  if (!ativo) {
    if (inp.temOutraSessao) return null;
    const intent = detectarIntencaoCadastroCartao(inp.texto);
    if (!intent) return null;
    const s: CardRegSession = { kind: CARD_REG_KIND, requestKey: randomUUID(), dados: {} };
    if (intent.nome) s.dados.nome = intent.nome;
    return pedirDados(deps, null, s, MC.intro());
  }

  const s = ativo.session;

  // 4. Estados ativos.
  if (ativo.status === "cartao_cad_pos") {
    if (/^(1|lancar gasto|sim|quero|lancar)$/.test(t)) {
      return transitar(deps, ativo, "cartao_cad_pos_gasto", s, {
        status: "cartao_cadastro",
        resposta: MC.pedirGasto(s.cartaoNome ?? ""),
      });
    }
    if (/^(2|agora nao|nao|depois|n)$/.test(t)) {
      await marcar(ativo.id, "cartao_cad_concluido");
      return { status: "cartao_cadastro", resposta: MC.agoraNao() };
    }
    if (/^(cadastrar|1 cadastrar|confirmar)$/.test(t)) {
      return {
        status: "cartao_cadastro",
        resposta: `${MC.jaCadastrado(s.cartaoNome ?? "")}\n\n${MC.perguntaLancarGasto()}`,
      };
    }
    // Qualquer outra coisa: encerra o pós-cadastro e segue o fluxo normal.
    await marcar(ativo.id, "cartao_cad_concluido");
    return null;
  }

  if (isCancel(t) && ativo.status !== "cartao_cad_confirmacao" && ativo.status !== "cartao_cad_duplicado") {
    await marcar(ativo.id, "cancelada");
    return { status: "cancelada", resposta: MC.cancelado(!!s.gastoPendente) };
  }

  if (ativo.status === "cartao_cad_pos_gasto") {
    const out = await deps.iniciarGastoComCartao(inp.texto, { id: s.cartaoId ?? "", nome: s.cartaoNome ?? "" });
    if (!out) {
      return { status: "cartao_cadastro", resposta: MC.pedirGasto(s.cartaoNome ?? "") };
    }
    await marcar(ativo.id, "cartao_cad_concluido");
    return out;
  }

  if (ativo.status === "cartao_cad_confirmacao") {
    if (/^(1|cadastrar|sim|s|confirmar|confirma|ok|pode cadastrar|salvar)$/.test(t)) {
      return cadastrar(deps, ativo, s);
    }
    if (/^(2|ajustar|alterar|editar|corrigir)$/.test(t)) {
      return pedirDados(deps, ativo, { ...s, campo: "ajuste" }, MC.intro(), {
        perguntaFallback: MC.perguntaAjuste(),
      });
    }
    if (isCancel(t)) {
      await marcar(ativo.id, "cancelada");
      return { status: "cancelada", resposta: MC.cancelado(!!s.gastoPendente) };
    }
    return { status: "cartao_cadastro", resposta: MC.confirmacao(s.dados as Required<DadosParciais>) };
  }

  if (ativo.status === "cartao_cad_duplicado") {
    const dup = encontrarCartaoDuplicado(s.dados.nome ?? "", deps.cartoes);
    if (/^(1|usar existente|usar|existente)$/.test(t) && dup) {
      if (s.gastoPendente) {
        await marcar(ativo.id, "cartao_cad_concluido");
        return deps.retomarGasto(
          s.gastoPendente,
          dup,
          MC.usandoExistenteRetomando(dup.nome, deps.resumoGasto(s.gastoPendente)) + "\n\n",
        );
      }
      return transitar(deps, ativo, "cartao_cad_pos", { ...s, cartaoId: dup.id, cartaoNome: dup.nome }, {
        status: "cartao_cadastro",
        resposta: `${MC.mantendoExistente(dup.nome)}\n\n${MC.perguntaLancarGasto()}`,
      });
    }
    if (/^(2|alterar nome|alterar|mudar nome|outro nome)$/.test(t)) {
      return pedirDados(
        deps,
        ativo,
        { ...s, dados: { ...s.dados, nome: undefined }, campo: "nome", ajustando: true },
        MC.intro(),
      );
    }
    if (isCancel(t)) {
      await marcar(ativo.id, "cancelada");
      return { status: "cancelada", resposta: MC.cancelado(!!s.gastoPendente) };
    }
    return { status: "cartao_cadastro", resposta: MC.duplicado(dup?.nome ?? s.dados.nome ?? "") };
  }

  // cartao_cad_coleta (conversa; também vale se o Flow não abriu)
  if (s.campo === "ajuste") {
    const mapa: Record<string, Campo> = {
      "1": "nome",
      nome: "nome",
      "2": "limite",
      limite: "limite",
      "3": "fechamento",
      fechamento: "fechamento",
      "4": "vencimento",
      vencimento: "vencimento",
    };
    const campo = mapa[t.replace(/^(ajustar|alterar|mudar)\s+/, "")];
    if (!campo) return { status: "cartao_cadastro", resposta: MC.perguntaAjuste() };
    const next: CardRegSession = { ...s, campo, ajustando: true, flowToken: undefined };
    return transitar(deps, ativo, "cartao_cad_coleta", next, {
      status: "cartao_cadastro",
      resposta: MC.pergunta(campo, s.dados),
    });
  }

  const campo: Campo = (s.campo as Campo | null) ?? proximoCampo(s.dados) ?? "nome";
  const v = validarCampo(campo, inp.texto);
  if (!v.ok) {
    return { status: "cartao_cadastro", resposta: MC.erroCampo(v.erro, MC.pergunta(campo, s.dados)) };
  }
  const dados = { ...s.dados, [campo]: v.valor } as DadosParciais;
  const prox = s.ajustando ? null : proximoCampo(dados);
  if (completo(dados) && !prox) {
    return irParaConfirmacao(deps, ativo, { ...s, dados, flowToken: undefined });
  }
  const proximo = prox ?? proximoCampo(dados) ?? "nome";
  const next: CardRegSession = { ...s, dados, campo: proximo, ajustando: false, flowToken: undefined };
  return transitar(deps, ativo, "cartao_cad_coleta", next, {
    status: "cartao_cadastro",
    resposta: MC.pergunta(proximo, dados),
  });
}
