# PLANO DO APLICATIVO iOS / iPHONE — GASTO INTELIGENTE

**Data:** 31/07/2026
**Status:** documento de planejamento. **Nenhuma implementação foi realizada.**
**Escopo:** registrar a frente oficial "Aplicativo iPhone (App Store)", comparar alternativas técnicas, auditar a preparação do projeto atual para múltiplos clientes e definir roadmap, MVP e critérios de aceite.

**Restrições respeitadas nesta etapa:** não foi criado projeto iOS, React Native ou Capacitor; nenhuma biblioteca instalada; backend, autenticação, pagamentos, dados, migrations, WhatsApp e Android intocados; nenhuma credencial Apple criada; nada publicado. Apenas dois arquivos de documentação foram alterados/criados.

---

## 1. OBJETIVOS

1. O Gasto Inteligente deve funcionar em **navegador web, PWA, Android e iPhone** (iPad como alvo secundário, apenas se não elevar a complexidade — recomenda-se publicar como app iPhone compatível com iPad em modo "compatível", sem layout dedicado na v1).
2. O app iPhone usa **a mesma conta, o mesmo banco e os mesmos dados financeiros** do site. Não existe base separada, nem sincronização entre bases.
3. O usuário alterna entre web, Android e iPhone **sem perder**: sessão, gastos, receitas, cartões, faturas, contas, metas, orçamentos, investimentos, empresas, clientes, fornecedores, importações, preferências, plano contratado, histórico e notificações.
4. Reduzir duplicação de código: uma única fonte de verdade de regras de negócio, tipos e contratos.
5. Manter o nível de segurança exigido por dados financeiros sensíveis e pela LGPD.

**Consequência arquitetural direta do item 3:** tudo o que hoje é estado **local** (localStorage) e não é espelhado no banco **é uma quebra desse objetivo**. Preferências, listas de mercado, cesta, orçamento de mercado, histórico de preços, tema, bloqueio do app e desbloqueio rápido precisam migrar para o servidor (ou ganhar espelho servidor) antes do IOS-1.

---

## 2. FUNCIONALIDADES PREVISTAS NO APLICATIVO iOS

**Autenticação e conta:** cadastro, login, recuperação de senha, renovação de sessão, logout, troca de usuário, Face ID/Touch ID, reautenticação para ações sensíveis, exclusão de conta, exportação de dados.

**Núcleo financeiro:** dashboard, gastos, receitas, contas a pagar, contas a receber, cartões, faturas, metas, orçamento, guardado, relatórios, calendário.

**Avançado (versões posteriores):** investimentos, Empresa Inteligente (empresa/clientes/fornecedores/contador), Mercado Inteligente completo, OCR de encarte, importações (extrato, fatura, conta, investimentos), Gasto AI, WhatsApp, contas conectadas, offline avançado.

**Plataforma:** notificações push, deep links/universal links, câmera e galeria, leitura de código de barras e QR, upload de PDF/imagem, tema claro/escuro, acessibilidade (VoiceOver, Dynamic Type).

---

## 3. ALTERNATIVAS TÉCNICAS

### Opção A — React Native (Expo)

| Critério | Avaliação |
|---|---|
| Reaproveitamento de TypeScript | **Alto.** Tipos, validadores Zod, formatadores monetários, cálculos de fatura/limite/meta e cliente Supabase são JS puro e migram sem alteração. |
| Compartilhamento de regras de negócio | **Alto**, desde que extraídas para um pacote `@gi/core` livre de DOM. Hoje `src/lib/store.ts` e `src/lib/mercado/*` dependem de `localStorage` e precisam de uma camada de storage injetável. |
| Reaproveitamento de UI | **Baixo.** Componentes shadcn/Tailwind/DOM **não** migram; a UI é reescrita com componentes nativos. É o custo principal desta opção. |
| Interfaces nativas | Nativas de verdade (UIKit por baixo): rolagem, gestos, teclado, date pickers e navegação com sensação iOS. |
| Biometria | `expo-local-authentication` + `expo-secure-store` (Keychain, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Permite biometria **real**: desbloqueia o refresh token guardado no Keychain. |
| Notificações | APNs via `expo-notifications`; mesma abstração serve FCM no Android. |
| Upload de arquivos | `expo-document-picker` + `expo-file-system` com upload resumível. |
| Câmera / OCR | `expo-camera` + `expo-image-manipulator` (compressão/rotação) e leitura de barcode/QR nativa. OCR permanece no servidor (Gemini), como já é hoje. |
| Links | Universal Links nativos com `apple-app-site-association`. |
| Armazenamento seguro | Keychain (iOS) e Keystore/EncryptedSharedPreferences (Android) pela mesma API. |
| Offline | Excelente: SQLite/MMKV + fila de sincronização. |
| Manutenção conjunta com Android | **Melhor do mercado para este caso** — um único código React Native serve iPhone e Android, substituindo o WebView Android atual. |
| Complexidade de migração | **Média-alta.** Exige extrair o domínio e reconstruir telas. Incremental: MVP primeiro, módulos avançados depois (inclusive via WebView autenticada como ponte temporária). |

### Opção B — Capacitor (encapsular a aplicação web)

| Critério | Avaliação |
|---|---|
| Reaproveitamento da aplicação web | **Máximo** — a mesma build React roda dentro do WKWebView. |
| Encapsulamento do site atual | Deve embarcar os assets no bundle, **não** carregar a URL remota. Apps que são apenas um wrapper de site são rejeitados pela App Store (Guideline 4.2 — minimum functionality). Este é o risco número um da opção. |
| Plugins nativos | Ecossistema bom: `@capacitor/camera`, `filesystem`, `push-notifications`, `preferences`, `app`, `browser`, além de `capacitor-native-biometric` / `capacitor-secure-storage-plugin`. |
| Biometria | Possível e real, desde que o token fique no Keychain via plugin — **nunca** em `localStorage` do WebView. |
| Câmera / upload | Bons; controle mais fraco sobre compressão e orientação do que em RN. |
| Push | Suportado via APNs/FCM. |
| Universal Links | Suportados (`@capacitor/app` + AASA). |
| Cookies / sessão | Ponto sensível: o WKWebView pode ter cookies/`localStorage` limpos pelo ITP e pela limpeza de dados do sistema; sessão precisa ser reidratada do Keychain no cold start. |
| Publicação na App Store | Possível, com risco de revisão (4.2) e exigência de IAP para assinaturas (3.1.1). |
| Limitações vs. React Native | Rolagem/gestos/teclado com "sensação de site"; performance inferior em listas longas e gráficos; offline limitado ao que o WebView permitir; menor controle de memória e de estados de background. |

### Opção C — Nativo em Swift (SwiftUI)

| Critério | Avaliação |
|---|---|
| Experiência nativa | Melhor possível. |
| Segurança | Melhor acesso a Keychain, App Attest, Data Protection. |
| Biometria / desempenho | Ótimos. |
| Custo / tempo | **Os mais altos.** Reescrita completa do frontend. |
| Duplicação do frontend | **Total** — três frontends (web, Android, iOS) e três lugares para corrigir cada regra. |
| Manutenção | Insustentável para o tamanho atual da equipe. |
| Equipe especializada | Exige desenvolvedor Swift dedicado, hoje inexistente no projeto. |

### Opção D — PWA instalada no iPhone (apenas complementar)

| Limitação | Situação no iOS |
|---|---|
| Biometria | Sem Face ID/Touch ID confiável; WebAuthn em Safari existe mas não substitui desbloqueio de sessão nativa em app instalado. |
| Notificações | Web Push só funciona quando adicionada à Tela de Início e é historicamente instável; sem canais ricos. |
| Armazenamento | O sistema pode **apagar** dados de sites sem uso por ~7 dias (ITP) — inaceitável para fila offline financeira. |
| Sessão | Sujeita a expurgo de storage; risco de logout aparentemente aleatório. |
| Integrações nativas | Sem Keychain, sem leitura nativa de barcode robusta, sem background sync confiável. |
| Distribuição | Fora da App Store; sem descoberta, sem reviews, sem TestFlight. |
| Experiência | Aceitável, mas sem "cara de app". |

**Veredito D:** a PWA vale como camada de alcance imediato (instalação em Android, desktop e iPhone) e melhoria do site, **mas não substitui o app da App Store** e não deve ser usada como justificativa para adiar indefinidamente a frente iOS.

---

## 4. RECOMENDAÇÃO DE ARQUITETURA

### Estratégia principal — React Native (Expo) + pacote de domínio compartilhado

**Arquitetura alvo:**

```text
                 ┌───────────────────────────────┐
                 │  @gi/core (TypeScript puro)   │
                 │  tipos, Zod, cálculos, regras │
                 │  cliente de API, sem DOM      │
                 └───────────────┬───────────────┘
             ┌───────────────────┼───────────────────┐
             │                   │                   │
      Web (TanStack)      iOS (React Native)   Android (React Native)
             │                   │                   │
             └───────────────────┴───────────────────┘
                                 │
                    Backend único (Lovable Cloud)
             API HTTP versionada /api/v1 + RLS + Auth JWT
                                 │
              WhatsApp · Jobs/cron · Integrações · Webhooks
```

**Motivo:** é a única opção que atende simultaneamente aos seis critérios do pedido — segurança (Keychain/Keystore reais), manutenção (um app para as duas lojas), evolução (offline, push, câmera sem ginástica), experiência (nativa), compartilhamento de código (domínio único em TS) e compatibilidade Android/iOS. Não foi escolhida por ser rápida no curto prazo — ela **não** é a mais rápida; é a que produz o menor custo total em 24 meses.

### Alternativa de curto prazo — Capacitor
Justificada **apenas** se houver necessidade comercial de estar na App Store em semanas. Condições obrigatórias: assets embarcados (não wrapper de URL), tokens no Keychain, biometria por plugin nativo, e pelo menos três capacidades nativas visíveis (câmera com OCR, push, widgets/atalhos) para sobreviver à Guideline 4.2. Deve ser tratada como **ponte descartável**, com o pacote `@gi/core` já extraído para que a migração para RN não jogue trabalho fora.

### Alternativa não recomendada — Swift nativo
Motivo: triplica o frontend e a superfície de bugs, exige equipe que o projeto não tem e não traz vantagem funcional relevante sobre React Native para um app de finanças pessoais.

### Complementar — PWA
Recomendada de qualquer forma (manifest + service worker + ícones maskable), porque melhora o site, dá instalação imediata no Android e desktop, e **não conflita** com a frente iOS. Nunca comunicada ao usuário como "o app do iPhone".

---

## 5. SEPARAÇÃO ENTRE FRONTEND E BACKEND — AUDITORIA

### 5.1 Estado atual

| Camada | Evidência | Aptidão para múltiplos clientes |
|---|---|---|
| `src/server/` (87 módulos) | WhatsApp, quotas, entitlement, billing, admin, OCR | **Boa.** Lógica sensível já está no servidor. |
| `src/lib/*.functions.ts` (13 arquivos, `createServerFn`) | account, admin, cnpj, contas, finance-ai, pix-reveal, radar, subscription, system-health, whatsapp* | **Parcial.** É RPC do TanStack Start, com serialização e middleware próprios; **não é** um contrato HTTP estável para app nativo. |
| `src/routes/api/` (20 rotas) | checkout, importações, OCR, mercado, webhooks MP, hooks WhatsApp | **Boa base** — já são HTTP reais. Falta versionamento e padronização de erro. |
| `src/lib/store.ts` + `src/lib/mercado/*` | ~30 módulos usando `localStorage`; `hydrateUser()` hidrata store local por usuário | **Ruim.** Fonte de verdade parcialmente no navegador. |
| Acesso direto ao banco pelo cliente | `supabase` do cliente usado nas telas, protegido por RLS | Funciona no app móvel (mesmo SDK), mas espalha regra de negócio pelo frontend. |

### 5.2 Onde as regras estão hoje

- **Centralizadas no servidor:** WhatsApp (todos os gates), quotas e entitlement, billing/Mercado Pago, OCR, admin master, PIX reveal, CNPJ, radar econômico. ✅
- **Duplicadas nos componentes:** cálculo de fatura/limite de cartão, agregações de dashboard, projeções de orçamento e metas, health score financeiro (`src/lib/insights/financial-health-score.ts`), parsing de NFC-e (`src/lib/mercado/nfce-parser.ts`). ⚠️ Precisam ir para `@gi/core` (compartilhável) ou para o servidor.
- **Dependentes do navegador:** tema, sidebar, app-lock, quick-unlock, preferências, listas/cesta/orçamento de mercado, histórico de preços, sessão biométrica local. ⚠️
- **Dependentes de cookies:** baixa — a sessão é JWT em `localStorage` via SDK Supabase (bom para móvel; ruim para segurança de WebView).
- **Dependentes de `localStorage`:** alta — ~30 módulos.
- **Dependentes de APIs exclusivas da web:** `window`, `document`, `File`/`Blob` em importações, `navigator.geolocation` em mercados próximos, Google Maps no navegador.

### 5.3 Funções que precisam virar API/serviço reutilizável

| # | Função / área | Situação | Ação |
|---|---|---|---|
| 1 | Login e refresh de sessão | SDK Supabase | Mantém SDK; adicionar armazenamento seguro por plataforma |
| 2 | Perfil e preferências | Parcialmente local | `GET/PUT /api/v1/preferences` com espelho no banco |
| 3 | Planos e entitlement | Servidor + `use-plan.tsx` com cache local | `GET /api/v1/me/plan` como fonte única |
| 4 | Gastos / receitas / contas | Supabase direto + store local | Manter Supabase+RLS para leitura; **criar** endpoints de escrita idempotentes (`Idempotency-Key`) para a fila offline |
| 5 | Cartões e faturas | Cálculo no cliente | Mover cálculo para `@gi/core` e expor `GET /api/v1/cartoes/:id/fatura` |
| 6 | Metas e orçamento | Cálculo no cliente | `@gi/core` |
| 7 | Importações (extrato/fatura/conta/investimentos) | `src/routes/api/import-*` recebendo `File` | Aceitar upload multipart/base64 e retornar `job_id` com polling |
| 8 | Mercado Inteligente | Stores locais (`listas`, `cesta`, `orcamento`, `precos-history`) | **Migrar para o banco** — hoje um usuário não vê sua lista no iPhone |
| 9 | Gasto AI | `finance-ai.functions.ts` | Expor como `POST /api/v1/ai/*` |
| 10 | Empresa Inteligente | Supabase direto | Endpoints CRUD versionados |
| 11 | Mercado Pago | `checkout.create/verify` + webhook | Adicionar retorno de estado de assinatura para o app; **não** iniciar checkout web dentro do app iOS |
| 12 | Exclusão de conta | `account.functions.ts` + `DeleteAccountDialog` | `POST /api/v1/account/delete` (obrigatório pela App Store) |
| 13 | Exportação de dados | Parcialmente cliente | `POST /api/v1/account/export` gerando arquivo assinado |
| 14 | WhatsApp | Servidor ✅ | Nenhuma ação |
| 15 | Notificações | Sem canal push | Criar `device_tokens` + roteador de canais |

**Padrões obrigatórios do contrato:** prefixo `/api/v1`, autenticação `Authorization: Bearer <jwt>`, erro uniforme `{ error: { code, message, details? } }`, paginação por cursor, `Idempotency-Key` em toda escrita, e cabeçalhos `X-Client-Platform` / `X-Client-Version` para telemetria e force-update.

---

## 6. AUTENTICAÇÃO NO IPHONE

**Fluxo proposto:**

1. **E-mail e senha** → `signInWithPassword` (mesmo Auth do site).
2. Sessão recebida: `access_token` (curto) + `refresh_token` (longo).
3. **Armazenamento:** `refresh_token` no **Keychain** com `WHEN_UNLOCKED_THIS_DEVICE_ONLY` e flag de biometria; `access_token` apenas em memória.
4. **Cold start:** app pede Face ID/Touch ID → Keychain libera o refresh token → `setSession()` → sessão real restaurada. A biometria **desbloqueia uma credencial protegida**, nunca é uma confirmação decorativa.
5. **Recuperação de senha:** e-mail com universal link → abre o app na tela de nova senha (com fallback web).
6. **Renovação:** refresh automático do SDK + refresh no retorno ao foreground.
7. **Logout:** `signOut()` + apagar Keychain + limpar cache local + limpar chave do Cofre da memória (o web já faz isso em `auth-context.tsx`).
8. **Troca de usuário:** apagar toda a base local antes de hidratar outro `user_id`.
9. **Expiração / revogação:** qualquer `401`/`invalid_refresh_token` → limpar credenciais e voltar ao login com mensagem clara.
10. **Bloqueio após tentativas:** 5 falhas biométricas → exigir senha; falhas de senha limitadas pelo rate limit do servidor.
11. **Reautenticação para ações sensíveis:** Cofre Pessoal, revelar PIX, exclusão de conta, exportação, troca de e-mail/senha, cancelamento de plano.

**Proibições:** nunca gravar senha em texto; nunca gravar tokens em `localStorage` de WebView, `UserDefaults`, arquivo comum ou SQLite sem criptografia.

**Dívida atual relevante:** `src/lib/biometric-login.ts` e `src/lib/secure-session.ts` já modelam esse fluxo para Android via bridge nativa (`AndroidSecureSession`). **A mesma interface deve ser reimplementada em iOS** — é o desenho correto e deve ser preservado.

---

## 7. LOGIN COM PROVEDORES (não implementar agora)

**Regra dura da Apple:** se o app oferece login social de terceiros (Google), **Sign in with Apple é obrigatório** (Guideline 4.8). Ou seja: hoje, adicionar Google no app sem Apple = rejeição.

| Item | Impacto |
|---|---|
| Backend | Nenhum schema novo; identidades ficam em `auth.identities` |
| Auth | Habilitar provedores Apple e Google no Lovable Cloud; cadastrar Service ID, Team ID e chave `.p8` da Apple |
| Callback | Redirect same-origin público (`${origin}/auth/callback`), nunca apontando para rota protegida |
| Deep link / Universal link | `gastointeligente.com.br/auth/callback` precisa estar no AASA para retornar ao app |
| Contas duplicadas | Apple pode devolver e-mail privado de relay (`@privaterelay.appleid.com`) — não dá para casar por e-mail; exigir vinculação explícita quando já existir conta |
| Vinculação segura | Só permitir `linkIdentity` com sessão ativa e reautenticação recente; nunca fundir contas automaticamente por e-mail |
| Recuperação de conta | Usuário que só tem Apple ID e revoga o "Ocultar e-mail" precisa de caminho de recuperação por senha |

---

## 8. NOTIFICAÇÕES NO IPHONE

**Princípio:** um evento financeiro, muitos canais. Nada de regra duplicada por plataforma.

```text
Evento financeiro (servidor)
   ├─ conta_vencendo / conta_atrasada / fatura_fechando / fatura_vencendo
   ├─ meta_atingida / orcamento_estourado / assinatura_renovando
   ├─ alerta_seguranca / aviso_admin / mercado_preco / pagamento
   └─ trial_expirando / plano_expirando
            ↓
   Preferências do usuário (por tipo de evento × canal × quiet hours)
            ↓
   Roteador de canais
      ├─ push_ios (APNs)     ├─ push_android (FCM)
      ├─ whatsapp (existente) ├─ email
      └─ in_app (central de notificações)
```

**Camadas a criar:** tabela `device_tokens` (`user_id`, `platform`, `token`, `app_version`, `last_seen_at`, `revoked_at`), tabela de preferências por tipo de evento e canal, e um adapter APNs espelhando o adapter Meta já existente (`whatsapp-meta-transport.server.ts`) — mesmas garantias: idempotência, backoff, quiet hours (21h–07h), reconciliação de callback e opt-out.

**Conteúdo do push:** nunca valores ou nomes de terceiros no corpo visível na tela bloqueada. Payload mínimo + `deep_link`; o dado sensível é buscado na abertura, já autenticado.

---

## 9. DEEP LINKS E UNIVERSAL LINKS

**Formato:** `https://gastointeligente.com.br/app/<recurso>/<id>` (Universal Links, com `apple-app-site-association` servido em `/.well-known/`), mais o esquema `gastointeligente://` apenas para OAuth interno.

**Alvos:** conta a pagar, conta a receber, fatura, gasto, receita, meta, orçamento, mercado/lista, PIX, boleto, pagamento/checkout, recuperação de senha, convite de contador, confirmação de e-mail, central de notificações.

| Cenário | Comportamento exigido |
|---|---|
| App instalado + logado | Abre a tela direto |
| App instalado + deslogado | Guarda o destino, exige login/biometria, **depois** navega |
| App não instalado | Abre a versão web equivalente (mesma URL) com faixa "abrir no app" |
| Registro de outro usuário | Servidor/RLS nega → tela "conteúdo indisponível", sem revelar existência do registro |
| Link expirado | Mensagem específica + ação de reenviar |
| Link de ação sensível (senha, convite) | Token de uso único, curta validade, invalidado após consumo |

**Regra:** nunca usar o deep link como prova de autorização. Ele indica destino; a autorização é sempre reavaliada no servidor.

---

## 10. CÂMERA, ARQUIVOS E OCR

**Usos:** fotografar boleto, comprovante e cupom; escolher imagem da galeria; escolher PDF; importar extrato, fatura e investimentos; ler código de barras (boleto) e QR Code (PIX/NFC-e); enviar ao OCR.

| Aspecto | Decisão |
|---|---|
| Permissões | `NSCameraUsageDescription` e `NSPhotoLibraryUsageDescription` com texto explicando finalidade financeira; pedir só no momento do uso |
| Compressão | Redimensionar para ~2000px no maior lado, JPEG ~0.7 antes do upload |
| Orientação | Normalizar EXIF no dispositivo (OCR erra com imagem rotacionada) |
| Privacidade | Remover metadados de geolocalização antes do envio |
| Tamanho | Limite de 10 MB por arquivo; validar tipo real, não só extensão |
| Upload | Multipart com retomada; `Idempotency-Key` para não duplicar lançamento |
| Retentativa | Backoff exponencial, máximo 3 tentativas, com estado visível |
| Arquivo temporário | Diretório de cache do app, excluído após confirmação do servidor |
| Exclusão | Documento original apagado do storage após o prazo definido na política de retenção |
| Conexão instável | Enfileirar como "envio pendente"; nunca bloquear a interface |
| Barcode / QR | Leitura **nativa** no dispositivo; só o texto é enviado, sem imagem — mais rápido, mais barato e mais privado |
| OCR | Continua **no servidor** (Gemini). Nenhuma chave de IA dentro do app. |

---

## 11. FUNCIONAMENTO OFFLINE (estratégia, sem implementar)

**Podem funcionar offline:** visualizar dados já sincronizados (gastos, receitas, contas, cartões, faturas, metas, orçamento, relatórios do período em cache); criar rascunho de lançamento; consultar categorias; montar lista de compras; registrar gasto pendente de sincronização; ver histórico já baixado.

**Exigem conexão:** pagamentos e checkout, Mercado Pago, Gasto AI, OCR, WhatsApp, consulta de CNPJ, preços atualizados, contas conectadas, sincronização completa, exclusão de conta, exportação.

**Desenho da sincronização:**
- **Fila local** (SQLite) com operações `create/update/delete`, `entity`, `payload`, `client_id`, `attempts`, `status`.
- **IDs temporários:** UUID v4 gerado no dispositivo, enviado como `client_id` e persistido no servidor → o mesmo UUID vira chave de idempotência.
- **Idempotência:** unicidade `(user_id, client_id)` no banco; reenvio devolve o registro existente, não cria outro.
- **Conflitos:** last-write-wins por campo com `updated_at`, **exceto** em valores monetários e status de pagamento, onde o servidor vence e o app mostra "atualizado no servidor".
- **Exclusão:** soft delete com tombstone para não "ressuscitar" registro apagado em outro aparelho.
- **Atualização concorrente:** `If-Match` com versão do registro; `409` → tela de resolução.
- **Indicação visual:** todo item não sincronizado exibe selo "pendente"; erro permanente vira item acionável, nunca desaparece em silêncio.

---

## 12. SEGURANÇA DO APLICATIVO iOS

- Dados financeiros tratados como sensíveis: nada de dado bruto em cache não criptografado; Data Protection `NSFileProtectionComplete`.
- Tokens: apenas Keychain; `access_token` em memória.
- Sessão: expiração real, detecção de revogação (`401` → limpeza total), logout remoto respeitado.
- Biometria: desbloqueia credencial real (ver seção 6). Invalidação da chave ao cadastrar nova digital/rosto no aparelho.
- Criptografia: Cofre Pessoal mantém criptografia ponta a ponta atual (`src/lib/vault/crypto.ts`), com a chave mestra apenas em memória.
- Logs: nenhum PII, valor, token, telefone, CPF/CNPJ ou e-mail. Crash reporting com scrubbing.
- Screenshots: bloqueio/ocultação em telas sensíveis (Cofre, PIX, cartão completo) — o Android já tem `src/lib/android-security.ts` com `enableSecureScreen()`; o equivalente iOS é ocultar a view no `resignActive`.
- Seletor de aplicativos: overlay de blur ao ir para background.
- Links maliciosos: só abrir externos por `SFSafariViewController`, com allowlist de domínios para deep link.
- Certificados: HTTPS obrigatório, ATS ligado, sem exceções; avaliar pinning na v2.
- Ambientes: bundle IDs distintos (`br.com.gastointeligente.app` / `.hml` / `.dev`) e configuração por build.
- Limpeza pós-logout: Keychain, SQLite, cache de arquivos e imagens.
- Exclusão de conta **dentro do app** (obrigatório) e exportação de dados.
- Consentimento e LGPD: política de privacidade, finalidade de cada permissão, base legal e canal do titular.
- **Nenhum secret no app.** Somente a chave publicável do Lovable Cloud. Toda operação privilegiada continua no backend com `service_role`.

---

## 13. ASSINATURAS E APP STORE (análise, sem mudança comercial)

**O ponto crítico do projeto inteiro para o iOS.** A Guideline 3.1.1 exige In-App Purchase para desbloquear funcionalidade digital adquirida dentro do app, e proíbe o app de oferecer, linkar ou incentivar compra externa (com exceções restritas de "reader apps" e programas específicos que não se aplicam aqui).

| Cenário | Impacto |
|---|---|
| Plano comprado no site, usuário acessa pelo app | **Permitido.** O app reconhece o entitlement e libera. Não pode dizer como assinar fora. |
| Assinatura dentro do app | Exige **IAP com assinatura auto-renovável** e comissão da Apple (15–30%). |
| Renovação / cancelamento / upgrade / downgrade | Passam a ser gerenciados pela Apple, com regras e prazos próprios, incluindo cancelamento pelo usuário na conta Apple. |
| Trial | Suportado como introductory offer, com regras distintas do trial atual. |
| Restauração de compras | **Obrigatória** (botão "Restaurar compras"). |
| Usuário com plano Mercado Pago existente | Precisa de resolução de precedência: um único `plan_tier` efetivo derivado de MP **ou** Apple, sem dupla cobrança. |
| Mercado Pago | Continua sendo o canal do site e do Android. |
| Cobrança pela Apple | Reduz margem; pode exigir preço diferenciado no iOS. |

**Modelo recomendado (a aprovar):** entitlement **único e server-side**, com múltiplas origens de compra (`mercadopago`, `apple_iap`, `manual`), regra de precedência explícita e webhook/Server Notifications V2 da Apple alimentando o mesmo pipeline atômico já criado para o MP (`billing_apply_mercadopago_event_atomic` como modelo). Alternativa de menor atrito para a v1: publicar como app **sem venda no app** (login-only, sem qualquer menção a assinatura), aceitando que só usuários já pagantes usem recursos pagos — funciona, mas limita conversão e ainda assim exige que nenhuma tela empurre o checkout web.

**Decisão atual que pode virar bloqueio:** hoje o app web abre checkout Mercado Pago em várias telas de plano. Se essas telas forem reaproveitadas tal como estão (especialmente em Capacitor), a rejeição é praticamente certa. **Nenhuma mudança comercial deve ser feita sem aprovação** — o registro aqui é para que isso seja decidido antes, e não na revisão da Apple.

---

## 14. DESIGN E EXPERIÊNCIA NO IPHONE

Preservar a identidade visual (tokens de cor, tipografia, logo), mas com padrões iOS de verdade — não um site espremido.

Navegação inferior nativa com 4–5 itens e pilha por aba; `safe area` respeitada em notch, Dynamic Island e home indicator; `KeyboardAvoidingView` com teclado numérico e decimal em campos de valor; gesto de voltar por swipe; sheets nativos para modais; pickers nativos de data e de seleção; máscara monetária BRL com teclado decimal; gráficos performáticos com toque e rótulos legíveis; tema claro/escuro seguindo o sistema com override manual; Dynamic Type sem quebra de layout; VoiceOver com rótulos em português em todos os controles; skeletons em vez de spinners; faixa de offline persistente; erros com causa e ação; confirmação obrigatória para excluir, pagar e cancelar plano.

---

## 15. AMBIENTES E DISTRIBUIÇÃO

| Ambiente | Bundle ID | Backend | Observações |
|---|---|---|---|
| Desenvolvimento | `br.com.gastointeligente.app.dev` | projeto de dev | Sem webhooks reais, sem push de produção |
| Homologação | `br.com.gastointeligente.app.hml` | projeto de homologação **separado** | TestFlight interno |
| Produção | `br.com.gastointeligente.app` | produção | App Store |

**Isolamento obrigatório em homologação:** banco, webhooks (MP e Meta), pagamentos (sandbox), WhatsApp (runtime OFF), notificações (APNs sandbox), analytics (property separada do GA4 `G-6JSWT1P7N2`) e secrets próprios. Nenhum compartilhamento acidental.

**Processo:** versionamento `major.minor.patch` + build number incremental; builds por CI; TestFlight interno → externo → App Store; rollback por reenvio de versão anterior + force-update por `X-Client-Version` (o app precisa de um endpoint de versão mínima desde a v1); monitoramento e crash reporting com scrubbing de PII.

**Nenhuma conta Apple foi criada nesta etapa.**

---

## 16. IMPACTO DA MIGRAÇÃO DO BANCO

O app iPhone **não pode** apontar de forma fixa para um banco antigo ou novo. URL e chave publicável devem vir de configuração por ambiente, e o app deve tolerar rotação de chave sem nova submissão à loja (revisão da Apple leva dias; um cutover mal planejado derruba todos os usuários do app).

**Antes de publicar:** ambiente definitivo escolhido; migração concluída; Auth estabilizado (mesmos `user_id`, refresh tokens válidos — migração de projeto Auth **invalida sessões**, o que no app significa logout em massa); Storage estabilizado; APIs `/api/v1` congeladas; RLS validada em 100% das tabelas; sessões validadas; links validados; exclusão e exportação validadas.

**Regra:** não iniciar a publicação do iPhone enquanto o banco definitivo e o plano de cutover não estiverem claros.

---

## 17. ORDEM RECOMENDADA DE IMPLEMENTAÇÃO

| Etapa | Conteúdo | Prompts estimados | Compartilhado com Android |
|---|---|---|---|
| **IOS-0 — Preparação da arquitetura** | Extrair `@gi/core`; centralizar regras hoje no cliente; contratos `/api/v1`; padrão de erro; padrão de eventos; idempotência; migrar stores locais para o banco; preparar deep links (AASA); preparar canais de notificação (`device_tokens`) | 10–14 | **Sim (100%)** |
| **IOS-1 — Protótipo técnico** | Projeto RN/Expo, login, sessão, refresh, Keychain, biometria real, dashboard, gastos, receitas, contas, logout | 6–8 | Sim (~85%) |
| **IOS-2 — Núcleo financeiro** | Cartões, faturas, metas, orçamento, guardado, relatórios | 6–8 | Sim (~85%) |
| **IOS-3 — Recursos avançados** | Importações, câmera, OCR, Gasto AI, Empresa Inteligente, Mercado Inteligente | 6–10 | Sim (~75%) |
| **IOS-4 — Notificações e offline** | APNs, preferências por canal, fila offline, sincronização, conflitos, idempotência | 6–10 | Parcial (evento e preferências sim; transporte não) |
| **IOS-5 — App Store** | TestFlight, privacidade, permissões, termos, exclusão de conta, assinaturas/IAP, revisão, publicação | 4–8 | Não |
| **Total** | | **≈ 38–58 prompts** | |

---

## 18. CRITÉRIOS PARA COMEÇAR O DESENVOLVIMENTO

Não iniciar o app iOS antes de **todos** os itens abaixo:

1. Dados fictícios de produção removidos ou isolados (12 receitas de R$ 5,55 bi e gastos "Csa").
2. Vulnerabilidade crítica de supply chain (`seroval` via `@tanstack/*`) corrigida.
3. Mercado Pago validado ponta a ponta (`payment_events` com registros reais).
4. Banco definitivo confirmado e cutover planejado.
5. Autenticação estabilizada (incluindo decisão sobre WebAuthn/biometria no web).
6. APIs `/api/v1` definidas e congeladas.
7. Estratégia de assinaturas decidida (IAP vs. app login-only).
8. Tecnologia decidida (React Native, Capacitor ou nativo).
9. Escopo da v1 aprovado.
10. Ambiente de homologação isolado no ar.

---

## 19. MVP DA PRIMEIRA VERSÃO (iPhone)

**Dentro do MVP:** cadastro, login, recuperação de senha, Face ID/Touch ID, dashboard, gastos, receitas, contas a pagar, contas a receber, cartões, faturas, metas, orçamento, notificações, perfil, plano (visualização do entitlement), logout, exclusão de conta, exportação de dados.

**Versão posterior:** Empresa Inteligente, investimentos avançados, Mercado Inteligente completo, OCR de encarte, WhatsApp, offline avançado, contas conectadas.

**Ajustes propostos a essa divisão (com justificativa):**
- **Adicionar ao MVP:** captura de comprovante por câmera com OCR de gasto. É a funcionalidade que mais justifica um app em vez do site, e o OCR já existe no servidor — custo baixo, valor alto.
- **Adicionar ao MVP:** offline **somente leitura** (ver dados já sincronizados). Sem isso o app parece quebrado no metrô; a fila de escrita fica para IOS-4.
- **Rebaixar no MVP:** "plano" entra apenas como visualização do plano atual, sem qualquer fluxo de compra, até a decisão de IAP (seção 13).
- **Manter fora:** WhatsApp — está OFF em produção e depende de aprovação da Meta; não deve atrasar a loja.

---

## 20. RESULTADO ESPERADO — RESPOSTAS DIRETAS

1. **Qual tecnologia é mais indicada?** React Native (Expo) com pacote de domínio TypeScript compartilhado. Capacitor apenas como ponte de curto prazo; Swift não recomendado.
2. **Podemos compartilhar código com Android?** Sim — com React Native, praticamente 100% do app (UI inclusive), substituindo o WebView Android atual.
3. **Podemos compartilhar código com o site?** Sim, na camada de domínio (tipos, Zod, cálculos, cliente de API): estimativa de 40–60% do código útil. A UI não é compartilhada.
4. **O backend atual está pronto para um app móvel?** **Parcialmente.** A lógica sensível já está no servidor e a RLS cobre 68/68 tabelas, mas falta um contrato HTTP versionado, idempotência de escrita, canal push e migração dos estados que hoje vivem em `localStorage`.
5. **O que está preso ao navegador?** `src/lib/store.ts`, `src/lib/mercado/*` (listas, cesta, orçamento, histórico de preços, sync), tema, sidebar, app-lock, quick-unlock, biometria local, importações baseadas em `File`/`Blob`, geolocalização e Google Maps.
6. **O que precisa virar API?** Os 15 itens da seção 5.3 — com prioridade para preferências, plano/entitlement, escritas idempotentes do núcleo financeiro, fatura de cartão, mercado, importações, exclusão de conta e exportação.
7. **Como deve funcionar a autenticação?** E-mail/senha no mesmo Auth; refresh token no Keychain protegido por biometria; access token em memória; revogação detectada por `401`; reautenticação para ações sensíveis (seção 6).
8. **Como implementar Face ID/Touch ID com segurança?** A biometria libera o item do Keychain que guarda o refresh token, que restaura a sessão via `setSession()`. Sem prova de sessão real, não há acesso — nada de desbloqueio decorativo.
9. **Como manter a sessão?** Refresh automático + refresh no foreground + reidratação a partir do Keychain no cold start, com a mesma conta e o mesmo banco de web e Android.
10. **Como tratar notificações?** Evento único no servidor → preferências por tipo e canal → roteador para APNs, FCM, WhatsApp, e-mail e in-app. Sem regra duplicada e sem dado sensível no corpo do push.
11. **Como tratar links?** Universal Links com AASA, destino guardado quando deslogado, fallback web quando o app não está instalado, autorização sempre reavaliada no servidor.
12. **Como tratar câmera e arquivos?** Captura nativa, normalização de EXIF, compressão, remoção de geotag, upload idempotente com retomada, barcode/QR lidos no dispositivo e OCR no servidor.
13. **Como tratar offline?** Leitura do cache local; fila SQLite com UUID de cliente como chave de idempotência; conflito resolvido com prioridade do servidor em valores e status; selo visual de pendência.
14. **Como tratar assinaturas da App Store?** Entitlement único no servidor com múltiplas origens; IAP obrigatório se houver venda dentro do app; na v1, recomenda-se app sem venda interna até a decisão comercial.
15. **O que precisa estar concluído antes?** Os 10 critérios da seção 18.
16. **Qual deve ser o MVP?** O da seção 19 (com OCR de comprovante e leitura offline incluídos e plano sem checkout).
17. **Quantos prompts de implementação serão necessários?** **≈ 38–58** para a frente iOS, sendo ≈ 10–14 de IOS-0 aproveitados também pelo Android e pelo site.
18. **Quais tarefas são compartilhadas entre Android e iOS?** Todo o IOS-0; domínio `@gi/core`; contratos de API; entitlement; eventos e preferências de notificação; fila offline; deep links; a maior parte das telas em React Native.
19. **Quais tarefas são exclusivas do iPhone?** Keychain/Face ID/Touch ID, APNs, `apple-app-site-association`, Sign in with Apple, StoreKit/IAP, nutrition labels de privacidade, TestFlight, revisão da App Store, Dynamic Island/safe areas e ocultação de tela no seletor de apps.
20. **Qual é o próximo passo recomendado?** **Decidir formalmente React Native vs. Capacitor** e, em seguida, executar **IOS-0** começando pelo item de maior risco e maior retorno: **migrar para o banco os estados hoje presos em `localStorage`** (preferências e Mercado Inteligente), porque sem isso o usuário já perde dados ao alternar entre plataformas — inclusive hoje, entre navegadores.

---

## 21. RISCOS

| # | Risco | Severidade | Mitigação |
|---|---|---|---|
| R1 | Rejeição por IAP (3.1.1) ao levar o checkout Mercado Pago para dentro do app | **Crítica** | Decidir modelo de assinatura antes do IOS-1; v1 sem venda no app |
| R2 | Rejeição por "wrapper de site" (4.2) se optarmos por Capacitor | Alta | Assets embarcados + capacidades nativas reais |
| R3 | Estado em `localStorage` quebrando a promessa de continuidade entre plataformas | **Crítica** | IOS-0: migrar para o banco |
| R4 | Migração de banco/Auth após publicar → logout em massa e app apontando para ambiente errado | Alta | Configuração por ambiente + cutover antes da publicação |
| R5 | Sign in with Apple obrigatório se houver login Google | Média | Planejar os dois juntos ou nenhum |
| R6 | Dados fictícios em produção aparecendo no app da loja | Alta | Higienização antes do IOS-1 |
| R7 | Duplicação de lançamentos na fila offline | Alta | Idempotência por `client_id` desde o desenho |
| R8 | Vazamento de dado financeiro em push na tela bloqueada | Alta | Payload mínimo sem valores |
| R9 | Custo de manutenção de três frontends | Média | React Native unificando as duas lojas |
| R10 | Revisão da Apple exigindo exclusão de conta no app | Média | Já previsto no MVP |

---

## 22. DEPENDÊNCIAS

Conta Apple Developer (US$ 99/ano) e App Store Connect; certificados e chave APNs; domínio verificado para AASA (já existe: `gastointeligente.com.br`); Lovable Cloud (Auth, Postgres, Storage); Mercado Pago e/ou StoreKit; Gemini/Lovable AI para OCR; Meta (WhatsApp, fora do MVP); CI para builds; política de privacidade e termos publicados; decisão comercial sobre assinaturas.

---

## 23. CRITÉRIOS DE ACEITE

**IOS-0:** `@gi/core` publicado e consumido pelo site sem regressão; zero regra de negócio financeira exclusiva de componente; `/api/v1` documentada com padrão de erro e idempotência; preferências e Mercado Inteligente persistidos no banco; `device_tokens` e preferências de canal modelados; AASA servido.

**IOS-1:** login e logout reais; app fechado e reaberto restaura a sessão por Face ID sem voltar ao login; token nunca fora do Keychain; dashboard/gastos/receitas/contas exibindo os mesmos números do site para o mesmo usuário.

**IOS-2:** fatura, metas e orçamento calculados por `@gi/core` com resultado idêntico ao do site.

**IOS-3:** foto de comprovante gera gasto correto via OCR do servidor; importação de PDF conclui em conexão instável sem duplicar.

**IOS-4:** push entregue conforme preferências e quiet hours; 50 operações offline sincronizam sem duplicar nem perder nenhuma.

**IOS-5:** aprovado na revisão; exclusão de conta e exportação funcionando no app; nutrition labels corretos; TestFlight externo sem crash crítico.

**Transversal:** o mesmo usuário alterna web → Android → iPhone e encontra sessão, dados, preferências, plano, histórico e notificações consistentes.

---

## 24. CONFIRMAÇÃO DE ESCOPO

**Arquivos alterados/criados nesta etapa (apenas dois):**
1. `docs/RELATORIO_COMPLETO_GASTO_INTELIGENTE_2026-07-31.md` — nova subseção **"Aplicativo iOS / iPhone"** dentro da seção 14.
2. `docs/PLANO_APLICATIVO_IOS_GASTO_INTELIGENTE.md` — este documento (novo).

**Nada mais foi tocado:** nenhum código de aplicação, nenhuma biblioteca instalada, nenhum projeto iOS/React Native/Capacitor criado, backend/autenticação/pagamentos inalterados, nenhuma migration executada, nenhum dado alterado, nenhuma credencial Apple criada, Android intocado, nada publicado.
