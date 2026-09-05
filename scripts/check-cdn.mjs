import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseVersion } from './versioning.mjs';

const version = process.argv[2] ?? JSON.parse(await readFile('package.json', 'utf8')).version;
parseVersion(version);
const url = `https://cdn.jsdelivr.net/gh/rhys-3/destined-journey-assistant@v${version}/dist/destined-journey-assistant.js`;
const expected = execFileSync('git', ['show', `v${version}:dist/destined-journey-assistant.js`], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true });
const normalize = value => value.replace(/\r\n/g, '\n').trim();
let failure;
for (let attempt = 0; attempt < 4; attempt++) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (normalize(await response.text()) !== normalize(expected)) throw new Error('CDN 内容与版本标签中的产物不一致');
    console.log(`已验证 ${url}`);
    process.exit(0);
  } catch (error) {
    failure = error;
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
throw new Error(`v${version} CDN 校验失败：${failure.message}。标签保持不变，可稍后重新校验。`);
