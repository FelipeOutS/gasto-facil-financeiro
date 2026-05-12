import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/landing/LegalLayout";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de privacidade — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Como o Gasto Inteligente coleta, usa e protege seus dados pessoais e financeiros.",
      },
      { property: "og:title", content: "Política de privacidade — Gasto Inteligente" },
      {
        property: "og:description",
        content: "Como cuidamos dos seus dados no Gasto Inteligente.",
      },
    ],
  }),
  component: PrivacidadePage,
});

function PrivacidadePage() {
  return (
    <LegalLayout title="Política de privacidade" updatedAt="12 de maio de 2026">
      <p>
        Esta Política explica, de forma clara, como o{" "}
        <strong>Gasto Inteligente</strong> coleta, usa e protege as
        informações dos usuários da plataforma. É um conteúdo informativo
        inicial e pode ser atualizado conforme o serviço evolui.
      </p>

      <h2>1. Quais dados coletamos</h2>
      <ul>
        <li>
          <strong>Dados de cadastro:</strong> nome, e-mail e dados básicos
          informados por você.
        </li>
        <li>
          <strong>Dados financeiros lançados por você:</strong> gastos,
          receitas, contas, metas, cartões, clientes, fornecedores e demais
          informações que você registra na plataforma.
        </li>
        <li>
          <strong>Dados técnicos:</strong> informações de acesso (data,
          dispositivo, navegador) usadas para segurança e melhoria do serviço.
        </li>
      </ul>

      <h2>2. Como usamos seus dados</h2>
      <ul>
        <li>Para prestar o serviço de organização financeira.</li>
        <li>Para gerar relatórios, gráficos e visões pedidas por você.</li>
        <li>Para enviar comunicações importantes sobre a sua conta.</li>
        <li>Para garantir a segurança e o bom funcionamento da plataforma.</li>
      </ul>

      <h2>3. Compartilhamento</h2>
      <p>
        Não vendemos seus dados. Podemos compartilhar informações apenas com
        provedores de tecnologia necessários para o funcionamento do serviço
        (como hospedagem, e-mail e processamento de pagamentos), sempre dentro
        do mínimo necessário.
      </p>

      <h2>4. Segurança</h2>
      <p>
        Adotamos boas práticas de segurança, como conexão criptografada
        (HTTPS), controle de acesso por autenticação e backups automáticos.
        Nenhum sistema é 100% imune, mas trabalhamos continuamente para
        proteger seus dados.
      </p>

      <h2>5. Seus direitos</h2>
      <ul>
        <li>Acessar e corrigir seus dados pessoais.</li>
        <li>Solicitar a exclusão da sua conta a qualquer momento.</li>
        <li>Pedir esclarecimentos sobre o uso dos seus dados.</li>
      </ul>

      <h2>6. Cookies</h2>
      <p>
        Utilizamos apenas cookies essenciais para manter sua sessão ativa e
        garantir o funcionamento básico da plataforma.
      </p>

      <h2>7. Contato</h2>
      <p>
        Para exercer seus direitos ou tirar dúvidas, entre em contato pelo
        e-mail{" "}
        <a href="mailto:contato@gastointeligente.com.br">
          contato@gastointeligente.com.br
        </a>
        .
      </p>
    </LegalLayout>
  );
}
