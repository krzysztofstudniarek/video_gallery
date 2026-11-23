import { Link } from "react-router";
import { useAppAccess } from "../../app/App";

export function HomePage() {
  const { canAccess } = useAppAccess();
  if (!canAccess) return null;
  return (
    <section>
      <h2>Home</h2>
      <p>
        <Link to="/uploads">Upload a video to YouTube</Link>
      </p>
      <p>
        Choose Your videos to select videos for QR codes, or Account to manage your account.
      </p>
    </section>
  );
}
