import { Link } from "react-router";
import { useAppAccess } from "../../app/App";
import { useEffect, useRef, useState } from "react";
import { client } from "../../auth/client";
import { usePrintDrafts } from "../../app/PrintDrafts";
import { onProviderStop } from "../../auth/provider-stop";
import { ChannelQrDownloads } from "../print/ChannelQrDownloads";
import { channelItems, type ChannelPage, loadChannelPage } from "./channel-library";
import { loadVideoLibrary } from "./video-library";
import {
  availableChoice,
  isChannelChoice,
  selectedChoices,
  type VideoItem,
} from "./video-selection";

function Videos({ owner }: { owner: string }) {
  const drafts = usePrintDrafts();
  const restored = useRef(drafts.read<{ selected: string[]; pages: number }>("videos"));
  const [pages, setPages] = useState(1);
  const [items, setItems] = useState<VideoItem[] | null>(null);
  const [selected, setSelected] = useState<string[]>(restored.current?.selected ?? []);
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
    if (revision > 0) {
      setSelected([]);
      restored.current = undefined;
      drafts.remove("videos");
    }
    setPages(1);
    setError("");
    moreRequest.current?.abort();
    setMoreLoading(false);
    setChannel(null);
    setChannelRows([]);
    setChannelError("");
    setChannelLoading(true);
    const stop = onProviderStop(() => {
      controller.abort();
      moreRequest.current?.abort();
      drafts.remove("videos");
      restored.current = undefined;
      setSelected([]);
      setItems([]);
      setChannelRows([]);
      setChannel(null);
      setChannelLoading(false);
      setMoreLoading(false);
      setChannelError("YouTube work stopped. Refresh videos to check access again.");
    });
    void loadVideoLibrary(client, owner, controller.signal).then((rows) => {
      if (!controller.signal.aborted) {
        setNow(Date.now());
        setItems(rows);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load videos. Try again.");
    });
    void (async () => {
      let page = await loadChannelPage(controller.signal);
      const rows = channelItems(page);
      let count = 1;
      while (page.nextPageToken && count < (restored.current?.pages ?? 1)) {
        page = await loadChannelPage(controller.signal, page);
        rows.push(...channelItems(page));
        count++;
      }
      return { page, rows, count };
    })().then(({ page, rows, count }) => {
      if (!controller.signal.aborted) {
        setChannel(page);
        setChannelRows([...new Map(rows.map((item) => [item.id, item])).values()]);
        setPages(count);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setChannelError("Could not load existing YouTube videos. Refresh to try again.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setChannelLoading(false);
    });
    return () => {
      stop();
      controller.abort();
      moreRequest.current?.abort();
    };
  }, [owner, revision]);

  useEffect(() => {
    // Reload temporary channel data when returning to the page.
    const refresh = () => setRevision((value) => value + 1);
    const focus = () => {
      // A native Save/Print dialog can return focus between the offered downloads. Preserve
      // that selection; each file action revalidates it. Returning from a hidden tab still resets.
      if (!selected.some((id) => id.startsWith("channel:"))) refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    globalThis.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    return () => {
      globalThis.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [selected]);

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
      if (channel?.expiresAt && Date.parse(channel.expiresAt) <= at) {
        moreRequest.current?.abort();
        setMoreLoading(false);
      }
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

  useEffect(() => {
    if (items === null || channelLoading) return;
    const valid = selected.filter((id) =>
      rows.some((item) => item.id === id && availableChoice(item, Date.now()))
    );
    if (valid.length !== selected.length) setSelected(valid);
    const expiry = Math.min(
      ...rows.filter((item) => valid.includes(item.id)).map((item) => item.expiresAt ?? 0),
    );
    if (valid.length && !error && !channelError) {
      drafts.write("videos", { selected: valid, pages }, expiry);
    } else drafts.remove("videos");
    restored.current = undefined;
  }, [items, channelLoading, channelRows, selected, pages, error, channelError]);

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
        setPages((value) => value + 1);
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
  const channelChoices = choices.filter(isChannelChoice);
  return (
    <section className="print-screen" aria-labelledby="videos-title">
      <div className="print-controls">
        <h2 id="videos-title">Your videos</h2>
        <p>Select verified videos for QR codes.</p>
        <p>
          Your selection and print choices stay in this tab during app navigation until the workflow
          expires. Returning checks eligibility again and clears prepared files and the checklist.
          Reloading or refreshing clears the selection; select videos again. Downloaded QR files
          must be kept for reprinting; the app cannot recover them later.
        </p>
        <p>
          <Link to="/uploads">Upload videos</Link>
        </p>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          Refresh videos
        </button>
        {channelLoading && <p role="status">Checking connected YouTube channel…</p>}
        {channel?.connected === false && (
          <p>
            <Link to="/account">Connect your YouTube channel</Link>{" "}
            to include its existing Unlisted videos.
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
                    {item.choice && "jobId" in item.choice && (
                      <Link to={`/workflows/${item.choice.workflowId}/print`}>
                        Verify and download workflow
                      </Link>
                    )}
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
      </div>
      {channelChoices.length > 0 && channel?.expiresAt && (
        <ChannelQrDownloads
          key={JSON.stringify(channelChoices)}
          choices={channelChoices}
          expiresAt={Date.parse(channel.expiresAt)}
        />
      )}
    </section>
  );
}

export function VideosPage() {
  const { owner, canAccess } = useAppAccess();
  if (!canAccess || !owner) return null;
  return <Videos key={owner} owner={owner} />;
}
