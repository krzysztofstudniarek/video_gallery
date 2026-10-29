# Free MVP scope

## Goal

Let 5–10 pilot users create physical albums with uploaded YouTube videos and styled QR codes for free. Aim for at least 3 completed printed albums and actionable feedback collected face to face by the owner.

## Required scope

YouTube is the only video platform. In-app uploads to the user's own YouTube channel are required; a pasted-link-only release does not satisfy this MVP.

The production upload flow defaults to YouTube Unlisted and lets the user choose Unlisted, Private or Public. Every request explicitly sends the chosen status.privacyStatus; never silently change visibility. Unlisted means anyone with the link can view and share it, Private restricts viewing to selected accounts, and Public is publicly visible and may appear in search results or on the channel.

Selecting Public opens an accessible warning modal explaining that anyone can find and watch the video. The user must explicitly confirm “Use Public” before the selection is applied; Cancel or Escape preserves the previous selection. Choosing or confirming visibility does not start an upload. The backend requires Public confirmation for the specific upload, and a new upload resets that confirmation. The selector and modal are delivered in #15; the existing staging probe remains an Unlisted-only feasibility tool.

QR generation requires successful processing and verified effective Public or Unlisted visibility; Public uploads must have been explicitly confirmed. A Private upload can complete successfully while remaining ineligible for printing. A provider visibility mismatch produces an actionable error and cannot silently change the user's choice.

## User journey

1. Sign in with Google.
2. Separately authorize YouTube uploads and confirm the destination channel.
3. Select videos to upload and set the YouTube visibility; Unlisted is initially selected. Confirm the warning if choosing Public.
4. Explicitly start the upload and see progress/processing; failures have actionable retry/cancel options.
5. Wait for successful processing and verified effective Public or Unlisted visibility before printing. Private remains available as an upload choice but is not eligible for QR generation.
6. Select ready app uploads or existing Unlisted videos from the connected channel, complete the pre-print verification, choose a predefined QR style and preview the sheet.
7. Check anonymous viewing, then download and print individual codes or an A4 sheet. Every code links directly to YouTube.
8. Download the captions-and-links export before finishing. Keep the files for reprinting; scan directly on YouTube without an app account. Delete app data as needed. Pilot feedback is collected face to face by the owner.

App-hosted public album/cover links and later in-app regeneration of old video codes are deferred. Finished workflows remove temporary YouTube data; the downloaded files are the reprinting source. See [the accepted direct-QR and retention decision](ADR-002-direct-youtube-qr.md).

## Architecture

- Supabase-native backend: managed Auth, PostgreSQL/RLS, generated Data API and TypeScript/Deno Edge Functions. The React/Vite frontend is hosted on Vercel at `https://momentsreply.com/`. #26 implements the shared browser-history router and validates deep links/OAuth callbacks; production backend activation and operations remain in #10. No separate Python server.
- Bookmarkable app screens, direct loads/reloads and browser Back/Forward are required from the start. Use one shared React Router layer, guarded owner-only screens, safe signed-out returns and the existing exact root callbacks. Follow the [routing implementation plan](ROUTING.md); the post-login default screen remains undecided. This does not add album-management or public sharing screens.
- Postgres metadata with versioned Supabase SQL migrations, ownership indexes, constraints and tested RLS policies on every exposed table.
- Supabase Auth manages identities/sessions; user-scoped Data API access enforces RLS. Protected Edge Functions validate JWTs. Backend-only privileged keys never enter the frontend.
- Temporary encrypted YouTube credentials in a private non-exposed schema with key IDs/revocation handling; Edge Functions refresh only for the active workflow, separately from Supabase Auth.
- Owner-scoped resumable upload jobs, idempotency keys, bounded polling and processing/visibility verification.
- Keep requested visibility, per-upload Public confirmation, trusted effective visibility and QR eligibility distinct. Browser clients cannot forge verified provider state.
- Validate direct browser-to-YouTube transfers before implementation; no persistent video storage or transcoding in Supabase.
- QR payloads are validated final YouTube watch URLs; scans and playback go directly to YouTube, independently of app hosting or authorization. No production sharing tokens, public resolver or album/cover routes. Anonymous table reads remain denied.
- Browser-generated SVG codes and browser Print / Save as PDF, plus a downloadable captions-and-links export. The user keeps the finished files; the app does not archive provider URLs or QR payloads.
- No app or YouTube API call on scans. Later provider visibility/deletion changes are handled by YouTube; changing a printed destination requires a new code.
- Apply [ADR 002](ADR-002-direct-youtube-qr.md): remove temporary provider data at workflow completion/cancellation, with an absolute seven-day cap for interrupted workflows. OAuth state is single-use/ten minutes. One bounded expiry sweep covers inactive owners too; no ongoing metadata refresh.
- Disconnect/account deletion removes app data as applicable without changing YouTube videos or printed codes.
- Supabase CLI, Deno and frontend dependencies are pinned by completed #2; CI checks formatting, lint, types, tests, builds, migrations/RLS and database type drift. Supabase replaces the earlier Python Workers plan.

## QR styles

Provide at least four predefined presets: Classic Black, Warm Sepia, Botanical Green and Navy Minimal. Preview and save a default per album; apply it to individual SVGs and print sheets.

Use dark modules on light backgrounds, sufficient quiet zones, physical millimetre dimensions and predictable page breaks. Frames and captions stay outside the quiet zone. Changing style must not change the YouTube destination. Verify every preset on actual paper with representative iPhone and Android cameras. Freeform design editing is deferred.

## Limits and data lifecycle

The owner selected the **balanced pilot** on 22 October 2026: 5 albums/account, 50 videos/album, 200 videos/account, 20 upload initiation attempts/account/Pacific day and 60/project/Pacific day. Files are limited to 1 GiB and 10 minutes, with 10 files/selected batch, one active transfer/account and three active transfer admissions/project. Allocate starts round-robin among queued accounts. See the [limits decision, evidence and enforcement matrix](PILOT-LIMITS.md) and [machine-readable contract](../mvp/pilot-limits.json). These are selected product/admission values; production enforcement remains feature work. The probe's 10 MiB bound is historical. Production quotas/shared consumers, implementation of the accepted lifecycle/backup contract and monthly hosting spend remain release work. ADR 002 supersedes the 24/48-hour sharing freshness proposal; never infer production allocations from staging or published defaults.

The owner accepted [ADR 002: direct YouTube QR codes and temporary provider data](ADR-002-direct-youtube-qr.md) on 22 October 2026. Keep app-authored albums/captions/order/style until user deletion. Remove provider metadata, IDs/URLs, credentials and workflow inputs at completion/cancellation, or within seven days of workflow creation for interrupted work; refresh/retry never extends that deadline. Session capabilities clear promptly when terminal; OAuth state expires after ten minutes. Logs exclude sensitive payloads, and backups must not extend original deadlines.

Disconnect stops app provider requests and requests Google revocation; app/account/album deletion clears the relevant data without deleting YouTube videos or changing printed codes. User-request/account deletion completes as soon as possible and within seven calendar days. Use the event matrix and acceptance scenarios in ADR 002 for #3/#6/#7/#8/#10/#14/#15/#25/#26.

Offer a versioned captions-and-links export and finished QR downloads before workflow completion. Once provider data is gone, app exports contain remaining user-authored fields only. Users keep downloaded files for reprinting; no permanent provider destination or QR archive is retained. The owner collects pilot feedback face to face; there is no in-app feedback form or storage.

## Out of scope

The [future album flow](FUTURE.md) will require album creation and one code for a whole album.
That is a later iteration; current selection stays per video.

- Separate album/entry management screens for renaming, caption editing or reordering. Management stays at uploading videos and selecting them for QR codes; existing app-authored storage fields remain available to the upload/print integration.
- In-app feedback forms, feedback storage and feedback administration; pilot feedback is collected face to face.
- Vimeo and every other video platform.
- Pasted-link-only delivery as a substitute for uploads.
- Service-owned video storage/transcoding, app-hosted playback/QR redirects and public album/cover links.
- Permanent provider metadata/QR archives and later in-app regeneration of expired workflows.
- Billing, paid tiers, mailed stickers, native apps, AI and advanced analytics.
- Freeform QR design tools.
- Automated legacy data migration or preservation of old EC2-hostname QR links.
- Guaranteed permanent hosting, provider availability or link confidentiality.

## Implementation order

[ADR 002](ADR-002-direct-youtube-qr.md#implementation-handoff) records the accepted lifecycle and revised implementation responsibilities reflected in the linked GitHub issues.

- [x] [#1 — Validate Supabase Auth, Postgres, RLS and Edge Functions](https://github.com/krzysztofstudniarek/video_gallery/issues/1)
- [x] [#2 — Set up MVP workspace and continuous integration](https://github.com/krzysztofstudniarek/video_gallery/issues/2)
- [x] [#25 — Define YouTube data retention, refresh, revocation and deletion lifecycle](https://github.com/krzysztofstudniarek/video_gallery/issues/25)
- [x] [#3 — Implement Supabase Postgres schema, migrations and RLS](https://github.com/krzysztofstudniarek/video_gallery/issues/3)
- [x] [#4 — Add Supabase Google sign-in and owner-only access](https://github.com/krzysztofstudniarek/video_gallery/issues/4)
- [ ] [#26 — Implement Vercel browser-history routing and validate OAuth callbacks](https://github.com/krzysztofstudniarek/video_gallery/issues/26)
- [ ] [#5 — Build minimal video list and QR selection](https://github.com/krzysztofstudniarek/video_gallery/issues/5)
- [ ] [#14 — YouTube authorization and applicable approval requirements](https://github.com/krzysztofstudniarek/video_gallery/issues/14)
- [ ] [#15 — Resumable uploads with explicit visibility verification](https://github.com/krzysztofstudniarek/video_gallery/issues/15)
- [ ] [#6 — Validate direct YouTube QR destinations](https://github.com/krzysztofstudniarek/video_gallery/issues/6)
- [ ] [#7 — Create styled QR presets and printable sheets](https://github.com/krzysztofstudniarek/video_gallery/issues/7)
- [ ] [#8 — Add album export, account deletion, and pilot privacy information](https://github.com/krzysztofstudniarek/video_gallery/issues/8)
- [ ] [#10 — Prepare Supabase environments, hosting, backups and cost controls](https://github.com/krzysztofstudniarek/video_gallery/issues/10)
- [ ] [#11 — Run end-to-end checks and launch the free pilot](https://github.com/krzysztofstudniarek/video_gallery/issues/11)
Execution order and completion boundaries:

1. #1/#2/#25/#3/#4 are closed. Apply their existing Auth, ownership and lifecycle contracts rather than reopening their completed foundation work.
2. Implement shared navigation in #26 now: bookmarkable video/account screens, root callbacks, safe login returns, Vercel fallback/asset behavior and synthetic browser tests. Feature placeholders can prove the router without waiting for downstream screens. Host/domain and live root callback evidence are recorded, but routed navigation and host privacy/rollout checks remain open.
3. The [minimal video list/QR selection](../mvp/VIDEOS.md) in #5 and production channel work in #14 consume the shared shell for UI integration. Their data/provider work can proceed in parallel. #5 does not wait for #15; album CRUD and caption/order editing remain outside management scope.
4. #15 consumes #5/#14 and adds routed uploads, visibility/Public confirmation, progress and safe navigation/reload/retry/resume/cancel recovery. Navigation cannot initiate another upload or extend expiry. #6 validates direct YouTube destinations independently of app route URLs.
5. #7 adds routed private preview/downloads; #8 integrates account/privacy/export/deletion with navigation. Bookmarks cannot recover purged destinations. #10 handles Vercel release/rollback, exact callbacks, logging, independent cleanup/backups and retiring/splitting the legacy Pages publication stage.
6. #11 gates launch, including the complete navigation matrix in [ROUTING.md](ROUTING.md). #12 remains the release tracker. The post-login default screen remains open; this plan does not add future album screens.

## Pilot release gate

- Sign-in → channel connection → video selection/upload → default-Unlisted upload → processing/visibility verification → preset → print → anonymous scan works. Repeat for explicitly confirmed Public; a completed Private upload cannot generate QR codes.
- Verify the Public warning, confirmation, cancellation/Escape, default selection and backend rejection of unconfirmed Public requests. Selecting visibility alone never uploads. Provider mismatches block QR readiness without changing the requested privacy.
- Applicable Google OAuth publishing/scope verification, YouTube compliance/audit requirements and actual production quotas are checked and resolved separately in #14. Use current official sources and project evidence rather than assuming every unverified project is private-only or every project needs the same audit. Unsupported provider visibility cannot be used as a silent fallback.
- Interrupted/retried uploads do not duplicate videos; revocation, quota failures and incorrect privacy produce clear errors.
- All style presets scan from paper on representative devices.
- Direct Data API RLS tests cover anonymous/user A/user B, including forged ownership, private-schema isolation and protected upload/visibility fields. Auth and Edge Function JWT checks pass; expired temporary data is inaccessible.
- Frontend hosting/OAuth callbacks, redacted logging, usage alerts and upload guardrails are configured.
- Bookmark/direct entry, reload, Back/Forward, safe signed-out return and inaccessible/expired/deleted-route behavior pass on the Vercel custom domain. Back or route remounts cannot expose stale private data, repeat mutations or restart uploads. App routes never become printed QR destinations.
- Restore an independent Postgres backup into an isolated project; document Auth/config/secrets recovery separately.
- Validate production upload/cleanup availability, hosting and budget. Printed playback is independent of Supabase/app uptime; expiry deadlines still apply during inactivity or outages.
- Export, deletion and privacy/beta information are ready. Pilot feedback is collected face to face; no in-app feedback feature is required.
- ADR 002 lifecycle cases pass for workflow expiry/completion, revoked authorization, expired tokens/sessions, failed refresh, user deletion and restored backups; active-workflow checks and cleanup fit the quota budget.
- Maintainer signs off and invites users; this planning change does not deploy an app or provision paid resources.

## References

- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/platform/free-project-pausing
- https://support.google.com/youtube/answer/157177?hl=en
- https://developers.google.com/youtube/v3/docs/videos/insert
- https://developers.google.com/youtube/terms/required-minimum-functionality
- https://developers.google.com/youtube/terms/developer-policies
- https://developers.google.com/youtube/data/determine_quota_cost

## Repository structure and learning path

Use supabase/config.toml, supabase/migrations/, supabase/functions/ and SQL/RLS tests alongside frontend/. Learn local CLI/reset, Auth, relational modelling/RLS, then Edge Functions and YouTube integration. No Supabase Storage video bucket is needed. See ADR-001-supabase.md for the decision and hosting boundary.

## Compatibility workspace

The isolated mvp/ workspace contains supabase/config.toml, migrations, Edge Functions, SQL/RLS tests, generated database types and a React/TypeScript/Vite frontend. Its PR CI resets local Supabase and checks schema type drift without hosted credentials. See [local evidence](../mvp/README.md) and [staging deployment](../mvp/DEPLOYMENT.md). Live Google/YouTube consent, refresh, partial-session browser resume, Unlisted verification and signed-out playback passed on 2026-10-21; see the dated evidence and remaining product limitations in mvp/README.md and mvp/YOUTUBE.md. This historical Unlisted-only probe does not implement the revised production visibility selector or Public warning. ADR 002 supersedes the earlier app-uptime dependency for printed codes. Select hosting for upload/cleanup availability and budget; no paid provisioning is authorized by this decision.
