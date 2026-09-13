const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const run = spawnSync(process.execPath, ['tests/ui/test-config-only.cjs'], {
  cwd: process.cwd(), encoding: 'utf8', timeout: 180000,
});
if (run.error) throw run.error;
if (run.status !== 0) throw Error(run.stderr || run.stdout || `配置界面检查退出：${run.status}`);

const resultPath = path.resolve('.ui-review/configuration-test-results.json');
const results = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
for (const name of ['公共界面没有独立场外讨论页', '编辑模型副本不改变 Gemini 模板']) {
  assert(results.includes(name), `缺少检查：${name}`);
}
console.log(JSON.stringify(results.filter(name => ['公共界面没有独立场外讨论页', '编辑模型副本不改变 Gemini 模板'].includes(name)), null, 2));
