# Supabase MVP workspace

This is the active Supabase-native workspace for issue #2, built on the validated issue #1
compatibility spike. The React frontend retains the probe UI while product features are developed.
Earlier `backend/` Python Workers files and the 2017 app remain reference only. Python, FastAPI and
Workers are not dependencies of the new MVP or its CI.

The [minimal app deployment guide](DEPLOYMENT.md) describes the manual staging workflow: Supabase
migrations/functions plus GitHub Pages frontend, with a public health indicator and backend smoke
checks. Staging validation evidence is recorded below; production provisioning is separate work.

## Workspace and pull request checks

- `supabase/config.toml`: disposable local Supabase configuration (Postgres 17).
- `supabase/migrations/`: ordered SQL migrations; add a migration for every schema change.
- `supabase/functions/`: Deno/TypeScript Edge Functions and shared backend code.
- `supabase/tests/`: transactional pgTAP database and RLS tests.
- `frontend/`: React/TypeScript frontend, built by Vite from `index.html`.
- `frontend/database.types.ts`: generated public-schema types, imported by the frontend client.
- `tests/`: synthetic Deno tests and a two-user local Auth/Data API/Edge integration check.

The [PR workflow](../.github/workflows/ci.yml) runs on pull requests (including forks), pushes to
`master`, and manual dispatch. It installs locked dependencies, checks formatting/lint/types,
runs synthetic tests and builds the frontend. It then starts local Supabase, resets the local
database from migrations, runs SQL/RLS tests, checks database type drift and runs the local Auth/Edge
suite. CI uses a read-only GitHub token with checkout credential persistence disabled. It has no
GitHub environment, hosted project credentials, Google credentials, deployments or real uploads.
Raw CLI startup/function logs stay on the disposable runner and are not uploaded; local keys are
captured in memory by the integration test. The staging deployment workflow remains a separate
manual operation with environment-scoped credentials.

## Local setup

Use Node >=22.12, npm, and running Docker Desktop (or a compatible Docker daemon). Docker must have
enough disk/RAM for the local Postgres, Auth, API gateway and Edge runtime images; the first start
downloads multiple images. Nothing here provisions a hosted project or changes a paid plan.

From `mvp/`:

```sh
npm ci
npm run fmt:check
npm run lint
npm run check
npm test
npm run build
npm start
npm run reset
npm run test:db
npm run types:db:check
cp supabase/.env.example supabase/.env.local
npm run serve
# In another terminal:
npm run test:local
```

`reset` destroys data in this disposable local project and reapplies migrations. It explicitly uses
`--local`; never reset a shared/staging database. `test:local` creates two synthetic email/password
users, checks actual Auth-issued JWTs, RLS, the Edge HTTPS/crypto probe, and the sharing resolver,
then deletes the users. It captures local keys in memory and prints sanitised booleans/timings only.
`npm run stop` stops this project's containers without deleting local data.

After changing migrations, use `npm run reset`, `npm run test:db`, then `npm run types:db`.
Commit the migrations and regenerated `frontend/database.types.ts` together. The generator always
uses the pinned CLI and `--local --schema public`; it never reads a linked hosted schema. CI compares
the Deno-formatted generated output byte-for-byte and fails for missing or stale types without
overwriting them.
Do not edit generated types by hand. The private credential schema is intentionally excluded.

`.env.local`, `supabase/.env.local`, dependencies, build output and Supabase link/cache state are
ignored. Only the two `.env.example` templates are tracked; copy them locally without committing
filled-in values. `npm run build` needs no credentials; a running frontend needs the public values
described below.

Tooling is exact-pinned in package.json/package-lock.json: Supabase CLI 2.121.0, Deno CLI 2.9.6,
supabase-js 2.118.0, React/React DOM 19.3.1, Vite 8.3.4 and TypeScript 7.0.2. Commit both
`package-lock.json` (npm/tooling/frontend) and frozen `deno.lock` (Deno imports). For intentional
dependency updates, update exact versions and the npm lock, then run
`npx deno install --frozen-lockfile=false --lockfile-only` and rerun all checks. `skipLibCheck`
works around SDK WebAuthn/Node type declaration conflicts; our frontend and Edge source remain type
checked. Supabase CLI runs its own Edge runtime in Docker; the
pinned Deno CLI is for checks/tests and is not a claim about the hosted runtime version. Edge
Functions run TypeScript/JavaScript on Deno, **not Python**. Record the actual runtime version from
local/hosted function boot evidence rather than inferring it from Deno CLI.

## Google sign-in

Copy `.env.example` to ignored `.env.local`, fill in the local publishable (or legacy anon) key from
`npx supabase status`, then `npm run dev` and open `http://127.0.0.1:5173`. Do not paste the full
status output into an issue. Use a dedicated Google test project and test users. Configure its OAuth
web client callback to `http://127.0.0.1:54321/auth/v1/callback` and origin to
`http://127.0.0.1:5173`. Supply GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET through ignored
environment configuration, enable `[auth.external.google]`, and restart the local stack. The UI uses
Supabase Auth PKCE; click sign-in, complete consent, run the authenticated probe, sign out and
confirm further probes fail. Google sign-in and YouTube upload consent are separate authorizations.
Basic Google sign-in does not grant YouTube uploads. No real credentials are fixtures.

The compatibility function verifies the caller with `auth.getUser(token)` before any query.
`verify_jwt=false` disables the legacy gateway check, not our caller verification. Invalid/missing
JWTs must yield 401. The RLS client carries the verified user's JWT and never uses the privileged
backend key. Auth availability is a dependency of this verification strategy; no unverified-claims
fallback.

## Anonymous sharing and keys

`spike_items` has owner-only RLS, WITH CHECK for writes, and no anon table grants. `share` accepts a
single UUID token and can only redirect to a validated YouTube video ID when sharing is enabled. Its
SECURITY DEFINER RPC returns only that ID, sets an empty search_path and grants execute solely to
service_role. Anonymous clients cannot invoke the RPC directly or enumerate rows. Disabling sharing
removes resolution; redirects are temporary and `no-store`.

The publishable key (or legacy anon key locally) is allowed in the frontend; it does not identify a
user or bypass RLS. Secret keys and legacy service_role keys bypass RLS and belong only in backend
environment variables. This spike uses the CLI's legacy local backend key inside `share`; never put
it in VITE_* variables, browser bundles, URLs, fixtures or public logs. Hosted key migration must be
validated before deploying. Resolver tokens, destinations and resumable session URLs are sensitive:
configure access-log retention/redaction before live use. The spike does not yet implement public
resolver rate limits or a stable domain.

## Encryption and upload feasibility

The [YouTube consent/upload probe guide](YOUTUBE.md) covers the real separate consent flow, backend
secrets, and a bounded direct-browser upload test. The original compatibility endpoint remains
synthetic; live YouTube results must be recorded separately. Google sign-in, the staging
authenticated probe and sign-out rejection were confirmed by the owner on 2026-10-19.

Deno Web Crypto exercises AES-256-GCM with a random 96-bit nonce and authenticated owner/version
context. The synthetic probe uses an ephemeral key: persistent encryption keys, versioned envelopes,
rotation and revocation are feature work. Synthetic HTTP tests cover refresh construction, rejected
refresh, resumable initiation, an HTTPS Google Location and explicit `privacyStatus=unlisted`. Mocks
prove request handling only, not Google acceptance or browser CORS.

Before live authorized testing, run the synthetic tests. Then use a dedicated channel/project and a
tiny synthetic video with separate YouTube upload consent: refresh server-side, initiate with
Unlisted, hand only the resumable session to the owning browser, and transfer bytes directly to
YouTube. Check preflight, Location exposure, upload progress, interruption/status query/resume,
final processing, Unlisted status and anonymous playback from the staging origin in representative
browsers. Never put refresh tokens in the browser or send media through Supabase storage. Do not
publish session/video URLs in evidence. If CORS fails, the direct-upload architecture remains
blocked pending a tested stateless alternative within runtime limits; do not silently add service
storage. If Google's audit restricts uploads to Private, resolve it before launch; there is no
Public option or privacy fallback.

## Staging and evidence

Select an explicitly authorized staging Supabase project before linking the CLI. Apply reviewed
migrations, configure the Google provider and redirect allowlist, deploy `health`, `compatibility`
and `share`, and set FRONTEND_ORIGIN to the exact staging frontend origin. Configure backend secrets
privately. Exercise missing/invalid JWTs, two signed-in users and anonymous resolution as in the
local suite. Staging project `djuvcxgoqaahgxyuldlp` is deployed with the GitHub Pages frontend; see
the dated evidence below.

| Check                                    | Evidence                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deno synthetic tests                     | 4 passed on 2026-10-19                                                                                                                                                                                                                                                                                                                                 |
| Deployment configuration tests           | 4 passed; missing credentials, privileged frontend key and project/origin mismatches rejected                                                                                                                                                                                                                                                          |
| Edge source type check                   | Passed                                                                                                                                                                                                                                                                                                                                                 |
| Frontend type check/build                | Passed; dependency declarations excluded as described above                                                                                                                                                                                                                                                                                            |
| Postgres isolation                       | 9 pgTAP checks passed against local Postgres 17                                                                                                                                                                                                                                                                                                        |
| Local Auth/Edge integration              | Passed with two temporary users; JWT rejection, RLS, HTTPS/crypto and enabled/disabled sharing                                                                                                                                                                                                                                                         |
| Actual local Edge runtime                | supabase-edge-runtime 1.77.4, compatible with Deno 2.1.4                                                                                                                                                                                                                                                                                               |
| Local wall latency                       | First measured authenticated request 88 ms; subsequent five: 26, 18, 20, 19, 26 ms (p50 20 ms; nearest-rank p95 26 ms). No CPU or hosted cold-start claim.                                                                                                                                                                                             |
| Final local integration including health | Passed; first measured request 107 ms; subsequent five: 47, 24, 23, 22, 22 ms. Public health=200.                                                                                                                                                                                                                                                      |
| Google sign-in                           | Owner confirmed live staging Google sign-in, authenticated compatibility probe and signed-out rejection; reconfirmed during October 2026 validation                                                                                                                                                                                                    |
| Staging and real YouTube upload          | 2026-10-21: owner confirmed consent, server-side refresh, completed upload recovered through inspection, expected channel/processing/Unlisted verification, and signed-out playback                                                                                                                                                                    |
| Browser CORS/resume                      | 2026-10-21: existing partial session inspected at 262144 accepted bytes; owner then reported browser Resume completed, inspection confirmed completion, and processing/Unlisted verification passed. Original browser error cause and explicit pause confirmation remain unverified; owner confirmed second-video signed-out playback and no duplicate |

Local integration/SQL results and runtime version are recorded above. The local integration reports
first request and five subsequent wall-time samples; they are not hosted cold starts or CPU usage.
For staging record deployment/date, region, sample count, warm p50/p95, and first request after
deployment as a cold candidate (not guaranteed isolate cold start). Obtain CPU from platform
metrics; do not equate wall time with CPU. Never claim measured staging results from mocks.

## Printed-code availability decision

**Launch plan: Supabase Pro organization, without inactivity pausing, before printed QR codes are
relied upon.** Free is acceptable for disposable staging, not this launch guarantee: Free projects
with low activity over seven days may pause. Synthetic keep-alives are not the availability plan.
This is an architecture decision, not authorization to purchase a plan. Confirm budget, activation,
stable domain, monitoring, backups and operational ownership before the pilot; printing remains
blocked until those conditions are met. Paid hosting does not guarantee permanent links or
uninterrupted service. The user-facing MVP stays free.

## Sources checked 2026-10-19

- [Supabase local development](https://supabase.com/docs/guides/local-development)
- [Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Edge runtime support](https://supabase.com/docs/guides/functions/quickstart)
- [Key migration](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [YouTube resumable uploads](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol)

## Staging validation closeout — 2026-10-21

Six sequential public `health` GET requests at 10:03 UTC from the development machine used Python
urllib, with a fresh request per sample and no authentication. All returned HTTP 200 and status=ok.
Wall times: 203, 122, 121, 127, 111, 122 ms. For samples 2–6, p50=122 ms and nearest-rank p95=127 ms
(n=5). These include client/network/TLS time; reuse or isolate warmth was not controlled. The first
sample is not a measured cold start or the first request after deployment. Region, hosted runtime
version and platform CPU measurements remain unrecorded. Do not substitute these lightweight health
results for the authenticated compatibility function's latency.

Live upload results are owner-reported from staging, not automated assertions. See YOUTUBE.md for
the successful partial-session resume evidence and test procedure. No watch link, media name, OAuth
credential or upload session capability is included here.

Authenticated compatibility timings from the owner's Chrome Network screenshot at 16:46 local time
(Europe/Warsaw), with No throttling selected:

| Sample | POST duration | HTTP status |
| ------ | ------------- | ----------- |
| 1      | 1360 ms       | 200         |
| 2      | 1240 ms       | 200         |
| 3      | 484 ms        | 200         |
| 4      | 406 ms        | 200         |
| 5      | 420 ms        | 200         |
| 6      | 428 ms        | 200         |

The screenshot's separate 1110 ms preflight is excluded. Durations use the Network Time column
(sample 5 displays 420 ms; its secondary row shows 419 ms). For samples 2–6: n=5, p50=428 ms,
nearest-rank p95=1240 ms. First observed request=1360 ms; isolate warmth was not established, so no
cold-start claim. All six POSTs returned 200; the owner confirmed probe success and the screenshot
shows JWT, Postgres, HTTPS, AES-GCM and synthetic OAuth checks passing. These are browser wall times
including backend work and network/external HTTPS calls, not function CPU measurements or a
production performance guarantee.

Staging deployment
[39618253328](https://github.com/krzysztofstudniarek/video_gallery/actions/runs/39618253328)
succeeded for revision `5e02891b132b542178ce17e120b1f9fdcab36ba4` (PR #22). An existing session was
inspected at 262144 accepted bytes, then resumed in the browser to completion; processing/Unlisted
checks passed. The owner confirmed signed-out playback and no duplicate. This satisfies the
interrupted-upload recovery feasibility check, without claiming the explicit pause button was
verified. Exact file size and browser version were not captured. The original browser error remains
unexplained; automatic completion recovery is follow-up product work. The Supabase feasibility gate
is validated; this is not a production-readiness or durable printed-link availability claim.
