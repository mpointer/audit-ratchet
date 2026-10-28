#!/usr/bin/env node
import { loadConfig, ConfigError, DEFAULT_CONFIG_PATH } from '../src/config.js';
import { runCheck, runBaseline, runGrowth, runInit, oneLine } from '../src/commands.js';

const USAGE = `audit-ratchet <command> [options]

Commands
  check                 fail if any handler is unaudited and not baselined,
                        or an exemption has no justification (CI step 1)
  growth --base <ref>   fail if the committed baseline grew relative to <ref>
                        (CI step 2; needs the base ref fetched)
  baseline              regenerate the baseline file (tighten the ratchet)
  init                  write a config template

Options
  --config <path>       config file (default: ${DEFAULT_CONFIG_PATH})
  --base <ref>          base git ref for growth, e.g. origin/main
  -h, --help

Exit code 0 = clean, 1 = violations or error.`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--config') opts.config = argv[++i];
    else if (a === '--base') opts.base = argv[++i];
    else if (a.startsWith('--')) { console.error(`Unknown option ${a}`); process.exit(2); }
    else opts._.push(a);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const cmd = opts._[0];
if (opts.help || !cmd) { console.log(USAGE); process.exit(opts.help ? 0 : 2); }

let code;
try {
  if (cmd === 'init') {
    code = runInit(opts.config ?? DEFAULT_CONFIG_PATH);
  } else {
    const cfg = loadConfig(opts.config ?? DEFAULT_CONFIG_PATH);
    if (cmd === 'check') code = runCheck(cfg);
    else if (cmd === 'baseline') code = runBaseline(cfg);
    else if (cmd === 'growth') code = runGrowth(cfg, opts.base, { configPath: opts.config ?? DEFAULT_CONFIG_PATH });
    else { console.error(`Unknown command "${cmd}"\n\n${USAGE}`); code = 2; }
  }
} catch (e) {
  const err = oneLine(console.error);
  if (e instanceof ConfigError) { err(`::error::config: ${e.message}`); code = 1; }
  else { err(`::error::${e.message}`); code = 1; }
}
process.exit(code);
