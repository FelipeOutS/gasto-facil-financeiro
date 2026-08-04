// Vocabulário contextual de receita/faturamento por perfil de cadastro.
// Wrapper leve em torno do t() do i18next: quando o usuário é MEI ou
// Empresa, busca primeiro uma variante "<chave>_mei" / "<chave>_empresa"
// no namespace atual; se a chave variante não existir, cai de volta na
// chave original. Pessoa física e perfil não definido usam sempre a
// chave padrão — nenhum comportamento muda.
//
// Esta abordagem evita duplicar arquivos i18n inteiros e centraliza a
// decisão "qual termo o usuário vê?" em um único lugar.

import type { TFunction } from "i18next";
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

// Sentinel usado para detectar quando a chave variante não existe.
const MISSING = "__rev_missing__";

/**
 * Cria uma função `t` que se comporta como o `TFunction` original do
 * i18next, mas tenta primeiro carregar `<key><suffix>` antes de cair
 * na chave original. Compatível com `<Trans t={t} />`, count,
 * interpolation e demais opções do i18next.
 */
export function makeRevenueT<T extends TFunction<any, any>>(t: T, suffix: RevenueSuffix): T {
  if (!suffix) return t;
  const wrapper = ((key: string, opts?: Record<string, unknown>) => {
    const variant = (t as unknown as (k: string, o?: Record<string, unknown>) => string)(
      `${key}${suffix}`,
      { ...(opts ?? {}), defaultValue: MISSING },
    );
    if (variant !== MISSING && variant !== `${key}${suffix}`) return variant;
    return (t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, opts);
  }) as unknown as T;
  return wrapper;
}
