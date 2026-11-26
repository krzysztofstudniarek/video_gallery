import { useEffect, useRef, useState } from "react";
import { client } from "../../auth/client";
import { onProviderStop } from "../../auth/provider-stop";
import type { ChannelQrChoice } from "../videos/video-selection";
import { type ChannelDestinations, verifyChannelSelection } from "../videos/channel-library";
import { captionsExport, downloadFile, presets, printableSheet, qrSvg } from "./artifacts";
import { QrPreview } from "./QrPreview";
import "./print.css";

// Selection and files live only in this mounted screen. No history, local/session storage,
// upload jobs or persistent provider records are created for existing channel videos.
export function ChannelQrDownloads({
  choices,
  expiresAt,
}: {
  choices: ChannelQrChoice[];
  expiresAt: number;
}) {
  const [batch, setBatch] = useState<ChannelDestinations | null>(null);
  const [style, setStyle] = useState(1), [numbering, setNumbering] = useState(true);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [checked, setChecked] = useState(false), [stopped, setStopped] = useState(false);
  const controller = useRef<AbortController | null>(null), active = useRef(false);
  const deadline = Math.min(expiresAt, batch ? Date.parse(batch.expiresAt) : expiresAt);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    const stop = onProviderStop(() => {
      current.abort();
      setBatch(null);
      setStopped(true);
      setMessage("YouTube work stopped. Refresh videos to check access again.");
    });
    return () => {
      current.abort();
      stop();
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      controller.current?.abort();
      setBatch(null);
      setStopped(true);
      setMessage("This selection expired. Refresh videos and select again.");
    }, Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline]);

  async function perform(task: (signal: AbortSignal) => Promise<void>) {
    const signal = controller.current?.signal;
    if (active.current || !signal || signal.aborted || deadline <= Date.now()) return;
    active.current = true;
    setBusy(true);
    setMessage("");
    try {
      await task(signal);
    } catch (error) {
      if (!signal.aborted) {
        setBatch(null);
        setMessage(error instanceof Error ? error.message : "Could not prepare these videos.");
      }
    } finally {
      active.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  async function prepare(signal: AbortSignal) {
    setBatch(null);
    const result = await verifyChannelSelection(client, choices, signal);
    if (expiresAt <= Date.now()) throw new Error("This selection expired. Refresh videos.");
    setBatch(result);
  }

  async function download(kind: "sheet" | "links" | "svg" | "print", id?: string) {
    await perform(async (signal) => {
      if (!batch || !checked) return;
      // Recheck the live owner/workflow and every selected video's API status at the file boundary.
      // The preview cannot authorize a later download after privacy changes or disconnect.
      const current = await verifyChannelSelection(client, choices, signal);
      signal.throwIfAborted();
      if (deadline <= Date.now()) throw new Error("This selection expired. Refresh videos.");
      if (JSON.stringify(current.entries) !== JSON.stringify(batch.entries)) {
        throw new Error("A selected video changed. Prepare verified files again.");
      }
      const document = { ...batch, albumTitle: "Selected Unlisted videos", preset: style };
      if (kind === "sheet") {
        downloadFile(
          "videoalbum-sheet.html",
          printableSheet(document, style, numbering),
          "text/html",
        );
      } else if (kind === "links") {
        downloadFile(
          "videoalbum-captions-and-links-v1.json",
          captionsExport(document),
          "application/json",
        );
      } else if (kind === "svg") {
        const index = batch.entries.findIndex((entry) => entry.id === id);
        if (index < 0) throw new Error("Select the video again.");
        downloadFile(
          `videoalbum-code-${index + 1}.svg`,
          qrSvg(batch.entries[index].destination, style),
          "image/svg+xml",
        );
      } else {
        globalThis.print();
      }
    });
  }

  return (
    <section aria-labelledby="channel-print-title">
      <div className="print-controls">
        <h3 id="channel-print-title">Print selected Unlisted videos</h3>
        <p>
          {choices.length} existing channel {choices.length === 1 ? "video" : "videos"}{" "}
          selected. Uploaded videos use their workflow download links above. Select up to 50
          existing videos per sheet. Codes open YouTube directly; anyone with an Unlisted link can
          watch and share it.
        </p>
        <label>
          QR style{" "}
          <select
            value={style}
            disabled={busy || stopped}
            onChange={(e) => setStyle(Number(e.target.value))}
          >
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>{" "}
        <label>
          <input
            type="checkbox"
            checked={numbering}
            disabled={busy || stopped}
            onChange={(e) => setNumbering(e.target.checked)}
          />
          Number codes
        </label>
        <p>
          <label>
            <input
              type="checkbox"
              checked={checked}
              disabled={busy || stopped}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I will keep these sensitive downloads for reprinting.
          </label>
        </p>
        <button
          type="button"
          disabled={busy || stopped || !checked || choices.length > 50}
          onClick={() => void perform(prepare)}
        >
          Prepare selected Unlisted QR files
        </button>
        {batch && (
          <>
            <p>Files verified until {new Date(deadline).toLocaleTimeString()}.</p>
            <button
              type="button"
              disabled={busy || !checked || stopped}
              onClick={() => void download("sheet")}
            >
              Download selected A4 sheet
            </button>{" "}
            <button
              type="button"
              disabled={busy || !checked || stopped}
              onClick={() => void download("print")}
            >
              Print selected / Save as PDF
            </button>
            <p>Print at 100% on A4 with browser headers and footers off.</p>
            <ul>
              {batch.entries.map((entry, index) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={busy || !checked || stopped}
                    onClick={() => void download("svg", entry.id)}
                  >
                    Download selected SVG {index + 1}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={busy || !checked || stopped}
              onClick={() => void download("links")}
            >
              Download selected captions and links
            </button>
          </>
        )}
        <p role="status">{busy ? "Checking selected videos…" : message}</p>
      </div>
      {batch && (
        <div className="qr-sheet">
          <h2>Selected Unlisted videos</h2>
          <div className="qr-grid">
            {batch.entries.map((entry, index) => (
              <article key={entry.id}>
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
