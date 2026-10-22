# Free MVP scope

## Goal

Let 5–10 pilot users create physical albums with uploaded YouTube videos and styled QR codes for free. Aim for at least 3 completed printed albums and actionable private feedback.

## Required scope

YouTube is the only video platform. In-app uploads to the user's own YouTube channel are required; a pasted-link-only release does not satisfy this MVP.

The production upload flow defaults to YouTube Unlisted and lets the user choose Unlisted, Private or Public. Every request explicitly sends the chosen status.privacyStatus; never silently change visibility. Unlisted means anyone with the link can view and share it, Private restricts viewing to selected accounts, and Public is publicly visible and may appear in search results or on the channel.

Selecting Public opens an accessible warning modal explaining that anyone can find and watch the video. The user must explicitly confirm “Use Public” before the selection is applied; Cancel or Escape preserves the previous selection. Choosing or confirming visibility does not start an upload. The backend requires Public confirmation for the specific upload, and a new upload resets that confirmation. The selector and modal are delivered in #15; the existing staging probe remains an Unlisted-only feasibility tool.

QR generation and public app links require successful processing and verified effective Public or Unlisted visibility; Public uploads must have been explicitly confirmed. A Private upload can complete successfully while remaining ineligible for printing/public app sharing. A provider visibility mismatch produces an actionable error and cannot silently change the user's choice.

## User journey

1. Sign in with Google.
2. Separately authorize YouTube uploads and confirm the destination channel.
3. Create an album, select videos and set the YouTube title/description and visibility; Unlisted is initially selected. Confirm the warning if choosing Public.
4. Explicitly start the upload and see progress/processing; failures have actionable retry/cancel options.
5. Wait for successful processing and verified effective Public or Unlisted visibility before printing. Private remains available as an upload choice but is not eligible for QR/public app links.
6. Add captions/order, choose a predefined QR style and preview the sheet.
7. Check anonymous viewing, then print individual codes or an A4 sheet.
8. Scan without an app account; export, delete data or submit private feedback.

Album-cover sharing is optional and explicitly enabled; individual video codes have separate sharing semantics.

## Architecture

- Supabase-native backend: managed Auth, PostgreSQL/RLS, generated Data API and TypeScript/Deno Edge Functions. Static React/TypeScript hosting and permanent-route proof are selected early in #26; production activation and operations remain in #10. No separate Python server.
- Postgres metadata with versioned Supabase SQL migrations, ownership indexes, constraints and tested RLS policies on every exposed table.
- Supabase Auth manages identities/sessions; user-scoped Data API access enforces RLS. Protected Edge Functions validate JWTs. Backend-only privileged keys never enter the frontend.
- Encrypted YouTube credentials in a private non-exposed schema with key-version/revocation handling; Edge Functions handle refresh separately from Supabase Auth.
- Owner-scoped resumable upload jobs, idempotency keys, bounded polling and processing/visibility verification.
- Keep requested visibility, per-upload Public confirmation, trusted effective visibility and QR eligibility distinct. Browser clients cannot forge verified provider state.
- Validate direct browser-to-YouTube transfers before implementation; no persistent video storage or transcoding in Supabase.
- Stable /v/<unpredictable-token> links redirect temporarily to validated YouTube watch URLs.
- Optional /a/<token> route displays an explicitly shared album.
- Public sharing uses a narrowly scoped anonymous Edge Function resolver behind validated frontend/domain routing; anonymous table reads remain denied. Credentials never appear in public output.
- Browser-generated SVG codes and browser Print / Save as PDF.
- No YouTube call on every public scan; provider visibility can subsequently change outside the app.
- Apply the lifecycle contract from #25 to API-sourced data, authorization credentials, upload sessions, user-authored data, logs and backups. Define bounded refresh/cleanup and failure behavior for inactive accounts as well as active users.
- Disabling an app link cannot revoke an already-shared YouTube URL.
- Supabase CLI, Deno and frontend dependencies are pinned by completed #2; CI checks formatting, lint, types, tests, builds, migrations/RLS and database type drift. Supabase replaces the earlier Python Workers plan.

## QR styles

Provide at least four predefined presets: Classic Black, Warm Sepia, Botanical Green and Navy Minimal. Preview and save a default per album; apply it to individual SVGs, print sheets and cover codes.

Use dark modules on light backgrounds, sufficient quiet zones, physical millimetre dimensions and predictable page breaks. Frames and captions stay outside the quiet zone. Changing style must not change the token/destination. Verify every preset on actual paper with representative iPhone and Android cameras. Freeform design editing is deferred.

## Limits and data lifecycle

Proposed configurable defaults: 10 albums/account and 50 videos/album. These are not finalized allocations. Use the [separate limits-planning prompt](LIMITS-AGENT-PROMPT.md) to agree account/project budgets, upload size/duration/concurrency, retries, polling and maintenance limits for #8/#10/#14/#15. The probe's 10 MiB limit is a test bound, not the product limit. Verify current official quota documentation and the actual project's allocations before choosing values; enforce agreed limits server-side and explain them before selection.

Account/album deletion removes app data and disables affected app links without implicitly deleting YouTube videos. Account deletion removes encrypted credentials and revokes authorization where supported. Explain in-progress uploads, backup retention and deletion timelines.

#25 defines the field-level retention/refresh/deletion matrix and the behavior of disconnect, external revocation, expiry and failed refresh. Its contract feeds #3, #6, #8, #9, #10, #14 and #15. Distinguish API-sourced metadata from user-authored captions/order and record applicable policy deadlines with dated sources; do not apply one retention rule to every data category.

Export album captions, ordering and YouTube destinations as versioned JSON. Treat public tokens, upload URLs and unlisted URLs as sensitive. Keep pilot feedback private and avoid automatic media/URL collection.

## Out of scope

- Vimeo and every other video platform.
- Pasted-link-only delivery as a substitute for uploads.
- Service-owned video storage/transcoding.
- Billing, paid tiers, mailed stickers, native apps, AI and advanced analytics.
- Freeform QR design tools.
- Automated legacy data migration or preservation of old EC2-hostname QR links.
- Guaranteed permanent hosting, provider availability or link confidentiality.

## Implementation order

- [x] [#1 — Validate Supabase Auth, Postgres, RLS and Edge Functions](https://github.com/krzysztofstudniarek/video_gallery/issues/1)
- [x] [#2 — Set up MVP workspace and continuous integration](https://github.com/krzysztofstudniarek/video_gallery/issues/2)
- [ ] [#25 — Define YouTube data retention, refresh, revocation and deletion lifecycle](https://github.com/krzysztofstudniarek/video_gallery/issues/25)
- [ ] [#26 — Validate frontend hosting and permanent sharing routes before QR implementation](https://github.com/krzysztofstudniarek/video_gallery/issues/26)
- [ ] [#3 — Implement Supabase Postgres schema, migrations and RLS](https://github.com/krzysztofstudniarek/video_gallery/issues/3)
- [ ] [#4 — Add Supabase Google sign-in and owner-only access](https://github.com/krzysztofstudniarek/video_gallery/issues/4)
- [ ] [#5 — Build albums and YouTube video management](https://github.com/krzysztofstudniarek/video_gallery/issues/5)
- [ ] [#14 — YouTube authorization and applicable approval requirements](https://github.com/krzysztofstudniarek/video_gallery/issues/14)
- [ ] [#15 — Resumable uploads with explicit visibility verification](https://github.com/krzysztofstudniarek/video_gallery/issues/15)
- [ ] [#6 — Implement stable public video links and optional album sharing](https://github.com/krzysztofstudniarek/video_gallery/issues/6)
- [ ] [#7 — Create styled QR presets and printable sheets](https://github.com/krzysztofstudniarek/video_gallery/issues/7)
- [ ] [#8 — Add album export, account deletion, and pilot privacy information](https://github.com/krzysztofstudniarek/video_gallery/issues/8)
- [ ] [#9 — Collect private pilot feedback](https://github.com/krzysztofstudniarek/video_gallery/issues/9)
- [ ] [#10 — Prepare Supabase environments, hosting, backups and cost controls](https://github.com/krzysztofstudniarek/video_gallery/issues/10)
- [ ] [#11 — Run end-to-end checks and launch the free pilot](https://github.com/krzysztofstudniarek/video_gallery/issues/11)
Execution order and completion boundaries:

1. #1/#2 are complete. Define the lifecycle contract in #25 before finalizing production schema #3; Auth #4 follows #3.
2. Start #26 alongside this foundation using synthetic route/resolver fixtures. It depends only on #1/#2 and must finish before #6/#7. Host choice, deep links, callbacks, canonical QR URLs and project-change routing are its early deliverables; production activation stays in #10.
3. After #4, album CRUD/entry management #5 and channel integration #14 can proceed independently. Approval/quota discovery for #14 and limits planning may start earlier without waiting for implementation.
4. #5 closes with album/entry management and a documented integration contract, using synthetic fixtures where needed. #15 then consumes #5/#14 and owns the integrated upload entry points, visibility selector/modal, progress, retries, resume/cancel and recovery. #5 does not depend on #15.
5. After #15 and the #26 routing proof, implement sharing #6 and printing #7. Lifecycle/export/deletion #8 and private feedback #9 consume #25; final operations #10 consumes #25/#26 and provider readiness.
6. #11 gates launch with all dependencies complete. Numbers reflect creation order; #12 remains the release tracker.

## Pilot release gate

- Sign-in → channel connection → album → default-Unlisted upload → processing/visibility verification → preset → print → anonymous scan works. Repeat for explicitly confirmed Public; a completed Private upload cannot generate QR/public app links.
- Verify the Public warning, confirmation, cancellation/Escape, default selection and backend rejection of unconfirmed Public requests. Selecting visibility alone never uploads. Provider mismatches block QR readiness without changing the requested privacy.
- Applicable Google OAuth publishing/scope verification, YouTube compliance/audit requirements and actual production quotas are checked and resolved separately in #14. Use current official sources and project evidence rather than assuming every unverified project is private-only or every project needs the same audit. Unsupported provider visibility cannot be used as a silent fallback.
- Interrupted/retried uploads do not duplicate videos; revocation, quota failures and incorrect privacy produce clear errors.
- All style presets scan from paper on representative devices.
- Direct Data API RLS tests cover anonymous/user A/user B, including forged ownership, private-schema isolation and protected upload/visibility fields. Auth, Edge Function JWT and sharing-token checks pass.
- Permanent domain/OAuth setup, redacted logging, usage alerts and upload guardrails are configured.
- Restore an independent Postgres backup into an isolated project; document Auth/config/secrets recovery separately.
- Resolve Supabase Free inactivity pausing before durable printed-link use; production plan and separate static hosting are explicit.
- Feedback, export, deletion and privacy/beta information are ready.
- #25 lifecycle cases pass for stale provider data, revoked authorization, expired tokens/sessions, failed refresh, user deletion and restored backups; background work fits the agreed quota budget.
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

The isolated mvp/ workspace contains supabase/config.toml, migrations, Edge Functions, SQL/RLS tests, generated database types and a React/TypeScript/Vite frontend. Its PR CI resets local Supabase and checks schema type drift without hosted credentials. See [local evidence](../mvp/README.md) and [staging deployment](../mvp/DEPLOYMENT.md). Live Google/YouTube consent, refresh, partial-session browser resume, Unlisted verification and signed-out playback passed on 2026-10-21; see the dated evidence and remaining product limitations in mvp/README.md and mvp/YOUTUBE.md. This historical Unlisted-only probe does not implement the revised production visibility selector or Public warning. Before printed codes are relied upon, use a Supabase Pro organization without inactivity pausing; no paid provisioning is authorized by this decision.
