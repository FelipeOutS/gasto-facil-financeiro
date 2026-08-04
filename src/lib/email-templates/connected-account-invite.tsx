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
import type { TemplateEntry } from "./registry";

interface ConnectedAccountInviteProps {
  inviterName?: string;
  accessLevel?: string;
  inviteUrl: string;
}

const ACCESS_LABELS: Record<string, string> = {
  view: "somente visualizar",
  view_create: "visualizar e lançar movimentações",
  admin: "administrador da conta",
};

const ConnectedAccountInviteEmail = ({
  inviterName,
  accessLevel,
  inviteUrl,
}: ConnectedAccountInviteProps) => {
  const accessLabel = accessLevel ? ACCESS_LABELS[accessLevel] || accessLevel : null;
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>Você foi convidado(a) para acompanhar uma conta no Gasto Inteligente</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={brandBar}>
            <Text style={brand}>Gasto Inteligente</Text>
          </Section>
          <Heading style={h1}>Você recebeu um convite</Heading>
          <Text style={text}>
            {inviterName ? (
              <>
                <strong>{inviterName}</strong> te convidou
              </>
            ) : (
              "Você foi convidado(a)"
            )}{" "}
            para acompanhar uma conta no <strong>Gasto Inteligente</strong>.
            {accessLabel ? (
              <>
                {" "}
                O nível de acesso definido é <strong>{accessLabel}</strong>.
              </>
            ) : null}
          </Text>
          <Section style={{ textAlign: "center", margin: "28px 0" }}>
            <Button style={button} href={inviteUrl}>
              Aceitar convite
            </Button>
          </Section>
          <Text style={small}>
            Se o botão não funcionar, copie e cole este link no navegador:
            <br />
            <Link href={inviteUrl} style={link}>
              {inviteUrl}
            </Link>
          </Text>
          <Hr style={hr} />
          <Text style={footer}>Se você não esperava este convite, basta ignorar este e-mail.</Text>
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
};

export const template = {
  component: ConnectedAccountInviteEmail,
  subject: "Convite para acompanhar uma conta no Gasto Inteligente",
  displayName: "Convite de conta conectada",
  previewData: {
    inviterName: "Maria Silva",
    accessLevel: "view_create",
    inviteUrl: "https://gastointeligente.com.br/aceitar-convite/exemplo",
  },
} satisfies TemplateEntry;

export default ConnectedAccountInviteEmail;

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
