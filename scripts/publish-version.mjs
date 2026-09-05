import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseVersion } from './versioning.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
parseVersion(pkg.version);
const tag = `v${pkg.version}`;
const loader = await readFile('loader.js', 'utf8');
if (!loader.includes(`const version = '${pkg.version}';`)) throw new Error('加载器版本不一致');
if (git('tag', '--list', tag)) {
  console.log(`${tag} 已存在，保持原标签；当前 main 的其他改动尚未发布为新版本。`);
} else {
  const changelog = await readFile('CHANGELOG.md', 'utf8');
  if (!changelog.split(/\r?\n/).includes(`## ${pkg.version}`)) throw new Error('更新日志缺少待发布版本');
  const bundle = await readFile('dist/destined-journey-assistant.js', 'utf8');
  if (!bundle.startsWith(`/* 命定预设助手 v${pkg.version} |`)) throw new Error('构建产物版本不一致');
  git('tag', tag);
  git('push', 'origin', `refs/tags/${tag}`);
  console.log(`已创建 ${tag}，不创建 GitHub Release。`);
}
