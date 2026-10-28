import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BIN = resolve('bin/audit-ratchet.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ratchet-'));
  mkdirSync(join(dir, 'src/app/api/admin/a'), { recursive: true });
  mkdirSync(join(dir, 'src/app/api/admin/b'), { recursive: true });
  writeFileSync(join(dir, 'src/app/api/admin/a/route.ts'),
    `import { logAdminAction } from '@/lib/audit';\nexport async function POST() { await logAdminAction({ action: 'a.b' }); }\n`);
  writeFileSync(join(dir, 'src/app/api/admin/b/route.ts'), `export async function DELETE() { return ok(); }\n`);
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'root');
  return { dir, git };
}

test('init, baseline, check, growth: the whole loop', () => {
  const { dir, git } = repo();
  assert.equal(run(dir, 'init').status, 0);
  const cfg = JSON.parse(readFileSync(join(dir, 'audit-ratchet.json'), 'utf8'));
  assert.equal(cfg.allowMarker, 'allow:audit-ratchet');

  const b = run(dir, 'baseline');
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /1 unaudited, 1 audited, 0 exempt, of 2 handlers/);
  const baseline = JSON.parse(readFileSync(join(dir, 'audit-ratchet-baseline.json'), 'utf8'));
  assert.deepEqual(baseline.unaudited, ['src/app/api/admin/b/route.ts::DELETE']);

  const c = run(dir, 'check');
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /1\/2 handlers audited, 0 exempt, 1 baselined/);

  // Growth: baseline does not exist on the base ref yet -> introducing it is OK.
  const g0 = run(dir, 'growth', '--base', 'main');
  assert.equal(g0.status, 0, g0.stderr);
  assert.match(g0.stdout, /introduces it/);

  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'baseline');

  // A new unaudited handler fails check.
  mkdirSync(join(dir, 'src/app/api/admin/c'));
  writeFileSync(join(dir, 'src/app/api/admin/c/route.ts'), `export const PUT = async () => {};\n`);
  const c2 = run(dir, 'check');
  assert.equal(c2.status, 1);
  assert.match(c2.stderr, /::error::1 handler\(s\) write no admin\.\/security\.-namespaced audit row/);
  assert.match(c2.stderr, /src\/app\/api\/admin\/c\/route\.ts:1  PUT\(\)/);

  // Regenerating turns check green, and growth catches the laundering.
  assert.equal(run(dir, 'baseline').status, 0);
  assert.equal(run(dir, 'check').status, 0);
  const g1 = run(dir, 'growth', '--base', 'main');
  assert.equal(g1.status, 1);
  assert.match(g1.stderr, /ADDS 1 handler\(s\)/);
  assert.match(g1.stderr, /src\/app\/api\/admin\/c\/route\.ts::PUT/);

  // A justified exemption instead: check green, baseline shrinks, growth fine.
  writeFileSync(join(dir, 'src/app/api/admin/c/route.ts'),
    `/* allow:audit-ratchet: clears a per-user cache; nothing security-relevant is written. */\nexport const PUT = async () => {};\n`);
  const cx = run(dir, 'check');
  assert.equal(cx.status, 0, cx.stderr);
  assert.match(cx.stderr, /::warning::src\/app\/api\/admin\/c\/route\.ts::PUT is now exempt/);
  assert.equal(run(dir, 'baseline').status, 0);
  const c3 = run(dir, 'check');
  assert.equal(c3.status, 0, c3.stderr);
  assert.match(c3.stdout, /1 exempt/);
  const g2 = run(dir, 'growth', '--base', 'main');
  assert.equal(g2.status, 0, g2.stderr);

  // Fixing the baselined handler warns and asks to tighten.
  writeFileSync(join(dir, 'src/app/api/admin/b/route.ts'),
    `import { logAdminAction } from '@/lib/audit';\nexport async function DELETE() { await logAdminAction({ action: 'b.d' }); }\n`);
  const c4 = run(dir, 'check');
  assert.equal(c4.status, 0, c4.stderr);
  assert.match(c4.stderr, /::warning::src\/app\/api\/admin\/b\/route\.ts::DELETE now writes an audit row/);
});

test('export * in a handler module warns with a file annotation', () => {
  const { dir } = repo();
  writeFileSync(join(dir, 'src/app/api/admin/b/route.ts'), `export * from './impl';\n`);
  assert.equal(run(dir, 'baseline').status, 0);
  const c = run(dir, 'check');
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stderr, /::warning file=src\/app\/api\/admin\/b\/route\.ts,line=1::.*re-exports everything from '\.\/impl'/);
});

test('values from the tree or the baseline cannot start a workflow command', () => {
  const { dir } = repo();
  writeFileSync(join(dir, 'src/app/api/admin/b/route.ts'), `export * from './x\\n::error::injected-from-specifier';\n`);
  writeFileSync(join(dir, 'audit-ratchet-baseline.json'),
    JSON.stringify({ unaudited: ['gone::PUT\n::error::injected-from-baseline'] }));
  const c = run(dir, 'check');
  const lines = c.stderr.split('\n');
  assert.ok(!lines.some((l) => l.startsWith('::error::injected')), c.stderr);
  assert.match(c.stderr, /'\.\/x%0A::error::injected-from-specifier'/);
  assert.match(c.stderr, /::warning::gone::PUT%0A::error::injected-from-baseline no longer exists/);
});

test('unjustified marker fails check', () => {
  const { dir } = repo();
  writeFileSync(join(dir, 'src/app/api/admin/b/route.ts'), `/* allow:audit-ratchet */\nexport async function DELETE() {}\n`);
  assert.equal(run(dir, 'baseline').status, 0);
  const c = run(dir, 'check');
  assert.equal(c.status, 1);
  assert.match(c.stderr, /carry no justification/);
});

test('missing baseline, bad config, bad ref each fail with a named error', () => {
  const { dir } = repo();
  const c = run(dir, 'check');
  assert.equal(c.status, 1);
  assert.match(c.stderr, /Cannot read audit-ratchet-baseline\.json/);
  writeFileSync(join(dir, 'audit-ratchet.json'), '{"sinkz": []}');
  const c2 = run(dir, 'check');
  assert.equal(c2.status, 1);
  assert.match(c2.stderr, /unknown config key "sinkz"/);
  writeFileSync(join(dir, 'audit-ratchet.json'), '{}');
  assert.equal(run(dir, 'baseline').status, 0);
  const g = run(dir, 'growth', '--base', 'nope');
  assert.equal(g.status, 1);
  assert.match(g.stderr, /could not read audit-ratchet\.json from nope/);
  assert.match(g.stderr, /fetch-depth: 0/);
  const g2 = run(dir, 'growth');
  assert.equal(g2.status, 1);
  assert.match(g2.stderr, /Usage/);
});

test('pointing the config at a new baseline path does not escape growth', () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, 'audit-ratchet.json'), '{}');
  assert.equal(run(dir, 'baseline').status, 0);
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'baseline');

  mkdirSync(join(dir, 'src/app/api/admin/c'));
  writeFileSync(join(dir, 'src/app/api/admin/c/route.ts'), `export const PUT = async () => {};\n`);
  writeFileSync(join(dir, 'audit-ratchet.json'), '{"baseline": "elsewhere.json"}');
  assert.equal(run(dir, 'baseline').status, 0);
  assert.equal(run(dir, 'check').status, 0);
  const g = run(dir, 'growth', '--base', 'main');
  assert.equal(g.status, 1, g.stdout);
  assert.match(g.stderr, /ADDS 1 handler\(s\) to elsewhere\.json/);
  assert.match(g.stderr, /src\/app\/api\/admin\/c\/route\.ts::PUT/);
});

test('help and unknown command', () => {
  assert.equal(run('.', '--help').status, 0);
  assert.equal(run('.', 'frobnicate').status, 2);
});
