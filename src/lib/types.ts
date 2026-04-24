export type FormaPagamento =
  | "pix"
  | "dinheiro"
  | "debito"
  | "credito"
  | "boleto"
  | "transferencia"
  | "vale_alimentacao"
  | "vale_refeicao"
  | "outro";

export const FORMAS_PAGAMENTO: Array<{ id: FormaPagamento; label: string }> = [
  { id: "pix", label: "Pix" },
  { id: "dinheiro", label: "Dinheiro" },
  { id: "debito", label: "Cartão de débito" },
  { id: "credito", label: "Cartão de crédito" },
  { id: "boleto", label: "Boleto" },
  { id: "transferencia", label: "Transferência" },
  { id: "vale_alimentacao", label: "Vale-alimentação" },
  { id: "vale_refeicao", label: "Vale-refeição" },
  { id: "outro", label: "Outro" },
];

export type TipoGasto = "unico" | "parcelado" | "recorrente";

export type Gasto = {
  id: string;
  descricao: string;
  valor: number;
  data: string; // ISO date YYYY-MM-DD
  estabelecimento: string;
  categoriaId: string;
  formaPagamento: FormaPagamento;
  observacao?: string;
  imagemUrl?: string; // data URL (MVP)
  mes: number;
  ano: number;
  confirmado: boolean;
  tipoGasto: TipoGasto;
  parcelaAtual?: number;
  totalParcelas?: number;
  grupoParcelamentoId?: string;
  recorrenciaId?: string;
  criadoEm: string;
  atualizadoEm: string;
};

export type Categoria = {
  id: string;
  nome: string;
  iconName: string;
  /** CSS variable token starting with -- (default categories) OR raw hex/oklch (custom) */
  colorVar?: string;
  colorHex?: string;
  criadaPeloUsuario: boolean;
};

export type Limite = {
  id: string;
  /** "total" or categoryId */
  tipo: "total" | string;
  valor: number;
  mes: number;
  ano: number;
};

export type AprendizadoCategoria = {
  id: string;
  estabelecimento: string; // normalized lowercase
  categoriaId: string;
  criadoEm: string;
};
