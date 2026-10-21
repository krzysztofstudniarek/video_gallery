Deno.serve((request) => {
  const headers = {
    "Access-Control-Allow-Origin": Deno.env.get("FRONTEND_ORIGIN") ?? "http://127.0.0.1:5173",
    "Cache-Control": "no-store",
  };
  if (request.method !== "GET") return new Response(null, { status: 405, headers });
  return Response.json({
    status: "ok",
    application: "videoalbum",
    runtime: "supabase-edge",
    schema: 1,
  }, { headers });
});
