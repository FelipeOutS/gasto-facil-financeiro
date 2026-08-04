/**
 * Utilitários de CNPJ — client-safe.
 *
 * Funções puras: limpeza, validação (formato + dígito verificador) e
 * formatação. Usadas no client (componentes) e no server (validação antes
 * de chamar API externa).
 */

/** Remove qualquer caractere não numérico. */
export function limparCnpj(input: string | null | undefined): string {
  if (!input) return "";
  return String(input).replace(/\D+/g, "");
}

/** Formata um CNPJ de 14 dígitos para o padrão 00.000.000/0000-00. */
export function formatarCnpj(cnpj: string | null | undefined): string {
  const limpo = limparCnpj(cnpj);
  if (limpo.length !== 14) return limpo;
  return limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/** Verifica se a string contém exatamente 14 dígitos numéricos. */
export function temFormatoCnpj(cnpj: string | null | undefined): boolean {
  return /^\d{14}$/.test(limparCnpj(cnpj));
}

/**
 * Valida o CNPJ pelos dois dígitos verificadores conforme algoritmo oficial
 * da Receita Federal. Rejeita também CNPJs com todos os dígitos iguais
 * (ex.: "00000000000000"), que passariam no algoritmo mas são inválidos.
 */
export function validarCnpj(cnpj: string | null | undefined): boolean {
  const numeros = limparCnpj(cnpj);
  if (numeros.length !== 14) return false;
  // Rejeita repetições triviais.
  if (/^(\d)\1{13}$/.test(numeros)) return false;

  const calcDV = (base: string, pesos: number[]): number => {
    const soma = base.split("").reduce((acc, ch, i) => acc + Number(ch) * pesos[i]!, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const dv1 = calcDV(numeros.slice(0, 12), pesos1);
  if (dv1 !== Number(numeros[12])) return false;
  const dv2 = calcDV(numeros.slice(0, 13), pesos2);
  if (dv2 !== Number(numeros[13])) return false;
  return true;
}

/** Mensagem padrão para CNPJ inválido (uso no frontend). */
export const MSG_CNPJ_INVALIDO = "CNPJ inválido. Confira os números e tente novamente.";
