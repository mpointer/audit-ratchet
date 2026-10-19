import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSource, normalizeConfig, compareToBaseline, compareBaselines, hasJustification } from '../src/index.js';

const cfg = normalizeConfig({ allowMarker: 'allow:audit-ratchet', sinkModules: ['@/lib/audit', '@/lib/authz-audit'] });
const one = (text, c = cfg) => {
  const hs = analyzeSource('src/app/api/admin/x/route.ts', text, c);
  assert.equal(hs.length, 1, `expected one handler, got ${hs.length}`);
  return hs[0];
};

test('namespacing sink passes with no literal', () => {
  const h = one(`import { logAdminAction } from '@/lib/audit';
export async function POST(req: Request) { await logAdminAction({ action: 'thing.verb' }); return ok(); }`);
  assert.equal(h.audited, true);
  assert.equal(h.method, 'POST');
  assert.equal(h.line, 2);
});

test('generic sink with a bare action fails: the original defect', () => {
  const h = one(`import { logAudit } from '@/lib/audit';
export async function DELETE() { await logAudit({ action: 'ADMIN_ACTION' }); }`);
  assert.equal(h.audited, false);
  assert.match(h.reason, /not under the admin\.\/security\. namespace/);
});

test('generic sink with a prefixed literal passes', () => {
  const h = one(`import { logAudit } from '@/lib/audit';
export async function PUT() { await logAudit({ action: 'security.key.rotate' }); }`);
  assert.equal(h.audited, true);
});

test('template opening with a prefix constant passes', () => {
  const h = one(`import { writeAudit, ADMIN_ACTION_PREFIX } from '@/lib/audit';
export async function PATCH() { await writeAudit({ action: \`\${ADMIN_ACTION_PREFIX}api_key.used\` }); }`);
  assert.equal(h.audited, true);
});

test('template with a non-empty head does not count as a prefix', () => {
  const h = one(`import { writeAudit, ADMIN_ACTION_PREFIX } from '@/lib/audit';
export async function PATCH() { await writeAudit({ action: \`x\${ADMIN_ACTION_PREFIX}y\` }); }`);
  assert.equal(h.audited, false);
});

test('no sink at all fails with the right reason', () => {
  const h = one(`export async function POST() { return new Response('ok'); }`);
  assert.equal(h.audited, false);
  assert.equal(h.reason, 'no audit write reachable from this handler');
});

test('deliberate shape 1: module-local helper indirection resolves', () => {
  const h = one(`import { logAudit } from '@/lib/audit';
async function logWrite(a: string) { await logAudit({ action: 'admin.llm.config_write', a }); }
export async function PUT() { await logWrite('x'); }`);
  assert.equal(h.audited, true);
});

test('deliberate shape 2: direct awaited table insert with a literal passes', () => {
  const h = one(`import { db } from '@/db'; import { auditLog } from '@/db/schema';
export async function POST() { await db.insert(auditLog).values({ action: 'admin.demo.reset' }); }`);
  assert.equal(h.audited, true);
});

test('table insert into another table is not a sink', () => {
  const h = one(`import { db } from '@/db'; import { users } from '@/db/schema';
export async function POST() { await db.insert(users).values({ action: 'admin.x' }); }`);
  assert.equal(h.audited, false);
});

test('an export of a sink module namespaces unless caller-supplied, with alias', () => {
  const a = one(`import { recordAuthz as rec } from '@/lib/authz-audit';
export async function POST() { await rec('denied'); }`);
  assert.equal(a.audited, true, 'owns its prefix');
  const b = one(`import { logAudit as write } from '@/lib/audit';
export async function POST() { await write({ action: 'plain' }); }`);
  assert.equal(b.audited, false, 'aliased generic sink still needs a prefix');
});

test('a same-named import from a non-sink module does not count as a sink', () => {
  const h = one(`import { recordAuthz } from '@/lib/elsewhere';
export async function POST() { await recordAuthz('x'); }`);
  assert.equal(h.audited, false);
});

test('export const POST = arrow is a handler', () => {
  const h = one(`import { logAdminAction } from '@/lib/audit';
export const POST = async () => { await logAdminAction({ action: 'a.b' }); };`);
  assert.equal(h.audited, true);
});

test('export const POST = wrapper(fn) scans through the call', () => {
  const h = one(`import { logAdminAction } from '@/lib/audit';
export const POST = withAuth(async () => { await logAdminAction({ action: 'a.b' }); });`);
  assert.equal(h.audited, true);
});

test('function POST; export { POST } resolves; unresolved export is flagged, never skipped', () => {
  const a = one(`import { logAdminAction } from '@/lib/audit';
async function POST() { await logAdminAction({ action: 'a' }); }
export { POST };`);
  assert.equal(a.audited, true);
  const b = one(`import { handler } from './impl';
export { handler as DELETE };`);
  assert.equal(b.audited, false);
  assert.match(b.reason, /could not be resolved/);
});

test('non-handler exports and GET are ignored', () => {
  const hs = analyzeSource('f.ts', `export async function GET() {} export const config = {}; export function helper() {}`, cfg);
  assert.equal(hs.length, 0);
});

test('justified block-comment exemption is exempt and audited; counted, not dropped', () => {
  const h = one(`/* allow:audit-ratchet: this endpoint only clears a per-user cache, nothing security-relevant. */
export async function POST() {}`);
  assert.equal(h.exempt, true);
  assert.equal(h.audited, true);
  assert.equal(h.justified, true);
});

test('bare marker is an unjustified exemption', () => {
  const h = one(`/* allow:audit-ratchet */
export async function POST() {}`);
  assert.equal(h.exempt, true);
  assert.equal(h.justified, false);
});

test('a line comment marker does not exempt', () => {
  const h = one(`// allow:audit-ratchet because reasons that are long enough to pass
export async function POST() {}`);
  assert.equal(h.exempt, false);
  assert.equal(h.audited, false);
});

test('marker inside the handler body exempts', () => {
  const h = one(`export async function POST() {
  /* allow:audit-ratchet: toggles a UI preference that is not security-relevant. */
  return ok();
}`);
  assert.equal(h.exempt, true);
  assert.equal(h.justified, true);
});

test('hasJustification strips JSDoc asterisks and the marker', () => {
  assert.equal(hasJustification('/**\n * allow:audit-ratchet\n */', cfg), false);
  assert.equal(hasJustification('/**\n * allow:audit-ratchet\n * Read-only preview that writes nothing.\n */', cfg), true);
});

test('config: custom handlers, sinks, prefixes, and marker all apply', () => {
  const c = normalizeConfig({
    handlers: ['handler'], sinks: ['recordEvent'], namespacingSinks: [], tableInserts: [],
    sinkModules: [], actionPrefixes: ['ops.'], prefixConstants: ['OPS_PREFIX'], allowMarker: 'ratchet:skip',
  });
  const hs = analyzeSource('api/x.ts', `export const handler = async () => { await recordEvent({ kind: 'ops.rotate' }); };`, c);
  assert.equal(hs.length, 1);
  assert.equal(hs[0].audited, true);
  const ex = analyzeSource('api/y.ts', `/* ratchet:skip: this is a health probe and writes nothing. */ export const handler = async () => {};`, c);
  assert.equal(ex[0].exempt, true);
});

test('compareToBaseline: the four outcomes', () => {
  const hs = [
    { key: 'a::POST', audited: true, exempt: false },
    { key: 'b::POST', audited: false, exempt: false, file: 'b', line: 1, method: 'POST', reason: 'r' },
    { key: 'c::POST', audited: false, exempt: false },
    { key: 'd::POST', audited: true, exempt: true, justified: false },
    { key: 'e::POST', audited: true, exempt: true, justified: true },
  ];
  const r = compareToBaseline(hs, ['c::POST', 'a::POST', 'gone::PUT']);
  assert.deepEqual(r.newlyUnaudited.map((h) => h.key), ['b::POST']);
  assert.deepEqual(r.unjustifiedExemptions.map((h) => h.key), ['d::POST']);
  assert.deepEqual(r.nowFixed, ['a::POST']);
  assert.deepEqual(r.stale, ['gone::PUT']);
  assert.equal(r.auditedCount, 1);
  assert.equal(r.exemptCount, 2);
  assert.equal(r.total, 5);
});

test('compareBaselines: growth fails, shrink is fine', () => {
  assert.deepEqual(compareBaselines(['a', 'b'], ['a', 'b', 'c']), { added: ['c'], removed: [], headCount: 3 });
  assert.deepEqual(compareBaselines(['a', 'b'], ['a']), { added: [], removed: ['b'], headCount: 1 });
});
