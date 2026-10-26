# YouTube consent and direct-upload compatibility probe

Open the frontend with `?tools=1` to show these historical validation tools. The normal signed-in
screen is the [minimal video list](VIDEOS.md); production uploads remain #15. YouTube consent
callbacks also show the tools so an in-flight probe can complete.

Production contract: [ADR 002](../docs/ADR-002-direct-youtube-qr.md), accepted 22 October 2026,
uses direct YouTube QR destinations, user-downloaded sheets/exports and temporary provider data
removed at workflow end/cancellation, with a seven-day maximum for interrupted work. The probe below
is historical and does not yet implement that retention, expiry cleanup or key-ID contract.

This is a staging-only validation tool for issue #1, not the production upload workflow in #15.

The owner selected the [balanced production pilot limits](../docs/PILOT-LIMITS.md) on 2026-10-22:
20 initiation attempts/account/Pacific day, 60/project/Pacific day, 1 GiB/10 minutes/file,
10 files/batch and one active transfer/account with three/project admissions. The machine-readable
[contract](pilot-limits.json) is not wired into this probe; its 10 MiB bound and Unlisted-only
verification remain historical feasibility behavior. Production permits Unlisted by default,
Private and explicitly confirmed Public; trusted processing/visibility verification gates QR
eligibility. Production admission, quota accounting and trusted post-upload size/duration checks
remain #14/#15 work; browser declarations cannot establish verified provider state.

Google sign-in remains unchanged. YouTube is connected separately by an already signed-in user, with
upload and readonly scopes. Readonly is needed to confirm the selected channel and the uploaded
video's processing/privacy.

## Google setup

1. Keep YouTube Data API v3 enabled in your selected Google staging project.
2. Under Google Auth Platform → Data Access include both scopes:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
3. Under Audience keep staging in Testing and add your test account.
4. Create a **separate Web application OAuth client** named VideoAlbum YouTube staging. Do not
   overwrite the working Supabase sign-in client. Its JavaScript origin is
   `https://krzysztofstudniarek.github.io`. Its authorized redirect URI is exactly:

   ```text
   https://krzysztofstudniarek.github.io/video_gallery/?youtube_callback=1
   ```

   The callback is the frontend, which immediately removes the code/state from the address bar and
   submits them with the existing Supabase user JWT to the backend. It must not use the Supabase
   Auth `/auth/v1/callback` URL: that URL belongs to sign-in. The marker prevents the Supabase SDK
   from trying to exchange a YouTube code as a Supabase login code.

## Supabase secrets (backend only)

Under your project → Edge Functions → Secrets add:

| Name                    | Value                                                    |
| ----------------------- | -------------------------------------------------------- |
| `YOUTUBE_CLIENT_ID`     | The new web client ID                                    |
| `YOUTUBE_CLIENT_SECRET` | The new web client secret                                |
| `YOUTUBE_REDIRECT_URI`  | The exact callback URL above                             |
| `YOUTUBE_TOKEN_KEY_B64` | A privately generated base64 encoding of 32 random bytes |

Generate the encryption key on your own machine, then save it privately:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Never send these secrets in chat/issues, put them in VITE_* variables or commit them. Retain the key
in a password manager: replacing it makes existing encrypted credentials and sessions unreadable.
This spike has a versioned v1 envelope but does not implement key rotation; migrate/re-encrypt
before any future rotation. Local tests use synthetic values, never the real client secret/key.

Deploy the reviewed change through the existing manual staging workflow. It adds the private-schema
migration and `youtube` function. Existing FRONTEND_ORIGIN remains the frontend origin without its
path. Auth URL settings are unchanged. The workflow does not copy YouTube secrets from GitHub or
overwrite them.

## Live staging sequence (requires your explicit browser consent)

1. Sign in to VideoAlbum and click **Connect YouTube**. Grant both permissions, choosing the
   intended test channel. Canceling is safe and starts no upload.
2. Confirm the displayed channel name/ID. If it is wrong, disconnect before connecting another
   channel. A channel change cannot reuse an old upload job.
3. Click **Test server-side token refresh**. Only a boolean result is shown; refresh/access tokens
   never reach the browser.
4. Choose a tiny synthetic MP4 (1–10 MiB), confirm Unlisted and the destination channel, and answer
   the required made-for-kids question accurately.
5. Click **Start one Unlisted test upload**. Metadata initiation occurs in the Edge Function; the
   browser PUTs the video bytes directly to Google's returned session in 256 KiB chunks. Supabase
   receives no video bytes and uses no video storage bucket.
6. Test pause/resume. Select the exact original file after a reload. Size and SHA-256 must match;
   the browser queries the existing session's accepted offset. If CORS/preflight or exposed Range
   headers fail, record the browser and the sanitised error and stop. This is an unresolved
   feasibility result, not a reason to fall back to proxying/storage or start duplicate videos. On a
   browser transfer error, first use **Inspect existing upload (no video transfer)**. This sends
   only a preflight and an empty session-status request from the backend; it neither uploads bytes
   nor creates a new session. If the session is complete, the app recovers its video ID for normal
   verification. Otherwise it reports provider status, accepted byte count, and CORS header booleans
   without exposing the session URL or provider body. Those server-side observations are diagnostic
   hints, not proof of the browser's exact failure. The progress bar stays below 100% until a
   completed-upload response is known.
7. After transfer completes, click **Check processing and Unlisted status**. Repeat manually at
   reasonable intervals if processing is still in progress. The backend checks the connected channel
   and per-job description marker. Private/Public fails verification; no privacy fallback or
   automatic conversion.
8. Verify anonymous playback yourself from the video's YouTube Studio sharing link in a signed-out
   browser. Do not paste that link or a screenshot of it into a public issue. Remove test videos in
   Studio afterward if desired.

One private upload reservation per user prevents parallel/repeated initiation. An uncertain
initiation failure retains the reservation. **Clear probe record** is an explicit reset after
checking Studio; it does not cancel the remote session or delete a video. Completed sessions can be
queried through Resume to recover the video ID after reload. No video IDs, media names or session
URLs are stored in browser storage. Session URLs are capabilities delivered only to the verified
owner; treat them as credentials and do not capture them in public evidence.

**Disconnect** revokes the Google grant, then deletes encrypted credentials, state and probe rows.
It never deletes YouTube videos. A failed revocation retains the record for retry. Revoking Google
access can affect other grants under the same Google project; a separate OAuth client alone is not a
guarantee of grant isolation. Use a separate Google Cloud project if that isolation is required.
Account deletion cascades local records; complete provider-revocation/account deletion workflows
remain separate MVP work.

## Internal pipeline and module boundaries

One deployed `youtube` Edge Function retains the existing action API. Its HTTP adapter validates
startup configuration, checks CORS/method/JWT, reads bounded JSON, validates an action and
dispatches with the verified owner. Only metadata is accepted: `MAX_REQUEST_BYTES` is 8 KiB,
measured as bytes while streaming; oversized bodies are cancelled without reading the remainder.
Video bytes use the separate browser-to-Google transfer path.

The `functions/_shared/youtube/` modules have these responsibilities:

| Module                                           | Responsibility                                                  |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `config.ts`, `http.ts`, `inputs.ts`, `errors.ts` | Configuration, transport, validated inputs, sanitised responses |
| `actions.ts`                                     | Dispatch validated actions with an explicit owner context       |
| `consent.ts`                                     | Start and complete one-use owner-bound consent                  |
| `connection.ts`                                  | Connection status, refresh and disconnect                       |
| `upload.ts`                                      | Reserve/initiate, resume and verify the existing probe          |
| `repository.ts`                                  | Private RPC access bound to the verified owner                  |
| `google-client.ts`, `google.ts`                  | Google requests and protocol helpers                            |
| `context.ts`, `crypto.ts`                        | Owner/purpose-bound token encryption and service context        |

The pipeline is signed-in → consent pending → channel connected → upload reserved → browser transfer
→ processing → verified Unlisted. Declined/expired consent requires a fresh attempt; rejected
refresh requires reconsent; interrupted transfer resumes the existing reservation; processing
failure and visibility mismatch stop verification. These are probe transitions, not a new production
job-state schema. No schema or frontend action API changes are needed for the module refactor.

`FRONTEND_ORIGIN` is required at startup and must be a valid HTTPS origin, or an explicit local HTTP
origin. Local setup copies `supabase/.env.example` to ignored `supabase/.env.local`; `npm run serve`
passes that file to the CLI. YouTube-specific credentials can remain unset until the real probe is
configured: status reports unconfigured and consent/upload actions return 503.

## Security and limitations

- Backend verifies the Supabase JWT for every action. Owner IDs come solely from that identity;
  anonymous/authenticated callers cannot execute the private RPCs.
- Consent state is random, stored hashed, owner-bound, expires after 10 minutes, and consumed
  atomically once. OAuth uses PKCE S256 and offline access.
- Refresh tokens/session URLs use AES-256-GCM with random nonces and owner/purpose additional
  authenticated data. Only ciphertext is stored in the private schema.
- No provider error bodies, OAuth codes, tokens, URLs or media are logged by our function. Browser
  callback codes necessarily traverse the frontend host; review host/platform access-log retention
  separately before public launch. HTML uses no-referrer and query values are removed promptly.
- Quota/rate limiting, periodic processing polling, robust cancellation, token-key rotation, account
  deletion/revocation and production upload idempotency remain feature work. Do not launch this
  probe as the upload product.
- OAuth testing-mode grants can expire; reconnect when refresh is rejected. Do not interpret
  reconsent in Testing as proven durable production access.

## Evidence

On 2026-10-21 the owner confirmed live staging Google sign-in, YouTube consent and server-side
refresh. A direct browser transfer showed a generic XHR failure. After PR #21 was deployed,
**Inspect existing upload (no video transfer)** reported completion and recovered the video ID.
**Check processing and Unlisted status** verified the expected channel/job, completed processing and
Unlisted visibility. The owner then confirmed playback in a signed-out browser. No watch link or
session capability is recorded in this public document.

The upload reached YouTube despite the browser error. Its precise cause remains unconfirmed; server
inspection does not prove browser CORS correctness. New sessions send the configured browser Origin
during initiation. Interrupted browser resume and recovery without manual inspection remain
unverified.

### Remaining owner-run interrupted-resume test

1. Check that the previous video is complete in Studio and retain it if desired. Only then clear its
   completed local probe record to allow a separate test. Clearing does not remove the video from
   YouTube.
2. Choose a synthetic MP4 near, but no larger than, 10 MiB. In browser developer tools, open Network
   and select a slow network preset to allow time to pause. Keep developer tools open while
   throttling. Do not export HAR files or upload request URLs: they can contain credentials or
   session capabilities.
3. Confirm the intended channel, Unlisted visibility and accurate made-for-kids answer. Start one
   upload, then click **Pause after current chunk** once some data has transferred. Wait for the
   explicit Paused message. A generic browser error is not evidence that the pause succeeded.
4. Click **Inspect existing upload (no video transfer)**. Record the sanitized result. A valid
   partial-transfer observation has complete=false and 0 < accepted_bytes < the selected file size.
   If already complete, this did not test interruption. If uncertain or failed, preserve the
   reservation and stop.
5. Reload the app, check the connection, reselect the exact same file, and click **Resume / check
   existing upload**. Do not click Start again. Keep throttling enabled until progress beyond the
   saved offset can be observed, then restore normal network speed. Record the displayed result;
   inspect again if needed.
6. Verify processing and Unlisted status, and check signed-out playback. Confirm Studio contains one
   new video for this test. An inspection-only recovery establishes completion, but cannot establish
   that browser resume succeeded if its offset query or chunk transfer failed.

Record browser/version, file size, partial accepted byte count, whether the explicit Paused message
appeared, resume result and final verification. Avoid media names, watch links, request URLs and
credentials in public evidence.

For authenticated staging latency, use the Network panel to record the Duration of six sequential
**Run authenticated probe** requests after sign-in. Record the first separately and report samples
2–6 with n=5, median and nearest-rank p95 (the maximum of five). These include network time and
external API calls; they are not CPU time or guaranteed cold starts. Record project region from
Supabase settings and hosted runtime/CPU only if available from platform evidence.

2026-10-20 local validation: 5 deployment configuration tests and 14 Deno tests passed, including
synthetic consent/refresh/initiation and browser-transport state-machine tests. All 21 pgTAP tests
passed against the local database. Two-user local Auth/Edge integration passed, including denied
direct token RPCs and anonymous consent, plus the authenticated YouTube status path without live
Google credentials. Type checks and the Pages base-path build passed. Browser transport tests use
synthetic responses; they do not establish real Google CORS.

References:

- [Google server-side OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [YouTube authorization](https://developers.google.com/youtube/data/guides/auth/server-side-web-apps)
- [Resumable protocol](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol)
- [Channel confirmation](https://developers.google.com/youtube/data/reference/rest/v3/channels/list)

Review refactor validation (2026-10-20): 5 deployment tests and 23 Deno tests passed, including
streaming byte limits, startup origin validation, consent, refresh and disconnect behavior. Local
two-user Auth/Edge integration, type checks and the Pages build passed. The refactor adds no
database migration and does not change the frontend action contract.

2026-10-21 interrupted-upload attempt: owner screenshots show browser 308 responses, followed by
repeated backend inspection 502 responses with sanitized `youtube_probe_failed`, including after
disabling network throttling. The existing reservation remains present. No explicit pause or
successful resume is established. A local real-HTTP reproduction with the pinned Deno CLI showed
fetch with redirect=error throws on 308, with or without Location; redirect=manual returns 308 and
its Range header without following Location. Inspection now uses manual redirect handling. At this
point hosted confirmation was pending; the subsequent results below record inspection and resume of
the same reservation.

2026-10-21 live partial-session inspection: owner screenshot shows `session_status=308`,
`complete=false`, `accepted_bytes=262144` (256 KiB). Preflight status was 200; origin, PUT,
request-header, response-origin and Range-exposure diagnostic booleans were all true. This confirms
live inspection of the existing incomplete session now succeeds. These server observations do not
independently prove browser CORS behavior. At this point total file size, explicit pause
confirmation and successful browser resume were not yet established.

2026-10-21 live resume follow-up: after the partial-session inspection above, the owner reported
**Resume / check existing upload** returned “Transfer completed.” A subsequent inspection confirmed
completion, and verification confirmed completed processing and Unlisted visibility (including the
handler's expected channel/job checks). This establishes browser recovery of the existing partially
uploaded session. At this point signed-out playback and the Studio duplicate check for this second
video were pending, as were file size/browser version and explicit pause confirmation. The earlier
video's signed-out playback passed separately.

2026-10-21 owner closeout: the owner confirmed only one video for the resumed upload test, then
confirmed everything works in response to the signed-out playback check. Record this as
owner-confirmed playback and no duplicate for that test. Browser resume, completion inspection,
processing, Unlisted visibility and signed-out playback have now passed. Explicit pause
confirmation, exact file size/browser version remain unrecorded. Authenticated staging timings are
recorded in README.md from the subsequent six-request owner screenshot.
