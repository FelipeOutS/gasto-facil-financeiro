type AuthClient = {
  getSession: () => Promise<{ data: { session: unknown }; error: unknown }>;
  getUser: () => Promise<{ data: { user: unknown }; error: unknown }>;
};

export async function validateAndroidOAuthReturn(
  auth: AuthClient,
  isAndroid: boolean,
  clearUrl: () => void,
): Promise<"complete" | "invalid-session" | "browser" | "invalid-user"> {
  // Let the SDK finish consuming the fragment before clearing it from browser history.
  let result: Awaited<ReturnType<AuthClient["getSession"]>>;
  try {
    result = await auth.getSession();
  } finally {
    clearUrl();
  }
  if (result.error || !result.data.session) return "invalid-session";
  if (!isAndroid) return "browser";
  const verified = await auth.getUser();
  if (verified.error || !verified.data.user) return "invalid-user";
  return "complete";
}
