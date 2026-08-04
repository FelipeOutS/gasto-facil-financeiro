/**
 * Normaliza mensagens de erro técnicas (Supabase/Postgres/network) em
 * mensagens amigáveis e acionáveis para o usuário final.
 *
 * Usado pelas filas offline de gastos e receitas. Nunca exibimos a
 * mensagem técnica diretamente — guardamos em `technical_error` para
 * depuração, e exibimos apenas `friendly`.
 */

export type OfflineFriendlyError = {
  /** Mensagem amigável e acionável para o usuário. */
  friendly: string;
  /** Mensagem técnica original (para logs/depuração). */
  technical: string;
};

const GENERIC = "Não foi possível sincronizar esta pendência. Revise os dados e tente novamente.";

const CONNECTION = "Não foi possível sincronizar agora. Verifique sua conexão e tente novamente.";

const PERMISSION =
  "Não foi possível sincronizar por falta de permissão. Entre novamente na conta e tente de novo.";

const FK_CATEGORIA =
  "Não foi possível sincronizar porque a categoria usada não existe mais. Edite a pendência e escolha outra categoria.";

const FK_CARTAO =
  "Não foi possível sincronizar porque o cartão selecionado não existe mais. Edite a pendência e escolha outro cartão ou forma de pagamento.";

const FK_CLIENTE =
  "Não foi possível sincronizar porque o cliente selecionado não está mais disponível. Edite a pendência e escolha outro cliente.";

export function normalizeOfflineError(raw: unknown): OfflineFriendlyError {
  const technical =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string"
        ? raw
        : raw == null
          ? ""
          : (() => {
              try {
                return JSON.stringify(raw);
              } catch {
                return String(raw);
              }
            })();

  const t = technical.toLowerCase();

  // Conexão / rede / offline
  if (
    t.includes("failed to fetch") ||
    t.includes("networkerror") ||
    t.includes("network error") ||
    t.includes("network request failed") ||
    t.includes("load failed") ||
    t.includes("offline") ||
    t.includes("err_internet_disconnected") ||
    t.includes("err_network") ||
    t.includes("timeout") ||
    t.includes("timed out")
  ) {
    return { friendly: CONNECTION, technical };
  }

  // Permissão / autenticação / RLS
  if (
    t.includes("row-level security") ||
    t.includes("row level security") ||
    t.includes("rls") ||
    t.includes("permission denied") ||
    t.includes("not authorized") ||
    t.includes("unauthorized") ||
    t.includes("jwt") ||
    t.includes("invalid token") ||
    t.includes("token expired") ||
    t.includes("auth session missing") ||
    t.includes("42501")
  ) {
    return { friendly: PERMISSION, technical };
  }

  // Foreign key violations (23503) — tenta identificar a entidade
  const isFk =
    t.includes("foreign key") ||
    t.includes("violates foreign key") ||
    t.includes("23503") ||
    t.includes("is not present in table");

  if (isFk) {
    if (t.includes("categoria") || t.includes("category") || t.includes("categoria_id")) {
      return { friendly: FK_CATEGORIA, technical };
    }
    if (
      t.includes("cartao") ||
      t.includes("cartão") ||
      t.includes("card") ||
      t.includes("cartao_id") ||
      t.includes("card_id")
    ) {
      return { friendly: FK_CARTAO, technical };
    }
    if (t.includes("cliente") || t.includes("client") || t.includes("cliente_id")) {
      return { friendly: FK_CLIENTE, technical };
    }
    return { friendly: GENERIC, technical };
  }

  return { friendly: GENERIC, technical };
}
