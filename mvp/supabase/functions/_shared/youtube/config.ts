import { ActionError } from "./errors.ts";
export type Env = (name: string) => string | undefined;
export type RuntimeConfig = {
  origin: string;
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
};
export type ConsentConfig = {
  clientId: string;
  secret: string;
  encryptionKey: string;
  redirect: string;
};

function required(env: Env, name: string) {
  const value = env(name);
  if (!value?.trim()) throw new Error(`Missing required configuration: ${name}`);
  return value;
}
export function runtimeConfig(env: Env): RuntimeConfig {
  const origin = required(env, "FRONTEND_ORIGIN");
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("Invalid FRONTEND_ORIGIN");
  }
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (
    url.origin !== origin || (url.protocol !== "https:" && !(url.protocol === "http:" && local))
  ) {
    throw new Error("FRONTEND_ORIGIN must be an HTTPS origin or explicit local HTTP origin");
  }
  return {
    origin,
    supabaseUrl: required(env, "SUPABASE_URL"),
    anonKey: required(env, "SUPABASE_ANON_KEY"),
    serviceKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
  };
}
export function consentConfig(env: Env, origin: string): ConsentConfig | null {
  const clientId = env("YOUTUBE_CLIENT_ID"),
    secret = env("YOUTUBE_CLIENT_SECRET"),
    encryptionKey = env("YOUTUBE_TOKEN_KEY_B64"),
    redirect = env("YOUTUBE_REDIRECT_URI");
  if (!clientId || !secret || !encryptionKey || !redirect) return null;
  try {
    const url = new URL(redirect);
    if (url.origin !== origin || url.searchParams.get("youtube_callback") !== "1") return null;
  } catch {
    return null;
  }
  return { clientId, secret, encryptionKey, redirect };
}
export function requireConsent(config: ConsentConfig | null): ConsentConfig {
  if (!config) throw new ActionError("youtube_not_configured", 503);
  return config;
}
