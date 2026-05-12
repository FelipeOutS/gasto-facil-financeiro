import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/landing/LegalLayout";

export const Route = createFileRoute("/lgpd")({
  head: () => ({
    meta: [
      { title: "LGPD — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Como o Gasto Inteligente trata os dados pessoais à luz da Lei Geral de Proteção de Dados.",
      },
      { property: "og:title", content: "LGPD — Gasto Inteligente" },
      {
        property: "og:description",
        content: "Compromisso do Gasto Inteligente com a LGPD.",
      },
    ],
  }),
  component: LgpdPage,
});

function LgpdPage() {
  return (
    <LegalLayout title="LGPD — Lei Geral de Proteção de Dados" updatedAt="12 de maio de 2026">
      <p>
        O <strong>Gasto Inteligente</strong> respeita a Lei Geral de Proteção
        de Dados (Lei nº 13.709/2018) e busca aplicar boas práticas de
        privacidade e segurança no tratamento das informações dos usuários.
        Este conteúdo é um resumo informativo inicial.
      </p>

      <h2>1. Princípios que seguimos</h2>
      <ul>
        <li>
          <strong>Finalidade:</strong> usamos seus dados apenas para os fins
          descritos na Política de privacidade.
        </li>
        <li>
          <strong>Necessidade:</strong> coletamos somente o que é necessário
          para prestar o serviço.
        </li>
        <li>
          <strong>Transparência:</strong> explicamos de forma simples como
          tratamos seus dados.
        </li>
        <li>
          <strong>Segurança:</strong> aplicamos medidas técnicas e
          organizacionais para proteger as informações.
        </li>
      </ul>

      <h2>2. Direitos do titular</h2>
      <p>Como titular dos dados, você pode solicitar:</p>
      <ul>
        <li>Confirmação da existência de tratamento dos seus dados.</li>
        <li>Acesso e correção das informações.</li>
        <li>Exclusão da conta e dos dados pessoais.</li>
        <li>Informações sobre uso e compartilhamento.</li>
      </ul>

      <h2>3. Como exercer seus direitos</h2>
      <p>
        Envie um e-mail para{" "}
        <a href="mailto:contato@gastointeligente.com.br">
          contato@gastointeligente.com.br
        </a>{" "}
        com o assunto “LGPD” e o pedido desejado. Responderemos no menor prazo
        possível.
      </p>

      <h2>4. Encarregado de dados</h2>
      <p>
        O contato para assuntos relacionados à proteção de dados é o e-mail
        acima. À medida que a operação evoluir, designaremos formalmente um
        encarregado (DPO) e atualizaremos esta página.
      </p>
    </LegalLayout>
  );
}
