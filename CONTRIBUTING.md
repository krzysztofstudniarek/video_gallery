# Contributing

The free MVP uses the Supabase workspace in `mvp/`; the 2017 application remains as reference.

1. Choose an open issue in the Free MVP milestone and read its prerequisites.
2. Use a focused branch and pull request linked to the issue.
3. Keep legacy files intact unless the issue explicitly requires a change.
4. Use Supabase SQL migrations/RLS and TypeScript/Deno Edge Functions for the new backend. Use managed Supabase Auth; do not introduce custom session tables or a separate Python service. Preserve legacy/local spike work.
5. Add checks for meaningful behaviour, especially direct-API RLS isolation, Edge Function authorization, Auth, URL validation, direct YouTube QR payloads and temporary data expiry. Read [ADR 002](docs/ADR-002-direct-youtube-qr.md) before implementing older issue descriptions about app sharing/redirects.
6. Never commit credentials, cookies, OAuth codes, private video links, personal media or local databases.
7. Record implementation commands in the README when the new workspace exists.

See [mvp/README.md](mvp/README.md) for formatting, lint, type, test, build and local database commands. Run the PR workflow's checks before review. After schema changes, reset the local database, run SQL/RLS tests and regenerate the checked-in database types. Documentation-only changes should be checked for consistent links and scope; they do not require running the legacy service.

Public issues should contain sanitised information. Suspected security vulnerabilities should be reported using GitHub private vulnerability reporting if enabled; otherwise request a private reporting channel without posting exploit details or sensitive data publicly.

## Pull requests

Describe the problem, resulting behaviour, linked issue and validation. Do not include production deployment, paid provisioning, external invitations or unrelated features in an implementation PR without the relevant task authorization.

## Formatting and lint

Use the pinned Deno formatter and linter for the active `mvp/` workspace. `mvp/deno.json` defines
two-space indentation, double quotes, semicolons, a 100-character line width and wrapped prose.
`.editorconfig` supplies matching editor defaults for MVP files. These rules leave legacy Python
and the preserved spike outside the formatting scope.

After `npm --prefix mvp ci`, run `npm --prefix mvp run hooks:install` once per clone to enable the
tracked pre-commit hook. This sets the clone's `core.hooksPath` to `.githooks`; if you already use a
custom hook directory, integrate this check there instead. The hook checks the staged workspace
snapshot, so partially staged files are checked exactly as they will be committed. It never formats
or stages files automatically.

Run `npm --prefix mvp run fmt` to apply formatting, `npm --prefix mvp run lint:fix` for available
safe lint fixes, and `npm --prefix mvp run style:check` to verify both. Stage the resulting changes
before committing. CI enforces the same rules for every PR even when local hooks are not installed.
Lint uses Deno's recommended and React rules, strict equality and Error objects for thrown values.
Generated database types are formatted but excluded from lint. `require-await` is disabled because
the synthetic tests and provider adapters deliberately implement async interfaces without awaiting.
