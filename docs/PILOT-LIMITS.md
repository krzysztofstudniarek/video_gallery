# Balanced pilot limits

Status: **option B selected by the owner on 22 October 2026**. The pilot targets 5–10 people,
usually uploading 1–3 minute clips of 100–300 MiB, and at least three completed printed albums.
The user-facing MVP is free. These are app limits, separate from provider quotas and channel
eligibility. No live settings, uploads, purchases or deployments are authorized by this decision.

[mvp/pilot-limits.json](../mvp/pilot-limits.json) is the machine-readable contract for the selected
profile. It is not wired into the staging probe and does not establish production enforcement.
#3/#8/#14/#15 implement the trusted database/Edge admission paths and explain the limits in the UI.

## Agreed profile

Count live/draft video entries and outstanding capacity reservations against both album and account
caps. Release capacity when an entry/reservation is safely removed; never refund spent API quota.

| Limit | Units/window | Rationale | Enforcement to implement | Remaining uncertainty |
| --- | --- | --- | --- | --- |
| 5 albums/account | Current albums | Several usable albums | DB transaction with owner locking; RLS | Production schema pending #3 |
| 50 videos/album | Current entries + reservations | Useful printed collection | Atomic DB capacity reservation | Pending implementation |
| 200 videos/account | Across all albums | Bound maintenance independently of album count | Same DB transaction | Five full albums exceed this cap |
| 20 upload initiation attempts/account | Pacific calendar day | One user cannot consume the project day | DB reservation before authenticated Edge dispatch | Channel may impose a lower allowance |
| 60 upload initiation attempts/project | Pacific calendar day | Leaves 40 calls at verified staging allocation of 100 | Atomic shared ledger; account and project check together | Production allocations/shared consumers unverified |
| At least 20% provider headroom | Actual verified allocation/day | Prevent using the full provider allocation when lower than expected | Clamp admission to available safe capacity | No production allocation may be assumed from defaults |
| 1 GiB/file (1,073,741,824 bytes) | Per upload | Covers short clips and recovery needs | Browser preflight; trusted provider file size before app acceptance | Client size is untrusted; provider fileDetails may be unavailable |
| 10 minutes (600 seconds) | Per upload | Allows longer clips within ordinary 15-minute channel duration | Browser guidance; trusted provider duration before app acceptance | Cannot guarantee rejection before direct transfer |
| 10 files/selected batch | Per selection | Manageable recovery and memory | Browser; server caps still apply to each reservation | Mobile/browser behavior needs testing |
| 1 active transfer/account | Active admission | Fair queue | DB lease and cooperative browser transport | An issued Google capability can outlive cancellation |
| 3 active transfer admissions/project | Active admission | Useful parallelism for independent connections | Shared DB leases; start only when a slot is available | Admission cap is not a hard remote-transfer count |
| Round-robin among waiting accounts | One account/job per turn | Fairness without unused protected shares | Trusted queue claim ordered by account turn | Late arrivals can wait until reset |

Use `America/Los_Angeles` for midnight reset, including DST. Show the user's local retry time.
Count every dispatched initiation attempt, including failures and ambiguous responses. Refund only
a reservation demonstrably rejected before dispatch. Idempotent requests return the existing job.
Resume/status checks never blindly initiate a replacement. A replacement is a new charged attempt.

For verified upload allocation U and upload calls already used by all consumers V, keep the 20%
provider reserve: effective total-day ceiling = min(60, floor(0.8 × U)); remaining starts cannot
exceed max(0, ceiling − V − unreported app reservations). Do not subtract a reservation twice once
its call is included in provider usage. Also apply the app's 60/day and per-account 20/day ledgers.
Production values must be checked before enabling admission; an unknown allocation is not 100.
Provider metrics can lag, so coordinate other consumers and conservatively retain ambiguous calls.

Unlisted remains the initial choice; Private and explicitly confirmed Public are available. Every
initiation sends the selected privacy. QR/public links require trusted successful processing,
channel/job association and effective Public/Unlisted visibility; Public confirmation is per upload.
Private can finish without QR eligibility. Over-limit or unverifiable media cannot be marked ready
from client declarations. A file may already exist in YouTube when rejected by the app; never
implicitly delete it or change its visibility. No video bytes pass through Supabase.

## Verified evidence and provider boundaries

The owner's screenshot on **2026-10-22** shows **VideoAlbum staging**, YouTube Data API v3:

| Metric | Allocation | Usage at capture |
| --- | ---: | ---: |
| General queries/day | 10,000 | 1 |
| Video uploads/day | 100 | 0 |
| Video uploads/minute | 100 | 0 |
| General queries/minute | 1,800,000 | 0 |
| General queries/minute/user | 180,000 | Not shown |
| Search queries/day; minute | 100; 100 | 0; 0 |
| Video Batch Get Stats/day; minute | 10,000; 600 | 0; 0 |

These are staging observations, not production settings or perpetual available quota. Production
Google project, shared consumers, Supabase organization/plan/usage, host/domain, rate limits and
spend-cap configuration remain unverified. Existing staging Unlisted success does not establish
production Public readiness. Native channel limits cover Studio/mobile/API usage and may be lower.

Official sources checked **2026-10-22**:

- [Quota calculator](https://developers.google.com/youtube/data/determine_quota_cost): default
  upload/search buckets are each 100 calls/day at one unit/call in their own bucket; other methods
  share 10,000 general daily units. `videos.list`/`channels.list` cost one general unit. Invalid calls
  also consume quota. [Revision history, 1 June 2026](https://developers.google.com/youtube/data/revision_history)
  documents the granular buckets. Older upload-unit calculations do not apply.
- [videos.insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert)
  documents the current upload bucket and 256 GB maximum. It does not state a universal unverified-
  project private-only rule; actual project eligibility and effective visibility need validation.
- [OAuth review and exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification),
  [OAuth expiry](https://developers.google.com/identity/protocols/oauth2/#expiration) and
  [YouTube compliance audits/quota extensions](https://developers.google.com/youtube/data/guides/quota_and_compliance_audits)
  are separate checks in #14. External Testing grants with YouTube scopes can expire after seven
  days; personally known pilot users alone do not prove an applicable verification exception.
- [Channel duration constraints](https://support.google.com/youtube/answer/71673?hl=en) and
  [channel upload limits](https://support.google.com/youtube/answer/10383400?hl=en): ordinary duration
  up to 15 minutes, longer with account verification; maximum 256 GB or 12 hours, whichever is less;
  variable channel upload restrictions over 24 hours. An app allowance does not override these.
- [Video resource](https://developers.google.com/youtube/data/reference/rest/v3/videos): trusted
  duration, processing/privacy and owner-only fileDetails, when available. Client size, duration,
  MIME and hashes are preflight hints, not trusted server media validation.

## Operating baseline for implementation review

The profile above is agreed. The following common operating defaults were discussed as proposals;
resolve and implement them in the owning issues. **The separately raised 24/48-hour link freshness
policy and monthly hosting envelope remain open.** Do not silently treat either as owner-approved.
The JSON contract deliberately contains only the selected profile.

| Proposed setting | Units/window | Rationale | Enforcement point | Open point/owner |
| --- | --- | --- | --- | --- |
| 1 start/account/minute; 5/project/minute | Rolling minute | Prevent bursts | DB/Edge token bucket | #15 implementation |
| General ceiling 8,000, including 200 reserved maintenance | Units/PT day, assuming actual 10,000 | At least 20% general headroom | Trusted request ledger, conservative reservations, aggregate metrics | #14/#15 production allocation/transport accounting |
| Fixed 16 MiB chunks; 1 outstanding PUT/transfer | Per transfer sequence, final chunk excepted | Bound retry loss and memory | Browser transport | #15 browser tests; chunks are multiples of 256 KiB |
| 5 retries/operation; 10 automatic retransmissions/file | Operation/file | Bound failure loops | Browser/Edge, durable counters where applicable | #15 errors must not reset daily budgets |
| Backoff 1/2/4/8/16 seconds with full jitter; honor longer Retry-After | Retry delay | Spread transient failures | Browser/Edge next_attempt_at | #15 provider error classification |
| Processing checks at 0/15/30/60/120/240/480/900/1800/3600 seconds, then 2/4/8/12/24 hours | 15 automatic/job | Bound reconciliation | DB due-times, claimed Edge batches | #15 delayed state, ≤2 manual checks/job/PT day afterward |
| ≤6 resumable inspections/job/day, ≤2/error episode, ≥1 minute apart | PT day | Recover existing sessions | DB/Edge | #15 status PUT accounting unverified |
| Status read every ≥15 seconds/account, only visible | Foreground session | Responsive UI without provider polling storms | Coalesced browser reads of DB status | #15 multiple tabs |
| 5-minute transfer admission lease, heartbeat every 60 seconds | Server clock | Recover abandoned slots | DB/Edge | #15 cannot revoke remote capability by expiring lease |
| Expire after 24 hours idle, absolute 48 hours; remove terminal session URLs promptly | Since server creation/activity | Minimize capability retention | Private DB cleanup, final bounded reconciliation | #25/#15 finite provider lifetime may be shorter; ambiguous jobs never auto-reupload |
| OAuth state 10 minutes, single use | Since creation | Established security pattern | DB atomic consumption and cleanup | #14 production callback implementation |
| Scheduler ≤1 tick/minute, ≤50 jobs/batch, one worker lease | Run | Avoid sleeping/per-job functions | DB due-job claims, scheduled Edge | #10/#15 scheduling proof |
| Privacy/availability refresh daily for all accounts, including inactive | Per stored item | Catch provider changes | Owner-authorized list batches | #25 failed refresh/revocation contract |
| Printing verification ≤24 hours old; public links fail closed after 48 hours stale | Freshness age | Bound stale-public-state exposure | Trusted resolver timestamps; no YouTube call per scan | **Owner decision still open** in #25; known Private/deletion/revocation disables on detection |
| Refresh applicable API data by day 25; purge by day 30 if unsuccessful | Since last successful refresh | Deadline margin | DB timestamps/hourly cleanup | #25 field-level classification, IDs/destinations |
| Immediate link disable on deletion/disconnect; online purge target ≤24 hours; ≤500 rows/hourly run | Request/detection/run | Small bounded cleanup | Owner-verified privileged Edge + DB | #8/#25 backup deadlines and external revocation detection |
| Album title 120 chars; caption 500 chars; YouTube title 100 chars, description 5,000 UTF-8 bytes | Per field | Print usability and full native field capacity | DB app fields/Edge provider validation | #8/#15 correlation must not silently reduce native limits |
| Metadata JSON ≤64 KiB, no media/unknown fields | Actual streamed bytes/request | Bound parsing and allow escaping | Edge body guard | #15; current 8 KiB probe bound remains historical |
| Provider timeout 10 seconds; worker target ≤20 seconds; CPU target <0.5 seconds | Operational target/request | Fast requeue | Edge timeout/metrics | #10 hosted CPU/runtime unmeasured |
| App data <100 MiB; warn logical DB at 250 MiB, review 500 MiB; pages ≤50, query target ≤3 seconds | Operational target | Catch growth/scans early | DB indexes/bounds/metrics | #3/#10 actual baseline, bloat and role settings |
| Edge <100k invocations/month, alerts 50k/80k; egress <1 GB/month, alert 0.5 GB | Operational target/billing month | Detect excess use | Provider metrics/upstream admission controls | #10 rejected requests may still be billable |
| Ten admitted pilot users plus operators; alert at 25 MAU; retain native Auth limits initially | Operational target/billing month | Bound roster | Auth allowlist/hook, SDK refresh coalescing, metrics | #4/#10 actual Auth settings/organization usage |
| Resolver 60 requests/minute/IP, 30/token/minute | Rolling minute | Bound abuse | Upstream host plus narrow Edge resolver | #26/#6 host proof/shared networks |
| Redacted logs 7 days; nonidentifying counters 30 days | Retention | Short diagnostics | Platform/log schema/TTL | #10/#25 host access logs can contain token paths/callback queries |
| Managed backups 7 days; independent encrypted daily copies ≤72 hours | Retention | Recovery without indefinite copies | Provider/independent backup lifecycle | #25/#10 deletion semantics must be verified, not assumed compliant |
| Restore before printed reliance, then quarterly; RPO 24 hours, RTO target 4 hours | Operational target | Test recovery | Quarantined restore/runbook | #10 Auth/config/secrets/key recovery separate |

Transient 5xx/transport failures back off; quota exhaustion stops starts, preserves state and shows
retry timing. Channel-limit errors pause that channel. Rejected refresh requires reconnect without
loops. Processing/visibility/media failure never triggers a duplicate upload or privacy fallback.
Client cancellation stops app requests but cannot promise deletion of already transferred media.
[Resumable protocol](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol),
updated 2026-10-15, describes status/offset recovery, backoff, Retry-After and finite sessions; it
does not promise 48-hour availability.

[Developer Policies](https://developers.google.com/youtube/terms/developer-policies), checked
2026-10-22, distinguish tokens, certain authorized statistics and other API data. Applicable caches
need refresh/deletion within 30 days; user/account deletion is as soon as possible and within seven
calendar days; external revocation has separate requirements including deletion within 30 days.
User-authored captions/order have a separate lifecycle. #25 must inventory fields and cover inactive
accounts, failed refresh and backups. Restore quarantine/tombstones do not erase retained snapshots.
Seven-day managed backups do not by themselves prove seven-day deletion-request compliance.

## Capacity and quota calculations

Assume ten users, average 250 MiB/video, otherwise unused provider day and no initiation failures.
Subtract actual existing usage/other consumers. Windows below mean quota windows, not fixed 24-hour
elapsed periods. Channel limits, browser availability, queue waits and processing can extend them.

| Scenario | Balanced result | Provider upload bucket at 100/day |
| --- | --- | --- |
| Normal: 10 people × 2 videos | All 20 fit | 20 spent, 80 unused including protected reserve |
| Initial bulk: 3 people × 30 videos | 60 first window (20 each), 30 next | At most 60/day; 40 reserved |
| Busy: 10 people × 10 requested videos | Approximately 6 each in a simultaneous queue; 40 wait | 60 spent; 40 reserved |

A 30-video album transfers 7,500 MiB in 52.4 minutes at effective 20 Mbps, or 3 hours 30 minutes at
5 Mbps; it needs two account quota windows. A 50-video album takes 87.4 minutes or 5 hours 50 minutes,
and three quota windows. Transfer time = bytes × 8 / upstream bits per second; concurrent uploads on
one connection share its bandwidth. Three bulk users with independent links can transfer 20 videos
each in about 35 minutes in the first window, then ten each in about 17.5 minutes in the next.

Full account capacity is 10 × 200 = 2,000 videos. Request batches of up to 50 known IDs per owner
(an app batch setting to validate, not maxResults for id queries): daily videos.list requests are
10 × ceil(200/50) = 40; ten channel checks make **50 general units/day**. The proposed 200-unit
maintenance reserve includes retries. OAuth refresh traffic is separately tracked outbound work.

Model ten processing checks/video, two inspections/video budgeted provisionally at one general
unit each, 20 channel checks/day and the full daily maintenance sweep:

- Normal 20-video day: 20 × (10+2) + 20 + 50 = **310 general units**.
- Busy admitted 60-video day: 60 × (10+2) + 20 + 50 = **790 general units**.
- Slow/failure envelope: 60 × (15+6) + 20 + 200 maintenance + 100 error margin = **1,580**.

These inspection allowances are estimates, not verified charging of resumable PUTs. Do not call
each chunk another videos.insert, or assert all transport is free. Validate bucket deltas from
existing aggregate metrics or a separately authorized future test; no upload is authorized here.
Sensitivity: 250 MiB/16 MiB = 16 chunk PUTs. At a hypothetical one general unit per PUT the busy
estimate is 790 + 60 × 16 = **1,750**. For 1 GiB files with 64 chunks, ten retried PUTs/file,
15 checks, six inspections and the allowances above: 60 × (64+10+15+6) + 320 = **6,020**, below
the proposed 8,000 ceiling. This is not a bound if actual transport accounting differs. Future
admission must account for existing jobs' next-day recovery work before accepting new jobs.

Metadata estimate: 2,000 × 8 KiB × 3 row/index overhead ≈47 MiB, before other tables/system/bloat.
At 2 KiB returned/video/day, full refresh traffic is about 120 MiB/month before headers/other work.
Even every-minute Edge scheduling is 43,200 calls/30-day month. Add 720 hourly maintenance runs,
6,000 upload coordination calls including margin and 3,000 scans: **52,920 invocations**, before
preflights/Auth/failures. Provider calls batched inside one worker are not separate Edge invocations;
foreground status reads should use the RLS Data API. Measure actual metering/CPU; these are estimates.

## Hosting, cost and outstanding release gates

Official Supabase sources checked **2026-10-22**:

- [Pricing](https://supabase.com/pricing): Free lists 50k MAU, 500 MB database, 5 GB egress and
  500k Edge invocations. Pro starts at US$25/month, includes one Micro via compute credits, 100k
  MAU, 8 GB disk/project, 250 GB egress and 2 million Edge invocations; additional Micro projects
  start around US$10/month. Check organization-wide usage and scope of each allowance.
- [Pausing](https://supabase.com/docs/guides/platform/free-project-pausing): Free can pause after
  low activity over seven days; paid projects do not pause for inactivity. Pro remains the required
  non-pausing production plan before printed-link reliance. No synthetic keep-alive substitute.
- [Edge limits](https://supabase.com/docs/guides/functions/limits): 256 MB memory, 2 seconds
  CPU/request, 150-second Free/400-second paid worker wall time, 150-second request idle timeout.
  [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits) are endpoint-specific; inspect
  actual settings rather than changing them speculatively. Built-in email quotas are not OAuth
  sign-in quotas.
- [Backups](https://supabase.com/docs/guides/platform/backups): Pro daily backups retained seven
  days; verify deletion/restore semantics in #25/#10 and test independent restoration.
- [Cost controls](https://supabase.com/docs/guides/platform/cost-control): the Spend Cap covers
  selected usage, excludes compute and various opted-in resources, and may restrict availability.
  [Alerts-only billing budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets) notify;
  **billing alerts are not hard spending caps**. App controls cannot undo billed requests.

Budget comparison remains open: one production Micro on Pro is about US$25/month plus eligible
static hosting, domain, tax and backup destination; always-on staging adds about US$10/month.
The discussed US$30–40 lean or US$40–50 always-on staging envelopes are estimates, not approved
spending or hard caps. Static host/domain selection remains #26; production activation is #10.
Do not provision resources, change quotas/credentials/DNS, submit extensions, deploy or upload
without the owner's explicit instructions.

Before launch, resolve production quotas/other consumers and applicable approvals (#14), direct
browser/trusted validation and atomic enforcement (#3/#8/#15), the lifecycle/freshness/backup
contract (#25), host/domain routing proof (#26), and actual non-pausing operating budget/restore
readiness (#10). This decision does not close those feature issues.
