# Changelog

## [0.3.0] - 2026-10-28

### Security
- Output could carry workflow commands from the change under review. A line
  break in a baseline key, a module specifier, or a git or config error
  started a new output line, and GitHub Actions runs any line beginning with
  `::` as a command: fake annotations, or `::stop-commands::` to hide the
  real error annotations (the job still fails on the exit code). Every write
  is now a single line, with breaks encoded as `%0D`/`%0A`. Present since
  0.1.0.
- The justification check stripped comment delimiters with `/\*+\/$/`, which
  is quadratic on a long run of `*`: one crafted exemption comment could
  stall a CI run for minutes. Now linear. Present since 0.1.0. Found by
  CodeQL.

### Changed
- Handler modules default to `filePattern: "(^|/)route\\.[jt]sx?$"` instead
  of `fileName: "route.ts"`, so `route.js`, `route.tsx` and `route.jsx` are
  checked too. **Upgrading can surface handlers that were never checked.** A
  config that sets `fileName` keeps exactly that file; configs written by
  `init` do.

### Added
- `check` warns, with a file and line annotation, on `export * from` in a
  handler module: handlers re-exported that way are not checked.
- `check` warns when a baselined handler now carries a justified exemption,
  so the baseline entry can go.
- `growth`, when it fails, names removed entries for the same method, which
  is what a moved route looks like.

### Internal
- CI, the release workflow and the README example use `actions/checkout@v7`
  and `actions/setup-node@v7`.
- `ci.yml` declares `permissions: contents: read`.

## [0.2.0] - 2026-10-28

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
