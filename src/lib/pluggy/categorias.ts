import { GI_CATEGORIAS, type GiCategoria } from "./rules";

/** Lista única de categorias para a tela e o servidor (mesma fonte da regra automática). */
export function isGiCategoria(v: string): v is GiCategoria {
  return (GI_CATEGORIAS as readonly string[]).includes(v);
}

/**
 * Opções do seletor. Se o valor salvo não estiver na lista, ele é mantido como opção
 * para que o navegador nunca mostre outra categoria (ex.: a primeira) no lugar dele.
 */
export function categoriaOptions(current: string | null | undefined): string[] {
  const base: string[] = [...GI_CATEGORIAS];
  if (current && !base.includes(current)) base.push(current);
  return base;
}
