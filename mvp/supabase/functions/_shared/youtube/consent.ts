import { authorizeUrl, scopes } from "./google.ts";
import { hash, randomSecret } from "./crypto.ts";
import { ActionError } from "./errors.ts";
import type { Context } from "./context.ts";
import type { CompleteInput } from "./inputs.ts";

export async function startConsent(context: Context) {
  const state = randomSecret(), verifier = randomSecret();
  await context.repository.start(await hash(state), verifier);
  return {
    authorization_url: authorizeUrl(
      context.config.clientId,
      context.config.redirect,
      state,
      await hash(verifier),
    ),
  };
}
export async function completeConsent(context: Context, input: CompleteInput) {
  const attempt = await context.repository.consume(await hash(input.state));
  if (!attempt) throw new ActionError("consent_expired_or_used", 400);
  const tokens = await context.google.exchange(input.code, attempt.verifier);
  const granted = String(tokens.scope ?? "").split(" ");
  if (!scopes.every((scope) => granted.includes(scope)) || !tokens.refresh_token) {
    throw new Error("consent_missing_permissions");
  }
  const channel = await context.google.channel(tokens.access_token);
  const previous = await context.repository.credentials();
  if (previous && previous.channel_id !== channel.id) {
    throw new Error("disconnect_before_switching_channel");
  }
  await context.repository.save(
    await context.cipher.seal("refresh", tokens.refresh_token),
    channel.id,
    channel.title,
  );
  return { connected: true, channel };
}
