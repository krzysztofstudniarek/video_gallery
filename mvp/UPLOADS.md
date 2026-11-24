# Production upload implementation — issue #15

This branch implements the owner-scoped upload coordinator, routed transfer UI, trusted playback
queue, direct-destination handoff and download/completion flow. **Issue #15 remains open.** Disposable
PostgreSQL migrations, RLS/quota tests, generated types and local Auth/Edge integration were validated
on 17 November. Actual-project uploads, deployed browser recovery, verifier operation and physical
printed scans remain unverified. Unit and browser fixtures do not establish live provider readiness.

## User flow

1. Connect YouTube under Account. The existing shared hosted environment is the selected pilot
   environment; creating another Supabase/Google project is unnecessary.
2. Open **Upload videos** from Your videos or Home (`/uploads`). Choose one MP4, enter a YouTube
   title/description, a separate app caption, the made-for-children choice, and visibility.
3. Unlisted is the default. Choosing Public opens a native accessible modal containing the required
   warning. Cancel and Escape preserve the previous value and return focus to the selector. Only
   **Use Public** applies Public; neither selection nor confirmation sends media or creates a job.
4. **Prepare upload** atomically saves an immutable request, per-upload Public evidence, an app
   caption entry and an idempotency reservation. The resulting `/uploads/:jobId` bookmark contains
   only an app UUID. **Start upload** explicitly dispatches the saved request.
5. The browser sends 8 MiB aligned chunks to Google's resumable endpoint. A backend permit precedes
   each status/chunk request. Pause/route departure stops transfer; resuming explicitly queries the
   same session. Refresh requires the original file to be reselected and fingerprinted. A short
   exclusive lease prevents another tab from concurrently taking over a live transfer.
6. **Check processing / recover completion** performs bounded trusted reconciliation. The backend
   obtains the video ID from the exact stored session's empty status PUT, never a submitted video ID.
   It checks exact ID/channel, processing, actual visibility and provider-reported size/duration.
   Privacy mismatches are failures; no provider metadata is rewritten to force a match.
7. Cancellation erases the job, encrypted session and original-file fingerprint. A provider-free
   cancellation receipt and idempotency record preserve safe bookmarks and prevent reuse of that
   request key. App captions remain. Cancellation/disconnect never deletes YouTube videos.

The current entry form prepares one file at a time, up to ten requests in the connected workflow.
Preparing a new job resets Public selection. New/reloaded routes cannot initiate or resume transfer.
Provider inputs, selected files and session capabilities stay in memory; authorization return paths
are bounded tab-scoped app paths. Cross-tab disconnect/sign-out sends an ephemeral stop signal.
Hidden tabs pause rather than continuing silently.

## Admission and limits

`20261106000100_upload_coordination.sql` supplies private controls and service-only RPCs. Edge
requests verify the live Supabase session and derive the owner from Auth, never request fields.
Direct authenticated callers cannot execute private coordinator RPCs or read private tables.

- 20 dispatched initiation claims/account/Pacific day and 60/project/Pacific day. A consumed claim
  counts even if the request fails or its result is ambiguous; idempotent repeats and resumes do not
  allocate another session. The transaction claims before provider I/O, conservatively counting a
  worker interruption in the narrow claim/send window.
- One active transfer/account and three/project. Leases last 90 seconds and each permitted chunk
  renews its lease. Requests time out at 60 seconds; a resumed tab must reacquire an expired lease.
- Round-robin priority among actively requesting queued accounts: oldest last admission first, then
  oldest queued job. A request expresses interest for 30 seconds; offline abandoned queues cannot
  block other accounts for seven days. Waiting accounts explicitly retry the same job.
- 1 GiB and 600 seconds/file; ten requests/workflow, including cancelled request tombstones.
  Client checks improve feedback; trusted provider values gate verified completion. Missing provider
  size/duration never establishes completion or QR eligibility.
- Atomic insert reservations also enforce five albums/account, 50 videos/album and 200/account for
  direct app-authored inserts. Cancelling a temporary job preserves its independently authored entry.
- At most 120 reconciliation checks/job, at least five seconds apart, persisted across refresh.
  There is no unbounded Edge polling or automatic initiation retry. Quota errors explain the
  Pacific-day reset or provider quota recovery. Provider quota headroom must also account for the
  historical probe and any other consumers; those historical calls are not debited by this new
  coordinator. The shared project's observed allocations still need release-time verification.

Operations may lower size, duration, daily budgets and project concurrency in the private singleton
`upload_policy` row. Check constraints prevent increasing the selected pilot ceilings. The frontend
currently advertises the selected ceilings; lowered operational limits can reject earlier. No client
can change policy. Account concurrency remains fixed at one.

The original-file fingerprint uses a versioned algorithm: split bytes into 8 MiB chunks, SHA-256
hash each chunk, concatenate their 32-byte digests in order, then SHA-256 the concatenation. This
bounds browser memory for 1 GiB files. It is not the ordinary whole-file SHA-256 digest. Neither
filenames nor browser duration claims are accepted as trusted file identity/limit evidence.

## Retention and recovery

Workflow creation fixes expiry at seven days. No request extends it. Existing scheduled cleanup
cascades through jobs, controls, sessions, OAuth state and workflow credentials. Provider-free quota
counters remain across cancellation so quota cannot be reset; the daily cleanup retains at most the
current and two preceding Pacific dates. Account deletion removes owner controls through the job FK.

If initiation returned no usable session, retain the ambiguous claim. Inspect the user's channel
without automatically creating a replacement. If a session is missing/expired or completion cannot
be proved, expose recovery status and stop. The coordinator never binds an arbitrary channel video
by matching title or description, which would risk associating unrelated videos.

Provider inputs remain only while an active workflow needs them. Full workflow cancellation uses
Account's existing disconnect path and queues bounded grant revocation; cancelling one of several
jobs does not erase credentials still needed by other jobs. The completion action waits for sheet, individual-code and versioned captions/links download
acknowledgements, plus explicit owner confirmation that the offered files were saved. Private-only
workflows require the captions/links export and never offer QR files. The browser can establish that
a download was offered, not prove that a user kept it. Completion uses the existing workflow cleanup
contract and does not implicitly delete YouTube videos. Restored completed/expired/deleted workflow bookmarks cannot regenerate purged destinations.

## Validation and remaining release work

Commands from `mvp/`:

```sh
npm ci
npm run style:check
npm run check
npm test
npm run build
PLAYWRIGHT_CHANNEL=chrome npm run test:routing
# Disposable local/CI stack ONLY:
npm start
npm run reset
npm run test:db
npm run types:db
npm run types:db:check
```

Synthetic tests cover per-upload confirmation, UTF-8 metadata limits, immutable authored text,
ambiguous dispatch, session binding, original-file checks, cancellation/disconnect, bounded polling,
provider privacy/size/duration failures, Private completion and route/modal behavior. The checked-in
2,223-byte MP4 fixture is a generated one-second blue frame, with no personal media or audio.

Before enabling this as the finished #15 flow:

- The disposable local database checks passed on 17 November (evidence below). Hosted rollout
  remains separate; never reset or load fixtures in the shared hosted environment.
- Validate real resumable CORS/chunk/refresh recovery in the selected deployed runtime/browser. The
  historical probe's success is supporting evidence, not a completed production matrix.
- Upload synthetic Unlisted, explicitly confirmed Public and Private media to authorized test
  accounts in the existing shared project. Record sanitized requested/effective visibility,
  processing and anonymous-playback results only. Any privacy mismatch blocks readiness.
- Operate and validate the trusted anonymous-playback worker described below. The implemented
  destination handoff and download preparation reject missing/stale playback and provider evidence.
- Validate the four implemented styles on actual printed sheets with representative iPhone and
  Android cameras. The SVG/A4/JSON handoff does not complete #7's physical-scan acceptance or #8's
  independent privacy/account/lasting-data export work.
- Verify cancellation/disconnect during in-flight chunks, account switching, quota contention,
  Pacific-day rollover, actual cleanup and original-deadline backup erasure in release verification.

Provider references checked during implementation:
[resumable protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol),
[video resource](https://developers.google.com/youtube/v3/docs/videos), and
[video insertion](https://developers.google.com/youtube/v3/docs/videos/insert).

## Trusted playback and delivery — 13 November implementation

`/workflows/:workflowId/print` revalidates the owner and live workflow on direct loads. Navigation
never starts uploads, player checks, downloads or completion automatically. **Verify destinations
for printing** performs bounded authenticated provider verification for each job and queues eligible
Public/Unlisted jobs for the trusted playback worker. Private jobs do not enter the player queue.

Run `npm run verify:playback` from a trusted local/operations runtime with `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` and `FRONTEND_ORIGIN` provided privately in its environment. Optionally
set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome. These credentials must never be shipped to
the frontend or public logs. The command does not load shell/environment files automatically.

The worker claims at most ten checks and permits at most twelve attempts/job. Each check creates a
fresh nonpersistent browser context without sign-in state, uses the official YouTube IFrame API,
and requires the requested video's playback clock to advance while playing. A metadata response,
oEmbed response or owner checkbox is not playback evidence. Player/network/challenge failures fail
closed; there is no CAPTCHA bypass or fallback to an authenticated browser. No screenshots, video
recordings, request logs, downloads or saved media are enabled. Each context closes after a bounded
45-second check. Only aggregate result counts are printed. A conditional result write rejects stale
metadata, expired claims/workflows and late results after cancellation/disconnect.

This is an explicit bounded worker command, not a hosted scheduler or a claim that Supabase Edge
Functions can run Chromium. Pilot operation/deployment of the verifier must be established before
calling the upload-to-print flow ready. Worker unavailability leaves codes blocked. Embedded-player
restrictions can reject a video that is otherwise watchable directly; that conservative limitation
needs live validation in the selected project/browser setup.

Provider verification and playback evidence are fresh for at most five minutes. The download batch
expires no later than the earliest verification deadline or original workflow deadline. New metadata
verification invalidates older playback. Download preparation checks every remaining job; failed,
ambiguous, unprocessed or over-limit jobs must be resolved/cancelled before completion.

The browser generates Classic Black, Warm Sepia, Botanical Green and Navy Minimal codes with a
four-module quiet zone and 32 mm physical size. It offers an A4 HTML sheet for printing/Save as PDF,
individual SVGs and a version-1 captions-and-links JSON file. Files are generated locally, with no
provider/QR archive in browser storage or the backend. Private links may appear in the owner's
sensitive JSON export but never in QR/print output. The chosen preset is saved in lasting app data.

Before **Finish workflow**, the backend requires the batch's download acknowledgements and explicit
saved-files confirmation. Once all required downloads were acknowledged while the batch was fresh,
completion remains available after the five-minute verification deadline, including after reload,
until the original workflow expires. Expired evidence still cannot generate or acknowledge new
files; its preview and QR-ready labels clear automatically. Partial download receipts cannot finish.
Batch snapshots include jobs, captions/order and album style, so edits or
new verification invalidate earlier acknowledgements. Successful completion erases temporary jobs,
credentials, playback checks and download state while preserving captions and a provider-free receipt.
Reloading a finished bookmark displays completion and cannot regenerate destinations. The video-list
QR resolver also calls the trusted destination endpoint rather than trusting a cached watch URL.

Standalone local Docker setup and its current disk-space constraint are documented in
[LOCAL-DOCKER.md](../docs/LOCAL-DOCKER.md).

## Local database and full regression validation — 17 November 2026

After free disk space was restored, Colima ran the isolated Supabase stack using the repository's
pinned CLI 2.121.0. All migrations were applied from an empty local PostgreSQL database; no hosted
project was targeted. Studio, image proxy and analytics/pooler services were excluded to reduce
resource use. Required database, Auth, REST, gateway and Edge services ran locally.

- All nine SQL test files passed, totaling 329 pgTAP checks. These cover RLS/private execution
  grants, upload confirmation, reservations/quotas, transfer leases, conditional playback results,
  download acknowledgements, expiry and cleanup.
- Database types were regenerated from this schema and `types:db:check` passed.
- Real Auth-issued local sessions passed Edge/direct-API tests for owner isolation, idempotency,
  unconfirmed Public rejection, browser denial of privileged playback/admission RPCs, Private QR
  exclusion, download-before-completion, cancellation and provider-free finished bookmarks.
- 79 unit/script tests passed, as did 17 database-backed browser cases and 21 built-frontend routing,
  upload, print/download and synthetic-player cases. Formatting, lint, type checks and build passed.

The full browser suite exposed old disabled-upload/legacy-fixture assumptions. Fixtures now reserve
coordinator-backed jobs and observe the ten-job workflow capacity. Far-future mock deadlines were
replaced with realistic deadlines within the seven-day contract, avoiding browser timer overflow.

The trusted destination endpoint now enforces the same latest-job rule as the video list: an older
ready job cannot yield a URL when the same app entry has a newer pending job. A service-only
`current_upload_destination` lookup, transactional SQL regression and direct authenticated Edge
regression cover this case. The client also rechecks its current selection/expiry before handoff.

All provider statuses and playback attestations in these local fixtures are synthetic. The clean
browser verifier test simulates official player events; it is not evidence of real YouTube playback.
No live Google consent, upload, provider visibility change, grant revocation, deployment or GitHub
publication was performed during this validation. Shared hosted data was not reset or seeded.
