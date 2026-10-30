import { parseCallback } from "./routing-policy";

// Run before creating the Auth client, loading the router, or making any API request.
const url = new URL(location.href);
export const callback = parseCallback(url, import.meta.env.BASE_URL);
export const authCode = callback.flow === "auth" ? callback.code : null;
export const authDenied = callback.flow === "auth" && (callback.denied || callback.invalid);
if (url.search || url.hash) {
  const path = callback.tools ? `${import.meta.env.BASE_URL}tools` : location.pathname;
  history.replaceState(null, "", path);
}
