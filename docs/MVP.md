# Free MVP scope

## Goal

Let 5–10 pilot users create physical albums with uploaded YouTube videos and styled QR codes for free. Aim for at least 3 completed printed albums and actionable private feedback.

## Required scope

YouTube is the only video platform. In-app uploads to the user's own YouTube channel are required; a pasted-link-only release does not satisfy this MVP.

Every upload explicitly sets status.privacyStatus=unlisted. YouTube Unlisted means anyone with the link can view and share it; Private means selected accounts only. Never publish Public or silently change privacy. Explain this distinction before upload.

## User journey

1. Sign in with Google.
2. Separately authorize YouTube uploads and confirm the destination channel.
3. Create an album and select videos to upload.
4. See upload progress and processing; failures have actionable retry/cancel options.
5. Wait for successful processing and verified Unlisted visibility.
6. Add captions/order, choose a predefined QR style and preview the sheet.
7. Check anonymous viewing, then print individual codes or an A4 sheet.
8. Scan without an app account; export, delete data or submit private feedback.

Album-cover sharing is optional and explicitly enabled; individual video codes have separate sharing semantics.

## Architecture

- Python/FastAPI Worker API and static React/TypeScript frontend.
- D1 metadata, indexed ownership queries and versioned migrations.
- Persistent secure sessions and owner-only management.
- Encrypted YouTube credentials with key-version and revocation handling.
- Owner-scoped resumable upload jobs, idempotency keys, bounded polling and processing/visibility verification.
- Validate direct browser-to-YouTube transfers before implementation; no persistent video storage or transcoding in Cloudflare.
- Stable /v/<unpredictable-token> links redirect temporarily to validated YouTube watch URLs.
- Optional /a/<token> route displays an explicitly shared album.
- Public QR routes do not require app login; credentials never appear in them.
- Browser-generated SVG codes and browser Print / Save as PDF.
- No YouTube call on every public scan; provider visibility can subsequently change outside the app.
- Disabling an app link cannot revoke an already-shared YouTube URL.
- Runtime/dependency versions are pinned after #1 validates current Python Workers compatibility.

## QR styles

Provide at least four predefined presets: Classic Black, Warm Sepia, Botanical Green and Navy Minimal. Preview and save a default per album; apply it to individual SVGs, print sheets and cover codes.

Use dark modules on light backgrounds, sufficient quiet zones, physical millimetre dimensions and predictable page breaks. Frames and captions stay outside the quiet zone. Changing style must not change the token/destination. Verify every preset on actual paper with representative iPhone and Android cameras. Freeform design editing is deferred.

## Limits and data lifecycle

Proposed configurable defaults: 10 albums/account and 50 videos/album. Define upload size/duration/concurrency limits after the upload prototype, enforce them server-side and explain them before selection.

Account/album deletion removes app data and disables affected app links without implicitly deleting YouTube videos. Account deletion removes encrypted credentials and revokes authorization where supported. Explain in-progress uploads, backup retention and deletion timelines.

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

- [ ] [#1 — Validate Python Workers, FastAPI, and D1 compatibility](https://github.com/krzysztofstudniarek/video_gallery/issues/1)
- [ ] [#2 — Set up MVP workspace and continuous integration](https://github.com/krzysztofstudniarek/video_gallery/issues/2)
- [ ] [#3 — Implement D1 schema and migrations for accounts, albums, and links](https://github.com/krzysztofstudniarek/video_gallery/issues/3)
- [ ] [#4 — Add Google sign-in and secure owner-only management](https://github.com/krzysztofstudniarek/video_gallery/issues/4)
- [ ] [#5 — Build albums and YouTube video management](https://github.com/krzysztofstudniarek/video_gallery/issues/5)
- [ ] [#6 — Implement stable public video links and optional album sharing](https://github.com/krzysztofstudniarek/video_gallery/issues/6)
- [ ] [#7 — Create styled QR presets and printable sheets](https://github.com/krzysztofstudniarek/video_gallery/issues/7)
- [ ] [#8 — Add album export, account deletion, and pilot privacy information](https://github.com/krzysztofstudniarek/video_gallery/issues/8)
- [ ] [#9 — Collect private pilot feedback](https://github.com/krzysztofstudniarek/video_gallery/issues/9)
- [ ] [#10 — Prepare Cloudflare staging, production, backups and cost controls](https://github.com/krzysztofstudniarek/video_gallery/issues/10)
- [ ] [#11 — Run end-to-end checks and launch the free pilot](https://github.com/krzysztofstudniarek/video_gallery/issues/11)
- [ ] [#14 — YouTube authorization and approval requirements](https://github.com/krzysztofstudniarek/video_gallery/issues/14)
- [ ] [#15 — Resumable uploads and Unlisted verification](https://github.com/krzysztofstudniarek/video_gallery/issues/15)

Execution order: #1–#4 establish the foundation; #5 and #14 prepare album/upload integration; #15 completes uploads; #6–#10 finish sharing/printing/operations; #11 gates launch. Numbers reflect creation order. The tracker is #12.

## Pilot release gate

- Sign-in → channel connection → album → upload → verified Unlisted → preset → print → anonymous scan works.
- Applicable Google OAuth verification, YouTube audit requirements and production quotas are checked and resolved. If the project is restricted to Private uploads, launch is blocked until resolved; never fall back to Public.
- Interrupted/retried uploads do not duplicate videos; revocation, quota failures and incorrect privacy produce clear errors.
- All style presets scan from paper on representative devices.
- Cross-account isolation, CSRF/session, URL and token checks pass.
- Permanent domain/OAuth setup, redacted logging, usage alerts and upload guardrails are configured.
- Restore an independent metadata backup into an isolated database.
- Feedback, export, deletion and privacy/beta information are ready.
- Maintainer signs off and invites users; this planning change does not deploy an app or provision paid resources.

## References

- https://developers.cloudflare.com/workers/languages/python/
- https://developers.cloudflare.com/d1/
- https://developers.cloudflare.com/workers/static-assets/
- https://support.google.com/youtube/answer/157177?hl=en
- https://developers.google.com/youtube/v3/docs/videos/insert
