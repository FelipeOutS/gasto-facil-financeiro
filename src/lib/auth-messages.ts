/**
 * Traduz mensagens de erro do Supabase Auth e de validação para português
 * amigável. Usado em login, cadastro e recuperação de senha para garantir
 * que o usuário final nunca veja mensagens cruas em inglês.
 */
export function traduzirErroAuth(message: string | undefined | null): string {
  if (!message) return "Algo deu errado. Tente novamente em instantes.";
  const m = message.toLowerCase();

  if (m.includes("invalid login credentials") || m.includes("invalid email or password")) {
    return "E-mail ou senha incorretos.";
  }
  if (m.includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.";
  }
  if (
    m.includes("user already registered") ||
    m.includes("already registered") ||
    m.includes("already exists")
  ) {
    return "Este e-mail já está cadastrado.";
  }
  if (m.includes("password should be at least") || m.includes("password is too short")) {
    return "Sua senha é muito curta. Use pelo menos 8 caracteres.";
  }
  if (m.includes("password") && m.includes("weak")) {
    return "Sua senha está fraca. Misture letras, números e símbolos.";
  }
  if (m.includes("unable to validate email") || m.includes("invalid email")) {
    return "E-mail inválido. Confira e tente novamente.";
  }
  if (m.includes("rate limit") || m.includes("too many requests")) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns instantes.";
  }
  if (m.includes("network") || m.includes("failed to fetch")) {
    return "Sem conexão no momento. Verifique sua internet.";
  }
  if (m.includes("token") && (m.includes("expired") || m.includes("invalid"))) {
    return "Link expirado ou inválido. Solicite um novo.";
  }
  if (m.includes("user not found")) {
    return "Não encontramos uma conta com esse e-mail.";
  }
  if (m.includes("same password")) {
    return "A nova senha precisa ser diferente da anterior.";
  }
  // fallback: capitaliza primeira letra
  return message.charAt(0).toUpperCase() + message.slice(1);
}

export type SenhaRegra = {
  id: "min" | "maiuscula" | "minuscula" | "numero" | "especial";
  label: string;
  ok: boolean;
};

export function avaliarSenha(senha: string): SenhaRegra[] {
  return [
    { id: "min", label: "8 caracteres ou mais", ok: senha.length >= 8 },
    { id: "maiuscula", label: "1 letra maiúscula", ok: /[A-Z]/.test(senha) },
    { id: "minuscula", label: "1 letra minúscula", ok: /[a-z]/.test(senha) },
    { id: "numero", label: "1 número", ok: /\d/.test(senha) },
    {
      id: "especial",
      label: "1 caractere especial",
      ok: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(senha),
    },
  ];
}

export function senhaForte(senha: string): boolean {
  return avaliarSenha(senha).every((r) => r.ok);
}
