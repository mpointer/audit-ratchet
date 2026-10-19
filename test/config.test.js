import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, ConfigError, DEFAULTS } from '../src/index.js';

test('defaults are the extracted shape', () => {
  const c = normalizeConfig({});
  assert.deepEqual(c.handlers, ['POST', 'PUT', 'PATCH', 'DELETE']);
  assert.equal(c.fileName, 'route.ts');
  assert.equal(c.allowMarker, 'allow:audit-ratchet');
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
