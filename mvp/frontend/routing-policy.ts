export type Flow = "auth" | "youtube";
export const returnKey = "videoalbum.return";
const lifetime = 10 * 60 * 1000;
const paths = new Set(["/", "/videos", "/account", "/tools"]);

// Only existing app screens are return targets. No query, fragment or provider data is accepted.
export function safePath(value: unknown): string | null {
  return typeof value === "string" && paths.has(value) ? value : null;
}
export function rememberReturn(storage: Storage, flow: Flow, path: string, owner?: string) {
  storage.removeItem(returnKey);
  if (!safePath(path)) return;
  storage.setItem(returnKey, JSON.stringify({ flow, path, owner, created: Date.now() }));
}
export function consumeReturn(storage: Storage, flow: Flow, owner?: string): string | null {
  const raw = storage.getItem(returnKey);
  storage.removeItem(returnKey);
  try {
    const value = JSON.parse(raw ?? "null");
    if (
      !value || value.flow !== flow || !safePath(value.path) ||
      !Number.isFinite(value.created) || Date.now() < value.created ||
      Date.now() - value.created >= lifetime ||
      (flow === "youtube" && (!owner || value.owner !== owner))
    ) return null;
    return value.path;
  } catch {
    return null;
  }
}
export function parseCallback(url: URL, base: string) {
  const params = url.searchParams;
  const has = (...names: string[]) => names.some((name) => params.has(name));
  const youtube = params.has("youtube_callback");
  const callback =
    has("code", "state", "error", "error_description", "error_code", "youtube_callback") ||
    !!url.hash;
  const denied = params.has("error") || !!url.hash;
  const single = (name: string) => params.getAll(name).length <= 1;
  const code = params.get("code"), state = params.get("state");
  const invalid = callback && (
    url.pathname !== base || !!url.hash ||
    !["code", "state", "error", "error_description", "error_code", "youtube_callback"].every(
      single,
    ) ||
    (params.has("code") && (!code || denied)) ||
    (youtube && (params.get("youtube_callback") !== "1" || (!denied && (!code || !state)))) ||
    (!youtube && params.has("state")) ||
    (!youtube && !denied && !code)
  );
  return {
    flow: callback ? youtube ? "youtube" as const : "auth" as const : null,
    invalid,
    denied,
    code: invalid || denied ? null : code,
    state: invalid || denied ? null : state,
    tools: !callback && params.getAll("tools").length === 1 && params.get("tools") === "1",
  };
}
