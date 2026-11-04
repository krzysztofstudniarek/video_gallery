# Vercel frontend and Supabase staging backend deployment

## Current host and callback settings — 4 November 2026

Vercel project `video-gallery` builds `master` from root directory `mvp/`. Use the Vite preset,
`npm run build`, output `dist`, and root asset base `/`. Supabase serves the backend APIs and data.
The current app uses the staging Supabase project even though Vercel labels its deployment
Production; a separate production backend and release gates remain #10 work.

Use **https://video-gallery-flax.vercel.app/** temporarily while the owner's network blocks the
new momentsreply.com domain. The intended custom domain remains https://momentsreply.com/. Google
login returned to bookmarked `/videos`, and separate YouTube consent returned to `/tools` with a
connected destination after #35/#36. Reload retained that connection. No upload was performed in
these callback checks. Earlier custom-domain validation remains historical evidence in #26.

| Setting | Current temporary value |
| --- | --- |
| Supabase project ref | `djuvcxgoqaahgxyuldlp` |
| Vercel frontend environment | `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for that project |
| Supabase Auth Site URL and exact login redirect | `https://video-gallery-flax.vercel.app/` |
| Google identity provider callback | `https://djuvcxgoqaahgxyuldlp.supabase.co/auth/v1/callback` |
| Google OAuth JavaScript origin | `https://video-gallery-flax.vercel.app` |
| Google YouTube redirect and Edge `YOUTUBE_REDIRECT_URI` | `https://video-gallery-flax.vercel.app/?youtube_callback=1` |
| Edge and GitHub staging `FRONTEND_ORIGIN` | `https://video-gallery-flax.vercel.app` (no trailing slash/path) |

The existing exact custom-domain login redirect may remain allowlisted for restoration. Do not
add wildcard preview origins or every private route. Returning to momentsreply.com requires updating
Google origins/YouTube redirect, Supabase Site URL/redirects, Edge FRONTEND_ORIGIN/YOUTUBE_REDIRECT_URI
and the saved GitHub staging origin together, then repeating the live login and consent checks.
Sessions do not migrate between browser origins automatically. Vercel needs no backend secret,
Marketplace provisioning or custom backend. Never put a privileged key in a `VITE_*` variable.

## Backend-only workflow

Run **Actions → Deploy Supabase staging backend → Run workflow** on reviewed `master` after this
change is merged. The workflow file remains `.github/workflows/deploy-staging.yml`; only its display
name changes. It is manual, serialized by the existing `videoalbum-staging` concurrency group and
uses the `staging` GitHub environment with `contents: read` permissions.

The workflow installs locked tools, validates backend configuration, runs unit tests/type checks,
links the explicit project, checks pending migrations with `db push --dry-run`, applies them with
`db push` (never remote reset), sets FRONTEND_ORIGIN, deploys the Edge Functions and runs hosted
smoke checks. Functions remain health/compatibility/share/youtube/account/channel-library.
The migration → function deployment → smoke order is unchanged. Database and function deployment
are not a single transaction; inspect the failing stage before retrying.

There is no frontend build, Pages artifact, Pages deployment job, `pages: write` or `id-token: write`
in this workflow. It does not read FRONTEND_BASE_PATH or require a `github-pages` environment.
Vercel owns frontend builds and releases separately. Frontend build validation remains in PR CI.

Configure these GitHub `staging` environment values:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `SUPABASE_PROJECT_REF` | Explicit staging project ref |
| Variable | `SUPABASE_DB_POOLER_HOST` | Session pooler hostname from Supabase Connect, host only |
| Variable | `SUPABASE_PUBLISHABLE_KEY` | Public `sb_publishable_…` key for backend smoke requests |
| Variable | `FRONTEND_ORIGIN` | Exact current HTTPS frontend origin, without trailing slash/path |
| Secret | `SUPABASE_ACCESS_TOKEN` | Supabase deployment access token |
| Secret | `SUPABASE_DB_PASSWORD` | Staging database password |

The existing environment variable names above are unchanged. The workflow passes the public key to
smoke checks as `SUPABASE_PUBLISHABLE_KEY`; the frontend's `VITE_SUPABASE_PUBLISHABLE_KEY` remains a
separate Vercel build setting. The obsolete FRONTEND_BASE_PATH variable may be removed after merge;
leaving it temporarily has no effect. Do not delete the `staging` environment or its credentials.
Keep the existing YouTube client, encryption key and redirect secrets in Supabase; deployment only
updates FRONTEND_ORIGIN and does not replace those settings.

Use distinct Supabase projects for staging and production, each with its own Auth users, OAuth
configuration, encryption keys and backend credentials. Do not point this staging workflow at a
production project. PR CI has no hosted credentials and uses only disposable database fixtures on
the GitHub runner. Do not repoint reset, generated-type or account-deletion fixture scripts at
shared staging. Local Docker is not required for hosted deployment or smoke checks.

## Retire the existing Pages site after merge

Removing publication steps does not remove an already published site. Complete this one-time
operational step after the backend-only workflow is on `master`:

1. Confirm this PR is merged and no old staging/Pages deployment is still running. Avoid re-running
   old deployment runs: they execute their original commit, which still contains the Pages publisher.
2. Open repository **Settings → Pages** and use the current deployment's menu → **Unpublish site**.
   Follow [GitHub's unpublication instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/unpublishing-a-github-pages-site).
   This removes the published frontend, not the repository, Vercel project or Supabase backend.
3. Verify `https://krzysztofstudniarek.github.io/video_gallery/` no longer serves VideoAlbum (normally
   HTTP 404 after the change propagates). Do not replace it with a redirect page or restore it as a
   second frontend. Keep the old Pages return URL out of Supabase Auth's redirect allowlist.
4. Confirm the Vercel root and `/videos` reload, backend health/CORS and sign-in still work. Record
   sanitized evidence in #26. No real upload or account deletion is needed for this host check.
5. Run the new backend-only workflow from reviewed `master` when ready to validate the deployment
   split. It should finish after backend smoke checks and must not create a Pages publication.

Do not remove historical deployment records or the `github-pages` environment as part of this step;
they are not needed for the new workflow, but removing them is unnecessary for unpublication.
No new DNS record, hosting plan or OAuth credential is required.

## Frontend rollout and recovery

Vercel builds and deploys the frontend from GitHub independently of the manual backend workflow.
For changes spanning frontend and backend, prepare backward-compatible migrations/functions first.
Deploy and smoke-check the required backend before promoting a frontend that depends on it; use
Vercel's deployment controls to coordinate that release. The split does not automatically sequence
Vercel promotion with backend changes.

For a frontend rollback, redeploy/promote a reviewed compatible Vercel deployment. Keep current
origin/callback settings aligned. Use forward-fix database migrations; do not automatically reverse
schema changes, reset hosted data or rerun the former Pages workflow as a rollback mechanism.

To deploy from a trusted terminal, export the same backend settings privately, install locked
workspace tools and use `node scripts/preflight.mjs`, `npm run deploy:backend`, then
`npm run smoke:staging` from `mvp/`. Every CLI operation targets the explicit project/pooler rather
than trusting a developer's existing link. These commands do not require a frontend build/base path.

Smoke checks cover health=200, missing-user-JWT rejection, malformed share=404 and anonymous table
read denial. Health does not prove Postgres connectivity or real OAuth/upload behavior; migrations,
permission checks and live callback validation supply separate evidence.

## Remaining release gates

Complete the [Auth rollout/maintenance gates](AUTH.md), platform callback-log privacy, independent
expiry/deletion scheduling, original-deadline backup erasure, production activation and operating
limits under #10/#26. Browser URL cleanup does not erase the initial request from platform logs.
Vercel response security headers and restrictive frontend CSP remain in place. Unpublishing Pages
neither activates a scheduler nor establishes production readiness.

Supabase Free may pause after inactivity. Choose production hosting for upload availability and
reliable expiry cleanup. Printed QR codes contain direct YouTube URLs and do not depend on the
app domain, Pages, Vercel or Supabase availability. See [ADR 002](../docs/ADR-002-direct-youtube-qr.md).

## GitHub runner IPv4 connectivity

In Supabase **Connect**, select **Session pooler** and copy its exact hostname to the GitHub staging
SUPABASE_DB_POOLER_HOST variable. Do not infer a region/index or paste a URL. Migrations use session
mode on port 5432 with TLS. The database password is supplied privately via PGPASSWORD, not in a
command-line URL. This avoids direct database IPv6 connectivity without adding a paid IPv4 option.

References: [Supabase deployments](https://supabase.com/docs/guides/functions/deploy),
[environment migrations](https://supabase.com/docs/guides/deployment/managing-environments),
[Edge HTTP routing limitations](https://supabase.com/docs/guides/functions/http-methods).
