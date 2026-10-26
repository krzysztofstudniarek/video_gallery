# Minimal video management

Issue #5 uses the schema and RLS from #3 and the verified account view from #4. The owner narrowed
the screen to a video list and QR selection. Album CRUD, caption editing and reordering are not
additional screens or controls. The existing owner-only schema retains those app-authored fields
and supports their use by the upload/print flows.

The default signed-in screen shows `Your videos`, an explicitly unavailable upload entry point,
and selection checkboxes. Actual YouTube connection/uploads remain #14/#15; this screen does not
present the historical staging probe as a production upload flow. QR rendering/downloads remain #7.
There is no pasted-link import, fake upload action, public album page or stored QR archive.

## List and selection

- `Videos.tsx` mounts only for the currently verified, non-deleting account. Its owner key resets
  private state on account changes; sign-out and pending deletion unmount it.
- `loadVideoLibrary` uses the authenticated, generated-type Supabase client. Explicit owner filters
  complement database RLS; an owner argument is not authorization. The service key is never used.
- Display order is `(album.sort_order, album.id, video.sort_order, video.id)`. Captions are rendered
  as text; empty captions use a numbered label. Provider upload titles/file names are not copied into
  lasting captions. No provider IDs or URLs are fetched for displaying the list.
- The latest upload job per entry is chosen by `(created_at DESC, id DESC)`. Only a matching row in
  the security-invoker `qr_ready_uploads` view makes that job selectable. Pending, processing,
  failed, Private, unverified, wrong-channel, missing-playback and over-limit jobs stay disabled.
  An older eligible upload is not substituted for a newer pending upload.
- Only jobs with a live workflow can display upload state or verified visibility. At expiry an
  in-page timer hides that information and disables/clears effective selection, even while idle.
  Returning to the tab and `Refresh videos` reload app data and clear selection. No provider calls,
  metadata refresh jobs or persistent browser storage are introduced.
- Loading and failed reads hide selection. A failed readiness read fails the whole list closed;
  the refresh action retries. After workflow cleanup, reloading shows retained captions and album
  titles with no active-upload status and no QR selection.

## Upload and QR integration contract

1. #15 creates/chooses an owner-scoped `albums.id`, creates `videos.id` entries, and attaches jobs
   through `upload_workflows.id` and `request_upload`. Existing `videos.caption`/`sort_order`,
   `albums.title`/`sort_order`/`qr_preset_id` are app-authored controls. Do not persist provider
   upload inputs into these fields automatically. The minimal list needs no new schema or RPC.
2. #15 owns consent, visibility selection/Public confirmation, upload progress/retry/resume/cancel
   and trusted processing/visibility verification. The list cannot write those protected fields.
   Its upload button must stay unavailable until that production integration is implemented.
3. `QrChoice` carries only `{videoId, jobId, workflowId}`. `selectedChoices` returns effective live
   choices in displayed order. Selection lives only in component memory; reload clears it.
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
These fixtures never upload media or verify a real provider video; they do not satisfy production
upload, playback or QR readiness. Existing SQL/direct-API tests exercise forged ownership,
protected fields and deletion cascades. No migration or generated-type change is required here.

For historical synthetic upload validation only, open the existing frontend with `?tools=1`.
The YouTube callback also opens those tools so an in-flight staging consent still completes.
This opt-in is a presentation switch, not an access control: all probe endpoints retain their own
authentication. The normal video screen never invokes them. See [YOUTUBE.md](YOUTUBE.md).
