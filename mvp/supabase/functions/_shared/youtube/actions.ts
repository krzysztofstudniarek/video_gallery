import { type ConsentConfig, requireConsent } from "./config.ts";
import { type Context, TokenCipher } from "./context.ts";
import { connectionStatus, disconnect, refreshAccess } from "./connection.ts";
import { completeConsent, startConsent } from "./consent.ts";
import { GoogleClient } from "./google-client.ts";
import type { ActionInput } from "./inputs.ts";
import type { YoutubeRepository } from "./repository.ts";
import {
  clearUpload,
  initiateUpload,
  inspectUpload,
  resumeUpload,
  verifyUpload,
} from "./upload.ts";

export async function dispatchAction(
  input: ActionInput,
  repository: YoutubeRepository,
  config: ConsentConfig | null,
  send: typeof fetch,
) {
  if (input.action === "status") return connectionStatus(repository, config);
  const settings = requireConsent(config);
  const cipher = new TokenCipher(settings.encryptionKey, repository.owner);
  // Fail before consuming state if encryption material is invalid.
  await cipher.seal("configuration", "check");
  const context: Context = {
    repository,
    config: settings,
    cipher,
    google: new GoogleClient(settings, send),
  };
  switch (input.action) {
    case "start":
      return startConsent(context);
    case "complete":
      return completeConsent(context, input);
    case "disconnect":
      return disconnect(context);
    case "refresh":
      await refreshAccess(context);
      return { refreshed: true };
    case "initiate":
      return initiateUpload(context, input);
    case "resume":
      return resumeUpload(context, input);
    case "verify":
      return verifyUpload(context, input);
    case "clear_job":
      return clearUpload(context);
    case "inspect":
      return inspectUpload(context);
  }
}
