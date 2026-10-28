import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULTS, DEFAULT_CONFIG_PATH, normalizeConfig } from './config.js';
import { collectFiles, collectHandlers } from './collect.js';
import { starExports } from './analyze.js';
import { buildBaselinePayload, parseBaseline, compareToBaseline, compareBaselines } from './baseline.js';
import { readFileAtRef, GitReadError } from './git.js';

/**
 * Each command returns an exit code and writes through the given streams,
 * so the CLI is a thin shell and the tests can run commands in-process.
 * Error lines use GitHub Actions annotation syntax so a failing CI step
 * shows the reason inline.
 */

/**
 * Paths, baseline keys, module specifiers and git or config errors all come
 * from the change under review. A line break inside one would start a new
 * output line, and GitHub runs any line starting with `::` as a workflow
 * command. So every write is exactly one line: breaks are encoded the way
 * GitHub decodes them inside a command's message.
 */
export const oneLine = (write) => (line) => write(String(line).replace(/\r/g, '%0D').replace(/\n/g, '%0A'));

/** A workflow-command property value (`file=...`), escaped per the Actions spec. */
const prop = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');

export function runCheck(cfg, { cwd = process.cwd(), out = console.log, err = console.error, warn = console.warn } = {}) {
  out = oneLine(out); err = oneLine(err); warn = oneLine(warn);
  const handlers = collectHandlers(cfg, cwd);
  let baselineKeys;
  try {
    baselineKeys = parseBaseline(readFileSync(resolve(cwd, cfg.baseline), 'utf8'), cfg.baseline);
  } catch (e) {
    err(`::error::Cannot read ${cfg.baseline}: ${e.message}`);
    err('Generate it with `audit-ratchet baseline`.');
    return 1;
  }
  const r = compareToBaseline(handlers, baselineKeys);
  let failed = false;
  const ns = cfg.actionPrefixes.join('/');

  if (r.newlyUnaudited.length > 0) {
    failed = true;
    err(`::error::${r.newlyUnaudited.length} handler(s) write no ${ns}-namespaced audit row (${cfg.label}).`);
    err('');
    for (const h of r.newlyUnaudited) err(`  ${h.file}:${h.line}  ${h.method}() -- ${h.reason}`);
    err('');
    for (const line of cfg.guidance) err(line);
    if (cfg.guidance.length > 0) err('');
    err(`Fix by reaching one of: ${[...cfg.sinks, ...cfg.sinkModules.map((m) => `an export of ${m}`), ...cfg.tableInserts.map((t) => `insert(${t})`)].join(', ')},`);
    err(`with an action opening with ${cfg.actionPrefixes.map((p) => `"${p}"`).join(' or ')} unless the sink applies the namespace itself.`);
    err('');
    err(`If the mutation genuinely is not security-relevant, exempt it with a BLOCK comment`);
    err(`(/* ... */, not //) containing ${cfg.allowMarker}, plus a sentence saying why.`);
    err(`Do NOT regenerate the baseline: CI compares it against the PR base and fails on growth.`);
  }

  if (r.unjustifiedExemptions.length > 0) {
    failed = true;
    err('');
    err(`::error::${r.unjustifiedExemptions.length} ${cfg.allowMarker} marker(s) carry no justification.`);
    for (const h of r.unjustifiedExemptions) err(`  ${h.file}:${h.line}  ${h.method}()`);
    err('');
    err('Say why the mutation is not security-relevant in the same block comment.');
    err('The marker is not the justification.');
  }

  for (const rel of collectFiles(cfg, cwd)) {
    for (const s of starExports(rel, readFileSync(resolve(cwd, rel), 'utf8'))) {
      warn(`::warning file=${prop(rel)},line=${s.line}::${rel}:${s.line} re-exports everything from '${s.specifier}'; ` +
        'handlers exported that way are not checked. Export them by name.');
    }
  }
  for (const k of r.nowFixed) warn(`::warning::${k} now writes an audit row. Drop it from ${cfg.baseline}.`);
  for (const k of r.nowExempt) warn(`::warning::${k} is now exempt. Drop it from ${cfg.baseline}.`);
  for (const k of r.stale) warn(`::warning::${k} no longer exists. Drop it from ${cfg.baseline}.`);
  if (r.nowFixed.length > 0 || r.nowExempt.length > 0 || r.stale.length > 0) warn('Tighten the ratchet: `audit-ratchet baseline`.');

  if (failed) return 1;
  out(
    `${capitalize(cfg.label)}: ${r.auditedCount}/${r.total} handlers audited, ` +
      `${r.exemptCount} exempt, ${baselineKeys.length} baselined as known debt. No regression.`,
  );
  return 0;
}

export function runBaseline(cfg, { cwd = process.cwd(), out = console.log } = {}) {
  out = oneLine(out);
  const handlers = collectHandlers(cfg, cwd);
  const payload = buildBaselinePayload(handlers, cfg);
  writeFileSync(resolve(cwd, cfg.baseline), `${JSON.stringify(payload, null, 2)}\n`);
  const audited = handlers.filter((h) => h.audited && !h.exempt).length;
  const exempt = handlers.filter((h) => h.exempt).length;
  out(`Wrote ${cfg.baseline}: ${payload.unaudited.length} unaudited, ${audited} audited, ${exempt} exempt, of ${handlers.length} handlers.`);
  return 0;
}

export function runGrowth(cfg, baseRef, { configPath = DEFAULT_CONFIG_PATH, cwd = process.cwd(), out = console.log, err = console.error } = {}) {
  out = oneLine(out); err = oneLine(err);
  if (!baseRef) {
    err('::error::Usage: audit-ratchet growth --base <ref>');
    return 1;
  }
  // Read the baseline the BASE config names: a branch that points `baseline`
  // at a new file would otherwise be compared against nothing.
  let basePath = cfg.baseline;
  try {
    basePath = normalizeConfig(JSON.parse(readFileAtRef(baseRef, configPath, cwd))).baseline;
  } catch (e) {
    if (!(e instanceof GitReadError && e.missingPath)) {
      err(`::error::${configPath} on ${baseRef}: ${e.message}`);
      err('The job needs fetch-depth: 0 so the base ref is present.');
      return 1;
    }
  }
  let baseJson;
  try {
    baseJson = readFileAtRef(baseRef, basePath, cwd);
  } catch (e) {
    if (e instanceof GitReadError && e.missingPath) {
      out(`${basePath} does not exist on ${baseRef}; this change introduces it. OK.`);
      return 0;
    }
    err(`::error::${e.message}`);
    err('The job needs fetch-depth: 0 so the base ref is present.');
    return 1;
  }
  let base, head;
  try {
    base = parseBaseline(baseJson, `${basePath} on ${baseRef}`);
    head = parseBaseline(readFileSync(resolve(cwd, cfg.baseline), 'utf8'), `${cfg.baseline} on this branch`);
  } catch (e) {
    err(`::error::${e.message}`);
    return 1;
  }
  const r = compareBaselines(base, head);
  if (r.added.length > 0) {
    err(`::error::This change ADDS ${r.added.length} handler(s) to ${cfg.baseline}:`);
    err('');
    for (const k of r.added) err(`  ${k}`);
    err('');
    err('The baseline records debt that predates the rule; it is not a place to put new');
    err('debt. Give these handlers an audit write instead. If a mutation genuinely is not');
    err(`security-relevant, exempt it at the handler with a block comment containing`);
    err(`${cfg.allowMarker} and a reason, rather than adding a baseline line: an exemption is`);
    err('visible where the code is, a baseline entry is not.');
    return 1;
  }
  out(
    r.removed.length > 0
      ? `Baseline shrank by ${r.removed.length} (${r.headCount} left). Ratchet tightened.`
      : `Baseline unchanged at ${r.headCount} entries.`,
  );
  return 0;
}

export function runInit(path = DEFAULT_CONFIG_PATH, { cwd = process.cwd(), out = console.log, err = console.error } = {}) {
  out = oneLine(out); err = oneLine(err);
  const full = resolve(cwd, path);
  if (existsSync(full)) {
    err(`::error::${path} already exists; delete it first if you want a fresh template.`);
    return 1;
  }
  const template = {
    $schema: 'https://raw.githubusercontent.com/mpointer/audit-ratchet/main/audit-ratchet.schema.json',
    _comment: 'Every key is optional; omitted keys take the defaults shown here. See README.',
    ...DEFAULTS,
    guidance: ['A handler that leaves no namespaced audit row is invisible in the audit log.'],
  };
  writeFileSync(full, `${JSON.stringify(template, null, 2)}\n`);
  out(`Wrote ${path}. Edit it, then run \`audit-ratchet baseline\` and commit both files.`);
  return 0;
}

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
