# Changelog

## [Unreleased]

### Fixed
- An exemption could be forged: the marker was matched by a regex over the raw
  statement text that ran across `*/`, so a `//` marker followed by any block
  comment, or a marker inside a string literal, exempted the handler and passed
  the justification check. Exemptions are now read from real comment trivia.
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
  the tag.

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
