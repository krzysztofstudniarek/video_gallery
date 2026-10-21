// Compatibility exports for the existing synthetic tests.
export { base64, hash, randomSecret, seal, unbase64, unseal } from "./youtube/crypto.ts";
export {
  authorizeUrl,
  googleJson,
  maxBytes,
  scopes,
  sessionUrl,
  tokenRequest,
  uploadBody,
} from "./youtube/google.ts";
