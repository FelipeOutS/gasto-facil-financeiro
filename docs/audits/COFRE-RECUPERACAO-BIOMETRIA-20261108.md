# Senha mestra esquecida com biometria disponível

Implementação local: a entrada apresenta ajuda para PIN/senha esquecidos. Após entrar com biometria, Alterar senha mestra permite escolher confirmação biométrica nova, sem exigir a senha esquecida.

A chave de sessão não autoriza a troca. O fluxo solicita unlockWithBiometric, valida assertCurrentVaultKey e chama a rotação atômica existente. Essa rotação verifica a chave, recriptografa os registros e exige a geração esperada e os registros esperados no banco. Não há fallback para gravações individuais. Após confirmação, invalida desbloqueios rápidos e exige a nova senha. Cancelamento antes da rotação não encerra a sessão; resultado incerto da rotação bloqueia o Cofre. Um bloqueio síncrono impede submissões duplicadas.

Validação isolada: 91 testes em oito suítes do Cofre, sem falhas. Incluem seis novos cenários de recuperação: sucesso com clique duplo, cancelamento, chave antiga, consulta indisponível, falha da rotação e senha atual sem biometria. A suíte de rotação executa SQL real em PostgreSQL/WASM descartável. Nenhuma operação em banco remoto.

Limitações: biometria física e experiência no celular ainda exigem homologação. Registro biométrico presente não garante disponibilidade do autenticador; o método efetivo recusa credencial ausente, antiga ou inválida. A RPC vault_rotate_master_key_atomic precisa estar disponível; se não estiver, não há gravação alternativa. Não foi verificada nem aplicada migração em produção. Nenhuma senha ou dado real foi alterado. Sem push ou publicação.

As alterações locais anteriores de desempenho foram preservadas.
