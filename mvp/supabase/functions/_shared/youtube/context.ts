import type { ConsentConfig } from "./config.ts";
import type { GoogleClient } from "./google-client.ts";
import { seal, unseal } from "./crypto.ts";
import { ActionError } from "./errors.ts";
import type { YoutubeRepository } from "./repository.ts";

export type Context = {
  repository: YoutubeRepository;
  config: ConsentConfig;
  google: GoogleClient;
  cipher: TokenCipher;
};
export class TokenCipher {
  constructor(private encodedKey: string, private owner: string) {}
  seal(kind: string, value: string) {
    return seal(this.encodedKey, this.owner, kind, value);
  }
  unseal(kind: string, envelope: string) {
    return unseal(this.encodedKey, this.owner, kind, envelope);
  }
}
export async function requireConnection(context: Context) {
  const row = await context.repository.credentials();
  if (!row) throw new ActionError("connect_youtube_first", 409);
  return row;
}
