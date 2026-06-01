/**
 * Mercado Inteligente — limpeza e extração de marca em nomes de produto.
 *
 * Nomes de produto vindos de cupom/OCR/listas costumam misturar marca,
 * unidade, peso e adjetivos promocionais — isso atrapalha a busca por
 * imagem no Open Food Facts. Aqui normalizamos:
 *
 *  - removemos ruídos (unidades de medida, "tradicional", "promoção", etc.)
 *  - tentamos extrair uma marca provável a partir de lista conhecida
 *  - devolvemos o nome base limpo, separado da marca detectada
 *
 * Sem alterar regras de negócio: o nome original do produto continua
 * sendo o que é salvo. Esta utilidade é usada SÓ para o lookup de imagem.
 */
import { normalizeForKey } from "./product-image-key";

// Lista curada de marcas BR comuns em supermercado. Não precisa ser
// exaustiva — serve para melhorar a precisão do lookup quando o usuário
// digita a marca dentro do nome do produto.
export const KNOWN_BRANDS: string[] = [
  // carnes/frios
  "sadia",
  "perdigao",
  "seara",
  "aurora",
  "friboi",
  "swift",
  "pif paf",
  "frimesa",
  // laticinios
  "tirolez",
  "tirol",
  "vigor",
  "danone",
  "itambe",
  "piracanjuba",
  "italac",
  "elege",
  "parmalat",
  "ninho",
  "molico",
  "polenghi",
  "batavo",
  "qualy",
  "doriana",
  "becel",
  "claybom",
  "primor",
  "deline",
  // cafe / acucar / cha
  "nestle",
  "nescafe",
  "nescau",
  "toddy",
  "toddynho",
  "pilao",
  "tres coracoes",
  "melitta",
  "uniao",
  "guarani",
  "leao",
  // massas / paes / biscoito
  "adria",
  "barilla",
  "renata",
  "galo",
  "vitarella",
  "bauducco",
  "marilan",
  "richester",
  "piraque",
  "isabela",
  "fortaleza",
  "petybon",
  "nissin",
  // mercearia / oleo / arroz / feijao
  "knorr",
  "maggi",
  "arisco",
  "hellmanns",
  "heinz",
  "fugini",
  "quero",
  "predilecta",
  "bonduelle",
  "tang",
  "yoki",
  "kicaldo",
  "camil",
  "tio joao",
  "tio urbano",
  "soya",
  "liza",
  "salada",
  "sinha",
  // limpeza
  "ype",
  "omo",
  "tixan",
  "ariel",
  "brilhante",
  "comfort",
  "downy",
  "sun",
  "vanish",
  "veja",
  "cif",
  "pinho sol",
  "harpic",
  "bombril",
  "assolan",
  "minuano",
  "limpol",
  "coquel",
  "casa perfume",
  "scotch brite",
  // higiene
  "duracell",
  "panasonic",
  "colgate",
  "oral b",
  "sensodyne",
  "close up",
  "rexona",
  "dove",
  "nivea",
  "lux",
  "palmolive",
  "protex",
  "johnsons",
  "pampers",
  "huggies",
  "mamypoko",
  "personal",
  "neve",
  "softys",
  "kleenex",
  "scott",
  // bebidas
  "coca cola",
  "coca",
  "pepsi",
  "guarana antarctica",
  "fanta",
  "sprite",
  "sukita",
  "schweppes",
  "del valle",
  "ades",
  "natural one",
  "tial",
  "skol",
  "brahma",
  "antarctica",
  "ambev",
  "heineken",
  "stella artois",
  "budweiser",
  "amstel",
  "corona",
  "eisenbahn",
  "itaipava",
  "crystal",
  "minalba",
  "bonafont",
  "indaia",
  "lindoya",
  "purity",
  // doces / sorvete
  "kibon",
  "garoto",
  "lacta",
  "hersheys",
  "ferrero",
  "kitkat",
  "trento",
  "bis",
  "talento",
  "diamante negro",
  "trakinas",
  "oreo",
];

export const STRONG_MARKET_BRANDS: string[] = [
  "heineken",
  "coca cola",
  "coca-cola",
  "coca",
  "pepsi",
  "fanta",
  "sprite",
  "guarana antarctica",
  "stella artois",
  "budweiser",
  "amstel",
  "corona",
  "brilhante",
  "comfort",
  "downy",
  "toddy",
  "nescafe",
  "brahma",
  "skol",
  "antarctica",
  "itaipava",
  "ambev",
  "nestle",
  "nescau",
  "toddynho",
  "toddy",
  "piracanjuba",
  "italac",
  "sadia",
  "perdigao",
  "seara",
  "aurora",
  "adria",
  "pilao",
  "melitta",
  "tres coracoes",
  "ype",
  "omo",
  "ariel",
  "veja",
  "bombril",
  "assolan",
  "coquel",
  "limpol",
  "minuano",
  "claybom",
  "polenghi",
  "tirol",
  "batavo",
  "piraque",
  "bauducco",
  "qualy",
  "doriana",
];

// Ordenamos por comprimento desc para casar primeiro marcas multi-palavra
// (ex.: "tres coracoes" antes de "coracoes").
const SORTED_BRANDS = [...KNOWN_BRANDS].sort((a, b) => b.length - a.length);

export function isStrongMarketBrand(brand: string | null | undefined): boolean {
  const normalized = normalizeForKey(brand);
  if (!normalized) return false;
  return STRONG_MARKET_BRANDS.some((b) => normalizeForKey(b) === normalized);
}

// Tokens a remover: unidades, embalagens, adjetivos promocionais comuns.
const NOISE_TOKENS = new Set([
  "kg",
  "g",
  "mg",
  "l",
  "ml",
  "un",
  "und",
  "unid",
  "unidade",
  "unidades",
  "pc",
  "pcs",
  "pct",
  "pacote",
  "pacotes",
  "cx",
  "caixa",
  "caixas",
  "sache",
  "sachet",
  "saches",
  "sache",
  "saches",
  "garrafa",
  "garrafas",
  "lata",
  "latas",
  "frasco",
  "frascos",
  "pote",
  "potes",
  "barra",
  "barras",
  "fardo",
  "fardos",
  "duzia",
  "duzias",
  "rolo",
  "rolos",
  "tradicional",
  "tradicionais",
  "especial",
  "especiais",
  "original",
  "originais",
  "novo",
  "nova",
  "premium",
  "promocao",
  "promo",
  "oferta",
  "leve",
  "pague",
  "defum",
  "defumada",
  "defumado",
  "defumadas",
  "defumados",
  "congelada",
  "congelado",
  "resfriada",
  "resfriado",
  "fatiada",
  "fatiado",
  "fatiados",
  "fatiadas",
  "tipo",
  "ling", // abreviação comum de "linguiça" em cupom
  "de",
  "da",
  "do",
  "das",
  "dos",
]);

// Remove padrões numéricos com unidade (1kg, 500g, 2 l, 1.5l, 12x350ml...).
const NUMERIC_UNIT_RE =
  /\b\d+[.,]?\d*\s?(?:kg|g|mg|l|ml|un|und|unid|cx|pct|pc|pcs|sache|saches|rolo|rolos|fardo|barra|barras|x|%)\b/gi;
const NUMBER_X_NUMBER_RE = /\b\d+\s?x\s?\d+\s?(?:kg|g|mg|l|ml|un|cx|pct)\b/gi;

/**
 * Normalização específica de mercado/OCR para lookup de imagem.
 * Mantém apenas texto pesquisável; não altera o nome salvo pelo usuário.
 */
export function normalizeMarketProductTerms(
  raw: string | null | undefined,
  hintedBrand?: string | null,
): string {
  let text = normalizeForKey(raw);
  if (!text) return "";

  const brandKey = normalizeForKey(hintedBrand);
  const beerContext =
    [
      "heineken",
      "brahma",
      "skol",
      "antarctica",
      "itaipava",
      "ambev",
      "stella artois",
      "budweiser",
      "amstel",
      "eisenbahn",
      "corona",
    ].includes(brandKey) || /\b(cerveja|beer|lager|pilsen)\b/.test(text);

  text = text
    .replace(/\blong\s*nek\b/g, " long neck ")
    .replace(/\blongneck\b/g, " long neck ")
    .replace(/\bcoca\s*cola\b/g, " coca cola ")
    .replace(/\brefri\b/g, " refrigerante ")
    .replace(/\bachoc\s*po\b/g, " achocolatado em po ")
    .replace(/\bachocolatado\s*po\b/g, " achocolatado em po ")
    .replace(/\bling\b/g, " linguica ")
    .replace(/\bcx\b/g, " caixa ")
    .replace(/\bpct\b/g, " pacote ")
    .replace(/\b(?:lt|litro|litros)\b/g, " l ")
    .replace(/\b(?:und|un|unid|unidade|unidades)\b/g, " ");

  if (beerContext) {
    text = text.replace(/\bln\b/g, " long neck ");
  }

  return normalizeForKey(text);
}

export type ProductNameClean = {
  /** Nome enxuto para busca (sem ruído, sem marca). */
  cleanedName: string;
  /** Marca extraída do nome, se reconhecida. */
  extractedBrand: string | null;
};

/**
 * Limpa o nome do produto removendo unidades, embalagens e adjetivos comuns,
 * e tenta extrair marca conhecida embutida no texto.
 *
 * `hintedBrand` é considerada antes da extração automática — se vier vazia,
 * tentamos detectar pelo dicionário interno.
 */
export function cleanProductName(
  rawName: string,
  hintedBrand?: string | null,
): ProductNameClean {
  const normalized = normalizeForKey(rawName);
  if (!normalized) return { cleanedName: "", extractedBrand: hintedBrand?.trim() || null };

  // Primeiro, tira padrões numéricos com unidade.
  let work = ` ${normalized} `
    .replace(NUMBER_X_NUMBER_RE, " ")
    .replace(NUMERIC_UNIT_RE, " ");

  // Tenta extrair marca: usa a hint se vier; senão procura no dicionário.
  let extractedBrand: string | null = hintedBrand?.trim() || null;
  if (!extractedBrand) {
    for (const brand of SORTED_BRANDS) {
      const re = new RegExp(`(^|\\s)${brand.replace(/\s+/g, "\\s+")}(\\s|$)`, "i");
      if (re.test(work)) {
        extractedBrand = brand;
        work = work.replace(re, " ");
        break;
      }
    }
  } else {
    // Remove a marca explícita do nome também para não duplicar na query.
    const normalizedBrand = normalizeForKey(extractedBrand);
    if (normalizedBrand) {
      const re = new RegExp(
        `(^|\\s)${normalizedBrand.replace(/\s+/g, "\\s+")}(\\s|$)`,
        "i",
      );
      work = work.replace(re, " ");
    }
  }

  // Remove tokens de ruído isolados.
  const tokens = work
    .split(/\s+/)
    .filter((tok) => tok && !NOISE_TOKENS.has(tok))
    // descarta tokens puramente numéricos remanescentes
    .filter((tok) => !/^\d+$/.test(tok));

  const cleanedName = tokens.join(" ").trim();
  return { cleanedName, extractedBrand };
}

