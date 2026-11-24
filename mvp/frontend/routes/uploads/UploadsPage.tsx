import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAppAccess } from "../../app/App";
import { NavigationGuard } from "../../app/NavigationGuard";
import { client } from "../../auth/client";
import { onProviderStop } from "../../auth/provider-stop";
import { directUpload, xhrTransport } from "../tools/direct-upload";
import { fileDuration, fileFingerprint, uploadCall, type UploadStatus } from "./upload-client";
import { type Visibility, VisibilitySelector } from "./VisibilitySelector";

type Connection = {
  connected: boolean;
  workflowId: string | null;
  expiresAt: string | null;
  channel?: { title: string } | null;
};
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function Uploads({ owner }: { owner: string }) {
  const { jobId } = useParams(), navigate = useNavigate();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [jobs, setJobs] = useState<{ id: string }[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("unlisted");
  const [kids, setKids] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false),
    [bytes, setBytes] = useState(0),
    [message, setMessage] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [preparedJob, setPreparedJob] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null), active = useRef(false);
  const pending = useRef<{ key: string; body: Record<string, unknown> } | null>(null);
  const lease = useRef(crypto.randomUUID());
  const fileHandoff = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void client.functions.invoke("youtube", {
      body: { action: "connection" },
      signal: controller.signal,
    }).then(async ({ data, error }) => {
      if (error) throw new Error("Could not check your YouTube connection.");
      if (controller.signal.aborted) return;
      setConnection(data);
      if (data.workflowId) {
        const rows = await client.from("upload_jobs").select("id").eq(
          "workflow_id",
          data.workflowId,
        ).order("created_at").abortSignal(controller.signal);
        if (rows.error) throw new Error("Could not load upload jobs.");
        if (!controller.signal.aborted) setJobs(rows.data);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setMessage("Could not check YouTube access. Reload to retry.");
      }
    });
    return () => {
      controller.abort();
      request.current?.abort();
      active.current = false;
    };
  }, [owner]);
  useEffect(() => {
    if (preparedJob) void navigate(`/uploads/${preparedJob}`);
  }, [preparedJob, navigate]);
  useEffect(() => {
    request.current?.abort();
    active.current = false;
    setBusy(false);
    setStatus(null);
    setMessage("");
    setCancelled(false);
    setBytes(0);
    setPreparedJob(null);
    pending.current = null;
    if (!jobId || fileHandoff.current !== jobId) setFile(null);
    fileHandoff.current = null;
    setTitle("");
    setDescription("");
    setCaption("");
    setKids(null);
    // Navigation only reads state; it cannot dispatch or resume transfers.
    if (!jobId) {
      pending.current = null;
      setVisibility("unlisted");
      return;
    }
    setVisibility("unlisted");
    if (!uuid.test(jobId)) {
      setMessage("This upload bookmark is invalid.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    void uploadCall({ action: "status", jobId }, controller.signal).then(setStatus).catch(
      (error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      },
    );
    return () => controller.abort();
  }, [jobId]);
  useEffect(() => {
    if (!status?.expiresAt) return;
    const timer = setTimeout(() => {
      request.current?.abort();
      active.current = false;
      setBusy(false);
      setStatus(null);
      setMessage("This workflow expired. Its bookmark cannot recreate purged work.");
    }, Math.max(0, Date.parse(status.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [status?.expiresAt]);
  useEffect(() => {
    // A hidden/restored tab must stop and revalidate explicitly before another transfer.
    const pause = () => {
      if (document.visibilityState === "hidden") {
        request.current?.abort();
        active.current = false;
        setBusy(false);
        setMessage("Upload paused. Check its status, then resume the same job.");
      }
    };
    const unsubscribeStop = onProviderStop(() => {
      request.current?.abort();
      active.current = false;
      setBusy(false);
      setStatus(null);
      setConnection(null);
      setMessage(
        "YouTube work stopped after disconnect or account changes. Reload to revalidate access. Already uploaded videos remain in YouTube.",
      );
    });
    document.addEventListener("visibilitychange", pause);
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (session?.user.id !== owner || event === "SIGNED_OUT") {
        request.current?.abort();
        active.current = false;
        setBusy(false);
      }
    });
    return () => {
      unsubscribeStop();
      document.removeEventListener("visibilitychange", pause);
      subscription.unsubscribe();
    };
  }, [owner]);
  function begin() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage("");
    return controller;
  }
  async function prepare() {
    if (active.current || !connection?.workflowId || !file || kids === null) return;
    active.current = true;
    const controller = begin();
    try {
      if (file.type !== "video/mp4" || file.size < 1 || file.size > 1073741824) {
        throw new Error("Choose an MP4 file of at most 1 GiB.");
      }
      const duration = await fileDuration(file, controller.signal);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 600) {
        throw new Error("Choose a video of at most ten minutes.");
      }
      const hash = await fileFingerprint(file, controller.signal);
      // Keep a failed/ambiguous creation request in memory so Retry cannot allocate a new key.
      if (!pending.current) {
        const key = crypto.randomUUID();
        pending.current = {
          key,
          body: {
            action: "create",
            key,
            workflowId: connection.workflowId,
            title,
            description,
            caption,
            visibility,
            confirmPublic: visibility === "public",
            size: file.size,
            sha256: hash,
            madeForKids: kids,
          },
        };
      }
      const result = await uploadCall(pending.current.body, controller.signal);
      setVisibility("unlisted");
      fileHandoff.current = result.jobId;
      setPreparedJob(result.jobId);
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage(error instanceof Error ? error.message : "Upload could not be prepared.");
      }
    } finally {
      active.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function check() {
    if (!jobId || active.current) return;
    active.current = true;
    const controller = begin();
    try {
      setStatus(await uploadCall({ action: "reconcile", jobId }, controller.signal));
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage(error instanceof Error ? error.message : "Status could not be confirmed.");
      }
    } finally {
      active.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function transfer() {
    if (!jobId || !file || !status || active.current) return;
    active.current = true;
    const controller = begin();
    try {
      const hash = await fileFingerprint(file, controller.signal);
      const result = await uploadCall<{ sessionUrl: string }>({
        action: status.state === "queued" ? "dispatch" : "resume",
        jobId,
        lease: lease.current,
        size: file.size,
        sha256: hash,
      }, controller.signal);
      const send: typeof xhrTransport = async (...args) => {
        await uploadCall({ action: "permit", jobId, lease: lease.current }, controller.signal);
        controller.signal.throwIfAborted();
        return xhrTransport(...args);
      };
      await directUpload(
        result.sessionUrl,
        file,
        setBytes,
        () => controller.signal.aborted,
        send,
        controller.signal,
        8 * 1024 * 1024,
      );
      controller.signal.throwIfAborted();
      setStatus(await uploadCall({ action: "reconcile", jobId }, controller.signal));
      setMessage("Video bytes transferred. Check processing until completion is verified.");
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Transfer stopped. Check this same job before resuming.",
        );
        // Read only: a failed initiation must never leave a stale Start action active.
        try {
          setStatus(await uploadCall({ action: "status", jobId }, controller.signal));
        } catch { /* Keep the error and same bookmark. */ }
      }
    } finally {
      active.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function cancel() {
    if (!jobId) return;
    request.current?.abort();
    active.current = false;
    const controller = begin();
    try {
      await uploadCall({ action: "cancel", jobId }, controller.signal);
      setCancelled(true);
      setStatus(null);
      setFile(null);
      setMessage(
        "Upload cancelled locally. Any video already uploaded remains in YouTube. Check your channel to remove it yourself if wanted.",
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage(error instanceof Error ? error.message : "Cancellation could not be confirmed.");
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const editable = !busy && !pending.current;
  return (
    <section aria-labelledby="upload-title">
      <h2 id="upload-title">Upload to YouTube</h2>
      <NavigationGuard
        when={!preparedJob && status?.state !== "completed" && !cancelled &&
          (busy || !!file || !!pending.current || !!title || !!description || !!caption ||
            kids !== null || visibility !== "unlisted")}
        message="Leaving pauses this upload and clears unsaved inputs. Return to this job and choose the original file to resume. Any uploaded video remains in YouTube."
      />
      <p>
        Up to 1 GiB and ten minutes per video; ten jobs per workflow. Video bytes go directly to
        YouTube. Uploading never deletes videos from your channel.
      </p>
      {!connection ? <p>Checking your connection…</p> : !connection.connected
        ? (
          <p>
            <Link to="/account">Connect YouTube</Link> before preparing an upload.
          </p>
        )
        : null}
      {connection?.channel && <p>Destination channel: {connection.channel.title}</p>}
      {!jobId && connection?.connected && (
        <>
          <p>
            Preparing a job saves your final metadata and visibility. Use Start upload on the job
            screen to send it to YouTube.
          </p>
          <label>
            YouTube title{" "}
            <input
              value={title}
              disabled={!editable}
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <br />
          <label>
            YouTube description{" "}
            <textarea
              value={description}
              disabled={!editable}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <p>
            Description limit: 5,000 UTF-8 bytes. Title and description cannot contain &lt; or &gt;.
          </p>
          <label>
            Album caption{" "}
            <textarea
              value={caption}
              disabled={!editable}
              maxLength={2000}
              onChange={(e) => setCaption(e.target.value)}
            />
          </label>
          <VisibilitySelector value={visibility} disabled={!editable} onChange={setVisibility} />
          <label>
            Is this video made for children?{" "}
            <select
              value={kids === null ? "" : String(kids)}
              disabled={!editable}
              onChange={(e) => setKids(e.target.value === "" ? null : e.target.value === "true")}
            >
              <option value="">Choose</option>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </label>
        </>
      )}
      {(!jobId || status?.state === "queued" || status?.state === "transferring") && (
        <p>
          <label>
            {jobId ? "Reselect the original MP4 file" : "MP4 video"}{" "}
            <input
              type="file"
              accept="video/mp4"
              disabled={!editable}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </p>
      )}
      {!jobId && (
        <button
          type="button"
          disabled={busy || !file || !title.trim() || kids === null || !connection?.connected}
          onClick={() => void prepare()}
        >
          {pending.current ? "Retry saving this job" : "Prepare upload"}
        </button>
      )}
      {status?.state === "completed" && (
        <p>
          <Link to={`/workflows/${status.workflowId}/print`}>
            Verify and download this workflow
          </Link>
        </p>
      )}
      {status?.state === "cancelled" && (
        <p>Upload cancelled locally. Any video already uploaded remains in YouTube.</p>
      )}
      {status && (
        <>
          <p role="status">
            Upload status: {status.state}. Requested visibility: {status.requestedVisibility}.{" "}
            {status.effectiveVisibility && `Verified visibility: ${status.effectiveVisibility}.`}
          </p>
          <p>
            Temporary workflow expires{" "}
            {status.expiresAt ? new Date(status.expiresAt).toLocaleString() : "already ended"}.
            Refresh and retries do not extend this deadline.
          </p>
          {status.failure && (
            <p role="alert">
              Verification blocked: {status.failure.replaceAll("_", " ")}. QR codes are unavailable.
            </p>
          )}
          {status.state === "completed" && (
            <p>
              {status.requestedVisibility === "private"
                ? "Private upload completed. Private videos cannot be used for QR codes."
                : status.qrEligible
                ? "Verified for QR downloads. Open the workflow to prepare and save your files."
                : "Upload processing and visibility verified. Open the workflow to verify signed-out playback before generating QR codes."}
            </p>
          )}
          {["queued", "transferring"].includes(status.state) && (
            <button
              type="button"
              disabled={busy || !file}
              onClick={() => void transfer()}
            >
              {status.state === "queued" ? "Start upload" : "Resume same upload"}
            </button>
          )} {!["queued", "cancelled"].includes(status.state) && (
            <button
              type="button"
              disabled={busy || status.pollCount >= 120}
              onClick={() => void check()}
            >
              Check processing / recover completion
            </button>
          )}{" "}
          <button
            type="button"
            disabled={cancelled || status.state === "cancelled"}
            onClick={() => void cancel()}
          >
            Cancel this upload
          </button>
          <p>
            {status.pollCount}/120 processing checks used. Checks are limited to one every five
            seconds.
          </p>
        </>
      )}
      {busy && (
        <button
          type="button"
          onClick={() => {
            request.current?.abort();
            active.current = false;
            setBusy(false);
            setMessage(
              "Paused. Check this job before resuming; no replacement upload will start automatically.",
            );
          }}
        >
          Pause
        </button>
      )}
      {file && (
        <p>
          <progress value={bytes} max={file.size} />{" "}
          {Math.floor(bytes / file.size * 100)}% transferred
        </p>
      )}
      <p role="status">{message}</p>
      {jobId && (
        <p>
          <Link to="/uploads">Prepare another video</Link> · <Link to="/videos">Your videos</Link>
        </p>
      )}
      {!jobId && jobs.length > 0 && (
        <>
          <h3>Recover existing uploads</h3>
          <ul>
            {jobs.map((job, index) => (
              <li key={job.id}>
                <Link to={`/uploads/${job.id}`}>Upload {index + 1}</Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
export function UploadsPage() {
  const { owner, canAccess } = useAppAccess();
  return owner && canAccess ? <Uploads key={owner} owner={owner} /> : null;
}
