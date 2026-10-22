import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// Anonymous callers receive only a validated redirect, never database rows.
Deno.serve(async (request) => {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (request.method !== "GET") return new Response(null, { status: 405, headers });
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return new Response(null, { status: 404, headers });
  }
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await admin.rpc("resolve_spike_share", { token });
  const video = data?.[0]?.video_id;
  if (error || typeof video !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(video)) {
    return new Response(null, { status: 404, headers });
  }
  return new Response(null, {
    status: 302,
    headers: { ...headers, Location: `https://www.youtube.com/watch?v=${video}` },
  });
});
