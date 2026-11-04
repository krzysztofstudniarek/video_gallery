import { Link } from "react-router";
import { useAppAccess } from "../../app/App";

export function AccountPage() {
  const { accountAvailable, confirmDelete, setConfirmDelete, busy, retryDelete, onDelete } =
    useAppAccess();
  if (!accountAvailable) return null;
  return (
    <section aria-labelledby="account-title">
      <h2 id="account-title">Account</h2>
      <p>
        <Link to="/tools">Open YouTube validation tools (test accounts only)</Link>
      </p>
      <h2 id="delete-title">Delete account</h2>
      <p>
        Permanently delete your VideoAlbum account, albums, captions and upload records. This stops
        work in VideoAlbum and requests Google access revocation. Your YouTube videos, downloaded
        sheets and already printed QR codes remain unchanged. Signing in again later creates a new
        VideoAlbum account.
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
          onClick={() => void onDelete()}
        >
          {retryDelete ? "Retry account deletion" : "Delete my account"}
        </button>
      </p>
    </section>
  );
}
