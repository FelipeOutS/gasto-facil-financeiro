/**
 * Pacote para Contador — funções puras de agregação.
 *
 * Combina dados que o usuário já pode acessar (receitas, gastos,
 * contas a pagar/receber, clientes, fornecedores, categorias e
 * cartões) em uma estrutura única usada pela rota /contador.
 *
 * Nenhuma query nova é feita aqui — apenas combinação de dados já
 * carregados pelos hooks/stores existentes. RLS continua valendo na
 * camada de leitura.
 */
import type {
  ContaAPagar,
  Categoria,
  Cartao,
  Gasto,
  Receita,
} from "@/lib/types";
import { statusContaEfetivo } from "@/lib/store";
import {
  statusEfetivo as statusContaReceberEfetivo,
  type ContaReceber,
} from "@/lib/contas-receber";
import type { Fornecedor } from "@/lib/fornecedores";
import type { Cliente } from "@/lib/clientes";
import type { MinhaEmpresa } from "@/lib/empresa";

// ============================================================
// Tipos
// ============================================================

export interface PeriodoMes {
  mes: number; // 1..12
  ano: number;
}

export interface OpcoesPacote {
  incluirEmAberto: boolean;
  incluirClientes: boolean;
  incluirFornecedores: boolean;
  incluirPendencias: boolean;
}

export interface ReceitaPacote {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  tipoLabel: string;
  clienteNome: string | null;
}

export interface GastoPacote {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  categoriaNome: string | null;
  formaPagamento: string;
  cartaoNome: string | null;
  fornecedorNome: string | null;
}

export type StatusContaPagarEff = "pago" | "pendente" | "atrasado";
export type StatusContaReceberEff =
  | "recebido"
  | "pendente"
  | "atrasado"
  | "parcial"
  | "cancelado";

export interface ContaPagarPacote {
  id: string;
  vencimento: string;
  descricao: string;
  valor: number;
  status: StatusContaPagarEff;
  fornecedorNome: string | null;
}

export interface ContaReceberPacote {
  id: string;
  dataPrevista: string;
  descricao: string;
  valor: number;
  valorRestante: number;
  status: StatusContaReceberEff;
  clienteNome: string | null;
}

export interface ResumoCliente {
  clienteId: string;
  nome: string;
  totalRecebido: number;
  totalEmAberto: number;
  qtdLancamentos: number;
}

export interface ResumoFornecedor {
  fornecedorId: string;
  nome: string;
  totalPago: number;
  totalEmAberto: number;
  qtdLancamentos: number;
}

export interface PendenciasPacote {
  contasPagarAtrasadas: ContaPagarPacote[];
  contasReceberAtrasadas: ContaReceberPacote[];
  empresaNaoCadastrada: boolean;
  qtdReceitasSemCliente: number;
  qtdGastosSemFornecedor: number;
  qtdLancamentosSemCategoria: number;
}

export interface ResumoFinanceiro {
  totalReceitasRecebidas: number;
  totalDespesasPagas: number;
  saldoPeriodo: number;
  contasReceberEmAberto: number;
  contasPagarEmAberto: number;
  qtdClientesMovimentados: number;
  qtdFornecedoresMovimentados: number;
}

export interface PacoteContador {
  periodo: PeriodoMes;
  geradoEm: string; // ISO
  empresa: MinhaEmpresa | null;
  resumo: ResumoFinanceiro;
  receitas: ReceitaPacote[];
  gastos: GastoPacote[];
  contasAPagar: {
    pagas: ContaPagarPacote[];
    pendentes: ContaPagarPacote[];
    atrasadas: ContaPagarPacote[];
  };
  contasAReceber: {
    recebidas: ContaReceberPacote[];
    pendentes: ContaReceberPacote[];
    atrasadas: ContaReceberPacote[];
    parciais: ContaReceberPacote[];
  };
  porCliente: ResumoCliente[];
  porFornecedor: ResumoFornecedor[];
  pendencias: PendenciasPacote;
}

// ============================================================
// Helpers
// ============================================================

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD dentro do mês/ano? */
function dataNoMes(iso: string, p: PeriodoMes): boolean {
  if (!iso || iso.length < 7) return false;
  const ymp = `${p.ano}-${pad2(p.mes)}`;
  return iso.slice(0, 7) === ymp;
}

function nomeCliente(
  c: Pick<Cliente, "apelido" | "nome_fantasia" | "razao_social" | "nome"> | null | undefined,
): string {
  if (!c) return "";
  return (
    c.apelido?.trim() ||
    c.nome_fantasia?.trim() ||
    c.razao_social?.trim() ||
    c.nome?.trim() ||
    ""
  );
}

function nomeFornecedor(f: Fornecedor | undefined | null): string {
  if (!f) return "";
  return (
    f.apelido?.trim() ||
    f.nome_fantasia?.trim() ||
    f.razao_social?.trim() ||
    f.nome?.trim() ||
    ""
  );
}

// ============================================================
// Entrada principal
// ============================================================

export interface MontarPacoteInput {
  periodo: PeriodoMes;
  opcoes: OpcoesPacote;
  empresa: MinhaEmpresa | null;
  receitas: Receita[];
  gastos: Gasto[];
  contasAPagar: ContaAPagar[];
  contasAReceber: ContaReceber[];
  clientesPorId: Record<string, Cliente>;
  fornecedoresPorId: Record<string, Fornecedor>;
  getCategoria: (id: string | undefined | null) => Categoria | undefined;
  cartoesPorId: Record<string, Cartao>;
}

export function montarPacoteContador(
  input: MontarPacoteInput,
): PacoteContador {
  const { periodo, opcoes } = input;

  // ----- Receitas no mês
  const receitasMes = input.receitas.filter((r) => dataNoMes(r.data, periodo));
  const receitas: ReceitaPacote[] = receitasMes
    .slice()
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((r) => ({
      id: r.id,
      data: r.data,
      descricao: r.descricao,
      valor: Number(r.valor) || 0,
      tipoLabel: r.tipo,
      clienteNome: r.clienteId
        ? nomeCliente(input.clientesPorId[r.clienteId]) || null
        : null,
    }));

  // ----- Gastos no mês
  const gastosMes = input.gastos.filter((g) => dataNoMes(g.data, periodo));
  const gastos: GastoPacote[] = gastosMes
    .slice()
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((g) => {
      const cat = input.getCategoria(g.categoriaId);
      const cartao = g.cartaoId ? input.cartoesPorId[g.cartaoId] : null;
      return {
        id: g.id,
        data: g.data,
        descricao: g.descricao || g.estabelecimento,
        valor: Number(g.valor) || 0,
        categoriaNome: cat?.nome ?? null,
        formaPagamento: g.formaPagamento,
        cartaoNome: cartao?.nome ?? null,
        fornecedorNome: g.fornecedorId
          ? nomeFornecedor(input.fornecedoresPorId[g.fornecedorId]) || null
          : null,
      };
    });

  // ----- Contas a pagar do mês (por dataVencimento)
  const contasPagarMes = input.contasAPagar.filter((c) =>
    dataNoMes(c.dataVencimento, periodo),
  );
  const pagas: ContaPagarPacote[] = [];
  const pendentes: ContaPagarPacote[] = [];
  const atrasadas: ContaPagarPacote[] = [];
  for (const c of contasPagarMes) {
    const eff = statusContaEfetivo(c);
    if (eff !== "pago" && eff !== "pendente" && eff !== "atrasado") continue;
    const item: ContaPagarPacote = {
      id: c.id,
      vencimento: c.dataVencimento,
      descricao: c.nome,
      valor: Number(c.valor) || 0,
      status: eff as StatusContaPagarEff,
      fornecedorNome: c.fornecedorId
        ? nomeFornecedor(input.fornecedoresPorId[c.fornecedorId]) || null
        : null,
    };
    if (eff === "pago") pagas.push(item);
    else if (eff === "atrasado") atrasadas.push(item);
    else pendentes.push(item);
  }
  const sortCP = (a: ContaPagarPacote, b: ContaPagarPacote) =>
    a.vencimento.localeCompare(b.vencimento);
  pagas.sort(sortCP);
  pendentes.sort(sortCP);
  atrasadas.sort(sortCP);

  // ----- Contas a receber do mês (por data_prevista)
  const contasReceberMes = input.contasAReceber.filter((c) =>
    dataNoMes(c.data_prevista, periodo),
  );
  const recebidas: ContaReceberPacote[] = [];
  const pendentesR: ContaReceberPacote[] = [];
  const atrasadasR: ContaReceberPacote[] = [];
  const parciais: ContaReceberPacote[] = [];
  for (const c of contasReceberMes) {
    const eff = statusContaReceberEfetivo(c) as StatusContaReceberEff;
    const item: ContaReceberPacote = {
      id: c.id,
      dataPrevista: c.data_prevista,
      descricao: c.titulo,
      valor: Number(c.valor_total) || 0,
      valorRestante: Number(c.valor_restante) || 0,
      status: eff,
      clienteNome: c.cliente_id
        ? nomeCliente(input.clientesPorId[c.cliente_id]) || null
        : null,
    };
    if (eff === "recebido") recebidas.push(item);
    else if (eff === "parcial") parciais.push(item);
    else if (eff === "atrasado") atrasadasR.push(item);
    else if (eff === "pendente") pendentesR.push(item);
    // canceladas são omitidas
  }
  const sortCR = (a: ContaReceberPacote, b: ContaReceberPacote) =>
    a.dataPrevista.localeCompare(b.dataPrevista);
  recebidas.sort(sortCR);
  pendentesR.sort(sortCR);
  atrasadasR.sort(sortCR);
  parciais.sort(sortCR);

  // ----- Resumo por cliente (priorizando receitas para "recebido")
  const porClienteMap = new Map<string, ResumoCliente>();
  const getCliBucket = (id: string): ResumoCliente | null => {
    const c = input.clientesPorId[id];
    if (!c) return null;
    let b = porClienteMap.get(id);
    if (!b) {
      b = {
        clienteId: id,
        nome: nomeCliente(c) || "Cliente",
        totalRecebido: 0,
        totalEmAberto: 0,
        qtdLancamentos: 0,
      };
      porClienteMap.set(id, b);
    }
    return b;
  };
  for (const r of receitasMes) {
    if (!r.clienteId) continue;
    const b = getCliBucket(r.clienteId);
    if (!b) continue;
    b.totalRecebido += Number(r.valor) || 0;
    b.qtdLancamentos += 1;
  }
  for (const c of contasReceberMes) {
    if (!c.cliente_id) continue;
    const eff = statusContaReceberEfetivo(c);
    if (eff === "cancelado") continue;
    if (eff === "recebido") continue; // evita duplicidade com receitas
    const b = getCliBucket(c.cliente_id);
    if (!b) continue;
    b.totalEmAberto += Number(c.valor_restante) || 0;
    b.qtdLancamentos += 1;
  }
  const porCliente = Array.from(porClienteMap.values()).sort(
    (a, b) =>
      b.totalRecebido + b.totalEmAberto - (a.totalRecebido + a.totalEmAberto),
  );

  // ----- Resumo por fornecedor (priorizando gastos para "pago")
  const porFornMap = new Map<string, ResumoFornecedor>();
  const getFornBucket = (id: string): ResumoFornecedor | null => {
    const f = input.fornecedoresPorId[id];
    if (!f) return null;
    let b = porFornMap.get(id);
    if (!b) {
      b = {
        fornecedorId: id,
        nome: nomeFornecedor(f) || "Fornecedor",
        totalPago: 0,
        totalEmAberto: 0,
        qtdLancamentos: 0,
      };
      porFornMap.set(id, b);
    }
    return b;
  };
  for (const g of gastosMes) {
    if (!g.fornecedorId) continue;
    const b = getFornBucket(g.fornecedorId);
    if (!b) continue;
    b.totalPago += Number(g.valor) || 0;
    b.qtdLancamentos += 1;
  }
  for (const c of contasPagarMes) {
    if (!c.fornecedorId) continue;
    const eff = statusContaEfetivo(c);
    if (eff === "pago") continue; // evita duplicidade com gastos
    const b = getFornBucket(c.fornecedorId);
    if (!b) continue;
    b.totalEmAberto += Number(c.valor) || 0;
    b.qtdLancamentos += 1;
  }
  const porFornecedor = Array.from(porFornMap.values()).sort(
    (a, b) =>
      b.totalPago + b.totalEmAberto - (a.totalPago + a.totalEmAberto),
  );

  // ----- Pendências
  const qtdReceitasSemCliente = receitasMes.filter((r) => !r.clienteId).length;
  const qtdGastosSemFornecedor = gastosMes.filter((g) => !g.fornecedorId).length;
  const qtdLancamentosSemCategoria =
    gastosMes.filter((g) => !g.categoriaId).length +
    contasPagarMes.filter((c) => !c.categoriaId).length;
  const pendencias: PendenciasPacote = {
    contasPagarAtrasadas: atrasadas,
    contasReceberAtrasadas: atrasadasR,
    empresaNaoCadastrada: !input.empresa,
    qtdReceitasSemCliente,
    qtdGastosSemFornecedor,
    qtdLancamentosSemCategoria,
  };

  // ----- Resumo financeiro
  const totalReceitasRecebidas = receitas.reduce((s, r) => s + r.valor, 0);
  const totalDespesasPagas =
    gastos.reduce((s, g) => s + g.valor, 0) +
    pagas.reduce((s, c) => s + c.valor, 0);
  const contasReceberEmAberto = [...pendentesR, ...atrasadasR, ...parciais]
    .reduce((s, c) => s + (c.valorRestante || c.valor), 0);
  const contasPagarEmAbertoTotal = [...pendentes, ...atrasadas].reduce(
    (s, c) => s + c.valor,
    0,
  );
  const resumo: ResumoFinanceiro = {
    totalReceitasRecebidas,
    totalDespesasPagas,
    saldoPeriodo: totalReceitasRecebidas - totalDespesasPagas,
    contasReceberEmAberto: opcoes.incluirEmAberto ? contasReceberEmAberto : 0,
    contasPagarEmAberto: opcoes.incluirEmAberto ? contasPagarEmAbertoTotal : 0,
    qtdClientesMovimentados: porCliente.filter((c) => c.qtdLancamentos > 0).length,
    qtdFornecedoresMovimentados: porFornecedor.filter((f) => f.qtdLancamentos > 0).length,
  };

  return {
    periodo,
    geradoEm: new Date().toISOString(),
    empresa: input.empresa,
    resumo,
    receitas,
    gastos,
    contasAPagar: { pagas, pendentes, atrasadas },
    contasAReceber: {
      recebidas,
      pendentes: pendentesR,
      atrasadas: atrasadasR,
      parciais,
    },
    porCliente: opcoes.incluirClientes ? porCliente : [],
    porFornecedor: opcoes.incluirFornecedores ? porFornecedor : [],
    pendencias,
  };
}

// ============================================================
// Export helpers (sem libs)
// ============================================================

const NOMES_MES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function nomeMes(mes: number): string {
  return NOMES_MES_PT[mes - 1] ?? String(mes);
}

export function rotuloPeriodo(p: PeriodoMes): string {
  return `${nomeMes(p.mes)}/${p.ano}`;
}

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Gera um resumo curto em texto para "Copiar resumo". */
export function gerarResumoTexto(p: PacoteContador): string {
  const linhas: string[] = [];
  linhas.push(`Pacote para Contador — ${rotuloPeriodo(p.periodo)}`);
  if (p.empresa) {
    const nome = p.empresa.nome_fantasia || p.empresa.razao_social || "Empresa";
    linhas.push(nome);
    if (p.empresa.cnpj) linhas.push(`CNPJ: ${p.empresa.cnpj}`);
  }
  linhas.push("");
  linhas.push(`Receitas recebidas: ${brl(p.resumo.totalReceitasRecebidas)}`);
  linhas.push(`Despesas pagas: ${brl(p.resumo.totalDespesasPagas)}`);
  linhas.push(`Saldo do período: ${brl(p.resumo.saldoPeriodo)}`);
  linhas.push(
    `Contas a receber em aberto: ${brl(p.resumo.contasReceberEmAberto)}`,
  );
  linhas.push(`Contas a pagar em aberto: ${brl(p.resumo.contasPagarEmAberto)}`);
  linhas.push(`Clientes movimentados: ${p.resumo.qtdClientesMovimentados}`);
  linhas.push(`Fornecedores movimentados: ${p.resumo.qtdFornecedoresMovimentados}`);
  return linhas.join("\n");
}

// ---------- CSV ----------

function csvEscape(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",;\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvLine(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvEscape).join(";");
}

/** Gera um CSV único com todas as seções (separadas por linhas em branco). */
export function gerarCsvPacote(p: PacoteContador): string {
  const out: string[] = [];

  out.push(`Pacote para Contador — ${rotuloPeriodo(p.periodo)}`);
  if (p.empresa) {
    out.push(
      csvLine([
        "Empresa",
        p.empresa.nome_fantasia || p.empresa.razao_social || "",
        p.empresa.cnpj ?? "",
      ]),
    );
  }
  out.push("");

  // Resumo
  out.push("Resumo financeiro");
  out.push(csvLine(["Indicador", "Valor"]));
  out.push(csvLine(["Receitas recebidas", p.resumo.totalReceitasRecebidas.toFixed(2)]));
  out.push(csvLine(["Despesas pagas", p.resumo.totalDespesasPagas.toFixed(2)]));
  out.push(csvLine(["Saldo do período", p.resumo.saldoPeriodo.toFixed(2)]));
  out.push(csvLine(["Contas a receber em aberto", p.resumo.contasReceberEmAberto.toFixed(2)]));
  out.push(csvLine(["Contas a pagar em aberto", p.resumo.contasPagarEmAberto.toFixed(2)]));
  out.push(csvLine(["Clientes movimentados", p.resumo.qtdClientesMovimentados]));
  out.push(csvLine(["Fornecedores movimentados", p.resumo.qtdFornecedoresMovimentados]));
  out.push("");

  // Receitas
  out.push("Receitas");
  out.push(csvLine(["Data", "Descrição", "Valor", "Tipo", "Cliente"]));
  for (const r of p.receitas) {
    out.push(csvLine([fmtData(r.data), r.descricao, r.valor.toFixed(2), r.tipoLabel, r.clienteNome ?? ""]));
  }
  out.push("");

  // Gastos
  out.push("Despesas");
  out.push(
    csvLine(["Data", "Descrição", "Valor", "Categoria", "Forma de pagamento", "Cartão", "Fornecedor"]),
  );
  for (const g of p.gastos) {
    out.push(
      csvLine([
        fmtData(g.data),
        g.descricao,
        g.valor.toFixed(2),
        g.categoriaNome ?? "",
        g.formaPagamento,
        g.cartaoNome ?? "",
        g.fornecedorNome ?? "",
      ]),
    );
  }
  out.push("");

  // Contas a pagar
  out.push("Contas a pagar");
  out.push(csvLine(["Vencimento", "Descrição", "Valor", "Status", "Fornecedor"]));
  for (const c of [
    ...p.contasAPagar.pagas,
    ...p.contasAPagar.pendentes,
    ...p.contasAPagar.atrasadas,
  ]) {
    out.push(
      csvLine([
        fmtData(c.vencimento),
        c.descricao,
        c.valor.toFixed(2),
        rotuloStatusPagar(c.status),
        c.fornecedorNome ?? "",
      ]),
    );
  }
  out.push("");

  // Contas a receber
  out.push("Contas a receber");
  out.push(
    csvLine(["Previsão", "Descrição", "Valor", "Valor restante", "Status", "Cliente"]),
  );
  for (const c of [
    ...p.contasAReceber.recebidas,
    ...p.contasAReceber.parciais,
    ...p.contasAReceber.pendentes,
    ...p.contasAReceber.atrasadas,
  ]) {
    out.push(
      csvLine([
        fmtData(c.dataPrevista),
        c.descricao,
        c.valor.toFixed(2),
        c.valorRestante.toFixed(2),
        rotuloStatusReceber(c.status),
        c.clienteNome ?? "",
      ]),
    );
  }
  out.push("");
    out.push("Resumo por cliente");
    out.push(csvLine(["Cliente", "Recebido", "Em aberto", "Lançamentos"]));
    for (const c of p.porCliente) {
      out.push(
        csvLine([
          c.nome,
          c.totalRecebido.toFixed(2),
          c.totalEmAberto.toFixed(2),
          c.qtdLancamentos,
        ]),
      );
    }
    out.push("");
  }

  if (p.porFornecedor.length > 0) {
    out.push("Resumo por fornecedor");
    out.push(csvLine(["Fornecedor", "Pago", "Em aberto", "Lançamentos"]));
    for (const f of p.porFornecedor) {
      out.push(
        csvLine([
          f.nome,
          f.totalPago.toFixed(2),
          f.totalEmAberto.toFixed(2),
          f.qtdLancamentos,
        ]),
      );
    }
    out.push("");
  }

  // BOM UTF-8 para Excel abrir certo
  return "\ufeff" + out.join("\n");
}
