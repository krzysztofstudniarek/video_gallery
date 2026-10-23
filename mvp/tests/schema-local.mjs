// Real Auth-issued JWTs and direct PostgREST calls. No provider requests or media.
import { randomUUID } from "node:crypto";

export async function checkProductionSchema({ clients, admin, anon, users, url, anonKey }) {
  const assert = (condition, message) => {
    if (!condition) throw new Error(`Production schema: ${message}`);
  };
  const checked = async (query, message) => {
    const result = await query;
    assert(!result.error, message);
    return result.data;
  };
  const denied = async (query, message) => {
    const result = await query;
    assert(result.error?.code === "42501", `${message} (code: ${result.error?.code ?? "none"})`);
  };
  const fixtures = [];
  for (let i = 0; i < 2; i++) {
    const client = clients[i];
    await checked(client.from("profiles").insert({ display_name: "Synthetic" }), "profile insert");
    const album = await checked(
      client.from("albums").insert({ title: "Synthetic" }).select().single(),
      "album insert",
    );
    const video = await checked(
      client.from("videos").insert({ album_id: album.id, caption: "Independent caption" })
        .select().single(),
      "entry insert",
    );
    const workflow = await checked(
      client.from("upload_workflows").insert({ album_id: album.id }).select().single(),
      "workflow insert",
    );
    assert(
      Date.parse(workflow.expires_at) - Date.parse(workflow.created_at) === 7 * 86400 * 1000,
      "fixed seven-day deadline",
    );
    const request = {
      p_workflow_id: workflow.id,
      p_video_id: video.id,
      p_idempotency_key: randomUUID(),
      p_upload_title: "Synthetic",
    };
    const job = await checked(client.rpc("request_upload", request), "request upload");
    assert(await checked(client.rpc("request_upload", request), "retry") === job, "idempotency");
    await checked(
      admin.from("youtube_connections").insert({
        workflow_id: workflow.id,
        owner_id: users[i],
        channel_id: "synthetic-channel",
        channel_title: "Synthetic",
        verified_at: new Date().toISOString(),
      }),
      "trusted connection insert",
    );
    fixtures.push({ album, video, workflow, job, request });
  }
  const removedFeedback = await admin.from("feedback").select("id");
  assert(removedFeedback.error?.code === "PGRST205", "in-app feedback table is absent");
  const [a, b] = fixtures;
  const tables = [
    "profiles",
    "albums",
    "videos",
    "upload_workflows",
    "upload_jobs",
    "youtube_connections",
    "qr_ready_uploads",
  ];
  for (const table of tables) {
    await denied(anon.from(table).select("*"), `${table}: anon denied`);
    const rows = await checked(clients[0].from(table).select("*"), `${table}: owner read`);
    assert(rows.every((row) => row.owner_id === users[0]), `${table}: owner isolation`);
    assert(table === "qr_ready_uploads" || rows.length === 1, `${table}: own row visible`);
    const other = await checked(
      clients[1].from(table).select("*").eq("owner_id", users[0]),
      `${table}: cross-user read`,
    );
    assert(other.length === 0, `${table}: B cannot read A`);
  }
  await denied(
    clients[0].from("albums").insert({ owner_id: users[1], title: "Forged" }),
    "forged insert owner",
  );
  await denied(
    clients[0].from("videos").insert({ album_id: b.album.id }),
    "foreign album parent",
  );
  await denied(
    clients[0].from("upload_workflows").insert({ album_id: b.album.id }),
    "foreign workflow parent",
  );
  for (
    const [table, patch] of [
      ["profiles", { owner_id: users[1], deletion_requested_at: new Date().toISOString() }],
      ["albums", { owner_id: users[1] }],
      ["videos", { album_id: b.album.id }],
      ["upload_workflows", { expires_at: new Date(Date.now() + 8 * 86400000).toISOString() }],
      ["upload_jobs", { state: "uploaded" }],
      ["upload_jobs", { effective_visibility: "unlisted", processing_status: "succeeded" }],
      ["upload_jobs", { public_confirmed_at: new Date().toISOString() }],
      ["youtube_connections", { channel_id: "forged-channel" }],
    ]
  ) {
    await denied(
      clients[0].from(table).update(patch).eq("owner_id", users[0]),
      `${table}: protected columns`,
    );
  }
  for (const table of ["albums", "videos"]) {
    const result = await checked(
      clients[1].from(table).delete().eq("owner_id", users[0]).select("id"),
      `${table}: foreign delete`,
    );
    assert(result.length === 0, `${table}: foreign delete isolated`);
  }
  await denied(
    clients[1].rpc("request_upload", a.request),
    "RPC cannot request other owner's upload",
  );
  const publicRequest = {
    ...a.request,
    p_idempotency_key: randomUUID(),
    p_requested_visibility: "public",
  };
  const unconfirmed = await clients[0].rpc("request_upload", publicRequest);
  assert(unconfirmed.error?.code === "23514", "unconfirmed Public rejected");
  await checked(
    clients[0].rpc("request_upload", { ...publicRequest, p_confirm_public: true }),
    "explicit Public confirmation accepted",
  );
  const now = new Date().toISOString();
  await checked(
    admin.from("upload_jobs").update({
      state: "uploaded",
      provider_video_id: "synthetic01",
      effective_visibility: "unlisted",
      processing_status: "succeeded",
      verified_at: now,
      channel_verified: true,
      anonymous_playback_verified_at: now,
      verified_size_bytes: 1024,
      verified_duration_seconds: 1,
    }).eq("id", a.job),
    "trusted verification",
  );
  assert(
    (await checked(clients[0].from("qr_ready_uploads").select("id"), "owner eligibility"))
      .length === 1,
    "trusted evidence makes job eligible",
  );
  assert(
    (await checked(clients[1].from("qr_ready_uploads").select("id"), "foreign eligibility"))
      .length === 0,
    "QR view isolates owners",
  );
  for (const client of [anon, clients[0], clients[1]]) {
    for (
      const [name, params] of [
        ["finish_upload_workflow", { p_owner: users[0], p_workflow: a.workflow.id }],
        ["consume_upload_oauth", {
          p_owner: users[0],
          p_workflow: a.workflow.id,
          p_hash: "a".repeat(64),
        }],
        ["purge_expired_upload_data", {}],
      ]
    ) {
      await denied(client.rpc(name, params), `${name}: direct RPC bypass denied`);
    }
    const result = await client.schema("videoalbum_private").from("workflow_credentials").select(
      "*",
    );
    assert(result.error?.code === "PGRST106", "private schema is not exposed");
  }
  // Raw REST also checks a caller cannot add privileged named arguments to the RPC.
  const token = (await clients[0].auth.getSession()).data.session.access_token;
  const forged = await fetch(`${url}/rest/v1/rpc/request_upload`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...a.request, p_owner: users[1], p_verified_at: now }),
  });
  assert(forged.status === 404, "forged RPC parameters rejected");
  await checked(
    admin.rpc("finish_upload_workflow", {
      p_owner: users[0],
      p_workflow: a.workflow.id,
    }),
    "trusted workflow finish",
  );
  for (const table of ["upload_jobs", "youtube_connections", "qr_ready_uploads"]) {
    assert(
      (await checked(clients[0].from(table).select("*"), "finish cleanup")).length === 0,
      `${table}: finish removes temporary data`,
    );
  }
  const entries = await checked(clients[0].from("videos").select("caption"), "lasting captions");
  assert(entries[0].caption === "Independent caption", "finish preserves app caption");
  const newWorkflow = await checked(
    clients[0].from("upload_workflows").insert({ album_id: a.album.id }).select().single(),
    "new workflow",
  );
  const reused = await clients[0].rpc("request_upload", {
    ...a.request,
    p_workflow_id: newWorkflow.id,
  });
  assert(reused.error?.code === "23505", "purged key cannot create replacement upload");
  await checked(
    admin.from("profiles").update({ deletion_requested_at: now }).eq("owner_id", users[0]),
    "deletion request",
  );
  assert(
    (await checked(clients[0].from("videos").select("id"), "deletion block")).length === 0,
    "deletion request blocks child access immediately",
  );
}
