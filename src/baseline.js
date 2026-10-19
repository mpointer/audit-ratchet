/** The committed record of known debt. `unaudited` is the load-bearing field. */
export function buildBaselinePayload(handlers, cfg) {
  return {
    _comment:
      `Handlers with no ${cfg.actionPrefixes.join('/')}-namespaced audit write (${cfg.label}). ` +
      'A handler ADDED here is new debt: CI compares this file against the PR base and ' +
      'fails on growth, so regenerating does not launder a regression past review. ' +
      'Regenerate with `audit-ratchet baseline`.',
    generatedFrom: `${handlers.length} exported handlers under ${cfg.roots.join(', ')}`,
    unaudited: handlers.filter((h) => !h.audited).map((h) => h.key).sort(),
  };
}

export class BaselineError extends Error {}

/** Parse a baseline document; the `unaudited` array is required. */
export function parseBaseline(json, where = 'baseline') {
  let parsed;
  try { parsed = JSON.parse(json); } catch (err) { throw new BaselineError(`${where} is not valid JSON: ${err.message}`); }
  if (!parsed || !Array.isArray(parsed.unaudited) || parsed.unaudited.some((k) => typeof k !== 'string')) {
    throw new BaselineError(`${where} has no "unaudited" array of strings`);
  }
  return parsed.unaudited;
}

/**
 * Compare the tree against the committed baseline. Pure.
 *
 *   newlyUnaudited         a handler not in the baseline writes no namespaced row: FAIL
 *   unjustifiedExemptions  a marker with no prose: FAIL
 *   nowFixed               a baselined handler now audits: WARN, tighten the baseline
 *   stale                  a baselined handler no longer exists: WARN, tighten
 *
 * Improvements warn rather than fail on purpose: failing a PR for
 * improving coverage teaches people that regenerating the baseline is the
 * normal response to this check, and that reflex is what defeats a ratchet.
 */
export function compareToBaseline(handlers, baselineKeys) {
  const baseline = new Set(baselineKeys);
  const auditedKeys = new Set(handlers.filter((h) => h.audited && !h.exempt).map((h) => h.key));
  const liveKeys = new Set(handlers.map((h) => h.key));
  return {
    newlyUnaudited: handlers.filter((h) => !h.audited && !baseline.has(h.key)),
    unjustifiedExemptions: handlers.filter((h) => h.exempt && !h.justified),
    nowFixed: [...baseline].filter((k) => auditedKeys.has(k)).sort(),
    stale: [...baseline].filter((k) => !liveKeys.has(k)).sort(),
    auditedCount: auditedKeys.size,
    exemptCount: handlers.filter((h) => h.exempt).length,
    total: handlers.length,
  };
}

/**
 * The growth half of the ratchet. Pure. The check above cannot tell new
 * debt from old: add a handler with no audit write, regenerate, and it is
 * green. This compares the baseline on the base ref with the one on the
 * branch and fails on any ADDED key. Shrinking is always fine.
 */
export function compareBaselines(baseKeys, headKeys) {
  const base = new Set(baseKeys);
  const head = new Set(headKeys);
  return {
    added: [...head].filter((k) => !base.has(k)).sort(),
    removed: [...base].filter((k) => !head.has(k)).sort(),
    headCount: head.size,
  };
}
