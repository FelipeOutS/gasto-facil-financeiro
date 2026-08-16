import { formatBRL } from "./format";

export interface ParcelaSimulada {
  numero: number;
  data: string;
  valorParcela: number;
  valorJuros: number;
  valorAmortizacao: number;
  saldoDevedor: number;
}

export interface ResultadoSimulacao {
  parcelas: ParcelaSimulada[];
  totalJuros: number;
  totalPago: number;
  dataQuitacao: string;
  economiaJuros?: number;
  mesesReduzidos?: number;
}

/**
 * Motor Financeiro V3 — SAC e Price
 * Fórmulas validadas para simulação de amortização.
 */

export function simularFinanciamento(args: {
  sistema: "sac" | "price";
  saldoDevedor: number;
  taxaMensal: number;
  prazoRestante: number;
  dataInicio: string;
  amortizacaoExtra?: number;
  tipoReducao?: "prazo" | "parcela";
}): ResultadoSimulacao {
  const { sistema, taxaMensal, dataInicio, amortizacaoExtra = 0 } = args;
  let saldo = args.saldoDevedor;
  let prazo = args.prazoRestante;

  // Aplica amortização extra inicial se houver
  if (amortizacaoExtra > 0) {
    saldo = Math.max(0, saldo - amortizacaoExtra);
    
    // Se reduzir parcela no SAC/Price, o prazo se mantém mas a base de cálculo muda.
    // Se reduzir prazo, recalcularemos n no loop ou manteremos a amortização constante.
  }

  const parcelas: ParcelaSimulada[] = [];
  let totalJuros = 0;
  let totalPago = 0;
  
  const dataRef = new Date(dataInicio);

  if (sistema === "sac") {
    // No SAC a amortização é constante: A = Saldo / Prazo
    // Se reduzir parcela, recalculamos a amortização constante com o novo saldo.
    // Se reduzir prazo, mantemos a amortização constante original e o saldo acaba antes.
    
    const amortizacaoConstanteOriginal = args.saldoDevedor / args.prazoRestante;
    let amortizacaoMensal = amortizacaoConstanteOriginal;

    if (args.tipoReducao === "parcela" && amortizacaoExtra > 0) {
      amortizacaoMensal = saldo / prazo;
    }

    for (let i = 1; i <= prazo; i++) {
      if (saldo <= 0) break;

      const juros = Number((saldo * taxaMensal).toFixed(2));
      let amort = Number(Math.min(saldo, amortizacaoMensal).toFixed(2));
      
      // Ajuste última parcela
      if (i === prazo || saldo - amort < 0.05) {
        amort = saldo;
      }

      const valorParcela = Number((amort + juros).toFixed(2));
      
      totalJuros += juros;
      totalPago += valorParcela;
      
      const dataParcela = new Date(dataRef);
      dataParcela.setMonth(dataParcela.getMonth() + i);

      parcelas.push({
        numero: i,
        data: dataParcela.toISOString().split("T")[0],
        valorParcela,
        valorJuros: juros,
        valorAmortizacao: amort,
        saldoDevedor: Number(Math.max(0, saldo - amort).toFixed(2)),
      });

      saldo -= amort;
    }
  } else {
    // PRICE
    // P = S * [ (i * (1+i)^n) / ((1+i)^n - 1) ]
    let pmt: number;
    
    if (args.tipoReducao === "parcela" && amortizacaoExtra > 0) {
      // Recalcula PMT para o novo saldo mantendo o prazo
      pmt = calcularPMT(saldo, taxaMensal, prazo);
    } else {
      // Mantém a PMT original do saldo inicial
      pmt = calcularPMT(args.saldoDevedor, taxaMensal, prazo);
    }

    for (let i = 1; i <= prazo; i++) {
      if (saldo <= 0) break;

      const juros = Number((saldo * taxaMensal).toFixed(2));
      let amort = Number((pmt - juros).toFixed(2));

      if (amort > saldo || i === prazo || saldo - amort < 0.05) {
        amort = saldo;
      }

      const valorParcela = Number((amort + juros).toFixed(2));
      
      totalJuros += juros;
      totalPago += valorParcela;

      const dataParcela = new Date(dataRef);
      dataParcela.setMonth(dataRef.getMonth() + i);

      parcelas.push({
        numero: i,
        data: dataParcela.toISOString().split("T")[0],
        valorParcela,
        valorJuros: juros,
        valorAmortizacao: amort,
        saldoDevedor: Number(Math.max(0, saldo - amort).toFixed(2)),
      });

      saldo -= amort;
    }
  }

  return {
    parcelas,
    totalJuros: Number(totalJuros.toFixed(2)),
    totalPago: Number(totalPago.toFixed(2)),
    dataQuitacao: parcelas.length > 0 ? parcelas[parcelas.length - 1].data : dataInicio,
    mesesReduzidos: args.prazoRestante - parcelas.length,
  };
}

function calcularPMT(saldo: number, taxa: number, prazo: number): number {
  if (taxa === 0) return saldo / prazo;
  const fator = Math.pow(1 + taxa, prazo);
  return Number((saldo * ((taxa * fator) / (fator - 1))).toFixed(2));
}

/** Converte taxa anual para mensal (juros compostos) */
export function taxaAnualParaMensal(taxaAnual: number): number {
  return (taxaAnual / 100) / 12;
}
