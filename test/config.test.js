import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, ConfigError, DEFAULTS } from '../src/index.js';

test('defaults are the extracted shape', () => {
  const c = normalizeConfig({});
  assert.deepEqual(c.handlers, ['POST', 'PUT', 'PATCH', 'DELETE']);
  assert.equal(c.fileName, null);
  const re = new RegExp(c.filePattern);
  for (const f of ['src/app/api/admin/x/route.ts', 'a/route.js', 'a/route.tsx', 'a/route.jsx']) assert.ok(re.test(f), f);
  for (const f of ['a/route.d.ts', 'a/subroute.ts', 'a/route.test.ts', 'a/route.ts.bak']) assert.ok(!re.test(f), f);
  assert.equal(c.allowMarker, 'allow:audit-ratchet');
});

test('an explicit fileName replaces the default pattern rather than adding to it', () => {
  assert.equal(normalizeConfig({ fileName: 'route.ts' }).filePattern, null);
  const both = normalizeConfig({ fileName: 'route.ts', filePattern: 'handler\\.ts$' });
  assert.equal(both.filePattern, 'handler\\.ts$');
});

test('unknown keys are rejected, not ignored', () => {
  assert.throws(() => normalizeConfig({ sink: ['x'] }), ConfigError);
});

test('type and shape errors are named', () => {
  assert.throws(() => normalizeConfig({ roots: 'src' }), /"roots" must be an array/);
  assert.throws(() => normalizeConfig({ roots: [] }), /at least one directory/);
  assert.throws(() => normalizeConfig({ sinks: [], sinkModules: [], tableInserts: [] }), /at least one of/);
  assert.throws(() => normalizeConfig({ filePattern: '(' }), /not a valid regex/);
  assert.throws(() => normalizeConfig({ fileName: null }), /set "fileName" or "filePattern"/);
  assert.throws(() => normalizeConfig({ allowMarker: ' ' }), /allowMarker/);
  assert.throws(() => normalizeConfig({ minJustificationChars: -1 }), /minJustificationChars/);
  assert.throws(() => normalizeConfig([]), /JSON object/);
});

test('DEFAULTS is frozen', () => {
  assert.throws(() => { DEFAULTS.roots = []; });
});
