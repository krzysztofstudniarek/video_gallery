// Real local Auth -> Edge -> privileged RPC coverage. All provider records are synthetic.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
export async function checkUploads({ config, admin }) {
  if (!["localhost", "127.0.0.1"].includes(new URL(config.API_URL).hostname)) {
    throw new Error("Upload fixtures require a local database");
  }
  const ids = [];
  const assert = (condition, label) => {
    if (!condition) throw new Error(`Upload integration: ${label}`);
  };
  const checked = async (query, label) => {
    const result = await query;
    assert(!result.error, label);
    return result.data;
  };
  const invoke = async (client, body) => {
    const { data, error } = await client.functions.invoke("uploads", { body });
    if (!error) return { status: 200, body: data };
    let failure = {};
    try {
      failure = await error.context.json();
    } catch { /* Never reflect raw provider/error bodies. */ }
    return { status: error.context?.status, body: failure };
  };
  try {
    const accounts = [];
    for (let index = 0; index < 2; index++) {
      const email = `upload-${randomUUID()}@example.test`, password = randomUUID();
      const created = await checked(
        admin.auth.admin.createUser({ email, password, email_confirm: true }),
        "create local identity",
      );
      ids.push(created.user.id);
      const client = createClient(config.API_URL, config.ANON_KEY, {
        auth: { persistSession: false },
      });
      await checked(client.auth.signInWithPassword({ email, password }), "sign in local owner");
      await checked(client.rpc("ensure_app_profile"), "create owner profile");
      const workflow = randomUUID();
      await checked(
        admin.rpc("start_youtube_workflow", {
          p_owner: created.user.id,
          p_hash: String(index + 1).repeat(64),
          p_cipher: "synthetic-unused-verifier",
          p_key_id: "synthetic-unused",
          p_workflow: workflow,
        }),
        "create local workflow",
      );
      await checked(
        admin.rpc("save_youtube_workflow", {
          p_owner: created.user.id,
          p_workflow: workflow,
          p_cipher: "synthetic-unused-refresh",
          p_key_id: "synthetic-unused",
          p_channel: `synthetic-channel-${index}`,
          p_title: "Synthetic",
        }),
        "connect local synthetic workflow",
      );
      accounts.push({ client, owner: created.user.id, workflow });
    }
    const [a, b] = accounts;
    const input = {
      action: "create",
      workflowId: a.workflow,
      key: randomUUID(),
      title: "Synthetic upload",
      description: "Temporary provider input",
      caption: "Independent caption",
      visibility: "public",
      confirmPublic: true,
      size: 1024,
      sha256: "a".repeat(64),
      madeForKids: false,
      ownerId: b.owner,
    };
    const noAuth = await fetch(`${config.API_URL}/functions/v1/uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    assert(noAuth.status === 401, "anonymous uploads denied");
    assert(
      (await invoke(a.client, { ...input, confirmPublic: false })).status === 400,
      "unconfirmed Public rejected",
    );
    const created = await invoke(a.client, input);
    assert(created.status === 200 && created.body.jobId, "authenticated upload created");
    const job = created.body.jobId;
    assert((await invoke(a.client, input)).body.jobId === job, "idempotent retry returns same job");
    const rows = await checked(
      a.client.from("upload_jobs").select("id,owner_id,video_id,album_id"),
      "owner reads its job",
    );
    assert(rows.length === 1 && rows[0].owner_id === a.owner, "forged request owner ignored");
    assert(
      (await invoke(b.client, { action: "status", jobId: job })).status === 409,
      "foreign job status denied",
    );
    assert(
      (await invoke(b.client, { action: "delivery", workflowId: a.workflow })).status === 409,
      "foreign workflow denied",
    );
    assert(
      (await a.client.rpc("finish_upload_playback", { p_claim: randomUUID(), p_passed: true }))
        .error?.code === "42501",
      "browser cannot attest playback",
    );
    assert(
      (await a.client.rpc("claim_upload_dispatch", {
        p_owner: a.owner,
        p_job: job,
        p_lease: randomUUID(),
      })).error?.code === "42501",
      "browser cannot bypass admission",
    );
    const choices = [{ jobId: job, videoId: rows[0].video_id, workflowId: a.workflow }];
    assert(
      (await invoke(a.client, { action: "destinations", choices })).status === 409,
      "unverified destination denied",
    );
    await checked(
      admin.rpc("record_upload_result", {
        p_owner: a.owner,
        p_job: job,
        p_video: "synthetic91",
        p_visibility: "public",
        p_processing: "succeeded",
        p_channel: true,
        p_size: 1024,
        p_duration: 1,
      }),
      "trusted synthetic provider result",
    );
    assert(
      (await invoke(a.client, { action: "destinations", choices })).status === 409,
      "metadata alone cannot enable QR",
    );
    await checked(
      admin.rpc("request_upload_playback", { p_owner: a.owner, p_job: job }),
      "queue local playback fixture",
    );
    const claim = randomUUID();
    const task = await checked(
      admin.rpc("claim_upload_playback", { p_claim: claim }),
      "claim playback fixture",
    );
    assert(task.jobId === job, "worker claim binds the expected job");
    await checked(
      admin.rpc("finish_upload_playback", { p_claim: claim, p_passed: true }),
      "attest only synthetic local playback",
    );
    const destinations = await invoke(a.client, { action: "destinations", choices });
    assert(
      destinations.status === 200 &&
        destinations.body.entries[0].destination === "https://www.youtube.com/watch?v=synthetic91",
      "trusted direct destination handoff",
    );
    assert(
      (await invoke(b.client, { action: "destinations", choices })).status === 409,
      "destination owner isolation",
    );
    const replacement = await checked(
      admin.from("upload_jobs").insert({
        owner_id: a.owner,
        workflow_id: a.workflow,
        album_id: rows[0].album_id,
        video_id: rows[0].video_id,
        idempotency_key: randomUUID(),
        upload_title: "Pending replacement",
        created_at: new Date(Date.now() + 1000).toISOString(),
      }).select("id").single(),
      "create newer pending fixture",
    );
    assert(
      (await invoke(a.client, { action: "destinations", choices })).status === 409,
      "cached ready job cannot bypass a newer pending upload",
    );
    await checked(
      admin.from("upload_jobs").delete().eq("id", replacement.id),
      "remove pending replacement fixture",
    );
    const batch = await invoke(a.client, { action: "downloads", workflowId: a.workflow });
    assert(batch.status === 200 && batch.body.batchId, "verified batch prepared");
    assert(
      (await invoke(a.client, {
        action: "finish",
        workflowId: a.workflow,
        batchId: batch.body.batchId,
        confirmSaved: true,
      })).status === 409,
      "missing downloads prevent cleanup",
    );
    assert(
      (await invoke(a.client, { action: "cancel", jobId: job })).body.cancelled,
      "job cancellation",
    );
    assert(
      (await invoke(a.client, { action: "status", jobId: job })).body.state === "cancelled",
      "cancelled bookmark is provider-free",
    );
    assert(
      (await invoke(a.client, input)).status === 409,
      "cancelled key cannot create another video",
    );
    const captions = await checked(
      a.client.from("videos").select("caption"),
      "lasting app caption",
    );
    assert(
      captions.length === 1 && captions[0].caption === input.caption,
      "cancellation preserves independent caption",
    );
    const privateJob = await invoke(b.client, {
      ...input,
      key: randomUUID(),
      workflowId: b.workflow,
      visibility: "private",
      confirmPublic: false,
    });
    assert(privateJob.status === 200, "Private request accepted");
    await checked(
      admin.rpc("record_upload_result", {
        p_owner: b.owner,
        p_job: privateJob.body.jobId,
        p_video: "synthetic92",
        p_visibility: "private",
        p_processing: "succeeded",
        p_channel: true,
        p_size: 1024,
        p_duration: 1,
      }),
      "trusted Private result",
    );
    assert(
      (await invoke(b.client, { action: "status", jobId: privateJob.body.jobId })).body
        .qrEligible === false,
      "Private upload is never QR eligible",
    );
    const privateBatch = await invoke(b.client, { action: "downloads", workflowId: b.workflow });
    assert(
      privateBatch.status === 200 && privateBatch.body.entries[0].qrEligible === false,
      "Private export excludes QR",
    );
    const finish = {
      action: "finish",
      workflowId: b.workflow,
      batchId: privateBatch.body.batchId,
      confirmSaved: true,
    };
    assert(
      (await invoke(b.client, finish)).status === 409,
      "Private completion still requires links export",
    );
    assert(
      (await invoke(b.client, {
        action: "downloaded",
        workflowId: b.workflow,
        batchId: privateBatch.body.batchId,
        kind: "links",
      })).body.acknowledged,
      "owner acknowledges offered links export",
    );
    assert(
      (await invoke(b.client, finish)).body.completed,
      "Private workflow completes after its required export",
    );
    const receipt = await invoke(b.client, { action: "delivery", workflowId: b.workflow });
    assert(
      receipt.body.completed && !JSON.stringify(receipt.body).includes("synthetic92"),
      "finished bookmark cannot recover provider destination",
    );
    assert(
      (await invoke(b.client, { action: "downloads", workflowId: b.workflow })).status === 409,
      "purged destinations cannot be regenerated",
    );
    assert(
      (await checked(b.client.from("upload_jobs").select("id"), "completed cleanup")).length === 0,
      "finish purges jobs",
    );
  } finally {
    for (const id of ids) {
      await checked(admin.auth.admin.deleteUser(id), "synthetic upload identity cleanup");
    }
  }
}
