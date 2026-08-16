# Auditoria UX e Organização Geral — Gasto Inteligente

Quero agora realizar uma auditoria COMPLETA da experiência atual do Gasto Inteligente.

## Diretrizes P0 (Bloqueadores)
- **NÃO** implementar novas funcionalidades.
- **NÃO** redesenhar o sistema.
- **NÃO** remover páginas, alterar banco, planos ou regras financeiras.
- **FOCO**: Diagnóstico detalhado da experiência REAL do usuário.

## Escopo da Auditoria

### 1. Navegação e Inventário
- Mapear Sidebar Desktop (Grupos e itens).
- Mapear Mobile (Bottom Nav, "Mais", Ajustes).
- Cruzar Rotas x Menu: Identificar rotas escondidas, duplicadas ou sem entrada clara.
- **Tabela de Rotas**: ROTA | FUNÇÃO | ACESSO | DESCOBRÍVEL? | MANTER? | OBS

### 2. Funcionalidades "Escondidas" vs. Visíveis
- Procurar módulos que existem mas não têm link (ex: Meus Bens antes da V1).
- Identificar recursos anunciados mas indisponíveis (Beta, feature flags, planos).
- Checar consistência entre Desktop e Mobile.

### 3. UX e Jornadas
- Testar 10 jornadas principais (Registro de gasto, importação, metas, bens, etc.).
- Avaliar estados vazios (Empty States) para módulos principais.
- Analisar duplicação de caminhos (Perfil vs. Conta vs. Ajustes).
- Avaliar nomes das funções (Claro, Pode Melhorar, Confuso).

### 4. Dashboards e Quick Actions
- Auditar relevância dos cards do Dashboard.
- Mapear Quick Actions (Ações Rápidas) e sugerir melhorias.

### 5. Consistência e Acessibilidade
- Verificar ícones, headers, botões e breadcrumbs.
- Testar navegação profunda e comportamento do botão "Voltar".
- Auditoria de acessibilidade básica (Aria labels, contraste, targets mobile).

## Metodologia de Auditoria
- Usar Playwright para simular usuário real em Desktop e Mobile (390x844).
- Não confiar apenas em documentação antiga; validar código atual.

## Entregável: Relatório Final
1. Resumo Executivo.
2. Mapeamento de Navegação e Rotas.
3. Análise de Funcionalidades (Escondidas/Duplicadas).
4. Avaliação de Jornadas e UX Mobile/Desktop.
5. Lista de Problemas P0-P3.
6. Proposta de Navegação (Conservadora vs. Ideal).
7. Top 5 mudanças sugeridas.

---
**IMPORTANTE**: Esta tarefa encerra com o RELATÓRIO. Nenhuma alteração de código deve ser feita antes da aprovação do diagnóstico.
