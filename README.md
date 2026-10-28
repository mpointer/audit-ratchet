# audit-ratchet

A coverage ratchet for mutation handlers. Every exported handler under a
directory must reach an audit sink with a namespaced action, or carry a
justified exemption, or be in a committed baseline of known debt. And the
baseline may shrink but never grow.

Extracted from a production Next.js application where it has been a
required CI check on `main` since September 2026, after an incident in
which three admin routes wrote audit rows under a bare action name that
the audit log filtered out, so API-key creation and deletion were
unreviewable for every actor and unrecorded for some. The rule existed
before the check did; it bound only whoever opened the file. A rule that
is not enforced is not a rule.

## The invariant

An exported handler passes when both hold:

1. It reaches a sink, following same-file helper calls: a call to a name
   in `sinks`, a call to a name imported from a module in `sinkModules`,
   or `x.insert(<table>)` for a table in `tableInserts`.
2. Either the sink namespaces the action itself (a name in
   `namespacingSinks`, or any `sinkModules` export not listed in
   `callerSuppliedAction`), or an action string opening with one of
   `actionPrefixes` is reachable from the handler, as a literal or as a
   template opening with a name in `prefixConstants`.

Condition 2 is what rejects the original defect: a bare
`logAudit({ action: 'ADMIN_ACTION' })` reaches a sink and contributes no
namespaced action, so it fails.

A block comment (`/* ... */`, not `//`) containing the `allowMarker`,
inside the handler or in its leading comment, exempts it. The comment
must also carry a sentence of prose or the exemption fails: the marker is
not the justification. Exemptions are counted in the summary line,
because an exemption nobody can count is one nobody reviews.

## Why two halves

`check` compares the working tree against the committed baseline. On its
own that is defeatable in one command: add an unaudited handler,
regenerate the baseline, green. Nothing in a single working tree can
tell new debt from old.

`growth --base <ref>` reads the baseline from the PR's base ref and
fails on any key the branch added. Shrinking is always fine. That is the
half that makes "the list only shrinks" true rather than aspirational.

Improvements warn rather than fail: a baselined handler that now audits,
or one whose route was renamed away, prints a notice asking you to
tighten. Failing a PR for improving coverage teaches contributors that
regenerating the baseline is the normal response to this check, and that
reflex is what defeats a ratchet.

## Install

```
npm install --save-dev audit-ratchet typescript
npx audit-ratchet init          # writes audit-ratchet.json
npx audit-ratchet baseline      # writes the baseline from the current tree
git add audit-ratchet.json audit-ratchet-baseline.json
```

`typescript` is a peer dependency: the analysis is an AST walk, not a
regex.

## Configure

`audit-ratchet.json`, every key optional. The defaults are the shape it
was extracted from.

| Key | Default | Meaning |
|-----|---------|---------|
| `roots` | `["src/app/api/admin"]` | Directories scanned for handler modules |
| `fileName` | `"route.ts"` | Exact basename of handler modules |
| `filePattern` | `null` | Regex on the posix path relative to cwd, instead of or as well as `fileName` |
| `handlers` | `["POST","PUT","PATCH","DELETE"]` | Exported names treated as handlers (function, const, or `export { x as POST }`) |
| `sinks` | `["logAdminAction","logAudit","writeAudit"]` | Functions that write an audit row, matched by name |
| `sinkModules` | `["@/lib/audit"]` | Modules whose named exports count as sinks when called |
| `callerSuppliedAction` | `["logAudit","writeAudit"]` | Sinks that take a caller-supplied action and still need a prefix |
| `namespacingSinks` | `["logAdminAction"]` | Sinks that apply the namespace themselves |
| `tableInserts` | `["auditLog"]` | `x.insert(<table>)` counts as a sink |
| `actionPrefixes` | `["admin.","security."]` | Action prefixes that count as namespaced |
| `prefixConstants` | `["ADMIN_ACTION_PREFIX","SECURITY_ACTION_PREFIX"]` | Identifiers that, opening a template, count as a prefix |
| `allowMarker` | `"allow:audit-ratchet"` | Exemption marker |
| `minJustificationChars` | `24` | Prose required beside the marker |
| `baseline` | `"audit-ratchet-baseline.json"` | Committed baseline path |
| `label` | `"audit coverage"` | Name used in messages |
| `guidance` | `[]` | Project-specific lines printed under a failure |

Unknown keys are rejected, not ignored.

## CI

As a composite action, with the checkout fetched deep enough to read the
base ref:

```yaml
jobs:
  audit-coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - uses: mpointer/audit-ratchet@v0.2.0
```

Or as two commands:

```yaml
      - run: npx audit-ratchet check
      - run: npx audit-ratchet growth --base "origin/${{ github.base_ref }}"
        if: github.event_name == 'pull_request'
```

Make the job a required status check on the branch you promote to, and
do not rename it afterwards: GitHub matches required checks by name.

Then put the config, the baseline and the workflow behind CODEOWNERS.
`growth` compares the baseline against the base ref's, but nothing stops
a PR from narrowing what is checked: dropping a name from `handlers`,
shrinking `roots`, or deleting the CI step. Those edits are policy
changes and need a reviewer who owns the policy:

```
# .github/CODEOWNERS
/audit-ratchet.json             @your-org/security
/audit-ratchet-baseline.json    @your-org/security
/.github/workflows/             @your-org/security
```

CODEOWNERS only blocks a merge when branch protection requires code
owner review.

## Exempt a handler

```ts
/* allow:audit-ratchet: clears a per-user render cache; nothing security-relevant is written. */
export const PUT = async () => new Response('ok');
```

Prefer an exemption to a baseline entry for anything new. An exemption
is visible where the code is; a baseline entry is not.

## What it does not do

It matches sink names by name, whatever module they came from, and any
reachable prefixed literal satisfies condition 2. Both trade precision
for quiet, on purpose: a false negative costs an unaudited route that
review can still catch, and a false positive costs a contributor an
afternoon arguing with CI, which is how a check gets deleted rather
than fixed.

It follows same-file helpers and `sinkModules` imports. A handler
wrapped by a higher-order function from another module
(`export const POST = withAuth(fn)`) is scanned through the call, so an
audit inside the wrapper's own module is invisible and the route needs
the exemption.

It cannot see through `export * from './impl'`. `check` warns about each
one, with a file and line annotation, rather than failing: the module may
export only reads. Export handlers by name and they are checked.

It is TypeScript and JavaScript only, and it answers one question:
does this handler leave a namespaced audit row. It is not a linter.

## Programmatic use

```js
import { loadConfig, collectHandlers, compareToBaseline } from 'audit-ratchet';
const cfg = loadConfig();
const handlers = collectHandlers(cfg);
const r = compareToBaseline(handlers, baselineKeys);
```

`analyzeSource(file, text, cfg)` is exported too, so a project can pin
the edges on snippets rather than on whatever happens to be in its tree.

## License

MIT.
