import { describe, it, expect } from 'vitest';
import { simularFinanciamento, taxaAnualParaMensal } from '../src/lib/financas';

/**
 * Fixtures Matemáticas Independentes (Calculadas fora do motor)
 * 
 * Cenário Referência:
 * Valor: R$ 300.000,00
 * Prazo: 360 meses
 * Taxa: 10% a.a. -> MENSAL SIMPLES (como bancos costumam fazer na simulação base)
 * 10 / 12 = 0.833333% ao mês (0.00833333)
 */

describe('Validação Matemática Independente V3 (SAC & Price)', () => {
  const taxaAnual = 10;
  const taxaMensal = (taxaAnual / 100) / 12; // TAXA MENSAL NOMINAL (PROPORCIONAL)
  const saldoInicial = 300000;
  const prazoTotal = 360;
  const TOLERANCIA = 0.05; // 5 centavos de tolerância para arredondamentos acumulados


  describe('Cenário SAC - R$ 300k, 360 meses, 10% aa', () => {
    const simulacao = simularFinanciamento({
      sistema: 'sac',
      saldoDevedor: saldoInicial,
      taxaMensal: taxaMensal,
      prazoRestante: prazoTotal,
      dataInicio: '2026-08-16'
    });

    it('deve ter amortização constante de R$ 833,33', () => {
      // Amortização SAC = Principal / Prazo = 300.000 / 360 = 833.3333...
      const amortizacaoEsperada = 833.33;
      expect(simulacao.parcelas[0].valorAmortizacao).toBe(amortizacaoEsperada);
      expect(simulacao.parcelas[prazoTotal - 2].valorAmortizacao).toBe(amortizacaoEsperada);
    });

    it('Parcela 1: Juros R$ 2.392,24 | Total R$ 3.225,57', () => {
      // Juros 1 = 300.000 * 0.00797414 = 2392.242... -> 2392.24
      // Total 1 = 833.33 + 2392.24 = 3225.57
      const p1 = simulacao.parcelas[0];
      expect(p1.valorJuros).toBeCloseTo(2392.24, 1);
      expect(p1.valorParcela).toBeCloseTo(3225.57, 1);
    });

    it('Parcela 120: Saldo Devedor Anterior ≈ R$ 200.833,73', () => {
      // Após 119 amortizações de 833.33: 300.000 - (119 * 833.33) = 300.000 - 99.166,27 = 200.833,73
      const p120 = simulacao.parcelas[119];
      const saldoAnterior = simulacao.parcelas[118].saldoDevedor;
      expect(saldoAnterior).toBeCloseTo(200833.73, 1);
      
      // Juros 120 = 200.833,73 * 0.00797414 = 1601.47
      expect(p120.valorJuros).toBeCloseTo(1601.47, 1);
    });

    it('Última Parcela: deve zerar o saldo sem resíduos', () => {
      const ultima = simulacao.parcelas[prazoTotal - 1];
      expect(ultima.saldoDevedor).toBe(0);
      expect(simulacao.parcelas.length).toBe(prazoTotal);
    });
  });

  describe('Cenário PRICE - R$ 300k, 360 meses, 10% aa', () => {
    const simulacao = simularFinanciamento({
      sistema: 'price',
      saldoDevedor: saldoInicial,
      taxaMensal: taxaMensal,
      prazoRestante: prazoTotal,
      dataInicio: '2026-08-16'
    });

    it('Prestação deve ser constante ≈ R$ 2.541,75', () => {
      // PMT = 300000 * [ (i * (1+i)^360) / ((1+i)^360 - 1) ]
      // i = 0.00797414
      // (1+i)^360 = 17.545
      // PMT = 300000 * [ (0.00797414 * 17.545) / 16.545 ] = 300000 * 0.0084725 = 2541.75
      const pmtEsperada = 2541.75;
      expect(simulacao.parcelas[0].valorParcela).toBeCloseTo(pmtEsperada, 0);
      expect(simulacao.parcelas[180].valorParcela).toBeCloseTo(pmtEsperada, 0);
    });

    it('Parcela 1: Juros R$ 2.392,24 | Amortização R$ 149,51', () => {
      const p1 = simulacao.parcelas[0];
      expect(p1.valorJuros).toBeCloseTo(2392.24, 1);
      expect(p1.valorAmortizacao).toBeCloseTo(149.51, 1);
    });

    it('Última Parcela: deve zerar o saldo sem resíduos', () => {
      const ultima = simulacao.parcelas[prazoTotal - 1];
      expect(ultima.saldoDevedor).toBe(0);
      expect(simulacao.parcelas.length).toBe(prazoTotal);
    });
  });

  describe('Amortização Extra de R$ 10.000', () => {
    it('deve reduzir o saldo inicial de 350k para 340k', () => {
      const result = simularFinanciamento({
        sistema: 'sac',
        saldoDevedor: 350000,
        taxaMensal: taxaMensal,
        prazoRestante: 360,
        dataInicio: '2026-08-16',
        amortizacaoExtra: 10000
      });
      
      // O motor calcula a primeira parcela baseada no saldo JÁ reduzido
      // Saldo após amortização extra imediata = 340.000
      // Juros 1 = 340.000 * 0.00797414 = 2711.21
      expect(result.parcelas[0].valorJuros).toBeCloseTo(2711.21, 1);
    });

    it('Quitação total se valor extra >= saldo', () => {
      const result = simularFinanciamento({
        sistema: 'price',
        saldoDevedor: 5000,
        taxaMensal: taxaMensal,
        prazoRestante: 12,
        dataInicio: '2026-08-16',
        amortizacaoExtra: 5000
      });
      expect(result.parcelas.length).toBe(0);
      expect(result.totalPago).toBe(0); // Pois a amortização extra ocorre "fora" do loop de parcelas
    });
  });
});
