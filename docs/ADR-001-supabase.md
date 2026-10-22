# ADR 001: Supabase-native MVP backend

Status: accepted through the completed Supabase feasibility/workspace gates (#1/#2). Execution and visibility requirements updated with the owner's decisions on 22 October 2026.

## Decision

Use this project to learn Supabase. Replace the Cloudflare Python/FastAPI + D1 plan with Supabase Auth, Postgres, RLS and TypeScript/Deno Edge Functions. The previous Python-language preference is superseded for new backend work; no Python execution on Supabase is claimed. Preserve legacy code and existing uncommitted Python spike work.

Use the Data API under user JWTs and RLS for ordinary album operations. Use Edge Functions for YouTube OAuth, upload coordination, verified upload-state updates, account deletion and narrowly scoped anonymous sharing. Privileged keys bypass RLS and require explicit authorization; never place them in browser builds. Keep OAuth tokens and upload session URLs inaccessible through public schemas. Manage schema and grants through CLI migrations.

## Boundaries

YouTube remains the only video host, with direct resumable uploads and all four QR presets. Production uploads default to Unlisted; the user may choose Private or explicitly confirm Public after a visibility warning. Requests always send the user's chosen privacy. QR/public app links require successful processing and verified effective Public or Unlisted visibility, with Public confirmation recorded; Private uploads remain ineligible. The existing Unlisted-only staging probe is historical feasibility evidence. No video storage bucket, billing or additional providers.

Supabase hosts the backend, not a general React static site. Issue #26 selects and proves a separate static frontend host and permanent-domain sharing routes early, alongside #3/#4 and before #6/#7. Use synthetic fixtures so the routing proof does not depend on product uploads. Issue #10 retains production activation, backups, monitoring and cost controls. Do not assume Edge Functions serve arbitrary HTML or clean URL paths; validate redirects, SPA fallback, CORS and both Auth and YouTube callback routing.

Issue #25 defines the field-level data retention/refresh/deletion contract before production schema and integrations are finalized. The contract covers API-sourced metadata, user-authored album data, credentials, upload sessions, revocation, logs and backups without requiring a YouTube API call on every scan.

## Reliability and cost

The [balanced pilot decision](PILOT-LIMITS.md), selected on 22 October 2026, separates product capacity, upload admission, provider/channel constraints and cost targets. Its [configuration contract](../mvp/pilot-limits.json) is not yet production enforcement. Enforce counts and quota reservations atomically in Postgres/Edge; browser size/duration declarations are untrusted and require provider verification for app acceptance. The monthly hosting envelope, separate 24/48-hour freshness proposal and backup deletion semantics remain open.

Local Supabase supports development. Free hosted projects may pause after low activity; choose a non-pausing plan before asking users to rely on printed codes. Record current quotas/prices during deployment work. Do not create artificial keep-alives or provision paid resources in this planning change. Verify SQL backup restoration and separately document Auth identity/config and secret recovery.

## Validation

Issue #1 now validates Supabase CLI, Google Auth, two-user RLS, Edge Functions, credential handling and browser upload feasibility. Test direct REST access in addition to UI flows. Old Python Workers spike results do not satisfy the new gate.

## Official references

- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/platform/free-project-pausing
