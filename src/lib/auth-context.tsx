import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { setAuthenticatedUserId } from "./store";
import type { TipoCadastro } from "./profile-utils";
import {
  clearLoginBio,
  clearLoginBioSessionOnly,
  isLoginBioBridgeAvailable,
  isLoginBioEnabledForEmail,
  LOGIN_BIO_SESSION_RESTORED_EVENT,
  persistLoginBioSession,
  setLoginBioInProgress,
  setLoginBioUnlocked,
} from "./biometric-login";
import { clearSecureSession, hasSavedSecureSession, saveSecureSession } from "./secure-session";

import { setVaultSession } from "./vault/use-vault";

export type Profile = {
  id: string;
  nome: string | null;
  tipo_cadastro: TipoCadastro;
  cpf: string | null;
  cnpj: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  responsavel_nome: string | null;
  telefone: string | null;
  avatar_url: string | null;
};

export type ProfileUpdate = Partial<Omit<Profile, "id">>;

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (nome: string, email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
  updateProfile: (data: ProfileUpdate) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_BOOT_TIMEOUT_MS = 6000;

function withAuthTimeout<T>(promise: Promise<T>, ms = AUTH_BOOT_TIMEOUT_MS): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(null))
      .finally(() => window.clearTimeout(timer));
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    // Auth tracks the actor; ActiveAccountProvider owns financial hydration.
    let sessionObserved = false;
    let profileUidThisSession: string | null = null;
    // Safety: nunca deixe loading=true para sempre (WebView pode travar getSession)
    const loadingFallback = window.setTimeout(() => {
      if (mounted) setLoading(false);
    }, AUTH_BOOT_TIMEOUT_MS + 1000);

    // 1) listener FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((evt, sess) => {
      sessionObserved = true;
      setVaultSession(sess);
      setSession(sess);
      if (evt === "TOKEN_REFRESHED" && sess && hasSavedSecureSession()) {
        void saveSecureSession(sess);
      }
      const uid = sess?.user.id ?? null;
      setAuthenticatedUserId(uid);
      if (uid) {
        if (isLoginBioEnabledForEmail(sess?.user.email)) {
          persistLoginBioSession(sess);
        }
        // Load profile only for a new login; token refresh preserves the selected owner.
        const isNewLogin = profileUidThisSession !== uid;
        const isSigninEvent = evt === "SIGNED_IN" || evt === "INITIAL_SESSION";
        if (isNewLogin && isSigninEvent) {
          profileUidThisSession = uid;
          // Defer cloud work to avoid blocking the auth callback
          setTimeout(() => {
            if (mounted && profileUidThisSession === uid) void loadProfile(uid);
          }, 0);
        }
      } else {
        profileUidThisSession = null;
        setProfile(null);
      }
    });

    const onBioSessionRestored = (event: Event) => {
      const sess = (event as CustomEvent<{ session?: Session }>).detail?.session ?? null;
      if (!sess) return;
      sessionObserved = true;
      setVaultSession(sess);
      setSession(sess);
      setLoading(false);
      const uid = sess.user.id;
      setAuthenticatedUserId(uid);
      persistLoginBioSession(sess);
      if (profileUidThisSession !== uid) {
        profileUidThisSession = uid;
        setTimeout(() => {
          if (mounted && profileUidThisSession === uid) void loadProfile(uid);
        }, 0);
      }
    };
    window.addEventListener(
      LOGIN_BIO_SESSION_RESTORED_EVENT,
      onBioSessionRestored as EventListener,
    );

    // 2) then existing session
    withAuthTimeout(supabase.auth.getSession())
      .then((result) => {
        if (!mounted || sessionObserved) return;
        const data = result?.data ?? { session: null };
        setVaultSession(data.session);
        setSession(data.session);
        const uid = data.session?.user.id ?? null;
        setAuthenticatedUserId(uid);
        if (uid) {
          if (isLoginBioEnabledForEmail(data.session?.user.email)) {
            persistLoginBioSession(data.session);
          }
          if (profileUidThisSession !== uid) {
            profileUidThisSession = uid;
            if (mounted && profileUidThisSession === uid) void loadProfile(uid);
          }
        }
      })
      .finally(() => {
        window.clearTimeout(loadingFallback);
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      setVaultSession(null);
      window.clearTimeout(loadingFallback);
      sub.subscription.unsubscribe();
      window.removeEventListener(
        LOGIN_BIO_SESSION_RESTORED_EVENT,
        onBioSessionRestored as EventListener,
      );
    };
  }, []);

  async function loadProfile(uid: string) {
    const { data } = await supabase
      .from("profiles")
      .select(
        "id, nome, tipo_cadastro, cpf, cnpj, razao_social, nome_fantasia, responsavel_nome, telefone, avatar_url",
      )
      .eq("id", uid)
      .maybeSingle();
    if (data) setProfile(data as Profile);
  }

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    async signIn(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error && data.session && isLoginBioBridgeAvailable()) {
        console.log("[Biometria] login por senha funcionou, salvando preferência biométrica");
        persistLoginBioSession(data.session);
        setLoginBioUnlocked(true);
      }
      return { error: error ?? null };
    },
    async signUp(nome, email, password) {
      const { buildPublicUrl } = await import("./public-url");
      const redirectUrl = buildPublicUrl("/");
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: { nome },
        },
      });
      return { error: error ?? null };
    },
    async signOut() {
      setVaultSession(null);
      setLoginBioUnlocked(false);
      setLoginBioInProgress(false);
      // Logout encerra a sessão real e remove tokens salvos, mas mantém a
      // preferência local para a tela explicar que a senha é necessária.
      clearLoginBioSessionOnly();
      // Limpa também a sessão segura do Android Keystore — após signOut,
      // o usuário precisa logar com senha novamente antes de poder usar
      // a biometria.
      clearSecureSession();
      await supabase.auth.signOut();
      setAuthenticatedUserId(null);
      setProfile(null);
    },
    async resetPassword(email) {
      const { buildPublicUrl } = await import("./public-url");
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: buildPublicUrl("/reset-password"),
      });
      return { error: error ?? null };
    },
    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password });
      return { error: error ?? null };
    },
    async updateProfile(data) {
      const uid = session?.user.id;
      if (!uid) return { error: new Error("Usuário não autenticado") };
      // upsert garante que usuários antigos sem linha em profiles também consigam salvar
      const payload = { id: uid, ...data };
      const { data: saved, error } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "id" })
        .select(
          "id, nome, tipo_cadastro, cpf, cnpj, razao_social, nome_fantasia, responsavel_nome, telefone, avatar_url",
        )
        .maybeSingle();
      if (error) return { error };
      if (saved) setProfile(saved as Profile);
      return { error: null };
    },
    async refreshProfile() {
      const uid = session?.user.id;
      if (uid) await loadProfile(uid);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const SSR_FALLBACK: AuthContextValue = {
  session: null,
  user: null,
  profile: null,
  loading: true,
  async signIn() {
    return { error: new Error("Auth not ready") };
  },
  async signUp() {
    return { error: new Error("Auth not ready") };
  },
  async signOut() {},
  async resetPassword() {
    return { error: new Error("Auth not ready") };
  },
  async updatePassword() {
    return { error: new Error("Auth not ready") };
  },
  async updateProfile() {
    return { error: new Error("Auth not ready") };
  },
  async refreshProfile() {},
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  // During SSR or if provider isn't mounted yet, return safe defaults
  // instead of throwing — this prevents render-time crashes.
  if (!ctx) return SSR_FALLBACK;
  return ctx;
}
