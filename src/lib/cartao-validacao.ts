/**
 * Regra ÚNICA de validação de cadastro de cartão.
 *
 * Usada pelo formulário do site (CartaoForm), pelo cadastro conversacional
 * do WhatsApp e pelo WhatsApp Flow. Pura (sem IO) para rodar no navegador
 * e no servidor. Nunca aceita número completo, CVV ou senha: o cadastro só
 * guarda nome, limite, fechamento e vencimento.
 */

export const CARTAO_NOME_MAX = 40;

export type CampoCartao = "nome" | "limite" | "fechamento" | "vencimento";

export type ResultadoCampo<T> = { ok: true; valor: T } | { ok: false; erro: string };

export type DadosCartaoValidos = {
  nome: string;
  limiteTotal: number;
  diaFechamento: number;
  diaVencimento: number;
};

export type ResultadoCartao =
  | { ok: true; valor: DadosCartaoValidos }
  | { ok: false; erros: Partial<Record<CampoCartao, string>> };

export function validarNomeCartao(input: unknown): ResultadoCampo<string> {
  const nome = String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!nome) return { ok: false, erro: "Informe o nome do cartão." };
  if (nome.length > CARTAO_NOME_MAX) {
    return { ok: false, erro: `Use um nome de até ${CARTAO_NOME_MAX} caracteres.` };
  }
  // Nunca guardar número de cartão: bloqueia sequências longas de dígitos.
  if (/\d[\d\s.-]{6,}\d/.test(nome) && (nome.match(/\d/g)?.length ?? 0) >= 8) {
    return {
      ok: false,
      erro: "Não coloque o número do cartão no nome. Use só um apelido, como Nubank.",
    };
  }
  return { ok: true, valor: nome };
}

/**
 * Converte "5000", "5000,00", "5.000", "5.000,00", "R$ 5.000,00",
 * "5000.50" em número. Devolve null para formato inválido.
 */
export function parseLimiteCartao(input: unknown): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) / 100 : null;
  }
  let s = String(input ?? "")
    .replace(/r\$/gi, "")
    .replace(/\s+/g, "")
    .trim();
  if (!s) return null;
  if (s.startsWith("-")) {
    const n = parseLimiteCartao(s.slice(1));
    return n === null ? null : -n;
  }
  let n: number;
  if (s.includes(",")) {
    if (!/^(\d{1,3}(\.\d{3})+|\d+),\d{1,2}$/.test(s)) return null;
    s = s.replace(/\./g, "").replace(",", ".");
    n = Number(s);
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    n = Number(s.replace(/\./g, ""));
  } else if (/^\d+(\.\d{1,2})?$/.test(s)) {
    n = Number(s);
  } else {
    return null;
  }
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Limite precisa ser MAIOR que zero (R$ 0,01 é aceito). */
export function validarLimiteCartao(input: unknown): ResultadoCampo<number> {
  const n = parseLimiteCartao(input);
  if (n === null) return { ok: false, erro: "Não entendi o limite. Ex.: 5.000,00" };
  if (n <= 0) return { ok: false, erro: "O limite precisa ser maior que R$ 0,00." };
  if (n > 99_999_999) return { ok: false, erro: "Esse limite parece alto demais." };
  return { ok: true, valor: n };
}

/** Dia de fechamento/vencimento: inteiro de 1 a 31 (mesma regra do banco). */
export function validarDiaCartao(
  input: unknown,
  campo: "fechamento" | "vencimento",
): ResultadoCampo<number> {
  const raw =
    typeof input === "number"
      ? String(input)
      : String(input ?? "")
          .toLowerCase()
          .replace(/^dia\s+/, "")
          .trim();
  const nomeCampo = campo === "fechamento" ? "fechamento" : "vencimento";
  if (!/^\d{1,2}$/.test(raw)) {
    return { ok: false, erro: `Informe o dia de ${nomeCampo} com um número de 1 a 31.` };
  }
  const n = Number(raw);
  if (n < 1 || n > 31) {
    return { ok: false, erro: `O dia de ${nomeCampo} precisa estar entre 1 e 31.` };
  }
  return { ok: true, valor: n };
}

export function validarCartao(input: {
  nome: unknown;
  limite: unknown;
  diaFechamento: unknown;
  diaVencimento: unknown;
}): ResultadoCartao {
  const nome = validarNomeCartao(input.nome);
  const limite = validarLimiteCartao(input.limite);
  const fech = validarDiaCartao(input.diaFechamento, "fechamento");
  const venc = validarDiaCartao(input.diaVencimento, "vencimento");
  if (nome.ok && limite.ok && fech.ok && venc.ok) {
    return {
      ok: true,
      valor: {
        nome: nome.valor,
        limiteTotal: limite.valor,
        diaFechamento: fech.valor,
        diaVencimento: venc.valor,
      },
    };
  }
  const erros: Partial<Record<CampoCartao, string>> = {};
  if (!nome.ok) erros.nome = nome.erro;
  if (!limite.ok) erros.limite = limite.erro;
  if (!fech.ok) erros.fechamento = fech.erro;
  if (!venc.ok) erros.vencimento = venc.erro;
  return { ok: false, erros };
}

/** Nome para comparar duplicidade: sem acento, minúsculo, espaços únicos. */
export function normalizarNomeCartao(nome: string): string {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Igualdade exata após normalização ("Nubank" ≠ "Nubank PJ"). */
export function encontrarCartaoDuplicado<T extends { nome: string }>(
  nome: string,
  cartoes: T[],
): T | undefined {
  const alvo = normalizarNomeCartao(nome);
  if (!alvo) return undefined;
  return cartoes.find((c) => normalizarNomeCartao(c.nome) === alvo);
}

export function formatarLimiteBR(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
