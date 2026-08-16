import { describe, it, expect } from 'vitest';
import { converterTaxaParaMensal } from '../src/lib/financas';

describe('Motor Financeiro V3 — Auditoria de Semântica de Taxa', () => {
  
  it('Caso A: 12% a.a. nominal deve ser 1% a.m.', () => {
    const taxa = converterTaxaParaMensal(12, 'anual', 'nominal');
    expect(taxa * 100).toBe(1);
  });

  it('Caso B: 12% a.a. efetiva deve ser aproximadamente 0,948879% a.m.', () => {
    const taxa = converterTaxaParaMensal(12, 'anual', 'efetiva');
    // (1 + 0.12)^(1/12) - 1 = 0.00948879...
    expect(taxa * 100).toBeCloseTo(0.94887929, 6);
  });

  it('Caso C: 1% a.m. deve ser 1% a.m. (sem conversão)', () => {
    const taxa = converterTaxaParaMensal(1, 'mensal');
    expect(taxa * 100).toBe(1);
  });

  it('Caso D: 10.5% a.a. nominal (Exemplo Real)', () => {
    const taxa = converterTaxaParaMensal(10.5, 'anual', 'nominal');
    // 10.5 / 12 = 0.875
    expect(taxa * 100).toBeCloseTo(0.875, 10);
  });

  it('Caso E: 10.5% a.a. efetiva (Exemplo Real)', () => {
    const taxa = converterTaxaParaMensal(10.5, 'anual', 'efetiva');
    const esperada = Math.pow(1.105, 1/12) - 1;
    expect(taxa).toBe(esperada);
  });

  it('Caso F: Legado (nao_definido) deve se comportar como nominal', () => {
    const taxa = converterTaxaParaMensal(12, 'anual', 'nao_definido');
    expect(taxa * 100).toBe(1);
  });
});
