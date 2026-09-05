import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { nextVersion, planVersion, applyVersion } from '../scripts/versioning.mjs';

const address = version => `https://cdn.jsdelivr.net/gh/rhys-3/destined-journey-assistant@v${version}/dist/destined-journey-assistant.js`;
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'destined-version-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(Object.entries({
    'package.json': JSON.stringify({ name: 'test-assistant', version: '3.0.0' }),
    'loader.js': "const version = '3.0.0';\n",
    'README.md': address('3.0.0')+'\n',
    'CHANGELOG.md': '# 更新日志\n\n## 未发布\n\n- 修复界面。\n\n## 3.0.0\n\n- 初始版本。\n',
  }).map(([name, text]) => writeFile(join(root, name), text)));
  return root;
}

test('version increments are explicit and cannot reuse or downgrade versions', () => {
  assert.equal(nextVersion('3.2.9', 'patch'), '3.2.10');
  assert.equal(nextVersion('3.2.9', 'minor'), '3.3.0');
  assert.equal(nextVersion('3.2.9', 'major'), '4.0.0');
  assert.equal(nextVersion('3.2.9', '3.4.1'), '3.4.1');
  for (const value of ['3.2.9', '2.9.9', '03.3.0', 'v3.3.0', '3.3.0; echo unsafe']) assert.throws(() => nextVersion('3.2.9', value));
});

test('version preparation synchronizes package, loader, installation URL and changelog', async t => {
  const root = await fixture(t);
  const plan = await planVersion(root, 'patch');
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, '3.0.0');
  await applyVersion(root, plan);
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, '3.0.1');
  assert((await readFile(join(root, 'loader.js'), 'utf8')).includes("'3.0.1'"));
  assert((await readFile(join(root, 'README.md'), 'utf8')).includes(address('3.0.1')));
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  assert(changelog.includes('## 3.0.1\n\n- 修复界面。'));
  assert(changelog.includes('## 3.0.0'));
});

test('inconsistent preparation inputs fail before any file changes', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'loader.js'), "const version = '2.0.0';\n");
  await assert.rejects(planVersion(root, 'patch'), /不一致/);
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, '3.0.0');
});

test('tag publication includes the committed bundle and never moves an existing version', async t => {
  const root = await fixture(t);
  const remote = join(root, 'remote.git');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--bare', remote);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Version Test');
  git('config', 'user.email', 'test@example.invalid');
  git('remote', 'add', 'origin', remote);
  // Keep the test's bare remote out of its working tree index.
  await writeFile(join(root, '.gitignore'), 'remote.git/\n');
  await mkdir(join(root, 'dist'));
  const bundlePath = join(root, 'dist/destined-journey-assistant.js');
  await writeFile(bundlePath, '/* 命定预设助手 v3.0.0 | MIT */\nconsole.log("verified");');
  git('add', '.'); git('commit', '-m', 'verified bundle');
  const original = git('rev-parse', 'HEAD');
  const script = fileURLToPath(new URL('../scripts/publish-version.mjs', import.meta.url));
  const publish = () => execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  publish();
  assert.equal(git('rev-parse', 'v3.0.0'), original);
  assert(git('show', 'v3.0.0:dist/destined-journey-assistant.js').includes('verified'));
  await writeFile(bundlePath, 'unreleased development change');
  git('add', 'dist'); git('commit', '-m', 'unreleased work');
  assert(publish().includes('保持原标签'));
  assert.equal(git('rev-parse', 'v3.0.0'), original);
  assert(git('ls-remote', '--tags', 'origin', 'refs/tags/v3.0.0').startsWith(original));
});
