import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planVersion, applyVersion } from './versioning.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [requested, ...options] = process.argv.slice(2);
if (!requested || options.some(option => option !== '--dry-run')) throw new Error('用法：pnpm version:prepare patch|minor|major|3.0.1 [--dry-run]');
const plan = await planVersion(root, requested);
const tag = `v${plan.version}`;
const check = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: root, windowsHide: true });
if (check.status === 0) throw new Error(`${tag} 已存在，不能重用已发布版本`);
if (check.status !== 1) throw new Error('无法检查本地 Git 标签');
if (!options.includes('--dry-run')) await applyVersion(root, plan);
console.log(`${options.includes('--dry-run') ? '预览' : '已准备'}：${plan.previous} → ${plan.version}`);
console.log(Object.keys(plan.files).join('\n'));
console.log('提交并推送到 main 后，Actions 将测试、打包并创建版本标签。');
