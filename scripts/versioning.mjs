import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function parseVersion(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('版本格式应为 major.minor.patch，例如 3.0.1');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('版本号超出范围');
  return parts;
}

export function nextVersion(current, requested) {
  const parts = parseVersion(current);
  const index = ['major', 'minor', 'patch'].indexOf(requested);
  let target;
  if (index >= 0) {
    target = parts.map((value, at) => at < index ? value : at === index ? value + 1 : 0).join('.');
  } else target = requested;
  const next = parseVersion(target);
  const difference = next.findIndex((value, at) => value !== parts[at]);
  if (difference < 0 || next[difference] < parts[difference]) throw new Error('新版本必须高于当前版本');
  return target;
}

export async function planVersion(root, requested) {
  const names = ['package.json', 'loader.js', 'README.md', 'CHANGELOG.md'];
  const originals = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(resolve(root, name), 'utf8')])));
  const pkg = JSON.parse(originals['package.json']);
  const version = nextVersion(pkg.version, requested);
  const loaderPattern = /const version = '[^']+';/g;
  if ((originals['loader.js'].match(loaderPattern) ?? []).length !== 1) throw new Error('加载器的版本声明缺失或不唯一');
  if (!originals['loader.js'].includes(`const version = '${pkg.version}';`)) throw new Error('package 与加载器版本不一致');
  const address = `https://cdn.jsdelivr.net/gh/rhys-3/destined-journey-assistant@v${pkg.version}/dist/destined-journey-assistant.js`;
  if (!originals['README.md'].includes(address)) throw new Error('README 安装地址与 package 版本不一致');
  const heading = /^## 未发布[ \t]*\r?\n/m;
  if (!heading.test(originals['CHANGELOG.md'])) throw new Error('更新日志缺少“未发布”章节');
  const unreleased = originals['CHANGELOG.md'].split(heading)[1]?.split(/^## /m)[0]?.trim();
  if (!unreleased) throw new Error('请先在更新日志“未发布”章节记录此版本的变更');
  const files = {
    'package.json': JSON.stringify({ ...pkg, version }, null, 2) + '\n',
    'loader.js': originals['loader.js'].replace(loaderPattern, `const version = '${version}';`),
    'README.md': originals['README.md'].replaceAll(address, address.replace(`@v${pkg.version}/`, `@v${version}/`)),
    'CHANGELOG.md': originals['CHANGELOG.md'].replace(heading, `## 未发布\n\n## ${version}\n`),
  };
  return { previous: pkg.version, version, originals, files };
}

export async function applyVersion(root, plan) {
  const written = [];
  try {
    for (const [name, text] of Object.entries(plan.files)) {
      written.push(name);
      await writeFile(resolve(root, name), text);
    }
  } catch (error) {
    const rollback = await Promise.allSettled(written.map(name => writeFile(resolve(root, name), plan.originals[name])));
    const failures = rollback.filter(item => item.status === 'rejected').map(item => item.reason);
    if (failures.length) throw new AggregateError([error, ...failures], '版本写入与回滚失败，请检查文件');
    throw error;
  }
}
