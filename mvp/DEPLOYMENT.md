# Minimal staging app deployment

The initial base app deploys Postgres migrations and TypeScript Edge Functions to
Supabase, and the static Vite frontend to GitHub Pages. Supabase Edge Functions
serve APIs, not the HTML frontend. No account/project has been created or linked;
the workflow is manual and nothing deploys on push.

## One-time setup

1. Create/select a disposable Supabase staging project. Save the database password
   privately. Copy its 20-letter project ref and **publishable** key. Create a
   Supabase access token for deployments. Do not put those credentials in files
   tracked by Git or paste them into a chat/issue.
2. In this GitHub repository, select **Settings → Pages → Build and deployment →
   GitHub Actions**. The default frontend is
   `https://krzysztofstudniarek.github.io/video_gallery/`. For a custom domain,
   configure it first and use the matching origin/base path below.
3. Create a GitHub environment named `staging`, restrict it to the intended
   deployment branch, and optionally add required reviewers. Add these values:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Variable | `SUPABASE_PROJECT_REF` | Staging project ref |
   | Variable | `SUPABASE_DB_POOLER_HOST` | Session pooler hostname from Supabase Connect (host only) |
   | Variable | `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`, safe for the frontend |
   | Variable | `FRONTEND_ORIGIN` | `https://krzysztofstudniarek.github.io` (no trailing slash/path) |
   | Variable | `FRONTEND_BASE_PATH` | `/video_gallery/` (`/` for a root custom domain) |
   | Secret | `SUPABASE_ACCESS_TOKEN` | Deployment access token |
   | Secret | `SUPABASE_DB_PASSWORD` | Staging database password |

4. Ensure the `github-pages` environment allows the same deployment branch.
   Commit/review the workspace and workflow, then merge the workflow into the
   default branch so GitHub exposes the manual Actions trigger. Do not reuse a
   production project or production credentials for this spike.

## Deploy

Run **Actions → Deploy minimal Supabase staging app → Run workflow** on the
reviewed branch. It validates configuration, installs locked tooling, runs checks,
builds with the Pages base path, links the explicit staging project, applies only
pending migrations (`db push`, never remote reset), sets FRONTEND_ORIGIN and
deploys health/compatibility/share functions. Backend smoke checks must pass
before the frontend is published to Pages. The workflow URL provides the frontend
deployment result. Database and function deployment are not a single transaction;
check the failing stage before retrying.

The minimal app works before Google is configured: it displays the backend
connection status. The authenticated probe requires sign-in. The health endpoint
proves API reachability, not Postgres connectivity; migrations and permission
smoke checks cover the database separately. No YouTube upload is performed by
deployment or smoke checks.

To deploy from a trusted local terminal, export the same settings privately and
use `npm run deploy:backend`, `npm run smoke:staging`, and build with
`npm run build -- --base=/video_gallery/`. Upload `dist/` to a static host; the
GitHub workflow automates Pages publication. CLI commands use the project ref
explicitly; no existing local link is trusted. Never pass a backend key as a
VITE_* setting. No secret is needed in the built frontend.

## Enable Google after the base deployment

In Supabase Auth URL configuration, set Site URL and allowlisted redirect to the
exact frontend URL, including `/video_gallery/`. Enable Google provider with a
dedicated Google OAuth web client. Its authorized callback is
`https://<project-ref>.supabase.co/auth/v1/callback`; its JavaScript origin is the
frontend origin. Add test users to Google's consent configuration. The frontend
keeps the Pages base path in its PKCE redirect. Verify sign-in, run probe, sign-out,
and rejection after sign-out. Do not broaden the redirect allowlist to wildcards.

## Verification and recovery

- Open the deployed frontend and confirm “Supabase backend connected”.
- Smoke checks assert health=200, missing user JWT=401, malformed share=404 and
  anonymous table reads denied. These do not replace two-user/staging OAuth tests.
- Repeat the manual workflow for future releases. For an application rollback,
  deploy a reviewed previous commit; use forward-fix database migrations rather
  than automatically reversing schema or deleting data.
- Remove the disposable staging project/Pages deployment deliberately when no
  longer needed. Printed codes must not point at a disposable staging deployment.

For launch, use the explicit non-pausing Pro plan decision in README.md. Free
staging can pause with inactivity; a failing health indicator is expected while
paused. This setup does not purchase a plan or claim a completed hosted deployment.

References: [Supabase deployments](https://supabase.com/docs/guides/functions/deploy),
[environment migrations](https://supabase.com/docs/guides/deployment/managing-environments),
[Edge HTTP routing limitations](https://supabase.com/docs/guides/functions/http-methods).

## GitHub runner IPv4 connectivity

In the Supabase project click **Connect**, select **Session pooler**, and copy only
the hostname (for example `aws-0-eu-central-1.pooler.supabase.com`) into the
GitHub staging environment variable `SUPABASE_DB_POOLER_HOST`. Use the exact host
shown for your project; do not infer the region/index or paste the full URL.
Migrations use session mode on port 5432 with TLS. The database password is read
from the existing secret into PGPASSWORD; it is never placed in URL arguments.
This avoids direct database IPv6 connectivity on GitHub-hosted runners and does
not require a paid IPv4 add-on. After merging this fix, start a new workflow run
on master; rerunning the old run uses the old deployment script.
