import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
const pkg=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8'));
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/index.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/destined-journey-assistant.js',minify:true,legalComments:'none',banner:{js:'/* 命定预设助手 v'+pkg.version+' | MIT | Rhys_z_瑞 */'}});
console.log('命定预设助手 v'+pkg.version+' 构建完成');
