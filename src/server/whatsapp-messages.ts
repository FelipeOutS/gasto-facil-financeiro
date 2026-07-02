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

  // WA — comando de reinício geral da conversa ("cancelar", "reiniciar",
  // "recomeçar", etc.). Encerra qualquer sessão pendente e devolve uma
  // mensagem única, neutra, indicando que o usuário pode começar de novo.
  resetConversa() {
    return (
      `Tudo certo, vamos começar de novo. 👋\n\n` +
      `Posso registrar um gasto, uma renda ou mostrar um resumo das suas finanças.\n\n` +
      `Digite "ajuda" para ver exemplos.`
    );
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
    // WA-C6 — Boas-vindas reposicionando o WhatsApp como assistente
    // RÁPIDO, sem substituir o site/app (onde ficam dashboards, gráficos,
    // relatórios, Mercado Inteligente, IA, importações).
    ajuda() {
      return [
        `Oi! Eu sou o GI, assistente do Gasto Inteligente. 👋`,
        ``,
        `O Gasto Inteligente é seu app e site completos para controlar suas finanças — com dashboards, gráficos, relatórios, planejamento, Mercado Inteligente, IA e importações.`,
        ``,
        `Aqui no WhatsApp eu sou seu atalho rápido. Não substituo o site/app, mas resolvo o dia a dia em segundos.`,
        ``,
        `📌 O que deseja fazer?`,
        `1. Registrar gasto`,
        `2. Cadastrar uma conta a pagar`,
        `3. Ver contas pendentes`,
        `4. Ver contas atrasadas`,
        `5. Marcar conta como paga`,
        `6. Editar uma conta`,
        `7. Cancelar uma conta`,
        `8. Ajuda e exemplos`,
        ``,
        `Responda com o número ou descreva em poucas palavras (ex.: “Uber 29,90”, “paguei a internet”).`,
      ].join("\n");
    },

    // WA-G3 — saudação curta sem dados financeiros automáticos.
    saudacao() {
      return [
        `Oi! Eu sou o GI, assistente do Gasto Inteligente. 👋`,
        ``,
        `Sou seu atalho rápido pelo WhatsApp: registro gastos, cadastro/consulto/pago/edito/cancelo contas e tiro dúvidas rápidas.`,
        ``,
        `Para a visão completa (dashboards, relatórios, planejamento, Mercado Inteligente, IA), use o site ou o app do Gasto Inteligente.`,
        ``,
        `Digite “menu” para ver as opções ou “ajuda” para exemplos.`,
      ].join("\n");
    },

    // WA-G3 — versão curta usada quando menu/saudação acabou de ser enviado.
    menuCurto() {
      return `Você pode me enviar um gasto, pagar/criar uma conta ou pedir um resumo. Digite “menu” para ver as opções.`;
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
        `Para gráficos completos e planejamento, abra o site ou o app.`,
        ``,
        `Exemplo: “Como foi minha semana?”`,
      ].join("\n");
    },

    // WA-G3 — "cancelar" sem sessão pendente.
    cancelarSemPendencia() {
      return [
        `Não tem nada em andamento agora.`,
        ``,
        `Posso registrar um gasto, criar/pagar/editar/cancelar uma conta ou mostrar um resumo. Digite “menu” para ver as opções.`,
      ].join("\n");
    },

    // WA-C6 — ajuda contextual quando não entendemos a mensagem fora de sessão.
    ajudaContextual() {
      return [
        `Não consegui entender bem. Talvez eu possa ajudar com:`,
        ``,
        `• Registrar gasto (ex.: “Uber 29,90”)`,
        `• Criar conta (ex.: “Cadastrar internet 119,90 vence dia 5”)`,
        `• Ver pendências (“minhas contas”)`,
        `• Marcar pagamento (“paguei a internet”)`,
        `• Editar ou cancelar uma conta`,
        ``,
        `Digite “menu” para ver tudo.`,
      ].join("\n");
    },

    // WA-C6 — “ajuda” explícito: explicação + exemplos práticos (NÃO é o menu numerado).
    ajudaExemplos() {
      return [
        `💡 Posso te ajudar com tarefas rápidas pelo WhatsApp. Veja exemplos:`,
        ``,
        `📝 Registrar gasto`,
        `   • “Uber 29,90”`,
        `   • “Mercado 187,50 ontem no crédito”`,
        ``,
        `📄 Criar conta a pagar`,
        `   • “Cadastrar internet 119,90 vence dia 5”`,
        `   • “Nova conta luz 230 venc 15/07”`,
        ``,
        `💸 Marcar como paga / adiar / cancelar`,
        `   • “Paguei a internet”`,
        `   • “Adiar a luz para sexta”`,
        `   • “Cancelar a conta do streaming”`,
        ``,
        `📊 Consultar`,
        `   • “Minhas contas” • “Contas atrasadas”`,
        `   • “Resumo da semana” • “Maiores gastos do mês”`,
        ``,
        `Para a lista de opções numeradas digite “menu”. Para ver só os atalhos digite “comandos”.`,
      ].join("\n");
    },

    // WA-C6 — “comandos”: lista curta e enxuta de atalhos (sem narrativa).
    comandosLista() {
      return [
        `🔤 Comandos rápidos:`,
        ``,
        `• menu — opções numeradas (1 a 8)`,
        `• ajuda — exemplos práticos de uso`,
        `• minhas contas — pendentes`,
        `• contas atrasadas — em atraso`,
        `• próximas contas — vencimentos futuros`,
        `• resumo da semana / resumo do mês`,
        `• paguei <conta> — dar baixa`,
        `• adiar <conta> para <data> — reagendar`,
        `• cancelar — encerra o que estiver em andamento`,
      ].join("\n");
    },

    // WA-C6 — sufixo curto com próximos passos sugeridos.
    // Não muda regras: apenas anexa uma linha às respostas finais.
    sugestoesPos(acao: "gasto_salvo" | "conta_criada" | "conta_paga" | "conta_cancelada" | "conta_editada") {
      if (acao === "gasto_salvo") {
        return `Próximo passo: registre outro gasto, peça “resumo da semana” ou digite “menu”.`;
      }
      if (acao === "conta_criada") {
        return `Próximo passo: diga “minhas contas” para ver pendências, “criar outra” ou “menu”.`;
      }
      if (acao === "conta_paga") {
        return `Próximo passo: peça “próximas contas”, registre outro pagamento ou “menu”.`;
      }
      if (acao === "conta_cancelada") {
        return `Próximo passo: diga “minhas contas” ou “menu”.`;
      }
      return `Próximo passo: diga “minhas contas” ou “menu”.`;
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

    listarReceitasMes(args: {
      mes: string;
      itens: Array<{ descricao: string; tipo: string; valor: string; data: string }>;
      total: string;
      totalRegistros: number;
    }) {
      if (args.totalRegistros === 0) {
        return `Ainda não encontrei receitas registradas em ${args.mes}.`;
      }
      const linhas = [`Suas receitas de ${args.mes} 💰`, ``];
      args.itens.forEach((r, i) => {
        linhas.push(`${i + 1}. ${r.descricao} — ${r.valor} (${r.data})`);
      });
      linhas.push(``);
      if (args.totalRegistros > args.itens.length) {
        linhas.push(`Mostrando as ${args.itens.length} mais recentes de ${args.totalRegistros} no mês.`);
      }
      linhas.push(`Total recebido no mês: ${args.total}.`);
      return linhas.join("\n");
    },

    listarGastosMes(args: {
      mes: string;
      itens: Array<{ descricao: string; categoria: string; valor: string; data: string }>;
      total: string;
      totalRegistros: number;
    }) {
      if (args.totalRegistros === 0) {
        return `Ainda não encontrei gastos registrados em ${args.mes}.`;
      }
      const linhas = [`Seus gastos de ${args.mes} 💸`, ``];
      args.itens.forEach((g, i) => {
        linhas.push(`${i + 1}. ${g.descricao} — ${g.valor} (${g.data})`);
      });
      linhas.push(``);
      if (args.totalRegistros > args.itens.length) {
        linhas.push(`Mostrando os ${args.itens.length} mais recentes de ${args.totalRegistros} no mês.`);
      }
      linhas.push(`Total gasto no mês: ${args.total}.`);
      return linhas.join("\n");
    },

    gastosPorCategoriaMes(args: {
      mes: string;
      itens: Array<{ categoria: string; valor: string; quantidade: number }>;
      total: string;
      totalRegistros: number;
    }) {
      if (args.totalRegistros === 0) {
        return `Ainda não encontrei gastos registrados em ${args.mes}.`;
      }
      const linhas = [`Seus gastos por categoria em ${args.mes} 📊`, ``];
      args.itens.forEach((c, i) => {
        const plural = c.quantidade === 1 ? "lançamento" : "lançamentos";
        linhas.push(`${i + 1}. ${c.categoria} — ${c.valor} (${c.quantidade} ${plural})`);
      });
      linhas.push(``);
      linhas.push(`Total gasto no mês: ${args.total}.`);
      return linhas.join("\n");
    },
  },

  // =====================================================================
  // CONSULTAS ESPECÍFICAS (Fase WA-G4)
  // Gasto por descrição, gasto por categoria, receita por tipo, gastos
  // de ontem e quanto sobra da renda no mês. Máximo 1 emoji.
  // =====================================================================
  consultaEspecifica: {
    gastoPorDescricao(args: { descricao: string; valor: string; quantidade: number }) {
      const plural = args.quantidade === 1 ? "lançamento" : "lançamentos";
      return [
        `Neste mês, você gastou ${args.valor} com ${args.descricao}.`,
        ``,
        `Foram ${args.quantidade} ${plural} até agora.`,
      ].join("\n");
    },
    descricaoSemResultado(termo: string) {
      return `Não encontrei gastos com "${termo}" neste período.`;
    },
    gastoPorCategoria(args: { categoria: string; valor: string; quantidade: number }) {
      const plural = args.quantidade === 1 ? "lançamento" : "lançamentos";
      return [
        `Neste mês, você gastou ${args.valor} em ${args.categoria}.`,
        ``,
        `Foram ${args.quantidade} ${plural} até agora.`,
      ].join("\n");
    },
    categoriaSemResultado(categoria: string) {
      return `Não encontrei gastos em "${categoria}" neste período.`;
    },
    categoriaInexistente(termo: string) {
      return [
        `Não encontrei uma categoria chamada "${termo}" nas suas despesas.`,
        ``,
        `Você pode pedir, por exemplo: transporte, alimentação ou lazer.`,
      ].join("\n");
    },
    categoriaAmbigua(args: { termo: string; opcoes: string[] }) {
      const linhas = [
        `Encontrei mais de uma categoria parecida com "${args.termo}".`,
        ``,
        `Qual delas você quer consultar?`,
      ];
      args.opcoes.forEach((o, i) => linhas.push(`${i + 1}. ${o}`));
      return linhas.join("\n");
    },
    receitaPorTipo(args: { tipo: string; valor: string; quantidade: number }) {
      const plural = args.quantidade === 1 ? "entrada registrada" : "entradas registradas";
      return [
        `Neste mês, você recebeu ${args.valor} em ${args.tipo}.`,
        ``,
        `Foram ${args.quantidade} ${plural} até agora.`,
      ].join("\n");
    },
    receitaSemResultado(tipo: string) {
      return `Não encontrei receitas do tipo "${tipo}" neste período.`;
    },
    gastosOntem(args: {
      total: string;
      quantidade: number;
      maior: { descricao: string; valor: string };
      itens: Array<{ descricao: string; valor: string }>;
    }) {
      const linhas = [
        `Resumo de ontem 📊`,
        ``,
        `• Despesas: ${args.total}`,
        `• Lançamentos: ${args.quantidade}`,
        `• Maior gasto: ${args.maior.descricao} — ${args.maior.valor}`,
      ];
      if (args.itens.length > 0) {
        linhas.push(``);
        linhas.push(`Maiores gastos:`);
        args.itens.forEach((g, i) => {
          linhas.push(`${i + 1}. ${g.descricao} — ${g.valor}`);
        });
      }
      return linhas.join("\n");
    },
    gastosOntemSemRegistros() {
      return `Não encontrei gastos registrados ontem.`;
    },
    sobraPositiva(args: { receitas: string; despesas: string; saldo: string }) {
      return [
        `Neste mês, você recebeu ${args.receitas} e gastou ${args.despesas}.`,
        ``,
        `Até agora, sobram ${args.saldo}.`,
      ].join("\n");
    },
    sobraNegativa(args: { receitas: string; despesas: string; valorAcima: string }) {
      return [
        `Neste mês, você recebeu ${args.receitas} e gastou ${args.despesas}.`,
        ``,
        `No momento, suas despesas estão ${args.valorAcima} acima das receitas registradas.`,
      ].join("\n");
    },
    sobraSemReceitas() {
      return [
        `Ainda não há receitas registradas neste mês para calcular quanto sobra.`,
        ``,
        `Cadastre suas entradas e eu faço essa conta para você.`,
      ].join("\n");
    },
  },

  // =====================================================================
  // LEITURA DE COMPROVANTE / FOTO DE NOTA (Fase WA-G5A)
  // Reaproveita o OCR existente do site. Nunca cria gasto antes de "sim".
  // Máximo 1 emoji por mensagem.
  // =====================================================================
  imagem: {
    sessaoEmAndamento() {
      return [
        `Você já tem um lançamento em andamento.`,
        ``,
        `Envie "cancelar" para começar de novo antes de mandar uma foto.`,
      ].join("\n");
    },
    ileagivel() {
      return [
        `Não consegui ler esta nota com segurança.`,
        ``,
        `Envie uma foto mais nítida ou me escreva o gasto e o valor.`,
      ].join("\n");
    },
    apenasValor(valorFmt: string) {
      return [
        `Consegui identificar o valor de ${valorFmt}.`,
        ``,
        `Esse gasto foi de quê?`,
      ].join("\n");
    },
    apenasDescricao(descricao: string) {
      return [
        `Consegui identificar "${descricao}".`,
        ``,
        `Qual foi o valor desse gasto?`,
      ].join("\n");
    },
    resumo(args: {
      descricao: string;
      valor: string;
      dataLabel: string;
      dataValor: string;
      pagamento: string;
      categoria: string;
    }) {
      return [
        `Li esta nota 🧾`,
        ``,
        `• Descrição: ${args.descricao}`,
        `• Valor: ${args.valor}`,
        `• ${args.dataLabel}: ${args.dataValor}`,
        `• Pagamento: ${args.pagamento}`,
        `• Categoria: ${args.categoria}`,
        ``,
        `Está certo? Responda sim ou diga o que quer alterar: valor, descrição, categoria, data ou pagamento.`,
      ].join("\n");
    },
    pedirNovoValor() {
      return `Qual valor devo usar?`;
    },
    pedirNovaDescricao() {
      return `Qual descrição devo usar?`;
    },
    pedirNovaCategoria(corpoOpcoes: string) {
      return [
        `Claro. Qual categoria você quer usar?`,
        ``,
        corpoOpcoes.trim(),
      ].join("\n");
    },
    pedirNovoPagamento() {
      return [
        `Qual forma de pagamento devo usar?`,
        ``,
        `Você pode responder com Pix, cartão de crédito, cartão de débito, dinheiro ou outro.`,
      ].join("\n");
    },
    perguntaDataConfirmacao(dataFmt: string) {
      return [
        `A nota indica a data ${dataFmt}.`,
        ``,
        `Quer usar essa data ou registrar como hoje?`,
      ].join("\n");
    },
    perguntaDataIncerta() {
      return [
        `Não consegui confirmar a data da nota.`,
        ``,
        `Quer usar hoje ou informar outra data?`,
      ].join("\n");
    },
    perguntaCategoriaObrigatoria(corpoOpcoes: string) {
      return [
        `Em qual categoria esse gasto entra?`,
        ``,
        corpoOpcoes.trim(),
      ].join("\n");
    },
    categoriaNaoEncontrada() {
      return [
        `Não encontrei essa categoria.`,
        ``,
        `Você pode escolher um número da lista, digitar o nome ou escrever "ver todas".`,
      ].join("\n");
    },
    pedirNovaData() {
      return [
        `Qual data devo usar?`,
        ``,
        `Ex.: hoje, ontem ou 15/06/2026.`,
      ].join("\n");
    },
    perguntaFormaPagamento() {
      return [
        `Como você pagou esse gasto? 💳`,
        ``,
        `Você pode responder com Pix, cartão, dinheiro ou outro.`,
      ].join("\n");
    },
    salvo(args: { valor: string; descricao: string; categoria: string; pagamento: string }) {
      return [
        `Pronto! Registrei esse gasto ✅`,
        ``,
        `${args.valor} em ${args.descricao}, pago via ${args.pagamento}.`,
        `Categoria: ${args.categoria}`,
        ``,
        `Você já consegue ver esse lançamento no Gasto Inteligente.`,
      ].join("\n");
    },
    cancelado() {
      return `Tudo certo, não registrei esse gasto.`;
    },
  },

  // ---- WA-C7: Pix / favorecidos ----
  pix: {
    pedirFormato() {
      return [
        `Para salvar um Pix, me mande no formato:`,
        ``,
        `• "salva o Pix do João: 11999999999"`,
        `• "Pix da Maria é maria@email.com"`,
        `• "cadastra Pix do Pedro CPF 123.456.789-00"`,
      ].join("\n");
    },
    salvo(args: { nome: string; tipo: string }) {
      return `Pronto! Salvei o Pix de ${args.nome} (${args.tipo}). ✅`;
    },
    atualizado(args: { nome: string; tipo: string }) {
      return `Atualizei o Pix de ${args.nome} para ${args.tipo}. ✅`;
    },
    favorecidoNaoEncontrado(nome: string) {
      return [
        `Não encontrei "${nome}" entre seus favorecidos.`,
        ``,
        `Quer cadastrar agora? Me mande, por exemplo:`,
        `"salva o Pix do ${nome}: chave-aqui"`,
      ].join("\n");
    },
    semPixCadastrado(nome: string) {
      return [
        `Tenho ${nome} aqui, mas ainda sem chave Pix cadastrada.`,
        ``,
        `Me mande a chave: "Pix do ${nome} é ..."`,
      ].join("\n");
    },
    /**
     * WA-PIX-UX-01.c — Corpo da consulta única.
     *
     * Quando `copiarUrl` é fornecido, o corpo NÃO contém a URL: ela vai no
     * botão CTA da mensagem `interactive`. Se o envio interativo falhar, o
     * `sendWhatsAppReply` do fallback usa `consultaUnicaTextoFallback`
     * (abaixo), que inclui a URL como texto.
     */
    consultaUnicaBody(args: { nome: string; tipo: string; chave: string }) {
      return [
        `Favorecido: ${args.nome}`,
        `Chave Pix: ${args.tipo}`,
        args.chave,
        ``,
        `Toque no botão abaixo para copiar a chave completa em um toque. Link seguro, expira em 10 min.`,
      ].join("\n");
    },
    consultaUnica(args: {
      nome: string;
      tipo: string;
      chave: string;
      copiarUrl?: string | null;
    }) {
      const linhas = [
        `Favorecido: ${args.nome}`,
        `Chave Pix: ${args.tipo}`,
        args.chave,
        ``,
      ];
      if (args.copiarUrl) {
        linhas.push(
          `Copiar chave Pix (link seguro, expira em 10 min):`,
          args.copiarUrl,
        );
      } else {
        linhas.push(`Para copiar a chave completa, abra no Gasto Inteligente.`);
      }
      return linhas.join("\n");
    },
    ambiguidade(args: { termo: string; nomes: string[] }) {
      const linhas = args.nomes.map((n, i) => `${i + 1}. ${n}`).join("\n");
      return [
        `Tenho mais de uma pessoa parecida com "${args.termo}":`,
        ``,
        linhas,
        ``,
        `Me diga o nome completo de quem você quer.`,
      ].join("\n");
    },
    pagamentoSalvo(args: { valor: string; nome: string; descricao: string | null }) {
      const desc = args.descricao ? ` (${args.descricao})` : "";
      return [
        `Anotado! ${args.valor} pago para ${args.nome}${desc}. ✅`,
        ``,
        `Já está registrado no Gasto Inteligente.`,
      ].join("\n");
    },
  },

  // ---- WA-C10.b: boleto por foto/PDF ----
  boletoMidia: {
    nenhumCandidato() {
      return [
        `Não consegui ler este boleto com segurança.`,
        ``,
        `Tente enviar uma imagem mais nítida, um PDF original ou copie a linha digitável aqui.`,
      ].join("\n");
    },
    multiplosCandidatos(opts: Array<{ mascara: string; valor?: string; venc?: string }>) {
      const linhas = [
        `Encontrei mais de um boleto válido neste arquivo. Qual você quer cadastrar?`,
        ``,
      ];
      opts.forEach((o, i) => {
        const extras = [o.valor, o.venc].filter(Boolean).join(" • ");
        linhas.push(`${i + 1}. Boleto final ${o.mascara}${extras ? ` (${extras})` : ""}`);
      });
      linhas.push(`${opts.length + 1}. Nenhum deles`);
      return linhas.join("\n");
    },
    fallbackManual(args: { valor?: string; venc?: string }) {
      const linhas = [
        `Encontrei possivelmente:`,
        ``,
      ];
      if (args.valor) linhas.push(`• Valor: ${args.valor}`);
      if (args.venc) linhas.push(`• Vencimento: ${args.venc}`);
      if (!args.valor && !args.venc) linhas.push(`• (nenhum dado confiável)`);
      linhas.push(
        ``,
        `Não consegui validar a linha digitável.`,
        `Deseja cadastrar como uma conta a pagar manual?`,
        ``,
        `1. Confirmar dados`,
        `2. Corrigir valor`,
        `3. Corrigir vencimento`,
        `4. Digitar a linha do boleto`,
        `5. Cancelar`,
      );
      return linhas.join("\n");
    },
    pdfMuitasPaginas() {
      return `Esse PDF tem páginas demais. Envie só a página do boleto.`;
    },
    pdfInvalido() {
      return `Não consegui abrir este PDF. Pode reenviar o boleto original?`;
    },
    indisponivel() {
      return `A leitura por imagem/PDF está indisponível agora. Tente novamente em alguns minutos ou cole a linha digitável.`;
    },
    rateLimited() {
      return `Não consegui analisar esse arquivo agora. Você pode copiar a linha digitável aqui ou tentar novamente mais tarde.`;
    },
    arquivoMuitoGrande() {
      return `Esse arquivo é grande demais para análise. Envie uma imagem mais leve, um PDF menor ou copie a linha digitável.`;
    },
  },
};
