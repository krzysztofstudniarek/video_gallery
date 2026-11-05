# Workflow YouTube authorization — issue #14

Implementation and source review: 5 November 2026. This document supersedes the historical probe's
credential lifecycle in YOUTUBE.md for the Account connection controls. The probe remains a separate
validation tool; its existing credentials are not silently copied into workflows.

Use the existing shared Supabase project and existing YouTube OAuth client/secret. No second
production project or credential set is required. Current origin is
`https://video-gallery-flax.vercel.app`; the exact YouTube callback is
`https://video-gallery-flax.vercel.app/?youtube_callback=1`. Google identity sign-in uses Supabase's
callback independently. Coordinate any domain changes under #10/#26.

Account → Connect YouTube explicitly creates a workflow and encrypted, ten-minute, one-use PKCE
state. The existing router scrubs callbacks before requests and restores the per-tab validated
Account return target. Workflow state uses a distinct prefix so existing in-flight probe consent can
still complete. Wrong owners, replay, deletion and expiry cannot create a new workflow on callback.
The connection writes the tables used by channel discovery. Account displays the verified channel;
if it is wrong, disconnect and choose the intended channel on the next consent screen.

Only `youtube.upload` and `youtube.readonly` are requested. Upload permission initiates uploads;
readonly verifies the owning channel, processing/visibility, and discovers existing channel videos.
Google login asks only for identity scopes. Do not request broader YouTube management/deletion scopes.

## Backend configuration and key rotation

Keep `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, `FRONTEND_ORIGIN` and
Supabase settings on the same hosted environment. Add these backend-only secrets privately:

- `YOUTUBE_TOKEN_KEYS_JSON`: a JSON object mapping explicit key IDs to base64 AES-256 keys.
- `YOUTUBE_TOKEN_ACTIVE_KEY_ID`: the key ID for newly created workflow state/credentials.

No keys belong in VITE variables, browser storage, public logs, issues or commits. The historical
`YOUTUBE_TOKEN_KEY_B64` serves only probe credentials. Workflow consent does not require it.
The authenticated encryption purpose binds owner, workflow, purpose and key ID. Access tokens stay
in request memory. Refresh-token replacement uses the existing compare-and-swap RPC and never
extends the workflow's original deadline. Invalid grants erase the workflow and require reconnect.

For normal rotation, first deploy a key ring containing both old and new keys, then change the active
ID. Retain old IDs while any live OAuth state, workflow credential, upload session or revocation queue
references them. Let those records finish/expire under their original deadlines (at most seven days)
and verify zero references before removing the old key. Rotation must never reset workflow expiry.
For suspected compromise, disconnect affected workflows and request provider revocation immediately;
normal key overlap is not a compromise response. Existing probe v1 keys must remain available until
probe credentials/sessions and their queued revocations have been cleared; they are not re-encrypted
by workflow rotation. Never remove a key just because it is no longer active.

## Erasure and revocation

Workflow completion/cancellation uses `finish_upload_workflow`; deliver owner downloads before
completion. It deletes temporary credentials, state, sessions, provider metadata and jobs through
cascades, preserving independently authored albums/captions. The workflow deadline is fixed at
creation plus seven days. The migration installs `youtube-workflow-expiry` in pg_cron every minute,
sweeping two minutes ahead to allow scheduling margin. Cleanup can therefore happen slightly early.
Check cron execution/failures on the shared deployment; paused/unavailable database hosting cannot
satisfy a fixed erasure deadline. Backup expiry/erasure still requires #10 operational evidence;
this migration cannot erase historical backups or establish their retention policy.

Disconnect first atomically removes all active workflow capabilities and pending consent. It moves
only encrypted revocation material into the backend queue, expiring at the earlier of the original
workflow deadline and one day after disconnect. It then attempts Google revocation with a five-second
timeout. Failure is reported as pending; retry disconnect or run the existing service-authenticated
`account` maintenance action. Queue batches are at most five per call; expired material is erased by
SQL cron independently of Google. A new connection is blocked while an unexpired revocation is queued,
so a delayed retry cannot revoke a freshly authorized workflow. Production maintenance scheduling and
alerts remain deployment checks in #10; erasure does not depend on retry success.

Local token erasure is not proof that Google's grant was revoked. Users may remove access in their
Google account. Neither disconnect nor account deletion deletes YouTube videos or changes printed
codes. Revocation may affect other grants in the same Google project, including historical probes.

## Visibility contract for #15

Initially select Unlisted. Public and Private remain available. Show the Public warning and require
explicit per-upload confirmation before applying Public. Public is openly discoverable; Unlisted is
viewable and shareable by anyone holding the link; Private requires account access and cannot produce
an eligible QR code. Never change the user's choice silently.

The backend must verify ownership, successful processing and effective visibility matching the
requested visibility. Only verified Public/Unlisted can proceed to QR readiness; Private, processing
failure or a mismatch blocks it. The existing SQL QR gate also requires trusted playback, size and
duration checks. #15 owns the production upload selector and upload verification path; connecting a
channel or listing existing Unlisted videos does not prove a new upload honors Public/Unlisted.

## Provider requirements and submission preparation

Official sources reviewed on 5 November 2026:

- [Google sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
  distinguishes scope review and exceptions. Before public availability, check this actual app's
  Audience, Data Access classifications and Verification Center. Testing consent success does not
  establish verification. Prepare verified-domain ownership, homepage/privacy policy, support contact,
  scope justifications above, and a consent-to-upload demonstration video for any applicable review.
- [Google OAuth token expiry](https://developers.google.com/identity/protocols/oauth2#expiration)
  describes refresh-token expiry/revocation, including testing-mode conditions. Reconnect on a rejected
  grant; Supabase does not refresh YouTube tokens for this flow.
- [YouTube quota and compliance audits](https://developers.google.com/youtube/data/guides/quota_and_compliance_audits)
  separates audit/quota extension requests and periodic audits from Google OAuth verification. Submit
  the linked audit/extension form only where required for the actual project or requested capacity;
  prepare app purpose, API usage, privacy/retention controls, demo and desired allocation/rationale.
- [Current videos.insert reference](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert)
  documents the upload scope and a separate Video Uploads bucket at one unit per call, with 100 calls
  per day. This is published guidance, not evidence of the project's current allocation or approval.

The owner's 22 October 2026 console evidence records 100 uploads/day, 100 uploads/minute and 10,000
other units/day for the existing project. The app admission decision remains 20 attempts/account and
60/project per Pacific day. At 100 uploads/day this leaves 40 calls of headroom. Before launch,
recheck actual allocations and shared consumers; retain at least 20% provider headroom if lower.
Current console allocations, publishing/verification status, applicable audit findings and approval
submission IDs are **not verified by this code change**. No submission was sent.

## Remaining live acceptance evidence

The owner-confirmed 4 November routed consent and reload persistence remains valid historical
evidence for the shared setup. After deploying this migration/function/UI and configuring the key
ring, verify the workflow-backed connection on Account and existing videos on Your videos. Test wrong
channel/disconnect, denied consent, revoked grant, callback replay and expiry with synthetic media.
Under #15, request each visibility on the actual account/project, verify returned effective status
and signed-out playback where applicable, and record only sanitized booleans/statuses. If effective
visibility differs, block QR readiness and investigate provider restrictions; no automatic privacy
fallback and no pasted-link substitute. Earlier successful Unlisted probe uploads do not establish
current Public/Private behavior or production upload readiness.

Local verification commands: `npm run style:check`, `npm run check`, `npm test`,
`PLAYWRIGHT_CHANNEL=chrome npm run test:routing`. With a disposable local Supabase engine available,
run `npm run reset`, `npm run test:db`, `npm run types:db` and `npm run types:db:check`.
Never reset or load test fixtures into the shared hosted project.

## Validation recorded for this change

On 5 November 2026, formatting/lint, Edge/TypeScript checks, the frontend build, nine Node tests,
53 Deno tests and 14 isolated routing/browser tests passed. Browser tests use installed Chrome and
synthetic API responses; they are not hosted Google evidence. The added SQL/RLS tests and database
migration have not been executed. Database declarations were updated to match the intended RPC
schema; regeneration/drift checking against a disposable database remains outstanding. Docker checks
were stopped at the owner's request. No hosted migration, reset, fixtures or deployment was run.
