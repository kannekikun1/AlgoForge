# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's
**Security → Report a vulnerability** (private advisory) on this repository. Include steps to
reproduce, affected browser(s) and, if possible, a minimal JSON file or graph that triggers the
issue. We aim to acknowledge reports within 7 days.

## Security model

AlgoForge is a static, client-side application with no backend, accounts or network requests.

- **No code execution from data.** Imported files are parsed with `JSON.parse`, validated
  against a versioned schema and resource limits, and copied into fresh objects containing only
  known fields. Nothing from a file is evaluated, and the codebase contains no `eval`,
  `new Function` or string-based timers (enforced by `npm run check`).
- **No HTML injection.** All user-controlled text (labels, names, imported strings) is rendered
  with `textContent`; `innerHTML`-style sinks are banned by the CI security lint.
- **Content Security Policy.** `index.html` ships a restrictive CSP: scripts, styles and workers
  only from the same origin, no inline scripts, no plugins, no form submissions.
- **Resource limits.** Graph sizes, coordinates, weights, file size and experiment sample counts
  are bounded; expensive work runs in Web Workers and can be cancelled.
- **Local data only.** Preferences live in LocalStorage and saved items in IndexedDB on the
  user's device. Data leaves the device only when the user explicitly exports it.

## Known limitations

- A meta-tag CSP cannot set `frame-ancestors`; deployers should add HTTP headers
  (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`) where the
  host allows.
- Web Workers are not a security boundary for untrusted code. AlgoForge therefore does not
  execute user-supplied JavaScript; custom algorithms are ordinary modules added to the source
  tree. Any future in-browser editor requires a separate threat model (see the SRS).
- Browser storage is not encrypted and can be cleared by the browser or the user.
