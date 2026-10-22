# Confirmação obrigatória de e-mail no cadastro — auditoria e plano

Nada foi alterado. Abaixo, o que foi inspecionado de fato e o que ficou sem confirmação.

## 1. Provedor real de autenticação
- **Lovable Cloud Auth** (backend gerenciado do projeto), não um backend externo. Login com Google usa o fluxo gerenciado do Lovable.
- Cadastro já envia `emailRedirectTo` e a tela "Confirme seu e-mail" com botão de reenvio já existe (`/cadastro`).
- Contas: **144 no total, 12 sem e-mail confirmado**.
- **Auto-confirm: NÃO consegui ler a configuração atual** (não há leitura dessa opção sem alterá-la). As 12 contas não confirmadas sugerem que a confirmação pode já estar ligada, mas não é prova. Conferir em **Cloud → Users → Auth settings → Email → Email confirmation**.

## 2. E-mails e domínio notify
- Domínio de envio: `notify.gastointeligente.com.br` — status **Falhou** ("verificação expirou em 14 dias").
- DNS público consultado agora: NS `ns5/ns6.lovable.cloud` e TXT `_lovable-email` **estão corretos e visíveis**. Ou seja, o bloqueio parece estar do lado do Lovable, não no seu DNS. Zoho (MX/SPF/DKIM/DMARC da raiz) não é afetado.
- Já existem no projeto os 6 modelos de e-mail de autenticação em PT-BR (incluindo "Confirme seu e-mail") e o receptor que os envia como `noreply@notify.gastointeligente.com.br`.
- Origem atual: enquanto o domínio não estiver verificado, os e-mails de autenticação saem pelo **remetente padrão do Lovable** com o modelo padrão (não o personalizado).

## 3. Redirecionamento e Android
- Links de e-mail usam o domínio oficial `https://gastointeligente.com.br` em produção e o endereço do Preview nos testes.
- Domínio principal é `gastointeligente.com.br`; `www` e o `.lovable.app` redirecionam para ele.
- Android (WebView): o link de confirmação abre no **navegador do celular**, não dentro do app. A conta é confirmada mesmo assim; o usuário volta ao app e entra com senha. Não verifiquei o código nativo (não está neste projeto).

## 4. Impacto em quem já usa
- Contas já confirmadas, logins com Google, WhatsApp vinculado e reset de senha **não mudam**.
- As 12 contas não confirmadas: se a confirmação for ligada agora, elas **não conseguirão entrar** até confirmar. Opções: reenviar confirmação ou confirmar manualmente pelo painel (**Users**), uma a uma, com sua decisão.
- Reset de senha já usa `/reset-password` no domínio oficial; continua igual.

## 5. Passos mínimos (cada um só com sua autorização)
1. Corrigir o domínio de envio: em **Cloud → Emails → Retry setup**. Se falhar de novo com o DNS já correto, abrir chamado no suporte Lovable (não mexer no DNS).
2. Conferir/desligar auto-confirm (somente depois que o envio estiver funcionando, para não travar novos cadastros).
3. Ajustes de tela no `/cadastro`: cooldown de 60 s no "Reenviar", contador visível, e mensagem clara para "e-mail ainda não confirmado" no login com atalho para reenviar. Mensagens de erro já são traduzidas.
4. Nenhuma mudança em Zoho, WhatsApp, Google ou dados.

## 6. E-mail personalizado
- Assunto: "Confirme seu cadastro no Gasto Inteligente".
- Usar logo oficial hospedado em URL pública absoluta do domínio (os arquivos da marca já existem no site), cores da marca, fundo branco.
- Link de confirmação: gerado pelo próprio sistema de autenticação (único, com validade), nunca montado à mão.
- Remetente: `no-reply@notify.gastointeligente.com.br` (hoje está `noreply@`; troca de 1 linha).
- Reply-To `suporte@gastointeligente.com.br`: **não confirmei se o envio gerenciado aceita Reply-To**. Se não aceitar, alternativa: texto no rodapé "Dúvidas? suporte@gastointeligente.com.br".

## 7. Testes, rollback, limites e custos
- Testes antes de publicar: "Send test" em Cloud → Emails; cadastro real no Preview com Gmail e Outlook (caixa e spam); link abre e confirma; reenvio respeita cooldown; login antes de confirmar mostra erro claro; Google e reset de senha intactos; teste no celular Android.
- Rollback: religar auto-confirm (volta ao comportamento atual em segundos) e/ou desativar e-mails personalizados (voltam ao modelo padrão, sem parar o envio).
- Limites: há um limite por hora de e-mails de autenticação (ajustável); domínio novo tende a cair em spam no início.
- Custo: planos pagos incluem 50.000 e-mails/mês por workspace; acima disso, 4 créditos por 1.000.

## Créditos
Não consigo confirmar o consumo real de créditos desta execução; veja nas configurações da sua conta Lovable.
