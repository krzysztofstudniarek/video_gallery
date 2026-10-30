# Bookmarkable application navigation

Owner decision: **29 October 2026**. Users must be able to bookmark app screens and use browser
Back/Forward from the start. This supersedes the earlier root-only navigation proposal in #26.
This document is an implementation plan; routing has not been deployed by recording it.

## Architecture and route scope

Keep the existing React/TypeScript/Vite SPA on Vercel at `https://momentsreply.com/`, with Supabase
Auth, PostgreSQL/RLS and Edge Functions as backend. Add one shared React Router layer and ordinary
internal links. No framework migration, custom history router, SSR or Vercel backend is needed.

| Screen | Planned route | Delivery |
| --- | --- | --- |
| Entry, sign-in and existing OAuth return handling | `/` | #26, using completed #4 |
| Existing minimal video list and QR selection | `/videos` | #26 shell and #5 content |
| Account, channel connection and confirmed deletion | `/account` | #26 shell, #14/#8 integration |
| Upload entry and current upload workflow | Final paths agreed in #15; workflow views use app-generated IDs | #15 |
| Owner-only print preview/download | Final path agreed in #7; workflow context uses app-generated IDs | #7 |

The post-login default screen remains **undecided**. A valid bookmarked internal destination takes
precedence over that default. Do not interpret routing approval as approval to build album CRUD,
caption/reordering screens, public album pages or one QR for an album. Those stay in
[future scope](FUTURE.md). Future album routes can be added without changing this foundation.

## Browser behavior and private access

- Direct entry, a new tab, reload, Back and Forward must restore the requested screen from its URL.
  App-screen navigation pushes history; redirects and completed callback cleanup replace history.
  Keystrokes, checkbox changes and progress updates do not each create history entries.
- Vercel must serve the SPA for routed app requests while serving real assets normally. Missing
  assets must fail as assets, not return successful HTML. Unknown app routes show an accessible
  not-found screen; the static SPA may serve that screen with HTTP 200, which is documented rather
  than presented as a server-side 404 guarantee. Test the built site, not only Vite's dev server.
- A signed-out deep link waits for session initialization, offers sign-in and returns to the
  requested internal screen afterward. Store only a validated internal return path temporarily per
  tab, with bounded lifetime and one-use consumption. Reject external/protocol-relative targets,
  malformed paths and callback-bearing return values; fall back to the eventual default safely.
- URL IDs never grant access. Recheck the current verified owner, deleting-account state and
  workflow cancellation/expiry through the existing RLS/Edge boundaries. Use a neutral unavailable
  screen for inaccessible/deleted records. Sign-out/account changes clear private UI and memory;
  Back must not reveal another owner's stale screen or revive a deleted account.
- App/workflow IDs may identify a screen. Provider IDs, watch/session URLs, titles, cursors,
  provider credentials, OAuth payloads and selected provider data must not enter app paths, query strings,
  history state or persistent browser storage. Whitelist any future app filter/query values.
- Give screens useful document titles, semantic links, visible active navigation and predictable
  focus/heading behavior. Browser links should support opening in a new tab.

## Keep the validated OAuth callbacks

The existing persistent Supabase app session and SDK-managed login PKCE verifier from completed
#4 are unchanged. The routing decision adds no provider-data cache and does not replace SDK Auth
storage with a custom token/session mechanism.

| Boundary | Current staging-backed value |
| --- | --- |
| Google identity login to Supabase | `https://djuvcxgoqaahgxyuldlp.supabase.co/auth/v1/callback` |
| Supabase login return, Site URL and exact frontend redirect allowlist | `https://momentsreply.com/` |
| Google YouTube consent return and `YOUTUBE_REDIRECT_URI` | `https://momentsreply.com/?youtube_callback=1` |
| Backend and saved GitHub staging `FRONTEND_ORIGIN` | `https://momentsreply.com` |

These callbacks remain at the root even though private screens gain paths. Do not widen OAuth
allowlists to all app paths or preview domains. Keep identity login separate from YouTube consent.
Capture and remove callback query/fragment values before normal requests and router navigation,
then complete the appropriate flow exactly once. Return to a validated internal path after success
or a sanitized error screen after failure. Never embed a return destination in place of Google's
owner-bound one-time state or weaken PKCE/session checks.

Cover denied, malformed, mixed/duplicate, expired and replayed callbacks, missing/wrong-owner
sessions and overlapping attempts. Never persist raw callback values. URL replacement cannot
erase the initial request received by the host; #26/#10 must separately verify/redact platform logs
and retention. Do not claim browser cleanup alone meets the host logging requirement.

## Workflows and unfinished work

Navigation must never start an upload, repeat a mutation, apply Public confirmation to another
upload, trigger a download or complete/cancel a workflow. Keep active transfer coordination above
individual route components where needed, or explicitly pause/confirm leaving unfinished work.
Test ordinary route changes, browser Back and full reload separately; browsers cannot guarantee
restoring a selected local file after reload.

Keep temporary provider inputs/selection in memory only. Ordinary in-app navigation may preserve
that memory while the owner/workflow remains valid. Reload may require file/selection reentry;
explain that limitation. Recover the same existing job/session rather than initiating a duplicate.
Recheck ownership, cancellation and the original deadline before further work. Restored routes and
retries do not extend expiry, and unknown outcomes are reconciled before any new initiation.

Print previews must revalidate readiness and anonymous playback through #6/#7/#15. After completion,
deletion or expiry, a bookmark shows a safe unavailable/completed state; it cannot regenerate purged
QR destinations. Finished sheets and captions-and-links exports remain user-kept downloads.
All printed QR payloads still point directly to YouTube, independently of app URLs and availability.

## Implementation sequence and issue audit

Reviewed every open issue on 29 October 2026: #5, #6, #7, #8, #10, #11, #12, #14, #15 and #26.
All ten were updated on GitHub. Closed #3/#4/#25 remain closed; routing work does not reopen them.

1. #26 implements the shared router/shell, private-route guard, safe login/consent return, callback
   cleanup and Vercel deep-link/asset behavior using fixtures where feature screens are absent.
   It uses completed #1/#2/#3/#4 and does not depend on downstream feature completion.
2. #5 connects the current minimal video list/selection to `/videos`. #14 connects channel controls
   to account/upload screens. Data, provider discovery and approval research can proceed alongside
   the routing foundation; routed UI consumes it rather than building another router.
3. #15 integrates upload routes, visibility confirmation and navigation/reload recovery using the
   existing #5/#14 contracts. #6 validates direct YouTube destinations independently of app routes.
4. #7 supplies routed private print previews/downloads; #8 supplies account/privacy/export/deletion
   integration. Do not introduce a public preview or persistent provider/QR archive.
5. #10 validates Vercel rollout/rollback, headers, logging and exact callback configuration; splits
   or retires the old Pages publication stage while preserving explicit Supabase deployment order.
   Independent cleanup, backup erasure, production backend provisioning and cost controls stay here.
6. #11 runs the complete navigation/workflow release matrix; #12 tracks the actual completion state.

Routing integration depends on #26; feature/backend work can run in parallel. No dependency from
#26 back to #5/#7/#14/#15 is introduced. This avoids making shared routing wait for its consumers.

## Validation and known state

Require synthetic browser checks for direct entry/reload, Back/Forward, signed-out return, safe
return-target rejection, callback cleanup/replay, two-account isolation, deletion/sign-out then
Back, missing assets and unknown app routes. Add feature checks for active transfer navigation,
file reselection, expired/completed workflow previews and no duplicate side effects. Verify real
hosted deep links, headers and callbacks separately; mocked provider responses do not prove live
OAuth, YouTube processing or browser-to-YouTube upload behavior.

Vercel/domain HTTPS and backend connectivity were observed on 29 October 2026. The owner confirmed
Google login, separate YouTube consent/return/channel connection and the saved GitHub staging
origin change. No upload was requested in these callback migration tests. New routed deep links,
synthetic routing coverage, host logging/privacy and legacy Pages retirement remain open.

Vercel's Production environment currently serves a staging Supabase project. It is not a claim
that #10's separate production backend, cleanup/backup or launch gates are complete. This planning
change does not deploy application code, purchase resources or alter provider settings.
