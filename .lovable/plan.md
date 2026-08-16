# Plano V4 — Importação e Atualização de Financiamento por Documento

Implementação de um fluxo seguro para extração de dados financeiros de documentos (PDF/Imagem) e atualização controlada de bens e financiamentos, reutilizando a infraestrutura de OCR/IA do projeto.

## Infraestrutura & Backend

- **Banco de Dados**:
  - Criar `bens_documentos_processados` para auditoria e histórico de alterações sugeridas pela IA.
  - Adicionar coluna `metadata` (jsonb) em `bens_financiamentos` para rastrear a origem do dado.
  - Implementar migração com RLS e privilégios para usuários autenticados.
- **Server Functions (`src/lib/bens.functions.ts`)**:
  - Implementar `processarDocumentoFinanciamento`:
    - Sanitização de PII (CPF, contas) antes do processamento.
    - Prompt especializado no Gemini para extrair SAC/Price, taxas nominais/efetivas e datas de referência.
    - Retorno estruturado com sinalização de confiança (High/Medium/Low).
- **Segurança**:
  - Validação estrita de posse do `bem_id` no servidor.
  - Limite de taxa (Rate Limit) para processamento de documentos.

## UI/UX

- **Ponto de Entrada**:
  - Ação "Atualizar por documento" na aba de Financiamento do detalhe do bem.
- **Fluxo de Upload**:
  - Modal reutilizando componentes de Dropzone para PDF e Imagens (JPG/PNG).
- **Tela de Revisão (`ImportFinanciamentoReview`)**:
  - Comparação clara: Valor Atual vs. Valor Identificado.
  - Seleção individual de campos para atualização.
  - Campo obrigatório para confirmação da Data de Referência do saldo devedor.
- **Responsividade**:
  - Layout otimizado para mobile com cards comparativos.

## Regras de Negócio & Histórico

- **Confirmação Explicita**: Nenhum dado é alterado automaticamente.
- **Eventos Adicionais**: Identificação de amortizações ou pagamentos no documento com sugestão de registro no fluxo real existente.
- **Integração V3**: Novos dados reais alimentam automaticamente o motor de simulação SAC/Price da V3.

---

### Arquivos Impactados:
- `supabase/migrations/20260816220000_bens_v4_importacao.sql`
- `src/lib/bens.functions.ts` (Novo)
- `src/lib/bens.server.ts` (Novo: Helpers de IA)
- `src/components/bens/ImportFinanciamentoDialog.tsx` (Novo)
- `src/components/bens/ImportFinanciamentoReview.tsx` (Novo)
- `src/routes/bens.$id.tsx` (Alterado: Integração do botão e modal)
- `src/lib/bens.ts` (Alterado: Tipos e metadados)

Confirmado o isolamento total entre o parser e os dados reais até a ação de "Confirmar" do usuário.
