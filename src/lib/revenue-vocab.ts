// Vocabulário contextual de receita/faturamento por perfil de cadastro.
// Wrapper leve em torno do t() do i18next: quando o usuário é MEI ou
// Empresa, busca primeiro uma variante "<chave>_mei" / "<chave>_empresa"
// no namespace atual; se a chave variante não existir, cai de volta na
// chave original. Pessoa física e perfil não definido usam sempre a
// chave padrão — nenhum comportamento muda.
//
// Esta abordagem evita duplicar arquivos i18n inteiros e centraliza a
// decisão "qual termo o usuário vê?" em um único lugar.

import { tipoEfetivo, type TipoCadastro } from "./profile-utils";

export type RevenueSuffix = "" | "_mei" | "_empresa";

export function revenueSuffix(tipo: TipoCadastro): RevenueSuffix {
  switch (tipoEfetivo(tipo)) {
    case "mei":
      return "_mei";
    case "empresa":
      return "_empresa";
    default:
      return "";
  }
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

// Sentinel usado para detectar quando a chave variante não existe.
const MISSING = "__rev_missing__";

/**
 * Cria uma função `tr` que se comporta como `t`, mas tenta primeiro
 * carregar `<key><suffix>` antes de cair na chave original.
 *
 * Mantém compatível com count, interpolation e demais opções do i18next.
 */
export function makeRevenueT(t: TFn, suffix: RevenueSuffix): TFn {
  if (!suffix) return t;
  return (key: string, opts?: Record<string, unknown>) => {
    const variant = t(`${key}${suffix}`, {
      ...(opts ?? {}),
      defaultValue: MISSING,
    });
    if (variant !== MISSING && variant !== `${key}${suffix}`) return variant;
    return t(key, opts);
  };
}
