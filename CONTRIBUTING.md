# Contributing to AlgoForge

Thanks for helping! This guide covers setup, conventions and the review checklist.

## Setup

```bash
git clone https://github.com/<you>/AlgoForge.git && cd AlgoForge
node scripts/serve.mjs 8080      # open http://localhost:8080/
npm test                         # unit, property and differential tests
npm run check                    # syntax, structure, imports, cycles, security, docs
```

No build step and no runtime dependencies. Development tooling (for example Playwright for
end-to-end tests) must never become a runtime requirement.

## Ground rules

- **Correctness first.** New algorithms need unit tests for the edge cases listed in
  [docs/testing.md](docs/testing.md), plus property-based and (where possible) differential tests.
- **No fake functionality.** Every visible control must work; unfinished features are marked
  experimental or kept out of releases.
- **No fabricated metrics.** Displayed numbers must come from real measurements or counters.
- **Determinism.** Use canonical order for tie-breaking and `SeededRandom` for randomness — never
  `Math.random()` in algorithms or generators.
- **Separation of concerns.** Algorithms do not touch the DOM; UI code does not implement
  algorithms; application state does not hold DOM nodes.
- **Security.** Never use `innerHTML`, `eval`, `new Function` or string timers; render text with
  `textContent` (see `js/ui/dom.js`). Validate everything that comes from files.
- **Accessibility.** Keyboard operable, visible focus, labelled controls, not colour-only.

## Code style

- ES2022 modules, 2-space indentation, single quotes, semicolons.
- Document public module interfaces with a header comment and JSDoc where helpful.
- Prefer pure functions in `core/`, `algorithms/`, `structures/` and `experiments/`.

## Pull requests

1. Open an issue first for larger changes.
2. Keep PRs focused; update docs and `CHANGELOG.md` (Unreleased section).
3. Make sure `npm test` and `npm run check` pass; run the end-to-end suite for UI changes.
4. Fill in the pull-request template.

Adding an algorithm? Follow [docs/contributing-algorithms.md](docs/contributing-algorithms.md).

## Issue labels

`bug`, `enhancement`, `documentation`, `good first issue`, `help wanted`, `algorithm`,
`performance`, `accessibility`, `testing` (defined in `.github/labels.yml`).
