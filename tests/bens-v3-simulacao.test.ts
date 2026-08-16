import { describe, it, expect } from 'vitest';
import { simularFinanciamento, taxaAnualParaMensal } from '../src/lib/financas';

describe('Motor Financeiro V3 — Simulações', () => {
  const taxaMensal = taxaAnualParaMensal(12); // ~0.9488% ao mês
  const saldo = 200000;
  const prazo = 240;

  it('deve simular SAC corretamente sem amortização extra', () => {
    const result = simularFinanciamento({
      sistema: 'sac',
      saldoDevedor: saldo,
      taxaMensal,
      prazoRestante: prazo,
      dataInicio: '2026-08-01'
    });
    
    expect(result.parcelas.length).toBe(prazo);
    // No SAC 12% aa, a primeira parcela deve ser amortização (200k/240) + juros (200k * i)
    const amort = 200000 / 240;
    const juros = 200000 * taxaMensal;
    expect(result.parcelas[0].valorParcela).toBeCloseTo(amort + juros, 0);
  });

  it('deve simular Price corretamente e reduzir prazo com amortização extra', () => {
    const extra = 20000;
    const result = simularFinanciamento({
      sistema: 'price',
      saldoDevedor: saldo,
      taxaMensal,
      prazoRestante: prazo,
      dataInicio: '2026-08-01',
      amortizacaoExtra: extra,
      tipoReducao: 'prazo'
    });
    
    // Com 20k de amortização extra inicial, o prazo deve ser menor que 240
    expect(result.parcelas.length).toBeLessThan(prazo);
    expect(result.mesesReduzidos).toBeGreaterThan(0);
    // A primeira parcela deve manter a PMT original baseada nos 200k
    const pmtOriginal = (saldo * ((taxaMensal * Math.pow(1+taxaMensal, prazo)) / (Math.pow(1+taxaMensal, prazo) - 1)));
    expect(result.parcelas[0].valorParcela).toBeCloseTo(pmtOriginal, 0);
  });
});
