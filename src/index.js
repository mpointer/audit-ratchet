export { DEFAULTS, DEFAULT_CONFIG_PATH, ConfigError, normalizeConfig, loadConfig } from './config.js';
export { analyzeSource, hasJustification } from './analyze.js';
export { collectFiles, collectHandlers } from './collect.js';
export { buildBaselinePayload, parseBaseline, compareToBaseline, compareBaselines, BaselineError } from './baseline.js';
export { readFileAtRef, GitReadError } from './git.js';
export { runCheck, runBaseline, runGrowth, runInit } from './commands.js';
