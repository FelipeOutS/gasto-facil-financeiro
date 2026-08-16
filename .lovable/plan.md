# Plano V4 — Importação e Atualização de Financiamento por Documento

Implementação de fluxo seguro para extração de dados financeiros de documentos (PDF/Imagem) e atualização controlada de bens e financiamentos, reutilizando a infraestrutura de OCR/IA existente.

## Infraestrutura & Backend

- **Banco de Dados**:
  - Criar  para rastreabilidade e histórico de alterações sugeridas por IA.
  - Adicionar coluna  (jsonb) em  para guardar a origem do dado (ex: `{ source: 'document', docId: '...' }`).
  - Implementar migração com RLS e GRANTs apropriados.
- **Server Functions ()**:
  - Criar :
    - Sanitiza texto (mascara CPF/contas).
    - Usa Gemini (via Lovable AI Gateway) com prompt especializado em documentos bancários de financiamento (SAC/Price, taxas nominais/efetivas).
    - Retorna dados estruturados com níveis de confiança.
- **Deduplicação & Segurança**:
  - Reutilizar lógica de  adaptada para financiamentos.
  - Validar propriedade do  e  no servidor.

## UI/UX

- **Ponto de Entrada**:
  - Novo botão "Atualizar por documento" na aba Financiamento de .
- **Componente de Upload**:
  - Reutilizar a lógica de arrastar/soltar e seleção de arquivos do .
- **Tela de Revisão ()**:
  - Comparação lado a lado: **Atual** vs **Encontrado no Documento**.
  - Checkboxes para seleção individual de campos (Saldo, Parcela, Taxa, Sistema).
  - Tratamento específico para Data de Referência do Saldo (obrigatória).
- **Mobile First**:
  - Visualização em cards verticais para comparação no celular.

## Fluxos Específicos

- **Eventos Identificados**:
  - Se detectar amortização ou pagamento no documento, sugerir o registro chamando as RPCs/funções reais já existentes (, ).
- **Histórico**:
  - Cada alteração confirmada gera uma entrada no histórico do bem, marcando a origem como "Documento".

## Riscos & Mitigação

- **Privacidade**: Sanitização de PII antes do envio para o LLM.
- **Precisão**: IA como "assistente de preenchimento", nunca automação silenciosa.
- **Senhas**: Tratar erro de PDF protegido.

---

### Arquivos a serem criados/alterados:
- 
-  (Novo: Processamento server-side)
-  (Novo: Fluxo de upload e análise)
-  (Novo: Revisão comparativa)
-  (Integração da ação)
-  (Novos tipos e metadados)

Confirmamos que nenhum dado real será alterado sem o clique explícito do usuário.
