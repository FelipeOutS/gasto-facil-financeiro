# Relatório de Auditoria: Semântica da Taxa (V3 Final)

A auditoria da semântica da taxa de juros foi concluída, eliminando a ambiguidade na conversão entre taxas anuais e mensais.

## Alterações Realizadas

### 1. Banco de Dados & Modelagem
- Criada a migração `20260816210000_bens_v3_tipo_taxa.sql`.
- Adicionados campos `taxa_juros_periodicidade` ('mensal', 'anual') e `taxa_juros_tipo` ('nominal', 'efetiva', 'nao_definido') na tabela `public.bens_financiamentos`.
- Financiamentos existentes foram marcados como `nao_definido` para preservar o comportamento anterior até confirmação do usuário.

### 2. Motor Financeiro (`src/lib/financas.ts`)
- Implementada a função `converterTaxaParaMensal` com as seguintes regras:
  - **Mensal:** Utilizada diretamente (`taxa / 100`).
  - **Anual Nominal:** Dividida por 12 (`(taxa / 100) / 12`).
  - **Anual Efetiva:** Convertida via capitalização composta (`(1 + taxa/100)^(1/12) - 1`).
- A função anterior `taxaAnualParaMensal` foi marcada como obsoleta (`@deprecated`), mas mantida apontando para a conversão nominal por compatibilidade.

### 3. Experiência do Usuário (UX)
- **Cadastro:** O formulário de financiamento agora permite escolher a periodicidade e o tipo da taxa.
- **Ajuda Visual:** Adicionadas descrições curtas explicando a diferença entre Nominal e Efetiva.
- **Transparência na Simulação:** A aba "Simular" agora exibe explicitamente a taxa mensal exata que está sendo utilizada pelo motor e sua origem (ex: "Origem: 12% a.a. efetiva").

### 4. Validação Matemática
- Criada a suíte `tests/bens-v3-taxa-semantica.test.ts` cobrindo os casos:
  - 12% a.a. Nominal = 1% a.m.
  - 12% a.a. Efetiva = 0,948879% a.m.
  - 1% a.m. = 1% a.m.

## Veredito Técnico
O motor financeiro não assume mais silenciosamente que toda taxa anual deve ser dividida por 12. A natureza da taxa está explícita no contrato de dados e na interface. O CET permanece isolado conforme as diretrizes de segurança.

**Status: APROVADO PARA PRODUÇÃO**
