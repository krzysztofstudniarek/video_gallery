import "./print.css";
import { type PrintableDocument, sheetRows } from "./artifacts";
import { QrPreview } from "./QrPreview";

export function PrintSheet({ document, preset, numbering }: {
  document: PrintableDocument;
  preset: number;
  numbering: boolean;
}) {
  return (
    <>
      <div className="qr-sheet">
        <h2>{document.albumTitle}</h2>
        {sheetRows(document.entries).map((row) => (
          <div
            key={row[0].number}
            className={`qr-row${row[0].entry.caption.length > 240 ? " long-caption" : ""}`}
          >
            {row.map(({ entry, number }) => (
              <article key={number}>
                <QrPreview destination={entry.destination} preset={preset} />
                <p>{numbering ? `${number}. ` : ""}{entry.caption}</p>
              </article>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
