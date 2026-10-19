import { execFileSync } from 'node:child_process';

export class GitReadError extends Error {
  constructor(message, { missingPath = false } = {}) { super(message); this.missingPath = missingPath; }
}

/**
 * `git show <ref>:<path>`. A missing PATH on the ref is distinguished from
 * a missing REF, because only the first is benign (the commit that
 * introduces the baseline).
 */
export function readFileAtRef(ref, path, cwd = process.cwd()) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const stderr = String(err.stderr ?? '');
    if (/does not exist|exists on disk, but not in|path .* does not exist/i.test(stderr)) {
      throw new GitReadError(`${path} does not exist on ${ref}`, { missingPath: true });
    }
    throw new GitReadError(`could not read ${path} from ${ref}: ${stderr.trim() || err.message}`);
  }
}
