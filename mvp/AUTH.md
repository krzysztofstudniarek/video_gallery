# Application authentication and account deletion

Issue #4 uses Supabase Auth as the sole identity/session system. The owner chose persistent browser
sign-in and a minimal account-deletion UI on 23 October 2026. Google login requests only
`openid email profile`; YouTube upload/read consent, tokens and refresh remain separate (#14).

The [29 October navigation plan](../docs/ROUTING.md) adds bookmarkable protected screens and safe
signed-out returns through #26. Preserve this completed session/storage contract, clear private
screen state on sign-out/account changes, and keep the validated root login callback. A return path
is temporary per-tab app navigation state, not a provider-data or token cache. `/account` hosts
account/deletion controls when routed integration ships; Back cannot replay deletion or restore access.

## Browser sessions

`frontend/client.ts` owns one SDK client with explicit PKCE, automatic refresh and localStorage
persistence. A browser restart preserves the app session. The compatibility probe's previous SDK
storage key and any in-flight PKCE verifier migrate once; the old key is removed. Google provider
access/refresh tokens are stripped from persisted Auth sessions because this application does not
use them. Supabase app access/refresh tokens and the one-use login PKCE verifier remain in SDK
storage. These tokens are readable by JavaScript, **not HttpOnly** and not protected from arbitrary
same-origin script execution. Never share the production origin with untrusted applications.

Callbacks are captured once and removed from browser history before Auth, health or API requests.
Only a login `code` is passed to `exchangeCodeForSession`; `youtube_callback=1` routes to the
independent consent flow. Provider errors are replaced with fixed UI text. The SDK manages rotating
app refresh tokens; none of this refreshes a YouTube credential.

Vite injects a CSP meta tag before scripts in development and production: scripts/styles only from
self; no inline script, eval, objects, frames or form submission; connections only to self, the exact
configured Supabase origin and Google's direct upload endpoint. Local HMR sockets are allowed only
in development. Referrer policy is `no-referrer`. React text nodes and `textContent` render untrusted
strings; no HTML injection API or third-party analytics is used. CSP reduces attack surface but does
not make browser tokens secret. Where supported by the selected production host (#26), also set
HTTP `Content-Security-Policy` including `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`
and the matching Referrer-Policy header. A CSP meta tag cannot enforce `frame-ancestors`.

Requests use explicit Authorization bearer headers, not ambient authentication cookies. The
backend rejects foreign browser origins, restricts methods and bounds JSON bodies. Do not introduce
cookie authentication without separately designing CSRF protections.

Sign-out explicitly uses SDK scope `local`: revoke this browser session, clear its persisted app
session/verifier and reload the clean base URL. Other devices stay signed in. If server sign-out
fails, local storage is still cleared and the UI says revocation could not be confirmed. Auth state
events clear private UI across tabs. Account switching unmounts the old owner's view; abort signals
stop fetches and active browser transfers, and discard late private results. A request already sent
to YouTube cannot be retroactively cancelled by local sign-out/deletion.

## Backend verification and revocation boundaries

Protected `account`, `youtube` and `compatibility` functions share `requireUser`: validate the bearer
with Supabase `auth.getUser`, then call `current_app_session` through the **user-scoped client**.
That narrow SECURITY DEFINER RPC matches verified `auth.uid()` and the JWT's `session_id` to
Supabase's existing `auth.sessions`, checks `not_after`, and returns only active/deletion booleans.
It accepts no user/session parameters and exposes no session rows. Auth/RPC outages fail closed.
`verify_jwt=false` disables the legacy gateway check, never this application verification.

Ordinary Data API queries retain RLS through user JWTs. Backend privileges are restricted to private
YouTube capability RPCs and the verified account-deletion/maintenance operations. Caller-supplied
owner IDs are ignored by the account handler; users cannot execute its privileged RPCs directly.
`health` is public; `share` is a historical feasibility resolver, not a production QR dependency.

An access JWT is stateless: sign-out revokes refresh but does not invalidate its signature. Protected
functions reject the removed session immediately. Ordinary REST/RLS can still accept that JWT until
its `exp` after ordinary sign-out; do not claim instant JWT revocation there. Account deletion is
stronger: its committed profile marker hides all owned application data immediately, local rows are
purged, and Auth deletion cascades all sessions. Tests deliberately exercise the still-signed token.
Use a bounded project JWT lifetime (local Supabase default: one hour); record the actual hosted
setting and any change during rollout. No custom session table or decoded-claims authorization exists.

## Deletion transaction and bounded retry work

`account` accepts `{ "action": "delete", "confirm": true }` only from a verified active session.
The UI explains the permanent loss of app albums/captions and requires a checkbox. A deleting owner
may retry deletion or check deletion status, but cannot call normal protected functions. Signing in
after successful deletion creates a new Auth identity; the old data is not restored.

The service-only `begin_account_deletion` transaction locks the Auth identity, creates a durable
deletion request, marks the profile, snapshots encrypted revocation-only capabilities and removes
albums/workflows, legacy spike rows, probe credentials/consent/sessions and idempotency records.
Late probe writes are rejected; workflow children cannot recreate deleted parents. Retries preserve
the original request time and every existing capability expiry. Auth admin `deleteUser` then removes
the identity and its sessions. Google failure never blocks local erasure or Auth deletion. A 202
response means app access is blocked and Auth deletion needs another attempt; a successful response
separately reports whether Google revocation remains pending. No YouTube video deletion or privacy
change is requested. Existing videos, downloads and direct printed codes remain under YouTube's rules.

Two private RLS-protected queues survive Auth deletion solely for completing these operations:

- `account_deletions`: app UUID, original request time and last attempt time; removed after Auth
  confirms the identity is absent.
- `provider_revocations`: encrypted refresh capability, original owner/workflow/key context, fixed
  expiry and last attempt time. No frontend grants; never usable for upload or refresh. Expiry is the
  earlier original workflow deadline or request + seven days. The historical app-wide probe has no
  workflow deadline, so its deletion retry is capped at request + seven days. Successful Google
  revocation (or Google's `invalid_token`) erases the task. Expired ciphertext is physically deleted
  whenever the maintenance RPC runs, even when Google is down; retries never extend expiry.

`YOUTUBE_TOKEN_KEY_B64` decrypts existing `probe-v1` envelopes. Future workflow credentials (#14)
must use the same AES-GCM envelope format as `_shared/youtube/crypto.ts`, with owner plus purpose
`workflow:<workflow UUID>:refresh:<key_id>` authenticated as additional data. Supply their retained
key versions in backend-only `YOUTUBE_TOKEN_KEYS_JSON` (key ID to base64 32-byte key). Unknown/missing
keys leave revocation pending rather than claiming success. Never expose either setting as VITE_*.

## Maintenance and production release gate

A trusted scheduler calls POST `/functions/v1/account` with JSON `{ "action": "maintenance" }` and
the project's **backend service-role key** in its Authorization header, stored only in the
scheduler's secret store. No user or publishable key can authorize maintenance. Do not put the key
in URLs, browser code, shell history, example files or logs. Each invocation retries at most ten
identities and five provider capabilities; least-recently-attempted work runs first, so failures do
not starve other tasks. Responses contain counts/retry booleans only. Continue bounded batches
while `retry_needed` is true, with backoff during outages.

Issue #10 must provision an independent scheduler, monitor oldest pending deletion/expiry lag and
drain/erase ahead of deadlines with operating margin, including inactive accounts. Configure backup
and restore handling for these queues under ADR 002: retained ciphertext copies must meet each
original expiry, and deletion requests/tombstones must not be undone by a restore. Never restore a
queue entry with a fresh deadline. A paused free backend or missing scheduler cannot satisfy these
deadlines. This change supplies the callable maintenance path; it does **not** activate hosted
scheduling, change Auth settings or claim production retention/backup compliance.

## Validation

Run the normal format/lint/type/synthetic/build checks, then the local database tests and
`npm run test:local` with functions served from `supabase/.env.example`. That suite creates temporary
users, uses actual Auth JWTs, signs a correctly expired local JWT, tests refresh/sign-out/deletion,
REST ownership, direct privileged RPC denial and all protected function boundaries. It reports only
sanitized status/timings and deletes its users. Example config contains no provider keys; no real
Google calls/media occur. Synthetic tests cover Google failure and pending deletion.

For browser checks, run `npx playwright install chromium`, then `npm run test:browser` against the
same disposable stack. Local Chrome can be used with `PLAYWRIGHT_CHANNEL=chrome`. Playwright starts
its own Vite server on port 5173, creates synthetic users and isolated profiles, and disables traces,
screenshots and video. It tests persistent browser restart, SDK refresh, revoked refresh, Google
login scopes/PKCE construction, callback errors, two-account UI isolation, sign-out and deletion.
These tests do not prove live Google consent. After staging deployment, manually check exact
allowlists and real Google login with two test accounts, denied consent, refresh, sign-out,
cross-account UI/API isolation and deletion. Record only sanitized results. Production callbacks
and hosting/security headers remain a #10/#26 release gate.

Sources checked 23 October 2026: [Supabase sessions](https://supabase.com/docs/guides/auth/sessions),
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[Google login](https://supabase.com/docs/guides/auth/social-sign-in/auth-google),
[sign-out](https://supabase.com/docs/guides/auth/signout),
[user deletion](https://supabase.com/docs/guides/auth/managing-user-data).

## Live staging evidence — 26 October 2026

PR #31 merged as `d29bdf88482ad3f9bbd8c680be5a6c07e91f49cf`.
[Deployment run 40328403063, attempt 2](https://github.com/krzysztofstudniarek/video_gallery/actions/runs/40328403063/attempts/2)
completed successfully for both backend and frontend after replacing an expired deployment PAT.
The public frontend displayed backend connectivity and restored an existing session.

The owner then performed the guided tests in regular and private browser windows and confirmed:

| Manual check | Owner-reported result |
| --- | --- |
| Sign out, reload, sign in with Google | Signed-out state persists through reload; Google returns to the app with the expected identity and private tools |
| Authenticated probes for two Google accounts | Both returned `jwt_verified`, `postgres_read`, `https` and `aes_gcm` as true; synthetic OAuth refresh/initiation also passed with Unlisted metadata |
| Close and reopen the regular browser | Saved app sign-in survives and authenticated access works |
| Separate account sessions | Each window displays its expected account; signing out A leaves B signed in |
| Confirmed deletion of disposable B | Confirmation gates deletion; the deletion flow completes and B loses protected access in its other window after reload |
| Auth identity deletion | B is absent from Supabase Authentication → Users before any new sign-in |
| Unrelated account after deletion | A can sign in and its authenticated probe still succeeds |

These are owner-reported live Google/UI checks. Database row isolation, direct REST/RPC bypass,
expired/invalid JWT rejection, SDK refresh, callback-error handling and dependency-failure scenarios
are covered by the automated local suites described above; do not label those as hosted manual
measurements. The OAuth booleans in the compatibility probe are synthetic and do not prove a live
YouTube upload or provider revocation. No real upload, deliberate hosted token-expiry/refresh test,
denied Google consent, or Google-outage deletion test was recorded in this session. Browser versions
and the exact deletion notification text were not captured. No account identifiers, credentials,
provider destinations or media are retained in this evidence.

The guided staging authentication/deletion checks are complete. Independent maintenance scheduling,
original-deadline backup erasure and production hosting/security configuration remain release gates
in #10/#26; workflow-scoped YouTube authorization/cleanup remains #14/#15 work.
