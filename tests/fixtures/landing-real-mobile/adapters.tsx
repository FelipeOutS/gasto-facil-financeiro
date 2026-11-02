// Synthetic data only. These adapters are used exclusively by the standalone capture builder.
export const user = { id: "00000000-0000-4000-8000-000000000001", email: "demo@example.invalid" };
export const profile = {
  nome: "Demonstração",
  tipo_cadastro: "pessoa_fisica",
  onboarding_completed: true,
};
export const useAuth = () => ({ user, profile, session: { user }, loading: false });
export const usePlan = () => ({
  can: () => true,
  loading: false,
  isAdminMaster: false,
  isFreeAds: false,
  plan: "pessoal_premium",
  tier: "pessoal_premium",
});
export const useSubscriptionGuard = () => ({
  canWriteBasic: true,
  requireSubscription: () => true,
});
export const startTrial = async () => ({ ok: false });
export const useAlertaContas = () => "nenhum";
export const PRODUCT_EVENTS = { navClick: "nav_click" };
export const trackProductEvent = () => {};
export const AuthGate = ({ children }: any) => children;
export const ExpiredAccessBanner = () => null;
export const ConnectedAccountSwitcher = () => null;
export const useRecorrencias = () => [];
export const categorias = [
  { id: "alimentacao", nome: "Alimentação", iconName: "Utensils", colorHex: "#16a34a" },
];
export const bancos = [{ id: "b1", nome: "Banco Demo", colorHex: "#169b73" }];
export const metas = [
  {
    id: "m1",
    nome: "Viagem em família",
    colorHex: "#198b68",
    descricao: "Planejamento de férias",
    valorObjetivo: 12000,
    dataAlvo: "2027-07-01",
    imagemKey: "viagem",
    criadoEm: "2026-10-01",
  },
];
export const guardado = [
  {
    id: "r1",
    bancoId: "b1",
    nome: "Reserva de emergência",
    descricao: "Reserva de emergência",
    tipoReserva: "emergencia",
    valor: 4500,
    dataAtualizacao: "2026-10-20",
    data: "2026-10-20",
    criadoEm: "2026-10-20",
  },
  {
    id: "r2",
    bancoId: "b1",
    nome: "Férias",
    descricao: "Férias",
    tipoReserva: "outros",
    valor: 1800,
    metaId: "m1",
    dataAtualizacao: "2026-10-22",
    data: "2026-10-22",
    criadoEm: "2026-10-22",
  },
];
export const gastos = Array.from({ length: 6 }, (_, i) => ({
  id: "g" + i,
  descricao: "Compras do mês",
  valor: 900 + i * 80,
  data: `2026-${String(5 + i).padStart(2, "0")}-12`,
  mes: 5 + i,
  ano: 2026,
  categoriaId: "alimentacao",
  formaPagamento: "pix",
  tipoGasto: "avulso",
  confirmado: true,
}));
export const receitas = Array.from({ length: 6 }, (_, i) => ({
  id: "r" + i,
  descricao: "Receita demonstrativa",
  valor: 5000,
  data: `2026-${String(5 + i).padStart(2, "0")}-05`,
  mes: 5 + i,
  ano: 2026,
  tipo: "salario",
}));
export const ativos = [
  {
    id: "a1",
    nome: "Reserva em renda fixa",
    ticker: null,
    tipo: "cdb",
    instituicao: "Instituição demonstrativa",
    valor_aplicado: 10000,
    valor_atual: 10450,
    quantidade: null,
    preco_medio: null,
    preco_atual: null,
    rentabilidade_tipo: "cdi",
    rentabilidade_percentual: "100",
    created_at: "2026-10-01",
    updated_at: "2026-10-28",
    ultima_atualizacao: "2026-10-28",
    origem: "manual",
  },
  {
    id: "a2",
    nome: "Objetivo de longo prazo",
    ticker: null,
    tipo: "tesouro",
    instituicao: "Instituição demonstrativa",
    valor_aplicado: 5000,
    valor_atual: 5150,
    quantidade: null,
    preco_medio: null,
    preco_atual: null,
    created_at: "2026-10-01",
    updated_at: "2026-10-28",
    origem: "manual",
  },
];
export const dataFunctions: any = {
  useBootstrap: () => true,
  useStore: (fn: any) => fn(),
  getGastos: () => gastos,
  getReceitas: () => receitas,
  getCategorias: () => categorias,
  getCategoriaById: () => categorias[0],
  getBancos: () => bancos,
  getBancoById: () => bancos[0],
  getMetas: () => metas,
  getGuardado: () => guardado,
  getLimite: () => ({ valor: 3000 }),
  getMetaProgresso: () => 4800,
  getMetaProgressoBreakdown: () => ({ total: 4800, guardado: 1800, direto: 3000, restante: 7200 }),
  statusMeta: () => "em_andamento",
  mesEfetivoGasto: (g: any) => ({ mes: g.mes, ano: g.ano }),
  statusContaEfetivo: () => "pendente",
  contaPertenceAoMesRef: () => true,
};
export const supabase = {
  from: (table: string) => {
    const result = { data: table === "investimentos_ativos" ? ativos : [], error: null };
    const chain: any = new Proxy(
      {},
      {
        get: (_, key) =>
          key === "then"
            ? (resolve: any) => Promise.resolve(result).then(resolve)
            : key === "insert" || key === "update" || key === "delete"
              ? () => {
                  throw Error("Writes forbidden in capture fixture");
                }
              : () => chain,
      },
    );
    return chain;
  },
  auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  channel: () => ({
    on() {
      return this;
    },
    subscribe() {
      return this;
    },
  }),
  removeChannel: () => {},
};
export const getRecorrencias = () => [];
