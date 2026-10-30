import { useEffect, useRef, useState } from "react";
import { client } from "./client";
import { NavigationGuard } from "./NavigationGuard";
import { channelItems, type ChannelPage, loadChannelPage } from "./channel-library";
import { loadVideoLibrary } from "./video-library";
import { availableChoice, selectedChoices, type VideoItem } from "./video-selection";

export function Videos({ owner }: { owner: string }) {
  const [items, setItems] = useState<VideoItem[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [channel, setChannel] = useState<ChannelPage | null>(null);
  const [channelRows, setChannelRows] = useState<VideoItem[]>([]);
  const [channelError, setChannelError] = useState("");
  const [channelLoading, setChannelLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const moreRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setSelected([]);
    setError("");
    moreRequest.current?.abort();
    setMoreLoading(false);
    setChannel(null);
    setChannelRows([]);
    setChannelError("");
    setChannelLoading(true);
    void loadVideoLibrary(client, owner, controller.signal).then((rows) => {
      if (!controller.signal.aborted) {
        setNow(Date.now());
        setItems(rows);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load videos. Try again.");
    });
    void loadChannelPage(controller.signal).then((page) => {
      if (!controller.signal.aborted) {
        setChannel(page);
        setChannelRows(channelItems(page));
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setChannelError("Could not load existing YouTube videos. Refresh to try again.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setChannelLoading(false);
    });
    return () => {
      controller.abort();
      moreRequest.current?.abort();
    };
  }, [owner, revision]);

  useEffect(() => {
    // Reload temporary channel data when returning to the page.
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

  const uploadedIds = new Set(
    (items ?? []).flatMap((item) => item.providerId ? [item.providerId] : []),
  );
  const rows = error
    ? []
    : [...(items ?? []), ...channelRows.filter((item) => !uploadedIds.has(item.providerId!))];

  useEffect(() => {
    const expiry = Math.min(
      ...[...(items ?? []), ...channelRows].flatMap((item) =>
        item.expiresAt !== null && item.expiresAt > now ? [item.expiresAt] : []
      ),
      ...(channel?.expiresAt && Date.parse(channel.expiresAt) > now
        ? [Date.parse(channel.expiresAt)]
        : []),
    );
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => {
      const at = Date.now();
      setNow(at);
      setSelected((ids) =>
        ids.filter((id) =>
          [...(items ?? []), ...channelRows].some((item) =>
            item.id === id && availableChoice(item, at)
          )
        )
      );
      setItems((items) =>
        items?.map((item) =>
          item.expiresAt !== null && item.expiresAt <= at
            ? {
              ...item,
              providerId: undefined,
              choice: null,
              expiresAt: null,
              status: "No active upload — QR unavailable",
            }
            : item
        ) ?? null
      );
      setChannelRows((items) =>
        items.filter((item) => item.expiresAt !== null && item.expiresAt > at)
      );
      setChannel((page) => page?.expiresAt && Date.parse(page.expiresAt) <= at ? null : page);
    }, Math.max(0, expiry - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [items, channelRows, channel, now]);

  async function loadMore() {
    if (moreLoading || !channel?.nextPageToken) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setMoreLoading(true);
    setChannelError("");
    try {
      const page = await loadChannelPage(controller.signal, channel);
      if (!controller.signal.aborted) {
        setChannel(page);
        setChannelRows((
          rows,
        ) => [
          ...new Map([...rows, ...channelItems(page)].map((item) => [item.id, item])).values(),
        ]);
      }
    } catch {
      if (!controller.signal.aborted) {
        setChannelRows([]);
        setChannel(null);
        setSelected((ids) => ids.filter((id) => !id.startsWith("channel:")));
        setChannelError("Could not load existing YouTube videos. Refresh to try again.");
      }
    } finally {
      if (!controller.signal.aborted) setMoreLoading(false);
    }
  }

  const choices = selectedChoices(rows, selected, now);
  return (
    <section aria-labelledby="videos-title">
      <h2 id="videos-title">Your videos</h2>
      <NavigationGuard
        when={choices.length > 0}
        message="Leaving clears your current QR selection. Your saved videos are unchanged; reselect them when you return."
      />
      <p>Select verified videos for QR codes.</p>
      <button type="button" disabled aria-describedby="upload-availability">Upload videos</button>
      <p id="upload-availability">YouTube uploads are not available on this screen yet.</p>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        Refresh videos
      </button>
      {channelLoading && <p role="status">Checking connected YouTube channel…</p>}
      {channel?.connected === false && (
        <p>
          Connect your YouTube channel to include its existing Unlisted videos. Channel connection
          is not available on this screen yet.
        </p>
      )}
      {channelError && <p role="alert">{channelError}</p>}
      {error
        ? <p role="alert">{error}</p>
        : items === null || (channelLoading && rows.length === 0)
        ? <p role="status">Loading videos…</p>
        : rows.length === 0
        ? (
          <p>
            {channel?.connected
              ? channel.nextPageToken
                ? "No Unlisted videos on this page. Load more to continue."
                : "No Unlisted videos found on this channel."
              : "No videos yet. Uploaded videos will appear here."}
          </p>
        )
        : (
          <ul>
            {rows.map((item, index) => {
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
      {channel?.nextPageToken && (
        <button
          type="button"
          disabled={moreLoading}
          onClick={() => void loadMore()}
        >
          {moreLoading ? "Loading more videos…" : "Load more YouTube videos"}
        </button>
      )}
    </section>
  );
}
