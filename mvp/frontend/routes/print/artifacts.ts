import sheetCss from "./print.css?inline";
import QRCode from "qrcode";
import { youtubeWatchDestination } from "../videos/video-selection";

export const presets = [
  { id: 1, name: "Classic Black", ink: "#111111" },
  { id: 2, name: "Warm Sepia", ink: "#563b29" },
  { id: 3, name: "Botanical Green", ink: "#1d4b35" },
  { id: 4, name: "Navy Minimal", ink: "#17324f" },
] as const;
export type PrintableEntry = {
  caption: string;
  visibility: string;
  qrEligible: boolean;
  destination: string;
};
export type PrintableDocument = {
  albumTitle: string;
  preset: number;
  entries: PrintableEntry[];
};
export type DownloadEntry = PrintableEntry & { videoId: string; jobId: string };
export type DownloadBatch = Omit<PrintableDocument, "entries"> & {
  workflowId: string;
  batchId: string;
  expiresAt: string;
  albumTitle: string;
  preset: number;
  entries: DownloadEntry[];
};
export function escapeMarkup(value: string) {
  return value.replace(
    /[&<>"']/g,
    (
      character,
    ) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!),
  );
}
export function qrGeometry(destination: string, presetId: number) {
  const url = youtubeWatchDestination(destination);
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) throw new Error("Choose a predefined QR style.");
  const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
  const size = modules.size, view = size + 8;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (modules.get(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
  }
  return { view, path, ink: preset.ink };
}
export function qrSvg(destination: string, presetId: number) {
  const { view, path, ink } = qrGeometry(destination, presetId);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32mm" height="32mm" viewBox="0 0 ${view} ${view}" role="img" aria-label="YouTube video QR code"><rect width="${view}" height="${view}" fill="#ffffff"/><path d="${path}" fill="${ink}" shape-rendering="crispEdges"/></svg>`;
}
export function captionsExport(batch: PrintableDocument) {
  return JSON.stringify(
    {
      schema: "videoalbum.captions-and-links",
      version: 1,
      albumTitle: batch.albumTitle,
      preset: batch.preset,
      entries: batch.entries.map((entry) => ({
        caption: entry.caption,
        visibility: entry.visibility,
        youtubeWatchUrl: youtubeWatchDestination(entry.destination),
      })),
    },
    null,
    2,
  ) + "\n";
}
// The same rows and physical CSS drive the screen preview and standalone HTML.
// Long captions use a whole row, keeping a 2,000-character app caption and its QR
// together within A4's printable height. Whitespace collapses to avoid blank-line overflow.
export function sheetRows(entries: PrintableEntry[]) {
  const rows: { entry: PrintableEntry; number: number }[][] = [];
  entries.filter((entry) => entry.qrEligible).forEach((entry, index) => {
    const card = { entry, number: index + 1 };
    if (entry.caption.length > 240) rows.push([card]);
    else {
      const last = rows.at(-1);
      if (last && last.length < 3 && last[0].entry.caption.length <= 240) last.push(card);
      else rows.push([card]);
    }
  });
  return rows;
}
export function printableSheet(batch: PrintableDocument, preset: number, numbering: boolean) {
  const rows = sheetRows(batch.entries).map((row) =>
    `<div class="qr-row${row[0].entry.caption.length > 240 ? " long-caption" : ""}">${
      row.map(({ entry, number }) =>
        `<article>${qrSvg(entry.destination, preset)}<p>${numbering ? `${number}. ` : ""}${
          escapeMarkup(entry.caption)
        }</p></article>`
      ).join("")
    }</div>`
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${
    escapeMarkup(batch.albumTitle)
  }</title><style>${sheetCss}</style></head><body><div class="qr-sheet"><h2>${
    escapeMarkup(batch.albumTitle)
  }</h2>${rows}</div></body></html>`;
}
export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
