# Contributing

The current work is planning a free MVP; the 2017 application remains as reference.

1. Choose an open issue in the Free MVP milestone and read its prerequisites.
2. Use a focused branch and pull request linked to the issue.
3. Keep legacy files intact unless the issue explicitly requires a change.
4. Keep the backend in modern Python; validate libraries against Python Workers rather than assuming Linux compatibility.
5. Add checks for meaningful behaviour, especially ownership, sessions, URL validation and stable QR links.
6. Never commit credentials, cookies, OAuth codes, private video links, personal media or local databases.
7. Record implementation commands in the README when the new workspace exists.

There is no new application test/build command yet. Issue #2 establishes lint, type, test and build commands and CI. Documentation-only changes should be checked for consistent links and scope; they do not require running the legacy service.

Public issues should contain sanitised information. Suspected security vulnerabilities should be reported using GitHub private vulnerability reporting if enabled; otherwise request a private reporting channel without posting exploit details or sensitive data publicly.

## Pull requests

Describe the problem, resulting behaviour, linked issue and validation. Do not include production deployment, paid provisioning, external invitations or unrelated features in an implementation PR without the relevant task authorization.
