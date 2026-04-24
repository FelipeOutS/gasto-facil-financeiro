import {
  ShoppingCart,
  Cookie,
  Scissors,
  Shirt,
  UtensilsCrossed,
  Car,
  Home,
  HeartPulse,
  Gamepad2,
  BookOpen,
  Receipt,
  CalendarClock,
  Pill,
  ShoppingBag,
  Gift,
  PawPrint,
  Briefcase,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";

export type CategoryId =
  | "mercado"
  | "besteiras"
  | "cabeleireiro"
  | "roupas"
  | "alimentacao"
  | "transporte"
  | "casa"
  | "saude"
  | "lazer"
  | "educacao"
  | "contas"
  | "assinaturas"
  | "farmacia"
  | "online"
  | "presentes"
  | "pet"
  | "trabalho"
  | "outros";

export type CategoryDef = {
  id: string;
  nome: string;
  icon: LucideIcon;
  /** CSS variable token (e.g. "--cat-mercado") */
  colorVar: string;
  /** Tailwind text color class */
  colorClass: string;
};

export const ICON_MAP: Record<string, LucideIcon> = {
  ShoppingCart,
  Cookie,
  Scissors,
  Shirt,
  UtensilsCrossed,
  Car,
  Home,
  HeartPulse,
  Gamepad2,
  BookOpen,
  Receipt,
  CalendarClock,
  Pill,
  ShoppingBag,
  Gift,
  PawPrint,
  Briefcase,
  MoreHorizontal,
};

export const DEFAULT_CATEGORIES: Array<{
  id: CategoryId;
  nome: string;
  iconName: keyof typeof ICON_MAP;
  colorVar: string;
}> = [
  { id: "mercado", nome: "Mercado", iconName: "ShoppingCart", colorVar: "--cat-mercado" },
  { id: "besteiras", nome: "Besteiras", iconName: "Cookie", colorVar: "--cat-besteiras" },
  { id: "cabeleireiro", nome: "Cabeleireiro", iconName: "Scissors", colorVar: "--cat-cabeleireiro" },
  { id: "roupas", nome: "Roupas", iconName: "Shirt", colorVar: "--cat-roupas" },
  { id: "alimentacao", nome: "Alimentação", iconName: "UtensilsCrossed", colorVar: "--cat-alimentacao" },
  { id: "transporte", nome: "Transporte", iconName: "Car", colorVar: "--cat-transporte" },
  { id: "casa", nome: "Casa", iconName: "Home", colorVar: "--cat-casa" },
  { id: "saude", nome: "Saúde", iconName: "HeartPulse", colorVar: "--cat-saude" },
  { id: "lazer", nome: "Lazer", iconName: "Gamepad2", colorVar: "--cat-lazer" },
  { id: "educacao", nome: "Educação", iconName: "BookOpen", colorVar: "--cat-educacao" },
  { id: "contas", nome: "Contas", iconName: "Receipt", colorVar: "--cat-contas" },
  { id: "assinaturas", nome: "Assinaturas", iconName: "CalendarClock", colorVar: "--cat-assinaturas" },
  { id: "farmacia", nome: "Farmácia", iconName: "Pill", colorVar: "--cat-farmacia" },
  { id: "online", nome: "Compras online", iconName: "ShoppingBag", colorVar: "--cat-online" },
  { id: "presentes", nome: "Presentes", iconName: "Gift", colorVar: "--cat-presentes" },
  { id: "pet", nome: "Pet", iconName: "PawPrint", colorVar: "--cat-pet" },
  { id: "trabalho", nome: "Trabalho", iconName: "Briefcase", colorVar: "--cat-trabalho" },
  { id: "outros", nome: "Outros", iconName: "MoreHorizontal", colorVar: "--cat-outros" },
];

export const KEYWORD_MAP: Array<{ keywords: string[]; categoryId: string }> = [
  {
    keywords: ["mercado", "supermerc", "atacad", "hortifrut", "açougue", "padaria", "mercear", "assaí", "carrefour", "extra", "pão de açúcar", "dia "],
    categoryId: "mercado",
  },
  {
    keywords: ["ifood", "rappi", "restaurante", "lanchonete", "pizzaria", "cafeteria", "delivery", "burger", "mc donald", "mcdonald", "bk ", "subway", "fast"],
    categoryId: "alimentacao",
  },
  {
    keywords: ["sorvete", "doce", "chocolate", "balada", "bar ", "drink", "açai", "açaí"],
    categoryId: "besteiras",
  },
  {
    keywords: ["salão", "salao", "barbearia", "cabeleireiro", "estética", "estetica", "unha", "sobrancelha", "manicure"],
    categoryId: "cabeleireiro",
  },
  {
    keywords: ["renner", "c&a", "riachuelo", "shein", "zara", "loja", "boutique", "calçad", "vestuário", "vestuario"],
    categoryId: "roupas",
  },
  {
    keywords: ["farm", "drogaria", "drogasil", "pacheco", "remédio", "remedio", "panvel"],
    categoryId: "farmacia",
  },
  {
    keywords: ["uber", "99 ", "99pop", "posto", "combustível", "combustivel", "gasolina", "metrô", "metro", "ônibus", "onibus", "estaciona", "pedágio", "pedagio", "blablacar"],
    categoryId: "transporte",
  },
  {
    keywords: ["netflix", "spotify", "amazon prime", "disney", "hbo", "globoplay", "youtube premium", "assinatura", "mensalidade"],
    categoryId: "assinaturas",
  },
  {
    keywords: ["pet shop", "petshop", "petz", "ração", "racao", "veterinár", "veterinar", "banho e tosa"],
    categoryId: "pet",
  },
  {
    keywords: ["luz", "energia", "água", "agua", "internet", "vivo", "claro", "tim ", "boleto", "fatura", "condomín", "condomin"],
    categoryId: "contas",
  },
];

export function suggestCategoryFromText(text: string): string {
  const t = text.toLowerCase();
  for (const { keywords, categoryId } of KEYWORD_MAP) {
    if (keywords.some((k) => t.includes(k))) return categoryId;
  }
  return "outros";
}
