import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { authDenied, client, initialized, leaveAccount } from "./client";
import { Probe } from "./ProbePanel";
import { showValidationTools } from "./callback";
import { Videos } from "./Videos";

type Account = { owner: string; email?: string; deleting: boolean };

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const currentSession = useRef<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<Account | null>(null);
  const [locked, setLocked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(() => {
    const notice = sessionStorage.getItem("videoalbum.notice") ?? "";
    sessionStorage.removeItem("videoalbum.notice");
    return notice;
  });
  const [connection, setConnection] = useState("Checking backend connection…");

  useEffect(() => {
    let alive = true;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, value) => {
      // Keep this callback synchronous; SDK methods here can deadlock its Auth lock.
      if (alive) {
        if (currentSession.current?.user.id !== value?.user.id) {
          setLocked(false);
          setBusy(false);
        }
        currentSession.current = value;
        setSession(value);
      }
    });
    void initialized.then(({ data, error }) => {
      if (!alive) return;
      currentSession.current = data.session;
      setSession(data.session);
      setLoading(false);
      if (error || authDenied) setMessage("Google sign-in did not complete. Please try again.");
    }).catch(() => {
      if (alive) {
        setLoading(false);
        setMessage("Could not restore your sign-in. Please try again.");
      }
    });
    const controller = new AbortController();
    void fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/health`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body.status !== "ok" || body.application !== "videoalbum") {
          throw new Error("health");
        }
        if (alive) setConnection("Supabase backend connected");
      }).catch(() => {
        if (alive) setConnection("Backend unavailable. Please try again shortly.");
      });
    return () => {
      alive = false;
      subscription.unsubscribe();
      controller.abort();
    };
  }, []);

  useEffect(() => {
    setConfirmDelete(false);
    if (!session) {
      setAccount(null);
      return;
    }
    const controller = new AbortController();
    void client.functions.invoke("account", {
      body: { action: "status" },
      signal: controller.signal,
    })
      .then(({ data, error }) => {
        if (controller.signal.aborted) return;
        if (error) {
          setAccount(null);
          setMessage("Could not verify account access. Refresh the page to retry, or sign out.");
        } else {
          setAccount({
            owner: data.user.id,
            email: data.user.email,
            deleting: data.deletion_requested === true,
          });
        }
      }).catch(() => {
        if (!controller.signal.aborted) {
          setAccount(null);
          setMessage("Could not verify account access. Refresh the page to retry, or sign out.");
        }
      });
    return () => controller.abort();
  }, [session?.access_token]);

  async function signIn() {
    setBusy(true);
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          scopes: "openid email profile",
          redirectTo: new URL(import.meta.env.BASE_URL, location.origin).href,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) setMessage("Google sign-in is unavailable. Please try again shortly.");
    } catch {
      setMessage("Google sign-in is unavailable. Please try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (!confirmDelete || busy || !session) return;
    const deletingSession = session;
    setLocked(true);
    setBusy(true);
    setMessage("Deleting your VideoAlbum account…");
    try {
      const { data, error } = await client.functions.invoke("account", {
        body: { action: "delete", confirm: true },
        headers: { Authorization: `Bearer ${deletingSession.access_token}` },
      });
      if (currentSession.current?.user.id !== deletingSession.user.id) return;
      if (error) throw new Error("delete");
      if (data.deleted) {
        await leaveAccount(
          data.provider_revocation_pending
            ? "Your VideoAlbum account was deleted. Google access revocation is pending. Your YouTube videos and printed codes are unchanged."
            : "Your VideoAlbum account was deleted. Your YouTube videos and printed codes are unchanged.",
        );
      } else {
        setAccount({ owner: deletingSession.user.id, email: account?.email, deleting: true });
        setMessage(
          "App access is blocked while account deletion finishes. You can retry deletion below.",
        );
      }
    } catch {
      if (currentSession.current?.user.id === deletingSession.user.id) {
        setMessage(
          "Deletion could not be confirmed. Retry below, or sign out and check again later.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const owned = account?.owner === session?.user.id ? account : null;
  return (
    <main>
      <h1>VideoAlbum</h1>
      <p>Turn videos in your own YouTube channel into printed QR codes for your photo albums.</p>
      <p id="connection" role="status">{connection}</p>
      <p role="status">{message}</p>
      {loading ? <p>Restoring your sign-in…</p> : session
        ? (
          <>
            {owned && <p>Signed in as {owned.email ?? "a Google account"}.</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setLocked(true);
                setBusy(true);
                void leaveAccount("Signed out of this browser.");
              }}
            >
              Sign out
            </button>
            {!owned && <p>Verifying account access…</p>}
            {owned && !owned.deleting && !locked && (
              <>
                <Videos key={owned.owner} owner={owned.owner} />
                {showValidationTools && <Probe key={`probe-${owned.owner}`} />}
              </>
            )}
            {(owned || locked) && (
              <section aria-labelledby="delete-title">
                <h2 id="delete-title">Delete account</h2>
                <p>
                  Permanently delete your VideoAlbum account, albums, captions and upload records.
                  This stops work in VideoAlbum and requests Google access revocation. Your YouTube
                  videos, downloaded sheets and already printed QR codes remain unchanged. Signing
                  in again later creates a new VideoAlbum account.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmDelete}
                    disabled={busy}
                    onChange={(event) => setConfirmDelete(event.target.checked)}
                  />
                  I understand that my VideoAlbum data will be permanently deleted.
                </label>
                <p>
                  <button
                    type="button"
                    disabled={!confirmDelete || busy}
                    onClick={() => void deleteAccount()}
                  >
                    {owned?.deleting || locked ? "Retry account deletion" : "Delete my account"}
                  </button>
                </p>
              </section>
            )}
          </>
        )
        : (
          <>
            <p>Sign in with Google. Connecting YouTube for uploads is a separate step.</p>
            <button type="button" disabled={busy} onClick={() => void signIn()}>
              Sign in with Google
            </button>
            <p>You will stay signed in when you reopen this browser. Sign out on shared devices.</p>
          </>
        )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
