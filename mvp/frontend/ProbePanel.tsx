import { useEffect, useRef, useState } from "react";
import { mountProbe } from "./probe";
import { NavigationGuard } from "./NavigationGuard";

export function Probe() {
  const root = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    mountProbe(root.current!, controller.signal, setBusy);
    return () => controller.abort();
  }, []);
  return (
    <section
      ref={root}
      aria-label="YouTube validation tools"
      onChangeCapture={() => setDirty(true)}
    >
      <NavigationGuard
        when={busy || dirty}
        message="Leaving stops this browser’s pending request or transfer and clears selected inputs. It does not cancel a video at YouTube. Resume/check the existing upload before starting another."
      />
      <h2>Compatibility tools</h2>
      <p>Use a dedicated test channel and synthetic media.</p>
      <button type="button" id="probe">Run authenticated probe</button>
      <section>
        <h2>YouTube upload validation</h2>
        <p>
          This separate consent lets VideoAlbum upload and read video/channel status. Use a test
          channel and a synthetic MP4, up to 10 MiB. No automatic uploads occur.
        </p>
        <p id="youtube-status" aria-live="polite">Sign in to connect YouTube.</p>
        <button type="button" id="youtube-connect">Connect YouTube</button>
        <button type="button" id="youtube-status-refresh">Check connection</button>
        <button type="button" id="youtube-refresh">Test server-side token refresh</button>
        <button type="button" id="youtube-disconnect">Disconnect and revoke YouTube access</button>
        <p>
          Disconnecting revokes this Google app's grant. Use a separate OAuth client for YouTube;
          existing YouTube videos are not deleted.
        </p>
        <label>
          Small test MP4 <input id="youtube-file" type="file" accept="video/mp4" />
        </label>
        <label>
          <input id="youtube-unlisted" type="checkbox" />{" "}
          I confirm the displayed destination channel and understand this test video will be
          Unlisted: anyone with its link can watch and share.
        </label>
        <label>
          Is this test video made for kids?{" "}
          <select id="youtube-kids">
            <option value="">Choose</option>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        <p>
          <button type="button" id="youtube-upload">Start one Unlisted test upload</button>
          <button type="button" id="youtube-pause">Pause after current chunk</button>
          <button type="button" id="youtube-resume">Resume / check existing upload</button>
          <button type="button" id="youtube-inspect">
            Inspect existing upload (no video transfer)
          </button>
          <button type="button" id="youtube-verify">Check processing and Unlisted status</button>
          <button type="button" id="youtube-clear">Clear probe record</button>
        </p>
        <p>
          Clearing forgets the resume record; it does not delete or cancel a YouTube video. Never
          clear an uncertain upload just to retry it. Completed test videos can be removed in
          YouTube Studio.
        </p>
        <progress id="youtube-progress" max={100} defaultValue={0}></progress>
      </section>
      <output aria-live="polite"></output>
    </section>
  );
}
