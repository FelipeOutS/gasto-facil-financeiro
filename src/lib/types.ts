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
  /** Marca o gasto como essencial (aluguel, contas, internet…) */
  essencial?: boolean;
  /** Indica que o gasto é fixo mensal (Netflix, academia, aluguel…) */
  gastoFixo?: boolean;
  /** ID do cartão de crédito usado (quando formaPagamento === "credito") */
  cartaoId?: string;
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

// ---------- Receitas ----------
export type TipoReceita =
  | "salario"
  | "freelance"
  | "comissao"
  | "venda"
  | "reembolso"
  | "pix"
  | "bonus"
  | "outros";

export const TIPOS_RECEITA: Array<{ id: TipoReceita; label: string }> = [
  { id: "salario", label: "Salário" },
  { id: "freelance", label: "Freelance" },
  { id: "comissao", label: "Comissão" },
  { id: "venda", label: "Venda" },
  { id: "reembolso", label: "Reembolso" },
  { id: "pix", label: "Pix recebido" },
  { id: "bonus", label: "Bônus" },
  { id: "outros", label: "Outros" },
];

export type Receita = {
  id: string;
  descricao: string;
  valor: number;
  data: string; // YYYY-MM-DD
  tipo: TipoReceita;
  recorrente: boolean;
  /** Quantos meses repetir (quando recorrente). Default 12. */
  recorrenciaId?: string;
  mes: number;
  ano: number;
  criadoEm: string;
  atualizadoEm: string;
};

// ---------- Bancos ----------
export type Banco = {
  id: string;
  nome: string;
  /** cor hex curta para o marcador */
  colorHex: string;
  criadoPeloUsuario: boolean;
  criadoEm: string;
};

// ---------- Dinheiro guardado ----------
export type TipoReserva =
  | "emergencia"
  | "investimento"
  | "parado"
  | "caixinha"
  | "objetivo"
  | "outros";

export const TIPOS_RESERVA: Array<{ id: TipoReserva; label: string }> = [
  { id: "emergencia", label: "Reserva de emergência" },
  { id: "investimento", label: "Investimento" },
  { id: "parado", label: "Dinheiro parado na conta" },
  { id: "caixinha", label: "Caixinha" },
  { id: "objetivo", label: "Objetivo específico" },
  { id: "outros", label: "Outros" },
];

export type Guardado = {
  id: string;
  bancoId: string;
  valor: number;
  tipoReserva: TipoReserva;
  observacao?: string;
  dataAtualizacao: string;
  criadoEm: string;
  atualizadoEm: string;
};

// ---------- Metas ----------
export type StatusMeta = "nao_iniciada" | "em_andamento" | "quase" | "concluida";

export type Meta = {
  id: string;
  nome: string;
  valorObjetivo: number;
  valorAtual: number;
  prazo?: string; // YYYY-MM-DD opcional
  descricao?: string;
  colorHex: string;
  bancoId?: string;
  criadoEm: string;
  atualizadoEm: string;
};

export type MovimentacaoMeta = {
  id: string;
  metaId: string;
  valor: number;
  data: string;
  bancoId?: string;
  observacao?: string;
  criadoEm: string;
};

// ---------- Cartões de crédito ----------
export type Cartao = {
  id: string;
  nome: string;
  banco: string;
  limiteTotal: number;
  diaFechamento: number;
  diaVencimento: number;
  cor: string;
  observacao?: string;
  criadoEm: string;
  atualizadoEm: string;
};

export const BANCOS_CARTAO_PADRAO: Array<{ nome: string; cor: string }> = [
  { nome: "Nubank", cor: "#820ad1" },
  { nome: "Itaú", cor: "#ec7000" },
  { nome: "Santander", cor: "#ec0000" },
  { nome: "Mercado Pago", cor: "#00b1ea" },
  { nome: "Inter", cor: "#ff7a00" },
  { nome: "C6 Bank", cor: "#3a3a3a" },
  { nome: "Bradesco", cor: "#cc092f" },
  { nome: "Banco do Brasil", cor: "#fae128" },
  { nome: "Caixa", cor: "#1c5aa8" },
  { nome: "PicPay", cor: "#21c25e" },
  { nome: "Will Bank", cor: "#0f9b5e" },
  { nome: "Outro", cor: "#8b5cf6" },
];

export type StatusFatura = "aberta" | "fechada" | "paga";
