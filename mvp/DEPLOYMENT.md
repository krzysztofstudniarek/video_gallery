# Minimal staging app deployment

## Current Vercel host and navigation plan — 29 October 2026

The owner selected Vercel and deployed `master` from root directory `mvp/` to project
`video-gallery`. The frontend is available at `https://momentsreply.com/`, with the assigned Vercel
URL `https://video-gallery-flax.vercel.app/`. Vercel reported Valid Configuration for the custom
domain; browser navigation over HTTPS rendered the app. Supabase remains the backend.

Use the Vite preset, `npm run build`, output `dist`, and root asset base `/`. Supply only
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the intended existing Supabase project.
No Vercel backend, Marketplace provisioning or backend secret is required. The current frontend
uses the staging Supabase project even though Vercel calls its deployment environment Production.

The owner confirmed Google login, separate YouTube consent/return/channel connection, and changing
the saved GitHub staging `FRONTEND_ORIGIN` to `https://momentsreply.com`. Health returned HTTP 200
with that exact CORS origin; the browser displayed Supabase backend connected. No upload was
requested in the new-domain callback test.

The accepted [routing plan](../docs/ROUTING.md) requires bookmarkable app screens, reloads and
Back/Forward. #26 implements the shared router, Vercel route fallback, missing-asset/not-found
behavior and synthetic callback/navigation coverage. Keep login returning to
`https://momentsreply.com/`, and set both the Google YouTube OAuth redirect and backend
`YOUTUBE_REDIRECT_URI` to `https://momentsreply.com/?youtube_callback=1`. Do not broaden callback
allowlists to every private screen. The owner selected a home screen with navigation links as the post-login default.

Remaining #26/#10 work includes reviewed deployment/rollback, production response headers,
host-side callback-log privacy, independent expiry/backup guarantees, and splitting/retiring the
old Pages publication below. This documentation changes no workflow or live settings and does not
claim those gates are implemented. Cross-origin browser sessions do not migrate automatically.

## Existing Supabase and historical Pages workflow

The existing manual workflow deploys Postgres migrations and TypeScript Edge Functions to
Supabase and also publishes a Vite frontend to GitHub Pages. That publication is legacy staging;
the current app address is momentsreply.com. Supabase Edge Functions serve APIs, not HTML.
Existing staging validation is recorded in [README.md](README.md). Review Vercel Git/preview release
settings separately; the manual-only statement here applies to the GitHub workflow.

Use separate Supabase projects for staging and production, each with its own database, Auth users,
OAuth clients/redirects, encryption keys and backend secrets. The local `project_id` identifies only
Docker resources. Keep hosted credentials in the matching protected GitHub environment; PR CI uses
only disposable local resources and must never receive staging or production secrets. Production
hosting and release configuration remain in issue #10; do not point the staging workflow at it.

## Historical Pages setup and shared backend settings

The Pages-specific steps below document the old deployment, not a second current app address.
Keep the shared backend origin aligned with momentsreply.com until the publication stage is split.

1. Create/select a disposable Supabase staging project. Save the database password privately. Copy
   its 20-letter project ref and **publishable** key. Create a Supabase access token for
   deployments. Do not put those credentials in files tracked by Git or paste them into a
   chat/issue.
2. In this GitHub repository, select **Settings → Pages → Build and deployment → GitHub Actions**.
   The default frontend is `https://krzysztofstudniarek.github.io/video_gallery/`. For a custom
   domain, configure it first and use the matching origin/base path below.
3. Create a GitHub environment named `staging`, restrict it to the intended deployment branch, and
   optionally add required reviewers. Add these values:

   | Kind     | Name                       | Value                                                            |
   | -------- | -------------------------- | ---------------------------------------------------------------- |
   | Variable | `SUPABASE_PROJECT_REF`     | Staging project ref                                              |
   | Variable | `SUPABASE_DB_POOLER_HOST`  | Session pooler hostname from Supabase Connect (host only)        |
   | Variable | `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`, safe for the frontend                        |
   | Variable | `FRONTEND_ORIGIN`          | `https://momentsreply.com` (no trailing slash/path) |
   | Variable | `FRONTEND_BASE_PATH`       | `/video_gallery/` (`/` for a root custom domain)                 |
   | Secret   | `SUPABASE_ACCESS_TOKEN`    | Deployment access token                                          |
   | Secret   | `SUPABASE_DB_PASSWORD`     | Staging database password                                        |

4. Ensure the `github-pages` environment allows the same deployment branch. Commit/review the
   workspace and workflow, then merge the workflow into the default branch so GitHub exposes the
   manual Actions trigger. Do not reuse a production project or production credentials for this
   spike.

## Deploy

Run **Actions → Deploy minimal Supabase staging app → Run workflow** on the reviewed branch. It
validates configuration, installs locked tooling, runs checks, builds with the Pages base path,
links the explicit staging project, applies only pending migrations (`db push`, never remote reset),
sets FRONTEND_ORIGIN and deploys health/compatibility/share/youtube/account/channel-library functions. Backend smoke checks must
pass before the frontend is published to Pages. The workflow URL provides the frontend deployment
result. Database and function deployment are not a single transaction; check the failing stage
before retrying.

The minimal app works before Google is configured: it displays the backend connection status. The
authenticated probe requires sign-in. The health endpoint proves API reachability, not Postgres
connectivity; migrations and permission smoke checks cover the database separately. No YouTube
upload is performed by deployment or smoke checks.

To deploy from a trusted local terminal, export the same settings privately and use
`npm run deploy:backend`, `npm run smoke:staging`, and build with
`npm run build -- --base=/video_gallery/`. Upload `dist/` to a static host; the GitHub workflow
automates Pages publication. CLI commands use the project ref explicitly; no existing local link is
trusted. Never pass a backend key as a VITE_* setting. No secret is needed in the built frontend.

## Historical Pages Google setup

The paragraph below describes the former callback setup. Use the current Vercel values in the
environment table for the live app; the owner removed the Pages return URL from hosted Auth.

In Supabase Auth URL configuration, set Site URL and allowlisted redirect to the exact frontend URL,
including `/video_gallery/`. Enable Google provider with a dedicated Google OAuth web client. Its
authorized callback is `https://<project-ref>.supabase.co/auth/v1/callback`; its JavaScript origin
is the frontend origin. Add test users to Google's consent configuration. The frontend keeps the
Pages base path in its PKCE redirect. Verify sign-in, run probe, sign-out, and rejection after
sign-out. Do not broaden the redirect allowlist to wildcards.

Use these exact environment boundaries (origin and callback are different settings):

| Environment | Google authorized callback | Supabase Site URL and redirect allowlist | Frontend/Google JavaScript origin |
| --- | --- | --- | --- |
| Local | `http://127.0.0.1:54321/auth/v1/callback` | `http://127.0.0.1:5173/` | `http://127.0.0.1:5173` |
| Current staging-backed Vercel app | `https://djuvcxgoqaahgxyuldlp.supabase.co/auth/v1/callback` | `https://momentsreply.com/` | `https://momentsreply.com` |
| Separate production backend, pending #10 | `https://<production-project-ref>.supabase.co/auth/v1/callback` | Exact reviewed frontend return URL | Exact reviewed HTTPS origin |

Separate production backend values remain unresolved until #10 provisions/reviews that environment.
Never copy staging project IDs or wildcard redirects into production. Match trailing slashes to the
SDK's generated `redirectTo`. Record/verify the hosted JWT lifetime; ordinary REST accepts a signed
access JWT until expiry after sign-out, whereas protected functions also verify the live Supabase
session. The local config sets a one-hour JWT lifetime explicitly.

Before public release, complete the [Auth rollout/maintenance gates](AUTH.md): independent deletion
retry/expiry scheduling, original-deadline backup erasure, live two-account Google/deletion tests and
production security headers. Vite embeds a restrictive CSP for static hosting. Hosting that supports
response headers should additionally enforce `frame-ancestors 'none'` and `nosniff`. Nothing here
changes hosted provider settings or activates the scheduler automatically.

## Verification and recovery

- Open the deployed frontend and confirm “Supabase backend connected”.
- Smoke checks assert health=200, missing user JWT=401, malformed share=404 and anonymous table
  reads denied. These do not replace two-user/staging OAuth tests.
- Repeat the manual workflow for future releases. For an application rollback, deploy a reviewed
  previous commit; use forward-fix database migrations rather than automatically reversing schema or
  deleting data.
- Remove the disposable staging project/Pages deployment deliberately when no longer needed. Production QR codes point directly to YouTube, never this staging deployment.

For launch, follow [ADR 002](../docs/ADR-002-direct-youtube-qr.md): validate hosting for upload and
expiry-cleanup availability, not printed playback. Free staging can pause with inactivity; a failing
health indicator is expected while paused. Production temporary-data deadlines still apply during
inactivity. The earlier mandatory Pro-for-printed-links decision is superseded. This setup does not
purchase a plan or claim production readiness; current frontend deployment evidence is recorded above.

References: [Supabase deployments](https://supabase.com/docs/guides/functions/deploy),
[environment migrations](https://supabase.com/docs/guides/deployment/managing-environments),
[Edge HTTP routing limitations](https://supabase.com/docs/guides/functions/http-methods).

## GitHub runner IPv4 connectivity

In the Supabase project click **Connect**, select **Session pooler**, and copy only the hostname
(for example `aws-0-eu-central-1.pooler.supabase.com`) into the GitHub staging environment variable
`SUPABASE_DB_POOLER_HOST`. Use the exact host shown for your project; do not infer the region/index
or paste the full URL. Migrations use session mode on port 5432 with TLS. The database password is
read from the existing secret into PGPASSWORD; it is never placed in URL arguments. This avoids
direct database IPv6 connectivity on GitHub-hosted runners and does not require a paid IPv4 add-on.
After merging this fix, start a new workflow run on master; rerunning the old run uses the old
deployment script.
