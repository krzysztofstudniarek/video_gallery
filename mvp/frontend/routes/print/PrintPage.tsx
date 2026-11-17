import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useAppAccess } from "../../app/App";
import { client } from "../../auth/client";
import { onProviderStop } from "../../auth/provider-stop";
import { NavigationGuard } from "../../app/NavigationGuard";
import { uploadCall } from "../uploads/upload-client";
import {
  captionsExport,
  type DownloadBatch,
  downloadFile,
  presets,
  printableSheet,
  qrGeometry,
  qrSvg,
} from "./artifacts";
import "./print.css";

type Delivery = {
  completed?: boolean;
  workflowId: string;
  expiresAt: string;
  albumId: string;
  albumTitle: string;
  preset: number;
  jobs: {
    jobId: string;
    caption: string;
    state: string;
    processing: string;
    visibility: string | null;
    qrEligible: boolean;
  }[];
};
function Print({ owner }: { owner: string }) {
  const { workflowId } = useParams();
  const [delivery, setDelivery] = useState<Delivery | null>(null),
    [batch, setBatch] = useState<DownloadBatch | null>(null);
  const [style, setStyle] = useState(1),
    [numbering, setNumbering] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [saved, setSaved] = useState({ sheet: false, individual: false, links: false });
  const [individual, setIndividual] = useState<string[]>([]),
    [confirm, setConfirm] = useState(false),
    [finished, setFinished] = useState(false);
  const [checked, setChecked] = useState(false);
  const controller = useRef<AbortController | null>(null), active = useRef(false);
  const reset = () => {
    setBatch(null);
    setSaved({ sheet: false, individual: false, links: false });
    setIndividual([]);
    setConfirm(false);
  };
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    reset();
    setDelivery(null);
    setFinished(false);
    setMessage("");
    if (!workflowId || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(workflowId)) {
      setMessage("This workflow bookmark is invalid.");
      return;
    }
    void uploadCall<Delivery>({ action: "delivery", workflowId }, current.signal).then((result) => {
      if (result.completed) {
        setFinished(true);
        return;
      }
      setDelivery(result);
      setStyle(result.preset);
    }).catch((error) => {
      if (!current.signal.aborted) setMessage(error.message);
    });
    const stop = onProviderStop(() => {
      current.abort();
      setDelivery(null);
      reset();
      setMessage("This workflow stopped. Reload to revalidate account access.");
    });
    return () => {
      current.abort();
      stop();
    };
  }, [owner, workflowId]);
  useEffect(() => {
    const expiry = Math.min(
      ...[delivery?.expiresAt, batch?.expiresAt].filter((x): x is string => !!x).map(Date.parse),
    );
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => {
      reset();
      if (delivery && Date.parse(delivery.expiresAt) <= Date.now()) setDelivery(null);
      setMessage("Verification or workflow time expired. Recheck before generating more files.");
    }, Math.max(0, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [delivery?.expiresAt, batch?.expiresAt]);
  async function perform(task: () => Promise<void>) {
    if (active.current || controller.current?.signal.aborted) return;
    active.current = true;
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (error) {
      if (!controller.current?.signal.aborted) {
        setMessage(error instanceof Error ? error.message : "Could not complete this request.");
      }
    } finally {
      active.current = false;
      if (!controller.current?.signal.aborted) setBusy(false);
    }
  }
  const call = <T,>(body: Record<string, unknown>) =>
    uploadCall<T>({ ...body, workflowId }, controller.current?.signal);
  async function verify() {
    if (!delivery) return;
    reset();
    for (const job of delivery.jobs) {
      const result = await call<{ state: string }>({ action: "preprint", jobId: job.jobId });
      if (result.state !== "completed") {
        throw new Error(
          "An upload is still processing or cannot be verified. Resolve it before downloading.",
        );
      }
    }
    setDelivery(await call<Delivery>({ action: "delivery" }));
    setMessage(
      "Provider checks completed. Public/Unlisted videos also need the signed-out playback verifier before files can be prepared. Refresh readiness to check its result.",
    );
  }
  async function prepare() {
    if (!checked) throw new Error("Complete the pre-print checklist first.");
    const result = await client.from("albums").update({ qr_preset_id: style }).eq(
      "id",
      delivery!.albumId,
    ).eq("owner_id", owner).abortSignal(controller.current!.signal);
    if (result.error) throw new Error("Could not save the album style.");
    const next = await call<DownloadBatch>({ action: "downloads" });
    reset();
    setBatch(next);
  }
  async function acknowledge(kind: string) {
    await call({ action: "downloaded", batchId: batch!.batchId, kind });
  }
  async function finish() {
    if (!confirm || !batch) return;
    await call({ action: "finish", batchId: batch.batchId, confirmSaved: true });
    controller.current?.abort();
    reset();
    setDelivery(null);
    setFinished(true);
    setBusy(false);
  }
  const qrEntries = batch?.entries.filter((entry) => entry.qrEligible) ?? [];
  const allSaved = saved.links && (!qrEntries.length || (saved.sheet && saved.individual));
  return (
    <section className="print-screen">
      <div className="print-controls">
        <h2>Download and print</h2>
        <NavigationGuard
          when={!!batch && !finished}
          message="Leaving clears this preview. Keep downloaded files for reprinting; return here to revalidate before generating new files."
        />
        <p>
          Codes open YouTube directly. Anyone with an Unlisted link can watch and share it. Private
          videos are excluded from QR codes.
        </p>
        {finished
          ? (
            <p>
              Workflow completed. Temporary links, jobs and credentials were removed. Your YouTube
              videos and downloaded files remain unchanged. This bookmark cannot regenerate them.
            </p>
          )
          : delivery && (
            <>
              <h3>{delivery.albumTitle}</h3>
              <ul>
                {delivery.jobs.map((job) => (
                  <li key={job.jobId}>
                    {job.caption || "Video"}: {job.qrEligible
                      ? "Ready for QR"
                      : job.visibility === "private"
                      ? "Private — no QR"
                      : `${job.state} — verification required`}
                  </li>
                ))}
              </ul>
              <button type="button" disabled={busy} onClick={() => void perform(verify)}>
                Verify destinations for printing
              </button>{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    setDelivery(await call<Delivery>({ action: "delivery" }));
                  })}
              >
                Refresh readiness
              </button>
              <p>
                Temporary workflow expires{" "}
                {new Date(delivery.expiresAt).toLocaleString()}. A failed or unresolved upload must
                be cancelled from its upload screen before completion.
              </p>
              <label>
                QR style{" "}
                <select
                  disabled={busy || !!batch}
                  value={style}
                  onChange={(e) => setStyle(Number(e.target.value))}
                >
                  {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>{" "}
              <label>
                <input
                  type="checkbox"
                  disabled={!!batch}
                  checked={numbering}
                  onChange={(e) => setNumbering(e.target.checked)}
                />Number codes
              </label>
              <p>
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                  />I have checked the intended destinations and access, and will keep these
                  sensitive downloads for reprinting. After completion the app cannot recover them.
                </label>
              </p>
              <button
                type="button"
                disabled={busy || !checked || !delivery.jobs.length}
                onClick={() => void perform(prepare)}
              >
                Prepare verified files
              </button>
            </>
          )}
        {batch && (
          <>
            <p>
              Files verified until{" "}
              {new Date(batch.expiresAt).toLocaleTimeString()}. Save all required downloads before
              finishing.
            </p>
            {qrEntries.length > 0 && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      downloadFile(
                        "videoalbum-sheet.html",
                        printableSheet(batch, style, numbering),
                        "text/html",
                      );
                      await acknowledge("sheet");
                      setSaved((s) => ({ ...s, sheet: true }));
                    })}
                >
                  Download A4 sheet
                </button>{" "}
                <button type="button" disabled={busy} onClick={() => globalThis.print()}>
                  Print / Save as PDF
                </button>
                <p>
                  Print at 100% on A4, turn browser headers/footers off, and test a printed code
                  with a signed-out phone before using it in your album. Codes are 32 mm square with
                  a four-module quiet zone.
                </p>
                <ul>
                  {qrEntries.map((entry, index) => (
                    <li key={entry.jobId}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            downloadFile(
                              `videoalbum-code-${index + 1}.svg`,
                              qrSvg(entry.destination, style),
                              "image/svg+xml",
                            );
                            const ids = [...new Set([...individual, entry.jobId])];
                            setIndividual(ids);
                            if (ids.length === qrEntries.length) {
                              await acknowledge("individual");
                              setSaved((s) => ({ ...s, individual: true }));
                            }
                          })}
                      >
                        Download SVG {index + 1}
                        {individual.includes(entry.jobId) ? " ✓" : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  downloadFile(
                    "videoalbum-captions-and-links-v1.json",
                    captionsExport(batch),
                    "application/json",
                  );
                  await acknowledge("links");
                  setSaved((s) => ({ ...s, links: true }));
                })}
            >
              Download captions and links
            </button>
            <p>
              <label>
                <input
                  type="checkbox"
                  disabled={!allSaved}
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />I have saved the offered files. Finish and remove temporary provider data now.
              </label>
            </p>
            <button
              type="button"
              disabled={busy || !allSaved || !confirm}
              onClick={() => void perform(finish)}
            >
              Finish workflow
            </button>
          </>
        )}
        <p role="status">{message}</p>
        <p>
          <Link to="/videos">Your videos</Link>
        </p>
      </div>
      {batch && qrEntries.length > 0 && (
        <div className="qr-sheet">
          <h2>{batch.albumTitle}</h2>
          <div className="qr-grid">
            {qrEntries.map((entry, index) => (
              <article key={entry.jobId}>
                <QrPreview destination={entry.destination} preset={style} />
                <p>{numbering ? `${index + 1}. ` : ""}{entry.caption}</p>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
export function PrintPage() {
  const { owner, canAccess } = useAppAccess();
  return owner && canAccess ? <Print key={owner} owner={owner} /> : null;
}

function QrPreview({ destination, preset }: { destination: string; preset: number }) {
  const { view, path, ink } = qrGeometry(destination, preset);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32mm"
      height="32mm"
      viewBox={`0 0 ${view} ${view}`}
      role="img"
      aria-label="YouTube video QR code"
    >
      <rect width={view} height={view} fill="#ffffff" />
      <path d={path} fill={ink} shapeRendering="crispEdges" />
    </svg>
  );
}
