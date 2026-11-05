import { useEffect, useRef, useState } from "react";
import { client } from "../../auth/client";
import { rememberReturn } from "../../auth/routing-policy";

type Connection = {
  connected: boolean;
  channel: { id: string; title: string } | null;
  expiresAt: string | null;
};
export function YoutubeConnection({ owner }: { owner: string }) {
  const lifetime = useRef<AbortController | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function request(action: string, signal?: AbortSignal) {
    const { data, error } = await client.functions.invoke("youtube", {
      body: { action },
      signal: signal ?? lifetime.current?.signal,
    });
    if (error) {
      throw new Error(
        "YouTube request could not be completed. Check your connection and try again.",
      );
    }
    return data;
  }
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void request("connection", controller.signal).then((data) => {
      if (!controller.signal.aborted) setConnection(data);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setMessage("Could not check YouTube connection. Reload to retry.");
      }
    });
    return () => controller.abort();
  }, [owner]);
  useEffect(() => {
    if (!connection?.expiresAt) return;
    const timer = setTimeout(() => {
      setConnection({ connected: false, channel: null, expiresAt: null });
      setMessage("This YouTube workflow expired. Connect again to start new work.");
    }, Math.max(0, Date.parse(connection.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [connection]);
  async function connect() {
    setBusy(true);
    setMessage("");
    try {
      const result = await request("connect");
      const url = new URL(result.authorization_url);
      if (url.origin !== "https://accounts.google.com") throw new Error("consent");
      const { data } = await client.auth.getSession();
      if (lifetime.current?.signal.aborted || data.session?.user.id !== owner) return;
      rememberReturn(sessionStorage, "youtube", "/account", owner);
      location.assign(url.href);
    } catch {
      setMessage("Could not start YouTube consent. Check configuration or reload and try again.");
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setMessage("");
    try {
      const result = await request("workflow_disconnect");
      setConnection({ connected: false, channel: null, expiresAt: null });
      setMessage(
        result.provider_revocation_pending
          ? "Disconnected locally. Google access revocation is pending; retry below or remove access in your Google account. Local erasure does not revoke the Google grant."
          : result.provider_revocation_confirmed
          ? "Disconnected. Google access was revoked. Your YouTube videos and printed codes are unchanged."
          : "Disconnected locally. Google grant revocation could not be confirmed because no revocation material remains. You can remove access in your Google account. Your videos and printed codes are unchanged.",
      );
    } catch {
      setMessage("Disconnect could not be confirmed. Retry disconnect before continuing work.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="youtube-title">
      <h2 id="youtube-title">YouTube channel</h2>
      <p>
        Authorize YouTube separately from Google sign-in. Choose the channel that owns your videos.
      </p>
      {connection?.channel && (
        <p>Destination: {connection.channel.title} ({connection.channel.id}).</p>
      )}
      {connection?.expiresAt && (
        <p>
          Connection expires by{" "}
          {new Date(connection.expiresAt).toLocaleString()}. Finishing or cancelling the workflow
          erases its temporary connection.
        </p>
      )}
      <p>
        Disconnect stops local work and requests Google access revocation. Your YouTube videos and
        printed codes remain unchanged.
      </p>
      <button
        type="button"
        disabled={busy || !connection || connection.connected}
        onClick={() => void connect()}
      >
        Connect YouTube
      </button>{" "}
      <button type="button" disabled={busy} onClick={() => void disconnect()}>
        Disconnect / retry Google revocation
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
