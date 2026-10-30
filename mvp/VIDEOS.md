# Minimal video management

Issue #5 uses the schema and RLS from #3 and the verified account view from #4. The owner narrowed
the screen to a video list and QR selection. Album CRUD, caption editing and reordering are not
additional screens or controls. The existing owner-only schema retains those app-authored fields
and supports their use by the upload/print flows.

The default signed-in screen shows `Your videos`, an explicitly unavailable upload entry point,
and selection checkboxes. Actual YouTube connection/uploads remain #14/#15; this screen does not
present the historical staging probe as a production upload flow. QR rendering/downloads remain #7.
The same list also supports existing Unlisted videos from a connected YouTube channel. Discovery
is implemented through the `channel-library` Edge Function; #14 still supplies the production
channel-connection/consent UI and workflow credentials. There is no pasted-link import, fake upload
action, public album page or stored QR archive. The owner's [future album flow](../docs/FUTURE.md)
is recorded separately and does not add album controls now.

## List and selection

The [navigation plan](../docs/ROUTING.md) places this screen at `/videos`, using the shared router
from #26. Direct loads, reloads and Back/Forward must respect the current verified account and
workflow expiry. Selection/provider data stays in memory, never in route URLs or browser history;
reloading may clear it. This integration adds no album CRUD or public sharing screen.

- `Videos.tsx` mounts only for the currently verified, non-deleting account. Its owner key resets
  private state on account changes; sign-out and pending deletion unmount it.
- `loadVideoLibrary` uses the authenticated, generated-type Supabase client. Explicit owner filters
  complement database RLS; an owner argument is not authorization. The service key is never used.
  A single `video_library` view query joins entries, albums, the latest visible job, workflow expiry
  and QR readiness in one database snapshot. It uses `security_invoker`, so the caller's RLS applies
  to all underlying reads. `toVideoItem` handles presentation mapping separately from loading.
- Display order is `(album.sort_order, album.id, video.sort_order, video.id)`. Captions are rendered
  as text; empty captions use a numbered label. Provider upload titles/file names are not copied into
  lasting captions. Temporary provider IDs for eligible uploads allow deduplication with existing
  channel videos; they are never saved in lasting fields or browser storage.
- The latest upload job per entry is chosen by `(created_at DESC, id DESC)`. Only a matching row in
  the security-invoker `qr_ready_uploads` view makes that job selectable. Pending, processing,
  failed, Private, unverified, wrong-channel, missing-playback and over-limit jobs stay disabled.
  An older eligible upload is not substituted for a newer pending upload.
- Only jobs with a live workflow can display upload state or verified visibility. At expiry an
  in-page timer hides that information and disables/clears effective selection, even while idle.
  Returning to the tab and `Refresh videos` reload app data and one channel page, clearing selection.
  No periodic provider refresh jobs or persistent browser storage are introduced.
- Loading and failed reads hide selection. A failed readiness read fails the whole list closed;
  the refresh action retries. After workflow cleanup, reloading shows retained captions and album
  titles with no active-upload status and no QR selection.

## Existing Unlisted videos

- The backend derives the app owner from a verified Auth identity/live session. A service-only
  `channel_library_context` RPC returns credentials only for that owner's live workflow and verified
  channel, excluding revocation intent and deleting profiles. Historical probe credentials are not
  accepted. Without a production workflow connection, the app clearly reports that connection is
  still needed rather than presenting a fake channel library.
- Discovery reconfirms the owned channel with `channels.list(mine=true)`, reads its uploads playlist,
  then checks actual `videos.list` metadata. Only matching-channel Unlisted videos are returned;
  Public, Private, deleted and unavailable results are excluded. Processing videos are visible but
  disabled. The list does not change visibility or upload another copy of an existing video.
  This is YouTube's automatic index of channel uploads, not a user-created playlist or an app album.
  The helper is named `ownedUploadsPlaylistId`; discovery creates or edits no YouTube playlists.
- Each request examines at most 50 playlist entries. `Load more YouTube videos` continues with the
  same workflow and provider cursor, including pages containing no Unlisted results. Repeated IDs
  are deduplicated, including eligible videos already represented by app uploads.
- API titles, IDs and cursors remain in component memory for the active workflow only. They are not
  copied to album titles, lasting captions, jobs or a provider archive. Expiry erases channel rows
  and selection; sign-out/account switching unmounts the private state. Refresh and failed page reads
  clear stale channel data. Credential rotation uses a backend-only compare-and-swap without extending
  the deadline; terminal `invalid_grant` clears the unusable workflow and requires reconnection.
- A metadata-verified Unlisted video may be selected for the upcoming print flow. It is explicitly
  labeled as still requiring the anonymous playback check. `verifyChannelSelection` rechecks the
  channel, processing and current visibility; it returns no destination and explicitly requires that
  remaining check. `resolveQrSelection` refuses channel QR destinations until #7/#15 connects the
  trusted anonymous playback gate. Metadata visibility is not treated as playback evidence.
- The workflow is checked before every provider request and after reads, so disconnect, cleanup or
  expiry during discovery discards the response. Provider failures are sanitized; responses are
  `no-store`, and no credentials reach the browser.

## Upload and QR integration contract

1. #15 creates/chooses an owner-scoped `albums.id`, creates `videos.id` entries, and attaches jobs
   through `upload_workflows.id` and `request_upload`. Existing `videos.caption`/`sort_order`,
   `albums.title`/`sort_order`/`qr_preset_id` are app-authored controls. Do not persist provider
   upload inputs into these fields automatically. The list reads these existing relations through
   the `video_library` projection; it adds no new lasting storage.
2. #15 owns consent, visibility selection/Public confirmation, upload progress/retry/resume/cancel
   and trusted processing/visibility verification. The list cannot write those protected fields.
   Its upload button must stay unavailable until that production integration is implemented.
3. An uploaded `QrChoice` carries `{videoId, jobId, workflowId}`. An existing-video choice carries
   `{source: "channel", videoId, workflowId}`, where `videoId` is a temporary provider identifier.
   `selectedChoices` returns live choices in displayed order. All selection stays in memory only.
4. #7 connects that selection to its download action and calls `resolveQrSelection` immediately
   before generating. The resolver rereads the list and owner-only readiness view, rejects any
   missing/mismatched/stale choice, and constructs only canonical
   `https://www.youtube.com/watch?v=<11-character-ID>` destinations. Other providers, credentials,
   alternate hosts, redirects, extra query parameters and fragments are rejected. This helper alone
   does not implement QR generation, anonymous playback verification or upload production readiness.
5. Keep resolved destinations in memory only. Deliver owner downloads before trusted workflow
   completion/cleanup. #7/#15 must handle cleanup/expiry races at that final boundary. All four QR
   style slots remain in the schema; this issue adds no extra style-management screen.

Deleting albums/entries through the existing owner-only Data API cascades their workflow records.
It neither calls YouTube nor changes videos or already printed direct codes. Account deletion uses
the existing confirmed flow. Fixed expiry, cleanup scheduling and backup deadlines remain governed
by [ADR 002](../docs/ADR-002-direct-youtube-qr.md) and [the database contract](DATABASE.md).

## Validation and synthetic fixtures

`npm test` checks expiry/order-aware selection and strict YouTube destination validation.
`npm run test:browser` seeds explicitly named synthetic albums/captions/jobs in disposable local
Supabase, tests actual owner-scoped list/QR queries, and deletes those accounts afterward. It covers
eligibility, cleanup, stale choices, account isolation/sign-out, and loading/error/empty/retry states.
The channel tests mock Google responses for pagination, visibility filtering, foreign channels,
credential access, cleanup races and the separate playback gate. Browser fixtures additionally test
existing-video selection, deduplication, pagination, page failure/retry and expiry erasure. These
fixtures never upload media or verify a real provider video; they do not satisfy production
upload, playback or QR readiness. Existing SQL/direct-API tests exercise forged ownership,
protected fields and deletion cascades. The channel-library migration adds only narrow backend RPCs;
the joined-library migration adds a read-only security-invoker view. Generated public types are
regenerated from the disposable local schema. SQL and direct-API checks cover ownership, retained
entries after cleanup, and latest-job selection through this view; browser checks assert one list
database request and preserve loading/error/expiry coverage.

For historical synthetic upload validation only, open the existing frontend with `?tools=1`.
The YouTube callback also opens those tools so an in-flight staging consent still completes.
This opt-in is a presentation switch, not an access control: all probe endpoints retain their own
authentication. The normal video screen never invokes them. See [YOUTUBE.md](YOUTUBE.md).

Official API references checked on 26 October 2026:
[retrieve uploaded videos](https://developers.google.com/youtube/data/guides/implementation/videos),
[playlist pagination](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list),
[owner-only processing details](https://developers.google.com/youtube/data/reference/rest/v3/videos/list).
