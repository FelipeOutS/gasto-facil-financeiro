import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface SignupEmailProps {
  siteName: string;
  siteUrl: string;
  recipient: string;
  confirmationUrl: string;
}

export const SignupEmail = ({ siteUrl, recipient, confirmationUrl }: SignupEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Confirme seu e-mail no Gasto Inteligente</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brand}>Gasto Inteligente</Text>
        </Section>
        <Heading style={h1}>Bem-vindo(a)! Confirme seu e-mail</Heading>
        <Text style={text}>
          Recebemos seu cadastro no <strong>Gasto Inteligente</strong>. Para começar a organizar
          suas finanças, confirme que este e-mail é seu:
          <br />
          <Link href={`mailto:${recipient}`} style={link}>
            {recipient}
          </Link>
        </Text>
        <Section style={{ textAlign: "center", margin: "28px 0" }}>
          <Button style={button} href={confirmationUrl}>
            Confirmar meu e-mail
          </Button>
        </Section>
        <Text style={small}>
          Se o botão não funcionar, copie e cole este link no seu navegador:
          <br />
          <Link href={confirmationUrl} style={link}>
            {confirmationUrl}
          </Link>
        </Text>
        <Hr style={hr} />
        <Text style={footer}>
          Se você não criou esta conta, pode ignorar este e-mail com tranquilidade.
        </Text>
        <Text style={footerSmall}>
          © {new Date().getFullYear()} Gasto Inteligente ·{" "}
          <Link href={siteUrl} style={footerLink}>
            gastointeligente.com.br
          </Link>
        </Text>
      </Container>
    </Body>
  </Html>
);

export default SignupEmail;

const main = {
  backgroundColor: "#f5f6f8",
  fontFamily: "Inter, Arial, sans-serif",
  margin: 0,
  padding: "24px 0",
};
const container = {
  backgroundColor: "#ffffff",
  borderRadius: "14px",
  maxWidth: "560px",
  margin: "0 auto",
  padding: "32px 36px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
};
const brandBar = { paddingBottom: "16px", borderBottom: "1px solid #eef0f3", marginBottom: "20px" };
const brand = {
  fontSize: "15px",
  fontWeight: 700 as const,
  color: "#0f1115",
  letterSpacing: "-0.01em",
  margin: 0,
};
const h1 = {
  fontSize: "22px",
  fontWeight: 700 as const,
  color: "#0f1115",
  margin: "0 0 14px",
  lineHeight: "1.3",
};
const text = { fontSize: "15px", color: "#3d4148", lineHeight: "1.6", margin: "0 0 12px" };
const small = {
  fontSize: "13px",
  color: "#5f6470",
  lineHeight: "1.55",
  margin: "12px 0 0",
  wordBreak: "break-all" as const,
};
const link = { color: "#0f62fe", textDecoration: "underline" };
const button = {
  backgroundColor: "#0f1115",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600 as const,
  borderRadius: "10px",
  padding: "13px 26px",
  textDecoration: "none",
  display: "inline-block",
};
const hr = { borderColor: "#eef0f3", margin: "28px 0 18px" };
const footer = { fontSize: "13px", color: "#5f6470", margin: "0 0 8px" };
const footerSmall = { fontSize: "12px", color: "#9095a0", margin: 0 };
const footerLink = { color: "#5f6470", textDecoration: "underline" };
