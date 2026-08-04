import { mock } from "bun:test";
import { state } from "./_whatsapp-fake";

export function setupWhatsAppAuthMock(overrides: { 
  isAdmin?: boolean; 
  hasFeature?: boolean; 
  hasBeta?: boolean;
  planTier?: string;
  planActive?: boolean;
} = {}) {
  mock.module("@/server/admin-master.server", () => ({
    hasAdminMasterRole: async () => overrides.isAdmin ?? false,
  }));

  mock.module("@/server/subscription.server", () => ({
    getSubscriptionForUserIdentity: async () => ({
      active: overrides.planActive ?? true,
      status: (overrides.planActive ?? true) ? "ativo" : "expirado",
      plan: overrides.planTier ?? "pessoal_premium",
    }),
  }));

  // O fake do Supabase Admin em _whatsapp-fake.ts já lida com RPCs e tabelas.
  // Precisamos garantir que ele retorne o que queremos para as validações de entitlement.
  
  const originalState = { ...state };
  
  // Forçamos o linkData se não existir para o telefone padrão dos testes
  if (!state.linkData) {
    state.linkData = {
      user_id: "u1",
      telefone: "5511999998888",
      ativo: true,
      opt_in_em: new Date().toISOString(),
      revogado_em: null
    };
  }
}
