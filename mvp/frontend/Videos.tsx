import { useEffect, useState } from "react";
import { client } from "./client";
import { loadVideoLibrary } from "./video-library";
import { availableChoice, selectedChoices, type VideoItem } from "./video-selection";

export function Videos({ owner }: { owner: string }) {
  const [items, setItems] = useState<VideoItem[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setSelected([]);
    setError("");
    void loadVideoLibrary(client, owner, controller.signal).then((rows) => {
      if (!controller.signal.aborted) {
        setNow(Date.now());
        setItems(rows);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load videos. Try again.");
    });
    return () => controller.abort();
  }, [owner, revision]);

  useEffect(() => {
    // Recheck app data when returning to the page. This makes no provider requests.
    const refresh = () => setRevision((value) => value + 1);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    globalThis.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      globalThis.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  useEffect(() => {
    const expiry = Math.min(
      ...(items ?? []).flatMap((item) =>
        item.expiresAt !== null && item.expiresAt > now ? [item.expiresAt] : []
      ),
    );
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, expiry - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [items, now]);

  const choices = selectedChoices(items ?? [], selected, now);
  return (
    <section aria-labelledby="videos-title">
      <h2 id="videos-title">Your videos</h2>
      <p>Select verified videos for QR codes.</p>
      <button type="button" disabled aria-describedby="upload-availability">Upload videos</button>
      <p id="upload-availability">YouTube uploads are not available on this screen yet.</p>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        Refresh videos
      </button>
      {error
        ? <p role="alert">{error}</p>
        : items === null
        ? <p role="status">Loading videos…</p>
        : items.length === 0
        ? <p>No videos yet. Uploaded videos will appear here.</p>
        : (
          <ul>
            {items.map((item, index) => {
              const label = item.caption || `Video ${index + 1}`;
              const available = availableChoice(item, now) !== null;
              const live = item.expiresAt !== null && item.expiresAt > now;
              return (
                <li key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Select ${label} for QR code`}
                      disabled={!available}
                      checked={available && selected.includes(item.id)}
                      onChange={(event) => {
                        setSelected((ids) =>
                          event.target.checked
                            ? [...ids, item.id]
                            : ids.filter((id) => id !== item.id)
                        );
                      }}
                    />{" "}
                    {label}
                  </label>{" "}
                  <small>({item.albumTitle})</small>
                  <p>{live ? item.status : "No active upload — QR unavailable"}</p>
                </li>
              );
            })}
          </ul>
        )}
      <p role="status">
        {choices.length} {choices.length === 1 ? "video" : "videos"} selected for QR codes.
      </p>
    </section>
  );
}
