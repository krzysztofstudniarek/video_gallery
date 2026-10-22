# ADR 001: Supabase-native MVP backend

Status: accepted through the completed Supabase feasibility/workspace gates (#1/#2). Execution, visibility and direct-QR/lifecycle requirements updated with the owner's decisions on 22 October 2026.

## Decision

Use this project to learn Supabase. Replace the Cloudflare Python/FastAPI + D1 plan with Supabase Auth, Postgres, RLS and TypeScript/Deno Edge Functions. The previous Python-language preference is superseded for new backend work; no Python execution on Supabase is claimed. Preserve legacy code and existing uncommitted Python spike work.

Use the Data API under user JWTs and RLS for ordinary album operations. Use Edge Functions for YouTube OAuth, upload coordination, verified upload-state updates, account deletion and temporary workflow cleanup. Privileged keys bypass RLS and require explicit authorization; never place them in browser builds. Keep OAuth tokens and upload session URLs inaccessible through public schemas. Manage schema and grants through CLI migrations.

## Boundaries

YouTube remains the only video host, with direct resumable uploads and all four QR presets. Production uploads default to Unlisted; the user may choose Private or explicitly confirm Public after a visibility warning. Requests always send the user's chosen privacy. QR generation requires successful processing and verified effective Public or Unlisted visibility, with Public confirmation recorded; Private uploads remain ineligible. The existing Unlisted-only staging probe is historical feasibility evidence. No video storage bucket, billing or additional providers.

Supabase hosts the backend, not a general React static site. Issue #26 validates separate static frontend hosting, SPA deep links, Auth/YouTube callbacks and CORS. Issue #10 retains production activation, backups, monitoring and cost controls.

[ADR 002](ADR-002-direct-youtube-qr.md), accepted on 22 October 2026, supersedes app QR redirects and public album/cover routes. Every QR contains the final YouTube watch URL; playback does not depend on app uptime or authorization. Users download finished sheets and a captions-and-links export for later reprinting. Keep app-authored albums/captions/order/style, but remove temporary provider data and credentials at workflow completion/cancellation, with an absolute seven-day maximum for interrupted workflows. No ongoing metadata refresh or persistent provider/QR archive. ADR 002 supplies the #25 schema, deletion, log and backup contract.

## Reliability and cost

The [balanced pilot decision](PILOT-LIMITS.md), selected on 22 October 2026, separates product capacity, upload admission, provider/channel constraints and cost targets. Its [configuration contract](../mvp/pilot-limits.json) is not yet production enforcement. Enforce counts and quota reservations atomically in Postgres/Edge; browser size/duration declarations are untrusted and require provider verification for app acceptance. The monthly hosting envelope and implementation of backup deletion remain release work. ADR 002 supersedes the proposed 24/48-hour sharing freshness policy.

Local Supabase supports development. Free hosted projects may pause after low activity; select hosting that supports upload availability and reliable expiry cleanup. Printed codes reach YouTube directly and have no app-uptime dependency. Record current quotas/prices during deployment work. Do not create artificial keep-alives or provision paid resources in this planning change. Verify SQL backup restoration and separately document Auth identity/config and secret recovery.

## Validation

Issue #1 now validates Supabase CLI, Google Auth, two-user RLS, Edge Functions, credential handling and browser upload feasibility. Test direct REST access in addition to UI flows. Old Python Workers spike results do not satisfy the new gate.

## Official references

- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/platform/free-project-pausing
