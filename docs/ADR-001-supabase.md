# ADR 001: Supabase-native MVP backend

Status: proposed for review, requested by the owner on 19 October 2026.

## Decision

Use this project to learn Supabase. Replace the Cloudflare Python/FastAPI + D1 plan with Supabase Auth, Postgres, RLS and TypeScript/Deno Edge Functions. The previous Python-language preference is superseded for new backend work; no Python execution on Supabase is claimed. Preserve legacy code and existing uncommitted Python spike work.

Use the Data API under user JWTs and RLS for ordinary album operations. Use Edge Functions for YouTube OAuth, upload coordination, verified upload-state updates, account deletion and narrowly scoped anonymous sharing. Privileged keys bypass RLS and require explicit authorization; never place them in browser builds. Keep OAuth tokens and upload session URLs inaccessible through public schemas. Manage schema and grants through CLI migrations.

## Boundaries

YouTube remains the only video host: direct resumable uploads, verified Unlisted visibility and all four QR presets remain MVP requirements. No video storage bucket, billing or additional providers.

Supabase hosts the backend, not a general React static site. Issue #10 selects and tests a separate static frontend host and permanent-domain sharing routes. This can remain a thin static delivery service with all stateful backend features in Supabase. Do not assume Edge Functions serve arbitrary HTML or clean URL paths; validate redirects, SPA fallback, CORS and Auth callback routing.

## Reliability and cost

Local Supabase supports development. Free hosted projects may pause after low activity; choose a non-pausing plan before asking users to rely on printed codes. Record current quotas/prices during deployment work. Do not create artificial keep-alives or provision paid resources in this planning change. Verify SQL backup restoration and separately document Auth identity/config and secret recovery.

## Validation

Issue #1 now validates Supabase CLI, Google Auth, two-user RLS, Edge Functions, credential handling and browser upload feasibility. Test direct REST access in addition to UI flows. Old Python Workers spike results do not satisfy the new gate.

## Official references

- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/platform/free-project-pausing
