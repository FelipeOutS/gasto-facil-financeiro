# Relatório de Busca do Projeto Android Nativo - 2026-08-05

## 1. Veredito: PROJETO NÃO ENCONTRADO NO WORKSPACE
Após auditoria exaustiva, o código-fonte Android nativo (Java/Kotlin, Gradle, Manifest) **não foi localizado** nos seguintes locais:
- Raiz do projeto e subdiretórios;
- Histórico Git de todas as branches;
- Arquivos deletados no histórico Git;
- Stashes e Submodules;
- Referências em documentação (README, docs/*.md).

## 2. Evidências da Existência Anterior
Apesar da ausência do código, a existência anterior de um wrapper é confirmada pelas bridges ativas no código Web:
- `AndroidSecurity` (src/lib/android-security.ts);
- `AndroidBiometric` (src/lib/biometric-login.ts);
- `AndroidSecureSession` (src/lib/secure-session.ts).

O ID do aplicativo identificado no manifesto PWA é `com.gastointeligente.app`.

## 3. Origem Provável
O projeto Android foi provavelmente gerado externamente (Android Studio local ou Codex) e nunca foi comitado neste repositório principal.

## 4. Checklist para o Proprietário
Para recuperar o projeto, procure no computador local por:
- Pastas: `GastoInteligente`, `android-wrapper`, `webview-android`;
- Arquivo: `AndroidManifest.xml`, `build.gradle`;
- Package: `br.com.gastointeligente.app` ou `com.gastointeligente.app`.

A PWA está 100% operacional e pode ser usada como alternativa imediata.
