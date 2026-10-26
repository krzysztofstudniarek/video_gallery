import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export async function checkAuth({ config, admin }) {
  const assert = (value, message) => {
    if (!value) throw new Error(`Auth integration: ${message}`);
  };
  const users = [];
  const url = config.API_URL;
  const headers = (token) => ({
    apikey: config.ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });
  const account = (token, body) =>
    fetch(`${url}/functions/v1/account`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    });
  const fixture = async () => {
    const email = `auth-${randomUUID()}@example.test`, password = randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert(!created.error, "create synthetic user");
    const id = created.data.user.id;
    users.push(id);
    const client = createClient(url, config.ANON_KEY, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    assert(!signedIn.error, "sign in");
    const token = signedIn.data.session.access_token;
    assert((await account(token, { action: "status" })).ok, "initialize own profile");
    const album = await client.from("albums").insert({ title: "Synthetic auth album" }).select()
      .single();
    assert(!album.error, "own album insert");
    return { id, client, token, session: signedIn.data.session, album: album.data };
  };
  try {
    const a = await fixture(), b = await fixture();
    for (const token of [config.ANON_KEY, "invalid", a.token.slice(0, -5) + "xxxxx"]) {
      assert(
        (await account(token, { action: "status" })).status === 401,
        "reject anonymous/invalid/tampered JWT",
      );
    }
    const claims = JSON.parse(Buffer.from(a.token.split(".")[1], "base64url").toString());
    const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) - 120 }),
    ).toString("base64url");
    const signed = `${head}.${payload}`;
    const expired = `${signed}.${
      createHmac("sha256", config.JWT_SECRET).update(signed).digest("base64url")
    }`;
    assert(
      (await account(expired, { action: "status" })).status === 401,
      "reject correctly signed expired JWT",
    );
    const refreshed = await a.client.auth.refreshSession();
    assert(!refreshed.error && refreshed.data.session, "SDK session refresh");
    const token = refreshed.data.session.access_token;
    assert((await account(token, { action: "status" })).ok, "refreshed session accepted");
    assert(
      (await account(token, { action: "delete" })).status === 400,
      "deletion requires confirmation",
    );
    assert(
      (await account(token, { action: "maintenance" })).status === 400,
      "user cannot run maintenance",
    );
    const spoof = await a.client.rpc("begin_account_deletion", { p_owner: b.id });
    assert(spoof.error?.code === "42501", "direct deletion RPC denied");
    // The current example function environment has no provider keys; no Google request occurs.
    assert(
      !(await admin.rpc("yt_probe_save", {
        p_owner: a.id,
        p_cipher: "synthetic-envelope",
        p_channel: "synthetic",
        p_title: "Synthetic",
      })).error,
      "seed probe credential",
    );
    const removed = await account(token, { action: "delete", confirm: true, owner_id: b.id });
    const result = await removed.json();
    assert(
      removed.ok && result.deleted && result.provider_revocation_pending,
      "delete self even when provider revocation is unavailable",
    );
    assert(
      (await account(token, { action: "status" })).status === 401,
      "deleted identity rejected",
    );
    for (const table of ["profiles", "albums", "videos", "upload_workflows", "spike_items"]) {
      const rows = await admin.from(table).select("owner_id").eq("owner_id", a.id);
      assert(!rows.error && rows.data.length === 0, `${table} removed`);
    }
    const surviving = await b.client.from("albums").select("id");
    assert(
      !surviving.error && surviving.data.some((row) => row.id === b.album.id),
      "other owner survives forged deletion payload",
    );
    const afterDelete = await fetch(`${url}/rest/v1/albums?select=id`, { headers: headers(token) });
    assert(
      afterDelete.ok && (await afterDelete.json()).length === 0,
      "still-signed deletion JWT cannot read data",
    );
    const refreshDeleted = createClient(url, config.ANON_KEY, { auth: { persistSession: false } });
    assert(
      (await refreshDeleted.auth.refreshSession({
        refresh_token: refreshed.data.session.refresh_token,
      })).error,
      "deleted refresh token rejected",
    );
    const pending = await admin.rpc("pending_provider_revocations", { p_owner: a.id });
    assert(
      !pending.error && pending.data.length === 1,
      "bounded provider revocation survives identity deletion",
    );
    for (const row of pending.data) await admin.rpc("finish_provider_revocation", { p_id: row.id });
    const savedRefresh = b.session.refresh_token;
    assert(!(await b.client.auth.signOut({ scope: "local" })).error, "sign out");
    for (const name of ["account", "youtube", "compatibility", "channel-library"]) {
      const response = await fetch(`${url}/functions/v1/${name}`, {
        method: "POST",
        headers: headers(b.token),
        body: JSON.stringify({ action: "status" }),
      });
      assert(response.status === 401, `${name} rejects a revoked session's still-signed JWT`);
    }
    const refreshSignedOut = createClient(url, config.ANON_KEY, {
      auth: { persistSession: false },
    });
    assert(
      (await refreshSignedOut.auth.refreshSession({ refresh_token: savedRefresh })).error,
      "signed-out refresh token rejected",
    );
    // Ordinary REST follows stateless JWT expiry; document and test this boundary.
    const rest = await fetch(`${url}/rest/v1/albums?select=id`, { headers: headers(b.token) });
    assert(
      rest.ok && (await rest.json()).some((row) => row.id === b.album.id),
      "ordinary REST retains bounded JWT validity after sign-out",
    );
  } finally {
    for (const id of users) {
      const removed = await admin.auth.admin.deleteUser(id);
      if (removed.error && removed.error.status !== 404) {
        // deno-lint-ignore no-unsafe-finally -- Failed synthetic-user cleanup must fail CI.
        throw new Error("Synthetic Auth cleanup failed");
      }
    }
  }
}
