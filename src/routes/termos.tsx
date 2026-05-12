import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/landing/LegalLayout";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de uso — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Termos de uso do Gasto Inteligente — regras gerais para utilização da plataforma de controle financeiro.",
      },
      { property: "og:title", content: "Termos de uso — Gasto Inteligente" },
      {
        property: "og:description",
        content: "Termos de uso da plataforma Gasto Inteligente.",
      },
    ],
  }),
  component: TermosPage,
});

function TermosPage() {
  return (
    <LegalLayout title="Termos de uso" updatedAt="12 de maio de 2026">
      <p>
        Estes Termos de uso descrevem, de forma simples e em português do
        Brasil, as condições gerais para utilização da plataforma{" "}
        <strong>Gasto Inteligente</strong> (“plataforma”, “serviço” ou “app”).
        Ao criar uma conta ou utilizar o serviço, você concorda com este
        documento.
      </p>

      <h2>1. Sobre o serviço</h2>
      <p>
        O Gasto Inteligente é uma plataforma de controle financeiro pessoal e
        para pequenos negócios (MEI e empresa). Ele ajuda a organizar gastos,
        cartões, contas a pagar e receber, metas, renda e relatórios em um só
        lugar, com visão simples e visual.
      </p>
      <p>
        O serviço é uma ferramenta de organização financeira e{" "}
        <strong>não substitui</strong> a atuação de contador, advogado ou
        consultor financeiro.
      </p>

      <h2>2. Conta de usuário</h2>
      <ul>
        <li>Você é responsável pelas informações cadastradas na sua conta.</li>
        <li>Mantenha sua senha em local seguro e não compartilhe acessos.</li>
        <li>Em caso de uso indevido, entre em contato pelo nosso e-mail.</li>
      </ul>

      <h2>3. Planos e pagamentos</h2>
      <p>
        Os planos comerciais são exibidos na página de planos da plataforma.
        Você pode evoluir, reduzir ou cancelar o plano a qualquer momento. Não
        há fidelidade obrigatória.
      </p>

      <h2>4. Uso adequado</h2>
      <p>
        Você se compromete a utilizar a plataforma de boa-fé, sem tentativas
        de fraude, engenharia reversa, abuso de API ou prejuízo a terceiros.
        Reservamo-nos o direito de suspender contas que violem estas regras.
      </p>

      <h2>5. Disponibilidade</h2>
      <p>
        O serviço é oferecido “como está” e pode passar por atualizações,
        manutenções e melhorias. Buscamos a maior disponibilidade possível,
        mas não garantimos funcionamento contínuo e ininterrupto.
      </p>

      <h2>6. Alterações destes termos</h2>
      <p>
        Estes termos podem ser atualizados para refletir melhorias do serviço
        ou exigências legais. Mudanças relevantes serão comunicadas por meio
        da própria plataforma ou por e-mail.
      </p>

      <h2>7. Contato</h2>
      <p>
        Para dúvidas sobre estes termos, escreva para{" "}
        <a href="mailto:contato@gastointeligente.com.br">
          contato@gastointeligente.com.br
        </a>
        .
      </p>
    </LegalLayout>
  );
}
