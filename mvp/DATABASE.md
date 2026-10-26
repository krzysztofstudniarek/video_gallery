# Database contract

Issue #3 adds `20261023000100_album_workflows.sql` after the historical compatibility migrations.
Supabase Auth remains the only identity/session store. Every owned production row references
`auth.users.id`; deleting that identity cascades through its app and workflow data. The separate
private deletion ledger intentionally survives the identity so a restore can honor account deletion.

This migration is the storage/security foundation. Existing frontend/Edge endpoints still use the
historical probes; they do not exercise the production workflow or its lifecycle. Nothing deploys
this migration automatically. Do not treat the probe's sharing resolver, permanent credentials or
revoke-before-forget behavior as production implementations of ADR 002.

## Data and access

| Relation | Class | Client permissions |
| --- | --- | --- |
| `profiles` | Lasting app display name, creation/deletion status; no copied Google profile | Read own live profile; insert own profile; update display name |
| `albums` | Lasting independently authored title, order, QR preset ID | Owner CRUD; preset IDs 1–4 are the four required style slots |
| `videos` | Lasting album entry ID, independently authored caption and order | Owner CRUD; parent album/owner cannot change |
| `upload_workflows` | Temporary owner/album scope with fixed creation/expiry | Owner read/create; finish/cancel is backend-only |
| `upload_jobs` | Temporary upload inputs, per-upload confirmation, provider ID and trusted evidence | Owner read; create through `request_upload`; backend owns all writes |
| `youtube_connections` | Temporary verified channel identity/title for a workflow | Owner read; backend writes |
| `qr_ready_uploads` | Security-invoker view over live jobs/workflows, no archive | Owner read; only verified eligible jobs |
| `video_library` | Security-invoker join of albums/entries/latest job/workflow/readiness, no archive | Owner read; entries without live uploads remain visible |
| Private `workflow_credentials` | Encrypted refresh envelope, explicit `key_id`, revocation intent | No frontend privileges or exposed schema |
| Private `upload_sessions` | Encrypted resumable capability, `key_id`, earlier provider expiry | No frontend privileges or exposed schema |
| Private `oauth_states` | Hashed state, encrypted verifier, `key_id`, one-use deadline | No frontend privileges or exposed schema |
| Private `upload_idempotency` | App-generated request/workflow/job IDs and initiation timestamp only | Backend-only; survives workflow cleanup until account deletion |
| Private `deletion_ledger` | Deleted app resource kind/UUID/time, no provider payload | Backend-only; keep until every recoverable copy has been retired |

Anonymous Data API access is denied on every production relation, including the view. RLS checks
both ownership and a readable parent; composite foreign keys also prevent a child from claiming
another owner's parent. Marking a profile for deletion immediately hides its owned tree. Actual
account deletion uses the Auth admin API to remove identities/sessions, not a second session table.

Column grants permit only app-authored mutations. No table-level client INSERT/UPDATE grants may
be added: they would override column restrictions. The service role bypasses RLS and belongs only
in trusted code. Never expose it through frontend environment variables. Private tables have RLS
with no frontend policies, no frontend privileges and no Data API schema exposure. Generated types
contain only `public`; they are a convenience, not an authorization boundary.

The schema does not store video bytes, public album projections, production share tokens, QR
payloads, watch URLs or finished exports. An active job's provider ID is sufficient for a trusted
pre-print flow to construct a validated direct YouTube watch URL. Never automatically copy upload
inputs/provider values into lasting captions, titles or logs.

## Transactions and workflow use

1. Create an owner profile, album/entries and workflow through an authenticated client. The database
   sets `created_at` and `expires_at = created_at + 7 days`, including for backend inserts. Neither
   value nor the workflow's identity/parent can change. Order albums by `(sort_order, id)` and entries
   within each album by `(sort_order, id)`; ties are deterministic and allow simple reorder updates.
2. Call `request_upload` with a workflow, entry, app-generated UUID idempotency key and upload title.
   Omitted visibility means Unlisted. Private and Public are supported; Public requires an explicit
   `p_confirm_public=true` from the warning/confirmation flow for that upload. The server records
   the timestamp; no client-supplied timestamp or verified field is accepted. The request is immutable.
3. Request creation locks the workflow and atomically reserves the private idempotency key plus job.
   Identical retries return the same job; changed payloads or keys whose provider job was purged fail.
   The provider-free reservation does not cascade with the workflow. A missing job never authorizes
   another upload. Future upload coordination must atomically claim `initiation_claimed_at`, reserve
   pilot admission/quota and change job state before a provider request. An ambiguous result requires
   reconciliation of that same session/job, never a fresh initiation. Quota/count/admission enforcement
   and browser/UI integration remain in #8/#14/#15; this migration does not claim to implement them.
4. Trusted workers write credentials, states and capabilities using narrowly reviewed backend SQL/RPCs.
   Current backend-only RPCs are `consume_upload_oauth`, `finish_upload_workflow` and
   `purge_expired_upload_data`. The channel-library migration also adds service-only
   `channel_library_context` and `rotate_channel_library_credential` for live owner/channel lookup
   and credential compare-and-swap within the original deadline. A service-key PostgREST client cannot select a non-exposed private schema;
   use a restricted backend DB connection or add a narrowly scoped, tested RPC in the owning feature.
   Do not expose the private schema to make backend access convenient. `consume_upload_oauth` atomically
   deletes and returns a live owner/workflow-bound verifier. States are fixed at at most ten minutes,
   capped by workflow expiry, and cannot be replayed.
5. Envelope encryption must authenticate owner, workflow/job, purpose and key version. SQL requires an
   explicit nonempty `key_id` and ciphertext, but cannot prove application encryption. Only trusted
   workers may validate/decrypt envelopes; rotate permitted keys without extending record deadlines.
   Session expiry cannot exceed the workflow deadline or increase on update. Terminal transfer state
   removes session ciphertext immediately. Workers must reject credentials with revocation intent,
   reconfirm authorization on resume and stop on terminal refresh rejection.
6. Backend verification writes requested/effective visibility separately, processing result, expected
   channel verification, verification time, trusted size/duration and anonymous playback evidence.
   The view requires uploaded/successful processing, matching Public/Unlisted visibility, Public
   confirmation, channel verification, playback evidence at/after verification, media within the
   1 GiB/600-second pilot limits and an unexpired workflow. Unverified/missing evidence is ineligible.
   Clients cannot turn these flags on. Workers must make provider checks and condition writes against
   the still-live workflow; do not use a previously read view row as enduring authorization.
7. Generate owner downloads before calling backend `finish_upload_workflow(owner, workflow)`.
   Completion and cancellation delete the entire workflow tree, including provider inputs, IDs,
   channel metadata, credentials, states and sessions. Captions/order/style remain. The SQL function
   cannot prove a download was delivered; #7/#8/#15 must implement that product sequence.

All new functions pin an empty `search_path`; relation names are qualified. Trigger helpers live
in the private schema without frontend EXECUTE grants. The sole authenticated privileged mutation,
`request_upload`, derives the owner from `auth.uid()` and checks/locks its parent. Backend RPCs have
explicit service-role-only EXECUTE grants. Future functions must repeat these checks and grants;
Postgres otherwise grants function EXECUTE to PUBLIC by default.

## Deletion and expiry

- Deleting an album cascades its entries and workflows. Deleting an entry cascades its jobs/sessions
  and ends workflows with no jobs for another entry. Credentials for a workflow serving other entries
  remain scoped to that workflow. Other owners/albums and videos at YouTube are unaffected.
- Finish/cancel and the all-owner expiry sweep physically remove workflow trees. Read RLS already
  hides expired workflows/jobs/connections; child-write triggers reject late writes, missing parents
  and expired workflows, and lock against concurrent deletion. Tombstones reject re-creation of a
  deleted workflow/album/entry UUID. Original idempotency reservations still block retry reuse.
- Marking `profiles.deletion_requested_at` blocks app access immediately. The account deletion handler
  must also revoke Auth sessions, stop workers, request provider revocation and delete the Auth user.
  [Issue #4 authentication](AUTH.md) implements that handler and private deletion/revocation retry
  queues. Local deletion succeeds if Google is unavailable; revocation-only ciphertext is capped by
  the earlier original workflow expiry or seven-day deletion deadline. Account deletion snapshots
  capabilities before removing workflow/probe data. Ordinary finish/cancel still erases credentials
  directly; #14 must apply the shared envelope/key-version contract when storing workflow credentials.
- `purge_expired_upload_data()` covers inactive owners and all temporary tables.
  Its optional cutoff allows a trusted scheduler to sweep **ahead** of deadlines with operating margin.
  Schedule/monitor it independently of login, monitor lag, and meet each physical deletion deadline.
  RLS expiry alone does not delete stored data. Hosting/scheduler availability is a release gate in #10.
- Do not log identifiers, credentials, OAuth query strings, watch/session URLs, QR payloads or provider
  responses. Apply ADR 002's log limits to all copies; the SQL schema does not configure platform logs.

## Backup and restore runbook

Production backup configuration and a verified restore drill are required in #10. A seven-day
snapshot window, key rotation, encrypted backups or restore-time tombstones alone do **not** erase
copies by each record's original deadline. Do not enable uploads on a backup configuration that
cannot prove this contract.

1. Exclude the temporary public tables (`upload_workflows`, `upload_jobs`, `youtube_connections`) and
   private capability/state tables from logical data backups and every replica/archive/export path.
   Exclude all historical spike tables as well; their provider data is not production app data.
   A full managed snapshot/PITR covering these tables requires verified timely erasure/expiry for
   every included copy, or a separate deployment/storage design meeting the same contract. A logical
   dump exclusion does not exclude those tables from WAL or managed snapshots.
2. Back up durable app data, provider-free idempotency reservations and deletion ledger securely.
   They still contain user data and must meet account/user deletion deadlines across recovery copies.
   Retain deletion entries until all older recoverable copies are retired; tombstones only prevent
   resurrection and do not satisfy physical erasure. Never use temporary records as a backup archive.
3. Restore into isolated quarantine with the Data API, workers, scheduled provider calls and outbound
   uploads disabled. Load the current deletion ledger from outside the restored snapshot first;
   remove matching accounts/resources and any cascade children. Restore original IDs/timestamps,
   never regenerate deadlines. Remove every expired/deleted workflow before
   opening access. Backups following the exclusion rule restore no provider workflow/capability rows.
4. Verify counts, foreign keys, RLS/grants and this test suite using synthetic identities. Verify all
   original deadlines and deletion requests against every live/recovery copy, then enable app access.
   Never replay upload initiation from restored jobs. Recover Supabase Auth identities/configuration
   and permitted encryption keys through separate restricted procedures; do not put them in repo files.
5. Record the restore drill, deletion/expiry evidence, backup exclusions, copy retirement and scheduler
   failure alert evidence privately. Until verified, report the operational gate as open.

## Validation

From `mvp/`, with the disposable local Docker stack running:

```sh
npm run reset
npm run test:db
npm run types:db
npm run types:db:check
npm run serve
# Another terminal:
npm run test:local
npm run style:check
npm run check
npm test
npm run build
```

The transactional SQL suite tests RLS/grants, parent ownership, immutable deadlines/confirmation,
verification eligibility, OAuth one-use, terminal-session removal, expiry before/after sweep,
idempotency after cleanup, deletion isolation and restoration tombstones. The two-user integration
uses real local Auth JWTs and direct Data API requests, including forbidden column updates, forged
RPC arguments, non-exposed schema access and service-only RPC bypass attempts. Tests use synthetic
metadata/envelopes, no real provider requests, credentials or media; temporary users are deleted.

References: [ADR 002](../docs/ADR-002-direct-youtube-qr.md),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[column privileges](https://supabase.com/docs/guides/database/postgres/column-level-security),
[function security](https://supabase.com/docs/guides/database/functions).
