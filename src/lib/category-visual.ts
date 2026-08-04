/**
 * category-visual.ts — Resolver central de identidade visual de categoria.
 *
 * Recebe um nome livre (ex: "Mercado", "uber pro", "Conta de luz") e retorna
 * um pacote visual consistente: id normalizado, cor principal (CSS var ou
 * hex), arte SVG correspondente e ícone Lucide de fallback. Usado por
 * `CategoryIcon`, gráficos e legendas para garantir o MESMO visual da
 * categoria em todo o app (Dashboard, Gastos, Relatórios, Orçamento etc).
 *
 * Não muda lógica financeira — só camada visual.
 */

import { CATEGORY_ART, getCategoryArt } from "@/components/CategoryArt";
import { ICON_MAP } from "@/lib/categories";
import { MoreHorizontal, type LucideIcon } from "lucide-react";

export type CategoryVisualKey = keyof typeof CATEGORY_ART;

export type CategoryVisual = {
  /** Slug normalizado (ex: "mercado", "combustivel"). */
  key: string;
  /** Nome amigável capitalizado. */
  label: string;
  /** Cor principal (CSS var consumível em style/fill). */
  color: string;
  /** Cor de fundo suave (color-mix em runtime). */
  softColor: string;
  /** Componente SVG ilustrativo (pode ser null para fallback Lucide). */
  Art: ((p: { className?: string }) => React.ReactElement) | null;
  /** Ícone Lucide de fallback. */
  Icon: LucideIcon;
  /** Emoji opcional (último fallback / chips minúsculos). */
  emoji: string;
};

/**
 * Mapa de aliases: cada `key` aponta para uma lista de termos. Detecção
 * tolerante a acento, plural e variações comuns. Ordem importa — entradas
 * mais específicas primeiro (ex: "uber" antes de "transporte").
 */
const ALIASES: Array<{
  key: string;
  terms: string[];
  emoji: string;
  iconName: keyof typeof ICON_MAP;
  fallbackColor?: string;
}> = [
  {
    key: "salario",
    terms: ["salario", "salário", "holerite", "folha", "pagamento empresa"],
    emoji: "💰",
    iconName: "Briefcase",
  },
  { key: "pix", terms: ["pix"], emoji: "⚡", iconName: "Receipt" },
  {
    key: "cartao",
    terms: ["cartao", "cartão", "credito", "crédito", "fatura"],
    emoji: "💳",
    iconName: "Receipt",
  },
  {
    key: "transferencia",
    terms: ["transferencia", "transferência", "ted", "doc"],
    emoji: "🔁",
    iconName: "Receipt",
  },
  {
    key: "cofrinho",
    terms: ["cofrinho", "cofre", "guardado", "reserva", "poupanca", "poupança"],
    emoji: "🐷",
    iconName: "Briefcase",
  },
  { key: "meta", terms: ["meta", "objetivo", "alvo"], emoji: "🎯", iconName: "Briefcase" },
  {
    key: "combustivel",
    terms: [
      "combustivel",
      "combustível",
      "gasolina",
      "etanol",
      "diesel",
      "posto",
      "shell",
      "ipiranga",
      "petrobras",
      "ale",
    ],
    emoji: "⛽",
    iconName: "Car",
  },
  {
    key: "uber",
    terms: ["uber", "99", "99pop", "indrive", "blablacar", "app de carro", "cabify"],
    emoji: "🚕",
    iconName: "Car",
  },
  {
    key: "internet",
    terms: [
      "internet",
      "wi-fi",
      "wifi",
      "banda larga",
      "fibra",
      "vivo fibra",
      "claro net",
      "oi fibra",
      "tim live",
    ],
    emoji: "📶",
    iconName: "Receipt",
  },
  {
    key: "energia",
    terms: [
      "energia",
      "luz",
      "elétrica",
      "eletrica",
      "enel",
      "cemig",
      "light",
      "cpfl",
      "celpe",
      "coelba",
      "neoenergia",
    ],
    emoji: "⚡",
    iconName: "Receipt",
  },
  {
    key: "agua",
    terms: ["agua", "água", "saneamento", "sabesp", "cedae", "compesa", "sanepar", "conta de agua"],
    emoji: "💧",
    iconName: "Receipt",
  },
  {
    key: "aluguel",
    terms: ["aluguel", "aluguer", "imobiliaria", "imobiliária", "locacao", "locação"],
    emoji: "🔑",
    iconName: "KeyRound",
  },
  {
    key: "moradia",
    terms: ["moradia", "condominio", "condomínio", "predio", "prédio"],
    emoji: "🏢",
    iconName: "Building2",
  },
  {
    key: "mercado",
    terms: [
      "mercado",
      "supermerc",
      "atacad",
      "hortifrut",
      "açougue",
      "acougue",
      "padaria",
      "mercear",
      "assai",
      "assaí",
      "carrefour",
      "extra",
      "pão de açúcar",
      "compra do mes",
      "compra do mês",
      "oxxo",
      "minimerc",
      "emporio",
      "empório",
      "quitanda",
      "sacolao",
      "sacolão",
      "feira",
      "verdurao",
      "frutaria",
    ],
    emoji: "🛒",
    iconName: "ShoppingCart",
  },
  {
    key: "besteiras",
    terms: [
      "besteira",
      "doce",
      "chocolate",
      "sorvete",
      "lanche",
      "açai",
      "acai",
      "bala",
      "bacio di latte",
      "havanna",
      "kopenhagen",
      "cacau show",
      "gelato",
      "brigaderia",
    ],
    emoji: "🍩",
    iconName: "Cookie",
  },
  {
    key: "cabeleireiro",
    terms: [
      "cabel",
      "salao",
      "salão",
      "barb",
      "estetica",
      "estética",
      "unha",
      "sobrancelha",
      "manicure",
      "spa",
      "depilac",
    ],
    emoji: "💇",
    iconName: "Scissors",
  },
  {
    key: "roupas",
    terms: [
      "roup",
      "vestu",
      "calçad",
      "calcad",
      "renner",
      "c&a",
      "riachuelo",
      "shein",
      "zara",
      "marisa",
      "hering",
      "lupo",
      "tenis",
      "tênis",
      "sapato",
    ],
    emoji: "👕",
    iconName: "Shirt",
  },
  {
    key: "alimentacao",
    terms: [
      "alimenta",
      "comida",
      "restaur",
      "ifood",
      "rappi",
      "lanchonete",
      "lanches",
      "lanche",
      "pizzaria",
      "delivery",
      "burger",
      "bob",
      "bob's",
      "bobs",
      "mc donald",
      "mcdonald",
      "subway",
      "kfc",
      "outback",
      "habibs",
      "spoleto",
      "giraffas",
      "cafeteria",
      "cafe",
      "café",
      "bar ",
      "boteco",
      "churrasc",
      "japa",
      "sushi",
      "rotisseria",
      "comercial alim",
    ],
    emoji: "🍽️",
    iconName: "UtensilsCrossed",
  },
  {
    key: "transporte",
    terms: [
      "transp",
      "onibus",
      "ônibus",
      "metro",
      "metrô",
      "estaciona",
      "pedagio",
      "pedágio",
      "zona azul",
      "passagem",
      "rodoviaria",
    ],
    emoji: "🚗",
    iconName: "Car",
  },
  {
    key: "casa",
    terms: [
      "casa",
      "lar",
      "decoracao",
      "decoração",
      "movel",
      "móvel",
      "moveis",
      "móveis",
      "leroy",
      "tok stok",
      "tok&stok",
      "etna",
      "telhanorte",
      "ferragem",
      "empreendimentos",
    ],
    emoji: "🏠",
    iconName: "Home",
  },
  {
    key: "saude",
    terms: [
      "saude",
      "saúde",
      "medic",
      "médic",
      "dentist",
      "consulta",
      "exame",
      "hospital",
      "hosp ",
      "plano de saude",
      "plano de saúde",
      "psico",
      "terap",
      "fisioterap",
      "clinica",
      "clínica",
      "laboratorio",
      "laboratório",
      "optica",
      "óptica",
      "oculos",
      "óculos",
    ],
    emoji: "❤️",
    iconName: "HeartPulse",
  },
  {
    key: "farmacia",
    terms: [
      "farm",
      "drogaria",
      "drogasil",
      "pacheco",
      "remed",
      "panvel",
      "raia",
      "pague menos",
      "ultrafarma",
      "drogao",
      "vitamina",
    ],
    emoji: "💊",
    iconName: "Pill",
  },
  {
    key: "lazer",
    terms: [
      "lazer",
      "diver",
      "cinema",
      "show",
      "festa",
      "viagem",
      "game",
      "games",
      "video game",
      "videogame",
      "playstation",
      "xbox",
      "nintendo",
      "steam",
      "epic games",
      "riot",
      "blizzard",
      "parque",
      "ingresso",
      "teatro",
      "balada",
      "evento",
      "eventos",
      "passeio",
      "hotel",
      "pousada",
      "airbnb",
      "booking",
      "pirueta",
      "buffet",
    ],
    emoji: "🎮",
    iconName: "Gamepad2",
  },
  {
    key: "educacao",
    terms: [
      "educa",
      "escola",
      "curso",
      "facul",
      "livro",
      "estudo",
      "udemy",
      "alura",
      "rocketseat",
      "coursera",
      "duolingo",
      "mensalidade escolar",
      "material escolar",
    ],
    emoji: "📚",
    iconName: "BookOpen",
  },
  {
    key: "contas",
    terms: [
      "conta",
      "boleto",
      "fatura",
      "tributo",
      "imposto",
      "iptu",
      "ipva",
      "darf",
      "taxa",
      "multa",
    ],
    emoji: "🧾",
    iconName: "Receipt",
  },
  {
    key: "assinaturas",
    terms: [
      "assina",
      "stream",
      "netflix",
      "spotify",
      "amazon prime",
      "disney",
      "hbo",
      "globoplay",
      "youtube premium",
      "mensalidade",
      "deezer",
      "max",
      "paramount",
      "apple tv",
      "apple music",
      "icloud",
    ],
    emoji: "🔔",
    iconName: "CalendarClock",
  },
  {
    key: "online",
    terms: [
      "online",
      "compra online",
      "amazon",
      "shopee",
      "mercado livre",
      "aliexpress",
      "magalu",
      "americanas",
      "submarino",
      "shopping",
      "loja",
      "comercio",
      "comércio",
      "variedades",
      "marketplace",
    ],
    emoji: "🛍️",
    iconName: "ShoppingBag",
  },
  {
    key: "presentes",
    terms: [
      "presente",
      "gift",
      "aniversa",
      "lembrancinha",
      "flores",
      "giuliana flores",
      "floricultura",
    ],
    emoji: "🎁",
    iconName: "Gift",
  },
  {
    key: "pet",
    terms: [
      "pet",
      "anim",
      "racao",
      "ração",
      "veterinar",
      "veterinár",
      "vet ",
      "hosp vet",
      "petz",
      "petshop",
      "banho e tosa",
      "cobasi",
    ],
    emoji: "🐾",
    iconName: "PawPrint",
  },
  {
    key: "trabalho",
    terms: ["trabalho", "freela", "escrit", "coworking", "material de escritorio"],
    emoji: "💼",
    iconName: "Briefcase",
  },
];

const CSS_VAR_BY_KEY: Record<string, string> = {
  aluguel: "--cat-aluguel",
  moradia: "--cat-moradia",
  mercado: "--cat-mercado",
  besteiras: "--cat-besteiras",
  cabeleireiro: "--cat-cabeleireiro",
  roupas: "--cat-roupas",
  alimentacao: "--cat-alimentacao",
  transporte: "--cat-transporte",
  casa: "--cat-casa",
  saude: "--cat-saude",
  lazer: "--cat-lazer",
  educacao: "--cat-educacao",
  contas: "--cat-contas",
  assinaturas: "--cat-assinaturas",
  farmacia: "--cat-farmacia",
  online: "--cat-online",
  presentes: "--cat-presentes",
  pet: "--cat-pet",
  trabalho: "--cat-trabalho",
  outros: "--cat-outros",
  combustivel: "--cat-combustivel",
  internet: "--cat-internet",
  energia: "--cat-energia",
  agua: "--cat-agua",
  pix: "--cat-pix",
  cartao: "--cat-cartao",
  transferencia: "--cat-transferencia",
  salario: "--cat-salario",
  cofrinho: "--cat-cofrinho",
  meta: "--cat-meta",
  uber: "--cat-uber",
};

const LABELS: Record<string, string> = {
  aluguel: "Aluguel",
  moradia: "Moradia",
  mercado: "Mercado",
  besteiras: "Besteiras",
  cabeleireiro: "Cabeleireiro",
  roupas: "Roupas",
  alimentacao: "Alimentação",
  transporte: "Transporte",
  casa: "Casa",
  saude: "Saúde",
  lazer: "Lazer",
  educacao: "Educação",
  contas: "Contas",
  assinaturas: "Assinaturas",
  farmacia: "Farmácia",
  online: "Compras online",
  presentes: "Presentes",
  pet: "Pet",
  trabalho: "Trabalho",
  outros: "Outros",
  combustivel: "Combustível",
  internet: "Internet",
  energia: "Energia",
  agua: "Água",
  pix: "Pix",
  cartao: "Cartão",
  transferencia: "Transferência",
  salario: "Salário",
  cofrinho: "Cofrinho",
  meta: "Meta",
  uber: "Uber / App",
};

function normalize(s?: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Resolve apenas a `key` visual (sem montar o objeto inteiro). */
export function resolveCategoryKey(input?: string): string {
  if (!input) return "outros";
  const raw = input.toLowerCase().trim();
  // Match direto pelo id já slugificado
  if (CATEGORY_ART[raw]) return raw;
  const n = normalize(raw);
  if (CATEGORY_ART[n]) return n;
  for (const a of ALIASES) {
    if (a.terms.some((t) => n.includes(normalize(t)))) return a.key;
  }
  return "outros";
}

/**
 * Função pública principal. Centraliza tudo que o app precisa para
 * renderizar uma categoria de forma consistente.
 */
export function getCategoryVisual(input?: string): CategoryVisual {
  const key = resolveCategoryKey(input);
  const alias = ALIASES.find((a) => a.key === key);
  const Icon = (alias && ICON_MAP[alias.iconName]) || MoreHorizontal;
  const cssVar = CSS_VAR_BY_KEY[key] ?? "--cat-outros";
  const color = `var(${cssVar})`;
  const softColor = `color-mix(in oklab, ${color} 18%, transparent)`;
  return {
    key,
    label: LABELS[key] ?? (input || "Outros"),
    color,
    softColor,
    Art: getCategoryArt(key),
    Icon,
    emoji: alias?.emoji ?? "🏷️",
  };
}
