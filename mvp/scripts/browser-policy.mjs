export function browserPolicy(backend, development = false) {
  const url = new URL(backend);
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (
    url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    (url.protocol !== "https:" && !(local && url.protocol === "http:"))
  ) {
    throw new Error("Invalid public backend URL for browser policy");
  }
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    `connect-src 'self' ${url.origin} https://www.googleapis.com${
      development ? " ws://127.0.0.1:* ws://localhost:*" : ""
    }`,
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join("; ");
}
