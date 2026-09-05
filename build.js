import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
const pkg=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8'));
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/index.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/destined-journey-assistant.js',minify:true,legalComments:'none',banner:{js:'/* 命定预设助手 v'+pkg.version+' | '+pkg.license+'\nRequired Notice: Copyright (c) 2024-2026 Rhys_z_瑞\nRequired Notice: Licensing scope and historical/third-party exceptions: https://github.com/rhys-3/destined-journey-assistant/blob/main/docs/LICENSING.md\nLicense: https://spdx.org/licenses/PolyForm-Noncommercial-1.0.0.html\n*/'}});
console.log('命定预设助手 v'+pkg.version+' 构建完成');
