import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseVersion } from './versioning.mjs';
import { FLAVORS } from '../src/flavor.js';

const version = process.argv[2] ?? JSON.parse(await readFile('package.json', 'utf8')).version;
parseVersion(version);
const normalize = value => value.replace(/\r\n/g, '\n').trim();
// Check every flavor's bundle in the tag against what the CDN serves.
for (const { output } of Object.values(FLAVORS)) {
  const url = `https://cdn.jsdelivr.net/gh/rhys-3/destined-journey-assistant@v${version}/${output}`;
  const expected = execFileSync('git', ['show', `v${version}:${output}`], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true });
  let failure = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (normalize(await response.text()) !== normalize(expected)) throw new Error('CDN 内容与版本标签中的产物不一致');
      failure = null;
      console.log(`已验证 ${url}`);
      break;
    } catch (error) {
      failure = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  if (failure) throw new Error(`v${version} CDN 校验失败（${output}）：${failure.message}。标签保持不变，可稍后重新校验。`);
}
