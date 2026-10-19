# Changelog

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
