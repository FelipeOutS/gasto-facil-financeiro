# REORGANIZAÇÃO DE PRIORIDADES — JOANIN E CARREFOUR SOMENTE PARA ADMIN MASTER

A partir deste momento, altere oficialmente o planejamento do projeto Gasto Inteligente.

## DECISÃO DEFINITIVA

As integrações:

- Joanin;
- Carrefour;

não fazem mais parte do escopo necessário para o lançamento geral do site.

Essas integrações serão concluídas somente no futuro.

Até uma nova autorização explícita, ambas devem permanecer disponíveis exclusivamente para os usuários com a role administrativa máxima `owner`, que representa o Admin Master no projeto.

Não remover o código existente.

Não apagar dados, tabelas, migrations, logs, configurações ou documentação dessas integrações.

O objetivo é apenas isolar, desligar e retirar essas funcionalidades do caminho dos usuários comuns.

---

# 1. ACESSO SOMENTE PARA ADMIN MASTER

Aplicar proteção server-side baseada na role persistida em:

`public.user_roles`

Role autorizada:

`owner`

Não autorizar acesso com base apenas em:

- E-mail;
- Dados enviados pelo frontend;
- Local Storage;
- Query string;
- Parâmetros de rota;
- Plano do usuário;
- Campo manipulável do perfil.

O fluxo deve ser:

```text
sessão autenticada
→ User ID confiável
→ consulta server-side em user_roles
→ role owner válida
→ acesso autorizado

Qualquer erro na consulta deve resultar em acesso negado.

2. ROTAS E TELAS

Audite todas as rotas, páginas, componentes e APIs relacionadas a:

 Joanin;

 Carrefour;

 Consulta de preços externos;

 Sincronização de mercados;

 Importação de preços;

 Histórico vindo dessas integrações;

 Jobs de atualização;

 Painéis de diagnóstico;

 Configurações das integrações.

Para usuários sem role owner:

 Não mostrar links na navegação;

 Não mostrar cards;

 Não mostrar botões;

 Não mostrar chamadas promocionais;

 Não mostrar recurso bloqueado por plano;

 Não mostrar modal de upgrade;

 Não revelar que a integração existe;

 Bloquear acesso direto pela URL;

 Bloquear chamadas diretas à API;

 Retornar resposta segura e sem dados internos.

Para usuários owner:

 Manter acesso ao estado atual;

 Exibir claramente que é um recurso experimental;

 Exibir que a conclusão está adiada;

 Não ativar sincronizações automáticas;

 Não realizar novas chamadas externas sem ação administrativa explícita.

3. MERCADO INTELIGENTE PARA USUÁRIOS COMUNS

O Mercado Inteligente deve continuar funcionando com os recursos próprios já existentes, quando disponíveis, como:

 Listas de compras;

 Carrinho;

 Orçamento;

 Calculadoras;

 Histórico local;

 Mercados salvos;

 Cesta;

 Importação de cupom;

 Funcionalidades que não dependam de Joanin ou Carrefour.

Não bloquear todo o Mercado Inteligente apenas porque Joanin e Carrefour foram adiados.

Remover dos usuários comuns somente as dependências, telas e promessas específicas dessas duas integrações.

Não mostrar dados falsos, mocks ou resultados simulados como preços reais.

4. FEATURE FLAGS

Criar ou consolidar controles separados, caso ainda não existam:

joanin_enabled = false
carrefour_enabled = false
joanin_admin_only = true
carrefour_admin_only = true

Os nomes podem ser adaptados ao padrão real do projeto.

Regras:

enabled=false impede operação externa;

admin_only=true restringe visualização e diagnóstico à role owner;

 Ausência da configuração deve resultar em estado desligado;

 Preview não deve chamar APIs produtivas;

 Produção não deve executar sincronização automática;

 Usuário comum nunca pode alterar essas flags.

As flags devem ser alteráveis somente por ação server-side autorizada para owner.

5. JOBS, CRONS E CHAMADAS EXTERNAS

Audite:

pg_cron;

 Cloudflare Cron Triggers;

 Schedules do Lovable;

 Filas;

 Workers;

 Server functions;

 Chamadas automáticas;

 Retry;

 Sincronizações periódicas;

 Processos manuais.

Garanta que:

 Nenhum cron do Joanin esteja ativo;

 Nenhum cron do Carrefour esteja ativo;

 Nenhuma sincronização automática esteja ativa;

 Nenhum retry automático gere chamadas externas;

 Nenhuma página comum faça chamada silenciosa às integrações;

 Nenhum acesso ao dashboard dispare sincronização involuntária.

Caso existam jobs ativos, desligue-os sem apagar a configuração histórica.

6. BANCO DE DADOS

Não apagar:

 Tabelas;

 Colunas;

 Funções;

 Dados históricos;

 Logs;

 Configurações;

 Migrations;

 Chaves de relacionamento.

Aplicar RLS e autorização adequada nas tabelas administrativas relacionadas.

Apresente:

TabelaIntegraçãoRLSUsuário comumOwnerService role

Usuários comuns não devem conseguir:

 Ler credenciais;

 Ler logs técnicos;

 Alterar configuração;

 Executar sincronização;

 Inserir preço externo;

 Editar status da integração;

 Consultar erros internos.

7. SECRETS

Não remover secrets existentes sem necessidade.

Não revelar valores.

Auditar apenas se existem e onde são utilizados.

Caso algum secret esteja configurado:

 Manter armazenado com segurança;

 Impedir uso automático;

 Não realizar teste externo nesta etapa;

 Registrar que a integração está pausada.

Não criar novos secrets para Joanin ou Carrefour agora.

8. DOCUMENTAÇÃO DO ESTADO FUTURO

Atualizar a documentação para classificar:

Joanin

STATUS: PAUSADO
ACESSO: ADMIN MASTER / ROLE OWNER
PRIORIDADE: FUTURA
BLOQUEIA LANÇAMENTO: NÃO
SINCRONIZAÇÃO AUTOMÁTICA: DESLIGADA

Carrefour

STATUS: PLANEJADO PARA O FUTURO
ACESSO: ADMIN MASTER / ROLE OWNER
PRIORIDADE: FUTURA
BLOQUEIA LANÇAMENTO: NÃO
SINCRONIZAÇÃO AUTOMÁTICA: DESLIGADA

Essas integrações não devem mais aparecer como pendências críticas, bloqueadores ou requisitos para o lançamento geral.

9. NOVA ORDEM OFICIAL DE PRIORIDADES

Atualize o roadmap para a seguinte ordem:

Prioridade 1 — WhatsApp

Concluir:

 Templates oficiais;

 Status e aprovação da Meta;

 Quotas comerciais;

 Dispatcher;

 Fila;

 Agendamento;

 Rollout controlado;

 Remoção da allowlist geral;

 Liberação para todos os planos elegíveis;

 Monitoramento;

 Auditoria final.

O número oficial já está validado e diversos testes reais de conversa já foram feitos.

Não reiniciar a validação do número.

Prioridade 2 — Mercado Pago

Concluir quando os secrets oficiais forem fornecidos:

 Configuração produtiva;

 Checkout oficial;

 Webhook;

 Primeiro pagamento real;

 Ativação de plano;

 Renovação;

 Falha;

 Cancelamento;

 Reconciliação;

 Auditoria financeira.

Prioridade 3 — PWA

Concluir:

 Manifest;

 Ícones;

 Instalação;

 Service Worker;

 Estratégia de cache;

 Atualização segura;

 Comportamento offline permitido;

 Avisos de conexão;

 Testes em navegadores móveis.

Prioridade 4 — Biometria real

Planejar e implementar:

 WebAuthn/passkeys no ambiente web, quando compatível;

 Integração segura no aplicativo;

 Fluxos de cadastro;

 Login;

 Recuperação;

 Revogação;

 Fallback seguro.

Prioridade 5 — Android

Finalizar:

 Navegação;

 Cores das barras;

 Faixa branca residual;

 Performance;

 Importações;

 Permissões;

 Biometria;

 Atualizações;

 Publicação.

Prioridade 6 — iOS

Preparar e concluir:

 Projeto;

 Navegação;

 Sessão;

 Biometria;

 Permissões;

 Deep links;

 Testes;

 Publicação.

Prioridade 7 — Segurança, LGPD e lançamento final

Concluir:

 Auditoria de RLS;

 Funções SECURITY DEFINER;

 Search path;

 Logs;

 Consentimentos;

 Exclusão e exportação de dados;

 Política de privacidade;

 Termos;

 Recuperação;

 Backups;

 Monitoramento;

 Testes ponta a ponta;

 Checklist de lançamento.

Futuro — Sem bloquear lançamento

 Joanin;

 Carrefour;

 Outras integrações de supermercados.

10. INTERFACE ADMINISTRATIVA

No painel owner, criar ou ajustar uma seção como:

Integrações futuras

Mostrar:

IntegraçãoEstadoAcessoSincronizaçãoPrioridadeJoaninPausadoOwnerDesligadaFuturaCarrefourPlanejadoOwnerDesligadaFutura

Adicionar aviso:

“Estas integrações estão preservadas para desenvolvimento futuro e não fazem parte do lançamento atual do Gasto Inteligente.”

Não mostrar esse painel para outros usuários.

11. TESTES OBRIGATÓRIOS

Criar ou atualizar testes para:

 Usuário comum não vê Joanin;

 Usuário comum não vê Carrefour;

 Usuário comum não acessa as rotas diretamente;

 Usuário comum não chama APIs administrativas;

 Usuário de plano pago sem role owner continua bloqueado;

 E-mail administrativo sem role continua bloqueado;

 Role owner acessa diagnóstico;

 Falha ao consultar roles resulta em bloqueio;

 Joanin desligado não realiza chamadas externas;

 Carrefour desligado não realiza chamadas externas;

 Preview não utiliza integração produtiva;

 Nenhum cron está ativo;

 Mercado Inteligente continua funcionando sem essas integrações;

 Landing page permanece funcional;

 Recursos financeiros permanecem preservados;

 WhatsApp permanece inalterado;

 Mercado Pago permanece inalterado.

12. QUALIDADE

Executar:

VerificaçãoResultado esperadoTypecheckzero errosTestesbaseline atual ou superiorFalhaszeroBuildaprovadoLint dos arquivos alteradoszero errosSecurity scanzero crítico e zero altoLandingfuncionalMercado Inteligentefuncional sem Joanin/CarrefourChamadas externas JoaninzeroChamadas externas CarrefourzeroCronszero ativos

Não esconder warnings.

13. PUBLICAÇÃO

Esta alteração poderá ser publicada após o checkpoint técnico, pois representa uma redução segura de escopo.

Na publicação:

 Não ativar WhatsApp;

 Não alterar Mercado Pago;

 Não alterar planos;

 Não alterar quotas;

 Não alterar dados financeiros;

 Não alterar Android;

 Não alterar iOS;

 Não alterar PWA;

 Não executar chamadas ao Joanin;

 Não executar chamadas ao Carrefour.

Registrar deploy, arquivos, migrations e smoke tests.

14. DOCUMENTAÇÃO

Atualizar:

 Roadmap geral;

 Relatório técnico do Gasto Inteligente;

 Documentação do Mercado Inteligente;

 Lista de bloqueadores;

 Estimativa de conclusão;

 Painel de roadmap do Admin Master.

Registrar explicitamente:

JOANIN E CARREFOUR NÃO BLOQUEIAM MAIS O LANÇAMENTO DO GASTO INTELIGENTE

15. RESPOSTA FINAL

Apresentar:

 Rotas encontradas;

 Componentes encontrados;

 APIs encontradas;

 Tabelas encontradas;

 Jobs e crons encontrados;

 Chamadas externas encontradas;

 Feature flags;

 Proteção role-based;

 Arquivos criados;

 Arquivos alterados;

 Migrations;

 RLS;

 Policies;

 Grants;

 Testes adicionados;

 Total de testes;

 Falhas;

 Typecheck;

 Build;

 Lint;

 Security scan;

 Estado do Mercado Inteligente;

 Estado do Joanin;

 Estado do Carrefour;

 Estado do WhatsApp;

 Estado do Mercado Pago;

 Estado da publicação;

 Roadmap atualizado;

 Bloqueadores atuais;

 Próxima ação.

Não responder apenas com um resumo curto.

16. PRÓXIMA AÇÃO

Após concluir esta reorganização, retomar:

PROMPT 7 — TEMPLATES OFICIAIS DA META E PREPARAÇÃO PARA LIBERAÇÃO GERAL DO WHATSAPP

Joanin e Carrefour só devem ser retomados após autorização explícita futura.

17. NOVA ESTIMATIVA

Ao remover Joanin e Carrefour do caminho crítico, atualizar a estimativa para aproximadamente:

 Site web comercial completo: 8 a 15 prompts;

 WhatsApp e Mercado Pago concluídos: incluídos nessa faixa, dependendo de aprovações e secrets;

 Ecossistema completo com PWA, biometria, Android e iOS: aproximadamente 25 a 48 prompts adicionais.

As integrações Joanin e Carrefour não devem ser incluídas nessa contagem principal.

Ao final de cada prompt futuro, continuar informando quantos prompts estimados restam para a liberação geral.