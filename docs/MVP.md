# Free MVP scope

## Goal

Let a small group make physical albums with video QR codes for free and collect evidence about whether the workflow is useful.

Working assumption: the first release uses pasted external links. Users upload videos themselves through YouTube or Vimeo. This removes upload API approval from the launch path. Automatic uploads remain a future feature, not a forgotten requirement.

## User journey

1. Sign in with Google (identity only; no YouTube permissions).
2. Create an album.
3. Paste supported HTTPS YouTube/Vimeo watch links.
4. Add titles/captions and arrange videos.
5. Print individual QR codes or an A4 sheet.
6. Scan without signing into this app; the provider controls actual viewing access.
7. Export the album, delete data or send private feedback.

Optional album sharing is explicitly enabled; individual video codes and album-cover codes have separate sharing semantics.

## Architecture

- One Python/FastAPI Worker API and static React frontend.
- D1 metadata with indexed ownership queries and versioned migrations.
- Persistent app sessions; secure cookies and server-side authorization.
- Stable /v/<token> links use temporary redirects to validated destinations.
- Optional /a/<token> page shows an explicitly shared album.
- Browser-generated SVG QR codes; browser print / Save as PDF.
- No stored video bytes, automatic thumbnail fetching, provider upload jobs or provider refresh tokens in this release.
- No application-wide authentication layer in front of public QR routes.
- No per-request provider availability checks; users verify sharing and playback before printing.
- Direct provider URLs may also be exported, but stable app links depend on domain renewal and service continuity.

Use a supported modern Python runtime and maintained dependencies after issue #1 validates compatibility. A normal Linux process, persistent local filesystem and in-memory sessions cannot be assumed. Consult current Cloudflare documentation during implementation.

## Initial limits and lifecycle

Proposed pilot defaults: 10 albums per account and 50 video links per album. Make limits configurable and enforce them on the backend. Tune from evidence.

Account/album deletion disables affected app links and removes associated app data; it never deletes videos from YouTube or Vimeo. Explain backup retention and deletion timelines in the pilot privacy information. Public bearer links must be treated as shareable access credentials.

## Out of scope

- Automatic uploads and integrations with provider accounts.
- Service-owned video storage, video transcoding, native mobile apps.
- Billing, paid tiers, mailed stickers, AI tools and advanced analytics.
- Additional providers beyond supported pasted YouTube/Vimeo links.
- Automated migration of old CouchDB data/local videos or preservation of historical EC2-hostname links.
- Guaranteed permanent hosting or provider availability.

## Implementation order

- [ ] [#1 — Validate Python Workers, FastAPI, and D1 compatibility](https://github.com/krzysztofstudniarek/video_gallery/issues/1)
- [ ] [#2 — Set up MVP workspace and continuous integration](https://github.com/krzysztofstudniarek/video_gallery/issues/2)
- [ ] [#3 — Implement D1 schema and migrations for accounts, albums, and links](https://github.com/krzysztofstudniarek/video_gallery/issues/3)
- [ ] [#4 — Add Google sign-in and secure owner-only management](https://github.com/krzysztofstudniarek/video_gallery/issues/4)
- [ ] [#5 — Build album and external video-link management](https://github.com/krzysztofstudniarek/video_gallery/issues/5)
- [ ] [#6 — Implement stable public video links and optional album sharing](https://github.com/krzysztofstudniarek/video_gallery/issues/6)
- [ ] [#7 — Create printable QR sheets with captions](https://github.com/krzysztofstudniarek/video_gallery/issues/7)
- [ ] [#8 — Add album export, account deletion, and pilot privacy information](https://github.com/krzysztofstudniarek/video_gallery/issues/8)
- [ ] [#9 — Collect private pilot feedback](https://github.com/krzysztofstudniarek/video_gallery/issues/9)
- [ ] [#10 — Prepare Cloudflare staging, production, backups and cost controls](https://github.com/krzysztofstudniarek/video_gallery/issues/10)
- [ ] [#11 — Run end-to-end checks and launch the free pilot](https://github.com/krzysztofstudniarek/video_gallery/issues/11)

Each GitHub issue contains acceptance criteria and prerequisites. Start with #1, then #2/#3. Auth and core album management precede public sharing and printing. Operational setup can progress after the foundation; #11 is the release gate.

## Pilot release gate

- Critical owner isolation, session, URL-validation and sharing tests pass.
- End-to-end sign-in → album → links → print → anonymous scan works.
- At least one real print is checked on representative iPhone and Android cameras.
- Production domain/OAuth settings, usage alerts and redacted logging are configured.
- A metadata backup is restored into an isolated database.
- Feedback, export and deletion work; beta limitations and retention are published.
- Maintainer signs off and invites 5–10 pilot users; no invitations are sent automatically.

## Learning goals

Aim for at least 3 completed printed albums. Review feedback weekly for task completion, scanning failures, unclear permissions and setup effort. Use opt-in conversations and private feedback, not tracking-heavy analytics. These are learning targets, not a claim of market validation.

## References

- Cloudflare Python: https://developers.cloudflare.com/workers/languages/python/
- Python framework support: https://developers.cloudflare.com/changelog/post/2026-09-02-python-workers-web-framework-support/
- D1: https://developers.cloudflare.com/d1/
- Workers static assets: https://developers.cloudflare.com/workers/static-assets/
