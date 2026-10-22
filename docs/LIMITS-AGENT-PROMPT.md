# Prompt for a separate quota and limits planning agent

Copy the following prompt into a separate agent/chat:

```text
Help me agree practical quota and product limits for the free VideoAlbum MVP in
https://github.com/krzysztofstudniarek/video_gallery.

Read docs/MVP.md, docs/ADR-001-supabase.md, mvp/README.md and mvp/YOUTUBE.md, plus
issues #8, #10, #14, #15, #25 and #26. #1/#2 are complete. The stack is
React/TypeScript/Vite, Supabase Auth/Postgres/RLS and TypeScript Edge Functions.
Video bytes go directly from the user's device to their YouTube channel; the
service has no video storage/transcoding or paid user tiers.
Use the latest issue bodies and these owner decisions if the corresponding
documentation PR has not yet merged.

The pilot targets 5–10 people and at least three completed printed albums.
10 albums/account and 50 videos/album are proposals, not agreed limits. The
staging probe's 10 MiB file bound is not a product requirement. Uploads default
to Unlisted, with Private and Public available. Selecting Public requires an
explicit warning/confirmation; every request sends the selected visibility.
Processed videos with verified Public or Unlisted visibility may generate QR
codes/public app links (Public must be confirmed); Private videos may not.

Verify current official YouTube/Supabase documentation and distinguish published
default quotas from our actual project's allocations. Do not assume an old
per-upload quota cost or a universal private-only restriction for unverified
projects. Google OAuth verification, YouTube compliance audits and quota
extensions are separate concerns. If project-specific values are needed, ask
me for aggregate quota/usage figures or guide me to the relevant console page;
do not request credentials, tokens, private video URLs or unredacted exports.

Work with me to choose:
- Account/album video limits and per-account upload budgets per day.
- Project-wide upload budgets, fair-use allocation and reserved quota headroom.
- File size, duration, batch size and per-account/global concurrency.
- Retry/backoff, polling/reconciliation rates and abandoned-session expiry.
- Background metadata refresh/deletion budgets required by the #25 lifecycle.
- Supabase Auth/database/Edge resource budgets, log/backup retention and a
  non-pausing production hosting budget before printed links are relied on.

Separate product limits, provider/channel constraints, project-wide quotas and
cost guardrails. Show where each limit can be enforced: database, Edge Function,
browser guidance or trusted post-upload verification. In particular, do not
claim that client-supplied duration/size metadata is trusted server validation.
Explain that billing alerts are not hard spending caps.

Give me two or three practical options with calculations for normal pilot use,
an initial bulk upload and a busy day. Show polling/maintenance overhead, time
to upload an album, fairness between users, quota headroom and failure behavior.
Provide a table with each proposed limit, units/reset window, rationale,
enforcement point and remaining uncertainty. Cite dated official sources and
label any project settings we have not verified.

Discuss the tradeoffs with me before treating numbers as final. After I agree,
record the chosen values in the relevant issues and documentation and prepare
a focused PR for configuration/implementation changes as appropriate. Do not
change live quotas, request extensions, purchase hosting, alter credentials,
deploy production or perform real uploads without my explicit instructions.
```
