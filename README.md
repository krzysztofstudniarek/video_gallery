# Video Album / Fotoplastikon

Turn videos hosted in your own accounts into QR codes for a physical photo album.

## Project status

The active Supabase MVP workspace is in [mvp/](mvp/README.md), with a React/TypeScript/Vite frontend, SQL/RLS tests, generated database types and pull request CI. The compatibility app has been validated on staging. The original 2017 Python 2/Bottle prototype remains as reference. Do not deploy the legacy application for public use: its authentication, ownership checks, dependencies and filesystem storage require replacement.

## Free MVP

The planned product flow is: sign in with Google, connect your YouTube channel, create an album, upload videos, add captions/order, choose a QR style, print and scan. Uploads default to Unlisted (anyone with the link can view/share). Users may choose Private or Public; Public requires a warning and explicit confirmation that the video will be publicly visible. QR generation requires successful processing and verified Public or Unlisted visibility; Private is ineligible. The current staging probe remains an Unlisted-only feasibility tool; the production selector/modal is tracked in #15. QR codes contain direct YouTube watch URLs, so scans/playback do not depend on this app. Users download the finished sheets and captions-and-links export for reprinting. The service keeps app-authored album data and temporary encrypted upload/provider data, never video files; provider data is removed at workflow completion/cancellation or within seven days for interrupted work.

- [MVP scope and architecture](docs/MVP.md)
- [Accepted direct YouTube QR and simple retention decision](docs/ADR-002-direct-youtube-qr.md)
- [Free MVP milestone](https://github.com/krzysztofstudniarek/video_gallery/milestone/1)
- [Implementation backlog](docs/MVP.md#implementation-order)
- [Contributing](CONTRIBUTING.md)

YouTube uploads are required for the MVP. Other platforms, payments, AI features and service-owned video hosting are deferred. Applicable Google/YouTube approvals and quotas must be verified before public launch.

## MVP stack

Supabase Auth for Google sign-in, Supabase PostgreSQL with row-level security for metadata, and TypeScript/Deno Edge Functions for YouTube OAuth, upload coordination and pre-print verification. React/TypeScript/Vite supplies the frontend and browser-generated styled QR sheets. Supabase is the backend; frontend hosting, SPA routing and OAuth callbacks are validated in #26, with production activation and operations in #10. #25 is recorded in ADR 002; it supersedes the app redirect/album-sharing plan. No ongoing provider refresh or app-hosted QR resolver is required.

This supersedes the Python/FastAPI/Cloudflare architecture: Supabase Edge Functions do not host Python. The original Python code and any local spike work remain reference; no new Python service is planned. Issue #1 validates the Supabase stack.

## Legacy source

`application.py`, `src/`, `views/`, `static/`, `tests/`, and the Pipfiles remain intact as reference. The active [Supabase workspace](mvp/README.md) provides local development and validation commands. The earlier Python Workers spike remains preserved locally in backend/.

## Feedback and privacy

Public GitHub issues are suitable for general suggestions and sanitised bug reports. Never post unlisted video URLs, printed QR images, family media, credentials or personal information. The owner collects pilot feedback face to face; the app has no feedback form or feedback storage.

## Hosting

Production hosting and a permanent domain are not configured by the workspace change. Frontend host selection and callback/routing validation are covered by #26; production Supabase environments, activation, usage limits, backups and release checks remain in #10.

Supabase Free can pause after low activity. Select production hosting for upload availability and reliable expiry cleanup; printed YouTube codes continue independently of the app. See [backend architecture](docs/ADR-001-supabase.md) and [direct-QR decision](docs/ADR-002-direct-youtube-qr.md).

## Staging deployment

The [deployment guide](mvp/DEPLOYMENT.md) documents the manually triggered Supabase backend and GitHub Pages frontend workflow. Nothing deploys on push. Live Google sign-in and browser-to-YouTube validation evidence is recorded in the [workspace README](mvp/README.md).
