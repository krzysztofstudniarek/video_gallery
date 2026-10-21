export const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export function unbase64(value: string) {
  return Uint8Array.from(atob(value), (x) => x.charCodeAt(0));
}
export function randomSecret() {
  return base64(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replaceAll("=", "");
}
export async function hash(value: string) {
  return base64(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  )
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function key(encoded: string) {
  const raw = unbase64(encoded);
  if (raw.length !== 32) throw new Error("configuration");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function seal(encodedKey: string, owner: string, kind: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`${owner}:${kind}:v1`) },
    await key(encodedKey),
    data,
  );
  return JSON.stringify({ v: 1, iv: base64(iv), data: base64(new Uint8Array(encrypted)) });
}
export async function unseal(encodedKey: string, owner: string, kind: string, envelope: string) {
  const box = JSON.parse(envelope);
  if (box.v !== 1) throw new Error("key_version");
  const value = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unbase64(box.iv),
      additionalData: new TextEncoder().encode(`${owner}:${kind}:v1`),
    },
    await key(encodedKey),
    unbase64(box.data),
  );
  return new TextDecoder().decode(value);
}
