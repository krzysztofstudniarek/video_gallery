# Issue #15 acceptance evidence and remaining live checks

Issue #15 was closed when implementation PR #42 merged. Follow-up PR #43 fixed completion after
verification expiry and stale workflow UI. Closing the implementation issue did not establish every
live provider/device release check. This record separates owner-reported live evidence from
repeatable synthetic integration coverage and checks still requiring authorized test accounts/devices.

## Evidence recorded on 24 November 2026

| Behavior | Evidence | Remaining live check |
| --- | --- | --- |
| Unlisted-default selector and explicit Public warning; Cancel/Escape preserve the previous value | Built-frontend browser tests; warning/cancellation also exercised in the deployed app | None for the observed modal behavior; real Public upload remains below |
| Direct Unlisted upload, processing and effective visibility | Deployed synthetic upload reached 100%, completed, and reported requested/effective Unlisted | A second visibility is not implied by this pass |
| Anonymous playback and final direct QR destination | Owner ran the trusted worker and reported `checked:1, passed:1, failed:0, discarded:0`; saved code scanned successfully | Real Public anonymous playback remains pending |
| A4, individual SVG and versioned captions/links; separate app caption | Owner saved all three files and confirmed they work | Four-style physical matrix below |
| Explicit workflow completion; saved code survives cleanup | Owner confirmed Finish workflow worked after PR #43 deployment and the saved code still scanned afterward | Completed bookmark reload/no regeneration should be explicitly recorded if not yet checked |
| Private completion is distinct from QR eligibility | Unit, SQL, local Auth/Edge and browser tests; mixed workflows exclude Private from A4/SVG but retain its owner JSON entry | Real Private upload/owner playback and anonymous denial |
| Pause, original-file reselection, accepted-offset recovery without a second dispatch | Browser tests use actual XHR/AbortController, an 8 MiB accepted chunk with lost reply, reload and original-file fingerprint; provider responses are synthetic | Real Google resumable CORS/chunk/reload recovery |
| Cancellation and cross-tab disconnect stop subsequent media | Real-XHR browser tests hold a chunk reply, cancel/disconnect, release the late reply and assert no next chunk/resume/duplicate dispatch; late Pause status cannot revive controls after leaving/disconnect | Deployed in-flight cancellation/disconnect and Google revocation behavior |
| Completed uploads can leave without a pause warning | Browser tests complete after resuming with a selected file and navigate Home directly | Deployed completed-upload navigation recheck |
| All four QR styles preserve the same direct destination | Saved SVG bytes are rendered and independently decoded with development-only jsQR; A4 embeds the same SVG, JSON matches style/destinations, and Private is excluded from print | Printed iPhone/Android scan matrix |

The transfer fixture is opaque deterministic bytes sent only to intercepted provider requests. It is
not a valid live MP4 or real YouTube evidence. Synthetic player events and independent QR decoding do
not substitute for actual provider playback or physical camera scans.

## Run the automated checks

From `mvp/`:

```sh
npm ci
npm run style:check
npm run check
npm test
PLAYWRIGHT_CHANNEL=chrome npm run test:routing
```

Omit `PLAYWRIGHT_CHANNEL=chrome` in CI after installing Playwright Chromium. CI also applies migrations
from an empty disposable local Supabase database, runs SQL/Auth/Edge tests, checks generated types,
and runs database-backed browser tests. Never reset or seed the shared hosted project.

Pause now aborts the browser request, removes the stale Start action and reads the same job's trusted
status. It does not reconcile with YouTube, dispatch, renew a lease or consume processing checks.
Reload/resume still requires the original file and a valid backend lease; a different tab may need to
wait up to 90 seconds. A delayed status response is discarded after route departure or disconnect.

## Remaining live sequence

Use the existing shared hosted environment, an owner-approved test channel and synthetic media only.
Record a date/browser/device and pass/fail summary. Do not commit keys, provider video IDs/watch URLs,
OAuth responses, upload-session URLs, QR images or personal footage. Never alter privacy in YouTube
Studio to turn an unexpected provider result into a pass. A requested/effective mismatch blocks QR
readiness and requires investigation under the provider/project approval requirements in #14.

1. **Public upload.** Start a new workflow if the prior one was finished. Select Public, read the
   warning and explicitly choose **Use Public** for this specific upload. Prepare/Start the synthetic
   file. Confirm processing succeeds and effective visibility is Public. Verify the final title and
   description in YouTube Studio and that the separate app caption remains in the app. Verify
   destinations, run the trusted anonymous worker immediately, refresh readiness and download files.
   The provider's API project/approval policy may force Private; treat that as blocked, not a Public
   pass. Do not authorize or execute Public exposure on behalf of an owner without their per-upload
   approval.
2. **Private upload.** Use a different titled synthetic job, explicitly choose Private and prepare/
   start. Confirm processing/effective Private and owner playback. A signed-out browser should not
   play it; do not queue Private for the anonymous worker. Its owner JSON export is allowed, while
   QR/A4/print output must exclude it, including in a mixed Public/Private workflow. A new job must
   start with Unlisted and must not inherit the earlier Public confirmation.
3. **Pause and reload.** Use a synthetic MP4 larger than 8 MiB and throttle the browser network enough
   to interrupt an actual chunk. Save the app job bookmark. Start, Pause, reload, reselect the exact
   file and Resume the same job. Expect no automatic transfer on reload, no repeated initiation and
   only one resulting YouTube video. If a prior lease is busy, wait up to 90 seconds rather than
   preparing a replacement. Check processing/recovery on this same job after an uncertain response.
4. **Cancel in flight.** Start a separate slowed synthetic job and cancel during a chunk. No subsequent
   media chunk should be admitted; reload must show cancellation without Start/Resume. Any video
   already received by YouTube may remain. Do not delete it implicitly or claim provider deletion.
5. **Disconnect in flight.** Start another slowed synthetic job. Open Account in a second tab and
   disconnect. The upload tab must stop, lose transfer controls and remain blocked after reload.
   Record whether revocation is confirmed or pending; local erasure alone is not proof of Google
   revocation. Reconnecting requires owner-reviewed consent. Existing videos/codes remain unchanged.
6. **Completed navigation.** After successful processing, choose **Verify and download this workflow**
   or Home. There must be no pause warning for the completed job. Active work must still warn before
   route departure. A restored completed workflow bookmark must offer no regeneration.
7. **Download/completion.** Enter the playback worker's credentials privately before clicking Verify;
   wait for provider checks, run the worker, then Refresh readiness. Within five minutes prepare and
   save A4, every SVG and JSON. Wait for the enabled saved-files checkbox, let verification expire,
   reload and confirm the checkbox/Finish return without fresh QR preview. Finish only after actually
   saving the files. Reload should show completion; previously saved codes must continue working.

The worker prints only aggregate counts. `checked:0` means no eligible queue entry was found; it does
not prove playback. If it occurs immediately after a fresh successful provider check, investigate the
queue rather than repeatedly uploading. Never paste the service-role key into chat or frontend code.

## Physical print matrix

Generate and keep a separate A4/SVG set for each style before finishing its workflow. Print A4 at
100% with browser headers/footers off; codes are 32 mm with a four-module quiet zone. Scan with the
normal phone camera while signed out of the app/YouTube. Every code must open the intended direct
YouTube destination, without an app account, app redirect or Supabase dependency. Record the actual
device and OS; do not infer the untested device/style cells from one successful scan.

| Style | iPhone camera | Android camera |
| --- | --- | --- |
| Classic Black | Pending | Pending |
| Warm Sepia | Pending | Pending |
| Botanical Green | Pending | Pending |
| Navy Minimal | Pending | Pending |

The owner reported a successful device scan before and after workflow completion, but did not record
the style/device matrix. That evidence is retained above without filling unspecified cells.

## Operational release gates

Existing quota, fixed seven-day expiry, cleanup, ownership and privileged RPC tests remain required.
Actual-project quota contention/Pacific rollover, scheduled cleanup, original-deadline backup erasure,
provider approval and trusted-worker operation need release evidence under #10/#11/#14/#25. This PR's
synthetic coverage neither establishes those operational gates nor introduces a hosted worker scheduler.
