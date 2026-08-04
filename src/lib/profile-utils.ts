// Utilitários de perfil: máscaras, validação CPF/CNPJ e personalização de textos.

export type TipoCadastro = "pessoa_fisica" | "mei" | "empresa" | null;

// ---------- Máscaras ----------
export function maskCPF(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

export function maskCNPJ(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function maskTelefone(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3").trim();
  }
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3").trim();
}

export function onlyDigits(v: string): string {
  return v.replace(/\D/g, "");
}

// ---------- Mascarar para exibição (parcial) ----------
export function displayCPF(cpf: string | null | undefined): string {
  if (!cpf) return "—";
  const d = onlyDigits(cpf);
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
}

export function displayCNPJ(cnpj: string | null | undefined): string {
  if (!cnpj) return "—";
  const d = onlyDigits(cnpj);
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-${d.slice(12)}`;
}

// ---------- Validação CPF ----------
export function isValidCPF(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(cpf[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  return d2 === parseInt(cpf[10], 10);
}

// ---------- Validação CNPJ ----------
export function isValidCNPJ(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string, weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + parseInt(base[i], 10) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(cnpj.slice(0, 12), w1);
  if (d1 !== parseInt(cnpj[12], 10)) return false;
  const d2 = calc(cnpj.slice(0, 13), w2);
  return d2 === parseInt(cnpj[13], 10);
}

// ---------- Personalização de textos ----------
export type Vocab = {
  // genéricos
  contas: string;
  receitas: string;
  despesas: string;
  controle: string;
  tagLabel: string | null;

  // dashboard
  dashboardEyebrow: string;
  dashboardSubtitle: string;

  // relatórios
  relatoriosTitle: string;
  relatoriosSubtitle: string;

  // orçamento
  orcamentoTitle: string;
  orcamentoSubtitle: string;

  // contas a pagar
  contasAPagarTitle: string;
  importarContaTitle: string;

  // receitas / minha renda
  rendaTitle: string;

  // gastos
  gastosTitle: string;

  // mensagens / insight de saldo positivo
  saldoPositivoMsg: string;
};

/**
 * Tipo efetivo: usuários antigos (sem tipo definido) caem como "pessoa_fisica" para
 * efeito de personalização de textos — sem alterar o registro no banco.
 */
export function tipoEfetivo(tipo: TipoCadastro): Exclude<TipoCadastro, null> {
  return tipo ?? "pessoa_fisica";
}

export function getVocab(tipo: TipoCadastro): Vocab {
  switch (tipoEfetivo(tipo)) {
    case "mei":
      return {
        contas: "contas do MEI",
        receitas: "receitas do MEI",
        despesas: "despesas do negócio",
        controle: "Controle financeiro do MEI",
        tagLabel: "Perfil MEI",

        dashboardEyebrow: "Resumo do seu MEI",
        dashboardSubtitle: "Acompanhe entradas, gastos e compromissos do seu negócio.",

        relatoriosTitle: "Relatórios do MEI",
        relatoriosSubtitle: "Veja como o dinheiro entrou, saiu e onde melhorar.",

        orcamentoTitle: "Orçamento do MEI",
        orcamentoSubtitle: "Controle limites por categoria do seu negócio.",

        contasAPagarTitle: "Contas do MEI",
        importarContaTitle: "Importar boleto, Pix ou conta do MEI",

        rendaTitle: "Faturamento",
        gastosTitle: "Gastos do MEI",

        saldoPositivoMsg: "Seu MEI fechou o mês com saldo positivo.",
      };
    case "empresa":
      return {
        contas: "contas da empresa",
        receitas: "receitas da empresa",
        despesas: "despesas da empresa",
        controle: "Controle financeiro empresarial",
        tagLabel: "Perfil empresarial",

        dashboardEyebrow: "Resumo da empresa",
        dashboardSubtitle: "Veja receitas, despesas, contas e saldo da sua empresa.",

        relatoriosTitle: "Relatórios empresariais",
        relatoriosSubtitle: "Acompanhe desempenho, custos, entradas e saldo da empresa.",

        orcamentoTitle: "Orçamento empresarial",
        orcamentoSubtitle: "Acompanhe limites e custos operacionais.",

        contasAPagarTitle: "Contas da empresa",
        importarContaTitle: "Importar boleto, Pix ou conta da empresa",

        rendaTitle: "Faturamento",
        gastosTitle: "Despesas da empresa",

        saldoPositivoMsg: "Sua empresa manteve saldo positivo no período.",
      };
    case "pessoa_fisica":
    default:
      return {
        contas: "suas contas",
        receitas: "sua renda",
        despesas: "seus gastos",
        controle: "Controle financeiro pessoal",
        tagLabel: null,

        dashboardEyebrow: "Resumo do seu mês",
        dashboardSubtitle: "Entenda para onde seu dinheiro foi.",

        relatoriosTitle: "Relatórios pessoais",
        relatoriosSubtitle: "Entenda seus gastos e sua evolução financeira.",

        orcamentoTitle: "Orçamento do mês",
        orcamentoSubtitle: "Defina limites para organizar seus gastos.",

        contasAPagarTitle: "Contas a pagar",
        importarContaTitle: "Importar boleto, Pix ou conta",

        rendaTitle: "Receitas",
        gastosTitle: "Gastos",

        saldoPositivoMsg: "Você economizou bem este mês.",
      };
  }
}

export function tipoCadastroLabel(tipo: TipoCadastro): string {
  switch (tipo) {
    case "pessoa_fisica":
      return "Pessoa física";
    case "mei":
      return "MEI";
    case "empresa":
      return "Empresa";
    default:
      return "Não definido";
  }
}
