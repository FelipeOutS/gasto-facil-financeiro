# Teste isolado da SerpApi (Google Shopping Brasil)

Script: `scripts/serpapi-shopping-smoke.mjs`. Ele **não** acessa banco, Supabase, WhatsApp nem o app. Busca fixa: `macbook air m4 16gb`.

> **Não cadastre a chave no projeto Lovable principal** (a prévia e o site publicado compartilham o mesmo ambiente). **Não cole a chave no chat.** Use só o seu computador.

## 1. Pegar a chave (painel oficial)
1. Entre em https://serpapi.com e faça login (plano grátis: confira o saldo no painel).
2. Abra https://serpapi.com/manage-api-key e copie a **Private API Key**.

## 2. Ensaio sem rede (padrão, não gasta nada)
Precisa do Node 18+ e de uma cópia local do repositório.
```bash
node scripts/serpapi-shopping-smoke.mjs
```

## 3. Execução real (SOMENTE depois de nova autorização)
Mac/Linux, no mesmo terminal. A chave não aparece na tela e não vai para o histórico nem para arquivos:
```bash
read -rs SERPAPI_API_KEY && export SERPAPI_API_KEY   # cole a chave e tecle Enter
node scripts/serpapi-shopping-smoke.mjs --execute
unset SERPAPI_API_KEY                                 # limpe ao terminar
```
O que acontece com `--execute`:
- 1 consulta grátis ao saldo (Account API), mostrando **só o número** de buscas restantes;
- se houver saldo, **1** busca Shopping: tempo limite de 9 s, **sem nova tentativa**;
- mostra até 3 ofertas novas do MacBook Air M4 16GB (sem M3, Pro, 8GB ou usado), com loja, preço, se o link é do Google Shopping ou direto da loja e horário de Brasília.

Nunca são exibidos chave, e-mail, ID da conta, resposta bruta ou URL com a chave. Não crie `.env` com a chave. Feche o terminal ao final.

Códigos de saída: 0 ok · 2 argumento recusado · 3 sem chave · 4 saldo ilegível · 5 sem saldo · 6 falha na busca.
