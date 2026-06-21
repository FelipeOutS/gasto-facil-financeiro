/**
 * Camada centralizada de textos do fluxo de gastos via WhatsApp do Gasto
 * Inteligente. Não muda regras de negócio, parser, sessão ou validações —
 * apenas concentra o tom das mensagens enviadas ao usuário.
 *
 * Regras de tom:
 *  - Linguagem brasileira informal-profissional, prestativa e direta.
 *  - No máximo 1 emoji por mensagem; nunca em mensagens de erro crítico
 *    ou bloqueio. Emojis permitidos: ✅, 💳, 📅, 🎯, 👀, 😅.
 *  - Não inserir emojis dentro de variáveis (valores, datas, nomes de
 *    cartões/categorias) — eles vão apenas no texto fixo.
 *  - Frases curtas; bullets só no resumo de confirmação.
 */

export const whatsappMessages = {
  // ---- forma de pagamento ----
  perguntaFormaPagamento(valorFmt: string, nome: string) {
    return (
      `Boa! Anotei ${valorFmt} em ${nome}. 💳\n\n` +
      `Como você pagou esse gasto? Responda com: Pix, dinheiro, débito ou cartão.`
    );
  },

  // ---- cartão ----
  perguntaCartao(listaCartoes: string) {
    return (
      `Certo! Qual cartão você usou? 💳\n` +
      `${listaCartoes}\n\n` +
      `Responda com o nome do cartão ou escolha uma opção acima.`
    );
  },

  avisoCartaoAmbiguo(nomes: string[]) {
    return (
      `Encontrei mais de um cartão parecido:\n` +
      `${nomes.map((n) => `• ${n}`).join("\n")}\n` +
      `Me diga o nome exato (ou os últimos 4 dígitos).`
    );
  },

  avisoCartaoNaoCadastrado(digitado: string, valorFmt: string, nome: string, dataFmt: string) {
    return (
      `Não encontrei "${digitado}" entre os seus cartões cadastrados.\n` +
      `Sem problema — posso registrar como cartão não cadastrado e você ajusta depois na área Cartões.\n\n` +
      `Confirma o gasto de ${valorFmt} em ${nome}, ${dataFmt}, pago com cartão não cadastrado? Responda sim ou não.`
    );
  },

  avisoCartaoNaoCadastradoNegado(valorFmt: string, nome: string, dataFmt: string) {
    return (
      `Não encontrei nenhum dos seus cartões cadastrados para esse gasto.\n` +
      `Sem problema — vou deixar como cartão não cadastrado. Você poderá vincular ou ajustar depois na área Cartões.\n\n` +
      `Confirma o gasto de ${valorFmt} em ${nome}, ${dataFmt}, pago com cartão não cadastrado? Responda sim ou não.`
    );
  },

  // ---- confirmação ----
  resumoConfirmacao(args: {
    descricao: string;
    categoria: string;
    valor: string;
    data: string;
    pagamento: string;
    parcelas?: number;
  }) {
    const linhas = [
      `Confere pra mim? 👀`,
      ``,
      `• Descrição: ${args.descricao}`,
      `• Categoria: ${args.categoria}`,
      `• Valor: ${args.valor}`,
      `• Data: ${args.data}`,
      `• Pagamento: ${args.pagamento}`,
    ];
    if (args.parcelas && args.parcelas > 1) {
      linhas.push(`• Parcelas: ${args.parcelas}x`);
    }
    linhas.push(``);
    linhas.push(`Posso registrar? Responda sim ou não.`);
    return linhas.join("\n");
  },

  // ---- respostas finais ----
  gastoSalvo(valorFmt: string, descricao: string, categoria: string, ondePagou: string) {
    return (
      `Pronto! Seu gasto foi registrado ✅\n\n` +
      `${valorFmt} em ${descricao}, pago via ${ondePagou}.\n` +
      `Categoria: ${categoria}\n\n` +
      `Você já consegue ver esse lançamento no Gasto Inteligente.`
    );
  },

  gastoCancelado() {
    return `Tudo certo, não registrei esse gasto.`;
  },

  // ---- erros e edge cases ----
  naoEntendiSimNao() {
    // Mantemos "Não entendi" para preservar contratos de teste e clareza.
    return (
      `Não entendi essa parte 😅\n\n` +
      `Você confirma esse gasto? Responda sim ou não.`
    );
  },

  semPendencia() {
    return (
      `Não há nenhum gasto aguardando confirmação no momento. ` +
      `Me envie o gasto, ex.: "Mercado 48,90 hoje no Nubank".`
    );
  },

  faltaForma(perguntaForma: string) {
    return `Ainda preciso saber a forma de pagamento.\n${perguntaForma}`;
  },

  faltaDescricaoEValor() {
    return (
      `Claro! Me diga o gasto e o valor. 💸\n\n` +
      `Ex.: Uber R$ 48,90`
    );
  },

  faltaValor(descricao?: string) {
    const ref = descricao && descricao.trim().length > 0 ? descricao.trim() : "esse gasto";
    return (
      `Qual foi o valor de ${ref}?\n\n` +
      `Ex.: R$ 48,90`
    );
  },

  faltaNome() {
    return (
      `Esse valor foi de quê?\n\n` +
      `Ex.: Uber, mercado ou restaurante.`
    );
  },

  // WA — usado quando já existe sessão de gasto pendente aguardando
  // descrição e valor e o usuário envia uma mensagem que não traz nem
  // descrição nem valor (ex.: "oi", "ajuda", "menu").
  aguardandoGastoEValor() {
    return (
      `Ainda estou aguardando o gasto e o valor.\n\n` +
      `Ex.: Uber R$ 48,90`
    );
  },

  cartaoNaoEncontradoNoParse(digitado: string, listaCartoes: string) {
    return (
      `❓ Não encontrei o cartão "${digitado}" cadastrado.${listaCartoes}\n` +
      `Me diga o nome certo do cartão ou cadastre um novo no app antes de confirmar.`
    );
  },

  // ---- erros críticos (sem emoji por regra) ----
  erroAoSalvar() {
    return `Tive um probleminha ao salvar agora. Tente novamente em alguns instantes.`;
  },

  // =====================================================================
  // RECEITAS / RENDAS (Fase WA-G1)
  // =====================================================================
  receita: {
    perguntaTipo() {
      return (
        `Claro! Que tipo de renda foi essa? 💰\n\n` +
        `Ex.: salário, freelancer, venda, comissão ou outro.`
      );
    },
    perguntaValor() {
      return `Perfeito. Qual valor você recebeu?`;
    },
    perguntaRecorrencia() {
      return (
        `Esse valor costuma entrar de forma recorrente?\n\n` +
        `Responda sim ou não.`
      );
    },
    perguntaFrequencia() {
      return (
        `Com que frequência essa renda costuma entrar?\n\n` +
        `Ex.: todo mês, toda semana ou a cada 15 dias.`
      );
    },
    perguntaDiaMes() {
      return `Em qual dia do mês ela costuma cair?`;
    },
    perguntaDiaSemana() {
      return `Em qual dia da semana ela costuma entrar?`;
    },
    frequenciaInvalida() {
      return (
        `Não consegui entender a frequência 😅\n\n` +
        `Você pode responder, por exemplo: todo mês, toda semana ou a cada 15 dias.`
      );
    },
    diaMesInvalido() {
      return `Não consegui entender o dia. Me diga um número entre 1 e 31.`;
    },
    diaSemanaInvalido() {
      return (
        `Não consegui entender o dia. Tente segunda, terça, quarta, quinta, sexta, sábado ou domingo.`
      );
    },
    valorInvalido() {
      return `Não consegui identificar o valor. Me diga um número, ex.: 1500 ou R$ 350,00.`;
    },
    perguntaCategoria() {
      return (
        `Em qual categoria essa renda entra?\n\n` +
        `Ex.: salário, freelancer, vendas, comissão ou outra.`
      );
    },
    resumoConfirmacao(args: {
      descricao: string;
      tipo: string;
      valor: string;
      data: string;
      resumoRecorrencia: string;
    }) {
      return [
        `Confere pra mim? 👀`,
        ``,
        `• Descrição: ${args.descricao}`,
        `• Tipo de receita: ${args.tipo}`,
        `• Valor: ${args.valor}`,
        `• Data: ${args.data}`,
        `• Recorrente: ${args.resumoRecorrencia}`,
        ``,
        `Posso registrar? Responda sim ou não.`,
      ].join("\n");
    },
    salvaSimples(args: { valor: string; descricao: string; tipo: string }) {
      return (
        `Pronto! Sua renda foi registrada ✅\n\n` +
        `${args.valor} em ${args.descricao}.\n` +
        `Tipo de receita: ${args.tipo}\n\n` +
        `Você já consegue vê-la no Gasto Inteligente.`
      );
    },
    salvaRecorrente(args: {
      valor: string;
      descricao: string;
      resumoRecorrencia: string;
    }) {
      return (
        `Pronto! Sua renda recorrente foi registrada ✅\n\n` +
        `${args.valor} em ${args.descricao}.\n` +
        `Frequência: ${args.resumoRecorrencia}\n\n` +
        `Você já consegue acompanhar isso no Gasto Inteligente.`
      );
    },
    cancelado() {
      return `Tudo certo, não registrei essa renda.`;
    },
    naoEntendiSimNao() {
      return (
        `Não entendi essa parte 😅\n\n` +
        `Posso registrar essa renda? Responda sim ou não.`
      );
    },
    quotaExcedida() {
      return (
        `Você atingiu o limite mensal de receitas do seu plano. ` +
        `Faça upgrade no app para continuar lançando.`
      );
    },
    recorrenteIndisponivel() {
      return (
        `Receitas recorrentes estão disponíveis nos planos pagos. ` +
        `Posso registrar como renda única? Responda sim ou não.`
      );
    },
    erroAoSalvar() {
      return `Tive um probleminha ao salvar a renda. Tente novamente em alguns instantes.`;
    },
  },

  // =====================================================================
  // CONSULTAS FINANCEIRAS (Fase WA-G2)
  // Apelido curto "GI" usado só em mensagens de ajuda/boas-vindas.
  // Máximo 1 emoji por mensagem.
  // =====================================================================
  consulta: {
    ajuda() {
      return [
        `Oi! Eu sou o GI, assistente do Gasto Inteligente. 👋`,
        ``,
        `Posso te ajudar com:`,
        ``,
        `• Registrar gasto`,
        `• Registrar renda`,
        `• Resumo da semana`,
        `• Resumo do mês`,
        `• Maiores gastos`,
        `• Impacto dos gastos na renda`,
        ``,
        `Exemplos:`,
        `“Uber 29,90”`,
        `“Recebi 500 de freelancer”`,
        `“Como foi minha semana?”`,
        `“Quais foram meus maiores gastos?”`,
      ].join("\n");
    },

    // WA-G3 — saudação curta sem dados financeiros automáticos.
    saudacao() {
      return [
        `Oi! Eu sou o GI, assistente do Gasto Inteligente. 👋`,
        ``,
        `Posso registrar gastos e rendas ou mostrar um resumo das suas finanças.`,
        ``,
        `Digite “ajuda” para ver exemplos.`,
      ].join("\n");
    },

    // WA-G3 — versão curta usada quando menu/saudação acabou de ser enviado.
    menuCurto() {
      return `Você pode me enviar um gasto, uma renda ou pedir um resumo das suas finanças.`;
    },

    // WA-G3 — pedido financeiro genérico ("quero ver minhas finanças").
    financasGenerico() {
      return [
        `Claro! O que você quer consultar? 📊`,
        ``,
        `• Resumo da semana`,
        `• Resumo do mês`,
        `• Maiores gastos`,
        `• Impacto dos gastos na renda`,
        ``,
        `Exemplo:`,
        `“Como foi minha semana?”`,
      ].join("\n");
    },

    // WA-G3 — "cancelar" sem sessão pendente.
    cancelarSemPendencia() {
      return [
        `Não tem nada em andamento agora.`,
        ``,
        `Posso registrar um gasto, uma renda ou mostrar um resumo das suas finanças.`,
      ].join("\n");
    },


    resumoSemana(args: {
      receitas: string;
      despesas: string;
      saldo: string;
      maiorGrupo: { nome: string; valor: string } | null;
    }) {
      const linhas = [
        `Resumo dos últimos 7 dias 📊`,
        ``,
        `• Receitas: ${args.receitas}`,
        `• Despesas: ${args.despesas}`,
        `• Saldo do período: ${args.saldo}`,
      ];
      linhas.push(``);
      if (args.maiorGrupo) {
        linhas.push(
          `Seu maior grupo de gastos foi ${args.maiorGrupo.nome}: ${args.maiorGrupo.valor}.`,
        );
      } else {
        linhas.push(`Ainda não encontrei gastos registrados nesse período.`);
      }
      return linhas.join("\n");
    },

    resumoMes(args: {
      mes: string;
      receitas: string;
      despesas: string;
      saldo: string;
      percentual: number | null;
    }) {
      const linhas = [
        `Resumo de ${args.mes} 📊`,
        ``,
        `• Receitas: ${args.receitas}`,
        `• Despesas: ${args.despesas}`,
        `• Saldo atual: ${args.saldo}`,
        ``,
      ];
      if (args.percentual === null) {
        linhas.push(
          `Ainda não há receitas registradas suficientes para calcular essa comparação.`,
        );
      } else {
        linhas.push(`Você já usou ${args.percentual}% das suas receitas registradas.`);
      }
      return linhas.join("\n");
    },

    maioresGastos(args: {
      escopo: "semana" | "mes";
      itens: Array<{ descricao: string; valor: string }>;
      total: string;
    }) {
      const periodoLabel = args.escopo === "semana"
        ? "dos últimos 7 dias"
        : "deste mês";
      if (args.itens.length === 0) {
        return args.escopo === "semana"
          ? `Ainda não encontrei gastos registrados nos últimos 7 dias.`
          : `Ainda não encontrei gastos registrados neste mês.`;
      }
      const linhas = [`Seus maiores gastos ${periodoLabel} foram:`, ``];
      args.itens.forEach((g, i) => {
        linhas.push(`${i + 1}. ${g.descricao} — ${g.valor}`);
      });
      linhas.push(``);
      const rotulo = args.itens.length === 1
        ? `Total: ${args.total}.`
        : `Total dos ${args.itens.length} maiores: ${args.total}.`;
      linhas.push(rotulo);
      return linhas.join("\n");
    },

    impactoComReceita(args: {
      receitas: string;
      despesas: string;
      saldo: string;
      percentual: number;
    }) {
      return [
        `Neste mês, você registrou ${args.receitas} em receitas e ${args.despesas} em despesas.`,
        ``,
        `Isso representa ${args.percentual}% da sua renda registrada.`,
        ``,
        `Até agora, sobram ${args.saldo}.`,
      ].join("\n");
    },

    impactoSemReceita() {
      return [
        `Ainda não há receitas registradas neste mês para calcular o impacto das despesas.`,
        ``,
        `Cadastre suas entradas e eu faço essa comparação para você.`,
      ].join("\n");
    },
  },
};
