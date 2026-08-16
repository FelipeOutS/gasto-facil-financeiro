# Plano V3 — Simulação e Planejamento de Financiamento

Esta etapa foca na criação de um motor de simulação matemática (SAC e Price) para permitir que o usuário projete cenários de amortização extraordinária sem alterar seus dados reais.

## Dados Reutilizados (V1/V2)
- **Contrato:** `valor_financiado`, `taxa_juros_anual`, `prazo_meses`, `sistema_amortizacao`, `primeiro_vencimento`.
- **Saldo de Verdade:** O `saldoDevedorEstimado` calculado em `calcularResumoBem` (que já considera fotos de saldo + amortizações reais posteriores) será o ponto de partida da simulação.
- **Histórico:** Pagamentos e amortizações reais já registrados servem para determinar o estado "Atual" do contrato.

## Fórmulas e Estratégia
### SAC (Sistema de Amortização Constante)
- **Amortização Mensal (A):** `Saldo Devedor / Prazo Restante`.
- **Juros (J):** `Saldo Devedor * Taxa Mensal`.
- **Parcela (P):** `A + J`.
- **Amortização Extra:**
  - **Reduzir Prazo:** O valor extra abate diretamente o saldo devedor; a amortização mensal (A) é recalculada para manter o valor da parcela próximo, resultando em menos meses.
  - **Reduzir Parcela:** O valor extra abate o saldo; o prazo é mantido e a amortização mensal (A) diminui.

### Price (Sistema Francês)
- **Parcela (P):** `Saldo Devedor * [ (i * (1+i)^n) / ((1+i)^n - 1) ]`, onde `i` é a taxa mensal e `n` o prazo restante.
- **Juros (J):** `Saldo Devedor * i`.
- **Amortização (A):** `P - J`.
- **Amortização Extra:** Segue a mesma lógica de abatimento de saldo com recálculo da PMT (parcela) ou do prazo (n).

## Arredondamentos e Precisão
- Cálculos internos usarão `Decimal.js` ou similar (ou precisão de 10 casas decimais com `number`) para evitar erros acumulativos.
- O resultado final de cada parcela será arredondado para 2 casas decimais.
- A última parcela ajustará qualquer resíduo de centavos para zerar o saldo.

## Isolamento Real vs Simulado
- **Nenhum dado no banco será alterado.**
- Simulações serão puramente em memória ou salvas em uma nova tabela `bens_simulacoes` (apenas parâmetros: valor extra, tipo de redução, etc.).
- A UI terá um "Modo Simulação" com cores distintas (ex: bordas tracejadas ou fundo âmbar suave) e o aviso legal obrigatório.

## Estrutura Proposta
1. **Motor Financeiro (`src/lib/financas.ts`):** Funções puras `simularSAC` e `simularPrice`.
2. **Componente Simulador (`src/components/bens/SimuladorFinanciamento.tsx`):** UI para entrada de valores extras e botões de atalho (1k, 5k, 10k).
3. **Comparador de Cenários:** Tabela/Cards lado a lado mostrando: "Hoje" vs "Simulado".

## Testes Matemáticos
- Validar contra calculadoras financeiras padrão (ex: calculadoras de bancos reais).
- Testar casos de borda: taxa zero, prazo de 1 mês, saldo muito pequeno, amortização extra maior que o saldo.

---
**Confirmação:** As simulações não alteram dados reais. O saldo oficial informado continua sendo a fonte de verdade. Resultados simulados são identificados como estimativas.

Deseja que eu prossiga com a criação da tabela de simulações e do motor financeiro?
