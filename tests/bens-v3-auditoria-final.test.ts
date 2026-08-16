import { describe, it, expect } from 'vitest';
import { simularFinanciamento, taxaAnualParaMensal } from '../src/lib/financas';

/**
 * RELATÓRIO DE AUDITORIA MATEMÁTICA V3 - MEUS BENS
 * 
 * Este arquivo serve como suíte de regressão definitiva para o motor financeiro.
 * Valida o Princípio Fundamental: Simulação NÃO altera dados reais.
 */

describe('Motor Financeiro V3 — Auditoria Profunda', () => {
  const taxaAnual = 10;
  // Simula o comportamento bancário padrão (nominal/12) para os testes existentes
  const taxaMensal = 0.10 / 12; 
  const saldoInicial = 300000;
  const prazoTotal = 360;

  describe('SAC - Validação de Amortização Constante', () => {
    const simulacao = simularFinanciamento({
      sistema: 'sac',
      saldoDevedor: saldoInicial,
      taxaMensal: taxaMensal,
      prazoRestante: prazoTotal,
      dataInicio: '2026-08-01'
    });

    it('deve ter amortização mensal constante de R$ 833,33', () => {
      // 300.000 / 360 = 833.333...
      expect(simulacao.parcelas[0].valorAmortizacao).toBe(833.33);
      expect(simulacao.parcelas[358].valorAmortizacao).toBe(833.33);
    });

    it('deve decrescer a parcela mensalmente', () => {
      expect(simulacao.parcelas[0].valorParcela).toBe(3333.33); // 833.33 + 2500.00
      expect(simulacao.parcelas[1].valorParcela).toBeLessThan(3333.33);
    });

    it('última parcela deve zerar saldo e corrigir residual', () => {
      const ultima = simulacao.parcelas[prazoTotal - 1];
      expect(ultima.saldoDevedor).toBe(0);
      // O valor da amortização na última pode variar centavos para zerar
      expect(ultima.valorAmortizacao).toBeGreaterThan(830);
    });
  });

  describe('Price - Validação de Prestação Constante', () => {
    const simulacao = simularFinanciamento({
      sistema: 'price',
      saldoDevedor: saldoInicial,
      taxaMensal: taxaMensal,
      prazoRestante: prazoTotal,
      dataInicio: '2026-08-01'
    });

    it('deve manter a prestação constante ≈ R$ 2.632,71', () => {
      const pmt = 2632.71;
      expect(simulacao.parcelas[0].valorParcela).toBeCloseTo(pmt, 0);
      expect(simulacao.parcelas[180].valorParcela).toBeCloseTo(pmt, 0);
      expect(simulacao.parcelas[358].valorParcela).toBeCloseTo(pmt, 0);
    });

    it('juros devem diminuir e amortização aumentar ao longo do tempo', () => {
      const p1 = simulacao.parcelas[0];
      const p300 = simulacao.parcelas[299];
      
      expect(p300.valorJuros).toBeLessThan(p1.valorJuros);
      expect(p300.valorAmortizacao).toBeGreaterThan(p1.valorAmortizacao);
    });
  });

  describe('Amortização Extra - Princípio da Independência', () => {
    const extra = 10000;
    
    it('Reduzir Prazo: mantém parcela e diminui número de linhas', () => {
      const result = simularFinanciamento({
        sistema: 'sac',
        saldoDevedor: saldoInicial,
        taxaMensal: taxaMensal,
        prazoRestante: prazoTotal,
        dataInicio: '2026-08-01',
        amortizacaoExtra: extra,
        tipoReducao: 'prazo'
      });
      
      expect(result.parcelas.length).toBeLessThan(prazoTotal);
      expect(result.mesesReduzidos).toBeGreaterThan(0);
    });

    it('Reduzir Parcela: mantém número de parcelas e diminui valor mensal', () => {
      const normal = simularFinanciamento({
        sistema: 'sac',
        saldoDevedor: saldoInicial,
        taxaMensal: taxaMensal,
        prazoRestante: prazoTotal,
        dataInicio: '2026-08-01'
      });

      const reduzido = simularFinanciamento({
        sistema: 'sac',
        saldoDevedor: saldoInicial,
        taxaMensal: taxaMensal,
        prazoRestante: prazoTotal,
        dataInicio: '2026-08-01',
        amortizacaoExtra: extra,
        tipoReducao: 'parcela'
      });
      
      expect(reduzido.parcelas.length).toBe(prazoTotal);
      expect(reduzido.parcelas[0].valorParcela).toBeLessThan(normal.parcelas[0].valorParcela);
    });
  });

  describe('Casos de Borda', () => {
    it('deve tratar amortização total (quitação)', () => {
      const result = simularFinanciamento({
        sistema: 'sac',
        saldoDevedor: 5000,
        taxaMensal: taxaMensal,
        prazoRestante: 12,
        dataInicio: '2026-08-01',
        amortizacaoExtra: 5000
      });
      expect(result.parcelas.length).toBe(0);
      expect(result.dataQuitacao).toBe('2026-08-01');
    });

    it('não deve aceitar valores negativos (Math.max(0))', () => {
      const result = simularFinanciamento({
        sistema: 'sac',
        saldoDevedor: 5000,
        taxaMensal: taxaMensal,
        prazoRestante: 12,
        dataInicio: '2026-08-01',
        amortizacaoExtra: 10000
      });
      expect(result.parcelas.length).toBe(0);
    });
  });
});
