import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useAppAccess } from "../../app/App";
import { client } from "../../auth/client";
import { onProviderStop } from "../../auth/provider-stop";
import { usePrintDrafts } from "../../app/PrintDrafts";
import { uploadCall } from "../uploads/upload-client";
import {
  captionsExport,
  type DownloadBatch,
  downloadFile,
  presets,
  printableSheet,
  qrSvg,
} from "./artifacts";
import { PrintSheet } from "./PrintSheet";

type Delivery = {
  completed?: boolean;
  savedBatchId?: string | null;
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
    verifiedAt?: string;
  }[];
};
function Print({ owner }: { owner: string }) {
  const { workflowId } = useParams();
  const drafts = usePrintDrafts();
  const draftKey = `print:${workflowId}`;
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
  const [savedBatchId, setSavedBatchId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const controller = useRef<AbortController | null>(null), active = useRef(false);
  const clearPreview = () => {
    setBatch(null);
    setSaved({ sheet: false, individual: false, links: false });
    setIndividual([]);
    setConfirm(false);
  };
  const reset = () => {
    clearPreview();
    setSavedBatchId(null);
  };
  function receiveDelivery(result: Delivery) {
    setDelivery(result);
    setSavedBatchId(result.savedBatchId ?? null);
  }
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    reset();
    setDelivery(null);
    setFinished(false);
    setChecked(false);
    setMessage("");
    if (!workflowId || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(workflowId)) {
      setMessage("This workflow bookmark is invalid.");
      return;
    }
    void uploadCall<Delivery>({ action: "delivery", workflowId }, current.signal).then((result) => {
      if (result.completed) {
        drafts.remove(draftKey);
        setFinished(true);
        return;
      }
      receiveDelivery(result);
      const draft = drafts.read<{ style: number; numbering: boolean }>(draftKey);
      setStyle(draft?.style ?? result.preset);
      setNumbering(draft?.numbering ?? true);
    }).catch((error) => {
      if (!current.signal.aborted) setMessage(error.message);
    });
    const stop = onProviderStop(() => {
      current.abort();
      drafts.remove(draftKey);
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
    const readiness = delivery?.jobs.filter((job) => job.qrEligible && job.verifiedAt)
      .map((job) => Date.parse(job.verifiedAt!) + 300_000) ?? [];
    const expiry = Math.min(
      ...[delivery?.expiresAt, batch?.expiresAt].filter((x): x is string => !!x).map(Date.parse),
      ...readiness,
    );
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => {
      clearPreview();
      if (delivery && Date.parse(delivery.expiresAt) <= Date.now()) {
        setDelivery(null);
        setSavedBatchId(null);
        setMessage("This workflow expired. Its bookmark cannot recreate purged work.");
      } else {
        setDelivery((current) =>
          current && ({
            ...current,
            jobs: current.jobs.map((job) => ({
              ...job,
              qrEligible: job.qrEligible && !!job.verifiedAt &&
                Date.parse(job.verifiedAt) + 300_000 > Date.now(),
            })),
          })
        );
        setMessage(
          "Verification expired. Recheck before generating more files.",
        );
      }
    }, Math.max(0, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [delivery, batch?.expiresAt]);
  useEffect(() => {
    if (delivery && !finished && !controller.current?.signal.aborted) {
      drafts.write(draftKey, { style, numbering }, Date.parse(delivery.expiresAt));
    }
  }, [delivery, style, numbering, finished]);
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
    receiveDelivery(await call<Delivery>({ action: "delivery" }));
    setMessage(
      "Processing and visibility checks completed. Verified Public/Unlisted videos are ready for QR files; Private videos are included only in your captions-and-links export.",
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
  async function acknowledge(kind: keyof typeof saved) {
    await call({ action: "downloaded", batchId: batch!.batchId, kind });
    const next = { ...saved, [kind]: true };
    setSaved(next);
    if (
      next.links && (!batch!.entries.some((entry) => entry.qrEligible) ||
        (next.sheet && next.individual))
    ) setSavedBatchId(batch!.batchId);
  }
  async function finish() {
    if (!confirm || !savedBatchId) return;
    await call({ action: "finish", batchId: savedBatchId, confirmSaved: true });
    controller.current?.abort();
    drafts.remove(draftKey);
    reset();
    setDelivery(null);
    setFinished(true);
    setBusy(false);
  }
  const qrEntries = batch?.entries.filter((entry) => entry.qrEligible) ?? [];
  return (
    <section className="print-screen">
      <div className="print-controls">
        <h2>Download and print</h2>
        <p>
          Style and numbering survive app navigation in this tab until expiry. Returning rechecks
          access and clears the preview and checklist. Reloading resets unsaved choices. Downloaded
          files remain your source for reprinting.
        </p>
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
                    receiveDelivery(await call<Delivery>({ action: "delivery" }));
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
                })}
            >
              Download captions and links
            </button>
          </>
        )}
        {(batch || savedBatchId) && (
          <>
            {!batch && (
              <p>Your file downloads were acknowledged. Confirm below to finish this workflow.</p>
            )}
            <p>
              <label>
                <input
                  type="checkbox"
                  disabled={!savedBatchId}
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />I have saved the offered files. Finish and remove temporary provider data now.
              </label>
            </p>
            <button
              type="button"
              disabled={busy || !savedBatchId || !confirm}
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
        <PrintSheet document={batch} preset={style} numbering={numbering} />
      )}
    </section>
  );
}
export function PrintPage() {
  const { owner, canAccess } = useAppAccess();
  return owner && canAccess ? <Print key={owner} owner={owner} /> : null;
}
