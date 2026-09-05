import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { selectChangedFiles, checkDocs, command, report } from './verification-common.mjs';

export function classify(files) {
  let full = files === null, build = false, python = false;
  const browser = new Set();
  for (const file of files ?? []) {
    if (file === 'dist/destined-journey-assistant.js') continue;
    if (/^(?:[^/]+\.md|docs\/.*\.md|LICENSE)$/.test(file)) continue;
    if (file.startsWith('@types/') || /^(?:scripts\/update-types\.py|tests\/test_update_types\.py)$/.test(file)) { python = true; continue; }
    build = true;
    if (file.startsWith('src/summary/')) browser.add('assistant');
    else if (file.startsWith('src/ui/')) for (const name of ['assistant', 'themes', 'settings']) browser.add(name);
    else if (file.startsWith('src/preset/') && !/\/(?:assistant|definitions|render|store|configurations)\.js$/.test(file)) {
      browser.add('ui'); browser.add('settings');
    } else full = true;
  }
  if (full) for (const name of ['ui', 'assistant', 'themes', 'settings']) browser.add(name);
  return { full, build: build || full, python: python || full,
    ui: browser.has('ui'), assistant: browser.has('assistant'), themes: browser.has('themes'), settings: browser.has('settings'),
    matrix: { os: full ? ['ubuntu-latest', 'windows-latest'] : ['ubuntu-latest'] }, files };
}

export function run(plan) {
  checkDocs();
  if (plan.python) {
    const r = spawnSync('python', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_update_types.py'], { stdio: 'inherit', windowsHide: true });
    if (r.status !== 0) throw new Error('Type updater verification failed');
  }
  if (plan.build) { command(['--test', 'tests/*.test.js']); command(['build.js']); }
  for (const name of ['ui', 'assistant', 'themes', 'settings']) if (plan[name]) command([`tests/ui/test-${name}.cjs`]);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter(a => a !== '--');
  const plan = classify(args.includes('--full') ? null : await selectChangedFiles(args.includes('--base') ? args[args.indexOf('--base') + 1] : undefined));
  if (args.includes('--docs')) checkDocs();
  else { report(plan); if (!args.includes('--plan')) run(plan); }
}
