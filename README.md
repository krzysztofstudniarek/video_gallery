# Video Album / Fotoplastikon

Turn videos hosted in your own accounts into QR codes for a physical photo album.

## Project status

This repository currently contains the original 2017 Python 2/Bottle prototype. The Cloudflare MVP is planned, not implemented or deployed. Do not deploy the legacy application for public use: its authentication, ownership checks, dependencies and filesystem storage require replacement.

## Free MVP

Sign in with Google, connect your YouTube channel, create an album, upload videos through the app, add captions and order, choose a predefined QR style, print QR sheets, and scan to watch. Every upload explicitly uses YouTube Unlisted visibility: anyone with the link can view and share it. YouTube Private instead restricts viewing to selected accounts. The service stores metadata and encrypted authorization credentials, not video files.

- [MVP scope and architecture](docs/MVP.md)
- [Free MVP milestone](https://github.com/krzysztofstudniarek/video_gallery/milestone/1)
- [Implementation backlog](docs/MVP.md#implementation-order)
- [Contributing](CONTRIBUTING.md)

YouTube uploads are required for the MVP. Other platforms, payments, AI features and service-owned video hosting are deferred. Applicable Google/YouTube approvals and quotas must be verified before public launch.

## Planned stack

Modern Python + FastAPI on Cloudflare Workers, D1 for metadata, React/TypeScript/Vite for the frontend, and browser-generated QR SVGs and print sheets. Python runtime and dependency versions will be pinned after the compatibility spike in issue #1.

## Legacy source

`application.py`, `src/`, `views/`, `static/`, `tests/`, and the Pipfiles remain intact as reference. No working modern development command exists yet; issue #2 must add a reproducible setup and CI.

## Feedback and privacy

Public GitHub issues are suitable for general suggestions and sanitised bug reports. Never post unlisted video URLs, printed QR images, family media, credentials or personal information. The planned pilot includes a private feedback form.

## Hosting

Production hosting, a permanent domain and Google OAuth credentials are not configured by this planning change. Cloud accounts, usage limits, backups and release checks are covered by issue #10.
