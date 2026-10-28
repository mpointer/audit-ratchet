# Changelog

## [Unreleased]

### Changed
- Requires Node 22 or later (`engines`); Node 20 reached end of life in
  April 2026 and is no longer tested.
- CI and the README example use `actions/checkout@v5` and
  `actions/setup-node@v5`, which run on the Node 24 runtime.

## [0.1.1] - 2026-10-28

### Fixed
- An exemption could be forged: the marker was matched by a regex over the raw
  statement text that ran across `*/`, so a `//` marker followed by any block
  comment, a marker inside a string literal, or JSX text in a `.tsx` handler,
  exempted the handler and passed the justification check. Exemptions are now read from real comment trivia.
- `growth` read the base ref's baseline at the path named in the branch's
  config, so pointing `baseline` at a new file passed any growth. It now uses
  the path from the base ref's config.
- `export const { POST } = handlers` was silently skipped; it is now reported
  as an unresolved handler.
- `export const POST = impl` (a local function) now resolves through `impl`
  instead of failing as unaudited.
- The composite action passes its inputs through `env:` instead of
  interpolating them into the script.
- The release workflow fails if `action.yml`'s default version does not match
  the tag, runs lint, and publishes from Node 24 (npm 11), which trusted
  publishing requires.
- CI runs the self-check through the composite action as well as `bin/`.
- The composite action runs `npx` from its own prefix, so the caller's
  `package.json` cannot change which version runs.

### Docs
- README: put the config, baseline and workflows behind CODEOWNERS, since a PR
  can narrow what is checked without growing the baseline.

## [0.1.0] - 2026-10-19

First release. Extracted from a production Next.js application where it
has been a required CI check since 2026-09-10, with the project-specific
constants moved into a config file and a test suite added (the original
had none).

- `check`: every exported handler under the configured roots reaches a
  sink with a namespaced action, or carries a justified exemption, or is
  in the committed baseline. Fails otherwise.
- `growth --base <ref>`: the committed baseline may not grow relative to
  the base ref. The half that makes the ratchet real.
- `baseline`: regenerate the baseline (tighten).
- `init`: write a config template.
- Composite GitHub Action.
- Parity: against the application it came from, the package reproduces
  the committed baseline exactly (51 handlers, 24 baselined).
