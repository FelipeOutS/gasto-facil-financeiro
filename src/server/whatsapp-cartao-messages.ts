/**
 * Textos do cadastro de cartão pelo WhatsApp. Os blocos "Responda: ..." são
 * o fallback textual; quando o envio interativo funciona, eles saem do corpo
 * e viram botões (ver whatsapp-interactive.server.ts).
 */
import { formatarLimiteBR } from "@/lib/cartao-validacao";

export const CARD_CONFIRM_FALLBACK = "Responda:\n1. ✅ Cadastrar\n2. ✏️ Ajustar\n3. ❌ Cancelar";
export const CARD_DUP_FALLBACK = "Responda:\n1. 💳 Usar existente\n2. ✏️ Alterar nome\n3. ❌ Cancelar";
export const CARD_POS_FALLBACK = "Responda:\n1. ➕ Lançar gasto\n2. Agora não";
export const CARD_NEW_FALLBACK =
  "Responda:\n1. ➕ Cadastrar cartão\n2. ➡️ Continuar sem cadastrar\n3. ❌ Cancelar";
export const CARD_EDIT_QUESTION = "Qual dado do cartão você quer ajustar?";
export const CARD_EDIT_FALLBACK = "1. Nome\n2. Limite\n3. Fechamento\n4. Vencimento";

export type DadosParciais = {
  nome?: string;
  limite?: number;
  fechamento?: number;
  vencimento?: number;
};

export const MC = {
  intro() {
    return "Vamos cadastrar seu cartão 💳\nLeva menos de 1 minuto.";
  },
  introComGasto(nome: string | undefined, gasto: string) {
    const c = nome ? `o cartão ${nome}` : "seu cartão";
    return `Vamos cadastrar ${c} 💳\nDepois eu termino seu gasto de ${gasto}.`;
  },
  flowFalhou() {
    return "Não consegui abrir o formulário agora.\nPosso cadastrar seu cartão por aqui mesmo.";
  },
  pergunta(campo: "nome" | "limite" | "fechamento" | "vencimento", d: DadosParciais) {
    switch (campo) {
      case "nome":
        return "Qual o nome do cartão?\nEx.: Nubank, Mercado Pago, Itaú Visa";
      case "limite":
        return `Qual o limite total${d.nome ? ` do ${d.nome}` : ""}?\nEx.: 5.000,00`;
      case "fechamento":
        return "Em que dia a fatura fecha?\nEx.: 25";
      case "vencimento":
        return "E em que dia ela vence?\nEx.: 5";
    }
  },
  erroCampo(erro: string, pergunta: string) {
    return `${erro}\n\n${pergunta}`;
  },
  confirmacao(d: Required<DadosParciais>) {
    return (
      "Confere pra mim? 👀\n\n" +
      `💳 Cartão: ${d.nome}\n` +
      `💰 Limite: ${formatarLimiteBR(d.limite)}\n` +
      `📅 Fecha: dia ${d.fechamento}\n` +
      `🗓️ Vence: dia ${d.vencimento}\n\n` +
      CARD_CONFIRM_FALLBACK
    );
  },
  perguntaAjuste() {
    return `${CARD_EDIT_QUESTION}\n\n${CARD_EDIT_FALLBACK}`;
  },
  duplicado(nome: string) {
    return `Você já tem um cartão chamado ${nome}. 💳\n\n${CARD_DUP_FALLBACK}`;
  },
  cadastrado(d: Required<DadosParciais>) {
    return (
      "Cartão cadastrado com sucesso 💳✅\n\n" +
      `${d.nome}\n` +
      `Limite: ${formatarLimiteBR(d.limite)}\n` +
      `Fecha dia ${d.fechamento}\n` +
      `Vence dia ${d.vencimento}`
    );
  },
  perguntaLancarGasto() {
    return `Quer lançar um gasto nesse cartão agora?\n\n${CARD_POS_FALLBACK}`;
  },
  mantendoExistente(nome: string) {
    return `Certo! Vou manter seu cartão ${nome}. 💳`;
  },
  jaCadastrado(nome: string) {
    return `O cartão ${nome} já foi cadastrado ✅`;
  },
  cadastradoRetomando(nome: string, gasto: string) {
    return `Cartão ${nome} cadastrado ✅\n\nAgora vamos terminar seu gasto de ${gasto}.`;
  },
  usandoExistenteRetomando(nome: string, gasto: string) {
    return `Certo! Vou usar seu cartão ${nome}. 💳\n\nAgora vamos terminar seu gasto de ${gasto}.`;
  },
  pedirGasto(nome: string) {
    return `Me conta o gasto e o valor 💸\nVou lançar no cartão ${nome}.\n\nEx.: Mercado 50`;
  },
  agoraNao() {
    return "Combinado! Quando quiser, é só me mandar o gasto. 💳";
  },
  cancelado(comGasto: boolean) {
    return comGasto
      ? "Tudo certo, não cadastrei o cartão nem registrei o gasto."
      : "Tudo certo, não cadastrei o cartão.";
  },
  flowInvalido() {
    return "Esse formulário expirou ou não é mais válido. Para cadastrar um cartão, mande “cadastrar cartão”.";
  },
  limitePlano() {
    return "Seu plano atual permite apenas 1 cartão. Para cadastrar mais cartões, veja os planos no app. 💳";
  },
  semPermissao() {
    return "Seu plano atual não inclui o cadastro de cartões. Veja os planos no app. 💳";
  },
  semVinculo() {
    return "Não consegui confirmar o vínculo deste número com a sua conta. Tente novamente pelo app.";
  },
  erroSalvar() {
    return `Não consegui salvar agora. Tente de novo em instantes.\n\n${CARD_CONFIRM_FALLBACK}`;
  },
};
