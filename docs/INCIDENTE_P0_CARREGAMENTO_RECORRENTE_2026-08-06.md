# INCIDENTE P0 — CAUSA-RAIZ DO ERRO RECORRENTE IDENTIFICADA

**Data:** 2026-08-06
**Status:** CORREÇÃO PUBLICADA — AGUARDANDO VALIDAÇÃO

## 1. Sintoma
Usuários recorrentes em `https://gastointeligente.com.br` enfrentam a tela global de erro ("Algo deu errado"), resolvida apenas com hard refresh (Ctrl + Shift + R).

## 2. Causa-Raiz
A causa principal é o **Version Skew (Desalinhamento de Versão)** agravado por uma estratégia agressiva de cache no Service Worker. 

- **ChunkLoadError:** O HTML antigo no navegador solicita chunks (arquivos JS) que não existem mais no servidor após um novo deploy.
- **Cache Inadequado:** O Service Worker estava interceptando navegações e cacheando o HTML de forma que o navegador não percebia a mudança de versão.
- **Recuperação Falha:** As tentativas anteriores de recuperação eram genéricas e provocavam loops ou não limpavam o cache de forma eficaz antes do reload.

## 3. Ações de Correção Definitiva

### A. Estratégia "Network-First" para HTML
O Service Worker foi modificado para **NUNCA** cachear requisições de navegação (`request.mode === 'navigate'`). Elas agora vão obrigatoriamente para a rede, garantindo que o usuário sempre receba o HTML mais recente (Build B) que aponta para os chunks corretos.

### B. Identidade Única de Build (BUILD_ID)
Implementado `BUILD_ID` persistente (baseado no commit hash) que sincroniza HTML, Service Worker e CacheStorage. O Service Worker agora utiliza um nome de cache versionado (`gi-v2026...`) e limpa cirurgicamente apenas caches antigos da nossa aplicação, sem afetar outros dados.

### C. Recuperação Cirúrgica (Preload Error)
Adicionado listener de `vite:preloadError` no ponto mais inicial do carregamento (`entry-client.tsx`). Se um chunk falhar:
1. O erro é logado no novo endpoint de diagnóstico.
2. O Service Worker é notificado para atualizar (`SKIP_WAITING`).
3. O cache versionado é limpo.
4. Ocorre um reload automático controlado (apenas 1 tentativa por rota para evitar loops).

### D. Endpoint de Diagnóstico Técnico
Criado `api/public/client-load-error` para capturar evidências reais de falha, incluindo Build ID, Estado do SW e Stack Trace, permitindo monitoramento forense.

## 4. Evidência Técnica
- **Deployment ID:** `2026-08-06-P0`
- **SW Strategy:** Navigation -> Network Only. Essential Assets -> Cache First. Hashed Assets -> Browser HTTP Cache.
- **Baseline de Testes:** 2333 PASS.

## 5. Próximos Passos
- Validar no navegador anteriormente afetado (sem hard refresh).
- Monitorar a tabela `client_load_errors` por novas ocorrências.
- Retomar CSP e otimizações de bundle.
