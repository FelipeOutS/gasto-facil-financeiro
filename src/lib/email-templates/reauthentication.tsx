import * as React from "react";
import {
  Body,
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

interface ReauthenticationEmailProps {
  token: string;
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Seu código de verificação — Gasto Inteligente</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brand}>Gasto Inteligente</Text>
        </Section>
        <Heading style={h1}>Confirme sua identidade</Heading>
        <Text style={text}>Use o código abaixo para confirmar sua identidade:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Hr style={hr} />
        <Text style={footer}>
          Este código expira em breve. Se você não solicitou isso, pode ignorar este e-mail.
        </Text>
        <Text style={footerSmall}>
          © {new Date().getFullYear()} Gasto Inteligente ·{" "}
          <Link href="https://gastointeligente.com.br" style={footerLink}>
            gastointeligente.com.br
          </Link>
        </Text>
      </Container>
    </Body>
  </Html>
);

export default ReauthenticationEmail;

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
const codeStyle = {
  fontFamily: "Courier, monospace",
  fontSize: "28px",
  fontWeight: 700 as const,
  color: "#0f1115",
  letterSpacing: "4px",
  textAlign: "center" as const,
  padding: "16px",
  backgroundColor: "#f5f6f8",
  borderRadius: "10px",
  margin: "20px 0",
};
const hr = { borderColor: "#eef0f3", margin: "28px 0 18px" };
const footer = { fontSize: "13px", color: "#5f6470", margin: "0 0 8px" };
const footerSmall = { fontSize: "12px", color: "#9095a0", margin: 0 };
const footerLink = { color: "#5f6470", textDecoration: "underline" };
