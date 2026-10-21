# Video Album / Fotoplastikon

Turn videos hosted in your own accounts into QR codes for a physical photo album.

## Project status

The active Supabase MVP workspace is in [mvp/](mvp/README.md), with a React/TypeScript/Vite frontend, SQL/RLS tests, generated database types and pull request CI. The compatibility app has been validated on staging. The original 2017 Python 2/Bottle prototype remains as reference. Do not deploy the legacy application for public use: its authentication, ownership checks, dependencies and filesystem storage require replacement.

## Free MVP

Sign in with Google, connect your YouTube channel, create an album, upload videos through the app, add captions and order, choose a predefined QR style, print QR sheets, and scan to watch. Every upload explicitly uses YouTube Unlisted visibility: anyone with the link can view and share it. YouTube Private instead restricts viewing to selected accounts. The service stores metadata and encrypted authorization credentials, not video files.

- [MVP scope and architecture](docs/MVP.md)
- [Free MVP milestone](https://github.com/krzysztofstudniarek/video_gallery/milestone/1)
- [Implementation backlog](docs/MVP.md#implementation-order)
- [Contributing](CONTRIBUTING.md)

YouTube uploads are required for the MVP. Other platforms, payments, AI features and service-owned video hosting are deferred. Applicable Google/YouTube approvals and quotas must be verified before public launch.

## MVP stack

Supabase Auth for Google sign-in, Supabase PostgreSQL with row-level security for metadata, and TypeScript/Deno Edge Functions for YouTube OAuth, upload coordination and sharing. React/TypeScript/Vite supplies the frontend and browser-generated styled QR sheets. Supabase is the backend; static frontend hosting is selected and validated in #10.

This supersedes the Python/FastAPI/Cloudflare architecture: Supabase Edge Functions do not host Python. The original Python code and any local spike work remain reference; no new Python service is planned. Issue #1 validates the Supabase stack.

## Legacy source

`application.py`, `src/`, `views/`, `static/`, `tests/`, and the Pipfiles remain intact as reference. The active [Supabase workspace](mvp/README.md) provides local development and validation commands. The earlier Python Workers spike remains preserved locally in backend/.

## Feedback and privacy

Public GitHub issues are suitable for general suggestions and sanitised bug reports. Never post unlisted video URLs, printed QR images, family media, credentials or personal information. The planned pilot includes a private feedback form.

## Hosting

Production hosting and a permanent domain are not configured by the workspace change. Supabase projects, static frontend hosting, usage limits, backups and release checks are covered by issue #10.

Supabase Free can pause after low activity. Evaluate a non-pausing production plan before users rely on printed links; do not promise permanent availability. See [architecture decision](docs/ADR-001-supabase.md).

## Staging deployment

The [deployment guide](mvp/DEPLOYMENT.md) documents the manually triggered Supabase backend and GitHub Pages frontend workflow. Nothing deploys on push. Live Google sign-in and browser-to-YouTube validation evidence is recorded in the [workspace README](mvp/README.md).
