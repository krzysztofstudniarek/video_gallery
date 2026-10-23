import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { authCode, authDenied } from "./callback";

export const storageKey = "videoalbum.auth";
function withoutProviderTokens(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && "access_token" in parsed) {
      delete parsed.provider_token;
      delete parsed.provider_refresh_token;
      return JSON.stringify(parsed);
    }
  } catch { /* PKCE verifiers are strings, not session JSON. */ }
  return value;
}
// Migrate the compatibility probe's SDK key, including an in-flight PKCE verifier.
const legacyKey = `sb-${
  new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split(".")[0]
}-auth-token`;
for (const suffix of ["", "-code-verifier"]) {
  const value = localStorage.getItem(legacyKey + suffix);
  if (value !== null && localStorage.getItem(storageKey + suffix) === null) {
    localStorage.setItem(storageKey + suffix, withoutProviderTokens(value));
  }
  localStorage.removeItem(legacyKey + suffix);
}
export const client = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storageKey,
      storage: {
        getItem: (key) => {
          const value = localStorage.getItem(key);
          if (value === null) return null;
          const clean = withoutProviderTokens(value);
          if (clean !== value) localStorage.setItem(key, clean);
          return clean;
        },
        setItem: (key, value) => localStorage.setItem(key, withoutProviderTokens(value)),
        removeItem: (key) => localStorage.removeItem(key),
      },
    },
  },
);
// A single exchange prevents React mounts from consuming a one-use code twice.
export const initialized = authCode
  ? client.auth.exchangeCodeForSession(authCode)
  : client.auth.getSession();
export { authDenied };

export async function leaveAccount(message: string) {
  client.auth.stopAutoRefresh();
  let failed = false;
  try {
    failed = !!(await client.auth.signOut({ scope: "local" })).error;
  } catch {
    failed = true;
  } finally {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(`${storageKey}-code-verifier`);
    sessionStorage.setItem(
      "videoalbum.notice",
      failed
        ? `${message} Server sign-out could not be confirmed; this browser's saved session was cleared.`
        : message,
    );
    location.replace(new URL(import.meta.env.BASE_URL, location.origin).href);
  }
}
