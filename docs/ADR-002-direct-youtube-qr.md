# ADR 002: Direct YouTube QR codes and temporary provider data

Status: **accepted by the owner on 22 October 2026** in the discussion of
[#25](https://github.com/krzysztofstudniarek/video_gallery/issues/25).
This is the production design contract; implementation remains in the linked feature issues.

## Decision

Every video QR encodes the final `https://www.youtube.com/watch?v=<video-id>` URL directly.
YouTube hosts the video and handles playback and visibility. A scan does not contact VideoAlbum,
Supabase, a redirect service or an app-owned domain. Disconnecting, deleting an app account or an
app outage does not change an already printed code. Deleting the video or changing its visibility
in YouTube can affect viewing. Changing a printed destination requires a new printed code.

After processing, verify the expected channel/job and effective Public or Unlisted visibility
before QR generation. Public requires explicit per-upload confirmation; Private and a visibility
mismatch remain ineligible. Verify anonymous playback in the pre-print flow. Preserve all four
predefined QR styles and keep captions outside the code's quiet zone.

Offer the finished QR sheet/individual codes and a versioned captions-and-links export for download
before completing the workflow. The user keeps these files for later reprinting. Later in-app
regeneration from retained YouTube destinations is deferred. Explain this before finishing, and do
not claim that the app can recover downloaded files. A new explicit upload workflow may add new
entries to an existing album; it does not recover purged provider attachments.

This supersedes app `/v/<token>` redirects, public album/cover links, sharing tokens, scan-time
eligibility checks, ongoing provider metadata refresh and the proposed 24/48-hour sharing freshness
windows. The historical staging resolver stays as feasibility evidence, not the production design.
An always-on app domain/backend is no longer a prerequisite for playback of printed codes.
Frontend hosting, Auth callbacks, upload availability and cleanup scheduling still need validation.

## Simple retention contract

Keep user-authored app data until the user deletes it. Keep YouTube data only for the current
upload/verification/QR/export workflow, removing it when that workflow finishes or is cancelled.
Interrupted workflows have an absolute **seven-day maximum from workflow creation**, including
all server-held copies. Set the deadline once; retries, token refresh, reads, new metadata and
reconciliation cannot extend it. A provider expiry or deletion request can require earlier cleanup.

| Data class | Location and access | Retention and cleanup |
| --- | --- | --- |
| App identity, album/entry IDs, user-authored album names/captions/order, QR style | Supabase Auth and owner-only RLS tables | Until account/album/entry deletion as applicable; request deletion immediately, complete within seven calendar days. YouTube disconnect preserves independent app data. |
| YouTube title/description/visibility supplied for an upload; API-returned video/channel IDs, titles, URLs, processing/privacy snapshots | Owner-scoped temporary workflow records; trusted code owns verification fields | Workflow completion/cancellation or fixed seven-day deadline, whichever is earlier. Do not copy provider fields into lasting album entries. |
| Refresh tokens and any persisted access tokens | Encrypted private schema, backend-only | Only while required by an unexpired workflow; erase at its end/deadline. Refresh only for that workflow. Explicit disconnect also requests immediate Google revocation. |
| Resumable-session URLs, file names/hashes, job correlation and recovery details | Encrypted session capabilities in private schema; owner-scoped job state | Clear session URLs promptly when transfer is terminal; remove remaining temporary data by workflow end/deadline. Earlier provider expiry stops resume. |
| OAuth state and PKCE verifier | Private schema; owner-bound, state stored hashed | Single atomic use; expires after ten minutes. Delete consumed/expired records; expired state is unusable even before physical cleanup. |
| Consent/public confirmation | Owner-scoped workflow record | Keep confirmation only for the current upload/workflow and never reuse it. A minimal app privacy-policy version/acceptance time may stay with the app account; exclude channel IDs and provider payloads. |
| QR images/PDFs, watch URLs and captions-and-links exports | Generate for the owner to download; no public bucket, persistent app cache or server archive | Any temporary server copy follows the workflow deadline. A QR image still contains a provider identifier. Downloaded/printed copies remain under the user's control. |
| Private feedback | Owner/private support access; separate from provider records | Do not automatically attach media or URLs. Remove on user request/account deletion within seven days; remove resolved feedback within seven days. Unresolved feedback follows the account lifecycle. |
| Logs and counters | Restricted operational access | Sanitized logs at most seven days; anonymous aggregate counts at most 30 days. Never log credentials, OAuth queries, watch/session URLs, video/channel IDs, QR payloads or provider response bodies. |
| Backups, replicas and restore copies | Restricted recovery storage | Do not extend any original expiry/deletion deadline. Exclude temporary provider data from backups, or use a verified erasure/expiry mechanism that meets each record's deadline. Encryption alone does not erase a retained copy. |

An upload title entered solely for YouTube is temporary workflow input. An independently authored
app caption is lasting album data. An API-returned URL does not become app-authored data by being
copied into a caption, export, image or log. Never automatically store these payloads in lasting
album fields. No video bytes are stored by the service.

## Events and expiry

| Event | App behavior | YouTube and printed-code effect |
| --- | --- | --- |
| Successful workflow completion | Deliver downloads, clear temporary provider/credential/job data; preserve app captions/order/style | Existing videos/codes continue under YouTube's rules; a later workflow may require authorization again. Local credential erasure is distinct from grant revocation. |
| Explicit disconnect | Block further app provider requests immediately, request Google token revocation immediately, remove temporary provider data | Do not delete videos or change visibility; existing direct codes remain unchanged. |
| External revocation or terminal refresh rejection | Stop affected work, clear unusable credentials and related provider data; show reconnect-required | No automatic re-upload. Existing codes are independent of the app grant. |
| Access-token expiry | Refresh only for an unexpired, authorized workflow; do not extend its deadline | No effect on already printed codes. |
| Transient network/quota failure | Bounded retries for the same job/session; honor the original deadline | Never initiate a replacement upload as cleanup/recovery. |
| Abandoned/expired workflow | Stop new app requests, remove capabilities and provider records at the deadline | Already transferred bytes/video may remain at YouTube. A local timeout cannot revoke an issued remote upload capability. |
| Album/entry deletion | Immediately deny app access and stop its work; purge associated app and temporary provider data | Other albums remain; do not revoke an account-wide grant merely for one album. Printed codes/videos remain unchanged. |
| Account deletion | Immediately block app access, revoke app sessions, stop jobs, request provider revocation and delete owned app/provider data | Videos and direct printed codes remain on YouTube; explain this in the confirmation. |

Local disconnect/deletion must take effect even if Google's revocation endpoint is unavailable.
Keep only the encrypted token needed for bounded revocation retries, never for new provider calls,
and never beyond the earlier original workflow expiry or seven-day deletion deadline. Do not claim
remote revocation succeeded when it did not. The existing probe's revoke-before-forget sequence
needs replacement in production.

Use one bounded expiry sweep covering all owners, including inactive accounts. Enforce deadlines
on reads/actions as well as cleanup. Schedule physical deletion ahead of hard expiry with enough
margin, monitor cleanup lag and do not depend on a user's next login. A paused backend or failed
scheduler cannot excuse retained data past its deadline. No post-workflow provider refresh or
scan resolver is required. During an active workflow, reconfirm authorization on resume and on
scheduled provider checks; do not keep retrying a terminally rejected grant.

Minimal schema contract: verified `owner_id`, `workflow_id`, immutable `created_at`/`expires_at`,
job state, trusted `verified_at`, requested/effective visibility, per-upload Public confirmation,
and encrypted credential/session envelopes carrying an explicit `key_id`. Keep deletion status
and a minimal deletion ledger free of provider payloads. Workers check ownership, cancellation and
expiry before requests and conditional writes, so late callbacks cannot recreate deleted records.

Keep encryption keys backend-only. Rotate by writing with the current key ID and reading only
permitted older IDs; erase expired ciphertext and retire old keys once no permitted live/recovery
copy needs them. A shared key's rotation does not implement per-user deletion. Restore into
quarantine, apply original expiries and deletion-ledger entries before enabling access/workers, and
never replay an upload initiation. Managed snapshots with a seven-day rolling retention do not
automatically meet a record's seven-day lifetime: verify exclusion/erasure before using them for
temporary data. Backup configuration and scheduler availability are release gates in #10.

## Official policy basis

Checked **22 October 2026**. The product chooses early deletion rather than long-term API caching.

- [YouTube Developer Policies, III.D.3](https://developers.google.com/youtube/terms/developer-policies#d.-accessing-youtube-api-services):
  in-app revocation requires immediate token revocation and authorized-data deletion within seven
  calendar days; external revocation requires periodic authorization checks and deletion within
  30 calendar days of revocation.
- [YouTube Developer Policies, III.E.4](https://developers.google.com/youtube/terms/developer-policies#refreshing-storing-and-displaying-api-data):
  applicable metadata must be refreshed or deleted within 30 calendar days. User-request/account
  deletion must complete as soon as possible and within seven calendar days. Tokens have a separate
  necessity/consent rule; user-authored captions/order are a separate category.
- [Google OAuth expiration](https://developers.google.com/identity/protocols/oauth2#expiration):
  refresh tokens can become invalid for multiple reasons; access-token expiry and authorization
  revocation are distinct events. Testing grants with YouTube scopes may expire after seven days.

## Implementation handoff

The linked GitHub implementation issues are aligned with this accepted decision. Their work remains
open; the documentation PR closes definition issue #25 on merge without claiming production
enforcement.

| Issue | Revised responsibility |
| --- | --- |
| [#3](https://github.com/krzysztofstudniarek/video_gallery/issues/3) | Lasting owner-only app data plus temporary workflow/private capability records, fixed deadlines and protected verification fields; no production sharing-token schema. |
| [#6](https://github.com/krzysztofstudniarek/video_gallery/issues/6) | Replace app redirect/album-sharing scope with validated direct YouTube destinations and independence from app hosting; coordinate with #7/#15. |
| [#7](https://github.com/krzysztofstudniarek/video_gallery/issues/7) | Styled direct-link QR downloads, printable sheets and user-kept reprints; no app cover/share codes or persistent QR archive. |
| [#8](https://github.com/krzysztofstudniarek/video_gallery/issues/8) | Downloadable versioned captions-and-links export before provider cleanup; lasting caption-only export afterward, deletion and clear privacy/reprinting information. |
| [#9](https://github.com/krzysztofstudniarek/video_gallery/issues/9) | Minimal private feedback with the retention rules above. |
| [#10](https://github.com/krzysztofstudniarek/video_gallery/issues/10) | Expiry scheduling/monitoring, redacted logs and backups that meet original deadlines; printed playback has no app uptime dependency. |
| [#14](https://github.com/krzysztofstudniarek/video_gallery/issues/14) | Workflow-limited credentials, encryption key IDs, refresh/reconnect and explicit disconnect/revocation. |
| [#15](https://github.com/krzysztofstudniarek/video_gallery/issues/15) | Direct resumable uploads, trusted pre-print verification, downloads/finish cleanup and nonduplicating expiry/recovery. |
| [#25](https://github.com/krzysztofstudniarek/video_gallery/issues/25) | This lifecycle decision and implementation acceptance scenarios. |
| [#26](https://github.com/krzysztofstudniarek/video_gallery/issues/26) | Frontend hosting, SPA/Auth/YouTube callbacks and CORS; no permanent QR redirect domain or public resolver. |

Long-lived app-wide quota/idempotency ledgers may retain only app-generated keys, counts and expiry
timestamps, never provider identifiers or capabilities. Expiry/reconciliation cannot treat a missing
provider attachment as permission to initiate another upload.

The balanced pilot product/admission values remain in [PILOT-LIMITS.md](PILOT-LIMITS.md) and
[pilot-limits.json](../mvp/pilot-limits.json). Ongoing metadata/scan maintenance estimates and
freshness/resolver proposals there are superseded; active upload checks still require a quota
budget. This document defines behavior, not production enforcement or a purchase authorization.

## Acceptance scenarios

- Anonymous scans of a downloaded/printed code reach YouTube without any app request, including
  while the app is offline, after disconnect and after app account deletion.
- Anonymous callers and user B cannot read/export/finish/delete user A's albums, temporary records,
  credentials or upload capabilities. No public Data API metadata projection is needed.
- Default Unlisted and explicitly confirmed Public generate direct watch-URL codes only after
  trusted verification and the anonymous pre-print check. Private, unprocessed, wrong-channel,
  mismatched visibility and unconfirmed Public cannot generate codes. All four styles scan.
- Downloaded sheets/export remain usable for reprinting after app cleanup. A later album view
  retains captions/order/style but cannot recover provider destinations or regenerate old codes.
- Completion/cancellation, explicit disconnect and deletion clear the relevant temporary data;
  deleting one album does not delete another or alter videos at YouTube.
- Revoked/expired refresh tokens stop work and require reconnection. Transient failures retry only
  within the same fixed deadline; refreshing or opening another tab does not reset it.
- An inactive owner's abandoned workflow expires within seven days, including stored credentials,
  provider IDs/URLs, server artifacts, logs and recovery copies; expired OAuth state is rejected.
- Ambiguous initiation/completion, cleanup races, late callbacks and restored backups cannot
  initiate duplicate uploads or recreate deleted provider records.
- Restore applies expiry/deletion before access or workers start. Backup expiry/erasure and
  encryption key retirement are verified, rather than inferred from log or snapshot retention.
