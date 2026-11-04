import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <section>
      <h2>Page not found</h2>
      <p>This screen is unavailable.</p>
      <Link to="/">Go home</Link>
    </section>
  );
}
