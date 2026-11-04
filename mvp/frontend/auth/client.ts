import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { authCode, authDenied, callback } from "./callback";
import { consumeReturn, returnKey } from "./routing-policy";

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
// One initialization promise: route mounts and Back cannot consume callback values twice.
export const initialized = (async () => {
  const result = authCode
    ? await client.auth.exchangeCodeForSession(authCode)
    : await client.auth.getSession();
  const session = result.data.session;
  const destination = callback.flow
    ? consumeReturn(sessionStorage, callback.flow, session?.user.id) ??
      (callback.flow === "youtube" && session ? "/tools" : "/")
    : null;
  let callbackMessage = "";
  if (callback.flow === "youtube") {
    if (callback.invalid) {
      callbackMessage = "YouTube authorization response was invalid. Connect again.";
    } else if (!session) callbackMessage = "Sign in, then start Connect YouTube again.";
    else if (callback.denied) {
      callbackMessage = "YouTube consent was declined. No upload was started.";
    } else {
      const { error } = await client.functions.invoke("youtube", {
        body: { action: "complete", code: callback.code, state: callback.state },
      });
      callbackMessage = error
        ? "YouTube authorization could not be completed. Connect again."
        : "YouTube consent saved. Confirm the destination channel before uploading.";
    }
  }
  return { ...result, destination, callbackMessage };
})();
export { authDenied };

export async function leaveAccount(message: string) {
  client.auth.stopAutoRefresh();
  sessionStorage.removeItem(returnKey);
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
