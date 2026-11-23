import QRCode from "qrcode";
import { youtubeWatchDestination } from "../videos/video-selection";

export const presets = [
  { id: 1, name: "Classic Black", ink: "#111111" },
  { id: 2, name: "Warm Sepia", ink: "#563b29" },
  { id: 3, name: "Botanical Green", ink: "#1d4b35" },
  { id: 4, name: "Navy Minimal", ink: "#17324f" },
] as const;
export type DownloadEntry = {
  videoId: string;
  jobId: string;
  caption: string;
  visibility: string;
  qrEligible: boolean;
  destination: string;
};
export type DownloadBatch = {
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
export function captionsExport(batch: DownloadBatch) {
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
export function printableSheet(batch: DownloadBatch, preset: number, numbering: boolean) {
  const cards = batch.entries.filter((entry) => entry.qrEligible).map((entry, index) =>
    `<article>${qrSvg(entry.destination, preset)}<p>${numbering ? `${index + 1}. ` : ""}${
      escapeMarkup(entry.caption)
    }</p></article>`
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${
    escapeMarkup(batch.albumTitle)
  }</title><style>@page{size:A4;margin:12mm}body{font:10pt sans-serif;margin:0;color:#111;background:white}h1{font-size:16pt}section{display:grid;grid-template-columns:repeat(3,56mm);gap:8mm}article{width:56mm;min-height:52mm;break-inside:avoid;text-align:center}svg{width:32mm;height:32mm}p{margin:3mm;overflow-wrap:anywhere;white-space:pre-wrap}</style></head><body><h1>${
    escapeMarkup(batch.albumTitle)
  }</h1><section>${cards}</section></body></html>`;
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
