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
  /**
   * Mês/competência da fatura no formato `YYYY-MM`.
   * Usado apenas para gastos no crédito: representa em qual fatura a compra
   * deve aparecer, independentemente da data real (`data`) da compra.
   */
  invoiceMonth?: string;
  /** Horário opcional da compra (HH:mm). */
  horario?: string;
  /** Origem do registro: manual, fatura_imagem, fatura_csv. */
  origem?: string;
  /** Lote de importação ao qual esse gasto pertence (extrato bancário). */
  importBatchId?: string;
  /** ID da operação no banco (quando importado de extrato). */
  idOperacaoBanco?: string;
  /** ID do fornecedor vinculado (opcional). */
  fornecedorId?: string | null;
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
  /** Horário opcional HH:mm (extrato bancário). */
  horario?: string;
  /** Origem do registro: manual, extrato_pdf, extrato_imagem, extrato_csv. */
  origem?: string;
  /** Lote de importação (extrato bancário). */
  importBatchId?: string;
  /** ID da operação no banco. */
  idOperacaoBanco?: string;
  /** Cliente vinculado (opcional). */
  clienteId?: string | null;
  criadoEm: string;
  atualizadoEm: string;
};

// ---------- Transferências internas (entre contas) ----------
export type TransferenciaInterna = {
  id: string;
  descricao: string;
  valor: number;
  data: string; // YYYY-MM-DD
  horario?: string;
  origem?: string; // conta de origem (texto livre)
  destino?: string; // conta de destino (texto livre)
  observacao?: string;
  /** Origem do registro de importação (extrato_pdf, etc.) */
  origemImportacao?: string;
  /** Lote de importação (extrato bancário). */
  importBatchId?: string;
  /** ID da operação no banco. */
  idOperacaoBanco?: string;
  mes: number;
  ano: number;
  criadoEm: string;
  atualizadoEm: string;
};

// ---------- Extratos importados (lotes) ----------
export type StatusExtratoImportado = "importado" | "parcial" | "revertido" | "erro";
export type TipoOrigemExtrato = "pdf" | "csv" | "imagem";

export type ExtratoImportado = {
  id: string;
  nomeArquivo?: string;
  banco?: string;
  tipoOrigem: TipoOrigemExtrato;
  dataImportacao: string;
  periodoInicio?: string;
  periodoFim?: string;
  qtdMovimentacoes: number;
  qtdDuplicadasIgnoradas: number;
  totalReceitas: number;
  totalDespesas: number;
  totalGuardado: number;
  totalTransferencias: number;
  status: StatusExtratoImportado;
  observacao?: string;
  revertedAt?: string;
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
  /** Lote de importação ao qual esse registro pertence (extrato bancário). */
  importBatchId?: string;
  /**
   * Meta financeira opcionalmente vinculada a esta reserva.
   * Quando presente, o valor entra no progresso da meta — sem duplicar:
   * o dinheiro segue contabilizado uma única vez (em Guardado).
   */
  metaId?: string;
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
  /** Chave da ilustração (auto-sugerida ou escolhida pelo usuário). */
  imagemKey?: string;
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
  /** Lote de importação ao qual esse registro pertence (extrato bancário). */
  importBatchId?: string;
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

export type StatusFatura = "aberta" | "fechada" | "paga" | "vencida";

export type FaturaCartao = {
  id: string;
  cartaoId: string;
  mes: number; // 1-12 — mês do vencimento
  ano: number;
  status: StatusFatura;
  dataPagamento?: string; // ISO yyyy-mm-dd
  valorPago: number;
  observacao?: string;
};

// ---------- Contas a pagar ----------
export type StatusConta = "pendente" | "pago" | "atrasado";

export type FrequenciaRecorrencia = "semanal" | "quinzenal" | "mensal" | "anual";

export const FREQUENCIAS_RECORRENCIA: Array<{ id: FrequenciaRecorrencia; label: string }> = [
  { id: "semanal", label: "Semanal" },
  { id: "quinzenal", label: "Quinzenal" },
  { id: "mensal", label: "Mensal" },
  { id: "anual", label: "Anual" },
];

export type ContaAPagar = {
  id: string;
  nome: string;
  valor: number;
  /** YYYY-MM-DD */
  dataVencimento: string;
  categoriaId?: string;
  observacao?: string;
  recorrente: boolean;
  /** Agrupador para todas as ocorrências de uma conta recorrente */
  recorrenciaId?: string;
  /** Frequência da recorrência (default: mensal) */
  frequenciaRecorrencia?: FrequenciaRecorrencia;
  /** Início da recorrência (para o histórico) */
  dataInicio?: string;
  /** Fim opcional da recorrência */
  dataFim?: string;
  /**
   * Status armazenado. Para a UI use {@link statusContaEfetivo} que considera
   * vencimento vs hoje para retornar "atrasado".
   */
  status: StatusConta;
  dataPagamento?: string;
  /** ID do gasto criado quando o usuário escolhe registrar como gasto */
  gastoId?: string;
  /** Beneficiário da conta (quem recebe) */
  beneficiario?: string;
  /** Forma de pagamento prevista para essa conta */
  formaPagamento?: FormaPagamento;
  /** Linha digitável / código de barras do boleto */
  codigoBoleto?: string;
  /** Pix copia e cola (BR Code) */
  codigoPix?: string;
  /** Chave Pix (CPF, e-mail, telefone, aleatória) */
  chavePix?: string;
  /** Banco emissor / cedente */
  bancoEmissor?: string;
  /** ID do fornecedor vinculado (opcional). */
  fornecedorId?: string | null;
  /** Lote de importação que originou a conta (quando vinda de boleto/Pix importado) */
  importBatchId?: string;
  mes: number;
  ano: number;
  /**
   * Mês de referência (competência) no formato `YYYY-MM`. Quando ausente,
   * trate como o mês do vencimento. Determina onde a conta entra nos
   * relatórios, orçamento e limite inteligente — independente de quando
   * foi efetivamente paga.
   */
  mesReferencia?: string;
  criadoEm: string;
  atualizadoEm: string;
};
