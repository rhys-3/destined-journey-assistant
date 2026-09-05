import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

export function git(args, root = process.cwd()) {
  return execFileSync(
    'git',
    ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    },
  ).trim();
}

// Include both sides of renames and deletions, plus local untracked files.
/** @param {{root?: string, base?: string, event?: {pull_request?: {base: {sha: string}}, before?: string}, eventName?: string}} [options] */
export function changedFiles({
  root = process.cwd(),
  base,
  event,
  eventName,
} = {}) {
  if (!event && process.env.GITHUB_EVENT_PATH) {
    event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    eventName = process.env.GITHUB_EVENT_NAME;
  }
  if (!base && eventName === 'pull_request') {
    base = git(['merge-base', event.pull_request.base.sha, 'HEAD'], root);
  } else if (!base && eventName === 'push') base = event.before;
  else if (!base && eventName) return null; // A manual run defaults to full verification.
  base ??= 'HEAD';
  if (/^0+$/.test(base) || base.startsWith('-')) return null;
  try {
    const resolved = git(['rev-parse', '--verify', `${base}^{commit}`], root);
    return [
      ...new Set(
        [
          ...git(
            ['diff', '--name-only', '-z', '--no-renames', resolved, '--'],
            root,
          ).split('\0'),
          ...git(
            ['ls-files', '--others', '--exclude-standard', '-z'],
            root,
          ).split('\0'),
        ].filter(Boolean),
      ),
    ].sort();
  } catch {
    return null;
  }
}

// A failed push must remain in the next verification range. PRs already compare
// their complete branch; main compares against its last successful workflow.
export async function selectChangedFiles(base, root = process.cwd()) {
  if (base || process.env.GITHUB_EVENT_NAME !== 'push')
    return changedFiles({ base, root });
  const token = process.env.GITHUB_TOKEN,
    repo = process.env.GITHUB_REPOSITORY;
  const workflow = process.env.VERIFICATION_WORKFLOW;
  if (!token || !repo || !workflow) return null;
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?branch=main&status=success&per_page=30`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    for (const run of data.workflow_runs ?? []) {
      if (
        run.status !== 'completed' ||
        run.conclusion !== 'success' ||
        !['push', 'workflow_dispatch'].includes(run.event) ||
        run.head_branch !== 'main' ||
        !/^[a-f0-9]{40}$/.test(run.head_sha)
      )
        continue;
      try {
        git(['merge-base', '--is-ancestor', run.head_sha, 'HEAD'], root);
        console.log(
          `Verification base: ${run.head_sha} (successful run ${run.id})`,
        );
        return changedFiles({ base: run.head_sha, root });
      } catch {
        /* Not an ancestor of this checkout. */
      }
    }
  } catch {
    /* Network errors conservatively select full verification. */
  }
  return null;
}

export function checkDocs(root = process.cwd()) {
  const names = git(['ls-files', '-z'], root)
    .split('\0')
    .filter((name) => /^(?:[^/]+\.md|docs\/[^/]+\.md)$/.test(name));
  const failures = [];
  for (const name of names) {
    if (!fs.existsSync(path.join(root, name))) continue;
    const text = fs
      .readFileSync(path.join(root, name), 'utf8')
      .replace(/```[\s\S]*?```/g, '');
    for (const match of text.matchAll(
      /\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g,
    )) {
      let target = match[1].replace(/^<|>$/g, '');
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
      target = decodeURIComponent(target.split(/[?#]/)[0]);
      if (
        target &&
        !fs.existsSync(
          path.resolve(path.dirname(path.join(root, name)), target),
        )
      )
        failures.push(`${name}: ${target}`);
    }
  }
  if (failures.length)
    throw new Error(
      'Broken local documentation links:\n' + failures.join('\n'),
    );
  console.log(
    `Documentation links checked (${names.length} files); external URLs are not requested.`,
  );
}

export function command(args, root = process.cwd()) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`Verification failed: node ${args.join(' ')}`);
}

export function report(plan) {
  console.log(JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_OUTPUT)
    for (const [key, value] of Object.entries(plan))
      if (key !== 'files')
        fs.appendFileSync(
          process.env.GITHUB_OUTPUT,
          `${key}=${JSON.stringify(value)}\n`,
        );
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Selected verification\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`,
    );
}
